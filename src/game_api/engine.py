"""Game rules engine: session lifecycle, delivery start, and the tick that
advances active deliveries, expires stale orders and rolls shifts forward.

This is the server-side counterpart of frontend/src/api/MockGameClient.ts's
setInterval ticker — same rules, but authoritative here instead of trusting
the browser.
"""

from __future__ import annotations

import random
import uuid
from datetime import UTC, datetime, timedelta

from game_api import map_data
from game_api.calculations import (
    DeliveryPreview,
    OrderView,
    RoverView,
    calculate_delivery_preview,
    deterministic_roll,
    mission_duration_ms,
)
from game_api.catalog import SHIFT_DURATION_MINUTES, TOTAL_SHIFTS
from game_api.store import GameStore


class GameError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _log_id() -> str:
    return f"log-{uuid.uuid4().hex}"


class Engine:
    def __init__(self, store: GameStore) -> None:
        self.store = store

    # -- session lifecycle -------------------------------------------------

    def create_session(self, player_id: str = "local_player") -> str:
        session_id = f"lunar-{uuid.uuid4().hex[:12]}"
        seed = random.getrandbits(32)
        now = datetime.now(UTC)
        self.store.create_session(session_id, player_id, seed, now)
        return session_id

    def restart_session(self, session_id: str) -> None:
        if not self.store.session_exists(session_id):
            raise GameError("Сессия не найдена.", "not_found")
        seed = random.getrandbits(32)
        now = datetime.now(UTC)
        self.store.restart_session(session_id, now, seed)

    def get_state(self, session_id: str) -> dict:
        if not self.store.session_exists(session_id):
            raise GameError("Сессия не найдена.", "not_found")
        self.advance(session_id)
        return self.store.get_state(session_id)

    # -- delivery preview / start -------------------------------------------

    def preview(self, session_id: str, order_id: str, rover_id: str, route_id: str) -> DeliveryPreview:
        order_row = self.store.get_order(session_id, order_id)
        rover_row = self.store.get_rover(session_id, rover_id)
        route = map_data.get_route(route_id)
        if order_row is None or rover_row is None or route is None:
            raise GameError("Не удалось построить прогноз: данные миссии устарели.", "not_found")
        return self._compute_preview(order_row, rover_row, route)

    def _compute_preview(self, order_row, rover_row, route) -> DeliveryPreview:
        order = OrderView(
            id=order_row["id"],
            weight_kg=order_row["weight_kg"],
            reward=order_row["reward"],
            cargo_risk=order_row["cargo_risk"],
            status=order_row["status"],
            destination_id=order_row["destination_id"],
        )
        rover = RoverView(
            id=rover_row["id"],
            name=rover_row["name"],
            capacity_kg=rover_row["capacity_kg"],
            battery=rover_row["battery"],
            speed=rover_row["speed"],
            energy_per_km=rover_row["energy_per_km"],
            risk_protection=rover_row["risk_protection"],
            status=rover_row["status"],
        )
        return calculate_delivery_preview(order, rover, route)

    def start_delivery(
        self, session_id: str, order_id: str, rover_id: str, route_id: str, state_version: int
    ) -> dict:
        self.advance(session_id)
        session_row = self.store.get_session(session_id)
        if session_row is None:
            raise GameError("Сессия не найдена.", "not_found")
        if session_row["status"] != "active":
            raise GameError("Смена завершена. Начните новую игру.", "game_over")
        if state_version != session_row["version"]:
            raise GameError(
                "Состояние изменилось. Прогноз обновлён — проверьте миссию ещё раз.", "stale_state"
            )

        order_row = self.store.get_order(session_id, order_id)
        rover_row = self.store.get_rover(session_id, rover_id)
        route = map_data.get_route(route_id)
        if order_row is None or rover_row is None or route is None:
            raise GameError("Заказ или ровер больше не доступны.", "not_found")

        preview = self._compute_preview(order_row, rover_row, route)
        if not preview.feasible:
            raise GameError(preview.reason or "Доставка недоступна.", preview.reason_code or "rejected")

        now = datetime.now(UTC)
        duration_ms = mission_duration_ms(preview)
        completes_at = now + timedelta(milliseconds=duration_ms)
        # deliveries.id is a single global primary key (all sessions share one
        # table), so the id must be unique across sessions too — not just
        # within one, unlike MockGameClient.ts's per-browser-tab id scheme.
        delivery_id = f"delivery-{session_id}-{session_row['version']}-{rover_id}"
        result_roll = deterministic_roll(
            session_row["seed"], f"{delivery_id}:{order_id}:{session_row['version']}"
        )

        self.store.insert_delivery(
            session_id, delivery_id, order_id, rover_id, route_id, now, completes_at, preview, result_roll
        )
        destination = map_data.get_destination(order_row["destination_id"])
        destination_name = destination.name if destination else order_row["destination_id"]
        self.store.append_log(
            session_id, _log_id(), now, f"{rover_row['name']} вышел к пункту «{destination_name}».", "info"
        )
        return {
            "id": delivery_id,
            "order_id": order_id,
            "rover_id": rover_id,
            "route_id": route_id,
            "status": "active",
            "phase": "outbound",
            "progress": 0.0,
            "started_at": now,
            "completes_at": completes_at,
            "preview": preview,
            "result_roll": result_roll,
        }

    def charge_rover(self, session_id: str, rover_id: str) -> None:
        self.advance(session_id)
        session_row = self.store.get_session(session_id)
        if session_row is None:
            raise GameError("Сессия не найдена.", "not_found")
        if session_row["status"] != "active":
            raise GameError("Смена завершена. Начните новую игру.", "game_over")
        rover_row = self.store.get_rover(session_id, rover_id)
        if rover_row is None:
            raise GameError("Ровер не найден.", "not_found")
        if rover_row["status"] != "idle":
            raise GameError("Нельзя заряжать ровер во время миссии.", "rover_busy")
        if rover_row["battery"] >= rover_row["battery_max"]:
            return
        if session_row["credits"] < 30:
            raise GameError("Для зарядки нужно 30 кредитов.", "insufficient_credits")

        self.store.charge_rover(session_id, rover_id, rover_row["battery_max"])
        self.store.append_log(
            session_id, _log_id(), datetime.now(UTC), f"{rover_row['name']}: батарея заряжена до 100%.", "success"
        )

    # -- tick ----------------------------------------------------------------

    def advance(self, session_id: str) -> None:
        session_row = self.store.get_session(session_id)
        if session_row is None or session_row["status"] != "active":
            return

        now = datetime.now(UTC)
        state = self.store.get_state(session_id)

        for delivery in state["deliveries"]:
            if delivery["status"] != "active":
                continue
            started = _parse(delivery["started_at"])
            completes = _parse(delivery["completes_at"])
            total = (completes - started).total_seconds()
            elapsed = (now - started).total_seconds()
            progress = 0.0 if total <= 0 else min(1.0, max(0.0, elapsed / total))
            phase = "outbound" if progress < 0.5 else ("returning" if progress < 1 else "complete")

            if progress >= 1:
                self._finish_delivery(session_id, delivery, now)
            elif phase != delivery["phase"] or progress != delivery["progress"]:
                self.store.set_delivery_progress(session_id, delivery["id"], progress, phase)

        active_order_ids = {d["order_id"] for d in state["deliveries"] if d["status"] == "active"}
        for order in state["orders"]:
            if (
                order["status"] == "available"
                and not order["demo_blocked"]
                and order["id"] not in active_order_ids
                and _parse(order["deadline_at"]) <= now
            ):
                self.store.expire_order(session_id, order["id"])
                self.store.append_log(
                    session_id, _log_id(), now, f"Срок заказа «{order['title']}» истёк.", "danger"
                )

        self._check_shift_progression(session_id, now)

    def _finish_delivery(self, session_id: str, delivery: dict, now: datetime) -> None:
        order_row = self.store.get_order(session_id, delivery["order_id"])
        rover_row = self.store.get_rover(session_id, delivery["rover_id"])
        if order_row is None or rover_row is None:
            return

        preview = delivery["preview"]
        succeeded = delivery["result_roll"] <= preview["success_probability"]
        energy_cost = preview["energy_cost"]

        if succeeded:
            reward = order_row["reward"]
            credits_delta = reward
            score_delta = round(reward * (1 + (1 - preview["risk"])))
            rating_delta = 1
            message = f"Груз доставлен. {rover_row['name']} вернулся на базу, +{reward} кр."
            tone = "success"
        else:
            reward = 0
            credits_delta = -40
            score_delta = -25
            rating_delta = -3
            message = f"Миссия завершена с потерями. {rover_row['name']} эвакуирован, −40 кр."
            tone = "danger"

        self.store.finish_delivery(
            session_id,
            delivery["id"],
            delivery["order_id"],
            delivery["rover_id"],
            succeeded,
            energy_cost,
            reward,
            score_delta,
            rating_delta,
            credits_delta,
        )
        self.store.append_log(session_id, _log_id(), now, message, tone)

    def _check_shift_progression(self, session_id: str, now: datetime) -> None:
        session_row = self.store.get_session(session_id)
        if session_row is None or session_row["status"] != "active":
            return

        if session_row["rating"] <= 0:
            self.store.set_status(session_id, "lost")
            self.store.append_log(
                session_id, _log_id(), now, "Рейтинг базы обнулился. Смена диспетчера окончена.", "danger"
            )
            return

        if _parse(session_row["shift_ends_at"]) > now:
            return

        if session_row["shift"] >= TOTAL_SHIFTS:
            self.store.set_status(session_id, "won")
            self.store.append_log(
                session_id,
                _log_id(),
                now,
                f"Третья смена завершена. База «Селена» выстояла — итоговый рейтинг {session_row['rating']}%.",
                "success",
            )
            return

        next_shift = session_row["shift"] + 1
        next_ends_at = now + timedelta(minutes=SHIFT_DURATION_MINUTES)
        self.store.advance_shift(session_id, now, next_shift, next_ends_at)
        self.store.append_log(
            session_id, _log_id(), now, f"Смена {next_shift} началась. Поступили новые заказы.", "info"
        )

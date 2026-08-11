"""Delivery math: identical rules to frontend/src/domain/calculations.ts.

This is the authoritative, server-side copy used by the live backend. The
in-browser mock keeps its own TypeScript copy so it can run with zero
network dependency; both must encode the same weight/battery/risk rules.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from game_api.catalog import EMERGENCY_BATTERY_RESERVE
from game_api.map_data import Route

IMPOSSIBLE_ORDER_MESSAGE = (
    "Доставка невозможна: вес 185 кг превышает максимальную грузоподъёмность парка 160 кг."
)


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


@dataclass
class OrderView:
    id: str
    weight_kg: float
    reward: int
    cargo_risk: float
    status: str
    destination_id: str


@dataclass
class RoverView:
    id: str
    name: str
    capacity_kg: float
    battery: float
    speed: float
    energy_per_km: float
    risk_protection: float
    status: str


@dataclass
class DeliveryPreview:
    feasible: bool
    load_ratio: float
    energy_cost: int
    battery_after: float
    duration_seconds: int
    risk: float
    success_probability: float
    expected_reward: int
    warnings: list[str] = field(default_factory=list)
    reason: str | None = None
    reason_code: str | None = None


def calculate_delivery_preview(order: OrderView, rover: RoverView, route: Route) -> DeliveryPreview:
    load_ratio = order.weight_kg / rover.capacity_kg
    energy_cost = math.ceil(
        route.distance_km * rover.energy_per_km * route.energy_multiplier * (1 + 0.65 * load_ratio)
    )
    duration_seconds = math.ceil(
        (route.base_duration_seconds * route.time_multiplier * (1 + 0.35 * load_ratio)) / rover.speed
    )
    risk = clamp(
        route.base_risk + order.cargo_risk + 0.12 * load_ratio - rover.risk_protection,
        0.02,
        0.8,
    )
    battery_after = rover.battery - energy_cost
    warnings: list[str] = []

    reason: str | None = None
    reason_code: str | None = None
    if order.weight_kg > rover.capacity_kg:
        reason = IMPOSSIBLE_ORDER_MESSAGE if order.weight_kg == 185 else (
            f"Ровер «{rover.name}» принимает не более {rover.capacity_kg:g} кг."
        )
        reason_code = "capacity_exceeded"
    elif rover.status != "idle":
        reason = f"Ровер «{rover.name}» уже выполняет доставку."
        reason_code = "rover_busy"
    elif order.status != "available":
        reason = "Заказ уже назначен или закрыт."
        reason_code = "order_unavailable"
    elif route.destination_id != order.destination_id:
        reason = "Выбранный маршрут не ведёт к пункту заказа."
        reason_code = "wrong_destination"
    elif battery_after < EMERGENCY_BATTERY_RESERVE:
        reason = f"Недостаточно заряда: после рейса останется {battery_after:g} ед., резерв — {EMERGENCY_BATTERY_RESERVE}."
        reason_code = "insufficient_battery"

    if 0.9 <= load_ratio <= 1:
        warnings.append(f"Загрузка {round(load_ratio * 100)}% увеличивает время и расход.")
    if risk >= 0.35:
        warnings.append("Маршрут требует усиленного контроля в опасной зоне.")
    if EMERGENCY_BATTERY_RESERVE <= battery_after < 25:
        warnings.append("Низкий остаток заряда после возвращения.")

    return DeliveryPreview(
        feasible=reason is None,
        reason=reason,
        reason_code=reason_code,
        load_ratio=load_ratio,
        energy_cost=energy_cost,
        battery_after=battery_after,
        duration_seconds=duration_seconds,
        risk=risk,
        success_probability=1 - risk,
        expected_reward=round(order.reward * (1 - risk)),
        warnings=warnings,
    )


def deterministic_roll(seed: int, key: str) -> float:
    """Same xorshift/FNV-style mix as frontend/src/domain/calculations.ts's
    deterministicRoll, so a given (seed, key) pair is reproducible: replaying
    a session (or comparing mock vs. live) yields the same delivery outcome."""
    mask = 0xFFFFFFFF
    h = seed & mask
    for char in key:
        h ^= ord(char)
        h = (h * 16777619) & mask
    h ^= h >> 16
    h = (h * 0x7FEB352D) & mask
    h ^= h >> 15
    return h / 4_294_967_296


def mission_duration_ms(preview: DeliveryPreview) -> int:
    return int(clamp(round(preview.duration_seconds * 210), 8_000, 15_000))

"""SQLite-backed storage for game sessions.

Normalized tables (not one JSON blob) so rovers/orders/deliveries/log events
are each real rows, per the assignment's "structured storage" requirement.
Each call opens a short-lived connection — traffic for a single-player demo
backend never justifies a connection pool, and this sidesteps sqlite3's
thread-safety sharp edges entirely.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from typing import Any, Iterator

from game_api.calculations import DeliveryPreview
from game_api.catalog import create_orders, create_rovers

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    shift INTEGER NOT NULL,
    shift_ends_at TEXT NOT NULL,
    status TEXT NOT NULL,
    credits INTEGER NOT NULL,
    score INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rovers (
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    capacity_kg REAL NOT NULL,
    battery REAL NOT NULL,
    battery_max REAL NOT NULL,
    speed REAL NOT NULL,
    energy_per_km REAL NOT NULL,
    risk_protection REAL NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    reward INTEGER NOT NULL,
    urgency TEXT NOT NULL,
    cargo_risk REAL NOT NULL,
    status TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    description TEXT NOT NULL,
    demo_blocked INTEGER NOT NULL,
    PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    rover_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress REAL NOT NULL,
    started_at TEXT NOT NULL,
    completes_at TEXT NOT NULL,
    preview_json TEXT NOT NULL,
    result_roll REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    message TEXT NOT NULL,
    tone TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_session ON deliveries(session_id);
CREATE INDEX IF NOT EXISTS idx_logs_session_at ON logs(session_id, at);
"""


def _iso(value: datetime) -> str:
    return value.isoformat()


class SessionNotFound(RuntimeError):
    pass


class GameStore:
    def __init__(self, db_path: str) -> None:
        # No I/O here — mirrors KafkaEventProducer/AnalyticsReader, which
        # only touch the network/disk in .start(). Constructing a GameStore
        # (e.g. as a side effect of importing game_api.main) must not create
        # a database file; call init_schema() explicitly, as create_app()'s
        # lifespan does.
        self._db_path = db_path

    def init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # -- session lifecycle -------------------------------------------------

    def create_session(self, session_id: str, player_id: str, seed: int, now: datetime) -> None:
        from game_api.catalog import SHIFT_DURATION_MINUTES
        from datetime import timedelta

        shift_ends_at = now + timedelta(minutes=SHIFT_DURATION_MINUTES)
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO sessions
                   (session_id, player_id, seed, shift, shift_ends_at, status,
                    credits, score, rating, started_at, version)
                   VALUES (?, ?, ?, 1, ?, 'active', 820, 0, 94, ?, 1)""",
                (session_id, player_id, seed, _iso(shift_ends_at), _iso(now)),
            )
            self._seed_fleet_and_orders(conn, session_id, now, shift=1)
            self._insert_log(conn, session_id, now, "Смена принята. Лунная транспортная сеть готова.", "info")

    def restart_session(self, session_id: str, now: datetime, seed: int) -> None:
        from game_api.catalog import SHIFT_DURATION_MINUTES
        from datetime import timedelta

        shift_ends_at = now + timedelta(minutes=SHIFT_DURATION_MINUTES)
        with self._connect() as conn:
            conn.execute("DELETE FROM rovers WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM orders WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM deliveries WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM logs WHERE session_id = ?", (session_id,))
            conn.execute(
                """UPDATE sessions SET seed = ?, shift = 1, shift_ends_at = ?, status = 'active',
                   credits = 820, score = 0, rating = 94, started_at = ?, version = version + 1
                   WHERE session_id = ?""",
                (seed, _iso(shift_ends_at), _iso(now), session_id),
            )
            self._seed_fleet_and_orders(conn, session_id, now, shift=1)
            self._insert_log(conn, session_id, now, "Смена принята. Лунная транспортная сеть готова.", "info")

    def _seed_fleet_and_orders(self, conn: sqlite3.Connection, session_id: str, now: datetime, shift: int) -> None:
        for rover in create_rovers():
            conn.execute(
                """INSERT INTO rovers
                   (session_id, id, name, code, capacity_kg, battery, battery_max,
                    speed, energy_per_km, risk_protection, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id, rover["id"], rover["name"], rover["code"], rover["capacity_kg"],
                    rover["battery"], rover["battery_max"], rover["speed"], rover["energy_per_km"],
                    rover["risk_protection"], rover["status"],
                ),
            )
        self._insert_orders(conn, session_id, create_orders(now, shift))

    def _insert_orders(self, conn: sqlite3.Connection, session_id: str, orders: list[dict]) -> None:
        for order in orders:
            conn.execute(
                """INSERT INTO orders
                   (session_id, id, title, destination_id, weight_kg, reward, urgency,
                    cargo_risk, status, deadline_at, description, demo_blocked)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id, order["id"], order["title"], order["destination_id"], order["weight_kg"],
                    order["reward"], order["urgency"], order["cargo_risk"], order["status"],
                    _iso(order["deadline_at"]), order["description"], int(order["demo_blocked"]),
                ),
            )

    def add_shift_orders(self, session_id: str, now: datetime, shift: int) -> None:
        with self._connect() as conn:
            self._insert_orders(conn, session_id, create_orders(now, shift))

    def session_exists(self, session_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT 1 FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        return row is not None

    # -- reads ---------------------------------------------------------

    def get_state(self, session_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            session = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if session is None:
                raise SessionNotFound(session_id)

            rovers = conn.execute(
                "SELECT * FROM rovers WHERE session_id = ? ORDER BY id", (session_id,)
            ).fetchall()
            orders = conn.execute(
                "SELECT * FROM orders WHERE session_id = ? ORDER BY deadline_at", (session_id,)
            ).fetchall()
            deliveries = conn.execute(
                "SELECT * FROM deliveries WHERE session_id = ? ORDER BY started_at", (session_id,)
            ).fetchall()
            logs = conn.execute(
                "SELECT * FROM logs WHERE session_id = ? ORDER BY at DESC LIMIT 30", (session_id,)
            ).fetchall()

        return {
            "session_id": session["session_id"],
            "player_id": session["player_id"],
            "seed": session["seed"],
            "shift": session["shift"],
            "shift_ends_at": session["shift_ends_at"],
            "status": session["status"],
            "credits": session["credits"],
            "score": session["score"],
            "rating": session["rating"],
            "started_at": session["started_at"],
            "version": session["version"],
            "rovers": [
                {
                    "id": row["id"], "name": row["name"], "code": row["code"],
                    "capacity_kg": row["capacity_kg"], "battery": row["battery"],
                    "battery_max": row["battery_max"], "speed": row["speed"],
                    "energy_per_km": row["energy_per_km"], "risk_protection": row["risk_protection"],
                    "status": row["status"],
                }
                for row in rovers
            ],
            "orders": [
                {
                    "id": row["id"], "title": row["title"], "destination_id": row["destination_id"],
                    "weight_kg": row["weight_kg"], "reward": row["reward"], "urgency": row["urgency"],
                    "cargo_risk": row["cargo_risk"], "status": row["status"],
                    "deadline_at": row["deadline_at"], "description": row["description"],
                    "demo_blocked": bool(row["demo_blocked"]),
                }
                for row in orders
            ],
            "deliveries": [
                {
                    "id": row["id"], "order_id": row["order_id"], "rover_id": row["rover_id"],
                    "route_id": row["route_id"], "status": row["status"], "phase": row["phase"],
                    "progress": row["progress"], "started_at": row["started_at"],
                    "completes_at": row["completes_at"], "result_roll": row["result_roll"],
                    "preview": json.loads(row["preview_json"]),
                }
                for row in deliveries
            ],
            "logs": [
                {"id": row["id"], "at": row["at"], "message": row["message"], "tone": row["tone"]}
                for row in reversed(logs)
            ],
        }

    def get_order(self, session_id: str, order_id: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM orders WHERE session_id = ? AND id = ?", (session_id, order_id)
            ).fetchone()

    def get_rover(self, session_id: str, rover_id: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM rovers WHERE session_id = ? AND id = ?", (session_id, rover_id)
            ).fetchone()

    def get_session(self, session_id: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()

    def active_session_ids(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT session_id FROM sessions WHERE status = 'active'").fetchall()
        return [row["session_id"] for row in rows]

    # -- writes ----------------------------------------------------------

    def insert_delivery(
        self,
        session_id: str,
        delivery_id: str,
        order_id: str,
        rover_id: str,
        route_id: str,
        started_at: datetime,
        completes_at: datetime,
        preview: DeliveryPreview,
        result_roll: float,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO deliveries
                   (id, session_id, order_id, rover_id, route_id, status, phase, progress,
                    started_at, completes_at, preview_json, result_roll)
                   VALUES (?, ?, ?, ?, ?, 'active', 'outbound', 0, ?, ?, ?, ?)""",
                (
                    delivery_id, session_id, order_id, rover_id, route_id,
                    _iso(started_at), _iso(completes_at), json.dumps(asdict(preview)), result_roll,
                ),
            )
            conn.execute("UPDATE orders SET status = 'active' WHERE session_id = ? AND id = ?", (session_id, order_id))
            conn.execute("UPDATE rovers SET status = 'mission' WHERE session_id = ? AND id = ?", (session_id, rover_id))
            self._bump_version(conn, session_id)

    def set_delivery_progress(self, session_id: str, delivery_id: str, progress: float, phase: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE deliveries SET progress = ?, phase = ? WHERE id = ? AND session_id = ?",
                (progress, phase, delivery_id, session_id),
            )

    def finish_delivery(
        self,
        session_id: str,
        delivery_id: str,
        order_id: str,
        rover_id: str,
        succeeded: bool,
        energy_cost: int,
        reward: int,
        score_delta: int,
        rating_delta: int,
        credits_delta: int,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """UPDATE deliveries SET status = ?, phase = 'complete', progress = 1
                   WHERE id = ? AND session_id = ?""",
                ("succeeded" if succeeded else "failed", delivery_id, session_id),
            )
            conn.execute(
                "UPDATE orders SET status = ? WHERE session_id = ? AND id = ?",
                ("delivered" if succeeded else "failed", session_id, order_id),
            )
            conn.execute(
                "UPDATE rovers SET status = 'idle', battery = MAX(0, battery - ?) WHERE session_id = ? AND id = ?",
                (energy_cost, session_id, rover_id),
            )
            conn.execute(
                """UPDATE sessions SET
                       credits = MAX(0, credits + ?),
                       score = score + ?,
                       rating = MIN(100, MAX(0, rating + ?))
                   WHERE session_id = ?""",
                (credits_delta, score_delta, rating_delta, session_id),
            )
            self._bump_version(conn, session_id)

    def expire_order(self, session_id: str, order_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE orders SET status = 'expired' WHERE session_id = ? AND id = ?",
                (session_id, order_id),
            )
            conn.execute(
                "UPDATE sessions SET rating = MAX(0, rating - 1) WHERE session_id = ?", (session_id,)
            )
            self._bump_version(conn, session_id)

    def charge_rover(self, session_id: str, rover_id: str, battery_max: float) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE rovers SET battery = ? WHERE session_id = ? AND id = ?",
                (battery_max, session_id, rover_id),
            )
            conn.execute("UPDATE sessions SET credits = credits - 30 WHERE session_id = ?", (session_id,))
            self._bump_version(conn, session_id)

    def advance_shift(self, session_id: str, now: datetime, next_shift: int, shift_ends_at: datetime) -> None:
        with self._connect() as conn:
            # Every shift's order set (including a fresh 185 kg demo order) is
            # (re-)created by _insert_orders below, so retiring *all*
            # available orders here — demo ones included — is correct: the
            # rollover always repopulates the demo scenario for the new shift.
            conn.execute(
                "UPDATE orders SET status = 'expired' WHERE session_id = ? AND status = 'available'",
                (session_id,),
            )
            conn.execute(
                "UPDATE sessions SET shift = ?, shift_ends_at = ? WHERE session_id = ?",
                (next_shift, _iso(shift_ends_at), session_id),
            )
            self._insert_orders(conn, session_id, create_orders(now, next_shift))
            self._bump_version(conn, session_id)

    def set_status(self, session_id: str, status: str) -> None:
        with self._connect() as conn:
            conn.execute("UPDATE sessions SET status = ? WHERE session_id = ?", (status, session_id))
            self._bump_version(conn, session_id)

    def append_log(self, session_id: str, log_id: str, now: datetime, message: str, tone: str) -> None:
        with self._connect() as conn:
            self._insert_log(conn, session_id, now, message, tone, log_id=log_id)
            conn.execute(
                """DELETE FROM logs WHERE session_id = ? AND id NOT IN (
                       SELECT id FROM logs WHERE session_id = ? ORDER BY at DESC LIMIT 30
                   )""",
                (session_id, session_id),
            )

    def _insert_log(
        self, conn: sqlite3.Connection, session_id: str, at: datetime, message: str, tone: str, *, log_id: str | None = None
    ) -> None:
        import uuid

        conn.execute(
            "INSERT INTO logs (id, session_id, at, message, tone) VALUES (?, ?, ?, ?, ?)",
            (log_id or f"log-{uuid.uuid4().hex}", session_id, _iso(at), message, tone),
        )

    def _bump_version(self, conn: sqlite3.Connection, session_id: str) -> None:
        conn.execute("UPDATE sessions SET version = version + 1 WHERE session_id = ?", (session_id,))

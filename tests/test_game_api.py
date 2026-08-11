from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from game_api.main import create_app
from game_api.settings import Settings
from game_api.store import GameStore


@pytest.fixture
def db_path(tmp_path) -> str:
    # A real file, not ':memory:' — GameStore opens a fresh connection per
    # call, and SQLite's ':memory:' database only lives as long as the
    # connection that created it.
    return str(tmp_path / "game_api_test.db")


@pytest.fixture
def store(db_path: str) -> GameStore:
    return GameStore(db_path)


@pytest.fixture
def client(db_path: str, store: GameStore) -> TestClient:
    app = create_app(settings=Settings(db_path=db_path), store=store)
    with TestClient(app) as test_client:
        yield test_client


def create_session(client: TestClient) -> str:
    response = client.post("/api/game/sessions")
    assert response.status_code == 201
    return response.json()["session_id"]


def test_create_session_seeds_fleet_and_orders(client: TestClient) -> None:
    session_id = create_session(client)
    state = client.get(f"/api/game/sessions/{session_id}/state").json()

    assert state["status"] == "active"
    assert state["credits"] == 820
    assert {rover["id"] for rover in state["rovers"]} == {"rover-swift", "rover-titan", "rover-atlas"}
    assert any(order["id"] == "order-reactor" and order["weightKg"] == 185 for order in state["orders"])


def test_get_map_matches_frontend_shape(client: TestClient) -> None:
    game_map = client.get("/api/game/map").json()
    assert len(game_map["destinations"]) == 5
    assert len(game_map["routes"]) == 15  # 5 destinations x 3 route kinds
    assert all("controlPoints" in route for route in game_map["routes"])


def test_185kg_order_is_rejected_for_every_rover(client: TestClient) -> None:
    session_id = create_session(client)
    for rover_id in ("rover-swift", "rover-titan", "rover-atlas"):
        response = client.post(
            "/api/game/deliveries/preview",
            json={
                "sessionId": session_id,
                "orderId": "order-reactor",
                "roverId": rover_id,
                "routeId": "beacon-7-safe",
            },
        )
        preview = response.json()
        assert preview["feasible"] is False
        assert preview["reasonCode"] == "capacity_exceeded"
        assert "185" in preview["reason"]


def test_insufficient_battery_blocks_launch(client: TestClient, store: GameStore) -> None:
    session_id = create_session(client)
    with store._connect() as conn:
        conn.execute(
            "UPDATE rovers SET battery = 2 WHERE session_id = ? AND id = 'rover-swift'", (session_id,)
        )

    response = client.post(
        "/api/game/deliveries/preview",
        json={
            "sessionId": session_id,
            "orderId": "order-oxygen",
            "roverId": "rover-swift",
            "routeId": "aurora-safe",
        },
    )
    preview = response.json()
    assert preview["feasible"] is False
    assert preview["reasonCode"] == "insufficient_battery"


def test_start_delivery_locks_order_and_rover(client: TestClient) -> None:
    session_id = create_session(client)
    before = client.get(f"/api/game/sessions/{session_id}/state").json()

    response = client.post(
        "/api/game/deliveries",
        json={
            "sessionId": session_id,
            "orderId": "order-oxygen",
            "roverId": "rover-swift",
            "routeId": "aurora-safe",
            "stateVersion": before["version"],
        },
    )
    assert response.status_code == 201
    delivery = response.json()
    assert delivery["status"] == "active"

    state = client.get(f"/api/game/sessions/{session_id}/state").json()
    order = next(item for item in state["orders"] if item["id"] == "order-oxygen")
    rover = next(item for item in state["rovers"] if item["id"] == "rover-swift")
    assert order["status"] == "active"
    assert rover["status"] == "mission"


def test_stale_state_version_is_rejected(client: TestClient) -> None:
    session_id = create_session(client)
    response = client.post(
        "/api/game/deliveries",
        json={
            "sessionId": session_id,
            "orderId": "order-oxygen",
            "roverId": "rover-swift",
            "routeId": "aurora-safe",
            "stateVersion": 9999,
        },
    )
    assert response.status_code == 409


def test_delivery_resolves_and_updates_credits_battery_and_order_status(
    client: TestClient, store: GameStore
) -> None:
    session_id = create_session(client)
    before = client.get(f"/api/game/sessions/{session_id}/state").json()

    delivery = client.post(
        "/api/game/deliveries",
        json={
            "sessionId": session_id,
            "orderId": "order-oxygen",
            "roverId": "rover-swift",
            "routeId": "aurora-safe",
            "stateVersion": before["version"],
        },
    ).json()

    # Fast-forward the mission: push the whole [started_at, completes_at)
    # window into the past (preserving completes_at > started_at) so the next
    # state read resolves it, instead of sleeping for the real duration.
    now = datetime.now(UTC)
    with store._connect() as conn:
        conn.execute(
            "UPDATE deliveries SET started_at = ?, completes_at = ? WHERE id = ?",
            ((now - timedelta(seconds=100)).isoformat(), (now - timedelta(seconds=1)).isoformat(), delivery["id"]),
        )

    after = client.get(f"/api/game/sessions/{session_id}/state").json()
    order = next(item for item in after["orders"] if item["id"] == "order-oxygen")
    rover = next(item for item in after["rovers"] if item["id"] == "rover-swift")
    resolved_delivery = next(item for item in after["deliveries"] if item["id"] == delivery["id"])

    before_rover = next(item for item in before["rovers"] if item["id"] == "rover-swift")

    assert resolved_delivery["status"] in ("succeeded", "failed")
    assert order["status"] in ("delivered", "failed")
    assert rover["status"] == "idle"
    assert rover["battery"] == before_rover["battery"] - delivery["preview"]["energyCost"]
    if resolved_delivery["status"] == "succeeded":
        assert after["credits"] > before["credits"]
    else:
        assert after["credits"] == before["credits"] - 40


def test_charge_rover_costs_credits_and_restores_battery(client: TestClient, store: GameStore) -> None:
    session_id = create_session(client)
    with store._connect() as conn:
        conn.execute(
            "UPDATE rovers SET battery = 10 WHERE session_id = ? AND id = 'rover-swift'", (session_id,)
        )

    response = client.post(
        "/api/game/rovers/rover-swift/charge", json={"sessionId": session_id}
    )
    assert response.status_code == 200
    state = response.json()
    rover = next(item for item in state["rovers"] if item["id"] == "rover-swift")
    assert rover["battery"] == rover["batteryMax"]
    assert state["credits"] == 820 - 30


def test_restart_resets_shift_credits_and_orders(client: TestClient) -> None:
    session_id = create_session(client)
    client.post(
        "/api/game/deliveries",
        json={
            "sessionId": session_id,
            "orderId": "order-oxygen",
            "roverId": "rover-swift",
            "routeId": "aurora-safe",
            "stateVersion": 1,
        },
    )

    response = client.post(f"/api/game/sessions/{session_id}/restart")
    assert response.status_code == 200
    state = response.json()
    assert state["shift"] == 1
    assert state["credits"] == 820
    assert state["status"] == "active"
    assert all(order["status"] == "available" for order in state["orders"])
    assert all(rover["status"] == "idle" for rover in state["rovers"])


def test_unknown_session_returns_404(client: TestClient) -> None:
    response = client.get("/api/game/sessions/does-not-exist/state")
    assert response.status_code == 404


def test_two_fresh_sessions_can_both_launch_the_same_rover(client: TestClient) -> None:
    """Regression test: deliveries.id used to be derived only from
    (state_version, rover_id), e.g. "delivery-1-rover-swift" — unique within
    one session's own history, but deliveries.id is one global primary key
    shared by every session, so two brand-new sessions (both at version 1)
    launching the same rover produced the same id and the second INSERT
    raised sqlite3.IntegrityError, surfacing as a 500 to the player."""
    session_a = create_session(client)
    session_b = create_session(client)

    for session_id in (session_a, session_b):
        response = client.post(
            "/api/game/deliveries",
            json={
                "sessionId": session_id,
                "orderId": "order-oxygen",
                "roverId": "rover-swift",
                "routeId": "aurora-safe",
                "stateVersion": 1,
            },
        )
        assert response.status_code == 201, response.text

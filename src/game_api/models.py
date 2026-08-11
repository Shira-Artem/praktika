"""API schemas. Field names/aliases mirror frontend/src/types/game.ts exactly
(camelCase over the wire) so HttpGameClient.ts needs no translation layer."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(word.capitalize() for word in rest)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class Point(CamelModel):
    x: float
    y: float


class Destination(CamelModel):
    id: str
    name: str
    code: str
    subtitle: str
    position: Point


class TerrainZone(CamelModel):
    id: str
    name: str
    kind: str
    position: Point
    radius: Point
    rotation: float


class RouteOut(CamelModel):
    id: str
    destination_id: str
    kind: str
    name: str
    distance_km: float
    base_duration_seconds: float
    time_multiplier: float
    energy_multiplier: float
    base_risk: float
    hazards: list[str]
    control_points: list[Point]


class GameMap(CamelModel):
    destinations: list[Destination]
    zones: list[TerrainZone]
    routes: list[RouteOut]


class Order(CamelModel):
    id: str
    title: str
    destination_id: str
    weight_kg: float
    reward: int
    urgency: str
    cargo_risk: float
    status: str
    deadline_at: datetime
    description: str
    demo_blocked: bool = False


class Rover(CamelModel):
    id: str
    name: str
    code: str
    capacity_kg: float
    battery: float
    battery_max: float
    speed: float
    energy_per_km: float
    risk_protection: float
    status: str


class DeliveryPreviewOut(CamelModel):
    feasible: bool
    reason: str | None = None
    reason_code: str | None = None
    load_ratio: float
    energy_cost: int
    battery_after: float
    duration_seconds: int
    risk: float
    success_probability: float
    expected_reward: int
    warnings: list[str]


class Delivery(CamelModel):
    id: str
    order_id: str
    rover_id: str
    route_id: str
    status: str
    phase: str
    progress: float
    started_at: datetime
    completes_at: datetime
    preview: DeliveryPreviewOut
    result_roll: float


class MissionLogEntry(CamelModel):
    id: str
    at: datetime
    message: str
    tone: str


class GameState(CamelModel):
    session_id: str
    player_id: str
    seed: int
    shift: int
    shift_ends_at: datetime
    status: str
    credits: int
    score: int
    rating: int
    orders: list[Order]
    rovers: list[Rover]
    deliveries: list[Delivery]
    logs: list[MissionLogEntry]
    started_at: datetime
    version: int


class PreviewRequest(CamelModel):
    session_id: str
    order_id: str
    rover_id: str
    route_id: str
    state_version: int | None = None


class StartDeliveryRequest(CamelModel):
    session_id: str
    order_id: str
    rover_id: str
    route_id: str
    state_version: int


class ChargeRequest(CamelModel):
    session_id: str


class SessionResponse(BaseModel):
    # Deliberately snake_case, not camelCase: HttpGameClient.ts's
    # SessionResponse only recognizes `session_id` (or `id`) on this one
    # endpoint response.
    session_id: str

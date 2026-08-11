"""Static lunar map data.

Mirrors frontend/src/data/lunarMap.ts field-for-field. Both the mock
(in-browser) and live (this service) game clients render the same map, so the
two definitions must stay in sync: any change here needs the same change
there, and vice versa.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

RouteKind = str  # "safe" | "fast" | "economic"


@dataclass(frozen=True)
class Destination:
    id: str
    name: str
    code: str
    subtitle: str
    x: float
    y: float


@dataclass(frozen=True)
class TerrainZone:
    id: str
    name: str
    kind: str
    x: float
    y: float
    radius_x: float
    radius_y: float
    rotation: float


@dataclass(frozen=True)
class Route:
    id: str
    destination_id: str
    kind: RouteKind
    name: str
    distance_km: float
    base_duration_seconds: float
    time_multiplier: float
    energy_multiplier: float
    base_risk: float
    hazards: list[str]
    control_points: list[tuple[float, float]]


DESTINATIONS: list[Destination] = [
    Destination(id="aurora", name="Аврора", code="AU-03", subtitle="Научный модуль", x=390, y=245),
    Destination(id="kepler", name="Кеплер", code="KP-12", subtitle="Обсерватория", x=1200, y=218),
    Destination(id="helios", name="Гелиос", code="HL-08", subtitle="Энергокомплекс", x=1300, y=632),
    Destination(id="beacon-7", name="Маяк-7", code="MK-07", subtitle="Дальний ретранслятор", x=870, y=785),
    Destination(id="nox", name="Нокс", code="NX-21", subtitle="Теневая станция", x=250, y=650),
]

TERRAIN_ZONES: list[TerrainZone] = [
    TerrainZone(id="maria", name="РАВНИНА ТИШИНЫ", kind="plain", x=770, y=280, radius_x=310, radius_y=130, rotation=-0.08),
    TerrainZone(id="crater-field", name="КРАТЕРНЫЙ ПОЯС", kind="craters", x=1135, y=480, radius_x=250, radius_y=155, rotation=0.22),
    TerrainZone(id="ridge", name="ГРЯДА АРТЕМИДЫ", kind="ridge", x=520, y=590, radius_x=270, radius_y=85, rotation=-0.34),
    TerrainZone(id="dust-sea", name="ПЫЛЕВОЕ МОРЕ", kind="dust", x=1060, y=728, radius_x=260, radius_y=100, rotation=0.08),
    TerrainZone(id="dark-side", name="ТЕНЕВАЯ ЗОНА", kind="shadow", x=260, y=510, radius_x=180, radius_y=230, rotation=-0.18),
]

_ROUTE_META: dict[str, dict[str, float | tuple[float, float, float, float]]] = {
    "aurora": {"distance": 12, "duration": 26, "controls": (650, 330, 520, 220)},
    "kepler": {"distance": 18, "duration": 35, "controls": (920, 330, 1070, 210)},
    "helios": {"distance": 24, "duration": 44, "controls": (1000, 485, 1180, 575)},
    "beacon-7": {"distance": 28, "duration": 51, "controls": (740, 590, 820, 690)},
    "nox": {"distance": 22, "duration": 41, "controls": (610, 500, 420, 630)},
}


@dataclass(frozen=True)
class _RouteVariant:
    label: str
    distance: float
    time: float
    energy: float
    risk: float
    offset: float
    hazards: Callable[[str], list[str]]


_VARIANTS: dict[RouteKind, _RouteVariant] = {
    "safe": _RouteVariant(
        label="Безопасный", distance=1.18, time=1.12, energy=0.98, risk=0.04, offset=-42,
        hazards=lambda _destination_id: ["обход кратеров", "низкая видимость"],
    ),
    "fast": _RouteVariant(
        label="Быстрый", distance=0.88, time=0.76, energy=1.24, risk=0.16, offset=32,
        hazards=lambda destination_id: (
            ["теневая зона", "каменная гряда"] if destination_id == "nox" else ["кратеры", "пылевой шлейф"]
        ),
    ),
    "economic": _RouteVariant(
        label="Экономичный", distance=1.07, time=1.3, energy=0.76, risk=0.08, offset=68,
        hazards=lambda _destination_id: ["пылевое поле"],
    ),
}


def _build_routes() -> list[Route]:
    routes: list[Route] = []
    for destination in DESTINATIONS:
        meta = _ROUTE_META[destination.id]
        distance = float(meta["distance"])
        duration = float(meta["duration"])
        cx1, cy1, cx2, cy2 = meta["controls"]  # type: ignore[misc]
        for kind, variant in _VARIANTS.items():
            routes.append(
                Route(
                    id=f"{destination.id}-{kind}",
                    destination_id=destination.id,
                    kind=kind,
                    name=variant.label,
                    distance_km=round(distance * variant.distance * 10) / 10,
                    base_duration_seconds=duration,
                    time_multiplier=variant.time,
                    energy_multiplier=variant.energy,
                    base_risk=variant.risk,
                    hazards=variant.hazards(destination.id),
                    control_points=[
                        (cx1, cy1 + variant.offset),
                        (cx2, cy2 + variant.offset),
                    ],
                )
            )
    return routes


ROUTES: list[Route] = _build_routes()
_ROUTES_BY_ID: dict[str, Route] = {route.id: route for route in ROUTES}
_DESTINATIONS_BY_ID: dict[str, Destination] = {destination.id: destination for destination in DESTINATIONS}


def get_route(route_id: str) -> Route | None:
    return _ROUTES_BY_ID.get(route_id)


def get_destination(destination_id: str) -> Destination | None:
    return _DESTINATIONS_BY_ID.get(destination_id)


def routes_for_destination(destination_id: str) -> list[Route]:
    return [route for route in ROUTES if route.destination_id == destination_id]

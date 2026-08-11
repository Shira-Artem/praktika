"""Rover fleet and order catalog for a fresh session.

Mirrors frontend/src/data/mockData.ts so the live backend offers the same
mission set (including the mandatory 185 kg "impossible" order) as the
in-browser mock mode.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

SHIFT_DURATION_MINUTES = 18
TOTAL_SHIFTS = 3
EMERGENCY_BATTERY_RESERVE = 5


@dataclass(frozen=True)
class RoverBlueprint:
    id: str
    name: str
    code: str
    capacity_kg: float
    battery_max: float
    speed: float
    energy_per_km: float
    risk_protection: float


@dataclass(frozen=True)
class OrderBlueprint:
    id: str
    title: str
    destination_id: str
    weight_kg: float
    reward: int
    urgency: str
    cargo_risk: float
    deadline_minutes: float
    description: str
    demo_blocked: bool = False


ROVER_BLUEPRINTS: list[RoverBlueprint] = [
    RoverBlueprint(
        id="rover-swift", name="Стриж", code="RV-01", capacity_kg=35,
        battery_max=100, speed=1.25, energy_per_km=2.35, risk_protection=0.02,
    ),
    RoverBlueprint(
        id="rover-titan", name="Титан", code="RV-07", capacity_kg=95,
        battery_max=145, speed=0.9, energy_per_km=2.0, risk_protection=0.07,
    ),
    RoverBlueprint(
        id="rover-atlas", name="Атлас", code="RV-12", capacity_kg=160,
        battery_max=190, speed=0.7, energy_per_km=1.62, risk_protection=0.12,
    ),
]

_ORDER_BLUEPRINTS: list[OrderBlueprint] = [
    OrderBlueprint(
        id="order-oxygen", title="Кассеты кислородных фильтров", destination_id="aurora",
        weight_kg=24, reward=148, urgency="critical", cargo_risk=0.04, deadline_minutes=4.5,
        description="Система регенерации воздуха работает на резерве.",
    ),
    OrderBlueprint(
        id="order-gyros", title="Навигационные гироскопы", destination_id="beacon-7",
        weight_kg=55, reward=236, urgency="critical", cargo_risk=0.13, deadline_minutes=6.2,
        description="Хрупкая калибровочная сборка для дальнего маяка.",
    ),
    OrderBlueprint(
        id="order-water", title="Запас воды и пайков", destination_id="helios",
        weight_kg=88, reward=214, urgency="urgent", cargo_risk=0.03, deadline_minutes=9.5,
        description="Тяжёлый груз для ночной смены энергокомплекса.",
    ),
    OrderBlueprint(
        id="order-medicine", title="Медицинский криобокс", destination_id="nox",
        weight_kg=12, reward=172, urgency="urgent", cargo_risk=0.17, deadline_minutes=11,
        description="Чувствительный к ударам груз для теневой станции.",
    ),
    OrderBlueprint(
        id="order-relays", title="Солнечные релейные модули", destination_id="kepler",
        weight_kg=32, reward=126, urgency="standard", cargo_risk=0.06, deadline_minutes=14,
        description="Плановое обслуживание антенн обсерватории.",
    ),
    OrderBlueprint(
        id="order-samples", title="Геологические образцы", destination_id="aurora",
        weight_kg=18, reward=96, urgency="standard", cargo_risk=0.02, deadline_minutes=16,
        description="Контейнеры из кратерного пояса для лаборатории.",
    ),
    OrderBlueprint(
        id="order-reactor", title="Защитный контейнер реактора", destination_id="beacon-7",
        weight_kg=185, reward=480, urgency="standard", cargo_risk=0.2, deadline_minutes=18,
        description="Демонстрационный сверхтяжёлый груз: нужен четвёртый класс ровера.",
        demo_blocked=True,
    ),
]


def _order_id(blueprint_id: str, shift: int) -> str:
    return blueprint_id if shift == 1 else f"{blueprint_id}-s{shift}"


def create_orders(now: datetime, shift: int) -> list[dict]:
    """Fresh order rows for a shift. The 185 kg demo order is offered every
    shift (not just the first) so the mandatory impossible-delivery scenario
    stays reachable no matter when a reviewer opens the game."""
    orders = []
    for blueprint in _ORDER_BLUEPRINTS:
        orders.append(
            {
                "id": _order_id(blueprint.id, shift),
                "title": blueprint.title,
                "destination_id": blueprint.destination_id,
                "weight_kg": blueprint.weight_kg,
                "reward": blueprint.reward,
                "urgency": blueprint.urgency,
                "cargo_risk": blueprint.cargo_risk,
                "status": "available",
                "deadline_at": now + timedelta(minutes=blueprint.deadline_minutes),
                "description": blueprint.description,
                "demo_blocked": blueprint.demo_blocked,
            }
        )
    return orders


def create_rovers() -> list[dict]:
    return [
        {
            "id": blueprint.id,
            "name": blueprint.name,
            "code": blueprint.code,
            "capacity_kg": blueprint.capacity_kg,
            "battery": blueprint.battery_max,
            "battery_max": blueprint.battery_max,
            "speed": blueprint.speed,
            "energy_per_km": blueprint.energy_per_km,
            "risk_protection": blueprint.risk_protection,
            "status": "idle",
        }
        for blueprint in ROVER_BLUEPRINTS
    ]

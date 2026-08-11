from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from typing import Any

from event_generator.settings import Settings
from shared.ulid import new_ulid

# Каталог событий из методички преподавателя.
# Вес = насколько часто событие встречается в потоке (геймплей — часто, покупки — редко).
EVENT_TYPES: list[tuple[str, int]] = [
    ("session_start", 5),
    ("gameplay_start", 20),
    ("gameplay_win", 12),
    ("gameplay_lose", 8),
    ("gameplay_try_again", 6),
    ("gameplay_quit", 4),
    ("interstitial_ad_show", 10),
    ("rewarded_ad_show", 6),
    ("rewarded_ad_success", 5),
    ("rewarded_ad_was_closed", 2),
    ("hearts_recovered", 5),
    ("hearts_lost", 8),
    ("hearts_add_ads", 3),
    ("booster_buy", 3),
    ("booster_spend", 5),
    ("purchase_start", 2),
    ("purchase_success", 1),
    ("purchase_failed", 1),
]
_EVENT_NAMES = [name for name, _ in EVENT_TYPES]
_EVENT_WEIGHTS = [weight for _, weight in EVENT_TYPES]

PLATFORMS = ["android", "ios", "windows", "macos"]
COUNTRIES = ["RU", "US", "BR", "DE", "TR", "IN", "ID"]

BOOSTER_TYPES = ["bomb", "rocket", "hammer", "shuffle", "extra_moves"]
AD_PLACEMENTS = ["main_menu", "level_fail", "level_complete", "shop", "pause_menu"]
# product_id -> (цена, валюта по умолчанию)
PRODUCTS = {
    "no_ads": 4.99,
    "coins_small": 0.99,
    "coins_large": 9.99,
    "starter_bundle": 2.99,
    "hearts_refill": 1.99,
}
CURRENCIES = ["USD", "EUR", "RUB", "TRY", "BRL"]


def _hearts(rng: random.Random) -> int:
    # Классические 5 жизней в match-3.
    return rng.randint(0, 5)


def _coins(rng: random.Random) -> int:
    return rng.randint(0, 5000)


def generate_event(index: int, *, settings: Settings, rng: random.Random) -> dict[str, Any]:
    player_number = rng.randint(1, settings.players)
    session_number = index // max(settings.events_per_session, 1)
    event_type = rng.choices(_EVENT_NAMES, weights=_EVENT_WEIGHTS, k=1)[0]
    level = rng.randint(1, settings.max_level)
    event_time = datetime.now(UTC) - timedelta(seconds=rng.randint(0, settings.max_event_age_seconds))

    event = {
        "event_id": new_ulid(),
        "event_type": event_type,
        "event_time": event_time.isoformat(),
        "game_id": settings.game_id,
        "player_id": f"player_{player_number:05d}",
        "session_id": f"session_{player_number:05d}_{session_number:06d}",
        "platform": rng.choice(PLATFORMS),
        "app_version": settings.app_version,
        "country": rng.choice(COUNTRIES),
        "properties": _properties_for(event_type, level=level, rng=rng),
    }
    return event


def generate_batch(
    *,
    start_index: int,
    size: int,
    settings: Settings,
    rng: random.Random,
) -> list[dict[str, Any]]:
    return [
        generate_event(start_index + offset, settings=settings, rng=rng)
        for offset in range(size)
    ]


def _properties_for(event_type: str, *, level: int, rng: random.Random) -> dict[str, Any]:
    if event_type == "session_start":
        return {"is_prod": rng.random() < 0.9}

    # Геймплейные события несут прогресс игрока.
    if event_type in {"gameplay_start", "gameplay_win", "gameplay_lose", "gameplay_quit"}:
        return {"level": level, "hearts": _hearts(rng), "coins": _coins(rng)}

    if event_type == "gameplay_try_again":
        return {
            "level": level,
            "hearts": _hearts(rng),
            "coins": _coins(rng),
            "trying_count": rng.randint(1, 5),
        }

    if event_type == "interstitial_ad_show":
        return {
            "placement_id": rng.choice(AD_PLACEMENTS),
            "is_disable_ads": rng.random() < 0.1,
        }

    if event_type in {"rewarded_ad_show", "rewarded_ad_success", "rewarded_ad_was_closed"}:
        return {
            "placement_id": rng.choice(AD_PLACEMENTS),
            "hearts": _hearts(rng),
            "coins": _coins(rng),
        }

    if event_type == "hearts_recovered":
        return {
            "hearts": _hearts(rng),
            "added_hearts": rng.randint(1, 5),
            "on_load": rng.random() < 0.5,
        }

    if event_type == "hearts_lost":
        return {"hearts": _hearts(rng)}

    if event_type == "hearts_add_ads":
        return {"hearts": _hearts(rng)}

    if event_type == "booster_buy":
        return {
            "booster_type": rng.choice(BOOSTER_TYPES),
            "booster_price": rng.choice([50, 100, 200, 500]),
            "booster_count": rng.randint(1, 10),
            "coins": _coins(rng),
            "hearts": _hearts(rng),
        }

    if event_type == "booster_spend":
        return {
            "booster_type": rng.choice(BOOSTER_TYPES),
            "booster_count": rng.randint(0, 10),
            "coins": _coins(rng),
            "hearts": _hearts(rng),
        }

    if event_type == "purchase_start":
        return {"product_id": rng.choice(list(PRODUCTS))}

    if event_type == "purchase_success":
        product_id = rng.choice(list(PRODUCTS))
        return {
            "product_id": product_id,
            "product_price": PRODUCTS[product_id],
            "product_currency": rng.choice(CURRENCIES),
        }

    if event_type == "purchase_failed":
        return {"product_id": rng.choice(list(PRODUCTS))}

    return {}

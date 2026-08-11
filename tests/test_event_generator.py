from __future__ import annotations

import random

from event_generator.generator import generate_batch, generate_event
from event_generator.settings import Settings
from shared.models import GameEventIn


def test_generate_event_matches_shared_contract() -> None:
    settings = Settings(seed=1)
    event = generate_event(0, settings=settings, rng=random.Random(settings.seed))

    parsed = GameEventIn.model_validate(event)

    assert parsed.event_id is not None
    assert len(parsed.event_id) == 26
    assert parsed.game_id == "arena_escape"
    assert parsed.properties


def test_generate_batch_uses_requested_size() -> None:
    settings = Settings(seed=1)

    events = generate_batch(
        start_index=10,
        size=25,
        settings=settings,
        rng=random.Random(settings.seed),
    )

    assert len(events) == 25
    assert len({event["event_id"] for event in events}) == 25


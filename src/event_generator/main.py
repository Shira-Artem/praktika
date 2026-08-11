from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request

from event_generator.generator import generate_batch
from event_generator.settings import Settings


def post_batch(settings: Settings, events: list[dict]) -> dict:
    url = f"{settings.event_api_url.rstrip('/')}/events/batch"
    body = json.dumps({"events": events}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=settings.request_timeout_seconds) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def post_batch_with_retry(settings: Settings, events: list[dict]) -> dict:
    last_error: Exception | None = None

    for attempt in range(settings.max_retries + 1):
        try:
            return post_batch(settings, events)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt >= settings.max_retries:
                break
            time.sleep(settings.retry_backoff_seconds * (attempt + 1))

    raise RuntimeError(f"failed to post event batch: {last_error}") from last_error


def run(settings: Settings | None = None) -> None:
    settings = settings or Settings()
    rng = random.Random(settings.seed)
    sent = 0

    while sent < settings.total_events:
        size = min(settings.batch_size, settings.total_events - sent)
        events = generate_batch(start_index=sent, size=size, settings=settings, rng=rng)
        result = post_batch_with_retry(settings, events)
        sent += result["accepted"]
        print(f"sent={sent}/{settings.total_events}")

        if settings.request_delay_seconds > 0 and sent < settings.total_events:
            time.sleep(settings.request_delay_seconds)


if __name__ == "__main__":
    run()


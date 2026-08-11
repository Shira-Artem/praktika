from __future__ import annotations

import asyncio
import json
import logging
import signal

from pydantic import ValidationError

from event_processor.clickhouse import ClickHouseEventWriter, ClickHouseUnavailable
from event_processor.settings import Settings
from shared.logging import configure_logging
from shared.models import EnrichedGameEvent

logger = logging.getLogger(__name__)


def parse_event_payload(payload: bytes) -> EnrichedGameEvent:
    raw_event = json.loads(payload.decode("utf-8"))
    return EnrichedGameEvent.model_validate(raw_event)


async def run(
    settings: Settings | None = None,
    *,
    stop_event: asyncio.Event | None = None,
    install_signal_handlers: bool = True,
) -> None:
    settings = settings or Settings()
    configure_logging(settings.log_level)

    from aiokafka import AIOKafkaConsumer

    consumer = AIOKafkaConsumer(
        settings.kafka_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.kafka_group_id,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    stop_event = stop_event or asyncio.Event()
    writer = ClickHouseEventWriter(settings, should_stop=stop_event.is_set)

    if install_signal_handlers:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_event.set)
            except NotImplementedError:
                signal.signal(sig, lambda *_: stop_event.set())

    writer.start()
    await consumer.start()
    logger.info("event processor started")

    try:
        while not stop_event.is_set():
            messages_by_partition = await consumer.getmany(
                timeout_ms=int(settings.batch_flush_interval_seconds * 1000),
                max_records=settings.batch_size,
            )
            messages = [
                message
                for partition_messages in messages_by_partition.values()
                for message in partition_messages
            ]

            if not messages:
                continue

            events: list[EnrichedGameEvent] = []
            for message in messages:
                try:
                    events.append(parse_event_payload(message.value))
                except (json.JSONDecodeError, ValidationError) as exc:
                    logger.warning(
                        "invalid event skipped",
                        extra={
                            "topic": message.topic,
                            "partition": message.partition,
                            "offset": message.offset,
                            "error": str(exc),
                        },
                    )

            if events:
                try:
                    await writer.insert_events(events)
                except ClickHouseUnavailable as exc:
                    # Offset stays uncommitted on purpose: the batch will be
                    # re-read after restart instead of being silently dropped.
                    logger.error(
                        "clickhouse unavailable, batch not committed",
                        extra={"count": len(events), "error": str(exc)},
                    )
                    raise
                logger.info("events inserted", extra={"count": len(events)})

            await consumer.commit()
    finally:
        await consumer.stop()
        writer.close()
        logger.info("event processor stopped")


if __name__ == "__main__":
    asyncio.run(run())

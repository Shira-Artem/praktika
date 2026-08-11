from __future__ import annotations

from typing import Protocol

from event_api.settings import Settings
from shared.models import EnrichedGameEvent, serialize_event


class BrokerUnavailable(RuntimeError):
    """Raised when the API cannot get a broker ack for an event."""


class EventProducer(Protocol):
    async def start(self) -> None:
        ...

    async def stop(self) -> None:
        ...

    async def send_event(self, event: EnrichedGameEvent) -> None:
        ...

    async def send_events(self, events: list[EnrichedGameEvent]) -> None:
        ...


class KafkaEventProducer:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._producer = None

    async def start(self) -> None:
        from aiokafka import AIOKafkaProducer

        self._producer = AIOKafkaProducer(
            bootstrap_servers=self._settings.kafka_bootstrap_servers,
            acks="all",
            request_timeout_ms=int(self._settings.request_timeout_seconds * 1000),
            key_serializer=lambda key: key.encode("utf-8"),
            value_serializer=serialize_event,
        )
        await self._producer.start()

    async def stop(self) -> None:
        if self._producer is not None:
            await self._producer.stop()

    async def send_event(self, event: EnrichedGameEvent) -> None:
        if self._producer is None:
            raise BrokerUnavailable("producer is not started")

        try:
            await self._producer.send_and_wait(
                self._settings.kafka_topic,
                event,
                key=event.player_id,
            )
        except Exception as exc:  # aiokafka wraps transport failures in several exception types.
            raise BrokerUnavailable(str(exc)) from exc

    async def send_events(self, events: list[EnrichedGameEvent]) -> None:
        for event in events:
            await self.send_event(event)


class InMemoryEventProducer:
    def __init__(self) -> None:
        self.events: list[EnrichedGameEvent] = []

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def send_event(self, event: EnrichedGameEvent) -> None:
        self.events.append(event)

    async def send_events(self, events: list[EnrichedGameEvent]) -> None:
        self.events.extend(events)


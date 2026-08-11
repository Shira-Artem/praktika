from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from event_api.producer import BrokerUnavailable, EventProducer, KafkaEventProducer
from event_api.settings import Settings
from shared.logging import configure_logging
from shared.models import GameEventIn, normalize_event

logger = logging.getLogger(__name__)


class BatchRequest(BaseModel):
    events: list[dict[str, Any]] = Field(..., min_length=1)


def create_app(
    *,
    settings: Settings | None = None,
    producer: EventProducer | None = None,
) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    producer = producer or KafkaEventProducer(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.producer = producer
        await producer.start()
        try:
            yield
        finally:
            await producer.stop()

    app = FastAPI(
        title="Game Analytics Event API",
        version="0.1.0",
        description="Accepts game events and writes them to Redpanda/Kafka with acks=all.",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "event-api"}

    @app.post("/events", status_code=status.HTTP_202_ACCEPTED)
    async def ingest_event(payload: GameEventIn) -> dict[str, str]:
        try:
            event = normalize_event(payload)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[{"loc": ["body", "event_time"], "msg": str(exc), "type": "value_error"}],
            ) from exc

        try:
            await app.state.producer.send_event(event)
        except BrokerUnavailable as exc:
            logger.warning("broker unavailable while accepting event", exc_info=exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="message broker unavailable",
            ) from exc

        return {"status": "accepted", "event_id": event.event_id}

    @app.post("/events/batch", status_code=status.HTTP_202_ACCEPTED)
    async def ingest_events_batch(payload: BatchRequest) -> dict[str, Any]:
        if len(payload.events) > settings.max_batch_size:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"batch size must be <= {settings.max_batch_size}",
            )

        events = []
        errors = []

        for index, raw_event in enumerate(payload.events):
            try:
                parsed = GameEventIn.model_validate(raw_event)
                events.append(normalize_event(parsed))
            except ValidationError as exc:
                errors.append({"index": index, "errors": exc.errors(include_context=False)})
            except ValueError as exc:
                errors.append(
                    {
                        "index": index,
                        "errors": [
                            {
                                "loc": ["event_time"],
                                "msg": str(exc),
                                "type": "value_error",
                            }
                        ],
                    }
                )

        if errors:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"errors": errors},
            )

        try:
            await app.state.producer.send_events(events)
        except BrokerUnavailable as exc:
            logger.warning("broker unavailable while accepting batch", exc_info=exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="message broker unavailable",
            ) from exc

        return {
            "status": "accepted",
            "accepted": len(events),
            "event_ids": [event.event_id for event in events],
        }

    return app


app = create_app()


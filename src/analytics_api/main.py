from __future__ import annotations

from contextlib import asynccontextmanager
from importlib import resources
from typing import Any

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.responses import HTMLResponse

from analytics_api.clickhouse import AnalyticsReader, parse_steps
from analytics_api.settings import Settings
from shared.logging import configure_logging


def _load_dashboard_html() -> str:
    return resources.files("analytics_api").joinpath("static/dashboard.html").read_text(
        encoding="utf-8"
    )


def create_app(*, settings: Settings | None = None, reader: AnalyticsReader | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    reader = reader or AnalyticsReader(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.reader = reader
        reader.start()
        try:
            yield
        finally:
            reader.close()

    app = FastAPI(
        title="Game Analytics API",
        version="0.1.0",
        description="Reads aggregated game analytics metrics from ClickHouse.",
        lifespan=lifespan,
    )

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def dashboard() -> str:
        return _load_dashboard_html()

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "analytics-api"}

    @app.get("/metrics/summary")
    async def summary(
        since_hours: int = Query(default=24, ge=1, le=24 * 90),
    ) -> dict[str, Any]:
        return await app.state.reader.summary(since_hours=since_hours)

    @app.get("/metrics/event-types")
    async def event_types(
        since_hours: int = Query(default=24, ge=1, le=24 * 90),
        limit: int = Query(default=10, ge=1, le=100),
    ) -> list[dict[str, Any]]:
        return await app.state.reader.event_types(since_hours=since_hours, limit=limit)

    @app.get("/metrics/recent-events")
    async def recent_events(
        limit: int = Query(default=20, ge=1, le=100),
    ) -> list[dict[str, Any]]:
        return await app.state.reader.recent_events(limit=limit)

    @app.get("/metrics/funnel")
    async def funnel(
        steps: str = Query(default="gameplay_start,gameplay_win"),
        since_hours: int = Query(default=24, ge=1, le=24 * 90),
    ) -> list[dict[str, Any]]:
        try:
            parsed_steps = parse_steps(steps)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        return await app.state.reader.funnel(steps=parsed_steps, since_hours=since_hours)

    return app


app = create_app()


from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from game_api import map_data, models
from game_api.engine import Engine, GameError
from game_api.settings import Settings
from game_api.store import GameStore
from shared.logging import configure_logging

logger = logging.getLogger(__name__)


def _build_game_map() -> models.GameMap:
    destinations = [
        models.Destination(
            id=d.id, name=d.name, code=d.code, subtitle=d.subtitle,
            position=models.Point(x=d.x, y=d.y),
        )
        for d in map_data.DESTINATIONS
    ]
    zones = [
        models.TerrainZone(
            id=z.id, name=z.name, kind=z.kind,
            position=models.Point(x=z.x, y=z.y),
            radius=models.Point(x=z.radius_x, y=z.radius_y),
            rotation=z.rotation,
        )
        for z in map_data.TERRAIN_ZONES
    ]
    routes = [
        models.RouteOut(
            id=r.id, destination_id=r.destination_id, kind=r.kind, name=r.name,
            distance_km=r.distance_km, base_duration_seconds=r.base_duration_seconds,
            time_multiplier=r.time_multiplier, energy_multiplier=r.energy_multiplier,
            base_risk=r.base_risk, hazards=r.hazards,
            control_points=[models.Point(x=x, y=y) for x, y in r.control_points],
        )
        for r in map_data.ROUTES
    ]
    return models.GameMap(destinations=destinations, zones=zones, routes=routes)


_GAME_MAP = _build_game_map()


def _preview_model(preview) -> models.DeliveryPreviewOut:
    return models.DeliveryPreviewOut(**asdict(preview))


def _game_error_to_http(exc: GameError) -> HTTPException:
    code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_409_CONFLICT
    return HTTPException(status_code=code, detail=str(exc))


def create_app(*, settings: Settings | None = None, store: GameStore | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    store = store or GameStore(settings.db_path)
    engine = Engine(store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.store = store
        app.state.engine = engine
        await asyncio.to_thread(store.init_schema)
        yield

    app = FastAPI(
        title="Lunar Dispatch Game API",
        version="0.1.0",
        description="Server-authoritative game state: rovers, orders and deliveries live here, not in the browser.",
        lifespan=lifespan,
    )
    # No cookies/auth on this API, so a permissive origin list carries no
    # credential-leak risk. Needed because the default frontend/.env.example
    # points VITE_GAME_API_URL straight at this service's own port (8020) for
    # `npm run dev`, which is a different origin than the Vite dev server.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "game-api"}

    @app.post("/api/game/sessions", status_code=status.HTTP_201_CREATED)
    async def create_session() -> models.SessionResponse:
        session_id = await asyncio.to_thread(engine.create_session)
        return models.SessionResponse(session_id=session_id)

    @app.get("/api/game/map")
    async def get_map() -> models.GameMap:
        return _GAME_MAP

    @app.get("/api/game/sessions/{session_id}/state")
    async def get_state(session_id: str) -> models.GameState:
        try:
            state = await asyncio.to_thread(engine.get_state, session_id)
        except GameError as exc:
            raise _game_error_to_http(exc) from exc
        return models.GameState(**state)

    @app.post("/api/game/deliveries/preview")
    async def preview_delivery(payload: models.PreviewRequest) -> models.DeliveryPreviewOut:
        try:
            preview = await asyncio.to_thread(
                engine.preview, payload.session_id, payload.order_id, payload.rover_id, payload.route_id
            )
        except GameError as exc:
            raise _game_error_to_http(exc) from exc
        return _preview_model(preview)

    @app.post("/api/game/deliveries", status_code=status.HTTP_201_CREATED)
    async def start_delivery(payload: models.StartDeliveryRequest) -> models.Delivery:
        try:
            delivery = await asyncio.to_thread(
                engine.start_delivery,
                payload.session_id,
                payload.order_id,
                payload.rover_id,
                payload.route_id,
                payload.state_version,
            )
        except GameError as exc:
            raise _game_error_to_http(exc) from exc
        return models.Delivery(
            id=delivery["id"],
            order_id=delivery["order_id"],
            rover_id=delivery["rover_id"],
            route_id=delivery["route_id"],
            status=delivery["status"],
            phase=delivery["phase"],
            progress=delivery["progress"],
            started_at=delivery["started_at"],
            completes_at=delivery["completes_at"],
            preview=_preview_model(delivery["preview"]),
            result_roll=delivery["result_roll"],
        )

    @app.post("/api/game/rovers/{rover_id}/charge")
    async def charge_rover(rover_id: str, payload: models.ChargeRequest) -> models.GameState:
        try:
            await asyncio.to_thread(engine.charge_rover, payload.session_id, rover_id)
            state = await asyncio.to_thread(engine.get_state, payload.session_id)
        except GameError as exc:
            raise _game_error_to_http(exc) from exc
        return models.GameState(**state)

    @app.post("/api/game/sessions/{session_id}/restart")
    async def restart_session(session_id: str) -> models.GameState:
        try:
            await asyncio.to_thread(engine.restart_session, session_id)
            state = await asyncio.to_thread(engine.get_state, session_id)
        except GameError as exc:
            raise _game_error_to_http(exc) from exc
        return models.GameState(**state)

    @app.websocket("/ws/game/{session_id}")
    async def game_socket(websocket: WebSocket, session_id: str) -> None:
        await websocket.accept()
        try:
            while True:
                try:
                    state = await asyncio.to_thread(engine.get_state, session_id)
                except GameError:
                    await websocket.close(code=4404, reason="session not found")
                    return
                await websocket.send_text(models.GameState(**state).model_dump_json(by_alias=True))
                await asyncio.sleep(settings.tick_interval_seconds)
        except WebSocketDisconnect:
            logger.debug("game socket disconnected", extra={"session_id": session_id})

    return app


app = create_app()

import type { ApiMode } from "../types/game";
import type { GameClient } from "./GameClient";
import { HttpGameClient } from "./HttpGameClient";
import { MockGameClient } from "./MockGameClient";
import { TelemetryClient } from "./TelemetryClient";

export const apiMode: ApiMode = import.meta.env.VITE_GAME_API_MODE === "live" ? "live" : "mock";

export const gameClient: GameClient =
  apiMode === "live"
    ? new HttpGameClient(import.meta.env.VITE_GAME_API_URL ?? "http://localhost:8020")
    : new MockGameClient();

export const telemetryClient = new TelemetryClient(import.meta.env.VITE_EVENT_API_URL);

import type {
  Delivery,
  DeliveryPreview,
  GameMap,
  GameState,
  PreviewInput,
  StartDeliveryInput,
} from "../types/game";
import { GameClientError, type GameClient, type GameStateListener } from "./GameClient";

interface SessionResponse {
  id?: string;
  session_id?: string;
}

const SESSION_STORAGE_KEY = "lunar-dispatch.live-session.v1";

export class HttpGameClient implements GameClient {
  readonly mode = "live" as const;

  private sessionId: string | null = null;
  private state: GameState | null = null;
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<GameStateListener>();

  constructor(private readonly baseUrl: string) {}

  async initialize(): Promise<GameState> {
    const storedSessionId = this.readStoredSessionId();
    if (storedSessionId) {
      this.sessionId = storedSessionId;
      try {
        const state = await this.getState();
        this.connectSocket();
        return state;
      } catch {
        // Session unknown to the server (fresh DB, expired demo, etc.) — fall
        // through and start a new one instead of failing initialize().
        this.sessionId = null;
      }
    }

    const session = await this.request<SessionResponse>("/api/game/sessions", {
      method: "POST",
    });
    this.sessionId = session.session_id ?? session.id ?? null;
    if (!this.sessionId) throw new GameClientError("Game API не вернул идентификатор сессии.", "invalid_response");
    this.persistSessionId(this.sessionId);
    const state = await this.getState();
    this.connectSocket();
    return state;
  }

  private readStoredSessionId(): string | null {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private persistSessionId(sessionId: string): void {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch {
      // Storage can be disabled; live mode still works, just without resume-on-reload.
    }
  }

  getMap(): Promise<GameMap> {
    return this.request<GameMap>("/api/game/map");
  }

  async getState(): Promise<GameState> {
    const sessionId = this.requireSession();
    this.state = await this.request<GameState>(`/api/game/sessions/${sessionId}/state`);
    this.emit();
    return structuredClone(this.state);
  }

  previewDelivery(input: PreviewInput): Promise<DeliveryPreview> {
    return this.request<DeliveryPreview>("/api/game/deliveries/preview", {
      method: "POST",
      body: JSON.stringify({
        session_id: this.requireSession(),
        order_id: input.orderId,
        rover_id: input.roverId,
        route_id: input.routeId,
        state_version: this.state?.version,
      }),
    });
  }

  async startDelivery(input: StartDeliveryInput): Promise<Delivery> {
    return this.request<Delivery>("/api/game/deliveries", {
      method: "POST",
      body: JSON.stringify({
        session_id: this.requireSession(),
        order_id: input.orderId,
        rover_id: input.roverId,
        route_id: input.routeId,
        state_version: input.stateVersion,
      }),
    });
  }

  async chargeRover(roverId: string): Promise<GameState> {
    this.state = await this.request<GameState>(`/api/game/rovers/${roverId}/charge`, {
      method: "POST",
      body: JSON.stringify({ session_id: this.requireSession() }),
    });
    this.emit();
    return structuredClone(this.state);
  }

  async reset(): Promise<GameState> {
    this.state = await this.request<GameState>(
      `/api/game/sessions/${this.requireSession()}/restart`,
      { method: "POST" },
    );
    this.emit();
    return structuredClone(this.state);
  }

  subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    if (this.state) listener(structuredClone(this.state));
    return () => this.listeners.delete(listener);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } catch {
      throw new GameClientError("Game API недоступен. Переключитесь в mock-режим.", "network_error");
    }
    if (!response.ok) {
      let message = `Game API вернул ${response.status}.`;
      try {
        const error = (await response.json()) as { detail?: string };
        if (error.detail) message = error.detail;
      } catch {
        // Use the HTTP status message.
      }
      throw new GameClientError(message, `http_${response.status}`);
    }
    return (await response.json()) as T;
  }

  private requireSession(): string {
    if (!this.sessionId) throw new GameClientError("Live-сессия не создана.", "not_initialized");
    return this.sessionId;
  }

  private connectSocket(): void {
    const httpUrl = new URL(this.baseUrl, window.location.origin);
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    httpUrl.pathname = `/ws/game/${this.requireSession()}`;
    this.socket?.close();
    this.socket = new WebSocket(httpUrl);
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; state?: GameState } & GameState;
        const nextState = message.state ?? (message.sessionId ? message : undefined);
        if (nextState) {
          this.state = nextState;
          this.emit();
        }
      } catch {
        void this.getState();
      }
    });
    this.socket.addEventListener("close", () => {
      window.setTimeout(() => void this.getState().then(() => this.connectSocket()).catch(() => undefined), 2500);
    });
  }

  private emit(): void {
    if (!this.state) return;
    const snapshot = structuredClone(this.state);
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

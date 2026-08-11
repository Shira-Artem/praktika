export type TelemetryEventType =
  | "game_started"
  | "shift_started"
  | "order_selected"
  | "rover_selected"
  | "route_selected"
  | "delivery_previewed"
  | "delivery_rejected"
  | "delivery_started"
  | "delivery_completed"
  | "delivery_failed"
  | "game_completed"
  | "game_reset";

interface TelemetryContext {
  playerId: string;
  sessionId: string;
}

interface StoredTelemetryEvent {
  event_type: TelemetryEventType;
  event_time: string;
  game_id: "lunar_dispatch";
  player_id: string;
  session_id: string;
  platform: "web";
  app_version: "1.0.0";
  properties: Record<string, unknown>;
}

const QUEUE_KEY = "lunar-dispatch.telemetry.v1";

export class TelemetryClient {
  private context: TelemetryContext | null = null;

  constructor(private readonly endpoint?: string) {}

  setContext(context: TelemetryContext): void {
    this.context = context;
  }

  async track(type: TelemetryEventType, properties: Record<string, unknown> = {}): Promise<void> {
    if (!this.context) return;
    const event: StoredTelemetryEvent = {
      event_type: type,
      event_time: new Date().toISOString(),
      game_id: "lunar_dispatch",
      player_id: this.context.playerId,
      session_id: this.context.sessionId,
      platform: "web",
      app_version: "1.0.0",
      properties,
    };

    if (!this.endpoint) {
      this.enqueue(event);
      return;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      });
      if (!response.ok) this.enqueue(event);
    } catch {
      this.enqueue(event);
    }
  }

  private enqueue(event: StoredTelemetryEvent): void {
    try {
      const current = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as StoredTelemetryEvent[];
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...current.slice(-99), event]));
    } catch {
      // Telemetry is best-effort and never blocks gameplay.
    }
  }
}

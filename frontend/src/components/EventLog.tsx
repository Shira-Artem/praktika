import type { Delivery, MissionLogEntry } from "../types/game";

interface EventLogProps {
  logs: MissionLogEntry[];
  activeDeliveries: Delivery[];
}

export function EventLog({ logs, activeDeliveries }: EventLogProps) {
  const visible = logs.slice(-4).reverse();
  return (
    <footer className="event-log" aria-label="Журнал событий" aria-live="polite">
      <div className="event-log__label">
        <span className="live-dot" />
        Журнал
      </div>
      <div className="event-log__stream">
        {visible.map((entry) => (
          <span key={entry.id} className={`log-entry log-entry--${entry.tone}`}>
            <time>{new Date(entry.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            {entry.message}
          </span>
        ))}
      </div>
      <div className="missions-counter">
        <strong>{activeDeliveries.length}</strong>
        <span>активных<br />миссий</span>
      </div>
    </footer>
  );
}

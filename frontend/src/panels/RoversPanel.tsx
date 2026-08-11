import { roverCardArt } from "../game/assets";
import type { DeliveryPreview, GameState, Order, Rover } from "../types/game";

interface RoversPanelProps {
  game: GameState;
  selectedOrderId: string | null;
  selectedRoverId: string | null;
  previews: Record<string, DeliveryPreview>;
  onSelect: (id: string) => void;
  onCharge: (id: string) => void;
}

interface Compatibility {
  allowed: boolean;
  status: string;
  detail: string;
}

function getCompatibility(rover: Rover, order?: Order): Compatibility {
  if (rover.status !== "idle") return { allowed: false, status: "В рейсе", detail: "Управление по активному маршруту" };
  if (!order) return { allowed: false, status: "Готов", detail: "Сначала выберите заказ справа" };
  if (order.status !== "available") return { allowed: false, status: "Недоступен", detail: "Заказ уже назначен или закрыт" };
  if (order.weightKg > rover.capacityKg) {
    return { allowed: false, status: "Несовместим", detail: `Груз ${order.weightKg} кг · максимум ${rover.capacityKg} кг` };
  }
  const load = Math.round((order.weightKg / rover.capacityKg) * 100);
  return {
    allowed: true,
    status: load >= 90 ? "Предельная загрузка" : "Совместим",
    detail: `${order.weightKg} / ${rover.capacityKg} кг · загрузка ${load}%`,
  };
}

function RoverCard({
  rover,
  game,
  order,
  selected,
  previews,
  onSelect,
  onCharge,
}: {
  rover: Rover;
  game: GameState;
  order?: Order;
  selected: boolean;
  previews: Record<string, DeliveryPreview>;
  onSelect: () => void;
  onCharge: () => void;
}) {
  const activeDelivery = game.deliveries.find(
    (delivery) => delivery.roverId === rover.id && delivery.status === "active",
  );
  const activeOrder = activeDelivery
    ? game.orders.find((item) => item.id === activeDelivery.orderId)
    : undefined;
  const compatibility = getCompatibility(rover, order);
  const previewValues = Object.values(previews);
  const noEnergy = selected && previewValues.length > 0 && previewValues.every((preview) => preview.reasonCode === "insufficient_battery");
  const allowed = compatibility.allowed && !noEnergy;
  const batteryPercent = (rover.battery / rover.batteryMax) * 100;
  const load = activeOrder?.weightKg ?? order?.weightKg ?? 0;
  const status = activeDelivery
    ? activeDelivery.phase === "outbound" ? "В пути" : "Возвращается"
    : compatibility.status;

  return (
    <article className={`fleet-card ${selected ? "is-selected" : ""} ${allowed ? "is-compatible" : "is-disabled"} ${activeDelivery ? "is-active" : ""}`}>
      <button
        type="button"
        className="fleet-card__select"
        onClick={onSelect}
        disabled={!allowed}
        aria-pressed={selected}
        aria-describedby={`rover-${rover.id}-reason`}
      >
        <span className="fleet-card__visual">
          <img src={roverCardArt[rover.id]} alt="" />
          <span className="fleet-card__identity"><small>{rover.code}</small><strong>{rover.name}</strong></span>
          <span className={`fleet-status ${activeDelivery ? "fleet-status--active" : allowed ? "fleet-status--ready" : "fleet-status--muted"}`}>{status}</span>
        </span>

        <span className="fleet-card__battery">
          <span><small>Заряд</small><strong>{Math.round(batteryPercent)}%</strong></span>
          <span className="battery-track"><i style={{ width: `${batteryPercent}%` }} /></span>
          <b>{rover.battery} / {rover.batteryMax}</b>
        </span>

        <span className="fleet-card__load">
          <span><small>Загрузка</small><strong>{load} / {rover.capacityKg} кг</strong></span>
          <span><small>Скорость</small><strong>×{rover.speed.toFixed(2)}</strong></span>
          <span><small>Защита</small><strong>{Math.round(rover.riskProtection * 100)}%</strong></span>
        </span>

        {activeDelivery && (
          <span className="fleet-card__mission">
            <span><i style={{ width: `${activeDelivery.progress * 100}%` }} /></span>
            <b>{Math.round(activeDelivery.progress * 100)}%</b>
          </span>
        )}

        <span id={`rover-${rover.id}-reason`} className={`fleet-card__compatibility ${allowed ? "is-ok" : "is-no"}`}>
          <i aria-hidden="true" /> {noEnergy ? "Недостаточно заряда для возврата" : compatibility.detail}
        </span>
      </button>

      {rover.status === "idle" && rover.battery < rover.batteryMax && (
        <button className="charge-button" type="button" onClick={onCharge}>Зарядить · 30 кр.</button>
      )}
    </article>
  );
}

export function RoversPanel({ game, selectedOrderId, selectedRoverId, previews, onSelect, onCharge }: RoversPanelProps) {
  const order = game.orders.find((item) => item.id === selectedOrderId);
  const activeCount = game.rovers.filter((rover) => rover.status === "mission").length;
  return (
    <aside className="fleet-panel glass-panel" aria-labelledby="rovers-heading">
      <header className="fleet-heading">
        <div><span className="eyebrow">База Селена</span><h2 id="rovers-heading">Флот роверов</h2></div>
        <span>03</span>
      </header>
      <p className="fleet-guidance">
        {order ? `Груз ${order.weightKg} кг · выберите совместимую машину` : activeCount > 0 ? `${activeCount} в рейсе · можно запустить ещё одну миссию` : "Выберите заказ справа — совместимость появится здесь"}
      </p>
      <div className="fleet-list">
        {game.rovers.map((rover) => (
          <RoverCard
            key={rover.id}
            rover={rover}
            game={game}
            order={order}
            selected={rover.id === selectedRoverId}
            previews={rover.id === selectedRoverId ? previews : {}}
            onSelect={() => onSelect(rover.id)}
            onCharge={() => onCharge(rover.id)}
          />
        ))}
      </div>
    </aside>
  );
}

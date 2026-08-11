import { getDestination } from "../data/lunarMap";
import { IMPOSSIBLE_ORDER_MESSAGE, type GameState, type Order } from "../types/game";
import { orderStatusLabels, timeUntil, urgencyLabels } from "../utils/format";
import { Icon } from "../components/Icon";

interface OrdersPanelProps {
  game: GameState;
  now: number;
  selectedOrderId: string | null;
  onSelect: (id: string) => void;
}

const urgencyOrder = { critical: 0, urgent: 1, standard: 2 } as const;

function OrderCard({ order, now, selected, onSelect }: { order: Order; now: number; selected: boolean; onSelect: () => void }) {
  const destination = getDestination(order.destinationId);
  const selectable = order.status === "available" || order.status === "active";
  return (
    <button
      className={`order-card order-card--${order.urgency} ${selected ? "is-selected" : ""} ${!selectable ? "is-closed" : ""}`}
      type="button"
      onClick={onSelect}
      disabled={!selectable}
      aria-pressed={selected}
    >
      <span className="order-card__topline">
        <span className={`urgency urgency--${order.urgency}`}>{urgencyLabels[order.urgency]}</span>
        <span className={`order-status order-status--${order.status}`}>{orderStatusLabels[order.status]}</span>
      </span>
      <strong className="order-card__title">{order.title}</strong>
      <span className="order-card__destination">
        <span>{destination?.code}</span>
        {destination?.name}
      </span>
      <span className="order-card__metrics">
        <span><Icon name="weight" size={14} />{order.weightKg} кг</span>
        <span className="order-card__reward">+{order.reward} кр.</span>
        <span><Icon name="risk" size={14} />{Math.round(order.cargoRisk * 100)}%</span>
      </span>
      <span className="order-card__deadline">
        <Icon name="time" size={14} />
        {order.status === "available" ? `Осталось ${timeUntil(order.deadlineAt, now)}` : orderStatusLabels[order.status]}
      </span>
    </button>
  );
}

export function OrdersPanel({ game, now, selectedOrderId, onSelect }: OrdersPanelProps) {
  const orders = [...game.orders].sort(
    (a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt),
  );
  const selected = game.orders.find((order) => order.id === selectedOrderId);

  return (
    <aside className="side-panel orders-panel" aria-labelledby="orders-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Входящий поток</span>
          <h2 id="orders-heading">Заказы</h2>
        </div>
        <span className="panel-count">{game.orders.filter((order) => order.status === "available").length}</span>
      </div>
      {selected?.weightKg === 185 && (
        <div className="blocking-notice" role="alert">
          <span>Ограничение флота</span>
          {IMPOSSIBLE_ORDER_MESSAGE}
        </div>
      )}
      <div className="order-list">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            now={now}
            selected={order.id === selectedOrderId}
            onSelect={() => onSelect(order.id)}
          />
        ))}
      </div>
    </aside>
  );
}

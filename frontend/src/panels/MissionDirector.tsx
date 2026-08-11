import { getDestination, getRoutesForDestination } from "../data/lunarMap";
import {
  IMPOSSIBLE_ORDER_MESSAGE,
  type Delivery,
  type DeliveryPreview,
  type GameState,
  type Order,
  type Route,
} from "../types/game";
import { formatPercent, timeUntil, urgencyLabels } from "../utils/format";

interface MissionDirectorProps {
  game: GameState;
  now: number;
  selectedOrderId: string | null;
  selectedRoverId: string | null;
  selectedRouteId: string | null;
  previews: Record<string, DeliveryPreview>;
  launching: boolean;
  error: string | null;
  onOrder: (id: string) => void;
  onRoute: (id: string) => void;
  onLaunch: () => void;
  onRevisit: (step: 1 | 2 | 3) => void;
}

const routeDescriptions: Record<Route["kind"], string> = {
  safe: "Плавный обход кратеров",
  economic: "Меньше расход, дольше рейс",
  fast: "Короткий путь через сложный рельеф",
};

const routeTone: Record<Route["kind"], string> = {
  safe: "cyan",
  economic: "amber",
  fast: "red",
};

function Stepper({ step, onRevisit }: { step: number; onRevisit: (step: 1 | 2 | 3) => void }) {
  const labels = ["Заказ", "Ровер", "Маршрут", "Запуск"];
  return (
    <ol className="mission-stepper" aria-label="Этапы подготовки миссии">
      {labels.map((label, index) => {
        const number = index + 1;
        const completed = number < step;
        const current = number === step;
        const revisitable = completed && number <= 3;
        return (
          <li key={label} className={`${completed ? "is-complete" : ""} ${current ? "is-current" : ""}`}>
            <button
              type="button"
              disabled={!revisitable}
              onClick={() => revisitable && onRevisit(number as 1 | 2 | 3)}
              aria-current={current ? "step" : undefined}
            >
              <span>{completed ? "✓" : number}</span>
              <small>{label}</small>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OrderOption({ order, now, selected, onSelect }: { order: Order; now: number; selected: boolean; onSelect: () => void }) {
  const destination = getDestination(order.destinationId);
  const available = order.status === "available";
  return (
    <button
      className={`director-order director-order--${order.urgency} ${selected ? "is-selected" : ""}`}
      type="button"
      onClick={onSelect}
      disabled={!available}
      aria-pressed={selected}
    >
      <span className="director-order__meta">
        <span>{urgencyLabels[order.urgency]}</span>
        <span>{available ? timeUntil(order.deadlineAt, now) : order.status}</span>
      </span>
      <strong>{order.title}</strong>
      <span className="director-order__facts">
        <span>{destination?.code} · {destination?.name}</span>
        <span>{order.weightKg} кг</span>
        <b>+{order.reward} кр.</b>
      </span>
    </button>
  );
}

function SelectedOrder({ order }: { order: Order }) {
  const destination = getDestination(order.destinationId);
  return (
    <section className="selection-summary">
      <span className={`urgency-line urgency-line--${order.urgency}`}>{urgencyLabels[order.urgency]} · {destination?.code}</span>
      <h3>{order.title}</h3>
      <p>{order.description}</p>
      <dl>
        <div><dt>Пункт</dt><dd>{destination?.name}</dd></div>
        <div><dt>Груз</dt><dd>{order.weightKg} кг</dd></div>
        <div><dt>Награда</dt><dd>+{order.reward} кр.</dd></div>
      </dl>
    </section>
  );
}

function RouteOption({ route, preview, selected, onSelect }: { route: Route; preview?: DeliveryPreview; selected: boolean; onSelect: () => void }) {
  return (
    <button
      className={`director-route director-route--${routeTone[route.kind]} ${selected ? "is-selected" : ""}`}
      type="button"
      onClick={onSelect}
      disabled={preview ? !preview.feasible : true}
      aria-pressed={selected}
    >
      <span className="director-route__title">
        <i aria-hidden="true" />
        <span><strong>{route.name}</strong><small>{routeDescriptions[route.kind]}</small></span>
        <b>{route.distanceKm.toFixed(1)} км</b>
      </span>
      <span className="director-route__metrics">
        <span><small>Время</small><strong>{preview ? `${preview.durationSeconds} с` : "—"}</strong></span>
        <span><small>Батарея</small><strong>{preview ? `−${preview.energyCost}` : "—"}</strong></span>
        <span><small>Риск</small><strong>{preview ? formatPercent(preview.risk) : "—"}</strong></span>
        <span><small>Ожидаемо</small><strong>{preview ? `+${preview.expectedReward}` : "—"}</strong></span>
      </span>
      <span className="director-route__hazards">{route.hazards.join(" · ")}</span>
    </button>
  );
}

function ActiveStrip({ deliveries, game }: { deliveries: Delivery[]; game: GameState }) {
  if (deliveries.length === 0) return null;
  return (
    <div className="director-active" aria-live="polite">
      <span>В рейсе · {deliveries.length}</span>
      {deliveries.map((delivery) => {
        const rover = game.rovers.find((item) => item.id === delivery.roverId);
        return (
          <div key={delivery.id}>
            <span>{rover?.code}</span>
            <i><b style={{ width: `${delivery.progress * 100}%` }} /></i>
            <strong>{Math.round(delivery.progress * 100)}%</strong>
          </div>
        );
      })}
    </div>
  );
}

export function MissionDirector({
  game,
  now,
  selectedOrderId,
  selectedRoverId,
  selectedRouteId,
  previews,
  launching,
  error,
  onOrder,
  onRoute,
  onLaunch,
  onRevisit,
}: MissionDirectorProps) {
  const order = game.orders.find((item) => item.id === selectedOrderId);
  const rover = game.rovers.find((item) => item.id === selectedRoverId);
  const routes = order ? getRoutesForDestination(order.destinationId) : [];
  const route = routes.find((item) => item.id === selectedRouteId);
  const preview = selectedRouteId ? previews[selectedRouteId] : undefined;
  const activeDeliveries = game.deliveries.filter((delivery) => delivery.status === "active");
  const step = !order ? 1 : !rover ? 2 : !route ? 3 : 4;
  const impossible = order?.weightKg === 185;

  let actionLabel = "Выберите заказ";
  let actionReason = "Сначала выберите доступный заказ из списка";
  let actionDisabled = true;
  if (order && !rover) {
    actionLabel = impossible ? "Выберите другой заказ" : "Выберите ровер";
    actionReason = impossible ? "Груз не помещается ни в один ровер" : "Назначьте подходящий ровер слева";
  } else if (rover && !route) {
    actionLabel = "Выберите маршрут";
    actionReason = "Сравните три варианта и выберите один";
  } else if (route && preview) {
    actionLabel = launching ? "Проверка миссии…" : "Отправить ровер";
    actionReason = preview.feasible ? "Маршрут рассчитан, аварийный резерв сохранён" : preview.reason ?? "Маршрут недоступен";
    actionDisabled = launching || !preview.feasible;
  }

  const sortedOrders = [...game.orders].sort(
    (a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt),
  );

  return (
    <aside className="mission-director glass-panel" aria-labelledby="mission-heading">
      <header className="director-heading">
        <div><span className="eyebrow">Mission control</span><h2 id="mission-heading">Следующий рейс</h2></div>
        <span>{game.orders.filter((item) => item.status === "available").length} заказов</span>
      </header>
      <Stepper step={step} onRevisit={onRevisit} />
      <ActiveStrip deliveries={activeDeliveries} game={game} />

      <div className="director-content">
        {!order && (
          <section className="director-stage" aria-labelledby="choose-order-heading">
            <div className="stage-heading">
              <span>Шаг 1</span>
              <h3 id="choose-order-heading">Выберите заказ</h3>
              <p>Срочные грузы выше. Все параметры видны до назначения.</p>
            </div>
            <div className="director-order-list">
              {sortedOrders.map((item) => (
                <OrderOption key={item.id} order={item} now={now} selected={false} onSelect={() => onOrder(item.id)} />
              ))}
            </div>
          </section>
        )}

        {order && !rover && (
          <section className="director-stage">
            <div className="stage-heading"><span>Шаг 2</span><h3>Назначьте ровер</h3><p>Совместимые машины подсвечены в панели флота слева.</p></div>
            <SelectedOrder order={order} />
            {impossible && (
              <div className="capacity-block" role="alert">
                <strong>Ни один ровер не перевозит 185 кг</strong>
                <span>Максимальная грузоподъёмность флота — 160 кг.</span>
                <small>{IMPOSSIBLE_ORDER_MESSAGE}</small>
              </div>
            )}
          </section>
        )}

        {order && rover && !route && (
          <section className="director-stage">
            <div className="stage-heading"><span>Шаг 3</span><h3>Сравните маршруты</h3><p>{rover.name} → {getDestination(order.destinationId)?.name} · груз {order.weightKg} кг</p></div>
            <div className="director-route-list">
              {routes.map((item) => (
                <RouteOption key={item.id} route={item} preview={previews[item.id]} selected={false} onSelect={() => onRoute(item.id)} />
              ))}
            </div>
          </section>
        )}

        {order && rover && route && preview && (
          <section className="director-stage director-stage--launch">
            <div className="stage-heading"><span>Шаг 4</span><h3>Проверка перед стартом</h3><p>Все значения получены из текущего прогноза миссии.</p></div>
            <SelectedOrder order={order} />
            <div className={`launch-summary launch-summary--${routeTone[route.kind]}`}>
              <span><i />{route.name} · {route.distanceKm.toFixed(1)} км</span>
              <dl>
                <div><dt>Ровер</dt><dd>{rover.name} · {rover.code}</dd></div>
                <div><dt>Время</dt><dd>{preview.durationSeconds} с</dd></div>
                <div><dt>Батарея</dt><dd>−{preview.energyCost} · остаток {preview.batteryAfter}</dd></div>
                <div><dt>Риск</dt><dd>{formatPercent(preview.risk)}</dd></div>
                <div><dt>Награда</dt><dd>до +{order.reward} кр.</dd></div>
              </dl>
            </div>
          </section>
        )}
      </div>

      <footer className="director-action">
        <p className={error || !actionDisabled ? (error ? "is-error" : "is-ready") : ""}>{error ?? actionReason}</p>
        <button className="launch-button" type="button" onClick={onLaunch} disabled={actionDisabled}>
          <span>{actionLabel}</span><i aria-hidden="true">→</i>
        </button>
      </footer>
    </aside>
  );
}

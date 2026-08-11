import { Icon } from "../components/Icon";
import { getDestination, getRoutesForDestination } from "../data/lunarMap";
import {
  IMPOSSIBLE_ORDER_MESSAGE,
  type DeliveryPreview,
  type GameState,
  type Route,
} from "../types/game";
import { formatPercent } from "../utils/format";

interface RoutePlannerProps {
  game: GameState;
  selectedOrderId: string | null;
  selectedRoverId: string | null;
  selectedRouteId: string | null;
  previews: Record<string, DeliveryPreview>;
  launching: boolean;
  error: string | null;
  onRoute: (id: string) => void;
  onLaunch: () => void;
}

const routeDescriptions: Record<Route["kind"], string> = {
  safe: "Обход сложного рельефа",
  fast: "Напрямую через опасную зону",
  economic: "Щадящий режим тяги",
};

function RouteCard({ route, preview, selected, onSelect }: { route: Route; preview?: DeliveryPreview; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`route-card route-card--${route.kind} ${selected ? "is-selected" : ""} ${preview && !preview.feasible ? "is-blocked" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="route-card__heading">
        <span className="route-symbol" aria-hidden="true"><i /><i /></span>
        <span><strong>{route.name}</strong><small>{routeDescriptions[route.kind]}</small></span>
        <span className="route-radio" />
      </span>
      <span className="route-metrics">
        <span><small>Длина</small><strong>{route.distanceKm.toFixed(1)} км</strong></span>
        <span><small>Время</small><strong>{preview ? `${preview.durationSeconds} с` : "—"}</strong></span>
        <span><small>Расход</small><strong>{preview ? `${preview.energyCost} ед.` : "—"}</strong></span>
        <span><small>Остаток</small><strong className={preview && preview.batteryAfter < 20 ? "danger-text" : ""}>{preview ? `${preview.batteryAfter} ед.` : "—"}</strong></span>
        <span><small>Риск</small><strong>{preview ? formatPercent(preview.risk) : "—"}</strong></span>
        <span><small>Успех</small><strong>{preview ? formatPercent(preview.successProbability) : "—"}</strong></span>
      </span>
      <span className="route-card__hazards">{route.hazards.join(" · ")}</span>
      {preview && <span className="route-card__reward">ожидаемо +{preview.expectedReward} кр.</span>}
    </button>
  );
}

export function RoutePlanner({
  game,
  selectedOrderId,
  selectedRoverId,
  selectedRouteId,
  previews,
  launching,
  error,
  onRoute,
  onLaunch,
}: RoutePlannerProps) {
  const order = game.orders.find((item) => item.id === selectedOrderId);
  const rover = game.rovers.find((item) => item.id === selectedRoverId);

  if (!order) {
    return (
      <section className="mission-planner mission-planner--idle" aria-label="Планирование миссии">
        <span className="planner-step">01</span>
        <div><span className="eyebrow">Новое назначение</span><strong>Выберите маяк заказа</strong></div>
        <p>Карточки слева и световые маркеры на карте работают синхронно.</p>
      </section>
    );
  }

  if (order.weightKg === 185) {
    return (
      <section className="mission-planner mission-planner--blocked" aria-label="Доставка невозможна">
        <span className="planner-alert">!</span>
        <div><span className="eyebrow">Ограничение миссии</span><strong>{IMPOSSIBLE_ORDER_MESSAGE}</strong></div>
        <button className="launch-button" type="button" disabled>Запустить доставку</button>
      </section>
    );
  }

  if (!rover) {
    return (
      <section className="mission-planner mission-planner--idle" aria-label="Выбор ровера">
        <span className="planner-step">02</span>
        <div>
          <span className="eyebrow">{getDestination(order.destinationId)?.name} · {order.weightKg} кг</span>
          <strong>Назначьте подходящий ровер</strong>
        </div>
        <p>Справа показаны вместимость, заряд и совместимость каждой машины.</p>
      </section>
    );
  }

  const routes = getRoutesForDestination(order.destinationId);
  const activeDelivery = game.deliveries.find(
    (delivery) => delivery.orderId === order.id && delivery.status === "active",
  );
  const completedDelivery = game.deliveries.find(
    (delivery) => delivery.orderId === order.id && delivery.status !== "active",
  );

  if (activeDelivery) {
    const route = routes.find((item) => item.id === activeDelivery.routeId);
    return (
      <section className="mission-planner mission-planner--active" aria-live="polite">
        <div className="mission-active__head">
          <span className="mission-beacon"><i /></span>
          <div>
            <span className="eyebrow">Миссия выполняется · {rover.code}</span>
            <strong>{activeDelivery.phase === "outbound" ? `Курс на «${getDestination(order.destinationId)?.name}»` : "Возвращение на базу «Селена»"}</strong>
          </div>
          <span className="mission-percent">{Math.round(activeDelivery.progress * 100)}%</span>
        </div>
        <div className="mission-progress"><i style={{ width: `${activeDelivery.progress * 100}%` }} /></div>
        <div className="mission-active__facts">
          <span><Icon name="route" />{route?.name}</span>
          <span><Icon name="battery" />−{activeDelivery.preview.energyCost} ед.</span>
          <span><Icon name="risk" />риск {formatPercent(activeDelivery.preview.risk)}</span>
        </div>
      </section>
    );
  }

  if (completedDelivery) {
    const succeeded = completedDelivery.status === "succeeded";
    return (
      <section className={`mission-planner mission-planner--result ${succeeded ? "is-success" : "is-failure"}`} aria-live="polite">
        <span className="result-mark">{succeeded ? "✓" : "×"}</span>
        <div>
          <span className="eyebrow">Миссия завершена</span>
          <strong>{succeeded ? "Груз доставлен, ровер вернулся" : "Доставка не удалась, ровер возвращён"}</strong>
          <p>{succeeded ? `Получено ${order.reward} кредитов. Состояние базы обновлено.` : "Рейтинг базы снижен. Выберите следующий заказ."}</p>
        </div>
      </section>
    );
  }

  const selectedPreview = selectedRouteId ? previews[selectedRouteId] : undefined;
  const launchDisabled = !selectedPreview?.feasible || launching;
  return (
    <section className="mission-planner" aria-label="Сравнение маршрутов">
      <div className="planner-title">
        <div>
          <span className="eyebrow">03 · Сравнение маршрутов</span>
          <strong>{rover.name} → {getDestination(order.destinationId)?.name}</strong>
        </div>
        <span className="payload-chip"><Icon name="weight" />{order.weightKg} / {rover.capacityKg} кг</span>
      </div>
      <div className="route-grid">
        {routes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            preview={previews[route.id]}
            selected={route.id === selectedRouteId}
            onSelect={() => onRoute(route.id)}
          />
        ))}
      </div>
      <div className="planner-action">
        <div className="preview-message">
          {error ? <span className="is-error">{error}</span> : selectedPreview?.reason ? <span className="is-error">{selectedPreview.reason}</span> : selectedPreview?.warnings[0] ? <span>{selectedPreview.warnings[0]}</span> : <span>Прогноз рассчитан. Резерв батареи сохранён.</span>}
        </div>
        <button className="launch-button" type="button" onClick={onLaunch} disabled={launchDisabled}>
          <span>{launching ? "Проверка…" : "Запустить доставку"}</span>
          <i aria-hidden="true">→</i>
        </button>
      </div>
    </section>
  );
}

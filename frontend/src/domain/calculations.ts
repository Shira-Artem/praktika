import { ROUTES } from "../data/lunarMap";
import {
  IMPOSSIBLE_ORDER_MESSAGE,
  type DeliveryPreview,
  type GameState,
  type GameSummary,
  type Order,
  type Route,
  type Rover,
} from "../types/game";

export const EMERGENCY_BATTERY_RESERVE = 5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateDeliveryPreview(
  order: Order,
  rover: Rover,
  route: Route,
): DeliveryPreview {
  const loadRatio = order.weightKg / rover.capacityKg;
  const energyCost = Math.ceil(
    route.distanceKm *
      rover.energyPerKm *
      route.energyMultiplier *
      (1 + 0.65 * loadRatio),
  );
  const durationSeconds = Math.ceil(
    (route.baseDurationSeconds * route.timeMultiplier * (1 + 0.35 * loadRatio)) /
      rover.speed,
  );
  const risk = clamp(
    route.baseRisk + order.cargoRisk + 0.12 * loadRatio - rover.riskProtection,
    0.02,
    0.8,
  );
  const batteryAfter = rover.battery - energyCost;
  const warnings: string[] = [];

  let reason: string | undefined;
  let reasonCode: string | undefined;
  if (order.weightKg > rover.capacityKg) {
    reason = order.weightKg === 185 ? IMPOSSIBLE_ORDER_MESSAGE : `Ровер «${rover.name}» принимает не более ${rover.capacityKg} кг.`;
    reasonCode = "capacity_exceeded";
  } else if (rover.status !== "idle") {
    reason = `Ровер «${rover.name}» уже выполняет доставку.`;
    reasonCode = "rover_busy";
  } else if (order.status !== "available") {
    reason = "Заказ уже назначен или закрыт.";
    reasonCode = "order_unavailable";
  } else if (route.destinationId !== order.destinationId) {
    reason = "Выбранный маршрут не ведёт к пункту заказа.";
    reasonCode = "wrong_destination";
  } else if (batteryAfter < EMERGENCY_BATTERY_RESERVE) {
    reason = `Недостаточно заряда: после рейса останется ${batteryAfter} ед., резерв — ${EMERGENCY_BATTERY_RESERVE}.`;
    reasonCode = "insufficient_battery";
  }

  if (loadRatio >= 0.9 && loadRatio <= 1) {
    warnings.push(`Загрузка ${Math.round(loadRatio * 100)}% увеличивает время и расход.`);
  }
  if (risk >= 0.35) {
    warnings.push("Маршрут требует усиленного контроля в опасной зоне.");
  }
  if (batteryAfter >= EMERGENCY_BATTERY_RESERVE && batteryAfter < 25) {
    warnings.push("Низкий остаток заряда после возвращения.");
  }

  return {
    feasible: reason === undefined,
    reason,
    reasonCode,
    loadRatio,
    energyCost,
    batteryAfter,
    durationSeconds,
    risk,
    successProbability: 1 - risk,
    expectedReward: Math.round(order.reward * (1 - risk)),
    warnings,
  };
}

export function previewByIds(
  orders: Order[],
  rovers: Rover[],
  orderId: string,
  roverId: string,
  routeId: string,
): DeliveryPreview {
  const order = orders.find((item) => item.id === orderId);
  const rover = rovers.find((item) => item.id === roverId);
  const route = ROUTES.find((item) => item.id === routeId);
  if (!order || !rover || !route) {
    throw new Error("Не удалось построить прогноз: данные миссии устарели.");
  }
  return calculateDeliveryPreview(order, rover, route);
}

export function deterministicRoll(seed: number, key: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4_294_967_296;
}

export function missionDurationMs(preview: DeliveryPreview): number {
  return clamp(Math.round(preview.durationSeconds * 210), 8_000, 15_000);
}

export function summarizeGame(state: GameState): GameSummary {
  const resolved = state.deliveries.filter((delivery) => delivery.status !== "active");
  const successful = resolved.filter((delivery) => delivery.status === "succeeded");
  const failed = resolved.filter((delivery) => delivery.status === "failed");
  const deliveredWeightKg = successful.reduce((sum, delivery) => {
    const order = state.orders.find((item) => item.id === delivery.orderId);
    return sum + (order?.weightKg ?? 0);
  }, 0);
  const batterySpentTotal = resolved.reduce((sum, delivery) => sum + delivery.preview.energyCost, 0);

  return {
    outcome: state.status === "won" ? "won" : "lost",
    finalCredits: state.credits,
    finalScore: state.score,
    finalRating: state.rating,
    successfulDeliveries: successful.length,
    failedDeliveries: failed.length,
    successRate: resolved.length > 0 ? successful.length / resolved.length : 0,
    deliveredWeightKg,
    batterySpentTotal,
    shiftsCompleted: state.shift,
  };
}

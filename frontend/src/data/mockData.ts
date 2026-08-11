import type { GameState, Order, Rover } from "../types/game";

export const SHIFT_DURATION_MINUTES = 18;
export const TOTAL_SHIFTS = 3;

function deadlineFrom(now: number, minutes: number): string {
  return new Date(now + minutes * 60_000).toISOString();
}

function suffix(id: string, shift: number): string {
  return shift === 1 ? id : `${id}-s${shift}`;
}

/**
 * Каждая смена получает свой набор заказов с уникальными id (суффикс -sN для
 * смен 2 и 3), чтобы не конфликтовать с уже разрешёнными заказами прошлой
 * смены, которые остаются в истории `GameState.orders`. Обязательный
 * невозможный сценарий (185 кг) показывается один раз, в первой смене.
 */
export function createMockOrders(now = Date.now(), shift = 1): Order[] {
  const orders: Order[] = [
    {
      id: suffix("order-oxygen", shift),
      title: "Кассеты кислородных фильтров",
      destinationId: "aurora",
      weightKg: 24,
      reward: 148,
      urgency: "critical",
      cargoRisk: 0.04,
      status: "available",
      deadlineAt: deadlineFrom(now, 4.5),
      description: "Система регенерации воздуха работает на резерве.",
    },
    {
      id: suffix("order-gyros", shift),
      title: "Навигационные гироскопы",
      destinationId: "beacon-7",
      weightKg: 55,
      reward: 236,
      urgency: "critical",
      cargoRisk: 0.13,
      status: "available",
      deadlineAt: deadlineFrom(now, 6.2),
      description: "Хрупкая калибровочная сборка для дальнего маяка.",
    },
    {
      id: suffix("order-water", shift),
      title: "Запас воды и пайков",
      destinationId: "helios",
      weightKg: 88,
      reward: 214,
      urgency: "urgent",
      cargoRisk: 0.03,
      status: "available",
      deadlineAt: deadlineFrom(now, 9.5),
      description: "Тяжёлый груз для ночной смены энергокомплекса.",
    },
    {
      id: suffix("order-medicine", shift),
      title: "Медицинский криобокс",
      destinationId: "nox",
      weightKg: 12,
      reward: 172,
      urgency: "urgent",
      cargoRisk: 0.17,
      status: "available",
      deadlineAt: deadlineFrom(now, 11),
      description: "Чувствительный к ударам груз для теневой станции.",
    },
    {
      id: suffix("order-relays", shift),
      title: "Солнечные релейные модули",
      destinationId: "kepler",
      weightKg: 32,
      reward: 126,
      urgency: "standard",
      cargoRisk: 0.06,
      status: "available",
      deadlineAt: deadlineFrom(now, 14),
      description: "Плановое обслуживание антенн обсерватории.",
    },
    {
      id: suffix("order-samples", shift),
      title: "Геологические образцы",
      destinationId: "aurora",
      weightKg: 18,
      reward: 96,
      urgency: "standard",
      cargoRisk: 0.02,
      status: "available",
      deadlineAt: deadlineFrom(now, 16),
      description: "Контейнеры из кратерного пояса для лаборатории.",
    },
  ];

  if (shift === 1) {
    orders.push({
      id: "order-reactor",
      title: "Защитный контейнер реактора",
      destinationId: "beacon-7",
      weightKg: 185,
      reward: 480,
      urgency: "standard",
      cargoRisk: 0.2,
      status: "available",
      deadlineAt: deadlineFrom(now, 18),
      description: "Демонстрационный сверхтяжёлый груз: нужен четвёртый класс ровера.",
      demoBlocked: true,
    });
  }

  return orders;
}

export function createMockRovers(): Rover[] {
  return [
    {
      id: "rover-swift",
      name: "Стриж",
      code: "RV-01",
      capacityKg: 35,
      battery: 100,
      batteryMax: 100,
      speed: 1.25,
      energyPerKm: 2.35,
      riskProtection: 0.02,
      status: "idle",
    },
    {
      id: "rover-titan",
      name: "Титан",
      code: "RV-07",
      capacityKg: 95,
      battery: 145,
      batteryMax: 145,
      speed: 0.9,
      energyPerKm: 2.0,
      riskProtection: 0.07,
      status: "idle",
    },
    {
      id: "rover-atlas",
      name: "Атлас",
      code: "RV-12",
      capacityKg: 160,
      battery: 190,
      batteryMax: 190,
      speed: 0.7,
      energyPerKm: 1.62,
      riskProtection: 0.12,
      status: "idle",
    },
  ];
}

function makeSessionId(now: number): string {
  return `lunar-${now.toString(36)}`;
}

export function createMockState(options?: { now?: number; seed?: number }): GameState {
  const now = options?.now ?? Date.now();
  const seed = options?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
  const at = new Date(now).toISOString();

  return {
    sessionId: makeSessionId(now),
    playerId: "local_player",
    seed,
    shift: 1,
    shiftEndsAt: deadlineFrom(now, SHIFT_DURATION_MINUTES),
    status: "active",
    credits: 820,
    score: 0,
    rating: 94,
    orders: createMockOrders(now),
    rovers: createMockRovers(),
    deliveries: [],
    logs: [
      {
        id: `log-${now}`,
        at,
        message: "Смена принята. Лунная транспортная сеть готова.",
        tone: "info",
      },
    ],
    startedAt: at,
    version: 1,
  };
}

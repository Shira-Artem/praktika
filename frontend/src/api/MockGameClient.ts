import { LUNAR_MAP, getDestination } from "../data/lunarMap";
import { SHIFT_DURATION_MINUTES, TOTAL_SHIFTS, createMockOrders, createMockState } from "../data/mockData";
import {
  deterministicRoll,
  missionDurationMs,
  previewByIds,
} from "../domain/calculations";
import type {
  Delivery,
  GameMap,
  GameState,
  MissionLogEntry,
  PreviewInput,
  StartDeliveryInput,
} from "../types/game";
import { GameClientError, type GameClient, type GameStateListener } from "./GameClient";

const STORAGE_KEY = "lunar-dispatch.session.v1";

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function logEntry(message: string, tone: MissionLogEntry["tone"]): MissionLogEntry {
  const now = Date.now();
  return {
    id: `log-${now}-${message.length}`,
    at: new Date(now).toISOString(),
    message,
    tone,
  };
}

export class MockGameClient implements GameClient {
  readonly mode = "mock" as const;

  private state: GameState | null = null;
  private readonly listeners = new Set<GameStateListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options?: { now?: number; seed?: number }) {}

  async initialize(): Promise<GameState> {
    if (!this.state) {
      this.state = this.restore() ?? createMockState(this.options);
      this.persist();
      this.ensureTicker();
    }
    return cloneState(this.state);
  }

  async getMap(): Promise<GameMap> {
    return LUNAR_MAP;
  }

  async getState(): Promise<GameState> {
    return cloneState(this.requireState());
  }

  async previewDelivery(input: PreviewInput) {
    const state = this.requireState();
    if (state.status !== "active") {
      throw new GameClientError("Смена завершена. Начните новую игру.", "game_over");
    }
    return previewByIds(
      state.orders,
      state.rovers,
      input.orderId,
      input.roverId,
      input.routeId,
    );
  }

  async startDelivery(input: StartDeliveryInput): Promise<Delivery> {
    const state = this.requireState();
    if (state.status !== "active") {
      throw new GameClientError("Смена завершена. Начните новую игру.", "game_over");
    }
    if (input.stateVersion !== state.version) {
      throw new GameClientError("Состояние изменилось. Прогноз обновлён — проверьте миссию ещё раз.", "stale_state");
    }

    const preview = await this.previewDelivery(input);
    if (!preview.feasible) {
      throw new GameClientError(preview.reason ?? "Доставка недоступна.", preview.reasonCode ?? "rejected");
    }

    const order = state.orders.find((item) => item.id === input.orderId);
    const rover = state.rovers.find((item) => item.id === input.roverId);
    if (!order || !rover) {
      throw new GameClientError("Заказ или ровер больше не доступны.", "not_found");
    }

    const now = Date.now();
    const id = `delivery-${state.version}-${input.roverId}`;
    const duration = missionDurationMs(preview);
    const delivery: Delivery = {
      id,
      orderId: order.id,
      roverId: rover.id,
      routeId: input.routeId,
      status: "active",
      phase: "outbound",
      progress: 0,
      startedAt: new Date(now).toISOString(),
      completesAt: new Date(now + duration).toISOString(),
      preview,
      resultRoll: deterministicRoll(state.seed, `${id}:${order.id}:${state.version}`),
    };

    order.status = "active";
    rover.status = "mission";
    state.deliveries.push(delivery);
    state.version += 1;
    state.logs.push(
      logEntry(
        `${rover.name} вышел к пункту «${getDestination(order.destinationId)?.name ?? order.destinationId}».`,
        "info",
      ),
    );
    this.commit(true);
    return structuredClone(delivery);
  }

  async chargeRover(roverId: string): Promise<GameState> {
    const state = this.requireState();
    if (state.status !== "active") {
      throw new GameClientError("Смена завершена. Начните новую игру.", "game_over");
    }
    const rover = state.rovers.find((item) => item.id === roverId);
    if (!rover) throw new GameClientError("Ровер не найден.", "not_found");
    if (rover.status !== "idle") {
      throw new GameClientError("Нельзя заряжать ровер во время миссии.", "rover_busy");
    }
    if (rover.battery >= rover.batteryMax) return cloneState(state);
    if (state.credits < 30) {
      throw new GameClientError("Для зарядки нужно 30 кредитов.", "insufficient_credits");
    }
    state.credits -= 30;
    rover.battery = rover.batteryMax;
    state.version += 1;
    state.logs.push(logEntry(`${rover.name}: батарея заряжена до 100%.`, "success"));
    this.commit(true);
    return cloneState(state);
  }

  async reset(): Promise<GameState> {
    this.state = createMockState(this.options);
    this.commit(true);
    return cloneState(this.state);
  }

  subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    this.ensureTicker();
    if (this.state) listener(cloneState(this.state));
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireState(): GameState {
    if (!this.state) {
      throw new GameClientError("Сессия ещё не инициализирована.", "not_initialized");
    }
    return this.state;
  }

  private ensureTicker(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 100);
  }

  private tick(): void {
    if (!this.state) return;
    const now = Date.now();
    let changed = false;
    let persist = false;

    for (const delivery of this.state.deliveries) {
      if (delivery.status !== "active") continue;
      const started = Date.parse(delivery.startedAt);
      const completes = Date.parse(delivery.completesAt);
      const progress = Math.min(1, Math.max(0, (now - started) / (completes - started)));
      const wasOutbound = delivery.phase === "outbound";
      delivery.progress = progress;
      delivery.phase = progress < 0.5 ? "outbound" : progress < 1 ? "returning" : "complete";
      changed = true;

      if (wasOutbound && delivery.phase === "returning") {
        const order = this.state.orders.find((item) => item.id === delivery.orderId);
        const route = LUNAR_MAP.routes.find((item) => item.id === delivery.routeId);
        this.state.logs.push(
          logEntry(
            `Контрольная точка пройдена: ${route?.hazards[0] ?? "лунная равнина"}. Возвращаем ровер.`,
            "warning",
          ),
        );
        if (order) persist = true;
      }

      if (progress >= 1) {
        this.finishDelivery(delivery);
        persist = true;
      }
    }

    const activeOrderIds = new Set(
      this.state.deliveries
        .filter((delivery) => delivery.status === "active")
        .map((delivery) => delivery.orderId),
    );
    for (const order of this.state.orders) {
      if (
        order.status === "available" &&
        !order.demoBlocked &&
        !activeOrderIds.has(order.id) &&
        Date.parse(order.deadlineAt) <= now
      ) {
        order.status = "expired";
        this.state.rating = Math.max(0, this.state.rating - 1);
        this.state.version += 1;
        this.state.logs.push(logEntry(`Срок заказа «${order.title}» истёк.`, "danger"));
        changed = true;
        persist = true;
      }
    }

    if (this.checkShiftProgression(now)) {
      changed = true;
      persist = true;
    }

    if (changed) this.commit(persist);
  }

  /**
   * Раз в тик проверяет условие поражения (рейтинг обнулился) и переход
   * между сменами. Обязательный по ТЗ финал: 3 смены, поражение при
   * рейтинге 0, победа при завершении третьей смены с рейтингом выше 0.
   */
  private checkShiftProgression(now: number): boolean {
    const state = this.requireState();
    if (state.status !== "active") return false;

    if (state.rating <= 0) {
      state.status = "lost";
      state.version += 1;
      state.logs.push(
        logEntry("Рейтинг базы обнулился. Смена диспетчера окончена.", "danger"),
      );
      return true;
    }

    if (Date.parse(state.shiftEndsAt) > now) return false;

    if (state.shift >= TOTAL_SHIFTS) {
      state.status = "won";
      state.version += 1;
      state.logs.push(
        logEntry(
          `Третья смена завершена. База «Селена» выстояла — итоговый рейтинг ${state.rating}%.`,
          "success",
        ),
      );
      return true;
    }

    state.shift += 1;
    state.shiftEndsAt = new Date(now + SHIFT_DURATION_MINUTES * 60_000).toISOString();
    for (const order of state.orders) {
      if (order.status === "available") order.status = "expired";
    }
    state.orders.push(...createMockOrders(now, state.shift));
    state.version += 1;
    state.logs.push(logEntry(`Смена ${state.shift} началась. Поступили новые заказы.`, "info"));
    return true;
  }

  private finishDelivery(delivery: Delivery): void {
    const state = this.requireState();
    const order = state.orders.find((item) => item.id === delivery.orderId);
    const rover = state.rovers.find((item) => item.id === delivery.roverId);
    if (!order || !rover) return;

    const succeeded = delivery.resultRoll <= delivery.preview.successProbability;
    delivery.status = succeeded ? "succeeded" : "failed";
    delivery.phase = "complete";
    delivery.progress = 1;
    rover.status = "idle";
    rover.battery = Math.max(0, rover.battery - delivery.preview.energyCost);
    order.status = succeeded ? "delivered" : "failed";

    if (succeeded) {
      state.credits += order.reward;
      state.score += Math.round(order.reward * (1 + (1 - delivery.preview.risk)));
      state.rating = Math.min(100, state.rating + 1);
      state.logs.push(
        logEntry(`Груз доставлен. ${rover.name} вернулся на базу, +${order.reward} кр.`, "success"),
      );
    } else {
      state.credits = Math.max(0, state.credits - 40);
      state.score -= 25;
      state.rating = Math.max(0, state.rating - 3);
      state.logs.push(
        logEntry(`Миссия завершена с потерями. ${rover.name} эвакуирован, −40 кр.`, "danger"),
      );
    }
    state.version += 1;
  }

  private commit(shouldPersist: boolean): void {
    const state = this.requireState();
    state.logs = state.logs.slice(-24);
    if (shouldPersist) this.persist();
    const snapshot = cloneState(state);
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private persist(): void {
    if (!this.state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage can be disabled; the simulation remains fully usable in memory.
    }
  }

  private restore(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GameState;
      if (!parsed.sessionId || !Array.isArray(parsed.orders) || !Array.isArray(parsed.rovers)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

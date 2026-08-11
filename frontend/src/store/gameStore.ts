import { create } from "zustand";
import { getRoutesForDestination } from "../data/lunarMap";
import { apiMode, gameClient, telemetryClient } from "../api/clientFactory";
import { GameClientError } from "../api/GameClient";
import { summarizeGame } from "../domain/calculations";
import type {
  DeliveryPreview,
  GameMap,
  GameState,
  MissionLogEntry,
} from "../types/game";

type MobilePanel = "orders" | "map" | "rovers";

interface GameStore {
  mode: typeof apiMode;
  game: GameState | null;
  map: GameMap | null;
  ready: boolean;
  loading: boolean;
  launching: boolean;
  error: string | null;
  selectedOrderId: string | null;
  selectedRoverId: string | null;
  selectedRouteId: string | null;
  previews: Record<string, DeliveryPreview>;
  logs: MissionLogEntry[];
  introOpen: boolean;
  introStep: 0 | 1 | 2;
  resetOpen: boolean;
  resultDeliveryId: string | null;
  mobilePanel: MobilePanel;
  initialize: () => Promise<void>;
  selectOrder: (orderId: string, source?: "panel" | "map") => void;
  selectRover: (roverId: string, source?: "panel" | "map") => Promise<void>;
  selectRoute: (routeId: string) => Promise<void>;
  startDelivery: () => Promise<void>;
  chargeRover: (roverId: string) => Promise<void>;
  showReset: () => void;
  hideReset: () => void;
  resetGame: () => Promise<void>;
  dismissIntro: () => void;
  advanceIntro: () => void;
  showIntro: () => void;
  dismissResult: () => void;
  nextOrder: () => void;
  revisitStep: (step: 1 | 2 | 3) => void;
  setMobilePanel: (panel: MobilePanel) => void;
}

let unsubscribeClient: (() => void) | null = null;

function makeUiLog(message: string, tone: MissionLogEntry["tone"] = "neutral"): MissionLogEntry {
  const now = Date.now();
  return {
    id: `ui-${now}-${message}`,
    at: new Date(now).toISOString(),
    message,
    tone,
  };
}

function mergeLogs(current: MissionLogEntry[], incoming: MissionLogEntry[]): MissionLogEntry[] {
  const ids = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !ids.has(entry.id))].slice(-30);
}

function reportCompletion(previous: GameState | null, next: GameState): void {
  if (!previous) return;
  for (const delivery of next.deliveries) {
    const before = previous.deliveries.find((item) => item.id === delivery.id);
    if (before?.status === "active" && delivery.status !== "active") {
      const order = next.orders.find((item) => item.id === delivery.orderId);
      void telemetryClient.track(
        delivery.status === "succeeded" ? "delivery_completed" : "delivery_failed",
        {
          delivery_id: delivery.id,
          order_id: delivery.orderId,
          rover_id: delivery.roverId,
          route_id: delivery.routeId,
          reward: order?.reward ?? 0,
          energy_cost: delivery.preview.energyCost,
          risk: delivery.preview.risk,
        },
      );
    }
  }
}

function reportGameProgress(previous: GameState | null, next: GameState): void {
  if (!previous) return;
  if (next.shift !== previous.shift && next.status === "active") {
    void telemetryClient.track("shift_started", { shift: next.shift });
  }
  if (previous.status === "active" && next.status !== "active") {
    const summary = summarizeGame(next);
    void telemetryClient.track("game_completed", {
      outcome: summary.outcome,
      shifts_completed: summary.shiftsCompleted,
      final_credits: summary.finalCredits,
      final_score: summary.finalScore,
      final_rating: summary.finalRating,
      successful_deliveries: summary.successfulDeliveries,
      failed_deliveries: summary.failedDeliveries,
      success_rate: summary.successRate,
      delivered_weight_kg: summary.deliveredWeightKg,
      battery_spent_total: summary.batterySpentTotal,
    });
  }
}

function findNewCompletion(previous: GameState | null, next: GameState): string | null {
  if (!previous) return null;
  return next.deliveries.find((delivery) => {
    const before = previous.deliveries.find((item) => item.id === delivery.id);
    return before?.status === "active" && delivery.status !== "active";
  })?.id ?? null;
}

export const useGameStore = create<GameStore>((set, get) => ({
  mode: apiMode,
  game: null,
  map: null,
  ready: false,
  loading: false,
  launching: false,
  error: null,
  selectedOrderId: null,
  selectedRoverId: null,
  selectedRouteId: null,
  previews: {},
  logs: [],
  introOpen: localStorage.getItem("lunar-dispatch.intro-seen") !== "1",
  introStep: 0,
  resetOpen: false,
  resultDeliveryId: null,
  mobilePanel: "map",

  initialize: async () => {
    if (get().loading || get().ready) return;
    set({ loading: true, error: null });
    try {
      const [game, map] = await Promise.all([gameClient.initialize(), gameClient.getMap()]);
      telemetryClient.setContext({ playerId: game.playerId, sessionId: game.sessionId });
      if (!unsubscribeClient) {
        unsubscribeClient = gameClient.subscribe((next) => {
          const previous = get().game;
          reportCompletion(previous, next);
          reportGameProgress(previous, next);
          const resultDeliveryId = findNewCompletion(previous, next);
          set((store) => ({
            game: next,
            logs: mergeLogs(store.logs, next.logs),
            resultDeliveryId: resultDeliveryId ?? store.resultDeliveryId,
          }));
        });
      }
      set({ game, map, logs: game.logs, ready: true, loading: false });
      void telemetryClient.track("game_started", { mode: apiMode, shift: game.shift });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Не удалось запустить игровую сессию.",
        loading: false,
      });
    }
  },

  selectOrder: (orderId, source = "panel") => {
    const game = get().game;
    const order = game?.orders.find((item) => item.id === orderId);
    if (!order || !["available", "active"].includes(order.status)) return;
    set((store) => ({
      selectedOrderId: orderId,
      selectedRoverId: null,
      selectedRouteId: null,
      previews: {},
      error: null,
      logs: [...store.logs, makeUiLog(`Выбран заказ «${order.title}».`, "info")].slice(-30),
    }));
    void telemetryClient.track("order_selected", {
      order_id: order.id,
      weight_kg: order.weightKg,
      urgency: order.urgency,
      source,
    });
  },

  selectRover: async (roverId, source = "panel") => {
    const { game, selectedOrderId } = get();
    if (!game || !selectedOrderId) return;
    const order = game.orders.find((item) => item.id === selectedOrderId);
    const rover = game.rovers.find((item) => item.id === roverId);
    if (!order || !rover || rover.status !== "idle" || order.weightKg > rover.capacityKg || order.status !== "available") {
      return;
    }

    const routes = getRoutesForDestination(order.destinationId);
    const previews = Object.fromEntries(
      await Promise.all(
        routes.map(async (route) => [route.id, await gameClient.previewDelivery({ orderId: order.id, roverId, routeId: route.id })] as const),
      ),
    );
    set((store) => ({
      selectedRoverId: roverId,
      selectedRouteId: null,
      previews,
      error: null,
      logs: [...store.logs, makeUiLog(`${rover.name}: построены три варианта рейса.`, "info")].slice(-30),
    }));
    void telemetryClient.track("rover_selected", { rover_id: rover.id, order_id: order.id, source });
    void telemetryClient.track("delivery_previewed", {
      order_id: order.id,
      rover_id: rover.id,
      route_count: routes.length,
      feasible: Object.values(previews).some((preview) => preview.feasible),
    });
  },

  selectRoute: async (routeId) => {
    const { selectedOrderId, selectedRoverId } = get();
    if (!selectedOrderId || !selectedRoverId) return;
    set({ selectedRouteId: routeId, error: null });
    const preview = await gameClient.previewDelivery({
      orderId: selectedOrderId,
      roverId: selectedRoverId,
      routeId,
    });
    set((store) => ({ previews: { ...store.previews, [routeId]: preview } }));
    void telemetryClient.track("route_selected", {
      order_id: selectedOrderId,
      rover_id: selectedRoverId,
      route_id: routeId,
      risk: preview.risk,
    });
  },

  startDelivery: async () => {
    const { game, selectedOrderId, selectedRoverId, selectedRouteId } = get();
    if (!game || !selectedOrderId || !selectedRoverId || !selectedRouteId || get().launching) return;
    set({ launching: true, error: null });
    try {
      const preview = await gameClient.previewDelivery({
        orderId: selectedOrderId,
        roverId: selectedRoverId,
        routeId: selectedRouteId,
      });
      set((store) => ({ previews: { ...store.previews, [selectedRouteId]: preview } }));
      if (!preview.feasible) {
        throw new GameClientError(preview.reason ?? "Доставка недоступна.", preview.reasonCode ?? "rejected");
      }
      const delivery = await gameClient.startDelivery({
        orderId: selectedOrderId,
        roverId: selectedRoverId,
        routeId: selectedRouteId,
        stateVersion: (await gameClient.getState()).version,
      });
      set({
        launching: false,
        mobilePanel: "map",
        selectedOrderId: null,
        selectedRoverId: null,
        selectedRouteId: null,
        previews: {},
      });
      void telemetryClient.track("delivery_started", {
        delivery_id: delivery.id,
        order_id: selectedOrderId,
        rover_id: selectedRoverId,
        route_id: selectedRouteId,
        energy_cost: preview.energyCost,
        duration_seconds: preview.durationSeconds,
        risk: preview.risk,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Запуск миссии отклонён.";
      const code = error instanceof GameClientError ? error.code : "unknown";
      set((store) => ({
        launching: false,
        error: message,
        logs: [...store.logs, makeUiLog(`Запуск отклонён: ${message}`, "danger")].slice(-30),
      }));
      void telemetryClient.track("delivery_rejected", {
        order_id: selectedOrderId,
        rover_id: selectedRoverId,
        route_id: selectedRouteId,
        reason_code: code,
      });
    }
  },

  chargeRover: async (roverId) => {
    try {
      await gameClient.chargeRover(roverId);
      set({ error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Зарядка недоступна." });
    }
  },

  showReset: () => set({ resetOpen: true }),
  hideReset: () => set({ resetOpen: false }),
  resetGame: async () => {
    const game = await gameClient.reset();
    telemetryClient.setContext({ playerId: game.playerId, sessionId: game.sessionId });
    set({
      game,
      selectedOrderId: null,
      selectedRoverId: null,
      selectedRouteId: null,
      previews: {},
      logs: game.logs,
      resetOpen: false,
      resultDeliveryId: null,
      introOpen: true,
      introStep: 0,
      error: null,
    });
    localStorage.removeItem("lunar-dispatch.intro-seen");
    void telemetryClient.track("game_reset", { mode: apiMode });
  },
  dismissIntro: () => {
    localStorage.setItem("lunar-dispatch.intro-seen", "1");
    set({ introOpen: false, introStep: 0 });
  },
  advanceIntro: () => {
    const step = get().introStep;
    if (step >= 2) {
      get().dismissIntro();
      return;
    }
    set({ introStep: (step + 1) as 0 | 1 | 2 });
  },
  showIntro: () => set({ introOpen: true, introStep: 0 }),
  dismissResult: () => set({ resultDeliveryId: null }),
  nextOrder: () => set({
    resultDeliveryId: null,
    selectedOrderId: null,
    selectedRoverId: null,
    selectedRouteId: null,
    previews: {},
    error: null,
  }),
  revisitStep: (step) => {
    if (step === 1) {
      set({
        selectedOrderId: null,
        selectedRoverId: null,
        selectedRouteId: null,
        previews: {},
        error: null,
      });
      return;
    }
    if (step === 2) {
      set({ selectedRoverId: null, selectedRouteId: null, previews: {}, error: null });
      return;
    }
    set({ selectedRouteId: null, error: null });
  },
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
}));

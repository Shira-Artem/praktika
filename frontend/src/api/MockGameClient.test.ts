import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHIFT_DURATION_MINUTES, TOTAL_SHIFTS, createMockState } from "../data/mockData";
import { MockGameClient } from "./MockGameClient";

const STORAGE_KEY = "lunar-dispatch.session.v1";

describe("MockGameClient mission lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates battery, credits, score and order after a successful deterministic mission", async () => {
    const client = new MockGameClient({ now: Date.now(), seed: 1 });
    const before = await client.initialize();
    const input = {
      orderId: "order-oxygen",
      roverId: "rover-swift",
      routeId: "aurora-safe",
    };
    const preview = await client.previewDelivery(input);
    expect(preview.feasible).toBe(true);

    const delivery = await client.startDelivery({ ...input, stateVersion: before.version });
    expect(delivery.resultRoll).toBeLessThanOrEqual(preview.successProbability);
    await vi.advanceTimersByTimeAsync(16_000);

    const after = await client.getState();
    expect(after.orders.find((order) => order.id === input.orderId)?.status).toBe("delivered");
    expect(after.rovers.find((rover) => rover.id === input.roverId)?.battery).toBe(
      before.rovers.find((rover) => rover.id === input.roverId)!.battery - preview.energyCost,
    );
    expect(after.credits).toBeGreaterThan(before.credits);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("restores an active session from localStorage", async () => {
    const first = new MockGameClient({ now: Date.now(), seed: 23 });
    const state = await first.initialize();
    await first.startDelivery({
      orderId: "order-oxygen",
      roverId: "rover-swift",
      routeId: "aurora-safe",
      stateVersion: state.version,
    });

    const second = new MockGameClient();
    const restored = await second.initialize();
    expect(restored.sessionId).toBe(state.sessionId);
    expect(restored.orders.find((order) => order.id === "order-oxygen")?.status).toBe("active");
  });

  it("applies a visible recovery penalty after a deterministic failure", async () => {
    const client = new MockGameClient({ now: Date.now(), seed: 11 });
    const before = await client.initialize();
    const input = {
      orderId: "order-oxygen",
      roverId: "rover-swift",
      routeId: "aurora-safe",
    };
    const delivery = await client.startDelivery({ ...input, stateVersion: before.version });
    expect(delivery.resultRoll).toBeGreaterThan(delivery.preview.successProbability);
    await vi.advanceTimersByTimeAsync(16_000);

    const after = await client.getState();
    expect(after.credits).toBe(before.credits - 40);
    expect(after.score).toBe(before.score - 25);
    expect(after.rating).toBe(before.rating - 3);
    expect(after.orders.find((order) => order.id === input.orderId)?.status).toBe("failed");
  });

  it("advances to the next shift with fresh, uniquely-identified orders when the timer expires", async () => {
    const client = new MockGameClient({ now: Date.now(), seed: 5 });
    await client.initialize();
    await vi.advanceTimersByTimeAsync(SHIFT_DURATION_MINUTES * 60_000 + 200);

    const after = await client.getState();
    expect(after.shift).toBe(2);
    expect(after.status).toBe("active");
    expect(after.orders.some((order) => order.id === "order-oxygen-s2")).toBe(true);
    expect(after.orders.find((order) => order.id === "order-oxygen")?.status).toBe("expired");
  });

  it("ends the game as lost once the base rating reaches zero", async () => {
    const now = Date.now();
    const seeded = createMockState({ now, seed: 11 });
    seeded.rating = 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    const client = new MockGameClient();
    const before = await client.initialize();
    expect(before.rating).toBe(1);

    const input = { orderId: "order-oxygen", roverId: "rover-swift", routeId: "aurora-safe" };
    const delivery = await client.startDelivery({ ...input, stateVersion: before.version });
    expect(delivery.resultRoll).toBeGreaterThan(delivery.preview.successProbability);
    await vi.advanceTimersByTimeAsync(16_000);

    const after = await client.getState();
    expect(after.rating).toBe(0);
    expect(after.status).toBe("lost");
  });

  it("wins after completing the third shift with a positive rating", async () => {
    const now = Date.now();
    const seeded = createMockState({ now, seed: 1 });
    seeded.shift = TOTAL_SHIFTS;
    seeded.shiftEndsAt = new Date(now - 1_000).toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    const client = new MockGameClient();
    await client.initialize();
    await vi.advanceTimersByTimeAsync(200);

    const after = await client.getState();
    expect(after.status).toBe("won");
  });

  it("rejects new deliveries once the game has ended", async () => {
    const now = Date.now();
    const seeded = createMockState({ now, seed: 1 });
    seeded.status = "lost";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    const client = new MockGameClient();
    await client.initialize();
    await expect(
      client.previewDelivery({ orderId: "order-oxygen", roverId: "rover-swift", routeId: "aurora-safe" }),
    ).rejects.toThrow("Смена завершена");
  });
});

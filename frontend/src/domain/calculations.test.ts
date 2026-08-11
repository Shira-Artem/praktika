import { describe, expect, it } from "vitest";
import { createMockOrders, createMockRovers } from "../data/mockData";
import { getRoutesForDestination } from "../data/lunarMap";
import { IMPOSSIBLE_ORDER_MESSAGE } from "../types/game";
import { calculateDeliveryPreview } from "./calculations";

describe("delivery calculations", () => {
  const orders = createMockOrders(0);
  const rovers = createMockRovers();

  it("blocks the 185 kg order for every rover with the required reason", () => {
    const order = orders.find((item) => item.id === "order-reactor")!;
    const route = getRoutesForDestination(order.destinationId)[0];
    for (const rover of rovers) {
      const preview = calculateDeliveryPreview(order, rover, route);
      expect(preview.feasible).toBe(false);
      expect(preview.reason).toBe(IMPOSSIBLE_ORDER_MESSAGE);
      expect(preview.reasonCode).toBe("capacity_exceeded");
    }
  });

  it("allows the 88 kg order for Titan and Atlas but not Swift", () => {
    const order = orders.find((item) => item.id === "order-water")!;
    const route = getRoutesForDestination(order.destinationId).find((item) => item.kind === "economic")!;
    const [swift, titan, atlas] = rovers;

    expect(calculateDeliveryPreview(order, swift, route).reasonCode).toBe("capacity_exceeded");
    expect(calculateDeliveryPreview(order, titan, route).feasible).toBe(true);
    expect(calculateDeliveryPreview(order, atlas, route).feasible).toBe(true);
  });

  it("makes a heavy order slower and more energy-intensive on the same rover and route", () => {
    const light = orders.find((item) => item.id === "order-medicine")!;
    const heavy = { ...light, id: "heavy", weightKg: 88 };
    const rover = rovers[2];
    const route = getRoutesForDestination(light.destinationId)[0];
    const lightPreview = calculateDeliveryPreview(light, rover, route);
    const heavyPreview = calculateDeliveryPreview(heavy, rover, route);

    expect(heavyPreview.energyCost).toBeGreaterThan(lightPreview.energyCost);
    expect(heavyPreview.durationSeconds).toBeGreaterThan(lightPreview.durationSeconds);
  });

  it("preserves the emergency battery reserve", () => {
    const order = orders.find((item) => item.id === "order-oxygen")!;
    const rover = { ...rovers[0], battery: 8 };
    const route = getRoutesForDestination(order.destinationId)[0];
    const preview = calculateDeliveryPreview(order, rover, route);

    expect(preview.feasible).toBe(false);
    expect(preview.reasonCode).toBe("insufficient_battery");
  });
});

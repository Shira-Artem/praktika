import { describe, expect, it } from "vitest";
import { GameBridge } from "./GameBridge";

describe("GameBridge", () => {
  it("routes a Phaser marker selection to the same selection handler as React", () => {
    const bridge = new GameBridge();
    let selected: string | null = null;
    const selectOrder = (id: string) => {
      selected = id;
    };
    const unsubscribe = bridge.on("orderSelected", selectOrder);

    selectOrder("order-water");
    expect(selected).toBe("order-water");
    selected = null;
    bridge.emit("orderSelected", "order-water");
    expect(selected).toBe("order-water");

    unsubscribe();
  });
});

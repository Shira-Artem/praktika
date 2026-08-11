import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultDialog } from "../components/Dialogs";
import { getRoutesForDestination } from "../data/lunarMap";
import { createMockState } from "../data/mockData";
import type { Delivery, DeliveryPreview } from "../types/game";
import { MissionDirector } from "./MissionDirector";
import { RoversPanel } from "./RoversPanel";

const noop = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePreview(overrides: Partial<DeliveryPreview> = {}): DeliveryPreview {
  return {
    feasible: true,
    loadRatio: 0.55,
    energyCost: 63,
    batteryAfter: 82,
    durationSeconds: 85,
    risk: 0.15,
    successProbability: 0.85,
    expectedReward: 182,
    warnings: [],
    ...overrides,
  };
}

describe("Visual UX V2 critical states", () => {
  it("explains why the 185 kg order cannot use any rover", () => {
    const game = createMockState({ now: 1_700_000_000_000, seed: 7 });

    render(
      <>
        <RoversPanel
          game={game}
          selectedOrderId="order-reactor"
          selectedRoverId={null}
          previews={{}}
          onSelect={noop}
          onCharge={noop}
        />
        <MissionDirector
          game={game}
          now={1_700_000_000_000}
          selectedOrderId="order-reactor"
          selectedRoverId={null}
          selectedRouteId={null}
          previews={{}}
          launching={false}
          error={null}
          onOrder={noop}
          onRoute={noop}
          onLaunch={noop}
          onRevisit={noop}
        />
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Ни один ровер не перевозит 185 кг");
    expect(screen.getByRole("button", { name: /RV-01 Стриж/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /RV-07 Титан/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /RV-12 Атлас/ })).toBeDisabled();
    expect(screen.getAllByText(/максимум (35|95|160) кг/)).toHaveLength(3);
  });

  it("keeps only Titan and Atlas compatible with the 88 kg order", () => {
    const game = createMockState({ now: 1_700_000_000_000, seed: 7 });

    render(
      <RoversPanel
        game={game}
        selectedOrderId="order-water"
        selectedRoverId={null}
        previews={{}}
        onSelect={noop}
        onCharge={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /RV-01 Стриж/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /RV-07 Титан/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /RV-12 Атлас/ })).toBeEnabled();
    expect(screen.getByText("88 / 95 кг · загрузка 93%")).toBeVisible();
  });

  it("shows three explicit route choices before launch", () => {
    const game = createMockState({ now: 1_700_000_000_000, seed: 7 });
    const routes = getRoutesForDestination("helios");
    const previews = Object.fromEntries(routes.map((route) => [route.id, makePreview()]));

    render(
      <MissionDirector
        game={game}
        now={1_700_000_000_000}
        selectedOrderId="order-water"
        selectedRoverId="rover-titan"
        selectedRouteId={null}
        previews={previews}
        launching={false}
        error={null}
        onOrder={noop}
        onRoute={noop}
        onLaunch={noop}
        onRevisit={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /Безопасный/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Быстрый/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Экономичный/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Выберите маршрут/ })).toBeDisabled();
  });

  it("renders the mission result and supports Escape dismissal", () => {
    const game = createMockState({ now: 1_700_000_000_000, seed: 7 });
    const delivery: Delivery = {
      id: "delivery-test",
      orderId: "order-water",
      roverId: "rover-titan",
      routeId: "helios-economic",
      status: "succeeded",
      phase: "complete",
      progress: 1,
      startedAt: new Date(1_700_000_000_000).toISOString(),
      completesAt: new Date(1_700_000_085_000).toISOString(),
      preview: makePreview(),
      resultRoll: 0.2,
    };
    const onClose = vi.fn();

    render(<ResultDialog game={game} delivery={delivery} onNext={noop} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Доставка выполнена" })).toBeVisible();
    expect(screen.getByText("+214")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

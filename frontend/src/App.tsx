import { useEffect, useState } from "react";
import { GameOverDialog, IntroDialog, ResetDialog, ResultDialog } from "./components/Dialogs";
import { EventLog } from "./components/EventLog";
import { Hud } from "./components/Hud";
import { MobileNav } from "./components/MobileNav";
import { getDestination } from "./data/lunarMap";
import { BASE_TEXTURES } from "./game/assets";
import { PhaserGame } from "./game/PhaserGame";
import { MissionDirector } from "./panels/MissionDirector";
import { RoversPanel } from "./panels/RoversPanel";
import { useGameStore } from "./store/gameStore";

export default function App() {
  const store = useGameStore();
  const initialize = store.initialize;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!store.ready || !store.game || !store.map) {
    return (
      <main className="boot-screen">
        <img src={BASE_TEXTURES.stationLarge} alt="" />
        <span className="eyebrow">Lunar transport network</span>
        <h1>{store.error ? "Связь с базой потеряна" : "Инициализация смены"}</h1>
        <p>{store.error ?? "Синхронизируем маяки, маршруты и парк роверов…"}</p>
        {store.error && <button className="primary-button" type="button" onClick={() => void store.initialize()}>Повторить</button>}
      </main>
    );
  }

  const game = store.game;
  const activeDeliveries = game.deliveries.filter((delivery) => delivery.status === "active");
  const availableOrders = game.orders.filter((order) => order.status === "available").length;
  const idleRovers = game.rovers.filter((rover) => rover.status === "idle").length;
  const resultDelivery = store.resultDeliveryId
    ? game.deliveries.find((delivery) => delivery.id === store.resultDeliveryId)
    : undefined;
  const gameOver = game.status !== "active";

  return (
    <main className="game-shell">
      <Hud game={game} mode={store.mode} now={now} onReset={store.showReset} onHelp={store.showIntro} />
      <MobileNav
        active={store.mobilePanel}
        orderCount={availableOrders}
        roverCount={idleRovers}
        onChange={store.setMobilePanel}
        onReset={store.showReset}
      />

      <div className={`game-board mobile-panel--${store.mobilePanel}`}>
        <section className="map-stage" aria-label="Живая карта лунной транспортной сети">
          <PhaserGame />
          <div className="map-vignette" aria-hidden="true" />
          <div className="map-status" aria-hidden="true">
            <span><i /> Канал LD-01</span>
            <span>Селена · 89.9°S</span>
          </div>
          {activeDeliveries.length > 0 && (
            <div className="active-mission-stack" aria-label="Активные миссии">
              {activeDeliveries.map((delivery) => {
                const rover = game.rovers.find((item) => item.id === delivery.roverId);
                const order = game.orders.find((item) => item.id === delivery.orderId);
                const destination = order ? getDestination(order.destinationId) : undefined;
                return (
                  <article key={delivery.id}>
                    <span><small>{delivery.phase === "outbound" ? "К цели" : "На базу"}</small><strong>{rover?.name} → {destination?.name}</strong></span>
                    <span className="active-mission__progress"><i><b style={{ width: `${delivery.progress * 100}%` }} /></i><strong>{Math.round(delivery.progress * 100)}%</strong></span>
                  </article>
                );
              })}
            </div>
          )}
          <EventLog logs={store.logs} activeDeliveries={activeDeliveries} />
        </section>

        <RoversPanel
          game={game}
          selectedOrderId={store.selectedOrderId}
          selectedRoverId={store.selectedRoverId}
          previews={store.previews}
          onSelect={(id) => void store.selectRover(id, "panel")}
          onCharge={(id) => void store.chargeRover(id)}
        />

        <MissionDirector
          game={game}
          now={now}
          selectedOrderId={store.selectedOrderId}
          selectedRoverId={store.selectedRoverId}
          selectedRouteId={store.selectedRouteId}
          previews={store.previews}
          launching={store.launching}
          error={store.error}
          onOrder={(id) => store.selectOrder(id, "panel")}
          onRoute={(id) => void store.selectRoute(id)}
          onLaunch={() => void store.startDelivery()}
          onRevisit={store.revisitStep}
        />
      </div>

      {store.introOpen && (
        <IntroDialog step={store.introStep} onNext={store.advanceIntro} onSkip={store.dismissIntro} />
      )}
      {store.resetOpen && (
        <ResetDialog onCancel={store.hideReset} onConfirm={() => void store.resetGame()} />
      )}
      {!gameOver && resultDelivery && (
        <ResultDialog game={game} delivery={resultDelivery} onNext={store.nextOrder} onClose={store.dismissResult} />
      )}
      {gameOver && (
        <GameOverDialog game={game} onRestart={() => void store.resetGame()} />
      )}
    </main>
  );
}

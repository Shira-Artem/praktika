import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useGameStore } from "../store/gameStore";
import { GameBridge, type CameraCommand } from "./bridge/GameBridge";
import { BootScene } from "./scenes/BootScene";
import { LunarMapScene } from "./scenes/LunarMapScene";

export function PhaserGame() {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const bridgeRef = useRef(new GameBridge());
  const reducedMotion = useReducedMotion();
  const game = useGameStore((state) => state.game);
  const map = useGameStore((state) => state.map);
  const selectedOrderId = useGameStore((state) => state.selectedOrderId);
  const selectedRoverId = useGameStore((state) => state.selectedRoverId);
  const selectedRouteId = useGameStore((state) => state.selectedRouteId);
  const previews = useGameStore((state) => state.previews);
  const selectOrder = useGameStore((state) => state.selectOrder);
  const selectRover = useGameStore((state) => state.selectRover);
  const selectRoute = useGameStore((state) => state.selectRoute);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent || gameRef.current) return;
    const bridge = bridgeRef.current;
    const phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: Math.max(parent.clientWidth, 1),
      height: Math.max(parent.clientHeight, 1),
      transparent: true,
      antialias: true,
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      scene: [new BootScene(), new LunarMapScene(bridge)],
      input: { mouse: { preventDefaultWheel: true } },
    });
    gameRef.current = phaser;
    let resizeFrame = 0;
    const resize = () => {
      const width = Math.max(parent.clientWidth, 1);
      const height = Math.max(parent.clientHeight, 1);
      if (phaser.scale.width !== width || phaser.scale.height !== height) {
        phaser.scale.resize(width, height);
      }
    };
    const requestResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(requestResize);
    observer.observe(parent);
    resize();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      phaser.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const bridge = bridgeRef.current;
    const offOrder = bridge.on("orderSelected", (id) => selectOrder(id, "map"));
    const offRover = bridge.on("roverSelected", (id) => void selectRover(id, "map"));
    const offRoute = bridge.on("routeSelected", (id) => void selectRoute(id));
    return () => {
      offOrder();
      offRover();
      offRoute();
    };
  }, [selectOrder, selectRover, selectRoute]);

  useEffect(() => {
    if (!game || !map) return;
    bridgeRef.current.push({
      game,
      map,
      selectedOrderId,
      selectedRoverId,
      selectedRouteId,
      previews,
      reducedMotion,
    });
  }, [game, map, selectedOrderId, selectedRoverId, selectedRouteId, previews, reducedMotion]);

  const camera = (command: CameraCommand) => bridgeRef.current.emit("cameraCommand", command);

  const accessibleDestinations = map?.destinations.map((destination) => {
    const order = game?.orders.find(
      (item) => item.destinationId === destination.id && item.status === "available",
    );
    return order ? (
      <button
        className="sr-only map-a11y-target"
        key={destination.id}
        type="button"
        onClick={() => selectOrder(order.id, "map")}
        aria-label={`Выбрать заказ в пункте ${destination.name}: ${order.title}`}
      >
        {destination.name}
      </button>
    ) : null;
  });

  return (
    <div className="phaser-shell" aria-label="Интерактивная карта лунной транспортной сети">
      <div ref={parentRef} className="phaser-canvas" />
      <div className="map-a11y-list">{accessibleDestinations}</div>
      <div className="map-controls" role="group" aria-label="Управление камерой карты">
        <button type="button" onClick={() => camera("zoomIn")} aria-label="Приблизить карту">+</button>
        <button type="button" onClick={() => camera("zoomOut")} aria-label="Отдалить карту">−</button>
        <button className="map-controls__fit" type="button" onClick={() => camera("fitAll")}>Показать всю карту</button>
      </div>
      <div className="map-coordinates" aria-hidden="true">
        <span>SELENA GRID</span>
        <span>89.9°S · 0.0°E</span>
      </div>
    </div>
  );
}

import type { DeliveryPreview, GameMap, GameState } from "../../types/game";

export type CameraCommand = "zoomIn" | "zoomOut" | "fitAll";

export interface SceneSnapshot {
  game: GameState;
  map: GameMap;
  selectedOrderId: string | null;
  selectedRoverId: string | null;
  selectedRouteId: string | null;
  previews: Record<string, DeliveryPreview>;
  reducedMotion: boolean;
}

interface SceneEvents {
  orderSelected: string;
  roverSelected: string;
  routeSelected: string;
  cameraCommand: CameraCommand;
}

type SceneEventName = keyof SceneEvents;
type SceneEventListener<K extends SceneEventName> = (payload: SceneEvents[K]) => void;

export class GameBridge {
  private snapshot: SceneSnapshot | null = null;
  private readonly snapshotListeners = new Set<(snapshot: SceneSnapshot) => void>();
  private readonly eventListeners: {
    [K in SceneEventName]: Set<SceneEventListener<K>>;
  } = {
    orderSelected: new Set(),
    roverSelected: new Set(),
    routeSelected: new Set(),
    cameraCommand: new Set(),
  };

  push(snapshot: SceneSnapshot): void {
    this.snapshot = snapshot;
    this.snapshotListeners.forEach((listener) => listener(snapshot));
  }

  getSnapshot(): SceneSnapshot | null {
    return this.snapshot;
  }

  onSnapshot(listener: (snapshot: SceneSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => this.snapshotListeners.delete(listener);
  }

  emit<K extends SceneEventName>(event: K, payload: SceneEvents[K]): void {
    this.eventListeners[event].forEach((listener) => listener(payload));
  }

  on<K extends SceneEventName>(event: K, listener: SceneEventListener<K>): () => void {
    this.eventListeners[event].add(listener);
    return () => this.eventListeners[event].delete(listener);
  }

  clear(): void {
    this.snapshotListeners.clear();
    this.eventListeners.orderSelected.clear();
    this.eventListeners.roverSelected.clear();
    this.eventListeners.routeSelected.clear();
    this.eventListeners.cameraCommand.clear();
  }
}

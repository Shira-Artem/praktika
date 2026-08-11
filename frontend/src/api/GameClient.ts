import type {
  ApiMode,
  Delivery,
  DeliveryPreview,
  GameMap,
  GameState,
  PreviewInput,
  StartDeliveryInput,
} from "../types/game";

export type GameStateListener = (state: GameState) => void;

export interface GameClient {
  readonly mode: ApiMode;
  initialize(): Promise<GameState>;
  getMap(): Promise<GameMap>;
  getState(): Promise<GameState>;
  previewDelivery(input: PreviewInput): Promise<DeliveryPreview>;
  startDelivery(input: StartDeliveryInput): Promise<Delivery>;
  chargeRover(roverId: string): Promise<GameState>;
  reset(): Promise<GameState>;
  subscribe(listener: GameStateListener): () => void;
}

export class GameClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GameClientError";
  }
}

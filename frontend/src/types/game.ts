export type ApiMode = "mock" | "live";
export type Urgency = "standard" | "urgent" | "critical";
export type OrderStatus = "available" | "active" | "delivered" | "failed" | "expired";
export type RoverStatus = "idle" | "mission";
export type RouteKind = "safe" | "fast" | "economic";
export type DeliveryStatus = "active" | "succeeded" | "failed";
export type DeliveryPhase = "outbound" | "returning" | "complete";
export type GameStatus = "active" | "won" | "lost";

export interface Point {
  x: number;
  y: number;
}

export interface Destination {
  id: string;
  name: string;
  code: string;
  subtitle: string;
  position: Point;
}

export interface TerrainZone {
  id: string;
  name: string;
  kind: "plain" | "craters" | "ridge" | "dust" | "shadow";
  position: Point;
  radius: Point;
  rotation: number;
}

export interface Route {
  id: string;
  destinationId: string;
  kind: RouteKind;
  name: string;
  distanceKm: number;
  baseDurationSeconds: number;
  timeMultiplier: number;
  energyMultiplier: number;
  baseRisk: number;
  hazards: string[];
  controlPoints: [Point, Point];
}

export interface Order {
  id: string;
  title: string;
  destinationId: string;
  weightKg: number;
  reward: number;
  urgency: Urgency;
  cargoRisk: number;
  status: OrderStatus;
  deadlineAt: string;
  description: string;
  demoBlocked?: boolean;
}

export interface Rover {
  id: string;
  name: string;
  code: string;
  capacityKg: number;
  battery: number;
  batteryMax: number;
  speed: number;
  energyPerKm: number;
  riskProtection: number;
  status: RoverStatus;
}

export interface DeliveryPreview {
  feasible: boolean;
  reason?: string;
  reasonCode?: string;
  loadRatio: number;
  energyCost: number;
  batteryAfter: number;
  durationSeconds: number;
  risk: number;
  successProbability: number;
  expectedReward: number;
  warnings: string[];
}

export interface Delivery {
  id: string;
  orderId: string;
  roverId: string;
  routeId: string;
  status: DeliveryStatus;
  phase: DeliveryPhase;
  progress: number;
  startedAt: string;
  completesAt: string;
  preview: DeliveryPreview;
  resultRoll: number;
}

export interface MissionLogEntry {
  id: string;
  at: string;
  message: string;
  tone: "neutral" | "info" | "warning" | "success" | "danger";
}

export interface GameState {
  sessionId: string;
  playerId: string;
  seed: number;
  shift: number;
  shiftEndsAt: string;
  status: GameStatus;
  credits: number;
  score: number;
  rating: number;
  orders: Order[];
  rovers: Rover[];
  deliveries: Delivery[];
  logs: MissionLogEntry[];
  startedAt: string;
  version: number;
}

export interface GameSummary {
  outcome: "won" | "lost";
  finalCredits: number;
  finalScore: number;
  finalRating: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRate: number;
  deliveredWeightKg: number;
  batterySpentTotal: number;
  shiftsCompleted: number;
}

export interface PreviewInput {
  orderId: string;
  roverId: string;
  routeId: string;
}

export interface StartDeliveryInput extends PreviewInput {
  stateVersion: number;
}

export interface GameMap {
  destinations: Destination[];
  zones: TerrainZone[];
  routes: Route[];
}

export const IMPOSSIBLE_ORDER_MESSAGE =
  "Доставка невозможна: вес 185 кг превышает максимальную грузоподъёмность парка 160 кг.";

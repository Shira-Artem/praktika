import type { Destination, GameMap, Route, RouteKind, TerrainZone } from "../types/game";

export const MAP_SIZE = { width: 1600, height: 900 } as const;
export const SELENA_POSITION = { x: 800, y: 468 } as const;

export const DESTINATIONS: Destination[] = [
  {
    id: "aurora",
    name: "Аврора",
    code: "AU-03",
    subtitle: "Научный модуль",
    position: { x: 390, y: 245 },
  },
  {
    id: "kepler",
    name: "Кеплер",
    code: "KP-12",
    subtitle: "Обсерватория",
    position: { x: 1200, y: 218 },
  },
  {
    id: "helios",
    name: "Гелиос",
    code: "HL-08",
    subtitle: "Энергокомплекс",
    position: { x: 1300, y: 632 },
  },
  {
    id: "beacon-7",
    name: "Маяк-7",
    code: "MK-07",
    subtitle: "Дальний ретранслятор",
    position: { x: 870, y: 785 },
  },
  {
    id: "nox",
    name: "Нокс",
    code: "NX-21",
    subtitle: "Теневая станция",
    position: { x: 250, y: 650 },
  },
];

export const TERRAIN_ZONES: TerrainZone[] = [
  {
    id: "maria",
    name: "РАВНИНА ТИШИНЫ",
    kind: "plain",
    position: { x: 770, y: 280 },
    radius: { x: 310, y: 130 },
    rotation: -0.08,
  },
  {
    id: "crater-field",
    name: "КРАТЕРНЫЙ ПОЯС",
    kind: "craters",
    position: { x: 1135, y: 480 },
    radius: { x: 250, y: 155 },
    rotation: 0.22,
  },
  {
    id: "ridge",
    name: "ГРЯДА АРТЕМИДЫ",
    kind: "ridge",
    position: { x: 520, y: 590 },
    radius: { x: 270, y: 85 },
    rotation: -0.34,
  },
  {
    id: "dust-sea",
    name: "ПЫЛЕВОЕ МОРЕ",
    kind: "dust",
    position: { x: 1060, y: 728 },
    radius: { x: 260, y: 100 },
    rotation: 0.08,
  },
  {
    id: "dark-side",
    name: "ТЕНЕВАЯ ЗОНА",
    kind: "shadow",
    position: { x: 260, y: 510 },
    radius: { x: 180, y: 230 },
    rotation: -0.18,
  },
];

const routeMeta: Record<
  string,
  { distance: number; duration: number; controls: [number, number, number, number] }
> = {
  aurora: { distance: 12, duration: 26, controls: [650, 330, 520, 220] },
  kepler: { distance: 18, duration: 35, controls: [920, 330, 1070, 210] },
  helios: { distance: 24, duration: 44, controls: [1000, 485, 1180, 575] },
  "beacon-7": { distance: 28, duration: 51, controls: [740, 590, 820, 690] },
  nox: { distance: 22, duration: 41, controls: [610, 500, 420, 630] },
};

const variants: Record<
  RouteKind,
  {
    label: string;
    distance: number;
    time: number;
    energy: number;
    risk: number;
    offset: number;
    hazards: (destinationId: string) => string[];
  }
> = {
  safe: {
    label: "Безопасный",
    distance: 1.18,
    time: 1.12,
    energy: 0.98,
    risk: 0.04,
    offset: -42,
    hazards: () => ["обход кратеров", "низкая видимость"],
  },
  fast: {
    label: "Быстрый",
    distance: 0.88,
    time: 0.76,
    energy: 1.24,
    risk: 0.16,
    offset: 32,
    hazards: (id) => (id === "nox" ? ["теневая зона", "каменная гряда"] : ["кратеры", "пылевой шлейф"]),
  },
  economic: {
    label: "Экономичный",
    distance: 1.07,
    time: 1.3,
    energy: 0.76,
    risk: 0.08,
    offset: 68,
    hazards: () => ["пылевое поле"],
  },
};

function buildRoutes(): Route[] {
  return DESTINATIONS.flatMap((destination) => {
    const meta = routeMeta[destination.id];
    return (Object.entries(variants) as [RouteKind, (typeof variants)[RouteKind]][]).map(
      ([kind, variant]) => ({
        id: `${destination.id}-${kind}`,
        destinationId: destination.id,
        kind,
        name: variant.label,
        distanceKm: Math.round(meta.distance * variant.distance * 10) / 10,
        baseDurationSeconds: meta.duration,
        timeMultiplier: variant.time,
        energyMultiplier: variant.energy,
        baseRisk: variant.risk,
        hazards: variant.hazards(destination.id),
        controlPoints: [
          { x: meta.controls[0], y: meta.controls[1] + variant.offset },
          { x: meta.controls[2], y: meta.controls[3] + variant.offset },
        ],
      }),
    );
  });
}

export const ROUTES = buildRoutes();

export const LUNAR_MAP: GameMap = {
  destinations: DESTINATIONS,
  zones: TERRAIN_ZONES,
  routes: ROUTES,
};

export function getDestination(id: string): Destination | undefined {
  return DESTINATIONS.find((destination) => destination.id === id);
}

export function getRoutesForDestination(destinationId: string): Route[] {
  return ROUTES.filter((route) => route.destinationId === destinationId);
}

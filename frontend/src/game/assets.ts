import type Phaser from "phaser";

export const KENNEY_ROOT = "/assets/game/kenney";

export const MAP_BACKGROUND_TEXTURES = {
  landscape: {
    key: "lunar-map-background-4x3",
    path: "/assets/game/lunar-map-bg-4x3-2048.webp",
  },
  square: {
    key: "lunar-map-background-square",
    path: "/assets/game/lunar-map-bg-square-2048.webp",
  },
} as const;

export const TERRAIN_TEXTURES = {
  groundRough: `${KENNEY_ROOT}/terrain/groundTileRough_SW.png`,
  crater: `${KENNEY_ROOT}/terrain/crater_SW.png`,
  craterLarge: `${KENNEY_ROOT}/terrain/craterLarge_SW.png`,
  rocks: `${KENNEY_ROOT}/terrain/rocks_SW.png`,
  rocksSmall: `${KENNEY_ROOT}/terrain/rocksSmall_SW.png`,
  rocksTall: `${KENNEY_ROOT}/terrain/rocksTall_SW.png`,
  rocksOre: `${KENNEY_ROOT}/terrain/rocksOre_SW.png`,
  meteor: `${KENNEY_ROOT}/terrain/meteorHalf_SW.png`,
} as const;

export const BASE_TEXTURES = {
  corridor: `${KENNEY_ROOT}/base/buildingCorridor_SW.png`,
  habitat: `${KENNEY_ROOT}/base/buildingOpen_SW.png`,
  corner: `${KENNEY_ROOT}/base/buildingCorner_SW.png`,
  station: `${KENNEY_ROOT}/base/station_SW.png`,
  stationLarge: `${KENNEY_ROOT}/base/stationLarge_SW.png`,
  solarDeck: `${KENNEY_ROOT}/base/metalTileLarge_SW.png`,
  dishLarge: `${KENNEY_ROOT}/base/satelliteDishLarge_SW.png`,
  dish: `${KENNEY_ROOT}/base/satelliteDishAntenna_SW.png`,
  tower: `${KENNEY_ROOT}/base/metalStructureCross_SW.png`,
  barrel: `${KENNEY_ROOT}/base/barrel_SW.png`,
  barrelLarge: `${KENNEY_ROOT}/base/barrelLarge_SW.png`,
  consoleScreen: `${KENNEY_ROOT}/base/consoleScreen_SW.png`,
  console: `${KENNEY_ROOT}/base/console_SW.png`,
  roverPad: `${KENNEY_ROOT}/base/spaceCraftStand_SW.png`,
} as const;

export const ROVER_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type RoverDirection = (typeof ROVER_DIRECTIONS)[number];

const roverModels = {
  "rover-swift": "spaceCraft2",
  "rover-titan": "spaceCraft3",
  "rover-atlas": "spaceCraft5",
} as const;

export function roverTextureKey(roverId: string, direction: RoverDirection = "SW"): string {
  return `kenney-rover-${roverId}-${direction}`;
}

export function roverTexturePath(roverId: keyof typeof roverModels, direction: RoverDirection): string {
  return `${KENNEY_ROOT}/rovers/${roverModels[roverId]}_${direction}.png`;
}

export const roverCardArt: Record<string, string> = {
  "rover-swift": roverTexturePath("rover-swift", "SW"),
  "rover-titan": roverTexturePath("rover-titan", "SW"),
  "rover-atlas": roverTexturePath("rover-atlas", "SW"),
};

export function preloadKenneyAssets(scene: Phaser.Scene): void {
  for (const [key, path] of Object.entries(TERRAIN_TEXTURES)) {
    scene.load.image(`kenney-terrain-${key}`, path);
  }
  for (const [key, path] of Object.entries(BASE_TEXTURES)) {
    scene.load.image(`kenney-base-${key}`, path);
  }
  for (const roverId of Object.keys(roverModels) as (keyof typeof roverModels)[]) {
    for (const direction of ROVER_DIRECTIONS) {
      scene.load.image(roverTextureKey(roverId, direction), roverTexturePath(roverId, direction));
    }
  }
}

export function preloadGameAssets(scene: Phaser.Scene): void {
  for (const texture of Object.values(MAP_BACKGROUND_TEXTURES)) {
    scene.load.image(texture.key, texture.path);
  }
  preloadKenneyAssets(scene);
}

export function directionFromAngle(angle: number): RoverDirection {
  const normalized = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const index = Math.round(normalized / (Math.PI / 4)) % 8;
  return (["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const)[index];
}

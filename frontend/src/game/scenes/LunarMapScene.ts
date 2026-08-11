import Phaser from "phaser";
import { MAP_SIZE, SELENA_POSITION } from "../../data/lunarMap";
import type { Delivery, Destination, Route, Rover, TerrainZone } from "../../types/game";
import { formatPercent } from "../../utils/format";
import { directionFromAngle, MAP_BACKGROUND_TEXTURES, roverTextureKey } from "../assets";
import type { CameraCommand, GameBridge, SceneSnapshot } from "../bridge/GameBridge";

interface DestinationVisual {
  container: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  halo: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  orderCount: Phaser.GameObjects.Text;
  tween: Phaser.Tweens.Tween;
}

interface RoverVisual {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  statusRing: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  direction: string;
}

interface RouteVisual {
  route: Route;
  curve: Phaser.Curves.CubicBezier;
  arcNormal: Phaser.Math.Vector2;
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  emphasis: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Container;
  arrows: Phaser.GameObjects.Graphics[];
  hazardMarkers: Phaser.GameObjects.Container[];
  hitZones: Phaser.GameObjects.Zone[];
  selected: boolean;
  hovered: boolean;
}

const COLORS = {
  void: 0x090d12,
  regolith: 0x343a3f,
  regolithLight: 0x515a5f,
  regolithDark: 0x1b2025,
  cyan: 0x58d7ed,
  amber: 0xf1b861,
  green: 0x7ad6a4,
  red: 0xf16f62,
  text: 0xe8f0ef,
  muted: 0x8e9da2,
} as const;

const ROUTE_COLORS: Record<Route["kind"], number> = {
  safe: COLORS.cyan,
  economic: COLORS.amber,
  fast: COLORS.red,
};

const CAMERA_ABSOLUTE_MIN_ZOOM = 0.22;
const CAMERA_MAX_ZOOM = 1.6;
const CAMERA_ZOOM_STEP = 1.2;
const MAP_FIT_PADDING = 32;
const BACKDROP_WORLD_MARGIN = 120;
const BACKDROP_FIT_GUARD = 16;
const CAMERA_BOUNDS_INSET = 2;
const NARROW_BACKDROP_ASPECT = 7 / 6;
const ROUTE_TRANSITION_MS = 200;
const ROUTE_HIT_SIZE_PX = 34;
const ROUTE_LABEL_WIDTH = 204;
const ROUTE_LABEL_HEIGHT = 48;

const ROUTE_KIND_ORDER: Record<Route["kind"], number> = {
  safe: 0,
  economic: 1,
  fast: 2,
};

const DESTINATION_TEXTURES: Record<string, { texture: string; scale: number; tint?: number }> = {
  aurora: { texture: "kenney-base-dishLarge", scale: 0.68 },
  kepler: { texture: "kenney-base-tower", scale: 0.62 },
  helios: { texture: "kenney-base-solarDeck", scale: 0.35, tint: 0xb7c2c2 },
  "beacon-7": { texture: "kenney-base-stationLarge", scale: 0.72 },
  nox: { texture: "kenney-base-habitat", scale: 0.56, tint: 0x9ba4a5 },
};

export class LunarMapScene extends Phaser.Scene {
  private readonly bridge: GameBridge;
  private backdrop!: Phaser.GameObjects.Image;
  private backdropShade!: Phaser.GameObjects.Graphics;
  private routeLayer!: Phaser.GameObjects.Graphics;
  private ambientLayer!: Phaser.GameObjects.Container;
  private cameraBounds = new Phaser.Geom.Rectangle(0, 0, MAP_SIZE.width, MAP_SIZE.height);
  private minimumZoom = CAMERA_ABSOLUTE_MIN_ZOOM;
  private latest: SceneSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly destinationVisuals = new Map<string, DestinationVisual>();
  private readonly roverVisuals = new Map<string, RoverVisual>();
  private readonly midpointFlashes = new Set<string>();
  private readonly dustTimes = new Map<string, number>();
  private readonly trackTimes = new Map<string, number>();
  private readonly routeHitTargets: Phaser.GameObjects.Zone[] = [];
  private readonly routeVisuals = new Map<string, RouteVisual>();
  private hoveredRouteId: string | null = null;
  private routeRenderKey = "";
  private cameraFocusKey = "";
  private terrainDrawn = false;
  private releaseCameraCommand: (() => void) | null = null;

  constructor(bridge: GameBridge) {
    super("LunarMapScene");
    this.bridge = bridge;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.void);
    this.drawBackdrop();
    this.configureCamera();
    this.routeLayer = this.add.graphics().setDepth(1000);
    this.drawSelenaComplex();

    this.unsubscribe = this.bridge.onSnapshot((snapshot) => this.applySnapshot(snapshot));
    this.releaseCameraCommand = this.bridge.on("cameraCommand", (command) => this.handleCameraCommand(command));
    const release = () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.releaseCameraCommand?.();
      this.releaseCameraCommand = null;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.input.off("wheel", this.handleWheel, this);
      this.input.off("pointermove", this.handlePointerMove, this);
      this.clearRouteVisuals();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, release);
    this.events.once(Phaser.Scenes.Events.DESTROY, release);
  }

  update(time: number): void {
    if (!this.latest) return;
    if (this.latest.reducedMotion) {
      this.ambientLayer.setPosition(0, 0);
    } else {
      this.ambientLayer.setPosition(Math.sin(time / 9500) * 4, Math.cos(time / 12_500) * 3);
    }
    this.updateRoutePresentation(time);
    this.updateRoverPositions(time);
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setRoundPixels(false);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.input.on("wheel", this.handleWheel, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.syncViewport(camera.width, camera.height);
  }

  private handleResize(gameSize: { width: number; height: number }): void {
    this.syncViewport(gameSize.width, gameSize.height);
  }

  private syncViewport(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const camera = this.cameras.main;
    camera.panEffect.reset();
    camera.zoomEffect.reset();
    camera.setSize(width, height);

    const contentBounds = this.wholeMapBounds();
    const fitZoom = this.calculateFitZoom(contentBounds, MAP_FIT_PADDING);
    this.resizeBackdrop(contentBounds, fitZoom);
    this.showWholeMap(false);
  }

  private handleCameraCommand(command: CameraCommand): void {
    if (command === "fitAll") {
      this.showWholeMap(true);
      return;
    }
    this.adjustZoom(command === "zoomIn" ? CAMERA_ZOOM_STEP : 1 / CAMERA_ZOOM_STEP);
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    this.adjustZoom(deltaY < 0 ? 1.12 : 1 / 1.12, pointer);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.isDown || !pointer.leftButtonDown()) return;
    const deltaX = pointer.x - pointer.prevPosition.x;
    const deltaY = pointer.y - pointer.prevPosition.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 1) return;
    const camera = this.cameras.main;
    camera.scrollX -= deltaX / camera.zoom;
    camera.scrollY -= deltaY / camera.zoom;
  }

  private adjustZoom(factor: number, pointer?: Phaser.Input.Pointer): void {
    const camera = this.cameras.main;
    const before = pointer ? camera.getWorldPoint(pointer.x, pointer.y) : null;
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * factor, this.minimumZoom, CAMERA_MAX_ZOOM));
    if (before && pointer) {
      const after = camera.getWorldPoint(pointer.x, pointer.y);
      camera.scrollX += before.x - after.x;
      camera.scrollY += before.y - after.y;
    }
    camera.scrollX = camera.clampX(camera.scrollX);
    camera.scrollY = camera.clampY(camera.scrollY);
  }

  private showWholeMap(animate: boolean): void {
    this.frameBounds(this.wholeMapBounds(), MAP_FIT_PADDING, animate);
  }

  private wholeMapBounds(): Phaser.Geom.Rectangle {
    const points = [
      new Phaser.Math.Vector2(SELENA_POSITION.x - 220, SELENA_POSITION.y - 145),
      new Phaser.Math.Vector2(SELENA_POSITION.x + 220, SELENA_POSITION.y + 210),
    ];

    if (this.latest) {
      for (const destination of this.latest.map.destinations) {
        points.push(
          new Phaser.Math.Vector2(destination.position.x - 62, destination.position.y - 88),
          new Phaser.Math.Vector2(destination.position.x + 154, destination.position.y + 58),
        );
      }
      for (const route of this.latest.map.routes) {
        const destination = this.latest.map.destinations.find(
          (item) => item.id === route.destinationId,
        );
        if (destination) points.push(...this.pointsForRoute(route, destination));
      }
    } else {
      points.push(new Phaser.Math.Vector2(188, 130), new Phaser.Math.Vector2(1454, 843));
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    return new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY);
  }

  private calculateFitZoom(bounds: Phaser.Geom.Rectangle, padding: number): number {
    const camera = this.cameras.main;
    const availableWidth = Math.max(camera.width - padding * 2, 1);
    const availableHeight = Math.max(camera.height - padding * 2, 1);
    return Phaser.Math.Clamp(
      Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)),
      CAMERA_ABSOLUTE_MIN_ZOOM,
      CAMERA_MAX_ZOOM,
    );
  }

  private frameBounds(bounds: Phaser.Geom.Rectangle, padding: number, animate: boolean): void {
    const camera = this.cameras.main;
    const zoom = Phaser.Math.Clamp(
      this.calculateFitZoom(bounds, padding),
      this.minimumZoom,
      CAMERA_MAX_ZOOM,
    );
    const centerX = bounds.centerX;
    const centerY = bounds.centerY;
    if (animate && !this.latest?.reducedMotion) {
      camera.pan(centerX, centerY, 240, "Sine.easeInOut", true);
      camera.zoomTo(zoom, 240, "Sine.easeInOut", true);
    } else {
      camera.setZoom(zoom);
      camera.centerOn(centerX, centerY);
    }
  }

  private framePoints(points: Phaser.Math.Vector2[], animate = true, padding = 48): void {
    if (points.length === 0) return;
    const minX = Math.max(0, Math.min(...points.map((point) => point.x)) - 86);
    const maxX = Math.min(MAP_SIZE.width, Math.max(...points.map((point) => point.x)) + 86);
    const minY = Math.max(0, Math.min(...points.map((point) => point.y)) - 78);
    const maxY = Math.min(MAP_SIZE.height, Math.max(...points.map((point) => point.y)) + 94);
    const width = Math.max(maxX - minX, 320);
    const height = Math.max(maxY - minY, 260);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    this.frameBounds(
      new Phaser.Geom.Rectangle(centerX - width / 2, centerY - height / 2, width, height),
      padding,
      animate,
    );
  }

  private pointsForRoute(route: Route, destination: Destination): Phaser.Math.Vector2[] {
    return this.routeCurve(route, destination).getSpacedPoints(28);
  }

  private updateCameraFocus(snapshot: SceneSnapshot): void {
    const activeRouteIds = snapshot.game.deliveries
      .filter((delivery) => delivery.status === "active")
      .map((delivery) => delivery.routeId)
      .sort();
    const focusKey = [
      snapshot.selectedOrderId,
      snapshot.selectedRoverId,
      snapshot.selectedRouteId,
      activeRouteIds.join(","),
    ].join(":");
    if (focusKey === this.cameraFocusKey) return;
    this.cameraFocusKey = focusKey;

    const selectedOrder = snapshot.game.orders.find((order) => order.id === snapshot.selectedOrderId);
    const selectedDestination = snapshot.map.destinations.find(
      (destination) => destination.id === selectedOrder?.destinationId,
    );
    const selectedRoute = snapshot.map.routes.find((route) => route.id === snapshot.selectedRouteId);
    if (selectedRoute && selectedDestination) {
      const selectedRover = snapshot.selectedRoverId
        ? this.roverVisuals.get(snapshot.selectedRoverId)
        : undefined;
      const destinationRoutes = snapshot.map.routes.filter(
        (route) => route.destinationId === selectedDestination.id,
      );
      const baseAndRover = [
        new Phaser.Math.Vector2(SELENA_POSITION.x - 150, SELENA_POSITION.y - 130),
        new Phaser.Math.Vector2(SELENA_POSITION.x + 150, SELENA_POSITION.y + 180),
      ];
      if (selectedRover) {
        baseAndRover.push(new Phaser.Math.Vector2(selectedRover.container.x, selectedRover.container.y));
      }
      this.framePoints([
        ...destinationRoutes.flatMap((route) => this.pointsForRoute(route, selectedDestination)),
        ...baseAndRover,
      ], true, 84);
      return;
    }
    if (selectedDestination) {
      const destinationRoutes = snapshot.selectedRoverId
        ? snapshot.map.routes.filter((route) => route.destinationId === selectedDestination.id)
        : [];
      this.framePoints(
        destinationRoutes.length > 0
          ? [
              ...destinationRoutes.flatMap((route) => this.pointsForRoute(route, selectedDestination)),
              new Phaser.Math.Vector2(SELENA_POSITION.x - 150, SELENA_POSITION.y - 130),
              new Phaser.Math.Vector2(SELENA_POSITION.x + 150, SELENA_POSITION.y + 180),
            ]
          : [
              new Phaser.Math.Vector2(SELENA_POSITION.x, SELENA_POSITION.y),
              new Phaser.Math.Vector2(selectedDestination.position.x, selectedDestination.position.y),
            ],
        true,
        destinationRoutes.length > 0 ? 84 : 48,
      );
      return;
    }
    if (activeRouteIds.length > 0) {
      const points = activeRouteIds.flatMap((routeId) => {
        const route = snapshot.map.routes.find((item) => item.id === routeId);
        const destination = route
          ? snapshot.map.destinations.find((item) => item.id === route.destinationId)
          : undefined;
        return route && destination ? this.pointsForRoute(route, destination) : [];
      });
      this.framePoints(points);
      return;
    }
    if (snapshot.selectedRoverId) {
      const rover = this.roverVisuals.get(snapshot.selectedRoverId);
      if (rover) this.framePoints([new Phaser.Math.Vector2(rover.container.x, rover.container.y)]);
    }
  }

  private drawBackdrop(): void {
    this.backdrop = this.add
      .image(MAP_SIZE.width / 2, MAP_SIZE.height / 2, MAP_BACKGROUND_TEXTURES.landscape.key)
      .setOrigin(0.5)
      .setDepth(-100);

    this.backdropShade = this.add.graphics().setDepth(-90);

    const relief = this.add.graphics().setDepth(1);
    const shelves = [
      [110, 160, 430, 170, -0.18],
      [1210, 120, 390, 145, 0.14],
      [1030, 690, 540, 190, -0.08],
      [300, 680, 470, 170, 0.12],
    ] as const;
    for (const [x, y, width, height, rotation] of shelves) {
      relief.fillStyle(COLORS.regolithDark, 0.18);
      relief.fillEllipse(x + 18, y + 19, width, height);
      relief.fillStyle(COLORS.regolithLight, 0.16);
      relief.fillEllipse(x, y, width, height);
      relief.setRotation(rotation);
    }

    this.ambientLayer = this.add.container(0, 0).setDepth(3);
    for (let index = 0; index < 520; index += 1) {
      const x = (index * 97 + 41) % MAP_SIZE.width;
      const y = (index * 173 + index * index) % MAP_SIZE.height;
      const bright = index % 11 === 0;
      this.ambientLayer.add(
        this.add.circle(
          x,
          y,
          bright ? 1.25 : 0.65,
          bright ? 0xc6ccca : 0x090c0f,
          bright ? 0.08 : 0.12,
        ),
      );
    }

    const contour = this.add.graphics().setDepth(4);
    contour.lineStyle(1, 0x97a5a8, 0.06);
    for (let index = 0; index < 7; index += 1) {
      contour.strokeEllipse(800, 460, 430 + index * 160, 190 + index * 82);
    }
  }

  private resizeBackdrop(contentBounds: Phaser.Geom.Rectangle, fitZoom: number): void {
    const camera = this.cameras.main;
    const texture = camera.width / camera.height < NARROW_BACKDROP_ASPECT
      ? MAP_BACKGROUND_TEXTURES.square
      : MAP_BACKGROUND_TEXTURES.landscape;
    if (this.backdrop.texture.key !== texture.key) this.backdrop.setTexture(texture.key);

    const visibleWidth = camera.width / fitZoom;
    const visibleHeight = camera.height / fitZoom;
    const baseBounds = new Phaser.Geom.Rectangle(
      -BACKDROP_WORLD_MARGIN,
      -BACKDROP_WORLD_MARGIN,
      MAP_SIZE.width + BACKDROP_WORLD_MARGIN * 2,
      MAP_SIZE.height + BACKDROP_WORLD_MARGIN * 2,
    );
    const fitBounds = new Phaser.Geom.Rectangle(
      contentBounds.centerX - visibleWidth / 2 - BACKDROP_FIT_GUARD,
      contentBounds.centerY - visibleHeight / 2 - BACKDROP_FIT_GUARD,
      visibleWidth + BACKDROP_FIT_GUARD * 2,
      visibleHeight + BACKDROP_FIT_GUARD * 2,
    );
    const requiredBounds = Phaser.Geom.Rectangle.Union(baseBounds, fitBounds);
    const coverScale = Math.max(
      requiredBounds.width / this.backdrop.width,
      requiredBounds.height / this.backdrop.height,
    );
    const backgroundWidth = this.backdrop.width * coverScale;
    const backgroundHeight = this.backdrop.height * coverScale;
    this.backdrop.setPosition(requiredBounds.centerX, requiredBounds.centerY).setScale(coverScale);

    this.cameraBounds.setTo(
      requiredBounds.centerX - backgroundWidth / 2 + CAMERA_BOUNDS_INSET,
      requiredBounds.centerY - backgroundHeight / 2 + CAMERA_BOUNDS_INSET,
      backgroundWidth - CAMERA_BOUNDS_INSET * 2,
      backgroundHeight - CAMERA_BOUNDS_INSET * 2,
    );
    camera.setBounds(
      this.cameraBounds.x,
      this.cameraBounds.y,
      this.cameraBounds.width,
      this.cameraBounds.height,
    );
    this.minimumZoom = Math.max(
      CAMERA_ABSOLUTE_MIN_ZOOM,
      camera.width / this.cameraBounds.width,
      camera.height / this.cameraBounds.height,
    );
    this.redrawBackdropShade();
  }

  private redrawBackdropShade(): void {
    const shade = this.backdropShade;
    shade.clear();
    shade.fillStyle(COLORS.void, 0.2);
    shade.fillRect(
      this.cameraBounds.x,
      this.cameraBounds.y,
      this.cameraBounds.width,
      this.cameraBounds.height,
    );
    shade.fillGradientStyle(0x111922, 0x0a1018, 0x070b10, 0x05080c, 0.08, 0.12, 0.24, 0.3);
    shade.fillRect(
      this.cameraBounds.x,
      this.cameraBounds.y,
      this.cameraBounds.width,
      this.cameraBounds.height,
    );

    shade.fillStyle(0x9ca8ad, 0.035);
    shade.fillEllipse(390, 220, 860, 360);
    shade.fillStyle(0x05080c, 0.1);
    shade.fillEllipse(1320, 690, 760, 430);
    shade.fillStyle(0xaab2b4, 0.025);
    shade.fillEllipse(930, 480, 1120, 620);
  }

  private drawTerrain(zones: TerrainZone[]): void {
    if (this.terrainDrawn) return;
    this.terrainDrawn = true;

    const zoneColors: Record<TerrainZone["kind"], number> = {
      plain: 0x7d8585,
      craters: 0x11171c,
      ridge: 0x929a9a,
      dust: 0x716d65,
      shadow: 0x070b0f,
    };
    for (const zone of zones) {
      const graphic = this.add.graphics().setDepth(5);
      graphic.fillStyle(zoneColors[zone.kind], zone.kind === "shadow" ? 0.34 : 0.1);
      graphic.fillEllipse(zone.position.x, zone.position.y, zone.radius.x * 2, zone.radius.y * 2);
      graphic.lineStyle(1, 0xa8b3b4, 0.08);
      graphic.strokeEllipse(zone.position.x, zone.position.y, zone.radius.x * 2, zone.radius.y * 2);
      graphic.setRotation(zone.rotation);

      this.add
        .text(zone.position.x, zone.position.y - zone.radius.y - 10, zone.name, {
          fontFamily: "Bahnschrift, Arial Narrow, sans-serif",
          fontSize: "12px",
          color: "#9aa7a9",
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setAlpha(0.55)
        .setDepth(18);
    }

    const craters = [
      [108, 130, "kenney-terrain-craterLarge", 0.95],
      [270, 365, "kenney-terrain-crater", 0.72],
      [460, 760, "kenney-terrain-craterLarge", 1.15],
      [1080, 360, "kenney-terrain-crater", 0.76],
      [1215, 500, "kenney-terrain-craterLarge", 1.08],
      [1450, 260, "kenney-terrain-crater", 0.8],
      [1400, 780, "kenney-terrain-craterLarge", 1.35],
      [690, 150, "kenney-terrain-crater", 0.65],
    ] as const;
    for (const [x, y, texture, scale] of craters) {
      const shadow = this.add.ellipse(x + 8, y + 8, 92 * scale, 42 * scale, 0x05080b, 0.24).setDepth(y - 2);
      shadow.setRotation(-0.16);
      this.add.image(x, y, texture).setScale(scale).setTint(0x9ca5a5).setAlpha(0.84).setDepth(y);
    }

    const rocks = [
      [170, 510, "kenney-terrain-rocksTall", 0.52],
      [330, 150, "kenney-terrain-rocks", 0.42],
      [510, 430, "kenney-terrain-rocksSmall", 0.35],
      [560, 720, "kenney-terrain-rocksTall", 0.52],
      [1010, 170, "kenney-terrain-rocksOre", 0.42],
      [1110, 580, "kenney-terrain-rocks", 0.48],
      [1290, 340, "kenney-terrain-rocksTall", 0.5],
      [1490, 610, "kenney-terrain-meteor", 0.52],
      [930, 820, "kenney-terrain-rocksSmall", 0.36],
    ] as const;
    for (const [x, y, texture, scale] of rocks) {
      this.add.ellipse(x + 8, y + 13, 80 * scale, 28 * scale, 0x05080b, 0.32).setDepth(y - 1);
      this.add.image(x, y, texture).setOrigin(0.5, 0.78).setScale(scale).setTint(0x939b9b).setDepth(y);
    }

    const tracks = this.add.graphics().setDepth(20);
    tracks.lineStyle(2, 0x0c1115, 0.18);
    for (let index = 0; index < 18; index += 1) {
      const x = 650 + index * 14;
      const y = 515 + Math.sin(index * 0.45) * 14;
      tracks.lineBetween(x - 4, y - 4, x + 2, y + 2);
      tracks.lineBetween(x + 3, y - 7, x + 9, y - 1);
    }
  }

  private addWorldSprite(
    x: number,
    y: number,
    texture: string,
    scale: number,
    tint = 0xaab2b2,
    depthOffset = 0,
  ): Phaser.GameObjects.Image {
    const depth = 1120 + y / 10 + depthOffset;
    this.add.ellipse(x + 12, y + 13, 150 * scale, 42 * scale, 0x05080b, 0.34).setDepth(depth - 1);
    return this.add
      .image(x, y, texture)
      .setOrigin(0.5, 0.8)
      .setScale(scale)
      .setTint(tint)
      .setDepth(depth);
  }

  private drawSelenaComplex(): void {
    this.addWorldSprite(SELENA_POSITION.x, SELENA_POSITION.y + 18, "kenney-base-solarDeck", 0.44, 0x9da8a8, 35);
    this.addWorldSprite(SELENA_POSITION.x - 82, SELENA_POSITION.y - 10, "kenney-base-corridor", 0.48, 0xa8b1b1, 40);
    this.addWorldSprite(SELENA_POSITION.x + 58, SELENA_POSITION.y + 3, "kenney-base-corner", 0.48, 0xa8b1b1, 40);
    this.addWorldSprite(SELENA_POSITION.x - 18, SELENA_POSITION.y - 48, "kenney-base-habitat", 0.5, 0xaab4b4, 40);
    this.addWorldSprite(SELENA_POSITION.x + 98, SELENA_POSITION.y - 42, "kenney-base-stationLarge", 0.72, 0xc2c9c7, 44);
    this.addWorldSprite(SELENA_POSITION.x - 132, SELENA_POSITION.y + 35, "kenney-base-dish", 0.6, 0xb5bdbd, 44);
    this.addWorldSprite(SELENA_POSITION.x + 156, SELENA_POSITION.y + 36, "kenney-base-consoleScreen", 0.58, 0x9fa8a8, 44);
    this.addWorldSprite(SELENA_POSITION.x - 170, SELENA_POSITION.y + 73, "kenney-base-barrelLarge", 1.25, 0xaab0ae, 44);
    this.addWorldSprite(SELENA_POSITION.x + 188, SELENA_POSITION.y + 76, "kenney-base-barrel", 1.65, 0xaab0ae, 44);

    const pad = this.add.graphics().setDepth(1110);
    pad.lineStyle(2, COLORS.cyan, 0.42);
    pad.strokeEllipse(SELENA_POSITION.x, SELENA_POSITION.y + 76, 310, 92);
    pad.lineStyle(1, COLORS.cyan, 0.18);
    pad.strokeEllipse(SELENA_POSITION.x, SELENA_POSITION.y + 76, 350, 118);

    this.add
      .text(SELENA_POSITION.x, SELENA_POSITION.y + 145, "БАЗА СЕЛЕНА", {
        fontFamily: "Bahnschrift, Arial Narrow, sans-serif",
        fontSize: "25px",
        fontStyle: "bold",
        color: "#edf3f1",
        letterSpacing: 5,
        backgroundColor: "#11171bd9",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(1500);
    this.add
      .text(SELENA_POSITION.x, SELENA_POSITION.y + 178, "ЦЕНТР УПРАВЛЕНИЯ ДОСТАВКАМИ", {
        fontFamily: "Consolas, monospace",
        fontSize: "11px",
        color: "#85ceda",
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(1500);
  }

  private applySnapshot(snapshot: SceneSnapshot): void {
    const isFirstSnapshot = this.latest === null;
    this.latest = snapshot;
    this.drawTerrain(snapshot.map.zones);
    if (this.destinationVisuals.size === 0) {
      snapshot.map.destinations.forEach((destination) => this.createDestination(destination));
    }
    if (this.roverVisuals.size === 0) {
      snapshot.game.rovers.forEach((rover, index) => this.createRover(rover, index));
    }

    const activeRouteKey = snapshot.game.deliveries
      .filter((delivery) => delivery.status === "active")
      .map((delivery) => delivery.routeId)
      .sort()
      .join(",");
    const previewKey = Object.entries(snapshot.previews)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([routeId, preview]) => (
        `${routeId}:${preview.durationSeconds}:${preview.energyCost}:${preview.risk}`
      ))
      .join(",");
    const routeRenderKey = [
      snapshot.selectedOrderId,
      snapshot.selectedRoverId,
      activeRouteKey,
      previewKey,
    ].join(":");
    if (routeRenderKey !== this.routeRenderKey) {
      this.routeRenderKey = routeRenderKey;
      this.drawRoutes(snapshot);
    }
    this.syncRouteStates(snapshot);
    this.syncDestinations(snapshot);
    this.syncRovers(snapshot);
    if (isFirstSnapshot) {
      this.syncViewport(this.cameras.main.width, this.cameras.main.height);
    }
    this.updateCameraFocus(snapshot);
  }

  private createDestination(destination: Destination): void {
    const art = DESTINATION_TEXTURES[destination.id] ?? DESTINATION_TEXTURES["beacon-7"];
    const container = this.add
      .container(destination.position.x, destination.position.y)
      .setDepth(900 + destination.position.y);
    const shadow = this.add.ellipse(0, 10, 112, 34, 0x05080b, 0.38);
    const sprite = this.add.image(0, 3, art.texture).setOrigin(0.5, 0.78).setScale(art.scale);
    if (art.tint) sprite.setTint(art.tint);
    const halo = this.add.circle(0, 3, 48, COLORS.cyan, 0.02).setStrokeStyle(2, COLORS.cyan, 0.25);
    const ring = this.add.circle(0, 3, 30, COLORS.cyan, 0.03).setStrokeStyle(2, COLORS.cyan, 0.76);
    const core = this.add.circle(0, 3, 5, COLORS.cyan, 0.98);
    const labelPlate = this.add.rectangle(72, -10, 144, 55, 0x0d1318, 0.88).setStrokeStyle(1, 0x7a8b8f, 0.34);
    const code = this.add.text(10, -28, `${destination.code} · ${destination.subtitle}`, {
      fontFamily: "Consolas, monospace",
      fontSize: "10px",
      color: "#92a8ac",
    });
    const name = this.add.text(10, -10, destination.name.toUpperCase(), {
      fontFamily: "Bahnschrift, Arial Narrow, sans-serif",
      fontSize: "18px",
      fontStyle: "bold",
      color: "#e6eeee",
      letterSpacing: 1,
    });
    const distance = Math.hypot(
      destination.position.x - SELENA_POSITION.x,
      destination.position.y - SELENA_POSITION.y,
    );
    const distanceLabel = this.add.text(10, 11, `${Math.round(distance / 28)} км от базы`, {
      fontFamily: "Consolas, monospace",
      fontSize: "10px",
      color: "#76c9d7",
    });
    const orderCount = this.add
      .text(-5, -4, "", {
        fontFamily: "Consolas, monospace",
        fontSize: "11px",
        fontStyle: "bold",
        color: "#061015",
      })
      .setOrigin(0.5);
    container.add([shadow, sprite, halo, ring, core, labelPlate, code, name, distanceLabel, orderCount]);
    container.setSize(190, 96).setInteractive({ useHandCursor: true });
    container.on("pointerdown", () => {
      const order = this.latest?.game.orders.find(
        (item) => item.destinationId === destination.id && item.status === "available",
      );
      if (order) this.bridge.emit("orderSelected", order.id);
    });
    const tween = this.tweens.add({
      targets: halo,
      scale: 1.45,
      alpha: 0.01,
      duration: 1550,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });
    this.destinationVisuals.set(destination.id, { container, ring, halo, core, orderCount, tween });
  }

  private syncDestinations(snapshot: SceneSnapshot): void {
    for (const destination of snapshot.map.destinations) {
      const visual = this.destinationVisuals.get(destination.id);
      if (!visual) continue;
      const available = snapshot.game.orders.filter(
        (order) => order.destinationId === destination.id && order.status === "available",
      );
      const selectedOrder = snapshot.game.orders.find((order) => order.id === snapshot.selectedOrderId);
      const selected = selectedOrder?.destinationId === destination.id;
      const active = snapshot.game.deliveries.some(
        (delivery) =>
          delivery.status === "active" &&
          snapshot.game.orders.find((order) => order.id === delivery.orderId)?.destinationId === destination.id,
      );
      const color = active ? COLORS.green : selected ? COLORS.amber : COLORS.cyan;
      visual.core.setFillStyle(color, available.length > 0 || active ? 1 : 0.38);
      visual.ring.setStrokeStyle(selected ? 4 : 2, color, selected || active ? 1 : 0.68);
      visual.ring.setScale(selected ? 1.22 : 1);
      visual.orderCount.setText(available.length > 1 ? String(available.length) : "");
      if (snapshot.reducedMotion || available.length === 0) visual.tween.pause();
      else visual.tween.resume();
    }
  }

  private drawRoutes(snapshot: SceneSnapshot): void {
    this.routeLayer.clear();
    this.clearRouteVisuals();

    const selectedOrder = snapshot.game.orders.find((order) => order.id === snapshot.selectedOrderId);
    const selectedDestinationId = selectedOrder?.destinationId;

    if (!selectedDestinationId) {
      for (const destination of snapshot.map.destinations) {
        const safe = snapshot.map.routes.find(
          (route) => route.destinationId === destination.id && route.kind === "safe",
        );
        if (safe) this.strokeStaticRoute(safe, COLORS.cyan, 0.22, 2);
      }
    }

    if (selectedDestinationId) {
      snapshot.map.routes
        .filter((route) => route.destinationId === selectedDestinationId)
        .sort((left, right) => ROUTE_KIND_ORDER[left.kind] - ROUTE_KIND_ORDER[right.kind])
        .forEach((route) => this.createRouteVisual(route, snapshot));
    }

    snapshot.game.deliveries
      .filter((delivery) => delivery.status === "active")
      .forEach((delivery) => {
        const route = snapshot.map.routes.find((item) => item.id === delivery.routeId);
        if (route) {
          this.strokeStaticRoute(route, COLORS.green, 0.92, 4.5);
        }
      });
  }

  private clearRouteVisuals(): void {
    for (const visual of this.routeVisuals.values()) {
      this.tweens.killTweensOf([visual.container, visual.glow, visual.emphasis, visual.label]);
      visual.container.destroy(true);
    }
    this.routeVisuals.clear();
    this.routeHitTargets.splice(0).forEach((target) => target.destroy());
    this.hoveredRouteId = null;
  }

  private strokeStaticRoute(route: Route, color: number, alpha: number, width: number): void {
    const destination = this.latest?.map.destinations.find((item) => item.id === route.destinationId);
    if (!destination) return;
    const curve = this.routeCurve(route, destination);
    this.routeLayer.lineStyle(width + 6, 0x030609, alpha * 0.58);
    curve.draw(this.routeLayer, 64);
    this.routeLayer.lineStyle(width + 3, color, alpha * 0.12);
    curve.draw(this.routeLayer, 64);
    this.routeLayer.lineStyle(width, color, alpha);
    curve.draw(this.routeLayer, 64);
  }

  private createRouteVisual(route: Route, snapshot: SceneSnapshot): void {
    const destination = snapshot.map.destinations.find((item) => item.id === route.destinationId);
    if (!destination) return;
    const curve = this.routeCurve(route, destination);
    const color = ROUTE_COLORS[route.kind];
    const container = this.add.container(0, 0).setDepth(1002 + ROUTE_KIND_ORDER[route.kind]);
    const glow = this.add.graphics();
    glow.lineStyle(12, color, 0.12);
    curve.draw(glow, 96);
    const underlay = this.add.graphics();
    underlay.lineStyle(9, 0x020507, 0.76);
    curve.draw(underlay, 96);
    const line = this.add.graphics();
    this.drawRoutePattern(line, curve, route.kind, 3.5, color, 0.96);
    const emphasis = this.add.graphics().setAlpha(0);
    this.drawRoutePattern(emphasis, curve, route.kind, 5.25, color, 0.52);
    container.add([glow, underlay, line, emphasis]);

    const arrows = [0.2, 0.5, 0.8].map((progress) => {
      const arrow = this.createRouteArrow(color);
      this.positionRouteArrow(arrow, curve, progress);
      container.add(arrow);
      return arrow;
    });
    const hazardMarkers = this.createHazardMarkers(route, curve, color, container);
    const label = this.createRouteLabel(route, snapshot, color);
    container.add(label);

    const hitZones: Phaser.GameObjects.Zone[] = [];
    if (snapshot.selectedRoverId) {
      for (let index = 3; index <= 27; index += 1) {
        const point = curve.getPoint(index / 30);
        const zone = this.add
          .zone(point.x, point.y, ROUTE_HIT_SIZE_PX, ROUTE_HIT_SIZE_PX)
          .setDepth(1040)
          .setInteractive({ useHandCursor: true });
        zone.on("pointerover", () => this.setRouteHovered(route.id, true));
        zone.on("pointerout", () => this.setRouteHovered(route.id, false));
        zone.on("pointerdown", () => this.bridge.emit("routeSelected", route.id));
        hitZones.push(zone);
        this.routeHitTargets.push(zone);
      }
    }

    this.routeVisuals.set(route.id, {
      route,
      curve,
      arcNormal: this.routeArcNormal(destination),
      container,
      glow,
      emphasis,
      label,
      arrows,
      hazardMarkers,
      hitZones,
      selected: false,
      hovered: false,
    });
  }

  private drawRoutePattern(
    graphics: Phaser.GameObjects.Graphics,
    curve: Phaser.Curves.CubicBezier,
    kind: Route["kind"],
    width: number,
    color: number,
    alpha: number,
  ): void {
    graphics.lineStyle(width, color, alpha);
    if (kind === "safe") {
      curve.draw(graphics, 112);
      return;
    }
    this.drawDashedCurve(
      graphics,
      curve,
      kind === "economic" ? 72 : 28,
      kind === "economic" ? 32 : 18,
    );
  }

  private drawDashedCurve(
    graphics: Phaser.GameObjects.Graphics,
    curve: Phaser.Curves.CubicBezier,
    dashLength: number,
    gapLength: number,
  ): void {
    const points = curve.getSpacedPoints(180);
    let drawing = true;
    let remaining = dashLength;
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      remaining -= Phaser.Math.Distance.Between(previous.x, previous.y, point.x, point.y);
      if (drawing) graphics.lineTo(point.x, point.y);
      else graphics.moveTo(point.x, point.y);
      if (remaining <= 0) {
        drawing = !drawing;
        remaining += drawing ? dashLength : gapLength;
        graphics.moveTo(point.x, point.y);
      }
    }
    graphics.strokePath();
  }

  private createRouteArrow(color: number): Phaser.GameObjects.Graphics {
    const arrow = this.add.graphics();
    arrow.fillStyle(0x020507, 0.82);
    arrow.fillTriangle(-8, -6, 10, 0, -8, 6);
    arrow.fillStyle(color, 0.96);
    arrow.fillTriangle(-5, -3.5, 7, 0, -5, 3.5);
    return arrow;
  }

  private positionRouteArrow(
    arrow: Phaser.GameObjects.Graphics,
    curve: Phaser.Curves.CubicBezier,
    progress: number,
  ): void {
    const point = curve.getPoint(progress);
    const tangent = curve.getTangent(progress);
    arrow.setPosition(point.x, point.y).setRotation(Math.atan2(tangent.y, tangent.x));
  }

  private createHazardMarkers(
    route: Route,
    curve: Phaser.Curves.CubicBezier,
    color: number,
    parent: Phaser.GameObjects.Container,
  ): Phaser.GameObjects.Container[] {
    const progresses = route.kind === "fast" ? [0.36, 0.64] : route.kind === "economic" ? [0.66] : [];
    return progresses.map((progress) => {
      const point = curve.getPoint(progress);
      const marker = this.add.container(point.x, point.y);
      const plate = this.add.circle(0, 0, route.kind === "fast" ? 9 : 7, 0x111418, 0.94)
        .setStrokeStyle(1.5, color, 0.92);
      const symbol = this.add.text(0, route.kind === "fast" ? 0 : -1, route.kind === "fast" ? "!" : "◆", {
        fontFamily: "Consolas, monospace",
        fontSize: route.kind === "fast" ? "11px" : "7px",
        fontStyle: "bold",
        color: route.kind === "fast" ? "#ffb0a8" : "#f5cf8f",
      }).setOrigin(0.5);
      marker.add([plate, symbol]);
      parent.add(marker);
      return marker;
    });
  }

  private createRouteLabel(
    route: Route,
    snapshot: SceneSnapshot,
    color: number,
  ): Phaser.GameObjects.Container {
    const preview = snapshot.previews[route.id];
    const label = this.add.container(0, 0).setVisible(Boolean(preview));
    if (!preview) return label;

    const plate = this.add.rectangle(0, 0, ROUTE_LABEL_WIDTH, ROUTE_LABEL_HEIGHT, 0x0a1015, 0.94)
      .setStrokeStyle(1, color, 0.68);
    const accent = this.add.rectangle(-ROUTE_LABEL_WIDTH / 2 + 3, 0, 4, ROUTE_LABEL_HEIGHT - 8, color, 0.92);
    const pattern = route.kind === "safe" ? "━━━━" : route.kind === "economic" ? "━━  ━━" : "› › ›";
    const title = this.add.text(-91, -16, `${pattern}  ${route.name.toUpperCase()}`, {
      fontFamily: "Bahnschrift, Arial Narrow, sans-serif",
      fontSize: "11px",
      fontStyle: "bold",
      color: "#eef5f4",
    });
    const metrics = this.add.text(
      -91,
      5,
      `${preview.durationSeconds} с  ·  −${preview.energyCost} зар.  ·  риск ${formatPercent(preview.risk)}`,
      {
        fontFamily: "Consolas, monospace",
        fontSize: "9px",
        color: "#b9c8ca",
      },
    );
    label.add([plate, accent, title, metrics]);
    return label;
  }

  private setRouteHovered(routeId: string, hovered: boolean): void {
    if (hovered) this.hoveredRouteId = routeId;
    else if (this.hoveredRouteId === routeId) this.hoveredRouteId = null;
    if (this.latest) this.syncRouteStates(this.latest);
  }

  private syncRouteStates(snapshot: SceneSnapshot): void {
    const hasSelection = snapshot.selectedRouteId !== null;
    for (const visual of this.routeVisuals.values()) {
      visual.selected = visual.route.id === snapshot.selectedRouteId;
      visual.hovered = visual.route.id === this.hoveredRouteId;
      const alpha = visual.selected
        ? 1
        : visual.hovered
          ? 0.9
          : hasSelection
            ? 0.46
            : 0.8;
      const glowAlpha = visual.selected ? 1 : visual.hovered ? 0.62 : 0.24;
      const emphasisAlpha = visual.selected ? 0.9 : visual.hovered ? 0.5 : 0;
      visual.container.setDepth(
        visual.selected ? 1020 : visual.hovered ? 1015 : 1002 + ROUTE_KIND_ORDER[visual.route.kind],
      );
      this.tweens.killTweensOf([visual.container, visual.glow, visual.emphasis, visual.label]);
      this.tweens.add({
        targets: visual.container,
        alpha,
        duration: ROUTE_TRANSITION_MS,
        ease: "Sine.Out",
      });
      this.tweens.add({
        targets: visual.glow,
        alpha: glowAlpha,
        duration: ROUTE_TRANSITION_MS,
        ease: "Sine.Out",
      });
      this.tweens.add({
        targets: visual.emphasis,
        alpha: emphasisAlpha,
        duration: ROUTE_TRANSITION_MS,
        ease: "Sine.Out",
      });
    }
  }

  private updateRoutePresentation(time: number): void {
    if (this.routeVisuals.size === 0) return;
    const camera = this.cameras.main;
    const fixedScale = 1 / camera.zoom;
    for (const visual of this.routeVisuals.values()) {
      visual.arrows.forEach((arrow, index) => {
        const staticProgress = [0.2, 0.5, 0.8][index];
        const progress = visual.selected && !this.latest?.reducedMotion
          ? 0.1 + ((time * 0.00006 + index * 0.27) % 0.8)
          : staticProgress;
        this.positionRouteArrow(arrow, visual.curve, progress);
        arrow.setScale(fixedScale);
      });
      visual.hazardMarkers.forEach((marker) => marker.setScale(fixedScale));
      visual.hitZones.forEach((zone) => zone.setScale(fixedScale));
      visual.label.setScale(fixedScale);
    }
    this.layoutRouteLabels();
  }

  private layoutRouteLabels(): void {
    const camera = this.cameras.main;
    const occupied: Phaser.Geom.Rectangle[] = [];
    const blocked = [
      this.worldRectToScreen(new Phaser.Geom.Rectangle(
        SELENA_POSITION.x - 230,
        SELENA_POSITION.y - 150,
        460,
        365,
      )),
      ...(this.latest?.map.destinations.map((destination) => this.worldRectToScreen(
        new Phaser.Geom.Rectangle(
          destination.position.x - 70,
          destination.position.y - 90,
          230,
          160,
        ),
      )) ?? []),
    ];
    const visuals = [...this.routeVisuals.values()].sort(
      (left, right) => ROUTE_KIND_ORDER[left.route.kind] - ROUTE_KIND_ORDER[right.route.kind],
    );
    const routeScreenPoints = visuals.flatMap((visual) => (
      visual.curve.getSpacedPoints(48).map((point) => this.worldPointToScreen(point))
    ));
    for (const visual of visuals) {
      if (!visual.label.visible) continue;
      const placement = this.findRouteLabelPlacement(
        visual,
        [...blocked, ...occupied],
        routeScreenPoints,
      );
      const worldX = camera.worldView.x + placement.x / camera.zoom;
      const worldY = camera.worldView.y + placement.y / camera.zoom;
      visual.label.setPosition(worldX, worldY);
      occupied.push(new Phaser.Geom.Rectangle(
        placement.x - ROUTE_LABEL_WIDTH / 2,
        placement.y - ROUTE_LABEL_HEIGHT / 2,
        ROUTE_LABEL_WIDTH,
        ROUTE_LABEL_HEIGHT,
      ));
    }
  }

  private findRouteLabelPlacement(
    visual: RouteVisual,
    blocked: Phaser.Geom.Rectangle[],
    routeScreenPoints: Phaser.Math.Vector2[],
  ): Phaser.Math.Vector2 {
    const camera = this.cameras.main;
    const progressCandidates: Record<Route["kind"], number[]> = {
      safe: [0.32, 0.4, 0.48, 0.56],
      economic: [0.5, 0.58, 0.42, 0.66],
      fast: [0.68, 0.6, 0.76, 0.52],
    };
    const preferredSide = visual.route.kind === "fast" ? -1 : 1;
    const offsets = [58, 78, -58, -78].map((offset) => offset * preferredSide);
    const fallback = new Phaser.Math.Vector2(camera.width / 2, camera.height / 2);

    for (const progress of progressCandidates[visual.route.kind]) {
      const point = visual.curve.getPoint(progress);
      const tangent = visual.curve.getTangent(progress).normalize();
      const normal = new Phaser.Math.Vector2(-tangent.y, tangent.x);
      if (normal.dot(visual.arcNormal) < 0) normal.scale(-1);
      const screenPoint = this.worldPointToScreen(point);
      for (const offset of offsets) {
        const centerX = screenPoint.x + normal.x * offset;
        const centerY = screenPoint.y + normal.y * offset;
        fallback.set(centerX, centerY);
        const rect = new Phaser.Geom.Rectangle(
          centerX - ROUTE_LABEL_WIDTH / 2,
          centerY - ROUTE_LABEL_HEIGHT / 2,
          ROUTE_LABEL_WIDTH,
          ROUTE_LABEL_HEIGHT,
        );
        const insideViewport = rect.x >= 12
          && rect.y >= 12
          && rect.right <= camera.width - 12
          && rect.bottom <= camera.height - 12;
        if (!insideViewport) continue;
        if (blocked.some((item) => Phaser.Geom.Intersects.RectangleToRectangle(rect, item))) continue;
        if (this.labelCrossesRoute(rect, routeScreenPoints)) continue;
        return new Phaser.Math.Vector2(centerX, centerY);
      }
    }

    fallback.x = Phaser.Math.Clamp(
      fallback.x,
      12 + ROUTE_LABEL_WIDTH / 2,
      camera.width - 12 - ROUTE_LABEL_WIDTH / 2,
    );
    fallback.y = Phaser.Math.Clamp(
      fallback.y,
      12 + ROUTE_LABEL_HEIGHT / 2,
      camera.height - 12 - ROUTE_LABEL_HEIGHT / 2,
    );
    return fallback;
  }

  private labelCrossesRoute(
    rect: Phaser.Geom.Rectangle,
    routeScreenPoints: Phaser.Math.Vector2[],
  ): boolean {
    return routeScreenPoints.some((point) => (
      Phaser.Geom.Rectangle.Contains(rect, point.x, point.y)
    ));
  }

  private worldPointToScreen(point: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    const camera = this.cameras.main;
    return new Phaser.Math.Vector2(
      (point.x - camera.worldView.x) * camera.zoom,
      (point.y - camera.worldView.y) * camera.zoom,
    );
  }

  private worldRectToScreen(rect: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const topLeft = this.worldPointToScreen(new Phaser.Math.Vector2(rect.x, rect.y));
    return new Phaser.Geom.Rectangle(
      topLeft.x,
      topLeft.y,
      rect.width * this.cameras.main.zoom,
      rect.height * this.cameras.main.zoom,
    );
  }

  private routeArcNormal(destination: Destination): Phaser.Math.Vector2 {
    const start = new Phaser.Math.Vector2(SELENA_POSITION.x, SELENA_POSITION.y + 58);
    const delta = new Phaser.Math.Vector2(
      destination.position.x - start.x,
      destination.position.y - start.y,
    );
    const normal = new Phaser.Math.Vector2(-delta.y, delta.x).normalize();
    const verticalDirection = Math.sign(delta.y);
    if (verticalDirection !== 0 && Math.sign(normal.y) !== verticalDirection) normal.scale(-1);
    if (Math.abs(delta.y) < 24 && Math.sign(normal.x) !== Math.sign(delta.x)) normal.scale(-1);
    return normal;
  }

  private routeCurve(route: Route, destination: Destination): Phaser.Curves.CubicBezier {
    const start = new Phaser.Math.Vector2(SELENA_POSITION.x, SELENA_POSITION.y + 58);
    const finish = new Phaser.Math.Vector2(destination.position.x, destination.position.y);
    const delta = new Phaser.Math.Vector2(finish.x - start.x, finish.y - start.y);
    const distance = delta.length();
    const normal = this.routeArcNormal(destination);
    const laneGap = Phaser.Math.Clamp(distance * 0.2, 110, 132);
    const arcMultiplier: Record<Route["kind"], number> = {
      fast: 0.08,
      economic: 1.08,
      safe: 2.08,
    };
    const arc = laneGap * arcMultiplier[route.kind];
    return new Phaser.Curves.CubicBezier(
      start,
      new Phaser.Math.Vector2(
        start.x + delta.x * 0.32 + normal.x * arc,
        start.y + delta.y * 0.32 + normal.y * arc,
      ),
      new Phaser.Math.Vector2(
        start.x + delta.x * 0.68 + normal.x * arc,
        start.y + delta.y * 0.68 + normal.y * arc,
      ),
      finish,
    );
  }

  private createRover(rover: Rover, index: number): void {
    const positions = [
      [SELENA_POSITION.x - 95, SELENA_POSITION.y + 90],
      [SELENA_POSITION.x, SELENA_POSITION.y + 112],
      [SELENA_POSITION.x + 102, SELENA_POSITION.y + 92],
    ] as const;
    const [x, y] = positions[index] ?? positions[0];
    const container = this.add.container(x, y).setDepth(1300 + y);
    const statusRing = this.add.circle(0, 5, 36, COLORS.cyan, 0.04).setStrokeStyle(2, COLORS.cyan, 0.54);
    const sprite = this.add.image(0, 0, roverTextureKey(rover.id, "SW")).setScale(this.roverScale(rover.id));
    const label = this.add
      .text(0, 39, rover.code, {
        fontFamily: "Consolas, monospace",
        fontSize: "10px",
        fontStyle: "bold",
        color: "#d8e4e3",
        backgroundColor: "#0b1116e6",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5);
    container.add([statusRing, sprite, label]);
    container.setSize(82, 72).setInteractive({ useHandCursor: true });
    container.on("pointerdown", () => this.bridge.emit("roverSelected", rover.id));
    this.roverVisuals.set(rover.id, { container, sprite, statusRing, label, direction: "SW" });
  }

  private roverScale(roverId: string): number {
    if (roverId === "rover-swift") return 0.27;
    if (roverId === "rover-titan") return 0.36;
    return 0.31;
  }

  private syncRovers(snapshot: SceneSnapshot): void {
    const positions = [
      [SELENA_POSITION.x - 95, SELENA_POSITION.y + 90],
      [SELENA_POSITION.x, SELENA_POSITION.y + 112],
      [SELENA_POSITION.x + 102, SELENA_POSITION.y + 92],
    ] as const;
    snapshot.game.rovers.forEach((rover, index) => {
      const visual = this.roverVisuals.get(rover.id);
      if (!visual) return;
      const selected = rover.id === snapshot.selectedRoverId;
      const color = rover.status === "mission" ? COLORS.green : selected ? COLORS.amber : COLORS.cyan;
      visual.statusRing.setStrokeStyle(selected || rover.status === "mission" ? 3 : 2, color, selected ? 1 : 0.62);
      visual.statusRing.setFillStyle(color, selected || rover.status === "mission" ? 0.09 : 0.03);
      visual.label.setColor(rover.status === "mission" ? "#a7e8c3" : selected ? "#ffd699" : "#d8e4e3");
      if (rover.status === "idle") {
        const [x, y] = positions[index] ?? positions[0];
        visual.container.setPosition(x, y).setDepth(1300 + y);
        if (visual.direction !== "SW") {
          visual.direction = "SW";
          visual.sprite.setTexture(roverTextureKey(rover.id, "SW"));
        }
      }
    });
  }

  private updateRoverPositions(time: number): void {
    const snapshot = this.latest;
    if (!snapshot) return;
    snapshot.game.deliveries
      .filter((delivery) => delivery.status === "active")
      .forEach((delivery) => this.positionRover(delivery, time, snapshot));
  }

  private positionRover(delivery: Delivery, time: number, snapshot: SceneSnapshot): void {
    const route = snapshot.map.routes.find((item) => item.id === delivery.routeId);
    const destination = route
      ? snapshot.map.destinations.find((item) => item.id === route.destinationId)
      : undefined;
    const visual = this.roverVisuals.get(delivery.roverId);
    if (!route || !destination || !visual) return;

    const startedAt = Date.parse(delivery.startedAt);
    const completesAt = Date.parse(delivery.completesAt);
    const interpolated = Phaser.Math.Clamp((Date.now() - startedAt) / (completesAt - startedAt), 0, 1);
    const progress = Math.max(delivery.progress, interpolated);
    const curveProgress = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    const curve = this.routeCurve(route, destination);
    const safeProgress = Phaser.Math.Clamp(curveProgress, 0.002, 0.998);
    const point = curve.getPoint(safeProgress);
    const tangent = curve.getTangent(safeProgress);
    const angle = Math.atan2(tangent.y, tangent.x) + (progress >= 0.5 ? Math.PI : 0);
    const direction = directionFromAngle(angle);
    if (direction !== visual.direction) {
      visual.direction = direction;
      visual.sprite.setTexture(roverTextureKey(delivery.roverId, direction));
    }
    visual.container.setPosition(point.x, point.y).setDepth(1300 + point.y);

    if (progress >= 0.48 && !this.midpointFlashes.has(delivery.id)) {
      this.midpointFlashes.add(delivery.id);
      this.flashDestination(destination);
    }

    if (!snapshot.reducedMotion && time - (this.trackTimes.get(delivery.id) ?? 0) > 110) {
      this.trackTimes.set(delivery.id, time);
      const track = this.add.ellipse(point.x, point.y + 10, 13, 4, 0x0a0e11, 0.34).setDepth(point.y + 6);
      track.setRotation(angle);
      this.tweens.add({
        targets: track,
        alpha: 0,
        duration: 4200,
        onComplete: () => track.destroy(),
      });
    }

    if (!snapshot.reducedMotion && time - (this.dustTimes.get(delivery.id) ?? 0) > 145) {
      this.dustTimes.set(delivery.id, time);
      const dust = this.add.image(point.x, point.y + 12, "dust-particle").setDepth(point.y + 7).setAlpha(0.26);
      dust.setScale(0.45 + ((Math.round(time) % 5) * 0.07));
      this.tweens.add({
        targets: dust,
        alpha: 0,
        scale: 1.8,
        x: point.x - Math.cos(angle) * 18,
        y: point.y + 19 - Math.sin(angle) * 8,
        duration: 720,
        onComplete: () => dust.destroy(),
      });
    }
  }

  private flashDestination(destination: Destination): void {
    const flash = this.add
      .circle(destination.position.x, destination.position.y, 20, COLORS.green, 0.48)
      .setDepth(1900);
    this.tweens.add({
      targets: flash,
      scale: 4.4,
      alpha: 0,
      duration: this.latest?.reducedMotion ? 180 : 680,
      ease: "Cubic.Out",
      onComplete: () => flash.destroy(),
    });
  }
}

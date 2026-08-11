import Phaser from "phaser";
import { preloadGameAssets } from "../assets";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    preloadGameAssets(this);
  }

  create(): void {
    const dust = this.make.graphics({ x: 0, y: 0 }, false);
    dust.fillStyle(0xc9bea6, 0.72);
    dust.fillCircle(5, 5, 5);
    dust.generateTexture("dust-particle", 10, 10);
    dust.destroy();
    this.scene.start("LunarMapScene");
  }
}

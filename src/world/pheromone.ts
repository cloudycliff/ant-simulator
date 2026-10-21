import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Terrain } from './terrain';

/** 地表信息素网格。目前只有觅食路径信息素（返巢的觅食蚁沿途释放）。 */
export class PheromoneField {
  readonly res: number;
  readonly cell = CONFIG.pheromone.cellSize;
  readonly half: number;
  trail: Float32Array;
  private tex: THREE.DataTexture;
  private texData: Uint8Array<ArrayBuffer>;
  overlay!: THREE.Mesh;
  private evapTimer = 0;

  constructor(private terrain: Terrain) {
    this.half = CONFIG.world.size / 2;
    this.res = Math.round(CONFIG.world.size / this.cell);
    this.trail = new Float32Array(this.res * this.res);
    this.texData = new Uint8Array(this.res * this.res * 4);
    this.tex = new THREE.DataTexture(this.texData, this.res, this.res, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return -1;
    return j * this.res + i;
  }

  sample(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? 0 : this.trail[k];
  }

  deposit(x: number, z: number, amount: number): void {
    const k = this.idx(x, z);
    if (k >= 0) this.trail[k] = Math.min(12, this.trail[k] + amount);
  }

  update(dt: number): void {
    this.evapTimer += dt;
    if (this.evapTimer < 0.5) return;
    const k = Math.pow(0.5, this.evapTimer / CONFIG.pheromone.trailHalfLife);
    this.evapTimer = 0;
    const t = this.trail;
    for (let i = 0; i < t.length; i++) {
      const v = t[i] * k;
      t[i] = v < 0.002 ? 0 : v;
    }
  }

  buildOverlay(): THREE.Mesh {
    const geo = (this.terrain.mesh.geometry as THREE.BufferGeometry).clone();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + 0.06);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.overlay = new THREE.Mesh(geo, mat);
    this.overlay.visible = false;
    this.overlay.renderOrder = 2;
    return this.overlay;
  }

  /** 把网格写进热力图纹理（只在叠加层可见时调用） */
  refreshTexture(): void {
    const d = this.texData;
    const t = this.trail;
    const res = this.res;
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        // PlaneGeometry 的 uv.v 与世界 z 方向相反
        const v = t[(res - 1 - j) * res + i];
        const a = Math.min(1, v / 3);
        const o = (j * res + i) * 4;
        d[o] = 255;
        d[o + 1] = 60 + 180 * a;
        d[o + 2] = 40;
        d[o + 3] = a > 0.01 ? 40 + 200 * a : 0;
      }
    this.tex.needsUpdate = true;
  }
}

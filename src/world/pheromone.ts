import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Terrain } from './terrain';

function encodeField(f: Float32Array, max: number): string {
  const q = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.sqrt(Math.min(1, f[i] / max)) * 255);
  let s = '';
  for (let i = 0; i < q.length; i += 0x8000) s += String.fromCharCode(...q.subarray(i, i + 0x8000));
  return btoa(s);
}

function decodeField(b64: string, max: number, out: Float32Array): void {
  const s = atob(b64);
  const n = Math.min(s.length, out.length);
  for (let i = 0; i < n; i++) {
    const v = s.charCodeAt(i) / 255;
    out[i] = v * v * max;
  }
}

/**
 * 地表化学信号网格，两个通道：
 * - trail：路径信息素，携带食物返巢的觅食蚁释放，挥发快（半衰期约 1.5 分钟）
 * - home：足迹碳氢化合物，所有在地表行走的工蚁留下，挥发慢，标记出蚁群的活动范围
 */
export class PheromoneField {
  readonly res: number;
  readonly cell = CONFIG.pheromone.cellSize;
  readonly half: number;
  trail: Float32Array;
  home: Float32Array;
  private tex: THREE.DataTexture;
  private texData: Uint8Array<ArrayBuffer>;
  overlay!: THREE.Mesh;
  private evapTimer = 0;

  constructor(private terrain: Terrain) {
    this.half = CONFIG.world.size / 2;
    this.res = Math.round(CONFIG.world.size / this.cell);
    this.trail = new Float32Array(this.res * this.res);
    this.home = new Float32Array(this.res * this.res);
    this.texData = new Uint8Array(this.res * this.res * 4);
    this.tex = new THREE.DataTexture(this.texData, this.res, this.res, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
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

  sampleHome(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? 0 : this.home[k];
  }

  deposit(x: number, z: number, amount: number): void {
    const k = this.idx(x, z);
    if (k >= 0) this.trail[k] = Math.min(12, this.trail[k] + amount);
  }

  depositHome(x: number, z: number, amount: number): void {
    const k = this.idx(x, z);
    if (k >= 0) this.home[k] = Math.min(4, this.home[k] + amount);
  }

  /** 存档：两个通道按平方根量化到 0–255 后 base64 编码，低浓度保留更多精度 */
  toSave(): { trail: string; home: string } {
    return { trail: encodeField(this.trail, 12), home: encodeField(this.home, 4) };
  }

  restore(s: { trail: string; home: string }): void {
    decodeField(s.trail, 12, this.trail);
    decodeField(s.home, 4, this.home);
  }

  /** 半径 r 内的两种信息素分别乘以保留比例（水冲刷） */
  wash(x: number, z: number, r: number, keepTrail: number, keepHome: number): void {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((x - r + this.half) / c));
    const i1 = Math.min(this.res - 1, Math.floor((x + r + this.half) / c));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / c));
    const j1 = Math.min(this.res - 1, Math.floor((z + r + this.half) / c));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * c - this.half;
        const cz = (j + 0.5) * c - this.half;
        if ((cx - x) ** 2 + (cz - z) ** 2 > r * r) continue;
        const k = j * this.res + i;
        this.trail[k] *= keepTrail;
        this.home[k] *= keepHome;
      }
  }

  update(dt: number): void {
    this.evapTimer += dt;
    if (this.evapTimer < 0.5) return;
    const kt = Math.pow(0.5, this.evapTimer / CONFIG.pheromone.trailHalfLife);
    const kh = Math.pow(0.5, this.evapTimer / CONFIG.pheromone.homeHalfLife);
    this.evapTimer = 0;
    const t = this.trail;
    const h = this.home;
    for (let i = 0; i < t.length; i++) {
      const v = t[i] * kt;
      t[i] = v < 0.002 ? 0 : v;
      const u = h[i] * kh;
      h[i] = u < 0.002 ? 0 : u;
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
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.overlay = new THREE.Mesh(geo, mat);
    this.overlay.visible = false;
    this.overlay.renderOrder = 2;
    return this.overlay;
  }

  /** 把网格写进热力图纹理（只在叠加层可见时调用）。足迹为蓝色底层，路径信息素按浓度从橙红过渡到亮黄 */
  refreshTexture(): void {
    const d = this.texData;
    const t = this.trail;
    const h = this.home;
    const res = this.res;
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        // PlaneGeometry 的 uv.v 与世界 z 方向相反
        const k = (res - 1 - j) * res + i;
        const a = Math.min(1, t[k] / 3);
        const b = Math.sqrt(Math.min(1, h[k] / 1.5));
        const o = (j * res + i) * 4;
        const at = a > 0.01 ? 0.3 + 0.65 * a : 0;
        const ah = b > 0.1 ? 0.06 + 0.36 * b : 0;
        const wh = ah * (1 - at);
        const out = at + wh;
        if (out <= 0) {
          d[o + 3] = 0;
          continue;
        }
        d[o] = (255 * at + 40 * wh) / out;
        d[o + 1] = ((80 + 170 * a) * at + 130 * wh) / out;
        d[o + 2] = ((20 + 70 * a) * at + 255 * wh) / out;
        d[o + 3] = out * 255;
      }
    this.tex.needsUpdate = true;
  }
}

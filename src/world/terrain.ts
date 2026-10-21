import * as THREE from 'three';
import { CONFIG } from '../config';
import { Noise2D } from '../util/random';
import { smoothstep } from '../util/math';

/** 高度缓存网格的间距（cm），比土丘中心凹陷的宽度小 */
const GRID_STEP = 0.5;

interface Mound {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** 地表高度场。高度函数是解析式，建好后缓存成网格供蚂蚁 O(1) 采样。 */
export class Terrain {
  readonly size = CONFIG.world.size;
  readonly half = CONFIG.world.size / 2;
  readonly noise: Noise2D;
  readonly detail: Noise2D;
  private mounds: Mound[] = [];
  private grid: Float32Array | null = null;
  private gridN = 0;
  mesh!: THREE.Mesh;
  material!: THREE.MeshStandardMaterial;

  constructor(seed: number) {
    this.noise = new Noise2D(seed);
    this.detail = new Noise2D(seed + 7);
  }

  addMound(x: number, z: number, radius: number, height: number): void {
    this.mounds.push({ x, z, radius, height });
  }

  /** 未叠加蚁丘的自然地面高度 */
  baseHeight(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const flatten = 0.35 + 0.65 * smoothstep(10, 45, r);
    const big = this.noise.fbm(x * 0.011 + 3.1, z * 0.011 - 1.7, 4) * 9;
    const small = this.detail.fbm(x * 0.06, z * 0.06, 3) * 1.1;
    return big * flatten + small;
  }

  /** 建好地形后高度不再变化，缓存成网格双线性插值，避免每次都算多层噪声 */
  heightAt(x: number, z: number): number {
    const g = this.grid;
    if (!g) return this.exactHeight(x, z);
    const n = this.gridN;
    const fx = Math.min(n - 1.001, Math.max(0, (x + this.half) / GRID_STEP));
    const fz = Math.min(n - 1.001, Math.max(0, (z + this.half) / GRID_STEP));
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const a = g[k] + (g[k + 1] - g[k]) * tx;
    const b = g[k + n] + (g[k + n + 1] - g[k + n]) * tx;
    return a + (b - a) * tz;
  }

  private exactHeight(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    for (const m of this.mounds) {
      const d = Math.hypot(x - m.x, z - m.z) / m.radius;
      if (d < 1.6) {
        // 火山口状土丘：环形隆起，中心是入口凹陷
        const ring = Math.exp(-((d - 0.42) * (d - 0.42)) / 0.09);
        const pit = Math.exp(-(d * d) / 0.02);
        h += m.height * (ring - 0.9 * pit);
      }
    }
    return h;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.4;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** 0..1 的草被密度，蚁穴周围与小径是裸土 */
  grassDensity(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const n = this.noise.fbm(x * 0.025 + 11, z * 0.025 - 5, 3);
    const path = Math.abs(this.detail.noise(x * 0.012 + 4, z * 0.012 + 9));
    let d = smoothstep(-0.12, 0.25, n);
    d *= smoothstep(0.02, 0.09, path);
    d *= smoothstep(16, 34, r);
    return d;
  }

  inBounds(x: number, z: number): boolean {
    return Math.hypot(x, z) < CONFIG.world.forageRadius;
  }

  build(): THREE.Mesh {
    const n = Math.ceil(this.size / GRID_STEP) + 1;
    const grid = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = this.exactHeight(-this.half + i * GRID_STEP, -this.half + j * GRID_STEP);
    this.gridN = n;
    this.grid = grid;

    const seg = CONFIG.world.terrainSegments;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const soilDark = new THREE.Color(0x4a3524);
    const soilLight = new THREE.Color(0x8a6a4a);
    const grassy = new THREE.Color(0x4f6b2c);
    const dry = new THREE.Color(0x8b8a4a);
    const c = new THREE.Color();
    const c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
      const g = this.grassDensity(x, z);
      const v = this.detail.noise(x * 0.3, z * 0.3) * 0.5 + 0.5;
      c.copy(soilDark).lerp(soilLight, v * 0.7);
      c2.copy(grassy).lerp(dry, this.noise.noise(x * 0.05, z * 0.05) * 0.5 + 0.5);
      c.lerp(c2, g * 0.85);
      // 蚁丘上翻出的新土更浅
      const mh = this.heightAt(x, z) - this.baseHeight(x, z);
      if (mh > 0.05) c.lerp(soilLight, Math.min(1, mh / 1.5) * 0.6);
      if (mh < -0.1) c.multiplyScalar(0.55);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    return this.mesh;
  }

  setXray(on: boolean): void {
    this.material.transparent = on;
    this.material.opacity = on ? 0.16 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
  }
}

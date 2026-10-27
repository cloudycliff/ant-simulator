import * as THREE from 'three';
import { CONFIG } from './config';
import { HEAT_COLORS } from './palette';
import { SITES } from './sim/comb';
import { HEAT, SITE_HEAT } from './sim/heat';
import type { BeeWorld } from './world';

const H = CONFIG.hive;
const T = CONFIG.heat;
/** 盖在蜂身上面（蜂离巢面 lift，身子约 0.3 cm 高），玻璃以内 */
const LIFT = CONFIG.bees.lift + 0.45;
const OPACITY = 0.7;
const REFRESH_MS = 500;
const _a = new THREE.Color();
const _b = new THREE.Color();

/** 温度对应的色阶颜色 */
export function heatColor(t: number, out: THREE.Color): THREE.Color {
  const S = HEAT_COLORS;
  if (t <= S[0][0]) return out.set(S[0][1]);
  for (let i = 1; i < S.length; i++)
    if (t <= S[i][0]) {
      const k = (t - S[i - 1][0]) / (S[i][0] - S[i - 1][0]);
      return out.copy(_a.set(S[i - 1][1])).lerp(_b.set(S[i][1]), k);
    }
  return out.set(S[S.length - 1][1]);
}

/**
 * 温度视图（P-011）：两面各一块半透明的板，盖在巢脾和蜂上面，每格温度一个像素、线性插值。
 * 只画造好的巢脾：每格按造好的巢房占多少淡掉
 */
export class HeatView {
  readonly group = new THREE.Group();
  private data = new Uint8Array(HEAT.n * 4);
  private tex = new THREE.DataTexture(this.data, HEAT.cols, HEAT.rows, THREE.RGBAFormat);
  private built = new Uint16Array(HEAT.n);
  private sites = new Uint16Array(HEAT.n);
  private at = -Infinity;

  constructor(private readonly w: BeeWorld) {
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    for (let s = 0; s < SITES; s++) this.sites[SITE_HEAT[s]]++;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const gw = HEAT.cols * T.cell;
    const gh = HEAT.rows * T.cell;
    // 每框一块，中间的木条不盖；两面的板都不转向，背面那块从背面看就是它的反面，格子在世界里的位置两面一样
    for (let f = 0; f < 2; f++) {
      const v0 = f * (H.frameH + H.bar);
      const g = new THREE.PlaneGeometry(H.combW, H.frameH);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * H.combW) / gw, (v0 + uv.getY(i) * H.frameH) / gh);
      for (const s of [1, -1]) {
        const m = new THREE.Mesh(g, mat);
        m.position.set(0, H.baseY + v0 + H.frameH / 2, s * (H.combHalf + LIFT));
        m.renderOrder = 6;
        this.group.add(m);
      }
    }
    this.group.visible = false;
  }

  get on(): boolean {
    return this.group.visible;
  }

  set on(v: boolean) {
    this.group.visible = v;
    this.at = -Infinity;
  }

  update(): void {
    const now = performance.now();
    if (!this.on || now - this.at < REFRESH_MS) return;
    this.at = now;
    const build = this.w.comb.build;
    this.built.fill(0);
    for (let s = 0; s < SITES; s++) if (build[s] >= 1) this.built[SITE_HEAT[s]]++;
    const temp = this.w.heat.temp;
    for (let i = 0; i < HEAT.n; i++) {
      heatColor(temp[i], _a);
      const k = this.sites[i] ? this.built[i] / this.sites[i] : 0;
      this.data.set([_a.r * 255, _a.g * 255, _a.b * 255, OPACITY * Math.min(1, k * 1.5) * 255], i * 4);
    }
    this.tex.needsUpdate = true;
  }
}

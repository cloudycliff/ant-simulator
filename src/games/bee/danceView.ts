import * as THREE from 'three';
import { CONFIG } from './config';
import { FLOWER_COLORS } from './palette';
import { ROUND_R } from './sim/bees';
import { MOUTH } from './sim/flight';
import type { BeeWorld } from './world';

const H = CONFIG.hive;
const SPECIES = CONFIG.flowers.species;
/** 线段数的上限：每支舞最多 12 段（圆舞的圈），每个跟舞读出的地方 2 段 */
const MAX = 6000;
/** 标记离巢面多远，压在蜂下面一点也要看得见 */
const LIFT = CONFIG.bees.lift + 0.15;
const _c = new THREE.Color();

/** 一组可以每帧改的彩色线段 */
class Lines {
  readonly obj: THREE.LineSegments;
  private pos = new Float32Array(MAX * 6);
  private col = new Float32Array(MAX * 6);
  private n = 0;

  constructor(top: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: !top, fog: false }));
    this.obj.frustumCulled = false;
    if (top) this.obj.renderOrder = 21;
  }

  begin(): void {
    this.n = 0;
  }

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Color): void {
    if (this.n >= MAX) return;
    const i = this.n++ * 6;
    this.pos.set([ax, ay, az, bx, by, bz], i);
    this.col.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
  }

  end(): void {
    const g = this.obj.geometry;
    g.setDrawRange(0, this.n * 2);
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }
}

/**
 * 舞的标记（T-014）：巢脾上沿摆动段画箭头、圆舞画一圈，花园里从巢门连到舞里说的那片花，
 * 跟舞读出、还没飞到的地方画叉。颜色是那片花的颜色。巢脾背面的舞从正面看不画
 */
export class DanceView {
  readonly group = new THREE.Group();
  on = false;
  private comb = new Lines(true);
  private garden = new Lines(false);

  constructor(private readonly w: BeeWorld) {
    this.group.add(this.comb.obj, this.garden.obj);
    this.group.visible = false;
  }

  private color(species: number): THREE.Color {
    const sp = SPECIES[species];
    return _c.set(sp ? FLOWER_COLORS[sp.key].bloom : 0xffffff);
  }

  update(camera: THREE.PerspectiveCamera): void {
    this.group.visible = this.on;
    if (!this.on) return;
    const camZ = camera.position.z;
    const x0 = -H.combW / 2;
    const y0 = H.baseY;
    const flowers = this.w.flowers;
    this.comb.begin();
    this.garden.begin();
    for (const b of this.w.bees.list) {
      const c = b.brain.cmd;
      if (b.aim) {
        const a = b.aim;
        const col = this.color(a.sp);
        const y = this.w.groundAt(a.x, a.z) + 8;
        this.garden.add(a.x - 30, y, a.z - 30, a.x + 30, y, a.z + 30, col);
        this.garden.add(a.x - 30, y, a.z + 30, a.x + 30, y, a.z - 30, col);
      }
      if (c?.k !== 'dance') continue;
      const p = flowers.get(b.patch);
      const col = this.color(p ? p.species : -1);
      if (p) this.garden.add(MOUTH.x, MOUTH.y, MOUTH.z, p.x, this.w.groundAt(p.x, p.z) + 30, p.z, col);
      const zf = b.face ? -1 : 1;
      if (camZ * zf < 0) continue;
      const z = zf * (H.combHalf + LIFT);
      const cx = x0 + c.cu;
      const cy = y0 + c.cv;
      if (c.w <= 0) {
        for (let k = 0; k < 12; k++) {
          const t0 = (k / 12) * Math.PI * 2;
          const t1 = ((k + 1) / 12) * Math.PI * 2;
          this.comb.add(cx + Math.cos(t0) * ROUND_R, cy + Math.sin(t0) * ROUND_R, z, cx + Math.cos(t1) * ROUND_R, cy + Math.sin(t1) * ROUND_R, z, col);
        }
        continue;
      }
      const eu = Math.cos(c.a);
      const ev = Math.sin(c.a);
      const h = c.len / 2;
      const ex = cx + eu * h;
      const ey = cy + ev * h;
      this.comb.add(cx - eu * h, cy - ev * h, z, ex, ey, z, col);
      for (const s of [0.5, -0.5]) {
        const ang = c.a + Math.PI + s;
        this.comb.add(ex, ey, z, ex + Math.cos(ang) * 0.4, ey + Math.sin(ang) * 0.4, z, col);
      }
    }
    this.comb.end();
    this.garden.end();
  }
}

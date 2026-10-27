import type { Point3 } from '../../../core/sim/events';
import { clamp } from '../../../core/util/math';
import { CONFIG } from '../config';
import type { Bee } from './bees';

const H = CONFIG.hive;
const T = H.tube;
const F = CONFIG.forage;
const LIFT = CONFIG.bees.lift;

/**
 * 巢门的路：巢脾左边框条上的巢门格（u = -0.5，v = tube.v，两面各一个）→ 管子的里口 → 管子的外口。
 * 管里的蜂走在管底上
 */
const tubeY = H.baseY + T.v - T.r + LIFT;
const INNER = { x: -H.combW / 2 - 1.2, y: tubeY, z: 0 };
export const MOUTH = { x: -H.combW / 2 - T.to, y: tubeY, z: 0 };
const combEnd = (face: number, out: Point3) => {
  out.x = -0.5 - H.combW / 2;
  out.y = H.baseY + T.v;
  out.z = (face ? -1 : 1) * (H.combHalf + LIFT);
  return out;
};
const _a = { x: 0, y: 0, z: 0 };
const leg1 = (face: number) => {
  combEnd(face, _a);
  return Math.hypot(INNER.x - _a.x, INNER.y - _a.y, INNER.z - _a.z);
};
/** 巢门格到外口的路长（两面一样） */
export const TUBE_LEN = leg1(0) + (INNER.x - MOUTH.x);
/** 巢门格在巢面上的坐标 */
export const DOOR = { u: -0.5, v: T.v };

/**
 * 走了 s cm 时在巢门路上的位置；朝外走时的朝向（世界里的水平角）。
 * lane（-1..1）是在管底偏左还是偏右，一群蜂进出时不全挤在一条线上
 */
export function tubeAt(s: number, face: number, lane: number, out: Point3): number {
  const l1 = leg1(face);
  combEnd(face, _a);
  const th = lane * 0.7;
  const iy = H.baseY + T.v - (T.r - LIFT) * Math.cos(th);
  const iz = (T.r - LIFT) * Math.sin(th);
  if (s <= l1) {
    const k = clamp(s / l1, 0, 1);
    out.x = _a.x + (INNER.x - _a.x) * k;
    out.y = _a.y + (iy - _a.y) * k;
    out.z = _a.z + (iz - _a.z) * k;
    return Math.atan2(iz - _a.z, INNER.x - _a.x);
  }
  out.x = INNER.x - (s - l1);
  out.y = iy;
  out.z = iz;
  return Math.PI;
}

/**
 * 出巢先往外飞、爬高到顶棚以上（DEPART），回巢从同一侧先到 APPROACH、再低低地对准管口（DOCK），
 * 不然从蜂箱另一边来的蜂会穿过箱子
 */
export const DEPART = { x: -110, y: 165, z: 0 };
export const APPROACH = { x: -110, y: 160, z: 0 };
export const DOCK = { x: MOUTH.x - 12, y: tubeY + 2, z: 0 };

/** 会飞的：蜂和胡蜂 */
export type Flyer = Pick<Bee, 'id' | 'pos' | 'vel' | 'h'>;

/** 这只蜂远处巡航的离地高度（cm），按编号定、不存档 */
export const cruiseOf = (b: Flyer) => F.cruise[0] + ((b.id * 0.618034) % 1) * (F.cruise[1] - F.cruise[0]);

/**
 * 转向（T-009）：朝目标飞，远处爬到巡航高度、近了下降，离得越近越慢，加速度有上限，
 * 远处左右摆一点；路过的点（stop 为假）不减速。返回离目标多远
 */
export function steer(b: Flyer, to: Point3, vmax: number, stop: boolean, dt: number, ground: number, now: number): number {
  const p = b.pos;
  const v = b.vel;
  const dx = to.x - p.x;
  const dz = to.z - p.z;
  const hd = Math.hypot(dx, dz);
  const k = clamp((hd - F.descend) / F.descend, 0, 1);
  const ty = to.y + (Math.max(to.y, ground + cruiseOf(b)) - to.y) * k;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy, dz);
  const sp = stop ? Math.min(vmax, Math.max(F.slow, Math.hypot(dx, to.y - p.y, dz) * F.brake)) : vmax;
  let wx = (dx / (d || 1)) * sp;
  let wy = (dy / (d || 1)) * sp;
  let wz = (dz / (d || 1)) * sp;
  if (hd > 30) {
    const s = Math.sin(now * F.wobbleHz * Math.PI * 2 + b.id) * F.wobble * sp;
    wx += (-dz / hd) * s;
    wz += (dx / hd) * s;
    wy += Math.sin(now * F.wobbleHz * 4.1 + b.id * 1.7) * F.wobble * 0.3 * sp;
  }
  let ax = wx - v.x;
  let ay = wy - v.y;
  let az = wz - v.z;
  const a = Math.hypot(ax, ay, az);
  const lim = F.accel * dt;
  if (a > lim) {
    ax *= lim / a;
    ay *= lim / a;
    az *= lim / a;
  }
  v.x += ax;
  v.y += ay;
  v.z += az;
  p.x += v.x * dt;
  p.y = Math.max(ground + 0.5, p.y + v.y * dt);
  p.z += v.z * dt;
  if (Math.hypot(v.x, v.z) > 1) b.h = Math.atan2(v.z, v.x);
  return Math.hypot(to.x - p.x, to.y - p.y, to.z - p.z);
}

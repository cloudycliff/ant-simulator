/** 蚂蚁在巢内的运动：沿隧道走、房间里漫游、出巢，以及和同伴的避让。Ant.step 按指令调用 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { tunnelFloor } from '../../../core/move/graph';
import { clamp } from '../../../core/util/math';
import type { World } from '../world/world';
import type { Ant, Command } from './ant';

const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();

export function nestSpeed(a: Ant, w: World): number {
  return CONFIG.ant.speedNest * a.pace * a.speedFactor(w);
}

export function stepGoto(a: Ant, dt: number, w: World, target: number): boolean {
  const nest = w.nest;
  const step = nestSpeed(a, w) * dt;
  if (a.room >= 0) {
    const c = nest.chambers[a.room];
    if (!moveOnFloor(a, nest.nodes[c.door].pos, step, c.floor.y)) return false;
    a.room = -1;
    a.walk.node = c.door;
  }
  const r = a.walk.advance(nest, step, target);
  if (a.walk.moved) {
    a.moving = true;
    a.gait += a.walk.walked * 9;
  }
  if (r === 'walking') placeOnEdge(a, w);
  else if (r === 'arrived') a.navTarget.copy(nest.nodes[target].pos);
  return r === 'arrived' || r === 'noRoute';
}

/** 沿隧道地面行走：位置贴近隧道底部，并按靠右通行偏移 */
function placeOnEdge(a: Ant, w: World): void {
  const e = a.walk.edge!;
  w.nest.sampleEdge(e, a.walk.from, a.walk.s, _c, _t);
  tunnelFloor(_c, _t, e.radius, laneOffset(a), a.navTarget, _f);
  a.fwd.lerp(_t, 0.35).normalize();
  a.up.lerp(_f.negate(), 0.25).normalize();
}

function moveOnFloor(a: Ant, target: THREE.Vector3, step: number, floorY: number): boolean {
  const dx = target.x - a.navTarget.x;
  const dz = target.z - a.navTarget.z;
  const d = Math.hypot(dx, dz);
  a.navTarget.y += (floorY - a.navTarget.y) * 0.2;
  if (d < 0.25) return true;
  const k = Math.min(1, step / d);
  a.navTarget.x += dx * k;
  a.navTarget.z += dz * k;
  _f.set(dx / d, 0, dz / d);
  a.fwd.lerp(_f, 0.25).normalize();
  a.up.lerp(_n.set(0, 1, 0), 0.2).normalize();
  a.moving = true;
  a.gait += step * 9;
  return false;
}

function laneOffset(a: Ant): number {
  return clamp(a.lane * 0.42 + a.side, -0.55, 0.55);
}

/** 在隧道里时写入 sepS（从 edge.a 量起的沿边坐标）和 sepLat（不随行进方向翻转的横向坐标） */
export function measureTunnel(a: Ant): void {
  const e = a.walk.edge!;
  a.sepS = a.walk.along();
  a.sepLat = a.walk.dir() * laneOffset(a) * e.radius;
  a.sepPush = 0;
}

/** 按 sepPush（横向坐标上的推力）往旁边让；没有推力时慢慢回到自己的 lane */
export function shiftSide(a: Ant, dt: number): void {
  const e = a.walk.edge!;
  if (a.sepPush !== 0) {
    a.side = clamp(a.side + (a.walk.dir() * a.sepPush * 0.5) / e.radius, -0.8, 0.8);
  } else a.side -= a.side * Math.min(1, dt * 0.5);
}

/**
 * 地表和房间里与 near 中的同伴互相推开，dt 是两次调用的间隔。走动中的只轻推，保证能走到目标点。
 * 隧道里的避让见 colonySocial.ts 的 separate。
 */
export function avoid(a: Ant, w: World, near: Ant[], dt: number): void {
  if (a.climbing || a.pitT > 0 || (a.domain === 'nest' && a.room < 0)) return;
  const R = CONFIG.ant.personalSpace;
  let px = 0;
  let pz = 0;
  for (const b of near) {
    if (b.domain !== a.domain || b.climbing) continue;
    const queen = b.role === 'queen';
    const min = R * (queen ? 1 + CONFIG.ant.queenScale : 2);
    const dx = a.pos.x - b.pos.x;
    const dy = a.pos.y - b.pos.y;
    const dz = a.pos.z - b.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= min * min) continue;
    const k = (min - Math.sqrt(d2)) * (queen ? 1 : 0.5);
    const dh = Math.hypot(dx, dz);
    if (dh < 1e-3) {
      const ang = a.id * 2.39996;
      px += Math.cos(ang) * k;
      pz += Math.sin(ang) * k;
    } else {
      px += (dx / dh) * k;
      pz += (dz / dh) * k;
    }
  }
  const len = Math.hypot(px, pz);
  if (len < 1e-4) return;
  const cap = (a.moving ? 0.18 : 0.6) * dt;
  if (len > cap) {
    px *= cap / len;
    pz *= cap / len;
  }
  const nx = a.pos.x + px;
  const nz = a.pos.z + pz;
  if (a.domain === 'surface') {
    if (w.veg.obstacleAt(nx, nz, 0.3, true) || Math.hypot(nx, nz) > CONFIG.world.forageRadius) return;
    a.pos.set(nx, w.terrain.heightAt(nx, nz) + w.predators.liftAt(nx, nz), nz);
  } else {
    if (!w.nest.insideFloor(w.nest.chambers[a.room], nx, nz, 0.8)) return;
    a.pos.x = nx;
    a.pos.z = nz;
    a.navTarget.x += px;
    a.navTarget.z += pz;
  }
}

export function smoothNest(a: Ant, dt: number): void {
  const k = 1 - Math.exp(-dt * 14);
  a.pos.lerp(a.navTarget, k);
}

export function stepRoom(a: Ant, dt: number, w: World, cmd: Extract<Command, { k: 'room' }>, first: boolean): boolean {
  const c = w.nest.chambers[cmd.chamber];
  if (a.domain === 'surface') return true;
  if (a.room !== cmd.chamber) {
    if (!stepGoto(a, dt, w, c.door)) return false;
    a.room = cmd.chamber;
    a.walk.node = -1;
    first = true;
  }
  if (first) {
    a.timer = cmd.time;
    a.pauseT = 0;
    if (cmd.point) a.localTarget.copy(cmd.point);
    else w.nest.randomFloorPoint(c, () => w.rng.next(), a.localTarget);
  }
  a.timer -= dt;
  if (a.pauseT > 0) {
    a.pauseT -= dt;
    return a.timer <= 0;
  }
  const arrived = moveOnFloor(a, a.localTarget, nestSpeed(a, w) * dt * 0.7, c.floor.y);
  if (arrived) {
    if (cmd.point) return a.timer <= 0;
    a.pauseT = w.rng.range(0.6, 4.5);
    w.nest.randomFloorPoint(c, () => w.rng.next(), a.localTarget);
  }
  return a.timer <= 0 && !cmd.point;
}

export function stepExit(a: Ant, dt: number, w: World, first: boolean, giveUp: boolean): boolean {
  if (a.domain === 'surface') return true;
  if (first) {
    const from = a.currentNode(w);
    const open = w.nest.entrances.filter((e) => e.plug < 1);
    let best = w.nest.entrances[0];
    let bd = Infinity;
    for (const e of open.length ? open : w.nest.entrances) {
      const d = w.nest.routeLength(from, e.node) * w.rng.range(0.8, 1.25);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    a.entranceTarget = w.nest.entrances.indexOf(best);
  }
  const ent = w.nest.entrances[a.entranceTarget];
  if (!stepGoto(a, dt, w, ent.node)) return false;
  if (ent.plug >= 1) {
    const other = w.nest.entrances.findIndex((e) => e.plug < 1);
    if (other >= 0) a.entranceTarget = other;
    else if (giveUp) {
      a.behavior.result = 'blocked';
      return true;
    } else if (!a.exitBlocked) {
      a.exitBlocked = true;
      a.taskActivity = a.activity;
      a.activity = L('act.waitSealed', { ent: ent.label });
    }
    return false;
  }
  if (a.exitBlocked) {
    a.exitBlocked = false;
    a.activity = a.taskActivity;
  }
  a.placeOnSurface(ent.x, ent.z, w);
  a.heading = Math.atan2(ent.z, ent.x) + w.rng.range(-1.6, 1.6);
  if (ent.x === 0 && ent.z === 0) a.heading = w.rng.range(-Math.PI, Math.PI);
  a.memoryChecked = false;
  return true;
}

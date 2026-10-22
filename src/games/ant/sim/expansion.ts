import * as THREE from 'three';
import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { TAU } from '../../../core/util/math';
import { rng } from '../../../core/util/random';
import { CHAMBER_INFO, type Chamber, type ChamberType, type DigFace } from '../nest/nest';
import type { World } from '../world/world';

export interface ExpansionProject {
  face: DigFace;
  type: ChamberType;
  floor: THREE.Vector3;
  rx: number;
  rz: number;
  ry: number;
  yaw: number;
  /** 隧道挖通后才创建；扩大已有房间时就是那间房间 */
  chamber: Chamber | null;
  soil: number;
  soilNeeded: number;
  startedDay: number;
  /** 扩大已有房间：地板中心与半径从 from 渐变到 to（[x, z, rx, rz]） */
  enlarge: { from: number[]; to: number[] } | null;
}

export interface ExpansionSave {
  project: {
    face: number;
    type: ChamberType;
    floor: number[];
    rx: number;
    rz: number;
    ry: number;
    yaw: number;
    chamber: number;
    soil: number;
    soilNeeded: number;
    startedDay: number;
    enlarge?: { from: number[]; to: number[] } | null;
  } | null;
  completed: number;
  enlarged?: number;
}

/** 可以扩大的房间类型 */
const ENLARGEABLE: ChamberType[] = ['egg', 'larva', 'pupa', 'food', 'rest'];

/**
 * 蚁穴扩建：蚁群拥挤时规划一间新房间，先挖通往它的隧道，再从门口向内挖出房间；
 * 或者把最拥挤的一间房间以门口为不动点放大。每一粒运出巢外的土都推进对应的几何形状。
 */
export class NestExpansion {
  project: ExpansionProject | null = null;
  completed = 0;
  /** 已完成的房间扩大次数 */
  enlarged = 0;
  private acc = 0;

  constructor(private w: World) {}

  toSave(): ExpansionSave {
    const p = this.project;
    return {
      project: p && {
        face: p.face.node,
        type: p.type,
        floor: [p.floor.x, p.floor.y, p.floor.z],
        rx: p.rx,
        rz: p.rz,
        ry: p.ry,
        yaw: p.yaw,
        chamber: p.chamber?.id ?? -1,
        soil: p.soil,
        soilNeeded: p.soilNeeded,
        startedDay: p.startedDay,
        enlarge: p.enlarge,
      },
      completed: this.completed,
      enlarged: this.enlarged,
    };
  }

  /** 在蚁穴结构恢复之后调用 */
  restore(s: ExpansionSave): void {
    this.completed = s.completed;
    this.enlarged = s.enlarged ?? 0;
    this.project = null;
    const p = s.project;
    if (!p) return;
    const nest = this.w.nest;
    const chamber = p.chamber >= 0 ? (nest.chambers[p.chamber] ?? null) : null;
    let face = nest.faces.find((f) => f.node === p.face);
    // 隧道挖通后工作面已从 faces 中移除，房间阶段只用到它的 node（即房门）
    if (!face && chamber) {
      const edge = nest.edges[nest.nodes[p.face].edges[0]];
      face = { node: p.face, edge, full: { points: edge.points, cum: edge.cum, length: edge.length }, len: edge.length, maxLen: edge.length };
    }
    if (!face) return;
    this.project = { ...p, face, floor: new THREE.Vector3(p.floor[0], p.floor[1], p.floor[2]), chamber, enlarge: p.enlarge ?? null };
  }

  /** 已完工房间可容纳的成虫与幼体总数 */
  capacity(): number {
    let area = 0;
    for (const c of this.w.nest.chambers) if (c.ready) area += c.rx * c.rz;
    return area * CONFIG.expansion.capacityPerArea;
  }

  occupancy(): number {
    const col = this.w.colony;
    const b = col.broodCounts();
    return (col.ants.length + b.egg + b.larva + b.pupa) / Math.max(1, this.capacity());
  }

  update(days: number): void {
    this.acc += days;
    if (this.acc < 0.05) return;
    this.acc = 0;
    const E = CONFIG.expansion;
    if (this.project || this.occupancy() <= E.trigger) return;
    const full = this.w.nest.chambers.length >= E.maxChambers;
    if ((full || rng.chance(E.enlargeChance)) && this.planEnlarge()) return;
    if (!full) this.plan();
  }

  /** 选一间拥挤（每单位面积的蚂蚁最多）、放大后不碰到其他结构的房间 */
  private planEnlarge(): boolean {
    const E = CONFIG.expansion;
    const nest = this.w.nest;
    const crowd = new Map<number, number>();
    for (const a of this.w.colony.ants) if (a.room >= 0) crowd.set(a.room, (crowd.get(a.room) ?? 0) + 1);
    const cands = nest.chambers
      .filter((c) => c.ready && ENLARGEABLE.includes(c.type) && Math.max(c.rx, c.rz) * E.enlargeScale <= E.maxRoomRadius)
      .sort((a, b) => (crowd.get(b.id) ?? 0) / (b.rx * b.rz) - (crowd.get(a.id) ?? 0) / (a.rx * a.rz));
    const s = E.enlargeScale;
    for (const c of cands) {
      const door = nest.nodes[c.door].pos;
      const x = door.x + (c.floor.x - door.x) * s;
      const z = door.z + (c.floor.z - door.z) * s;
      if (!nest.canEnlarge(c, x, z, c.rx * s, c.rz * s)) continue;
      const edge = nest.edges[nest.nodes[c.door].edges[0]];
      this.project = {
        face: { node: c.door, edge, full: { points: edge.points, cum: edge.cum, length: edge.length }, len: edge.length, maxLen: edge.length },
        type: c.type,
        floor: c.floor.clone(),
        rx: c.rx,
        rz: c.rz,
        ry: c.ry,
        yaw: c.yaw,
        chamber: c,
        soil: 0,
        soilNeeded: Math.round(c.rx * c.rz * (s * s - 1) * E.chamberSoilPerArea),
        startedDay: this.w.clock.totalDays,
        enlarge: { from: [c.floor.x, c.floor.z, c.rx, c.rz], to: [x, z, c.rx * s, c.rz * s] },
      };
      this.w.events.push(L('ev.enlargeStart', { pct: Math.round(this.occupancy() * 100), room: c.label }), { kind: 'chamber', id: c.id });
      return true;
    }
    return false;
  }

  private plan(): boolean {
    const nest = this.w.nest;
    const col = this.w.colony;
    const b = col.broodCounts();
    // 幼体多时优先扩建育幼空间，否则扩建工蚁休息室
    const type: ChamberType = b.egg + b.larva + b.pupa > col.ants.length * 0.22 ? 'larva' : 'rest';
    const anchors = nest.nodes.filter((n) => n.kind === 'junction' && nest.surfaceY - n.pos.y > 8);
    for (let k = 0; k < 60; k++) {
      const jn = rng.pick(anchors);
      const rx = type === 'larva' ? rng.range(8, 10) : rng.range(7, 8.5);
      const rz = rx * rng.range(0.75, 0.88);
      const ry = rng.range(2.6, 3.2);
      const ang = rng.range(0, TAU);
      const dist = Math.max(rx, rz) + rng.range(4, 7);
      const floor = jn.pos.clone().add(new THREE.Vector3(Math.cos(ang) * dist, -rng.range(1, 3), Math.sin(ang) * dist));
      if (Math.hypot(floor.x, floor.z) > 40) continue;
      const yaw = rng.range(0, Math.PI);
      if (!nest.isClear(floor, rx, rz, ry, jn.pos)) continue;
      const door = nest.doorPosition(floor, rx, rz, yaw, jn.pos);
      nest.reserved.push({ x: floor.x, y: floor.y, z: floor.z, r: Math.max(rx, rz) });
      const face = nest.planFace(jn.id, door, rng, CONFIG.nest.tunnelRadius, 0.8, 0.6);
      this.project = {
        face,
        type,
        floor,
        rx,
        rz,
        ry,
        yaw,
        chamber: null,
        soil: 0,
        soilNeeded: Math.round(rx * rz * CONFIG.expansion.chamberSoilPerArea),
        startedDay: this.w.clock.totalDays,
        enlarge: null,
      };
      this.w.events.push(L('ev.digStart', { pct: Math.round(this.occupancy() * 100), room: CHAMBER_INFO[type].name }), undefined, nest.nodes[face.node].pos);
      return true;
    }
    return false;
  }

  diggersAt(node: number): number {
    let n = 0;
    for (const a of this.w.colony.ants) if (a.digNode === node) n++;
    return n;
  }

  /** 挖掘者应前往的工作面：优先扩建工程，其次缓慢延长现有的盲端隧道 */
  pickFace(): DigFace | null {
    const p = this.project;
    if (p && this.diggersAt(p.face.node) < CONFIG.expansion.maxDiggers) return p.face;
    const open = this.w.nest.faces.filter((f) => f !== p?.face && f.len < f.maxLen - 0.01);
    return open.length ? rng.pick(open) : null;
  }

  isProjectFace(node: number): boolean {
    return this.project?.face.node === node;
  }

  /** 正在扩大的房间 */
  enlarging(): Chamber | null {
    return this.project?.enlarge ? this.project.chamber : null;
  }

  /** 房间阶段的挖掘点：已挖出部分的远端；扩大房间时是墙边的随机一处 */
  digPoint(out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.project?.chamber;
    if (!c) return null;
    if (this.project!.enlarge) {
      const a = rng.range(0, TAU);
      const lx = Math.cos(a) * c.rx * 0.62;
      const lz = Math.sin(a) * c.rz * 0.62;
      const cy = Math.cos(c.yaw);
      const sy = Math.sin(c.yaw);
      return out.set(c.floor.x + lx * cy - lz * sy, c.floor.y, c.floor.z + lx * sy + lz * cy);
    }
    const door = this.w.nest.nodes[c.door].pos;
    const k = Math.min(0.85, c.grow * 0.9);
    out.copy(door).lerp(c.floor, k);
    out.x += rng.range(-1, 1) * c.rx * c.grow * 0.35;
    out.z += rng.range(-1, 1) * c.rz * c.grow * 0.35;
    out.y = c.floor.y;
    return out;
  }

  /** 挖下一粒土，推进工作面 */
  excavate(node: number): void {
    const E = CONFIG.expansion;
    const nest = this.w.nest;
    const col = this.w.colony;
    const p = this.project;
    if (p && p.face.node === node) {
      if (p.enlarge && p.chamber) {
        const c = p.chamber;
        p.soil++;
        const k = Math.min(1, p.soil / p.soilNeeded);
        const [x0, z0, rx0, rz0] = p.enlarge.from;
        const [x1, z1, rx1, rz1] = p.enlarge.to;
        c.floor.x = x0 + (x1 - x0) * k;
        c.floor.z = z0 + (z1 - z0) * k;
        c.rx = rx0 + (rx1 - rx0) * k;
        c.rz = rz0 + (rz1 - rz0) * k;
        if (k >= 1) {
          nest.rev++;
          this.enlarged++;
          c.enlarged++;
          this.project = null;
          const days = this.w.clock.totalDays - p.startedDay;
          this.w.events.push(L('ev.enlargeDone', { room: c.label, days: days.toFixed(1), w: (c.rx * 2 * 0.71).toFixed(0), d: (c.rz * 2 * 0.71).toFixed(0) }), { kind: 'chamber', id: c.id });
        }
        return;
      }
      if (!p.chamber) {
        nest.growFace(p.face, p.face.len + 1 / E.tunnelSoilPerUnit);
        if (p.face.len >= p.face.full.length - 1e-3) {
          p.chamber = nest.openChamber(p.face, p.type, p.floor, p.rx, p.rz, p.ry, p.yaw);
          col.ensureChamberSlots();
          this.w.events.push(L('ev.tunnelThrough', { room: p.chamber.label }), { kind: 'chamber', id: p.chamber.id });
        }
      } else {
        const c = p.chamber;
        p.soil++;
        c.grow = Math.min(1, 0.08 + (0.92 * p.soil) / p.soilNeeded);
        if (p.soil >= p.soilNeeded) {
          c.grow = 1;
          c.ready = true;
          nest.rev++;
          this.completed++;
          this.project = null;
          const days = this.w.clock.totalDays - p.startedDay;
          this.w.events.push(L('ev.digDone', { room: c.label, days: days.toFixed(1) }), { kind: 'chamber', id: c.id });
        }
      }
      return;
    }
    const face = nest.faces.find((f) => f.node === node);
    if (face && face.len < face.maxLen) nest.growFace(face, Math.min(face.maxLen, face.len + 0.5 / E.tunnelSoilPerUnit));
  }
}

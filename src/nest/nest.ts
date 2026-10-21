import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../util/random';
import type { Terrain } from '../world/terrain';

export type ChamberType = 'queen' | 'egg' | 'larva' | 'pupa' | 'solar' | 'food' | 'waste' | 'rest' | 'winter';

export const CHAMBER_INFO: Record<ChamberType, { name: string; desc: string }> = {
  queen: {
    name: '蚁后室',
    desc: '蚁群唯一的繁殖个体居住于此。黑毛蚁蚁后寿命可达 20 年以上，由保育蚁喂食、清洁，持续产卵。',
  },
  egg: {
    name: '卵室',
    desc: '保育蚁把蚁后产下的卵聚成卵团，不断舔舐以保持湿润、抑制霉菌。',
  },
  larva: {
    name: '幼虫室',
    desc: '幼虫无足，完全依赖保育蚁喂食猎物碎块与反刍液。幼虫期获得的营养决定其成年后的体型。',
  },
  pupa: {
    name: '蛹室',
    desc: '黑毛蚁老熟幼虫吐丝结茧化蛹。蛹偏好较温暖干燥的环境，白天常被搬到靠近地表的房间。',
  },
  solar: {
    name: '向阳育幼室',
    desc: '紧贴在石块下方的浅层房间。石块白天吸收阳光、升温很快，保育蚁会在午后把蛹搬到这里“晒暖”加速发育，夜间降温后再搬回深处。',
  },
  food: {
    name: '储食室',
    desc: '暂存觅食蚁带回的猎物碎块与种子。蜜露等液体食物主要储存在工蚁的嗉囊（“社会胃”）中。',
  },
  waste: {
    name: '垃圾室',
    desc: '食物残渣、茧壳与排泄物先在此堆放，再由内务蚁搬到巢外垃圾堆，以降低病原体在巢内传播的风险。',
  },
  rest: {
    name: '工蚁休息室',
    desc: '暂时没有任务的工蚁在此聚集休息。这些“后备劳动力”会在蚁群需要时被动员。',
  },
  winter: {
    name: '越冬室',
    desc: '位于蚁穴最深处，温度全年稳定。秋冬季整个蚁群会迁入这里进入滞育状态。',
  },
};

export type NodeKind = 'entrance' | 'junction' | 'door' | 'deadend';

export interface NestNode {
  id: number;
  kind: NodeKind;
  pos: THREE.Vector3;
  edges: number[];
  chamber?: number;
}

export interface NestEdge {
  id: number;
  a: number;
  b: number;
  points: THREE.Vector3[];
  cum: number[];
  length: number;
  radius: number;
  isShaft: boolean;
  /** 几何版本号，隧道变长时递增，供视图重建网格 */
  rev: number;
}

export interface Chamber {
  id: number;
  type: ChamberType;
  name: string;
  /** 地板中心 */
  floor: THREE.Vector3;
  rx: number;
  rz: number;
  ry: number;
  yaw: number;
  door: number;
  depth: number;
  /** 挖掘完成、可以使用 */
  ready: boolean;
  /** 已挖出的比例 0..1（扩建中的房间从门口向内长大） */
  grow: number;
  /** 位于石块下方，白天额外升温 */
  underStone: boolean;
  /** 雨水灌入的积水程度 0..1 */
  wet: number;
  /** 完工后被扩大过的次数 */
  enlarged: number;
}

interface Path {
  points: THREE.Vector3[];
  cum: number[];
  length: number;
}

/** 隧道尽头的挖掘工作面：边按规划路径逐步变长，尽头节点随之前移 */
export interface DigFace {
  node: number;
  edge: NestEdge;
  full: Path;
  len: number;
  maxLen: number;
}

export interface Entrance {
  node: number;
  x: number;
  z: number;
  name: string;
  /** 被土粒封堵的程度 0..1，为 1 时不能出巢 */
  plug: number;
}

/** 存档中的蚁穴结构；坐标展平为 [x, y, z, x, y, z, …] */
export interface NestSave {
  nodes: { kind: NodeKind; p: number[]; e: number[]; c?: number }[];
  edges: { a: number; b: number; p: number[]; r: number; s: boolean }[];
  chambers: { type: ChamberType; name: string; floor: number[]; rx: number; rz: number; ry: number; yaw: number; door: number; ready: boolean; grow: number; stone: boolean; big?: number }[];
  faces: { node: number; edge: number; full: number[]; len: number; maxLen: number }[];
  reserved: { x: number; y: number; z: number; r: number }[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const flat = (pts: THREE.Vector3[]) => pts.flatMap((p) => [r3(p.x), r3(p.y), r3(p.z)]);
const unflat = (a: number[]) => {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
  return out;
};

function pathOf(points: THREE.Vector3[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  return { points, cum, length: cum[cum.length - 1] };
}

const _tmp = new THREE.Vector3();

export class Nest {
  nodes: NestNode[] = [];
  edges: NestEdge[] = [];
  chambers: Chamber[] = [];
  entrances: Entrance[] = [];
  faces: DigFace[] = [];
  /** 已规划但尚未挖出的房间位置（用于避让和土壤剖面范围） */
  reserved: { x: number; y: number; z: number; r: number }[] = [];
  /** 结构版本号：新增房间、隧道时递增 */
  rev = 0;
  surfaceY = 0;
  private next: Int16Array = new Int16Array(0);
  private distM: Float32Array = new Float32Array(0);

  constructor(private terrain: Terrain) {}

  /** 生成前调用：在地形上登记入口土丘 */
  static entranceLayout(): { x: number; z: number; name: string }[] {
    return [
      { x: 0, z: 0, name: '主入口' },
      { x: 9.5, z: -6.5, name: '侧入口' },
    ];
  }

  generate(seed: number): void {
    const r = new Rng(seed);
    const t = this.terrain;
    this.surfaceY = t.heightAt(0, 0);
    const y0 = t.baseHeight(0, 0);

    // 入口
    for (const e of Nest.entranceLayout()) {
      const y = t.heightAt(e.x, e.z) - 0.4;
      const id = this.addNode('entrance', new THREE.Vector3(e.x, y, e.z));
      this.entrances.push({ node: id, x: e.x, z: e.z, name: e.name, plug: 0 });
    }

    // 主竖井：从主入口蜿蜒向下，沿途设置分岔点
    const depths = [6, 9, 21, 34, 48, 62, 76];
    const junctions: number[] = [];
    let jx = 0;
    let jz = 0;
    for (const d of depths) {
      jx += r.range(-2.5, 2.5);
      jz += r.range(-2.5, 2.5);
      junctions.push(this.addNode('junction', new THREE.Vector3(jx, y0 - d, jz)));
    }
    let prev = this.entrances[0].node;
    for (const j of junctions) {
      this.addTunnel(prev, j, r, CONFIG.nest.shaftRadius, true, 1.6);
      prev = j;
    }
    // 侧入口接入第二个分岔点
    this.addTunnel(this.entrances[1].node, junctions[1], r, CONFIG.nest.tunnelRadius, true, 2.5);

    const specs: { type: ChamberType; j: number; ang: number; dist: number; rx: number; rz: number }[] = [
      { type: 'food', j: 1, ang: 0.6, dist: 14, rx: 9, rz: 7 },
      { type: 'waste', j: 1, ang: 3.7, dist: 12, rx: 6.5, rz: 5.5 },
      { type: 'pupa', j: 2, ang: 2.2, dist: 15, rx: 10, rz: 8 },
      { type: 'rest', j: 2, ang: 5.1, dist: 14, rx: 8.5, rz: 7 },
      { type: 'larva', j: 3, ang: 0.9, dist: 15, rx: 11, rz: 8.5 },
      { type: 'larva', j: 3, ang: 4.0, dist: 14, rx: 9.5, rz: 7.5 },
      { type: 'egg', j: 4, ang: 2.0, dist: 13, rx: 8, rz: 7 },
      { type: 'queen', j: 4, ang: 5.2, dist: 13, rx: 9, rz: 8 },
      { type: 'rest', j: 5, ang: 3.5, dist: 13, rx: 8, rz: 7 },
      { type: 'winter', j: 6, ang: 1.5, dist: 14, rx: 12, rz: 9.5 },
      // 朝向蚁穴西北侧的大石块
      { type: 'solar', j: 0, ang: 2.57, dist: 11, rx: 7, rz: 6 },
    ];
    for (const s of specs) {
      const jn = this.nodes[junctions[s.j]];
      const ang = s.ang + r.range(-0.15, 0.15);
      const dir = _tmp.set(Math.cos(ang), 0, Math.sin(ang));
      const ry = r.range(2.6, 3.4);
      const floor = jn.pos.clone().addScaledVector(dir, s.dist);
      floor.y -= r.range(1.0, 3.0);
      const yaw = r.range(0, Math.PI);
      const door = this.addNode('door', this.doorPosition(floor, s.rx, s.rz, yaw, jn.pos));
      this.addChamber(s.type, floor, s.rx, s.rz, ry, yaw, door, true);
      this.addTunnel(junctions[s.j], door, r, CONFIG.nest.tunnelRadius, false, 2.2);
    }
    // 正在挖掘的盲端隧道（工作面），每条还能继续向前挖 8 cm
    const digs = [
      { j: 3, ang: 2.5, len: 9 },
      { j: 5, ang: 0.4, len: 10 },
      { j: 2, ang: 0.4, len: 8 },
    ];
    for (const d of digs) {
      const jn = this.nodes[junctions[d.j]];
      const total = d.len + 8;
      const drop = -r.range(0.5, 2) * (total / d.len);
      const target = jn.pos.clone().add(new THREE.Vector3(Math.cos(d.ang) * total, drop, Math.sin(d.ang) * total));
      this.planFace(junctions[d.j], target, r, CONFIG.nest.tunnelRadius * 0.9, 1.5, d.len, false);
    }

    this.computeRouting();
  }

  /** 门在地板边缘，朝向连接它的分岔点 */
  doorPosition(floor: THREE.Vector3, rx: number, rz: number, yaw: number, from: THREE.Vector3): THREE.Vector3 {
    const toJ = from.clone().sub(floor).setY(0).normalize();
    const edgeR = this.ellipseRadius(rx, rz, yaw, Math.atan2(toJ.z, toJ.x)) * 0.68;
    const p = floor.clone().addScaledVector(toJ, edgeR);
    p.y += 0.15;
    return p;
  }

  private addChamber(type: ChamberType, floor: THREE.Vector3, rx: number, rz: number, ry: number, yaw: number, door: number, ready: boolean): Chamber {
    const cid = this.chambers.length;
    this.nodes[door].chamber = cid;
    const info = CHAMBER_INFO[type];
    const sameType = this.chambers.filter((c) => c.type === type).length;
    const c: Chamber = {
      id: cid,
      type,
      name: sameType > 0 ? `${info.name} ${sameType + 1}` : info.name,
      floor,
      rx,
      rz,
      ry,
      yaw,
      door,
      depth: this.surfaceY - floor.y,
      ready,
      grow: ready ? 1 : 0.08,
      underStone: false,
      wet: 0,
      enlarged: 0,
    };
    this.chambers.push(c);
    this.rev++;
    return c;
  }

  /** 规划一条从 from 通往 target 的隧道，先挖出 initLen 长度，返回其工作面 */
  planFace(from: number, target: THREE.Vector3, r: Rng, radius: number, wobble: number, initLen: number, reroute = true): DigFace {
    const full = this.makePath(this.nodes[from].pos, target, r, wobble);
    const tip = this.addNode('deadend', full.points[0].clone());
    const edge: NestEdge = { id: this.edges.length, a: from, b: tip, points: [], cum: [], length: 0, radius, isShaft: false, rev: 0 };
    this.edges.push(edge);
    this.nodes[from].edges.push(edge.id);
    this.nodes[tip].edges.push(edge.id);
    const face: DigFace = { node: tip, edge, full, len: 0, maxLen: full.length };
    this.faces.push(face);
    this.growFace(face, initLen, reroute);
    this.rev++;
    return face;
  }

  /** 把工作面推进到规划路径上的 len 处 */
  growFace(face: DigFace, len: number, reroute = true): void {
    const { points, cum } = face.full;
    len = Math.min(face.full.length, Math.max(0.3, len));
    face.len = len;
    const out = [points[0].clone()];
    const oc = [0];
    let i = 1;
    while (i < points.length && cum[i] < len) {
      out.push(points[i].clone());
      oc.push(cum[i]);
      i++;
    }
    if (i < points.length) {
      const k = (len - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      out.push(points[i - 1].clone().lerp(points[i], k));
      oc.push(len);
    }
    const e = face.edge;
    e.points = out;
    e.cum = oc;
    e.length = oc[oc.length - 1];
    e.rev++;
    this.nodes[face.node].pos.copy(out[out.length - 1]);
    if (reroute) this.computeRouting();
  }

  /** 工作面挖到规划位置后，在尽头开出一间新房间（尚未完工） */
  openChamber(face: DigFace, type: ChamberType, floor: THREE.Vector3, rx: number, rz: number, ry: number, yaw: number): Chamber {
    const node = this.nodes[face.node];
    node.kind = 'door';
    this.faces.splice(this.faces.indexOf(face), 1);
    this.reserved = this.reserved.filter((p) => Math.hypot(p.x - floor.x, p.z - floor.z) > 0.5);
    return this.addChamber(type, floor, rx, rz, ry, yaw, face.node, false);
  }

  /** 新房间位置是否与现有房间、隧道保持距离，且连接隧道不会穿过其他房间 */
  isClear(floor: THREE.Vector3, rx: number, rz: number, ry: number, anchor: THREE.Vector3): boolean {
    const R = Math.max(rx, rz);
    const blockers = [
      ...this.chambers.map((c) => ({ x: c.floor.x, y: c.floor.y, z: c.floor.z, r: Math.max(c.rx, c.rz), h: c.ry })),
      ...this.reserved.map((p) => ({ ...p, h: 3 })),
    ];
    for (const b of blockers) {
      if (Math.abs(floor.y - b.y) < 8 && Math.hypot(floor.x - b.x, floor.z - b.z) < R + b.r + 2.5) return false;
    }
    for (let t = 0.15; t < 0.86; t += 0.1) {
      const px = anchor.x + (floor.x - anchor.x) * t;
      const py = anchor.y + (floor.y - anchor.y) * t;
      const pz = anchor.z + (floor.z - anchor.z) * t;
      for (const b of blockers) {
        if (Math.abs(py - b.y - b.h * 0.5) < b.h * 1.5 + 1 && Math.hypot(px - b.x, pz - b.z) < b.r + 1.2) return false;
      }
    }
    for (const e of this.edges)
      for (let i = 0; i < e.points.length; i += 2) {
        const p = e.points[i];
        if (Math.abs(p.y - floor.y - ry * 0.5) < ry + 2.5 && Math.hypot(p.x - floor.x, p.z - floor.z) < R + 1.5) return false;
      }
    return true;
  }

  /** 房间放大到地板中心 (x, z)、半径 rx × rz 后，是否仍与其他房间、隧道（不含自己门口的隧道）保持距离 */
  canEnlarge(c: Chamber, x: number, z: number, rx: number, rz: number): boolean {
    if (Math.hypot(x, z) > 40) return false;
    const R = Math.max(rx, rz);
    for (const o of this.chambers) {
      if (o !== c && Math.abs(o.floor.y - c.floor.y) < 8 && Math.hypot(o.floor.x - x, o.floor.z - z) < R + Math.max(o.rx, o.rz) + 2) return false;
    }
    for (const p of this.reserved) {
      if (Math.abs(p.y - c.floor.y) < 8 && Math.hypot(p.x - x, p.z - z) < R + p.r + 2) return false;
    }
    for (const e of this.edges) {
      if (e.a === c.door || e.b === c.door) continue;
      for (let i = 0; i < e.points.length; i += 2) {
        const p = e.points[i];
        if (Math.abs(p.y - c.floor.y - c.ry * 0.5) < c.ry + 2 && Math.hypot(p.x - x, p.z - z) < R + 1.2) return false;
      }
    }
    return true;
  }

  private ellipseRadius(rx: number, rz: number, yaw: number, ang: number): number {
    const a = ang - yaw;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return 1 / Math.sqrt((c * c) / (rx * rx) + (s * s) / (rz * rz));
  }

  private addNode(kind: NodeKind, pos: THREE.Vector3): number {
    const id = this.nodes.length;
    this.nodes.push({ id, kind, pos, edges: [] });
    return id;
  }

  private addTunnel(a: number, b: number, r: Rng, radius: number, isShaft: boolean, wobble: number): void {
    const { points, cum, length } = this.makePath(this.nodes[a].pos, this.nodes[b].pos, r, wobble);
    const id = this.edges.length;
    this.edges.push({ id, a, b, points, cum, length, radius, isShaft, rev: 0 });
    this.nodes[a].edges.push(id);
    this.nodes[b].edges.push(id);
  }

  /** 两点之间带随机弯曲的隧道中心线，按约 0.8 单位等距采样 */
  private makePath(pa: THREE.Vector3, pb: THREE.Vector3, r: Rng, wobble: number): Path {
    const ctrl: THREE.Vector3[] = [pa.clone()];
    const len = pa.distanceTo(pb);
    const n = Math.max(1, Math.round(len / 7));
    for (let i = 1; i < n + 1; i++) {
      const k = i / (n + 1);
      const p = pa.clone().lerp(pb, k);
      p.x += r.range(-wobble, wobble);
      p.z += r.range(-wobble, wobble);
      p.y += r.range(-wobble, wobble) * 0.3;
      ctrl.push(p);
    }
    ctrl.push(pb.clone());
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const samples = Math.max(8, Math.round(curve.getLength() / 0.8));
    return pathOf(curve.getSpacedPoints(samples));
  }

  toSave(): NestSave {
    return {
      nodes: this.nodes.map((n) => ({ kind: n.kind, p: flat([n.pos]), e: n.edges.slice(), ...(n.chamber !== undefined ? { c: n.chamber } : {}) })),
      edges: this.edges.map((e) => ({ a: e.a, b: e.b, p: flat(e.points), r: e.radius, s: e.isShaft })),
      chambers: this.chambers.map((c) => ({
        type: c.type,
        name: c.name,
        floor: flat([c.floor]),
        rx: c.rx,
        rz: c.rz,
        ry: c.ry,
        yaw: c.yaw,
        door: c.door,
        ready: c.ready,
        grow: c.grow,
        stone: c.underStone,
        ...(c.enlarged ? { big: c.enlarged } : {}),
      })),
      faces: this.faces.map((f) => ({ node: f.node, edge: f.edge.id, full: flat(f.full.points), len: f.len, maxLen: f.maxLen })),
      reserved: this.reserved.map((r) => ({ ...r })),
    };
  }

  /** 读档：替换整个蚁穴结构。入口是最先生成的节点，编号不变 */
  restore(s: NestSave): void {
    this.nodes = s.nodes.map((n, id) => ({ id, kind: n.kind, pos: unflat(n.p)[0], edges: n.e.slice(), ...(n.c !== undefined ? { chamber: n.c } : {}) }));
    this.edges = s.edges.map((e, id) => {
      const { points, cum, length } = pathOf(unflat(e.p));
      return { id, a: e.a, b: e.b, points, cum, length, radius: e.r, isShaft: e.s, rev: 0 };
    });
    this.chambers = s.chambers.map((c, id) => {
      const floor = unflat(c.floor)[0];
      return { id, type: c.type, name: c.name, floor, rx: c.rx, rz: c.rz, ry: c.ry, yaw: c.yaw, door: c.door, depth: this.surfaceY - floor.y, ready: c.ready, grow: c.grow, underStone: c.stone, wet: 0, enlarged: c.big ?? 0 };
    });
    this.faces = s.faces.map((f) => ({ node: f.node, edge: this.edges[f.edge], full: pathOf(unflat(f.full)), len: f.len, maxLen: f.maxLen }));
    this.reserved = s.reserved.map((r) => ({ ...r }));
    this.rev++;
    this.computeRouting();
  }

  private computeRouting(): void {
    const n = this.nodes.length;
    const dist = new Float32Array(n * n).fill(Infinity);
    const next = new Int16Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) {
      dist[i * n + i] = 0;
      next[i * n + i] = i;
    }
    for (const e of this.edges) {
      dist[e.a * n + e.b] = e.length;
      dist[e.b * n + e.a] = e.length;
      next[e.a * n + e.b] = e.b;
      next[e.b * n + e.a] = e.a;
    }
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++) {
        const dik = dist[i * n + k];
        if (dik === Infinity) continue;
        for (let j = 0; j < n; j++) {
          const v = dik + dist[k * n + j];
          if (v < dist[i * n + j]) {
            dist[i * n + j] = v;
            next[i * n + j] = next[i * n + k];
          }
        }
      }
    this.next = next;
    this.distM = dist;
  }

  nextHop(from: number, to: number): number {
    return this.next[from * this.nodes.length + to];
  }

  routeLength(from: number, to: number): number {
    return this.distM[from * this.nodes.length + to];
  }

  edgeBetween(a: number, b: number): NestEdge {
    for (const id of this.nodes[a].edges) {
      const e = this.edges[id];
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    throw new Error(`no edge ${a}-${b}`);
  }

  /** 沿边从 from 端走过 s 距离处的中心线位置与切线 */
  sampleEdge(e: NestEdge, from: number, s: number, outPos: THREE.Vector3, outTan: THREE.Vector3): void {
    const d = from === e.a ? s : e.length - s;
    const cum = e.cum;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const k = Math.min(1, Math.max(0, (d - cum[lo]) / seg));
    outPos.copy(e.points[lo]).lerp(e.points[hi], k);
    outTan.copy(e.points[hi]).sub(e.points[lo]).normalize();
    if (from !== e.a) outTan.negate();
  }

  /** 指定类型的已完工房间 */
  chamberOfType(type: ChamberType): Chamber[] {
    return this.chambers.filter((c) => c.type === type && c.ready);
  }

  /** 房间地板内的随机点 */
  randomFloorPoint(c: Chamber, r: () => number, out: THREE.Vector3, margin = 0.62): THREE.Vector3 {
    const a = r() * Math.PI * 2;
    const k = Math.sqrt(r()) * margin;
    const lx = Math.cos(a) * c.rx * k;
    const lz = Math.sin(a) * c.rz * k;
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    return out.set(c.floor.x + lx * cy - lz * sy, c.floor.y, c.floor.z + lx * sy + lz * cy);
  }

  /** (x, z) 是否在房间地板椭圆的 margin 倍以内 */
  insideFloor(c: Chamber, x: number, z: number, margin: number): boolean {
    const dx = x - c.floor.x;
    const dz = z - c.floor.z;
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    const lx = (dx * cy + dz * sy) / c.rx;
    const lz = (-dx * sy + dz * cy) / c.rz;
    return lx * lx + lz * lz <= margin * margin;
  }

  /** 判断世界坐标点落在哪个房间内（用于统计与信息面板） */
  chamberAt(p: THREE.Vector3): Chamber | null {
    for (const c of this.chambers) {
      if (!c.ready) continue;
      const dy = p.y - c.floor.y;
      if (dy < -1 || dy > c.ry * 1.8) continue;
      const dx = p.x - c.floor.x;
      const dz = p.z - c.floor.z;
      const cy = Math.cos(-c.yaw);
      const sy = Math.sin(-c.yaw);
      const lx = dx * cy - dz * sy;
      const lz = dx * sy + dz * cy;
      if ((lx * lx) / (c.rx * c.rx) + (lz * lz) / (c.rz * c.rz) < 0.6) return c;
    }
    return null;
  }

  nearestEntrance(x: number, z: number): Entrance {
    let best = this.entrances[0];
    let bd = Infinity;
    for (const e of this.entrances) {
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
}

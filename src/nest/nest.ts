import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../util/random';
import type { Terrain } from '../world/terrain';

export type ChamberType = 'queen' | 'egg' | 'larva' | 'pupa' | 'food' | 'waste' | 'rest' | 'winter';

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
}

export interface Entrance {
  node: number;
  x: number;
  z: number;
  name: string;
}

const _tmp = new THREE.Vector3();

export class Nest {
  nodes: NestNode[] = [];
  edges: NestEdge[] = [];
  chambers: Chamber[] = [];
  entrances: Entrance[] = [];
  deadEnds: number[] = [];
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
      this.entrances.push({ node: id, x: e.x, z: e.z, name: e.name });
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
    ];
    for (const s of specs) {
      const jn = this.nodes[junctions[s.j]];
      const ang = s.ang + r.range(-0.15, 0.15);
      const dir = _tmp.set(Math.cos(ang), 0, Math.sin(ang));
      const ry = r.range(2.6, 3.4);
      const floor = jn.pos.clone().addScaledVector(dir, s.dist);
      floor.y -= r.range(1.0, 3.0);
      const yaw = r.range(0, Math.PI);
      const cid = this.chambers.length;
      // 门在地板边缘，朝向分岔点
      const toJ = jn.pos.clone().sub(floor).setY(0).normalize();
      const edgeR = this.ellipseRadius(s.rx, s.rz, yaw, Math.atan2(toJ.z, toJ.x)) * 0.68;
      const doorPos = floor.clone().addScaledVector(toJ, edgeR);
      doorPos.y += 0.15;
      const door = this.addNode('door', doorPos);
      this.nodes[door].chamber = cid;
      const info = CHAMBER_INFO[s.type];
      const sameType = this.chambers.filter((c) => c.type === s.type).length;
      this.chambers.push({
        id: cid,
        type: s.type,
        name: sameType > 0 ? `${info.name} ${sameType + 1}` : info.name,
        floor,
        rx: s.rx,
        rz: s.rz,
        ry,
        yaw,
        door,
        depth: this.surfaceY - floor.y,
      });
      this.addTunnel(junctions[s.j], door, r, CONFIG.nest.tunnelRadius, false, 2.2);
    }
    // 正在挖掘的盲端隧道（工作面）
    const digs = [
      { j: 3, ang: 2.5, len: 9 },
      { j: 5, ang: 0.4, len: 10 },
      { j: 2, ang: 0.4, len: 8 },
    ];
    for (const d of digs) {
      const jn = this.nodes[junctions[d.j]];
      const p = jn.pos.clone().add(new THREE.Vector3(Math.cos(d.ang) * d.len, -r.range(0.5, 2), Math.sin(d.ang) * d.len));
      const id = this.addNode('deadend', p);
      this.deadEnds.push(id);
      this.addTunnel(junctions[d.j], id, r, CONFIG.nest.tunnelRadius * 0.9, false, 1.5);
    }

    this.computeRouting();
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
    const pa = this.nodes[a].pos;
    const pb = this.nodes[b].pos;
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
    const points = curve.getSpacedPoints(samples);
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    const id = this.edges.length;
    this.edges.push({ id, a, b, points, cum, length: cum[cum.length - 1], radius, isShaft });
    this.nodes[a].edges.push(id);
    this.nodes[b].edges.push(id);
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

  chamberOfType(type: ChamberType): Chamber[] {
    return this.chambers.filter((c) => c.type === type);
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

  /** 判断世界坐标点落在哪个房间内（用于统计与信息面板） */
  chamberAt(p: THREE.Vector3): Chamber | null {
    for (const c of this.chambers) {
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

import * as THREE from 'three';

/** 图上的一条边：两端节点和长度 */
export interface GraphEdge {
  a: number;
  b: number;
  length: number;
}

/** 折线边：points 是中心线，cum 是各点到 points[0] 的累计长度 */
export interface PolylineEdge extends GraphEdge {
  points: THREE.Vector3[];
  cum: number[];
}

/** GraphWalker 需要的图：下一跳和两点之间的边 */
export interface NavGraph<E extends GraphEdge> {
  nextHop(from: number, to: number): number;
  edgeBetween(a: number, b: number): E;
}

/** 所有节点对之间的最短路（Floyd），节点或边变化后要重建；节点数在几百以内 */
export class Routes {
  private n = 0;
  private next: Int16Array = new Int16Array(0);
  private dist: Float32Array = new Float32Array(0);

  build(nodeCount: number, edges: readonly GraphEdge[]): void {
    const n = nodeCount;
    const dist = new Float32Array(n * n).fill(Infinity);
    const next = new Int16Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) {
      dist[i * n + i] = 0;
      next[i * n + i] = i;
    }
    for (const e of edges) {
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
    this.n = n;
    this.next = next;
    this.dist = dist;
  }

  /** 从 from 去 to 的下一个节点；不连通时是 -1 */
  nextHop(from: number, to: number): number {
    return this.next[from * this.n + to];
  }

  length(from: number, to: number): number {
    return this.dist[from * this.n + to];
  }
}

/** 沿边从 from 端走过 s 距离处的中心线位置与切线 */
export function samplePolyline(e: PolylineEdge, from: number, s: number, outPos: THREE.Vector3, outTan: THREE.Vector3): void {
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

const DOWN = new THREE.Vector3(0, -1, 0);
const _l = new THREE.Vector3();

/**
 * 圆管隧道底部的落脚点：中心线 c、切线 t、半径 radius，lateral 是向右偏离的距离（半径的倍数）。
 * outDown 是贴着管壁指向下方的方向（与切线垂直）
 */
export function tunnelFloor(c: THREE.Vector3, t: THREE.Vector3, radius: number, lateral: number, out: THREE.Vector3, outDown: THREE.Vector3): void {
  outDown.copy(DOWN).addScaledVector(t, -DOWN.dot(t));
  if (outDown.lengthSq() < 0.04) outDown.set(1, 0, 0).cross(t);
  outDown.normalize();
  _l.crossVectors(t, outDown).normalize();
  out
    .copy(c)
    .addScaledVector(outDown, radius * 0.66)
    .addScaledVector(_l, lateral * radius);
}

/** advance 的结果：到了目标、还在边上、没有路、这一步换了三次边还没走完 */
export type WalkResult = 'arrived' | 'walking' | 'noRoute' | 'pending';

/** GraphWalker 的存档：边用它在边数组里的序号表示，不在边上时是 -1 */
export interface WalkerSave {
  node: number;
  edge: number;
  from: number;
  s: number;
  goal: number;
}

/** 在图上一跳一跳走向目标节点：在边上时记着从哪端出发、走了多远 */
export class GraphWalker<E extends GraphEdge> {
  node = -1;
  edge: E | null = null;
  from = -1;
  s = 0;
  /** 上一次 advance 有没有在边上走、走过的距离 */
  moved = false;
  walked = 0;
  /** 上一次 advance 的目标 */
  private goal = -1;

  /** 站到节点上 */
  at(node: number): void {
    this.node = node;
    this.edge = null;
  }

  /** 离得最近的节点（在边上时取已走过一半的那端） */
  nearNode(): number {
    const e = this.edge;
    if (!e) return this.node;
    return this.s > e.length / 2 ? (e.a === this.from ? e.b : e.a) : this.from;
  }

  /** 从 edge.a 量起的沿边坐标，以及行进方向（朝 b 为 1） */
  along(): number {
    return this.dir() > 0 ? this.s : this.edge!.length - this.s;
  }

  dir(): 1 | -1 {
    return this.from === this.edge!.a ? 1 : -1;
  }

  toSave(edges: readonly E[]): WalkerSave {
    return { node: this.node, edge: this.edge ? edges.indexOf(this.edge) : -1, from: this.from, s: Math.round(this.s * 1000) / 1000, goal: this.goal };
  }

  restore(s: WalkerSave, edges: readonly E[]): void {
    this.node = s.node;
    this.edge = edges[s.edge] ?? null;
    this.from = s.from;
    this.s = s.s;
    this.goal = s.goal;
  }

  /** 沿路走 step 的距离，一次最多换三条边。走到半路换了目标、而新路线要折回出发的那端时，就地掉头 */
  advance(g: NavGraph<E>, step: number, target: number): WalkResult {
    const total = step;
    this.moved = false;
    this.walked = 0;
    if (this.edge && target !== this.goal) {
      const to = this.edge.a === this.from ? this.edge.b : this.edge.a;
      if (to !== target && g.nextHop(to, target) === this.from) {
        this.from = this.node = to;
        this.s = this.edge.length - this.s;
      }
    }
    this.goal = target;
    for (let i = 0; i < 3; i++) {
      if (this.edge) {
        this.s += step;
        this.moved = true;
        if (this.s < this.edge.length) {
          this.walked = total;
          return 'walking';
        }
        step = this.s - this.edge.length;
        this.walked = total - step;
        this.node = this.edge.a === this.from ? this.edge.b : this.edge.a;
        this.edge = null;
      }
      if (this.node === target) return 'arrived';
      const nh = g.nextHop(this.node, target);
      if (nh < 0) return 'noRoute';
      this.edge = g.edgeBetween(this.node, nh);
      this.from = this.node;
      this.s = 0;
    }
    return 'pending';
  }
}

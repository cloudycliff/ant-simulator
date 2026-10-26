import { CONFIG } from '../config';
import { COMB_H, SITES, cellFace, cellSite, siteAt, siteU, siteV, type Comb } from './comb';

const H = CONFIG.hive;

/**
 * 巢脾表面上走路用的方格（T-008）：两面各一张，0.5 cm 一格，盖住巢脾和外面一圈 1 cm 宽的框条。
 * 格子编号 node = 面 × NODES + 行 × cols + 列；巢面坐标 (u, v) 和巢房的一样
 */
export const WALK = (() => {
  const step = 0.5;
  const u0 = -1;
  const v0 = -1;
  const cols = Math.round((H.combW + 2) / step);
  const rows = Math.round((COMB_H + 2) / step);
  return { step, u0, v0, cols, rows, n: cols * rows };
})();
export const NODES = WALK.n;

/** (u, v) 落在哪一格（不带面），出了方格返回 -1 */
export function nodeAt(u: number, v: number): number {
  const i = Math.floor((u - WALK.u0) / WALK.step);
  const j = Math.floor((v - WALK.v0) / WALK.step);
  if (i < 0 || j < 0 || i >= WALK.cols || j >= WALK.rows) return -1;
  return j * WALK.cols + i;
}

export const nodeU = (n: number) => WALK.u0 + ((n % NODES) % WALK.cols + 0.5) * WALK.step;
export const nodeV = (n: number) => WALK.v0 + (Math.floor((n % NODES) / WALK.cols) + 0.5) * WALK.step;

/** 框条：外面一圈和两框之间的木条 */
const isWood = (u: number, v: number) => u < 0 || u > H.combW || v < 0 || v > COMB_H || (v > H.frameH && v < H.frameH + H.bar);

/** 每个巢房位置的中心在哪一格（不带面） */
const SITE_NODE = (() => {
  const a = new Int32Array(SITES);
  for (let s = 0; s < SITES; s++) a[s] = nodeAt(siteU(s), siteV(s));
  return a;
})();
export const cellNode = (cell: number) => cellFace(cell) * NODES + SITE_NODE[cellSite(cell)];

/** 8 个方向：先上下左右，再斜着 */
const DI = [1, -1, 0, 0, 1, -1, 1, -1];
const DJ = [0, 0, 1, -1, 1, 1, -1, -1];
const FAR = 0xffff;

/**
 * 哪些格子能走：1 是巢脾（有巢房，造到一半的也算），2 是框条。两面一样，按巢脾的 shape 重建。
 * 巢脾的边（能走的巢脾格挨着走不了的格）可以绕到另一面，edge 记着往外的方向；框条贴着箱子，不能绕
 */
export class WalkMap {
  readonly walk = new Uint8Array(NODES);
  readonly edge = new Float32Array(NODES);
  shape = -1;

  sync(comb: Comb): boolean {
    if (this.shape === comb.shape) return false;
    this.shape = comb.shape;
    for (let n = 0; n < NODES; n++) {
      const u = nodeU(n);
      const v = nodeV(n);
      if (isWood(u, v)) this.walk[n] = 2;
      else {
        const s = siteAt(u, v);
        this.walk[n] = s >= 0 && comb.build[s] > 0 ? 1 : 0;
      }
    }
    for (let n = 0; n < NODES; n++) {
      this.edge[n] = NaN;
      if (this.walk[n] !== 1) continue;
      const i = n % WALK.cols;
      const j = Math.floor(n / WALK.cols);
      let ou = 0;
      let ov = 0;
      for (let d = 0; d < 8; d++) {
        const ii = i + DI[d];
        const jj = j + DJ[d];
        if (ii < 0 || jj < 0 || ii >= WALK.cols || jj >= WALK.rows || this.walk[jj * WALK.cols + ii] === 0) {
          ou += DI[d];
          ov += DJ[d];
        }
      }
      if (ou !== 0 || ov !== 0) this.edge[n] = Math.atan2(ov, ou);
    }
    return true;
  }

  /** (u, v) 能不能站 */
  ok(u: number, v: number): boolean {
    const n = nodeAt(u, v);
    return n >= 0 && this.walk[n] !== 0;
  }

  /** 格子 n（带面）往 d 方向的邻格，走不了或斜着切角时返回 -1 */
  step(n: number, d: number): number {
    const face = n >= NODES ? NODES : 0;
    const k = n - face;
    const i = (k % WALK.cols) + DI[d];
    const j = Math.floor(k / WALK.cols) + DJ[d];
    if (i < 0 || j < 0 || i >= WALK.cols || j >= WALK.rows) return -1;
    const m = j * WALK.cols + i;
    if (this.walk[m] === 0) return -1;
    if (d >= 4 && (this.walk[j * WALK.cols + (k % WALK.cols)] === 0 || this.walk[Math.floor(k / WALK.cols) * WALK.cols + i] === 0)) return -1;
    return face + m;
  }
}

/**
 * 路程场：两面所有格子到最近的源头走几步（绕边算一步）。要去某类地方的蜂沿着它下坡走，
 * 不会卡在没造好的缺口里（T-008）
 */
export class Field {
  readonly dist = new Uint16Array(2 * NODES).fill(FAR);
  /** 上次算的模拟时刻和走路方格的版本 */
  at = -Infinity;
  shape = -1;
  sources = 0;
  private queue = new Int32Array(2 * NODES);

  compute(map: WalkMap, sources: Iterable<number>, at: number): void {
    this.at = at;
    this.shape = map.shape;
    const dist = this.dist;
    const q = this.queue;
    dist.fill(FAR);
    let tail = 0;
    for (const n of sources) {
      if (n < 0 || dist[n] === 0 || map.walk[n % NODES] === 0) continue;
      dist[n] = 0;
      q[tail++] = n;
    }
    this.sources = tail;
    for (let head = 0; head < tail; head++) {
      const n = q[head];
      const d1 = dist[n] + 1;
      for (let d = 0; d < 8; d++) {
        const m = map.step(n, d);
        if (m >= 0 && dist[m] > d1) {
          dist[m] = d1;
          q[tail++] = m;
        }
      }
      const k = n % NODES;
      if (!Number.isNaN(map.edge[k])) {
        const m = n >= NODES ? k : k + NODES;
        if (dist[m] > d1) {
          dist[m] = d1;
          q[tail++] = m;
        }
      }
    }
  }

  /**
   * 从格子 n 往下坡走的下一格（可能是另一面的同一格，表示绕过去）；已在源头或走不到返回 -1。
   * busy 里不是 0 的格停着蜂，下坡的格里先挑空的
   */
  next(map: WalkMap, n: number, busy?: Uint8Array): number {
    const here = this.dist[n];
    if (here === 0 || here === FAR) return -1;
    let best = -1;
    let bestS = here * 2;
    const k = n % NODES;
    for (let d = 0; d <= 8; d++) {
      const m = d < 8 ? map.step(n, d) : Number.isNaN(map.edge[k]) ? -1 : n >= NODES ? k : k + NODES;
      if (m < 0 || this.dist[m] >= here) continue;
      const s = this.dist[m] * 2 + (busy && busy[m] ? 1 : 0);
      if (s < bestS) {
        bestS = s;
        best = m;
      }
    }
    return best;
  }

  reachable(n: number): boolean {
    return this.dist[n] !== FAR;
  }
}

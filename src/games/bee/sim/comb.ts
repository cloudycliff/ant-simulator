import type { Point3 } from '../../../core/sim/events';
import { clamp } from '../../../core/util/math';
import { Noise2D, type Rng } from '../../../core/util/random';
import { CONFIG } from '../config';

const H = CONFIG.hive;
const P = CONFIG.cell.pitch;

/** 巢脾整体的高度：两框加中间的木条 */
export const COMB_H = H.frameH * 2 + H.bar;

/** 巢房里装的东西；有没有巢房看 build */
export const CELL = { empty: 0, egg: 1, larva: 2, capped: 3, nectar: 4, honey: 5, cappedHoney: 6, pollen: 7 } as const;
export type CellContent = (typeof CELL)[keyof typeof CELL];
export const CONTENT_KEYS = ['empty', 'egg', 'larva', 'capped', 'nectar', 'honey', 'cappedHoney', 'pollen'] as const;
/** 花粉的几种颜色（不同的花），画面按这个编号取色 */
export const POLLEN_KINDS = 5;

/**
 * 巢脾的网格。巢面坐标 u 横向 0..combW、v 竖向 0..COMB_H（下框在下）。
 * 每框是尖角朝上的六边形网格，行从框底往上数，奇数行右移半格。
 * 位置（site）= 框 × ROWS × COLS + 行 × COLS + 列，两面共用；巢房（cell）= 面 × SITES + 位置，面 0 朝 +z。
 * 着色器（combView.ts）里有同样的换算，改这里要一起改
 */
export const GRID = (() => {
  const R = P / Math.sqrt(3);
  const rowH = 1.5 * R;
  const rows = Math.floor((H.frameH - 2 * R) / rowH) + 1;
  const cols = Math.floor((H.combW - P / 2) / P);
  return {
    R,
    rowH,
    rows,
    cols,
    /** 第 0 列（偶数行）中心的 u、每框第 0 行中心离框底的高度：网格在框里居中 */
    x0: (H.combW - cols * P - P / 2) / 2 + P / 2,
    y0: (H.frameH - (rows - 1) * rowH - 2 * R) / 2 + R,
    frameStep: H.frameH + H.bar,
    sites: 2 * rows * cols,
  };
})();
export const SITES = GRID.sites;
export const CELLS = 2 * SITES;

export function siteU(site: number): number {
  const col = site % GRID.cols;
  const row = Math.floor(site / GRID.cols) % GRID.rows;
  return GRID.x0 + col * P + (row & 1 ? P / 2 : 0);
}

export function siteV(site: number): number {
  const frame = Math.floor(site / (GRID.rows * GRID.cols));
  const row = Math.floor(site / GRID.cols) % GRID.rows;
  return frame * GRID.frameStep + GRID.y0 + row * GRID.rowH;
}

/** 巢面上一点落在哪个位置；在框外、木条上返回 -1 */
export function siteAt(u: number, v: number): number {
  const frame = v < H.frameH + H.bar / 2 ? 0 : 1;
  const y = v - frame * GRID.frameStep;
  if (y < 0 || y > H.frameH || u < 0 || u > H.combW) return -1;
  const px = u - GRID.x0;
  const py = y - GRID.y0;
  const r0 = Math.floor(py / GRID.rowH);
  let best = -1;
  let bestD = Infinity;
  for (let r = r0; r <= r0 + 1; r++) {
    const shift = r & 1 ? P / 2 : 0;
    const c = Math.round((px - shift) / P);
    const dx = px - shift - c * P;
    const dy = py - r * GRID.rowH;
    const d = dx * dx + dy * dy;
    if (d < bestD && r >= 0 && r < GRID.rows && c >= 0 && c < GRID.cols) {
      bestD = d;
      best = (frame * GRID.rows + r) * GRID.cols + c;
    }
  }
  return best;
}

export const cellFace = (cell: number) => (cell >= SITES ? 1 : 0);
export const cellSite = (cell: number) => cell % SITES;
export const siteFrame = (site: number) => (site >= GRID.rows * GRID.cols ? 1 : 0);

/** 巢房口中心的世界坐标（蜂箱在原点，巢脾中心面 z = 0） */
export function cellPos(cell: number, out: Point3 = { x: 0, y: 0, z: 0 }): Point3 {
  const s = cellSite(cell);
  out.x = siteU(s) - H.combW / 2;
  out.y = H.baseY + siteV(s);
  out.z = cellFace(cell) ? -H.combHalf : H.combHalf;
  return out;
}

function encode(a: ArrayBufferView): string {
  const q = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < q.length; i += 0x8000) s += String.fromCharCode(...q.subarray(i, i + 0x8000));
  return btoa(s);
}

function decode(b64: string, out: Float32Array | Uint8Array): void {
  const s = atob(b64);
  const q = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  if (s.length !== q.length) throw new Error(`巢脾存档长度不对：${s.length} ≠ ${q.length}`);
  for (let i = 0; i < q.length; i++) q[i] = s.charCodeAt(i);
}

export interface CombSave {
  build: string;
  drone: string;
  content: string;
  amount: string;
  age: string;
  pollen: string;
}

export interface CombCensus {
  built: number;
  building: number;
  counts: Record<(typeof CONTENT_KEYS)[number], number>;
  /** 储蜜：花蜜、蜂蜜、封盖蜜按装满的程度折成满房数 */
  honeyCells: number;
  pollenCells: number;
}

/** 两框巢脾两面的全部巢房。按数组存，画面直接按编号读，改动后 version 加一 */
export class Comb {
  /** 每个位置造到了多高，0 是没有巢房，1 是造好了；两面一起造 */
  readonly build = new Float32Array(SITES);
  /** 雄蜂房（真的比工蜂房大，这里网格一样大，只是封盖凸起） */
  readonly drone = new Uint8Array(SITES);
  readonly content = new Uint8Array(CELLS);
  /** 花蜜、蜂蜜、花粉装了多满（0..1） */
  readonly amount = new Float32Array(CELLS);
  /** 卵、幼虫、封盖子从产卵起过了多少秒 */
  readonly age = new Float32Array(CELLS);
  readonly pollen = new Uint8Array(CELLS);
  version = 0;

  built(cell: number): boolean {
    return this.build[cellSite(cell)] > 0;
  }

  /** 开局的巢脾：造了一部分，育儿区在中间，外面一圈花粉，上面是蜜（P-007） */
  generate(rng: Rng, seed: number): void {
    const O = CONFIG.opening;
    const B = O.brood;
    const noise = new Noise2D(seed + 2);
    for (let s = 0; s < SITES; s++) {
      const f = siteFrame(s);
      const u = siteU(s);
      const v = siteV(s);
      const top = f * GRID.frameStep + H.frameH;
      const e = O.built[f];
      // 离椭圆边多远（cm，里面为正）：按半轴归一化的半径近似换算
      const k = Math.hypot((u - H.combW / 2) / e.ax, (top - v) / e.ay);
      const inside = (1 - k) * Math.min(e.ax, e.ay) + O.edge * noise.fbm(u * 0.15, v * 0.15 + f * 40, 2);
      if (inside <= 0) continue;
      this.build[s] = inside >= O.rim ? 1 : clamp(0.25 + (0.7 * inside) / O.rim + rng.range(-0.1, 0.1), 0.15, 0.95);
      if (f === 0 && inside < O.drones + O.rim && v < H.frameH * 0.6) this.drone[s] = 1;
    }
    for (let cell = 0; cell < CELLS; cell++) {
      const s = cellSite(cell);
      if (this.build[s] < 1) continue;
      const u = siteU(s);
      const v = siteV(s);
      const n = noise.fbm(u * 0.4 + cellFace(cell) * 17, v * 0.4, 2);
      const rb = Math.hypot((u - B.u) / B.ru, (v - B.v) / B.rv) + 0.12 * n;
      const fromTop = COMB_H - v;
      // 雄蜂房在下框巢脾的下缘，离育儿区稍远也有子
      if (rb < 1 || (this.drone[s] && rb < 1.5)) {
        if (!rng.chance(B.fill)) continue;
        // 蜂王从中间往外一圈圈产卵：越往外越年轻
        const stage = rb + 0.15 * rng.range(-1, 1);
        const D = this.drone[s] ? CONFIG.brood.drone : CONFIG.brood.worker;
        if (stage < 0.6) this.lay(cell, CELL.capped, D.egg + D.larva + rng.range(0, D.capped));
        else if (stage < 0.85) this.lay(cell, CELL.larva, D.egg + rng.range(0, D.larva));
        else this.lay(cell, CELL.egg, rng.range(0, D.egg));
      } else if (rb < 1 + O.pollen / Math.min(B.ru, B.rv)) {
        if (rng.chance(0.75)) this.store(cell, CELL.pollen, rng.range(0.3, 1), Math.floor(clamp((n + 1) / 2, 0, 0.999) * POLLEN_KINDS));
      } else if (fromTop < O.capped) {
        this.store(cell, CELL.cappedHoney, 1);
      } else if (fromTop < O.honey) {
        if (rng.chance(0.85)) this.store(cell, rng.chance(0.6) ? CELL.honey : CELL.nectar, rng.range(0.4, 1));
      } else if (rng.chance(0.18)) this.store(cell, CELL.nectar, rng.range(0.1, 0.6));
    }
    this.version++;
  }

  private lay(cell: number, c: CellContent, age: number): void {
    this.content[cell] = c;
    this.age[cell] = age;
  }

  private store(cell: number, c: CellContent, amount: number, pollen = 0): void {
    this.content[cell] = c;
    this.amount[cell] = amount;
    this.pollen[cell] = pollen;
  }

  /**
   * 卵、幼虫、封盖子长大 dt 秒，到了时间换下一阶段；羽化后巢房空出来，返回羽化了几只。
   * 还没有蜂：幼虫不用喂、羽化的蜂不出现，蜂加进来后由它们接手
   */
  develop(dt: number): number {
    let emerged = 0;
    let changed = false;
    const W = CONFIG.brood.worker;
    const D = CONFIG.brood.drone;
    for (let cell = 0; cell < CELLS; cell++) {
      const c = this.content[cell];
      if (c < CELL.egg || c > CELL.capped) continue;
      const a = (this.age[cell] += dt);
      const T = this.drone[cellSite(cell)] ? D : W;
      const next = a < T.egg ? CELL.egg : a < T.egg + T.larva ? CELL.larva : a < T.egg + T.larva + T.capped ? CELL.capped : CELL.empty;
      if (next === c) continue;
      this.content[cell] = next;
      changed = true;
      if (next === CELL.empty) {
        this.age[cell] = 0;
        emerged++;
      }
    }
    if (changed) this.version++;
    return emerged;
  }

  census(): CombCensus {
    const counts = Object.fromEntries(CONTENT_KEYS.map((k) => [k, 0])) as CombCensus['counts'];
    let built = 0;
    let building = 0;
    let honeyCells = 0;
    let pollenCells = 0;
    for (let s = 0; s < SITES; s++) {
      if (this.build[s] <= 0) continue;
      if (this.build[s] < 1) {
        building++;
        continue;
      }
      built++;
      for (const cell of [s, s + SITES]) {
        const c = this.content[cell];
        counts[CONTENT_KEYS[c]]++;
        if (c === CELL.nectar || c === CELL.honey || c === CELL.cappedHoney) honeyCells += this.amount[cell];
        else if (c === CELL.pollen) pollenCells += this.amount[cell];
      }
    }
    return { built, building, counts, honeyCells, pollenCells };
  }

  toSave(): CombSave {
    return {
      build: encode(this.build),
      drone: encode(this.drone),
      content: encode(this.content),
      amount: encode(this.amount),
      age: encode(this.age),
      pollen: encode(this.pollen),
    };
  }

  restore(d: CombSave): void {
    decode(d.build, this.build);
    decode(d.drone, this.drone);
    decode(d.content, this.content);
    decode(d.amount, this.amount);
    decode(d.age, this.age);
    decode(d.pollen, this.pollen);
    this.version++;
  }
}

import type { Point3 } from '../../../core/sim/events';
import { clamp } from '../../../core/util/math';
import { Noise2D, type Rng } from '../../../core/util/random';
import { CONFIG } from '../config';

const H = CONFIG.hive;
const P = CONFIG.cell.pitch;

/** 巢脾整体的高度：两框加中间的木条 */
export const COMB_H = H.frameH * 2 + H.bar;

/** 巢房里装的东西；有没有巢房看 build。sac 是得中囊病死在房里的幼虫（T-024），要清理蜂拖出去 */
export const CELL = { empty: 0, egg: 1, larva: 2, capped: 3, nectar: 4, honey: 5, cappedHoney: 6, pollen: 7, sac: 8 } as const;
export type CellContent = (typeof CELL)[keyof typeof CELL];
export const CONTENT_KEYS = ['empty', 'egg', 'larva', 'capped', 'nectar', 'honey', 'cappedHoney', 'pollen', 'sac'] as const;
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

/** 同一框里相邻的位置（尖角朝上、奇数行右移半格），最多 6 个 */
export function siteNeighbors(site: number, out: number[] = []): number[] {
  out.length = 0;
  const per = GRID.rows * GRID.cols;
  const base = site - (site % per);
  const local = site % per;
  const row = Math.floor(local / GRID.cols);
  const col = local % GRID.cols;
  const add = (r: number, c: number) => {
    if (r >= 0 && r < GRID.rows && c >= 0 && c < GRID.cols) out.push(base + r * GRID.cols + c);
  };
  add(row, col - 1);
  add(row, col + 1);
  const c0 = row & 1 ? col : col - 1;
  for (const r of [row - 1, row + 1]) {
    add(r, c0);
    add(r, c0 + 1);
  }
  return out;
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
  repair: string;
  sick: string;
  bald: string;
  silk: string;
}

export interface CombCensus {
  built: number;
  building: number;
  /** 空房里还没清理的 */
  dirty: number;
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
  /**
   * 花蜜、蜂蜜、花粉装了多满（0..1）。幼虫是还饱着多少：刚喂过是 1，降到 0 开始挨饿，负数是饿了多久（按 feedEvery 折算）。
   * 空房大于 0 是还没清理（羽化或幼虫死后留下的茧衣和残渣），蜂王不在里面产卵
   */
  readonly amount = new Float32Array(CELLS);
  /** 卵、幼虫、封盖子从产卵起过了多少秒；花蜜是酿到了几成（0..1） */
  readonly age = new Float32Array(CELLS);
  readonly pollen = new Uint8Array(CELLS);
  /** 割掉、换掉以后要补的位置（T-023）：蜂先补这里，造好了清掉 */
  readonly repair = new Uint8Array(SITES);
  /** repair 里还有几个 */
  repairs = 0;
  /** 染上中囊病的幼虫（看不出来，到封盖的时候死成囊，T-024） */
  readonly sick = new Uint8Array(CELLS);
  /** 白头蛹：巢虫在下面打隧道，工蜂把房盖咬开了（T-024） */
  readonly bald = new Uint8Array(CELLS);
  /** 巢虫爬过留下的丝和虫粪还要多少秒才被清掉 */
  readonly silk = new Float32Array(CELLS);
  /** 内容变了加一 */
  version = 0;
  /** 有没有巢房变了（新开始造一个位置）加一，走路的方格按它重建 */
  shape = 0;
  private nb: number[] = [];

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
    if (c === CELL.larva) this.amount[cell] = 1;
  }

  /** 能产卵：造好了、空着、清理过 */
  layable(cell: number): boolean {
    return this.build[cellSite(cell)] >= 1 && this.content[cell] === CELL.empty && this.amount[cell] <= 0;
  }

  layEgg(cell: number): void {
    this.lay(cell, CELL.egg, 0);
    this.amount[cell] = 0;
    this.version++;
  }

  feed(cell: number): void {
    this.amount[cell] = 1;
  }

  /** 清理：空房里的残渣、死在房里的囊状幼虫都拖出去 */
  clean(cell: number): void {
    if (this.content[cell] === CELL.sac) this.content[cell] = CELL.empty;
    this.amount[cell] = 0;
    this.version++;
  }

  /** 巢虫爬过这个巢房（T-024）：留下丝，空房变脏；bald 为真时封盖子被工蜂咬开盖子成白头蛹（新成了白头蛹返回真） */
  bore(cell: number, silk: number, bald: boolean): boolean {
    this.silk[cell] = silk;
    this.version++;
    const c = this.content[cell];
    if (c === CELL.empty) this.amount[cell] = Math.max(this.amount[cell], 1);
    else if (c === CELL.capped && bald && !this.bald[cell]) return (this.bald[cell] = 1) === 1;
    return false;
  }

  /** 从蜜房里取走最多 want（房），返回取到的；封盖蜜先咬开 */
  takeHoney(cell: number, want: number): number {
    const c = this.content[cell];
    if (c !== CELL.nectar && c !== CELL.honey && c !== CELL.cappedHoney) return 0;
    if (c === CELL.cappedHoney) this.content[cell] = CELL.honey;
    const got = Math.min(want, this.amount[cell]);
    this.amount[cell] -= got;
    if (this.amount[cell] <= 1e-4) this.empty(cell);
    this.version++;
    return got;
  }

  takePollen(cell: number, want: number): number {
    if (this.content[cell] !== CELL.pollen) return 0;
    const got = Math.min(want, this.amount[cell]);
    this.amount[cell] -= got;
    if (this.amount[cell] <= 1e-4) this.empty(cell);
    this.version++;
    return got;
  }

  /**
   * 往空房、花蜜房或没封盖的蜜房里放 x 房花蜜，返回放进去多少。新的花蜜冲淡了原来的：
   * 酿的进度按量摊开，原来的蜂蜜算酿好的
   */
  addNectar(cell: number, x: number): number {
    if (this.build[cellSite(cell)] < 1) return 0;
    const c = this.content[cell];
    if (c === CELL.empty) {
      if (this.amount[cell] > 0) return 0;
      this.store(cell, CELL.nectar, 0);
      this.age[cell] = 0;
    } else if (c !== CELL.nectar && c !== CELL.honey) return 0;
    const a = this.amount[cell];
    const got = Math.min(x, 1 - a);
    if (got <= 0) return 0;
    const ripe = c === CELL.honey ? 1 : this.age[cell];
    this.content[cell] = CELL.nectar;
    this.age[cell] = (ripe * a) / (a + got);
    this.amount[cell] = a + got;
    this.version++;
    return got;
  }

  /** 往空房或花粉房里放 x 房花粉（kind 是颜色，空房才用得上），返回放进去多少 */
  addPollen(cell: number, x: number, kind: number): number {
    if (this.build[cellSite(cell)] < 1) return 0;
    const c = this.content[cell];
    if (c === CELL.empty) {
      if (this.amount[cell] > 0) return 0;
      this.store(cell, CELL.pollen, 0, kind);
    } else if (c !== CELL.pollen) return 0;
    const got = Math.min(x, 1 - this.amount[cell]);
    if (got <= 0) return 0;
    this.amount[cell] += got;
    this.version++;
    return got;
  }

  /** 酿 d 成，酿够了花蜜就成了蜂蜜 */
  ripen(cell: number, d: number): void {
    if (this.content[cell] !== CELL.nectar) return;
    this.age[cell] += d;
    if (this.age[cell] >= 1) {
      this.content[cell] = CELL.honey;
      this.age[cell] = 0;
    }
    this.version++;
  }

  cap(cell: number): void {
    if (this.content[cell] !== CELL.honey) return;
    this.content[cell] = CELL.cappedHoney;
    this.version++;
  }

  /**
   * 割掉、换掉这些位置的巢房（两面一起），返回拿走的蜜（满房数）、子；缺口边上挨着造好的巢房的位置从 start 起重新造
   */
  remove(sites: readonly number[], start: number): { honey: number; brood: number } {
    let honey = 0;
    let brood = 0;
    for (const s of sites) {
      for (const cell of [s, s + SITES]) {
        const c = this.content[cell];
        if (c === CELL.nectar || c === CELL.honey || c === CELL.cappedHoney) honey += this.amount[cell];
        else if (c >= CELL.egg && c <= CELL.capped) brood++;
        this.empty(cell);
      }
      this.build[s] = 0;
      this.drone[s] = 0;
      if (!this.repair[s]) this.repairs++;
      this.repair[s] = 1;
    }
    for (const s of sites) if (siteNeighbors(s, this.nb).some((n) => this.build[n] >= 1)) this.build[s] = start;
    this.shape++;
    this.version++;
    return { honey, brood };
  }

  /** 空巢框：框梁下面中间三分之一的位置从 start 起造（框梁在每框的上沿） */
  seedTop(frame: number, start: number): void {
    const base = (frame * GRID.rows + GRID.rows - 1) * GRID.cols;
    for (let c = Math.floor(GRID.cols / 3); c < Math.ceil((GRID.cols * 2) / 3); c++) this.build[base + c] = start;
    this.shape++;
    this.version++;
  }

  /** 位置加高 d，造好时旁边还没有的位置开始造 */
  buildUp(site: number, d: number, start: number): void {
    const b = this.build[site];
    if (b <= 0 || b >= 1) return;
    this.build[site] = Math.min(1, b + d * (this.repair[site] ? CONFIG.keeper.repairBoost : 1));
    if (this.build[site] >= 1) {
      if (this.repair[site]) this.repairs--;
      this.repair[site] = 0;
      let grew = false;
      for (const n of siteNeighbors(site, this.nb))
        if (this.build[n] <= 0) {
          this.build[n] = start;
          grew = true;
        }
      if (grew) this.shape++;
    }
    this.version++;
  }

  /** 蜂群走了（T-025）：卵、幼虫、封盖子没有蜂照顾都死在房里，留下要清理的房；返回死了几个 */
  abandon(): number {
    let n = 0;
    for (let cell = 0; cell < CELLS; cell++) {
      const c = this.content[cell];
      if (c < CELL.egg || c > CELL.capped) continue;
      this.empty(cell);
      this.amount[cell] = 1;
      n++;
    }
    this.version++;
    return n;
  }

  /** 搬进来的蜂群把带来的蜜吐进最靠上的空房（T-025），返回吐进去多少房 */
  unload(x: number): number {
    const free: number[] = [];
    for (let cell = 0; cell < CELLS; cell++) if (this.content[cell] === CELL.empty && this.amount[cell] === 0 && this.build[cellSite(cell)] >= 1) free.push(cell);
    free.sort((a, b) => siteV(cellSite(b)) - siteV(cellSite(a)) || a - b);
    let left = x;
    for (const cell of free) {
      if (left <= 1e-6) break;
      left -= this.addNectar(cell, Math.min(1, left));
    }
    return x - left;
  }

  private empty(cell: number): void {
    this.content[cell] = CELL.empty;
    this.amount[cell] = 0;
    this.age[cell] = 0;
    this.pollen[cell] = 0;
    this.sick[cell] = 0;
    this.bald[cell] = 0;
  }

  private store(cell: number, c: CellContent, amount: number, pollen = 0): void {
    this.content[cell] = c;
    this.amount[cell] = amount;
    this.pollen[cell] = pollen;
  }

  /**
   * 卵、幼虫、封盖子长大 dt 秒，到了时间换下一阶段。幼虫越来越饿，饿过 starve 秒就死了；
   * 羽化和饿死的巢房空出来、要清理，各自回调一次
   */
  /**
   * rate：这个巢房里的子发育快慢的倍数；dies：这一回冻死、热死没有（T-021），死了和饿死的一样留下要清理的房。
   * 染了中囊病的幼虫到封盖的时候死成囊（onSac）；白头蛹羽化时 onEmerge 先看 bald 再清掉。巢虫的丝过 dt 秒淡一点
   */
  develop(
    dt: number,
    onEmerge: (cell: number) => void,
    onStarve: (cell: number) => void,
    rate: (cell: number) => number = () => 1,
    dies: (cell: number) => boolean = () => false,
    onSac: (cell: number) => void = () => {},
  ): void {
    let changed = false;
    const W = CONFIG.brood.worker;
    const D = CONFIG.brood.drone;
    const C = CONFIG.care;
    const hunger = dt / C.feedEvery;
    const dead = -C.starve / C.feedEvery;
    for (let cell = 0; cell < CELLS; cell++) {
      if (this.silk[cell] > 0 && (this.silk[cell] -= dt) <= 0) {
        this.silk[cell] = 0;
        changed = true;
      }
      const c = this.content[cell];
      if (c < CELL.egg || c > CELL.capped) continue;
      const starved = c === CELL.larva && (this.amount[cell] -= hunger) < dead;
      if (starved || dies(cell)) {
        this.empty(cell);
        this.amount[cell] = 1;
        changed = true;
        if (starved) onStarve(cell);
        continue;
      }
      const a = (this.age[cell] += dt * rate(cell));
      const T = this.drone[cellSite(cell)] ? D : W;
      const next = a < T.egg ? CELL.egg : a < T.egg + T.larva ? CELL.larva : a < T.egg + T.larva + T.capped ? CELL.capped : CELL.empty;
      if (next === c) continue;
      changed = true;
      if (next === CELL.capped && this.sick[cell]) {
        this.empty(cell);
        this.content[cell] = CELL.sac;
        onSac(cell);
        continue;
      }
      this.content[cell] = next;
      if (next === CELL.larva) this.amount[cell] = 1;
      else if (next === CELL.capped) this.amount[cell] = 0;
      else if (next === CELL.empty) {
        this.age[cell] = 0;
        this.amount[cell] = 1;
        onEmerge(cell);
        this.bald[cell] = 0;
      }
    }
    if (changed) this.version++;
  }

  census(): CombCensus {
    const counts = Object.fromEntries(CONTENT_KEYS.map((k) => [k, 0])) as CombCensus['counts'];
    let built = 0;
    let building = 0;
    let dirty = 0;
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
        if (c === CELL.empty && this.amount[cell] > 0) dirty++;
        if (c === CELL.nectar || c === CELL.honey || c === CELL.cappedHoney) honeyCells += this.amount[cell];
        else if (c === CELL.pollen) pollenCells += this.amount[cell];
      }
    }
    return { built, building, dirty, counts, honeyCells, pollenCells };
  }

  toSave(): CombSave {
    return {
      build: encode(this.build),
      drone: encode(this.drone),
      content: encode(this.content),
      amount: encode(this.amount),
      age: encode(this.age),
      pollen: encode(this.pollen),
      repair: encode(this.repair),
      sick: encode(this.sick),
      bald: encode(this.bald),
      silk: encode(this.silk),
    };
  }

  restore(d: CombSave): void {
    decode(d.build, this.build);
    decode(d.drone, this.drone);
    decode(d.content, this.content);
    decode(d.amount, this.amount);
    decode(d.age, this.age);
    decode(d.pollen, this.pollen);
    decode(d.repair, this.repair);
    decode(d.sick, this.sick);
    decode(d.bald, this.bald);
    decode(d.silk, this.silk);
    this.repairs = this.repair.reduce((a, x) => a + x, 0);
    this.version++;
    this.shape++;
  }
}

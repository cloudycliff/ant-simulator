import { clamp } from '../../../core/util/math';
import { CONFIG } from '../config';
import { CELL, COMB_H, SITES, siteU, siteV, type Comb } from './comb';

const H = CONFIG.hive;
const T = CONFIG.heat;

/** 温度格：巢面上 T.cell cm 见方一格，两面共用（巢脾薄，热从中肋传过去） */
export const HEAT = (() => {
  const cols = Math.ceil(H.combW / T.cell);
  const rows = Math.ceil(COMB_H / T.cell);
  return { cols, rows, n: cols * rows };
})();

export const heatAt = (u: number, v: number) => {
  const c = Math.min(HEAT.cols - 1, Math.max(0, Math.floor(u / T.cell)));
  const r = Math.min(HEAT.rows - 1, Math.max(0, Math.floor(v / T.cell)));
  return r * HEAT.cols + c;
};
/** 每个巢房位置在哪一格 */
export const SITE_HEAT = (() => {
  const a = new Int16Array(SITES);
  for (let s = 0; s < SITES; s++) a[s] = heatAt(siteU(s), siteV(s));
  return a;
})();

/** 子的温度：发育快慢的倍数（1 是正好），冻死、热死的危险（每秒死的机会） */
export function broodRate(t: number): number {
  if (t < T.ideal[0]) return Math.max(T.slowest, 1 - (T.ideal[0] - t) * T.slowPerC);
  if (t > T.ideal[1]) return Math.max(T.slowest, 1 - (t - T.ideal[1]) * T.slowPerC);
  return 1;
}
export function broodRisk(t: number): number {
  return t < T.chill ? (T.chill - t + 1) / T.killTime : t > T.cook ? (t - T.cook + 1) / T.killTime : 0;
}

export interface HeatSave {
  temp: number[];
  acc: number;
  stats: number[];
}

export interface HeatBee {
  out: number;
  u: number;
  v: number;
  act: string;
}

/**
 * 巢脾上的温度（T-021）：每只蜂都散一点热，抱团振翅的蜂（act 'heat'，冬天团里的 'cluster'）散得多；热从格子往四邻传，
 * 往外面的空气散，扇风的蜂越多散得越快。子在哪一格就按哪一格的温度发育
 */
export class Heat {
  readonly temp = new Float32Array(HEAT.n);
  /** 每格的子、蜂、产热的蜂（每步重数） */
  readonly brood = new Uint16Array(HEAT.n);
  private bees = new Uint16Array(HEAT.n);
  private heaters = new Uint16Array(HEAT.n);
  private next = new Float32Array(HEAT.n);
  private ready = false;
  /** 育儿区的平均、最低、最高温度（有子的格），扇风、产热的蜂有多少 */
  broodMean = 34;
  broodMin = 34;
  broodMax = 34;
  fanning = 0;
  heating = 0;
  /** 冻死、热死的子 */
  chilled = 0;
  private acc = 0;

  /** 每秒算一次 */
  update(dt: number, air: number, bees: readonly HeatBee[], comb: Comb): void {
    this.acc += dt;
    if (this.ready && this.acc < 1) return;
    const step = this.ready ? this.acc : 1;
    this.acc = 0;
    const n = HEAT.n;
    this.bees.fill(0);
    this.heaters.fill(0);
    this.brood.fill(0);
    let fan = 0;
    let heat = 0;
    for (const b of bees) {
      if (b.out) continue;
      const i = heatAt(b.u, b.v);
      this.bees[i]++;
      if (b.act === 'heat' || b.act === 'cluster') {
        this.heaters[i]++;
        heat++;
      } else if (b.act === 'fan') fan++;
    }
    this.fanning = fan;
    this.heating = heat;
    for (let c = 0; c < 2 * SITES; c++) {
      const k = comb.content[c];
      if (k >= CELL.egg && k <= CELL.capped) this.brood[SITE_HEAT[c % SITES]]++;
    }
    const loss = T.loss * (1 + T.vent * fan);
    // 扇进来的风让水分蒸发，最多比气温凉 evap 度
    const inner = air - T.evap * Math.min(1, fan / T.fanFull);
    // 蜂热了就少产热，产热的蜂把子焐到 ideal 上沿就停
    const src = (i: number, t: number) => T.bee * this.bees[i] * clamp((T.cook - t) / (T.cook - T.ideal[0]), 0, 1) + T.heater * this.heaters[i] * clamp((T.ideal[1] - t) / 1.5, 0, 1);
    if (!this.ready) {
      // 开局按平衡时的温度起步，不然要等几分钟才热起来
      this.temp.fill(T.ideal[0]);
      for (let k = 0; k < 200; k++) this.step(1, inner, T.loss, src);
      this.ready = true;
    }
    this.step(step, inner, loss, src);
    let sum = 0;
    let w = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (this.brood[i] < T.broodCells) continue;
      const t = this.temp[i];
      sum += t * this.brood[i];
      w += this.brood[i];
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (w > 0) {
      this.broodMean = sum / w;
      this.broodMin = lo;
      this.broodMax = hi;
    }
  }

  private step(dt: number, air: number, loss: number, src: (i: number, t: number) => number): void {
    const { cols, rows, n } = HEAT;
    const t = this.temp;
    const out = this.next;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let s = 0;
        let k = 0;
        if (c > 0) (s += t[i - 1]), k++;
        if (c < cols - 1) (s += t[i + 1]), k++;
        if (r > 0) (s += t[i - cols]), k++;
        if (r < rows - 1) (s += t[i + cols]), k++;
        out[i] = t[i] + dt * (src(i, t[i]) - loss * (t[i] - air) + T.spread * (s / k - t[i]));
      }
    t.set(out.subarray(0, n));
  }

  toSave(): HeatSave {
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return { temp: Array.from(this.temp, r), acc: r(this.acc), stats: [this.broodMean, this.broodMin, this.broodMax, this.fanning, this.heating, this.chilled].map(r) };
  }

  /** 每格的子、蜂数读档后要等下一次 update 才重数，只给画面和下一次用 */
  restore(d: HeatSave): void {
    this.temp.set(d.temp);
    this.acc = d.acc;
    [this.broodMean, this.broodMin, this.broodMax, this.fanning, this.heating, this.chilled] = d.stats;
    this.ready = true;
  }
}

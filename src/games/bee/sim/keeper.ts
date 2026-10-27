import { CONFIG } from '../config';
import { CELL, GRID, SITES, siteFrame, siteNeighbors, siteU, siteV, type Comb } from './comb';
import type { Bees } from './bees';

const K = CONFIG.keeper;

export interface KeeperSave {
  alarm: number;
  stress: number;
  stats: number[];
}

/** 能割：造好了，两面都没有子和花粉，至少一面是封盖蜜 */
function cuttable(comb: Comb, s: number): boolean {
  if (comb.build[s] < 1) return false;
  let capped = false;
  for (const cell of [s, s + SITES]) {
    const c = comb.content[cell];
    if ((c >= CELL.egg && c <= CELL.capped) || c === CELL.pollen) return false;
    if (c === CELL.cappedHoney) capped = true;
  }
  return capped;
}

/**
 * 养蜂人开箱（P-013、T-023）：割蜜、换框。开一次箱蜂躁动一阵（alarm，几分钟退掉），
 * 惊扰的压力（stress）退得慢，连着几天开箱会累积，飞逃（P-010）按它算
 */
export class Keeper {
  alarm = 0;
  stress = 0;
  /** 割过几次、割下多少房蜜，换过几次框、换框拿走多少子 */
  harvests = 0;
  harvested = 0;
  swaps = 0;
  lostBrood = 0;

  constructor(
    private readonly comb: Comb,
    private readonly bees: Bees,
    private readonly dayLength: number,
    /** 割掉、换掉了这些位置（巢虫跟着拿走） */
    private readonly onRemove: (sites: readonly number[]) => void = () => {},
  ) {}

  /** 点这个巢房割蜜会割下的位置：从它往外 cutR 以内、连成一片能割的；点的不能割是空的 */
  cutArea(cell: number): number[] {
    const s0 = cell % SITES;
    if (!cuttable(this.comb, s0)) return [];
    const u0 = siteU(s0);
    const v0 = siteV(s0);
    const seen = new Set([s0]);
    const out = [s0];
    const nb: number[] = [];
    for (let i = 0; i < out.length; i++)
      for (const n of siteNeighbors(out[i], nb)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (Math.hypot(siteU(n) - u0, siteV(n) - v0) <= K.cutR && cuttable(this.comb, n)) out.push(n);
      }
    return out;
  }

  /** 割下一块封盖蜜，返回割下的蜜（满房数）；没有能割的返回 null */
  harvest(cell: number): number | null {
    const area = this.cutArea(cell);
    if (!area.length) return null;
    const { honey } = this.comb.remove(area, CONFIG.care.start);
    this.onRemove(area);
    this.bees.dislodge(-1, siteU(cell % SITES), siteV(cell % SITES));
    this.harvests++;
    this.harvested += honey;
    this.open(K.alarm.harvest, K.stress.harvest);
    return honey;
  }

  /** 这一框（0 下框、1 上框）上的子、蜜（满房数） */
  frameContents(frame: number): { brood: number; honey: number } {
    let brood = 0;
    let honey = 0;
    const cb = this.comb;
    for (let s = 0; s < SITES; s++) {
      if (siteFrame(s) !== frame || cb.build[s] <= 0) continue;
      for (const cell of [s, s + SITES]) {
        const c = cb.content[cell];
        if (c >= CELL.egg && c <= CELL.capped) brood++;
        else if (c === CELL.nectar || c === CELL.honey || c === CELL.cappedHoney) honey += cb.amount[cell];
      }
    }
    return { brood, honey };
  }

  /** 把一框换成空巢框，返回拿走的子、蜜 */
  swap(frame: number): { brood: number; honey: number } {
    const per = GRID.rows * GRID.cols;
    const sites = Array.from({ length: per }, (_, i) => frame * per + i);
    const got = this.comb.remove(sites, CONFIG.care.start);
    this.onRemove(sites);
    this.comb.seedTop(frame, CONFIG.care.start);
    this.bees.dislodge(frame);
    this.swaps++;
    this.lostBrood += got.brood;
    this.open(K.alarm.swap, K.stress.swap);
    return got;
  }

  private open(alarm: number, stress: number): void {
    this.alarm = Math.min(1, this.alarm + alarm);
    this.stress += stress;
  }

  update(dt: number): void {
    this.alarm *= Math.exp(-dt / K.alarmTime);
    this.stress *= Math.exp(-dt / (K.stressDays * this.dayLength));
  }

  toSave(): KeeperSave {
    const r = (x: number) => Math.round(x * 1e4) / 1e4;
    return { alarm: r(this.alarm), stress: r(this.stress), stats: [this.harvests, r(this.harvested), this.swaps, this.lostBrood] };
  }

  restore(d: KeeperSave): void {
    this.alarm = d.alarm;
    this.stress = d.stress;
    [this.harvests, this.harvested, this.swaps, this.lostBrood] = d.stats;
  }
}

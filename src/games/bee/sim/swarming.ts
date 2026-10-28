import { L, type Text } from '../../../core/i18n';
import type { Season } from '../../../core/sim/clock';
import { TAU } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import type { SwarmState } from './abscond';
import { CASTE, type Bee, type Bees } from './bees';
import { CELL, GRID, SITES, siteFrame, siteNeighbors, siteU, siteV, type Comb } from './comb';

const S = CONFIG.swarming;
const DEV = S.dev;

/** 王台到了哪一步：台基（还空着）、卵、幼虫、封盖、被咬开 */
export const QUEEN_CELL = { cup: 0, egg: 1, larva: 2, capped: 3, torn: 4 } as const;
export const QUEEN_CELL_KEYS = ['cup', 'egg', 'larva', 'capped', 'torn'] as const;

/** 一个王台：挂在巢脾一面上的 site 那里，往下长。age 在台基时是还要等几秒产卵，其余是这一步之前过了多少秒（卵从产下算） */
export interface QueenCell {
  id: number;
  site: number;
  face: number;
  stage: number;
  age: number;
}

/**
 * 蜂群的蜂王换到了哪一步：none 平时；cells 造了王台、老蜂王还在；queenless 老蜂王走了、等王台出房；
 * virgin 新蜂王出房了还没婚飞；flight 该出去婚飞了；mated 交尾回来、还没开始产卵
 */
export type QueenStage = 'none' | 'cells' | 'queenless' | 'virgin' | 'flight' | 'mated';

export interface SwarmingSave {
  stage: QueenStage;
  cells: QueenCell[];
  swarm: SwarmState;
  timer: number;
  hourAcc: number;
  dir: number;
  virgin: number;
  flown: boolean;
  year: number;
  stats: number[];
}

/** 分蜂要看的：蜂、巢脾、编号、季节和时刻、天气；箱里有没有蜂群（飞逃了就不管） */
export interface SwarmingHost {
  bees: Bees;
  comb: Comb;
  nextId: () => number;
  clock: { hour: number; year: number; season: Season };
  flyable: () => boolean;
  present: () => boolean;
  log(msg: Text, ref?: { kind: 'queenCell' | 'bee'; id: number }): void;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const within = (h: number, [a, b]: readonly [number, number]) => h >= a && h < b;
const queenDone = DEV.egg + DEV.larva + DEV.capped;

/** 王台里的蜂王还要多久出房（秒）；台基、咬开的是 Infinity */
export function untilEmerge(c: QueenCell): number {
  return c.stage === QUEEN_CELL.cup || c.stage === QUEEN_CELL.torn ? Infinity : Math.max(0, queenDone - c.age);
}

/**
 * 分蜂、造王台、换王（P-016、T-027）。春天强群在巢脾下缘造王台，第一个封盖以后老蜂王带走一大半在巢里的蜂分出去；
 * 留下的蜂等王台出房，第一只出房的新蜂王咬开别的王台，过一阵出巢婚飞，回来以后开始产卵。玩家只看
 */
export class Swarming {
  stage: QueenStage = 'none';
  readonly cells: QueenCell[] = [];
  /** 分出去的蜂群：home 是没有，leaving 正出巢门、cloud 在箱外盘旋、away 飞走 */
  readonly swarm: SwarmState = { phase: 'home', x: 0, y: 0, z: 0, r: 0 };
  /** 新蜂王的编号（还没开始产卵时），-1 没有 */
  virgin = -1;
  /** 分蜂几次、分出去多少蜂、换了几次王、急造了几次王台 */
  swarms = 0;
  left = 0;
  queens = 0;
  emergencies = 0;
  /** 这一步过了多久（分出去的蜂群、处女王、交尾以后） */
  private timer = 0;
  private hourAcc = 0;
  private dir = 0;
  /** 这一趟婚飞已经出了巢 */
  private flown = false;
  /** 哪一年分过蜂（一年只分一次） */
  private year = 0;
  private nb: number[] = [];

  constructor(
    private readonly rng: Rng,
    private readonly dayLength: number,
    private readonly host: SwarmingHost,
  ) {}

  get(id: number): QueenCell | undefined {
    return this.cells.find((c) => c.id === id);
  }

  /** 这只蜂王该做什么：产卵、在巢里等着（处女王、刚交尾），还是出去婚飞 */
  duty(b: Bee): 'lay' | 'wait' | 'fly' {
    if (b.id !== this.virgin) return 'lay';
    if (this.stage === 'flight' && !this.flown && within(this.host.clock.hour, S.flightHours) && this.host.flyable()) return 'fly';
    return 'wait';
  }

  /** 婚飞时在 flightAt 一带飞的一点 */
  flightPoint(out: { x: number; y: number; z: number }): void {
    const a = this.rng.range(0, TAU);
    const r = S.flightR * Math.sqrt(this.rng.next());
    out.x = S.flightAt.x + Math.cos(a) * r;
    out.y = S.flightAt.y + this.rng.range(-0.3, 0.3) * S.flightR;
    out.z = S.flightAt.z + Math.sin(a) * r;
  }

  update(dt: number): void {
    const host = this.host;
    if (!host.present() && this.swarm.phase === 'home') {
      if (this.stage !== 'none' || this.cells.length) this.reset();
      return;
    }
    this.stepSwarm(dt);
    this.stepCells(dt);
    const queen = this.virgin >= 0 ? host.bees.get(this.virgin) : undefined;
    switch (this.stage) {
      case 'none':
        this.hourAcc += dt;
        if (this.hourAcc >= this.dayLength / 24) {
          this.hourAcc = 0;
          if (this.ready() && this.rng.chance(S.perHour)) this.begin();
        }
        if (!this.mother()) this.orphaned();
        return;
      case 'cells':
        if (!this.mother()) {
          // 老蜂王死了（或被换框带走）：王台照样长，长成了就出房
          this.stage = 'queenless';
          return;
        }
        if (this.cells.some((c) => c.stage === QUEEN_CELL.capped) && within(host.clock.hour, S.hours) && host.flyable()) this.issue();
        return;
      case 'queenless':
        if (!this.cells.some((c) => c.stage < QUEEN_CELL.torn)) this.orphaned();
        return;
      case 'virgin':
        if (!queen) return this.lost();
        this.timer += dt;
        if (this.timer >= S.mateAfter) {
          this.stage = 'flight';
          this.flown = false;
        }
        return;
      case 'flight':
        if (!queen) return this.lost();
        if (queen.out >= 2 && !this.flown) {
          this.flown = true;
          host.log(L('ev.matingFlight'), { kind: 'bee', id: queen.id });
        }
        if (this.flown && queen.out === 0) {
          this.stage = 'mated';
          this.timer = 0;
          host.log(L('ev.mated'), { kind: 'bee', id: queen.id });
        }
        return;
      case 'mated':
        if (!queen) return this.lost();
        this.timer += dt;
        if (this.timer >= S.layAfter) {
          this.stage = 'none';
          this.virgin = -1;
          this.queens++;
          host.log(L('ev.newQueenLays'), { kind: 'bee', id: queen.id });
        }
    }
  }

  /** 够不够强、是不是分蜂的季节 */
  private ready(): boolean {
    const host = this.host;
    if (this.year === host.clock.year || !S.seasons.includes(host.clock.season)) return false;
    let workers = 0;
    for (const b of host.bees.list) if (b.caste === CASTE.worker && !b.swarm) workers++;
    if (workers < S.minWorkers) return false;
    const n = host.comb.census().counts;
    return n.egg + n.larva + n.capped >= S.minBrood;
  }

  /** 箱里在产卵的蜂王（不算跟着分出去的） */
  private mother(): Bee | undefined {
    return this.host.bees.list.find((b) => b.caste === CASTE.queen && !b.swarm && b.id !== this.virgin);
  }

  /** 造王台（测试、截图也用）：在巢脾下缘挑几个隔开的地方 */
  begin(): number {
    const host = this.host;
    const spots = this.edgeSites();
    const want = this.rng.int(S.cells[0], S.cells[1]);
    const picked: number[] = [];
    for (let i = 0; i < spots.length && picked.length < want; i++) {
      const k = i + this.rng.int(0, spots.length - 1 - i);
      [spots[i], spots[k]] = [spots[k], spots[i]];
      const s = spots[i];
      if (picked.some((p) => siteFrame(p) === siteFrame(s) && Math.hypot(siteU(p) - siteU(s), siteV(p) - siteV(s)) < S.gap)) continue;
      picked.push(s);
    }
    for (const site of picked) this.cells.push({ id: host.nextId(), site, face: this.rng.int(0, 1), stage: QUEEN_CELL.cup, age: this.rng.range(S.layIn[0], S.layIn[1]) });
    if (!picked.length) return 0;
    this.stage = 'cells';
    this.year = host.clock.year;
    host.log(L('ev.queenCells', { n: picked.length }), { kind: 'queenCell', id: this.cells[this.cells.length - 1].id });
    return picked.length;
  }

  /** 巢脾的下缘：造好了、下面一格还没造（或者到框底了），离框底不少于 minV（王台往下长） */
  private edgeSites(): number[] {
    const cb = this.host.comb;
    const per = GRID.rows * GRID.cols;
    const out: number[] = [];
    for (let s = 0; s < SITES; s++) {
      if (cb.build[s] < 1 || siteV(s) - siteFrame(s) * GRID.frameStep < S.minV) continue;
      if (this.cells.some((c) => c.site === s)) continue;
      const row = Math.floor((s % per) / GRID.cols);
      const below = siteNeighbors(s, this.nb).filter((n) => Math.floor((n % per) / GRID.cols) < row);
      if (below.length < 2 || below.some((n) => cb.build[n] < 1)) out.push(s);
    }
    // 下缘太少（巢脾造满了）就挑每框最低的几行
    if (out.length >= S.cells[1]) return out;
    for (let s = 0; s < SITES; s++) {
      const y = siteV(s) - siteFrame(s) * GRID.frameStep;
      if (cb.build[s] >= 1 && y >= S.minV && y < S.minV + 2 && !out.includes(s)) out.push(s);
    }
    return out;
  }

  /** 分蜂（测试也用）：老蜂王带着一大半在巢里的工蜂、一半雄蜂出巢门 */
  issue(): void {
    const host = this.host;
    Object.assign(this.swarm, S.cloud);
    this.swarm.r = S.cloudR;
    this.swarm.phase = 'leaving';
    this.timer = 0;
    const n = host.bees.issue(S.share, S.droneShare, this.mother());
    this.left += n;
    this.swarms++;
    this.stage = 'queenless';
    host.log(L('ev.swarmIssue', { n }));
  }

  private stepSwarm(dt: number): void {
    const s = this.swarm;
    if (s.phase === 'home') return;
    this.timer += dt;
    if (s.phase === 'leaving') {
      if (this.timer >= S.leaveMax || !this.host.bees.list.some((b) => b.swarm === 4 && b.out < 2)) {
        s.phase = 'cloud';
        this.timer = 0;
      }
    } else if (s.phase === 'cloud') {
      if (this.timer >= S.cloudTime) {
        s.phase = 'away';
        this.dir = this.rng.range(0, TAU);
        this.timer = 0;
      }
    } else {
      s.x += Math.cos(this.dir) * S.speed * dt;
      s.z += Math.sin(this.dir) * S.speed * dt;
      if (Math.hypot(s.x, s.z) > S.farR) {
        s.phase = 'home';
        this.host.bees.depart(4);
        this.host.log(L('ev.swarmGone'));
      }
    }
  }

  /** 王台里的蜂王发育；巢脾没了的王台跟着没了 */
  private stepCells(dt: number): void {
    const host = this.host;
    const cb = host.comb;
    const hold = !!this.mother();
    for (let i = this.cells.length - 1; i >= 0; i--) {
      const c = this.cells[i];
      if (cb.build[c.site] < 1) {
        this.cells.splice(i, 1);
        continue;
      }
      if (c.stage === QUEEN_CELL.torn) {
        if ((c.age += dt) >= S.torn) this.cells.splice(i, 1);
        continue;
      }
      if (c.stage === QUEEN_CELL.cup) {
        // 老蜂王在才产卵；走了以后空着的台基留着，有蜂王出房时一起咬掉
        if (hold && (c.age -= dt) <= 0) {
          c.stage = QUEEN_CELL.egg;
          c.age = 0;
        }
        continue;
      }
      c.age = Math.min(queenDone, c.age + dt);
      c.stage = c.age < DEV.egg ? QUEEN_CELL.egg : c.age < DEV.egg + DEV.larva ? QUEEN_CELL.larva : QUEEN_CELL.capped;
      if (c.age >= queenDone && !hold && this.virgin < 0) this.emerge(c);
    }
  }

  /** 第一只出房的蜂王咬开别的王台 */
  private emerge(c: QueenCell): void {
    const host = this.host;
    const q = host.bees.addQueen(c.face, siteU(c.site), siteV(c.site));
    this.virgin = q.id;
    this.stage = 'virgin';
    this.timer = 0;
    let torn = 0;
    for (const o of this.cells) {
      if (o === c || o.stage === QUEEN_CELL.torn) continue;
      o.stage = QUEEN_CELL.torn;
      o.age = 0;
      torn++;
    }
    c.stage = QUEEN_CELL.torn;
    c.age = 0;
    host.log(L(torn ? 'ev.virginTore' : 'ev.virgin', { n: torn }), { kind: 'bee', id: q.id });
  }

  /** 新蜂王没了（老死、跟着飞逃……）：箱里没有蜂王 */
  private lost(): void {
    this.virgin = -1;
    this.stage = 'queenless';
    this.orphaned();
  }

  /** 没有蜂王也没有王台：有卵、小幼虫就改造几个急造王台 */
  private orphaned(): void {
    if (this.mother() || this.virgin >= 0 || this.cells.some((c) => c.stage < QUEEN_CELL.torn)) return;
    const host = this.host;
    const cb = host.comb;
    const young: number[] = [];
    for (let cell = 0; cell < 2 * SITES; cell++) {
      const k = cb.content[cell];
      const s = cell % SITES;
      if ((k !== CELL.egg && !(k === CELL.larva && cb.age[cell] < DEV.egg + DEV.larva * 0.3)) || cb.drone[s]) continue;
      if (siteV(s) - siteFrame(s) * GRID.frameStep < S.minV) continue;
      young.push(cell);
    }
    if (!young.length) {
      if (this.stage !== 'queenless') this.stage = 'queenless';
      return;
    }
    let made = 0;
    for (let i = 0; i < young.length && made < S.emergency; i++) {
      const k = i + this.rng.int(0, young.length - 1 - i);
      [young[i], young[k]] = [young[k], young[i]];
      const cell = young[i];
      const site = cell % SITES;
      if (this.cells.some((c) => siteFrame(c.site) === siteFrame(site) && Math.hypot(siteU(c.site) - siteU(site), siteV(c.site) - siteV(site)) < S.gap)) continue;
      const age = cb.age[cell];
      cb.clearBrood(cell);
      this.cells.push({ id: host.nextId(), site, face: cell >= SITES ? 1 : 0, stage: age < DEV.egg ? QUEEN_CELL.egg : QUEEN_CELL.larva, age });
      made++;
    }
    this.stage = 'queenless';
    this.emergencies++;
    host.log(L('ev.emergencyCells', { n: made }), { kind: 'queenCell', id: this.cells[this.cells.length - 1].id });
  }

  /** 箱子空了（飞逃、死光）：王台随旧巢脾拿走，从头来 */
  reset(): void {
    this.cells.length = 0;
    this.stage = 'none';
    this.virgin = -1;
    this.timer = 0;
    this.flown = false;
  }

  /** 蜂群面板、蜂箱面板上的一句 */
  label(): Text {
    const s = this.swarm.phase;
    if (s === 'leaving' || s === 'cloud' || s === 'away') return L(`swarming.${s}`);
    const live = this.cells.filter((c) => c.stage < QUEEN_CELL.torn);
    switch (this.stage) {
      case 'cells':
        return L('swarming.cells', { n: live.length, c: live.filter((c) => c.stage === QUEEN_CELL.capped).length });
      case 'queenless': {
        const next = Math.min(...live.map(untilEmerge));
        return Number.isFinite(next) ? L('swarming.queenless', { d: (next / this.dayLength).toFixed(1) }) : L('swarming.hopeless');
      }
      default:
        return L(`swarming.${this.stage}`);
    }
  }

  toSave(): SwarmingSave {
    const s = this.swarm;
    return {
      stage: this.stage,
      cells: this.cells.map((c) => ({ ...c, age: r4(c.age) })),
      swarm: { phase: s.phase, x: r4(s.x), y: r4(s.y), z: r4(s.z), r: r4(s.r) },
      timer: r4(this.timer),
      hourAcc: r4(this.hourAcc),
      dir: r4(this.dir),
      virgin: this.virgin,
      flown: this.flown,
      year: this.year,
      stats: [this.swarms, this.left, this.queens, this.emergencies],
    };
  }

  restore(d: SwarmingSave): void {
    this.stage = d.stage;
    this.cells.length = 0;
    for (const c of d.cells) this.cells.push({ ...c });
    Object.assign(this.swarm, d.swarm);
    this.timer = d.timer;
    this.hourAcc = d.hourAcc;
    this.dir = d.dir;
    this.virgin = d.virgin;
    this.flown = d.flown;
    this.year = d.year;
    [this.swarms, this.left, this.queens, this.emergencies] = d.stats;
  }
}

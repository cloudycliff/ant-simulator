import { L, type Text } from '../../../core/i18n';
import type { Season } from '../../../core/sim/clock';
import { TAU, clamp } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import { CASTE, type Bees } from './bees';
import { CELLS, type Comb } from './comb';

const U = CONFIG.abscond;

/**
 * 蜂群在哪一步：home 平时；leaving 正从巢门涌出、cloud 在箱外盘旋、away 飞走；empty 箱子空着、scouts 侦察蜂来看、
 * arriving 野生蜂群飞来、landing 在巢门前盘旋着进巢
 */
export type SwarmPhase = 'home' | 'leaving' | 'cloud' | 'away' | 'empty' | 'scouts' | 'arriving' | 'landing';

/** 飞走的、飞来的蜂群的中心和盘旋的半径，蜂跟着它飞 */
export interface SwarmState {
  phase: SwarmPhase;
  x: number;
  y: number;
  z: number;
  r: number;
}

export const FACTORS = ['stress', 'hunger', 'hornets', 'pests'] as const;
export type Factor = (typeof FACTORS)[number];

export interface AbscondSave {
  swarm: SwarmState;
  pressure: number;
  factors: number[];
  bad: number;
  restless: boolean;
  hornetAvg: number;
  acc: number;
  timer: number;
  dir: number;
  stash: number;
  stats: number[];
  lowYear?: number;
}

/** 飞逃要看的：蜂、巢脾、开箱的压力、胡蜂、巢虫、天气和时刻，记事件 */
export interface AbscondHost {
  bees: Bees;
  comb: Comb;
  stress: () => number;
  danger: () => number;
  worms: () => number;
  /** 空箱时把两框换成空巢框，返回拿出来的蜜；不换时返回 -1 */
  renew: () => number;
  flyable: () => boolean;
  clock: { hour: number; season: Season; year: number };
  log(msg: Text): void;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const within = (h: number, [a, b]: readonly [number, number]) => h >= a && h < b;

/**
 * 飞逃和搬进来的野生蜂群（P-010、T-025）。开箱、缺蜜、胡蜂、病虫加起来是蜂群的处境，飞逃的压力慢慢趋向它；
 * 压力高了先有征兆，再高就整群飞走。箱子空一阵以后侦察蜂来看，然后一群野生的中蜂搬进来，游戏接着玩
 */
export class Abscond {
  readonly swarm: SwarmState = { phase: 'home', x: 0, y: 0, z: 0, r: 0 };
  pressure = 0;
  /** 四样压力（0..1）和加权加起来的处境，每 every 秒算一次 */
  readonly factors: Record<Factor, number> = { stress: 0, hunger: 0, hornets: 0, pests: 0 };
  bad = 0;
  /** 看得出征兆 */
  restless = false;
  /** 飞逃过几次（蜂死光的也算）、搬进来几群、飞走带走多少蜂、丢下多少子 */
  absconds = 0;
  moveIns = 0;
  left = 0;
  abandoned = 0;
  private hornetAvg = 0;
  private acc = 0;
  /** 这一步过了多久；空箱、侦察时是还剩多久 */
  private timer = 0;
  private dir = 0;
  /** 搬进来的蜂群带来、还没吐进巢房的蜜（房）：新巢框上没几个空房，造出来一个吐一个 */
  stash = 0;
  /** 哪一年冬天记过存蜜快吃光了（P-017） */
  private lowYear = 0;

  constructor(
    private readonly rng: Rng,
    private readonly dayLength: number,
    private readonly host: AbscondHost,
  ) {}

  /** 征兆有多重（0..1） */
  get unrest(): number {
    return this.swarm.phase === 'home' && this.restless ? clamp((this.pressure - U.calm) / (U.leave - U.calm), 0, 1) : 0;
  }

  /** 箱里有蜂群（羽化的蜂有蜂照顾） */
  get present(): boolean {
    return this.swarm.phase === 'home' || this.swarm.phase === 'landing';
  }

  /** 压力里占得最多的一样 */
  get cause(): Factor {
    let best: Factor = 'stress';
    for (const f of FACTORS) if (U.weights[f] * this.factors[f] > U.weights[best] * this.factors[best]) best = f;
    return best;
  }

  update(dt: number): void {
    const s = this.swarm;
    const host = this.host;
    this.hornetAvg += (host.danger() - this.hornetAvg) * Math.min(1, dt / (U.hornetDays * this.dayLength));
    switch (s.phase) {
      case 'home':
        this.acc += dt;
        if (this.acc >= U.every) {
          const step = this.acc;
          this.acc = 0;
          this.assess(step);
        }
        return;
      case 'leaving':
        this.timer += dt;
        if (this.timer >= U.leaveMax || !host.bees.list.some((b) => b.out < 2)) this.next('cloud');
        return;
      case 'cloud':
        this.timer += dt;
        if (this.timer >= U.cloudTime) {
          this.dir = this.rng.range(0, TAU);
          this.next('away');
        }
        return;
      case 'away':
        s.x += Math.cos(this.dir) * U.speed * dt;
        s.z += Math.sin(this.dir) * U.speed * dt;
        if (Math.hypot(s.x, s.z) > U.farR) this.vacate('ev.gone');
        return;
      case 'empty':
        this.timer -= dt;
        if (this.timer <= 0 && within(host.clock.hour, U.scoutHours) && host.flyable() && U.seasons.includes(host.clock.season)) {
          this.far(300, 100);
          host.bees.incoming(this.rng.int(U.scouts[0], U.scouts[1]), 0, false, s, 3);
          this.timer = U.scoutTime;
          this.next('scouts');
          host.log(L('ev.scouts'));
        }
        return;
      case 'scouts':
        this.timer -= dt;
        if (this.timer <= 0 && within(host.clock.hour, U.hours) && host.flyable()) {
          this.far(400, U.cloudR);
          host.bees.incoming(this.rng.int(U.workers[0], U.workers[1]), this.rng.int(U.drones[0], U.drones[1]), true, s, 2);
          this.next('arriving');
          host.log(L('ev.swarm'));
        }
        return;
      case 'arriving': {
        const dx = U.land.x - s.x;
        const dy = U.land.y - s.y;
        const dz = U.land.z - s.z;
        const d = Math.hypot(dx, dy, dz);
        const k = Math.min(1, (U.speed * dt) / Math.max(d, 1e-6));
        s.x += dx * k;
        s.y += dy * k;
        s.z += dz * k;
        s.r += (U.landR - s.r) * Math.min(1, dt / 10);
        if (d < 20) this.next('landing');
        return;
      }
      case 'landing':
        this.timer += dt;
        if (this.timer >= U.landMax) {
          this.moveIns++;
          let workers = 0;
          for (const b of host.bees.list) if (b.caste === CASTE.worker) workers++;
          this.stash = workers * U.carry;
          this.stash -= host.comb.unload(this.stash);
          this.pressure = 0;
          this.restless = false;
          this.acc = 0;
          this.next('home');
          host.log(L('ev.moveIn', { n: host.bees.list.length }));
        }
    }
  }

  /** 看一次处境，压力往它那边走；该有征兆、该飞逃了就开始 */
  private assess(step: number): void {
    const host = this.host;
    const cb = host.comb;
    let workers = 0;
    for (const b of host.bees.list) if (b.caste === CASTE.worker) workers++;
    if (workers < U.collapse) {
      this.absconds++;
      this.vacate(host.clock.season === 'winter' ? 'ev.winterDead' : 'ev.collapse');
      return;
    }
    if (this.stash > 1e-6) this.stash = Math.max(0, this.stash - cb.unload(this.stash));
    const c = cb.census();
    if (host.clock.season === 'winter' && c.honeyCells + this.stash < CONFIG.cluster.lowStores && this.lowYear !== host.clock.year) {
      this.lowYear = host.clock.year;
      host.log(L('ev.lowStores', { n: Math.round(c.honeyCells + this.stash) }));
    }
    let bald = 0;
    for (let cell = 0; cell < CELLS; cell++) if (cb.bald[cell]) bald++;
    const f = this.factors;
    f.stress = r4(clamp(host.stress() / U.stressFull, 0, 1));
    f.hunger = r4(clamp((U.hungerAt - c.honeyCells - this.stash) / (U.hungerAt - U.hungerFull), 0, 1));
    f.hornets = r4(clamp(this.hornetAvg / U.hornetFull, 0, 1));
    f.pests = r4(clamp((bald + c.counts.sac + U.worm * host.worms()) / U.pestFull, 0, 1));
    this.bad = r4(Math.min(1, FACTORS.reduce((a, k) => a + U.weights[k] * f[k], 0)));
    // 蜜吃光了蜂几个小时就饿死，等不了几天
    const rate = f.hunger >= 1 ? U.starveRate : 1;
    this.pressure += (this.bad - this.pressure) * Math.min(1, (step * rate) / (U.days * this.dayLength));
    if (!this.restless && this.pressure >= U.restless) {
      this.restless = true;
      host.log(L('ev.restless', { cause: L(`cause.${this.cause}`) }));
    } else if (this.restless && this.pressure < U.calm) {
      this.restless = false;
      host.log(L('ev.calm'));
    }
    if (this.pressure >= U.leave && within(host.clock.hour, U.hours) && host.flyable() && U.seasons.includes(host.clock.season)) this.leave();
  }

  /** 飞逃（测试、截图也用） */
  leave(): void {
    const s = this.swarm;
    Object.assign(s, U.cloud);
    s.r = U.cloudR;
    this.absconds++;
    this.restless = false;
    this.next('leaving');
    this.host.bees.abscond();
    this.host.log(L('ev.abscond', { cause: L(`cause.${this.cause}`) }));
  }

  /** 蜂群走了（或死光了）：剩下的蜂都算走了，卵和幼虫没人管死掉，箱子空一阵；空箱里换上两框空巢框，新来的蜂群从头造 */
  private vacate(key: 'ev.gone' | 'ev.collapse' | 'ev.winterDead'): void {
    this.left += this.host.bees.depart();
    const brood = this.host.comb.abandon();
    this.abandoned += brood;
    this.pressure = 0;
    this.restless = false;
    this.stash = 0;
    this.timer = this.rng.range(U.vacant[0], U.vacant[1]) * this.dayLength;
    this.next('empty');
    this.host.log(L(key, { n: brood }));
    const honey = this.host.renew();
    if (honey >= 0) this.host.log(L('ev.renew', { n: Math.round(honey) }));
  }

  /** 蜂群的中心放到花园外 farR 处随便一个方向、离地 y */
  private far(y: number, r: number): void {
    const a = this.rng.range(0, TAU);
    Object.assign(this.swarm, { x: Math.cos(a) * U.farR, y, z: Math.sin(a) * U.farR, r });
  }

  private next(phase: SwarmPhase): void {
    this.swarm.phase = phase;
    if (phase !== 'empty' && phase !== 'scouts') this.timer = 0;
  }

  toSave(): AbscondSave {
    const s = this.swarm;
    return {
      swarm: { phase: s.phase, x: r4(s.x), y: r4(s.y), z: r4(s.z), r: r4(s.r) },
      pressure: r4(this.pressure),
      factors: FACTORS.map((k) => this.factors[k]),
      bad: this.bad,
      restless: this.restless,
      hornetAvg: r4(this.hornetAvg),
      acc: r4(this.acc),
      timer: r4(this.timer),
      dir: r4(this.dir),
      stash: r4(this.stash),
      stats: [this.absconds, this.moveIns, this.left, this.abandoned],
      lowYear: this.lowYear,
    };
  }

  restore(d: AbscondSave): void {
    Object.assign(this.swarm, d.swarm);
    this.pressure = d.pressure;
    FACTORS.forEach((k, i) => (this.factors[k] = d.factors[i]));
    this.bad = d.bad;
    this.restless = d.restless;
    this.hornetAvg = d.hornetAvg;
    this.acc = d.acc;
    this.timer = d.timer;
    this.dir = d.dir;
    this.stash = d.stash;
    [this.absconds, this.moveIns, this.left, this.abandoned] = d.stats;
    this.lowYear = d.lowYear ?? 0;
  }
}

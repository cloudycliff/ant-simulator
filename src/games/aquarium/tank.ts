import * as THREE from 'three';
import { L, t, type Text } from '../../core/i18n';
import { SaveSlot, type SaveMeta } from '../../core/platform/saveSlot';
import { Simulation } from '../../core/sim/simulation';
import type { ToolResult } from '../../core/ui/tools';
import { clamp, smoothstep } from '../../core/util/math';
import { Noise2D, Rng } from '../../core/util/random';
import { CONFIG, SPECIES, SPECIES_LIST, type Species } from './config';

export type AqRef = { kind: 'fish'; id: number } | { kind: 'plant'; id: number } | { kind: 'food'; id: number };

export interface Fish {
  id: number;
  species: Species;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hunger: number;
  /** 出生时的模拟秒数（开局的鱼是负数） */
  born: number;
  size: number;
  /** 漫游的方向角，随机游走 */
  wander: number;
  fleeT: number;
  eaten: number;
  activity: Text;
}

export interface Flake {
  id: number;
  pos: THREE.Vector3;
  state: 'float' | 'sink' | 'bottom';
  /** 进入当前状态以来的秒数 */
  t: number;
  drift: number;
}

export interface Plant {
  id: number;
  kind: 'vallis' | 'sword';
  x: number;
  z: number;
  height: number;
  leaves: number;
}

export interface Rock {
  x: number;
  z: number;
  r: number;
}

type FishSave = Omit<Fish, 'pos' | 'vel' | 'activity'> & { p: number[]; v: number[] };
type FlakeSave = Omit<Flake, 'pos'> & { p: number[] };

export interface TankSave {
  fish: FishSave[];
  food: FlakeSave[];
  stats: Tank['stats'] & { history: Tank['history'] };
  events: ReturnType<Tank['events']['toSave']>;
}

const ACT = {
  school: L('act.school'),
  cruise: L('act.cruise'),
  forage: L('act.forage'),
  chase: L('act.chase'),
  rest: L('act.rest'),
  flee: L('act.flee'),
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const _steer = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _d = new THREE.Vector3();

/** 鱼缸：鱼、鱼食、水草和石头。水草和石头由编号生成，不进存档 */
export class Tank extends Simulation<AqRef> {
  readonly rng: Rng;
  readonly fish: Fish[] = [];
  food: Flake[] = [];
  readonly plants: Plant[] = [];
  readonly rocks: Rock[] = [];
  stats = { feeds: 0, eaten: 0, rotted: 0 };
  /** 每游戏小时一个点 */
  history: { day: number; hunger: number; food: number }[] = [];
  private noise: Noise2D;
  private nextId = 1;
  private sampleAt = 0;
  private hungryNoted = false;
  /** 上次喂食以后吃掉的片数；-1 表示这一把已经报过“吃完了” */
  private eatenSinceFeed = -1;
  private rotNoted = false;
  private lightWasOn: boolean;

  constructor(readonly seed: number) {
    super(CONFIG.clock.dayLength, CONFIG.clock.startHour);
    this.rng = new Rng(seed);
    this.noise = new Noise2D(seed);
    this.generate();
    this.lightWasOn = this.light() > 0.5;
    this.addSystem('fish', (dt) => this.updateFish(dt));
    this.addSystem('food', (dt) => this.updateFood(dt));
    this.addSystem('stats', () => this.sample());
    this.saves.add('fish', () => this.fish.map(saveFish), (d: FishSave[]) => {
      this.fish.length = 0;
      for (const s of d) this.fish.push(loadFish(s));
      this.nextId = Math.max(this.nextId, ...this.fish.map((f) => f.id + 1));
    });
    this.saves.add('food', () => this.food.map(({ pos, ...f }) => ({ ...f, p: [r2(pos.x), r2(pos.y), r2(pos.z)] })), (d: FlakeSave[]) => {
      this.food = d.map(({ p, ...f }) => ({ ...f, pos: new THREE.Vector3(p[0], p[1], p[2]) }));
      this.nextId = Math.max(this.nextId, ...this.food.map((f) => f.id + 1));
    });
    this.saves.add('stats', () => ({ ...this.stats, history: this.history }), (d: TankSave['stats']) => {
      const { history, ...s } = d;
      this.stats = s;
      this.history = history;
      this.settle();
    });
    this.saves.add('events', () => this.events.toSave((r) => this.entities.stable(r)), (d: TankSave['events']) => this.events.restore(d));
    this.entities.define('fish', { pos: (r) => this.fishById(r.id)?.pos ?? null, viewDistance: 16, follow: true });
    this.entities.define('plant', {
      pos: (r) => {
        const p = this.plants[r.id];
        return p ? { x: p.x, y: this.floorAt(p.x, p.z) + p.height * 0.5, z: p.z } : null;
      },
      viewDistance: 45,
    });
    this.entities.define('food', { pos: (r) => this.food.find((f) => f.id === r.id)?.pos ?? null, viewDistance: 10, unstable: true });
  }

  /** 沙面高度：向后缓缓升高，带一点起伏 */
  floorAt(x: number, z: number): number {
    const T = CONFIG.tank;
    return T.sand * (1 + 0.5 * this.noise.fbm(x * 0.04, z * 0.04, 3)) + ((T.d / 2 - z) / T.d) * 4;
  }

  /** 鱼缸灯 0..1 */
  light(): number {
    const h = this.clock.hour;
    const { on, off, ramp } = CONFIG.light;
    return smoothstep(on, on + ramp, h) * (1 - smoothstep(off, off + ramp, h));
  }

  /** 水温：白天开灯时略高 */
  waterTemp(): number {
    return 24.5 + 0.8 * this.light();
  }

  /** 时钟被读档或网址参数改过以后调用：灯的开关和采样时刻按现在算，免得记一条假的开关灯事件 */
  settle(): void {
    this.lightWasOn = this.light() > 0.5;
    this.sampleAt = this.clock.seconds + this.clock.dayLength / 24;
  }

  fishById(id: number): Fish | undefined {
    return this.fish.find((f) => f.id === id);
  }

  private generate(): void {
    const r = this.rng;
    const T = CONFIG.tank;
    for (let i = 0; i < 4; i++) this.rocks.push({ x: r.range(-45, 45), z: r.range(-8, 12), r: r.range(4, 9) });
    for (let i = 0; i < 7; i++) this.plants.push({ id: i, kind: 'vallis', x: -50 + i * 16 + r.range(-4, 4), z: r.range(-22, -15), height: r.range(34, 48), leaves: r.int(7, 12) });
    for (let i = 0; i < 3; i++) this.plants.push({ id: 7 + i, kind: 'sword', x: -36 + i * 34 + r.range(-6, 6), z: r.range(-10, -2), height: r.range(16, 24), leaves: r.int(9, 14) });
    for (const sp of SPECIES_LIST) {
      const S = SPECIES[sp];
      for (let i = 0; i < S.count; i++) {
        const x = r.range(-T.w / 2 + 10, T.w / 2 - 10);
        const z = r.range(-T.d / 2 + 6, T.d / 2 - 6);
        const y = this.floorAt(x, z) + r.range(S.band[0], S.band[1]);
        const a = r.range(-Math.PI, Math.PI);
        this.fish.push({
          id: this.nextId++,
          species: sp,
          pos: new THREE.Vector3(x, y, z),
          vel: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(S.speed * 0.5),
          hunger: r.range(0.1, 0.35),
          born: -r.range(60, 400) * this.clock.dayLength,
          size: r.range(0.85, 1.15),
          wander: a,
          fleeT: 0,
          eaten: 0,
          activity: ACT.cruise,
        });
      }
    }
  }

  private updateFish(dt: number): void {
    const F = CONFIG.fish;
    const T = CONFIG.tank;
    const lit = this.light() > 0.5;
    if (lit !== this.lightWasOn) {
      this.lightWasOn = lit;
      this.events.push(L(lit ? 'ev.lightOn' : 'ev.lightOff'), undefined, { x: 0, y: T.h, z: 0 });
    }
    let hungerSum = 0;
    for (const f of this.fish) {
      const S = SPECIES[f.species];
      f.hunger = Math.min(1, f.hunger + (F.hungerPerDay * dt) / this.clock.dayLength);
      hungerSum += f.hunger;
      const act = lit ? 1 : S.night;
      _steer.set(0, 0, 0);
      _ali.set(0, 0, 0);
      _coh.set(0, 0, 0);
      _sep.set(0, 0, 0);
      let n = 0;
      for (const o of this.fish) {
        if (o === f) continue;
        _d.subVectors(f.pos, o.pos);
        const d = _d.length() || 0.01;
        if (o.species === f.species) {
          if (d < S.view) {
            _ali.add(o.vel);
            _coh.add(o.pos);
            n++;
          }
          if (d < S.sep) _sep.addScaledVector(_d, (S.sep - d) / (d * S.sep));
        } else if (d < (S.len + SPECIES[o.species].len) * 0.6) _sep.addScaledVector(_d, 1 / d);
      }
      if (n) {
        _steer.addScaledVector(_ali.divideScalar(n).sub(f.vel), S.align * 0.5);
        _steer.addScaledVector(_coh.divideScalar(n).sub(f.pos), S.cohere * 0.08);
      }
      _steer.addScaledVector(_sep, S.speed * 2);

      const target = f.hunger > F.hungry && f.fleeT <= 0 ? this.nearestFood(f) : null;
      const floor = this.floorAt(f.pos.x, f.pos.z);
      if (target) {
        _d.subVectors(target.pos, f.pos);
        const d = _d.length();
        if (d < CONFIG.food.eatRadius + S.len * 0.3) this.eat(f, target);
        else _steer.addScaledVector(_d.divideScalar(d).multiplyScalar(S.speed * 1.4).sub(f.vel), 2.5);
      } else {
        // 漫游加水层：太低往上，太高往下
        f.wander += this.rng.gauss(0, 1) * Math.sqrt(dt) * 1.2;
        _steer.x += Math.cos(f.wander) * S.speed * 0.25;
        _steer.z += Math.sin(f.wander) * S.speed * 0.25;
        const lo = floor + S.band[0] * (lit ? 1 : 0.6);
        const hi = floor + S.band[1] * (lit ? 1 : 0.6);
        if (f.pos.y < lo) _steer.y += (lo - f.pos.y) * 0.8;
        else if (f.pos.y > hi) _steer.y -= (f.pos.y - hi) * 0.8;
      }
      this.avoidWalls(f, floor, _steer);
      f.vel.addScaledVector(_steer, dt);
      if (f.fleeT > 0) f.fleeT -= dt;
      const max = S.speed * act * (f.fleeT > 0 ? 2.6 : target ? 1.5 : 1);
      const sp = f.vel.length();
      if (sp > max) f.vel.multiplyScalar(max / sp);
      else if (sp < S.speed * 0.15 * act) f.vel.multiplyScalar((S.speed * 0.15 * act) / Math.max(sp, 1e-3));
      f.vel.y = clamp(f.vel.y, -max * 0.5, max * 0.5);
      f.pos.addScaledVector(f.vel, dt);
      const m = S.len * 0.5;
      f.pos.x = clamp(f.pos.x, -T.w / 2 + m, T.w / 2 - m);
      f.pos.z = clamp(f.pos.z, -T.d / 2 + m, T.d / 2 - m);
      f.pos.y = clamp(f.pos.y, this.floorAt(f.pos.x, f.pos.z) + S.len * 0.25, T.water - 1);
      f.activity = f.fleeT > 0 ? ACT.flee : target ? ACT.chase : !lit && S.night < 1 ? ACT.rest : S.bottom ? ACT.forage : S.align >= 1 ? ACT.school : ACT.cruise;
    }
    const avg = hungerSum / Math.max(1, this.fish.length);
    if (!this.hungryNoted && avg > CONFIG.hungryEvent) {
      this.hungryNoted = true;
      this.events.push(L('ev.hungry'));
    } else if (avg < CONFIG.hungryReset) this.hungryNoted = false;
  }

  /** 离缸壁、水面、沙面和石头近了就转开 */
  private avoidWalls(f: Fish, floor: number, out: THREE.Vector3): void {
    const T = CONFIG.tank;
    const W = CONFIG.fish.wall;
    const k = SPECIES[f.species].speed * 1.5;
    const push = (d: number) => (d < W ? (1 - d / W) * k : 0);
    out.x += push(f.pos.x + T.w / 2) - push(T.w / 2 - f.pos.x);
    out.z += push(f.pos.z + T.d / 2) - push(T.d / 2 - f.pos.z);
    out.y += push(f.pos.y - floor) * (SPECIES[f.species].bottom ? 0.3 : 1) - push(T.water - f.pos.y);
    for (const r of this.rocks) {
      _d.set(f.pos.x - r.x, f.pos.y - floor - r.r * 0.3, f.pos.z - r.z);
      const d = _d.length() - r.r;
      if (d < W) out.addScaledVector(_d.normalize(), push(Math.max(0, d)));
    }
  }

  private nearestFood(f: Fish): Flake | null {
    const bottom = SPECIES[f.species].bottom;
    let best: Flake | null = null;
    let bd = CONFIG.food.sense ** 2;
    for (const p of this.food) {
      if (bottom !== (p.state === 'bottom')) continue;
      const d = p.pos.distanceToSquared(f.pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private eat(f: Fish, p: Flake): void {
    f.hunger = Math.max(0, f.hunger - CONFIG.food.portion);
    f.eaten++;
    this.stats.eaten++;
    this.food.splice(this.food.indexOf(p), 1);
    if (this.eatenSinceFeed >= 0) this.eatenSinceFeed++;
    if (this.food.length === 0 && this.eatenSinceFeed > 0) {
      this.events.push(L('ev.allEaten', { n: this.eatenSinceFeed }), { kind: 'fish', id: f.id });
      this.eatenSinceFeed = -1;
    }
  }

  private updateFood(dt: number): void {
    const P = CONFIG.food;
    let rotted = false;
    for (const p of this.food) {
      p.t += dt;
      if (p.state === 'float') {
        p.pos.x += Math.sin(p.t * 0.7 + p.drift) * 0.3 * dt;
        if (p.t > P.floatSec) {
          p.state = 'sink';
          p.t = 0;
        }
      } else if (p.state === 'sink') {
        p.pos.y -= P.sink * dt;
        p.pos.x += Math.sin(p.t * 2 + p.drift) * 0.6 * dt;
        const floor = this.floorAt(p.pos.x, p.pos.z) + 0.2;
        if (p.pos.y <= floor) {
          p.pos.y = floor;
          p.state = 'bottom';
          p.t = 0;
        }
      } else if (p.t > P.rotSec) rotted = true;
    }
    if (!rotted) return;
    const before = this.food.length;
    const gone = this.food.find((p) => p.state === 'bottom' && p.t > P.rotSec)!;
    this.food = this.food.filter((p) => !(p.state === 'bottom' && p.t > P.rotSec));
    this.stats.rotted += before - this.food.length;
    if (!this.rotNoted) {
      this.rotNoted = true;
      this.events.push(L('ev.rotted'), undefined, gone.pos);
    }
  }

  private sample(): void {
    if (this.clock.seconds < this.sampleAt) return;
    this.sampleAt = this.clock.seconds + this.clock.dayLength / 24;
    const hunger = this.fish.reduce((s, f) => s + f.hunger, 0) / Math.max(1, this.fish.length);
    this.history.push({ day: r2(this.clock.totalDays), hunger: Math.round(hunger * 100), food: this.food.length });
    if (this.history.length > 24 * 30) this.history.shift();
  }

  /** 在 (x, z) 上方的水面撒 n 片鱼食 */
  feed(x: number, z: number, n: number, radius: number, dry: boolean): ToolResult {
    const T = CONFIG.tank;
    if (Math.abs(x) > T.w / 2 - 2 || Math.abs(z) > T.d / 2 - 2) return { ok: false, msg: L('tool.outside') };
    if (dry) return { ok: true };
    const r = this.rng;
    for (let i = 0; i < n && this.food.length < CONFIG.food.max; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = Math.sqrt(r.next()) * radius;
      const px = clamp(x + Math.cos(a) * d, -T.w / 2 + 1, T.w / 2 - 1);
      const pz = clamp(z + Math.sin(a) * d, -T.d / 2 + 1, T.d / 2 - 1);
      this.food.push({ id: this.nextId++, pos: new THREE.Vector3(px, T.water - 0.2, pz), state: 'float', t: r.range(0, 2), drift: r.range(0, 6) });
    }
    this.stats.feeds++;
    this.eatenSinceFeed = 0;
    this.rotNoted = false;
    const msg = L('ev.fed', { n });
    this.events.push(msg, undefined, { x, y: T.water, z });
    return { ok: true, msg };
  }

  /** 敲玻璃：附近的鱼往远离 p 的方向逃 */
  tap(p: THREE.Vector3, dry: boolean): ToolResult {
    const T = CONFIG.tank;
    if (Math.abs(p.x) > T.w / 2 + 1 || Math.abs(p.z) > T.d / 2 + 1) return { ok: false, msg: L('tool.outside') };
    if (dry) return { ok: true };
    let n = 0;
    for (const f of this.fish) {
      _d.subVectors(f.pos, p);
      const d = _d.length();
      if (d > CONFIG.fish.fleeRadius) continue;
      n++;
      f.fleeT = CONFIG.fish.fleeSec;
      f.vel.addScaledVector(_d.normalize(), SPECIES[f.species].speed * 3);
    }
    return { ok: true, msg: L('tool.tapped', { n }) };
  }
}

const SAVE_VERSION = 1;

export interface AqSaveData extends TankSave {
  version: number;
  seed: number;
  savedAt: number;
  clock: { seconds: number; speed: number };
  camera?: number[];
}

export interface AqSaveMeta extends SaveMeta {
  fish: number;
}

export const aqSave = {
  slot: new SaveSlot<AqSaveData, AqSaveMeta>('cyber-aquarium-save'),
  write: (w: Tank, savedAt: number) => ({ version: SAVE_VERSION, seed: w.seed, savedAt, ...w.saves.save() }) as unknown as AqSaveData,
  read(w: Tank, d: AqSaveData): void {
    if (w.seed !== d.seed) throw new Error(t('save.seedMismatch'));
    if (d.version !== SAVE_VERSION) throw new Error(t('save.incompatible'));
    w.saves.restore(d as unknown as Record<string, unknown>);
  },
  problem: (d: AqSaveData) => (d.version !== SAVE_VERSION ? L('save.incompatible') : null),
  meta: (d: AqSaveData): AqSaveMeta => ({ savedAt: d.savedAt, seconds: Math.round(d.clock.seconds), fish: d.fish.length }),
};

function saveFish(f: Fish): FishSave {
  return {
    id: f.id,
    species: f.species,
    p: [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z)],
    v: [r2(f.vel.x), r2(f.vel.y), r2(f.vel.z)],
    hunger: r2(f.hunger),
    born: Math.round(f.born),
    size: r2(f.size),
    wander: r2(f.wander),
    fleeT: 0,
    eaten: f.eaten,
  };
}

function loadFish(s: FishSave): Fish {
  const { p, v, ...rest } = s;
  return { ...rest, pos: new THREE.Vector3(p[0], p[1], p[2]), vel: new THREE.Vector3(v[0], v[1], v[2]), activity: ACT.cruise };
}

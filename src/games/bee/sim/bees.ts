import { Behavior, type Routine as CoreRoutine } from '../../../core/sim/behavior';
import type { IdPool } from '../../../core/sim/ids';
import { turnToward } from '../../../core/move/surface';
import type { Point3 } from '../../../core/sim/events';
import { wrapAngle } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import { CELL, CELLS, GRID, SITES, cellFace, cellSite, siteU, siteV, type Comb } from './comb';
import { APPROACH, DEPART, DOCK, DOOR, MOUTH, TUBE_LEN, steer, tubeAt } from './flight';
import { landingPoint, openness, plantCount, plantsOf, type FlowerPatch, type Flowers } from './flowers';
import { Field, NODES, WalkMap, cellNode, nodeAt, nodeU, nodeV } from './walk';

const B = CONFIG.bees;
const C = CONFIG.care;
const H = CONFIG.hive;
const P = CONFIG.cell.pitch;
const F = CONFIG.forage;
const SPECIES = CONFIG.flowers.species;

/** 每个位置在育儿区（0）、外面放花粉的一圈（1）还是再往外放花蜜（2）；按开局育儿区的椭圆，不随蜂群变 */
const ZONE = (() => {
  const O = CONFIG.opening.brood;
  const z = new Uint8Array(SITES);
  for (let s = 0; s < SITES; s++) {
    const d = Math.hypot((siteU(s) - O.u) / O.ru, (siteV(s) - O.v) / O.rv);
    z[s] = d < 1 ? 0 : d < C.ring ? 1 : 2;
  }
  return z;
})();

export const CASTE = { worker: 0, drone: 1, queen: 2 } as const;
export const CASTE_KEYS = ['worker', 'drone', 'queen'] as const;
export const ROLE_KEYS = ['cleaner', 'nurse', 'house', 'guard', 'forager'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
/** 正在做什么（信息面板的 act.* 文字） */
export const ACTS = [
  'rest',
  'wander',
  'goEat',
  'eat',
  'goPollen',
  'pollen',
  'goFeed',
  'feed',
  'goClean',
  'clean',
  'goBuild',
  'build',
  'goRipen',
  'ripen',
  'cap',
  'guard',
  'wait',
  'seek',
  'inspect',
  'lay',
  'leave',
  'flyOut',
  'sipNectar',
  'gatherPollen',
  'flyHome',
  'enter',
  'goStore',
  'storeNectar',
  'goPack',
  'packPollen',
] as const;
export type Act = (typeof ACTS)[number];

/** 要去的地方各有一张路程场 */
const FIELD_KEYS = ['larvae', 'dirty', 'layable', 'food', 'pollen', 'ripen', 'frontier', 'store', 'pollenStore', 'entrance'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** 行为协程交给运动层的指令；t 是剩下的秒数，执行时就地减，存档时连进度一起存 */
export type Cmd =
  | { k: 'rest'; t: number }
  | { k: 'wander'; t: number }
  /** 沿路程场下坡，离源头不到 near 步就停；结果是到没到 */
  | { k: 'go'; f: FieldKey; near: number; t: number }
  /** 走到同一面的巢房口 */
  | { k: 'to'; cell: number; t: number }
  /** 停在巢房上、头朝着它 */
  | { k: 'work'; cell: number; t: number }
  /** 走巢门的路：dir 1 从巢门格走到管口飞起来，-1 从管口走进来落到 face 那面的巢门格；s 是离巢门格多远 */
  | { k: 'tube'; dir: 1 | -1; s: number; face: number; t: number }
  /** 飞到 (x, y, z) 离 r 以内；stop 为假时是路过、不减速 */
  | { k: 'fly'; x: number; y: number; z: number; r: number; v: number; stop: boolean; t: number }
  /** 停在花上 */
  | { k: 'sip'; t: number };
type Routine = CoreRoutine<Cmd>;

/** 绕过巢脾边时离边多远（cm） */
const WRAP_R = 0.45;
/** 前面走不通时依次试着偏开的角度 */
const DODGE = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5];

export class Bee {
  readonly pos = { x: 0, y: 0, z: 0 };
  alive = true;
  /** 在哪一面（0 朝 +z）、巢面坐标、朝向（巢面里的角度，0 朝 +u） */
  face = 0;
  u = 0;
  v = 0;
  h = 0;
  /** 蜜囊还有多满；饿空了多久（秒） */
  crop = 1;
  fast = 0;
  /** 哺育蜂肚里的花粉还够喂几次 */
  jelly = 0;
  /** 绕边的进度（0 是没在绕）和往外的方向 */
  wrap = 0;
  wn = 0;
  /** 停下来歇着、干活时占着的格（带面），别的蜂绕开它、不在它上面停；走着的蜂不占格 */
  parked = -1;
  /** 0 在巢脾上；1 在巢门管里走；2 在飞；3 停在花上。不在巢脾上时 pos 就是位置，h 是世界里的水平朝向 */
  out = 0;
  readonly vel = { x: 0, y: 0, z: 0 };
  /** 上一步的位置，画面按 world.alpha 在它和 pos 之间插值 */
  readonly prev = { x: 0, y: 0, z: 0 };
  /** 采集蜂认得的花丛（-1 不认得）、采什么（0 花蜜，1 花粉）、带着多少（份） */
  patch = -1;
  goods = 0;
  load = 0;
  act: Act = 'rest';
  readonly brain = new Behavior<Cmd>();
  next!: () => Routine;
  exec!: (c: Cmd, first: boolean) => boolean;

  constructor(
    readonly id: number,
    readonly caste: number,
    public age: number,
    public life: number,
  ) {}
}

/** 工蜂按日龄的分工；雄蜂、蜂王没有 */
export function roleOf(b: Bee): RoleKey | null {
  if (b.caste !== CASTE.worker) return null;
  const R = B.roles;
  return b.age < R.nurse ? 'cleaner' : b.age < R.house ? 'nurse' : b.age < R.guard ? 'house' : b.age < R.forager ? 'guard' : 'forager';
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

type BeeSave = [
  ...[id: number, caste: number, age: number, life: number, face: number, u: number, v: number, h: number, crop: number, jelly: number, wrap: number, wn: number, fast: number],
  ...[act: Act, cmd: Cmd | null, started: number],
  ...[out: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, patch: number, goods: number, load: number],
];
export interface BeesSave {
  bees: BeeSave[];
  trips: number;
  lost: number;
  nectarIn: number;
  pollenIn: number;
  births: number;
  deaths: number;
  laid: number;
  starved: number;
  hungry: number;
}

/** 蜂在巢外要知道的：花丛、此刻几点、地面多高 */
export interface BeeEnv {
  flowers: Flowers;
  hour: () => number;
  ground: (x: number, z: number) => number;
}

/**
 * 蜂：巢里在巢脾两面爬（T-008），按日龄干活，饿了吃蜜；蜂王产卵，子羽化出新的蜂；
 * 采集蜂出巢飞到花丛，采满了飞回来把花蜜、花粉放进巢房（T-013）
 */
export class Bees {
  readonly list: Bee[] = [];
  readonly map = new WalkMap();
  births = 0;
  deaths = 0;
  laid = 0;
  /** 饿死的幼虫、成蜂 */
  starved = 0;
  hungry = 0;
  /** 带着东西回巢的趟数；放进巢房的花蜜、花粉（房） */
  trips = 0;
  /** 死在外面的采集蜂 */
  lost = 0;
  nectarIn = 0;
  pollenIn = 0;
  private byId = new Map<number, Bee>();
  private fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, new Field()])) as Record<FieldKey, Field>;
  private dt = 0;
  /** 快到地方的蜂不再绕开停着的蜂，直接从它们身上爬过去（目标周围总挤着蜂，绕来绕去走不到） */
  private pushing = false;
  /** 每格停着几只蜂 */
  private occ = new Uint8Array(2 * NODES);
  /** 雄蜂子还不多、可以在雄蜂房产卵（重算路程场时定） */
  private droneOk = true;
  private target: Point3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly comb: Comb,
    private readonly rng: Rng,
    private readonly ids: IdPool,
    private readonly now: () => number,
    private readonly env: BeeEnv,
  ) {}

  get(id: number): Bee | undefined {
    return this.byId.get(id);
  }

  get queen(): Bee | undefined {
    return this.list.find((b) => b.caste === CASTE.queen);
  }

  /** 开局的蜂：日龄在寿命里均匀分布，按分工散在各自干活的地方 */
  generate(): void {
    const rng = this.rng;
    this.map.sync(this.comb);
    const O = CONFIG.opening.brood;
    const inBrood = (u: number, v: number, k: number) => Math.hypot((u - O.u) / (O.ru * k), (v - O.v) / (O.rv * k)) < 1;
    const entrance = this.field('entrance');
    const near = (lim: number) => (n: number, f: number) => entrance.dist[f * NODES + n] <= lim;
    const lower = (_n: number, _f: number, v: number) => v < H.frameH;
    const where: Record<RoleKey, (n: number, f: number, v: number, u: number) => boolean> = {
      cleaner: (_n, _f, v, u) => inBrood(u, v, 1.2),
      nurse: (_n, _f, v, u) => inBrood(u, v, 1.1),
      house: () => true,
      guard: near(6),
      forager: lower,
    };
    const q = this.add(CASTE.queen, rng.range(0, 3000), 1e9);
    this.placeAt(q, (_n, _f, v, u) => inBrood(u, v, 0.4));
    for (let i = 0; i < B.workers; i++) {
      const life = rng.range(B.life[0], B.life[1]);
      const b = this.add(CASTE.worker, rng.range(0, life), life);
      b.crop = rng.range(0.4, 1);
      if (roleOf(b) === 'nurse') b.jelly = rng.int(0, C.feeds);
      this.placeAt(b, where[roleOf(b)!]);
    }
    for (let i = 0; i < B.drones; i++) {
      const life = rng.range(B.droneLife[0], B.droneLife[1]);
      const b = this.add(CASTE.drone, rng.range(0, life), life);
      b.crop = rng.range(0.4, 1);
      this.placeAt(b, lower);
    }
  }

  private add(caste: number, age: number, life: number, id = this.ids.next('bee')): Bee {
    const b = new Bee(id, caste, age, life);
    b.next = () => this.task(b);
    b.exec = (c) => this.exec(b, c);
    this.list.push(b);
    this.byId.set(id, b);
    return b;
  }

  /** 随机挑一格满足 want 的巢脾或框条站上去，找不到就随便站在巢脾上 */
  private placeAt(b: Bee, want: (n: number, face: number, v: number, u: number) => boolean): void {
    const rng = this.rng;
    for (let tries = 0; tries < 400; tries++) {
      const n = rng.int(0, NODES - 1);
      const face = rng.int(0, 1);
      if (this.map.walk[n] === 0 || (tries < 300 && (this.occ[face * NODES + n] > 0 || !want(n, face, nodeV(n), nodeU(n))))) continue;
      b.face = face;
      b.u = nodeU(n) + rng.range(-0.2, 0.2);
      b.v = nodeV(n) + rng.range(-0.2, 0.2);
      b.h = rng.range(-Math.PI, Math.PI);
      this.place(b);
      Object.assign(b.prev, b.pos);
      return;
    }
  }

  /** 羽化：新的蜂从巢房里钻出来 */
  emerge(cell: number): void {
    const drone = this.comb.drone[cellSite(cell)] === 1;
    const L = drone ? B.droneLife : B.life;
    const b = this.add(drone ? CASTE.drone : CASTE.worker, 0, this.rng.range(L[0], L[1]));
    b.face = cellFace(cell);
    b.u = siteU(cellSite(cell));
    b.v = siteV(cellSite(cell));
    b.h = this.rng.range(-Math.PI, Math.PI);
    b.crop = 0.5;
    this.place(b);
    Object.assign(b.prev, b.pos);
    this.births++;
  }

  update(dt: number): void {
    this.map.sync(this.comb);
    this.dt = dt;
    let dead = 0;
    for (const b of this.list) {
      b.prev.x = b.pos.x;
      b.prev.y = b.pos.y;
      b.prev.z = b.pos.z;
      b.age += dt;
      if (b.caste !== CASTE.queen) {
        b.crop = Math.max(0, b.crop - dt / (b.out === 2 ? F.flyBurn : b.caste === CASTE.drone ? B.droneBurn : B.burn));
        b.fast = b.crop > 0 ? 0 : b.fast + dt;
      }
      if (b.age >= b.life || b.fast > B.starve) {
        if (b.fast > B.starve) this.hungry++;
        b.alive = false;
        this.unpark(b);
        dead++;
        continue;
      }
      if (b.wrap > 0) this.stepWrap(b, dt);
      else b.brain.run(b.next, b.exec);
      this.place(b);
    }
    if (!dead) return;
    this.deaths += dead;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.alive) continue;
      this.list.splice(i, 1);
      this.byId.delete(b.id);
    }
  }

  /** 世界坐标：巢面上方 lift；绕边时沿半个椭圆从这一面转到另一面。不在巢脾上的蜂 pos 自己管 */
  private place(b: Bee): void {
    if (b.out) return;
    const zf = b.face ? -1 : 1;
    const r = H.combHalf + B.lift;
    b.pos.x = b.u - H.combW / 2;
    b.pos.y = H.baseY + b.v;
    b.pos.z = zf * r;
    if (b.wrap > 0) {
      const th = Math.PI * b.wrap;
      const out = WRAP_R * Math.sin(th);
      b.pos.x += Math.cos(b.wn) * out;
      b.pos.y += Math.sin(b.wn) * out;
      b.pos.z = zf * r * Math.cos(th);
    }
  }

  /** 停在脚下这一格；框条是过道，不占 */
  private park(b: Bee): void {
    const n = this.nodeOf(b);
    if (n < 0 || this.map.walk[n % NODES] !== 1) return;
    b.parked = n;
    this.occ[n]++;
  }

  private unpark(b: Bee): void {
    if (b.parked < 0) return;
    this.occ[b.parked]--;
    b.parked = -1;
  }

  /** 要停下的蜂：脚下的格空着就停，不然往前挪一点找空 */
  private settle(b: Bee): void {
    if (b.parked >= 0) return;
    const n = this.nodeOf(b);
    if (n >= 0 && this.occ[n] > 0 && this.map.walk[n % NODES] === 1) this.forward(b, this.speed(b) * 0.5 * this.dt);
    else this.park(b);
  }

  private startWrap(b: Bee): boolean {
    const n = nodeAt(b.u, b.v);
    const wn = n < 0 ? NaN : this.map.edge[n];
    if (Number.isNaN(wn)) return false;
    this.unpark(b);
    b.wn = wn;
    b.h = wn;
    b.wrap = 1e-6;
    return true;
  }

  private stepWrap(b: Bee, dt: number): void {
    b.wrap += dt / B.wrapTime;
    if (b.wrap < 1) return;
    b.wrap = 0;
    b.face = 1 - b.face;
    b.h = b.wn + Math.PI;
  }

  private speed(b: Bee): number {
    return b.caste === CASTE.queen ? B.queenWalk : b.caste === CASTE.drone ? B.droneWalk : B.walk;
  }

  /**
   * 往前走 d：前面走不通或停着蜂先往两边偏；只剩停着蜂的路时从它身上爬过去（不然窄处会堵死），
   * 哪边都走不通就掉头
   */
  private forward(b: Bee, d: number): boolean {
    this.unpark(b);
    const s = b.id & 1 ? 1 : -1;
    let over = NaN;
    for (const off of DODGE) {
      const a = b.h + off * s;
      const nu = b.u + Math.cos(a) * d;
      const nv = b.v + Math.sin(a) * d;
      const n = nodeAt(nu, nv);
      if (n < 0 || this.map.walk[n] === 0) continue;
      const m = b.face * NODES + n;
      if (!this.pushing && this.occ[m] > 0 && m !== this.nodeOf(b)) {
        if (Number.isNaN(over)) over = a;
        continue;
      }
      return this.moveTo(b, nu, nv, a);
    }
    if (!Number.isNaN(over)) return this.moveTo(b, b.u + Math.cos(over) * d, b.v + Math.sin(over) * d, over);
    b.h += Math.PI;
    return false;
  }

  private moveTo(b: Bee, u: number, v: number, h: number): boolean {
    b.u = u;
    b.v = v;
    b.h = wrapAngle(h);
    return true;
  }

  private walkTo(b: Bee, tu: number, tv: number, push = false): void {
    const a = Math.atan2(tv - b.v, tu - b.u);
    // 转弯半径约 0.3 cm，贴近了不直接对准会绕着目标打转
    b.h = (tu - b.u) ** 2 + (tv - b.v) ** 2 < 0.36 ? a : turnToward(b.h, a, B.turn, this.dt);
    this.pushing = push;
    this.forward(b, this.speed(b) * this.dt);
    this.pushing = false;
  }

  private exec(b: Bee, c: Cmd): boolean {
    const dt = this.dt;
    switch (c.k) {
      case 'rest':
        this.settle(b);
        if ((c.t -= dt) > 0) return false;
        this.unpark(b);
        return true;
      case 'wander': {
        b.h += (this.rng.next() - 0.5) * 8 * dt;
        const d = this.speed(b) * 0.5 * dt;
        const n = nodeAt(b.u, b.v);
        if (!this.map.ok(b.u + Math.cos(b.h) * d, b.v + Math.sin(b.h) * d) && n >= 0 && this.map.walk[n] === 1 && this.rng.chance(B.wrapChance) && this.startWrap(b)) return false;
        this.forward(b, d);
        return (c.t -= dt) <= 0;
      }
      case 'go': {
        const f = this.field(c.f);
        const n = this.nodeOf(b);
        if (n < 0 || !f.reachable(n) || (c.t -= dt) <= 0) {
          b.brain.result = false;
          return true;
        }
        if (f.dist[n] <= c.near) {
          b.brain.result = true;
          return true;
        }
        const m = f.next(this.map, n, this.occ);
        if (m < 0) {
          b.brain.result = f.dist[n] === 0;
          return true;
        }
        if ((m >= NODES) !== (b.face === 1)) {
          if (!this.startWrap(b)) this.forward(b, this.speed(b) * dt);
          return false;
        }
        this.walkTo(b, nodeU(m), nodeV(m), this.occ[m] > 0 || f.dist[n] <= c.near + 2);
        return false;
      }
      case 'to': {
        const s = cellSite(c.cell);
        const du = siteU(s) - b.u;
        const dv = siteV(s) - b.v;
        if (cellFace(c.cell) !== b.face || (c.t -= dt) <= 0) {
          b.brain.result = false;
          return true;
        }
        if (du * du + dv * dv < 0.09) {
          b.brain.result = true;
          return true;
        }
        this.walkTo(b, siteU(s), siteV(s), du * du + dv * dv < 1.44);
        return false;
      }
      case 'work': {
        const s = cellSite(c.cell);
        const du = siteU(s) - b.u;
        const dv = siteV(s) - b.v;
        if (b.parked < 0) this.park(b);
        if (du * du + dv * dv > 0.0025) b.h = turnToward(b.h, Math.atan2(dv, du), B.turn, dt);
        if ((c.t -= dt) > 0) return false;
        this.unpark(b);
        return true;
      }
      case 'tube':
        return this.stepTube(b, c);
      case 'fly': {
        b.out = 2;
        const T = this.target;
        T.x = c.x;
        T.y = c.y;
        T.z = c.z;
        if (steer(b, T, c.v, c.stop, dt, this.env.ground(b.pos.x, b.pos.z), this.now()) < c.r) {
          b.brain.result = true;
          return true;
        }
        if ((c.t -= dt) > 0) return false;
        b.brain.result = false;
        return true;
      }
      case 'sip':
        b.out = 3;
        b.vel.x = b.vel.y = b.vel.z = 0;
        return (c.t -= dt) <= 0;
    }
  }

  /** 巢门的路：先在巢脾上走到巢门格，再沿管子走；走出管口就飞起来，走进来就落到巢脾上 */
  private stepTube(b: Bee, c: Extract<Cmd, { k: 'tube' }>): boolean {
    if (b.out === 0) {
      const du = DOOR.u - b.u;
      const dv = DOOR.v - b.v;
      if (du * du + dv * dv > 0.0625) {
        if ((c.t -= this.dt) <= 0) {
          b.brain.result = false;
          return true;
        }
        this.walkTo(b, DOOR.u, DOOR.v, true);
        return false;
      }
      this.unpark(b);
      c.face = b.face;
      c.s = 0;
    }
    b.out = 1;
    c.s += c.dir * F.tubeWalk * this.dt;
    if (c.dir > 0 && c.s >= TUBE_LEN) {
      b.out = 2;
      Object.assign(b.pos, MOUTH);
      Object.assign(b.vel, { x: -30, y: 15, z: 0 });
      b.h = Math.PI;
      b.brain.result = true;
      return true;
    }
    if (c.dir < 0 && c.s <= 0) {
      b.out = 0;
      b.face = c.face;
      b.u = DOOR.u;
      b.v = DOOR.v;
      b.h = 0;
      b.vel.x = b.vel.y = b.vel.z = 0;
      this.place(b);
      b.brain.result = true;
      return true;
    }
    b.h = tubeAt(c.s, c.face, ((b.id * 0.381966) % 1) * 2 - 1, b.pos) + (c.dir < 0 ? Math.PI : 0);
    return false;
  }

  private nodeOf(b: Bee): number {
    const n = nodeAt(b.u, b.v);
    return n < 0 ? -1 : b.face * NODES + n;
  }

  // ---- 要找的巢房 ----

  private isHungryLarva = (c: number) => this.comb.content[c] === CELL.larva && this.comb.amount[c] < C.hungry;
  private isDirty = (c: number) => this.comb.content[c] === CELL.empty && this.comb.amount[c] > 0 && this.comb.build[cellSite(c)] >= 1;
  private isLayable = (c: number) => this.comb.layable(c) && (this.droneOk || !this.comb.drone[cellSite(c)]);
  private isOpenFood = (c: number) => {
    const k = this.comb.content[c];
    return (k === CELL.nectar || k === CELL.honey) && this.comb.amount[c] > 0.01;
  };
  /** 封盖蜜也算：没开着的蜜房在身边时就咬开一个，免得一群蜂挤着去少数几个开着的房 */
  private isFood = (c: number) => this.isOpenFood(c) || this.comb.content[c] === CELL.cappedHoney;
  private isPollen = (c: number) => this.comb.content[c] === CELL.pollen && this.comb.amount[c] > 0.01;
  private isRipe = (c: number) => this.comb.content[c] === CELL.nectar || (this.comb.content[c] === CELL.honey && this.comb.amount[c] >= C.capAt);
  /** 放花蜜：育儿区上面没装满的蜜房，或者清理过的空房 */
  private isStore = (c: number) => {
    const s = cellSite(c);
    const k = this.comb.content[c];
    return this.comb.build[s] >= 1 && (((k === CELL.nectar || k === CELL.honey) && this.comb.amount[c] < C.capAt) || (k === CELL.empty && this.comb.amount[c] <= 0 && ZONE[s] === 2));
  };
  /** 放花粉：育儿区外面一圈没装满的粉房或空房 */
  private isPollenStore = (c: number) => {
    const s = cellSite(c);
    const k = this.comb.content[c];
    return this.comb.build[s] >= 1 && ((k === CELL.pollen && this.comb.amount[c] < C.capAt) || (k === CELL.empty && this.comb.amount[c] <= 0 && ZONE[s] === 1));
  };
  private isFrontier = (c: number) => {
    const b = this.comb.build[cellSite(c)];
    return b > 0 && b < 1;
  };

  private field(key: FieldKey): Field {
    const f = this.fields[key];
    const now = this.now();
    const every = key === 'entrance' ? Infinity : C.refresh[key];
    if (f.shape !== this.map.shape || now - f.at >= every) f.compute(this.map, this.sources(key), now);
    return f;
  }

  private *sources(key: FieldKey): Generator<number> {
    const cb = this.comb;
    if (key === 'entrance') {
      for (let n = 0; n < NODES; n++) {
        const u = nodeU(n);
        const v = nodeV(n);
        if (u < 0 && Math.abs(v - 3) < 1) {
          yield n;
          yield n + NODES;
        }
      }
      return;
    }
    if (key === 'layable') {
      let drones = 0;
      for (let c = 0; c < CELLS; c++) if (cb.drone[cellSite(c)] && cb.content[c] >= CELL.egg && cb.content[c] <= CELL.capped) drones++;
      this.droneOk = drones < C.droneBrood;
      // 蜂王在育儿区里找空房，育儿区里没有了才去别处
      const O = CONFIG.opening.brood;
      let found = 0;
      for (let c = 0; c < CELLS; c++) {
        const s = cellSite(c);
        if (this.isLayable(c) && Math.hypot((siteU(s) - O.u) / (O.ru * C.queen), (siteV(s) - O.v) / (O.rv * C.queen)) < 1) {
          found++;
          yield cellNode(c);
        }
      }
      if (found) return;
    }
    const want = {
      larvae: this.isHungryLarva,
      dirty: this.isDirty,
      layable: this.isLayable,
      food: this.isFood,
      pollen: this.isPollen,
      ripen: this.isRipe,
      frontier: this.isFrontier,
      store: this.isStore,
      pollenStore: this.isPollenStore,
    }[key];
    for (let c = 0; c < CELLS; c++) if (want(c)) yield cellNode(c);
  }

  /** 身边 r 以内、同一面上满足 want 的最近的巢房；没停着蜂的优先 */
  private findNear(b: Bee, want: (c: number) => boolean, r = 1.2): number {
    let free = -1;
    let freeD = r * r;
    let any = -1;
    let anyD = r * r;
    const base = b.face * SITES;
    for (let frame = 0; frame < 2; frame++) {
      const y = b.v - frame * GRID.frameStep - GRID.y0;
      const r0 = Math.max(0, Math.floor((y - r) / GRID.rowH));
      const r1 = Math.min(GRID.rows - 1, Math.ceil((y + r) / GRID.rowH));
      const c0 = Math.max(0, Math.floor((b.u - GRID.x0 - r) / P) - 1);
      const c1 = Math.min(GRID.cols - 1, Math.ceil((b.u - GRID.x0 + r) / P));
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          const s = (frame * GRID.rows + row) * GRID.cols + col;
          const du = siteU(s) - b.u;
          const dv = siteV(s) - b.v;
          const d = du * du + dv * dv;
          if (d >= anyD && d >= freeD) continue;
          if (!want(base + s)) continue;
          const m = cellNode(base + s);
          if (this.occ[m] === 0 || m === b.parked) {
            if (d < freeD) {
              freeD = d;
              free = base + s;
            }
          } else if (d < anyD) {
            anyD = d;
            any = base + s;
          }
        }
    }
    return free >= 0 ? free : any;
  }

  // ---- 任务 ----

  private *task(b: Bee): Routine {
    if (b.out) return yield* this.comeHome(b);
    if (b.caste === CASTE.queen) return yield* this.queenTask(b);
    if (b.crop < B.hungry) return yield* this.eat(b);
    if (b.caste === CASTE.drone) return yield* this.idle(b, 0.6);
    switch (roleOf(b)) {
      case 'cleaner':
        return yield* this.clean(b);
      case 'nurse':
        return yield* this.nurse(b);
      case 'house':
        return yield* this.house(b);
      case 'guard':
        if (this.rng.chance(C.guards)) {
          b.act = 'guard';
          if ((yield { k: 'go', f: 'entrance', near: this.rng.int(2, 14), t: 90 }) as boolean) yield { k: 'rest', t: this.rng.range(10, 20) };
          else yield* this.idle(b);
          return;
        }
        return yield* this.wait(b);
      default:
        return yield* this.forage(b);
    }
  }

  /** 采集蜂：带着东西先放下；认得开着的花丛就出巢去采，不认得的有时去侦察，其余在巢里等 */
  private *forage(b: Bee): Routine {
    if (b.load > 0) return yield* this.unload(b);
    const p = this.pickPatch(b);
    if (!p) return yield* this.wait(b);
    if (b.crop < F.depart) return yield* this.eat(b);
    b.act = 'leave';
    if (!((yield { k: 'go', f: 'entrance', near: 0, t: 120 }) as boolean)) return yield* this.idle(b);
    if (!((yield { k: 'tube', dir: 1, s: 0, face: b.face, t: 10 }) as boolean)) return yield* this.idle(b);
    b.act = 'flyOut';
    yield { k: 'fly', ...DEPART, r: 15, v: F.speed, stop: false, t: 30 };
    yield* this.gather(b, p);
    // 回巢由 task 开头的 comeHome 接着做（读档后也一样）
  }

  /** 认得的花丛开着就去；不认得（或认得的合上了，有时）就挑一片开着的去侦察；goods 0 是花蜜，1 起是花粉（颜色 + 1） */
  private pickPatch(b: Bee): FlowerPatch | null {
    const hour = this.env.hour();
    const open = (p: FlowerPatch) => openness(SPECIES[p.species], hour) >= F.minOpen;
    if (b.patch >= 0) {
      const p = this.env.flowers.get(b.patch);
      if (p && open(p)) return p;
      if (p && !this.rng.chance(F.scout / 2)) return null;
      b.patch = -1;
    }
    if (!this.rng.chance(F.scout)) return null;
    const list = this.env.flowers.patches.filter(open);
    if (!list.length) return null;
    const p = list[this.rng.int(0, list.length - 1)];
    const sp = SPECIES[p.species];
    const pollen = sp.nectar <= 0 || (sp.pollen > 0 && this.rng.chance(F.pollenShare));
    b.patch = p.id;
    b.goods = pollen ? sp.pollenKind + 1 : 0;
    return p;
  }

  /** 在花丛里一朵朵地采，带满一份或接连采不到就停；带得太少就不再来这片 */
  private *gather(b: Bee, p: FlowerPatch): Routine {
    const sp = SPECIES[p.species];
    const what = b.goods ? 'pollen' : 'nectar';
    const per = b.goods ? sp.pollen : sp.nectar;
    let i = this.rng.int(0, plantCount(p) - 1);
    let misses = 0;
    for (let k = 0; k < F.visits && b.load < 0.999; k++) {
      const L = landingPoint(p, i, this.rng.int(0, sp.land.length - 1), this.env.ground, { x: 0, y: 0, z: 0 });
      b.act = k === 0 ? 'flyOut' : b.goods ? 'gatherPollen' : 'sipNectar';
      if (!((yield { k: 'fly', ...L, r: 0.5, v: k === 0 ? F.speed : F.hop, stop: true, t: k === 0 ? 120 : 20 }) as boolean)) break;
      Object.assign(b.pos, L);
      b.act = b.goods ? 'gatherPollen' : 'sipNectar';
      yield { k: 'sip', t: this.rng.range(F.visit[0], F.visit[1]) };
      const want = Math.min(1 - b.load, per);
      const got = this.env.flowers.take(p, what, want, this.env.hour());
      b.load += got;
      misses = got < want * 0.2 ? misses + 1 : 0;
      if (misses >= 3) break;
      i = this.nextPlant(p, i);
    }
    if (b.load < F.keep) b.patch = -1;
    // 有的采集蜂回不来了（鸟、蜘蛛、迷路）：下一步按老死处理
    if (this.rng.chance(F.risk)) {
      b.life = b.age;
      this.lost++;
    }
  }

  /** 下一株：随便看几株，挑最近的 */
  private nextPlant(p: FlowerPatch, i: number): number {
    const pl = plantsOf(p);
    const n = pl.length / 3;
    let best = i;
    let bestD = Infinity;
    for (let k = 0; k < 4; k++) {
      const j = this.rng.int(0, n - 1);
      const d = Math.hypot(pl[j * 3] - pl[i * 3], pl[j * 3 + 1] - pl[i * 3 + 1]);
      if (j !== i && d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  /** 飞回巢门、走进巢里。从远处来的先绕到蜂箱巢门那一侧，不穿过箱子；实在飞不到管口就直接落在那儿 */
  private *comeHome(b: Bee): Routine {
    if (b.out >= 2) {
      b.act = 'flyHome';
      if (Math.hypot(b.pos.x - DOCK.x, b.pos.z - DOCK.z) > 60) yield { k: 'fly', ...APPROACH, r: 15, v: F.speed, stop: false, t: 120 };
      yield { k: 'fly', ...DOCK, r: 2, v: F.hop, stop: true, t: 30 };
      if (!((yield { k: 'fly', ...MOUTH, r: 0.8, v: F.hop, stop: true, t: 20 }) as boolean)) Object.assign(b.pos, MOUTH);
    }
    b.act = 'enter';
    yield { k: 'tube', dir: -1, s: TUBE_LEN, face: this.rng.int(0, 1), t: 60 };
    if (b.load > 0) this.trips++;
  }

  /** 把带回来的花蜜、花粉放进巢房；放不下就带着，过一会再找 */
  private *unload(b: Bee): Routine {
    const pollen = b.goods > 0;
    const cell = yield* this.seek(b, pollen ? 'pollenStore' : 'store', pollen ? this.isPollenStore : this.isStore, pollen ? 'goPack' : 'goStore');
    if (cell < 0) return yield* this.idle(b);
    yield* this.work(b, cell, pollen ? 'packPollen' : 'storeNectar', F.unload);
    const unit = pollen ? F.pollenLoad : F.nectarLoad;
    const put = pollen ? this.comb.addPollen(cell, b.load * unit, b.goods - 1) : this.comb.addNectar(cell, b.load * unit);
    if (pollen) this.pollenIn += put;
    else this.nectarIn += put;
    b.load -= put / unit;
    if (b.load < 0.05) b.load = 0;
  }

  /** 守卫日龄还没站岗的蜂、等出巢的采集蜂：在巢里歇着、转转 */
  private *wait(b: Bee): Routine {
    if (this.rng.chance(0.2)) {
      b.act = 'wander';
      yield { k: 'wander', t: this.rng.range(3, 8) };
    } else {
      b.act = 'wait';
      yield { k: 'rest', t: this.rng.range(15, 40) };
    }
  }

  /** 先看身边，没有就沿路程场找过去，再走到巢房口；找不到返回 -1 */
  private *seek(b: Bee, key: FieldKey, want: (c: number) => boolean, act: Act, prefer = want): Generator<Cmd, number, unknown> {
    let cell = this.findNear(b, prefer, 2);
    if (cell < 0 && prefer !== want) cell = this.findNear(b, want);
    if (cell < 0) {
      b.act = act;
      // 源头那几格常停着蜂，走到离它两步（斜着约 1.4 cm）就改看身边
      if (!((yield { k: 'go', f: key, near: 2, t: 90 }) as boolean)) return -1;
      cell = this.findNear(b, prefer, 2.4);
      if (cell < 0 && prefer !== want) cell = this.findNear(b, want, 2.4);
      if (cell < 0) return -1;
    }
    b.act = act;
    return ((yield { k: 'to', cell, t: 6 }) as boolean) ? cell : -1;
  }

  private *idle(b: Bee, wander = 0.3): Routine {
    if (this.rng.chance(wander)) {
      b.act = 'wander';
      yield { k: 'wander', t: this.rng.range(2, 6) };
    } else {
      b.act = 'rest';
      yield { k: 'rest', t: this.rng.range(B.restTime[0], B.restTime[1]) };
    }
  }

  private *maybeRest(b: Bee): Routine {
    if (!this.rng.chance(B.rest)) return;
    b.act = 'rest';
    yield { k: 'rest', t: this.rng.range(B.restTime[0], B.restTime[1]) };
  }

  private *work(b: Bee, cell: number, act: Act, t: number): Routine {
    b.act = act;
    yield { k: 'work', cell, t };
  }

  private *eat(b: Bee): Routine {
    const cell = yield* this.seek(b, 'food', this.isFood, 'goEat', this.isOpenFood);
    if (cell < 0) return yield* this.idle(b, 0.8);
    yield* this.work(b, cell, 'eat', C.work.eat);
    b.crop = Math.min(1, b.crop + this.comb.takeHoney(cell, (1 - b.crop) * B.meal) / B.meal);
  }

  private *queenTask(b: Bee): Routine {
    const cell = yield* this.seek(b, 'layable', this.isLayable, 'seek');
    if (cell < 0) return yield* this.idle(b, 0.8);
    yield* this.work(b, cell, 'inspect', C.inspect);
    if (!this.isLayable(cell)) return;
    yield* this.work(b, cell, 'lay', C.lay);
    if (!this.isLayable(cell)) return;
    this.comb.layEgg(cell);
    this.laid++;
    if (this.rng.chance(C.queenRest)) yield* this.idle(b, 0);
  }

  private *clean(b: Bee): Routine {
    const cell = yield* this.seek(b, 'dirty', this.isDirty, 'goClean');
    if (cell < 0) return yield* this.idle(b);
    yield* this.work(b, cell, 'clean', C.work.clean);
    if (this.isDirty(cell)) this.comb.clean(cell);
    yield* this.maybeRest(b);
  }

  private *nurse(b: Bee): Routine {
    if (b.jelly <= 0) {
      const cell = yield* this.seek(b, 'pollen', this.isPollen, 'goPollen');
      if (cell < 0) return yield* this.idle(b);
      yield* this.work(b, cell, 'pollen', C.work.pollen);
      b.jelly += (this.comb.takePollen(cell, C.pollenMeal) / C.pollenMeal) * C.feeds;
      return;
    }
    const cell = yield* this.seek(b, 'larvae', this.isHungryLarva, 'goFeed');
    if (cell < 0) return yield* this.idle(b);
    yield* this.work(b, cell, 'feed', C.work.feed);
    if (!this.isHungryLarva(cell)) return;
    this.comb.feed(cell);
    b.jelly -= 1;
    yield* this.maybeRest(b);
  }

  private *house(b: Bee): Routine {
    const build = this.rng.chance(C.builders);
    if (build) {
      const cell = yield* this.seek(b, 'frontier', this.isFrontier, 'goBuild');
      if (cell >= 0) {
        yield* this.work(b, cell, 'build', C.work.build);
        this.comb.buildUp(cellSite(cell), C.build, C.start);
        b.crop = Math.max(0, b.crop - C.buildCost);
        return yield* this.maybeRest(b);
      }
    }
    const cell = yield* this.seek(b, 'ripen', this.isRipe, 'goRipen');
    if (cell < 0) return yield* this.idle(b);
    if (this.comb.content[cell] === CELL.nectar) {
      yield* this.work(b, cell, 'ripen', C.work.ripen);
      this.comb.ripen(cell, C.ripen);
    } else {
      yield* this.work(b, cell, 'cap', C.work.cap);
      if (this.isRipe(cell)) this.comb.cap(cell);
    }
    yield* this.maybeRest(b);
  }

  toSave(): BeesSave {
    return {
      bees: this.list.map((b) => {
        const c = b.brain.cmd;
        const p = b.pos;
        const v = b.vel;
        return [
          ...[b.id, b.caste, r4(b.age), r4(b.life), b.face, r4(b.u), r4(b.v), r4(b.h), r4(b.crop), r4(b.jelly), r4(b.wrap), r4(b.wn), r4(b.fast)],
          ...[b.act, c ? { ...c, t: r4(c.t) } : null, b.brain.started ? 1 : 0],
          // 巢脾上的蜂位置由 u、v 算出来，不存
          ...[b.out, ...(b.out ? [r4(p.x), r4(p.y), r4(p.z), r4(v.x), r4(v.y), r4(v.z)] : [0, 0, 0, 0, 0, 0]), b.patch, b.goods, r4(b.load)],
        ] as BeeSave;
      }),
      trips: this.trips,
      lost: this.lost,
      nectarIn: r4(this.nectarIn),
      pollenIn: r4(this.pollenIn),
      births: this.births,
      deaths: this.deaths,
      laid: this.laid,
      starved: this.starved,
      hungry: this.hungry,
    };
  }

  restore(d: BeesSave): void {
    this.list.length = 0;
    this.byId.clear();
    this.occ.fill(0);
    for (const [id, caste, age, life, face, u, v, h, crop, jelly, wrap, wn, fast, act, cmd, started, out, x, y, z, vx, vy, vz, patch, goods, load] of d.bees) {
      const b = this.add(caste, age, life, id);
      Object.assign(b, { face, u, v, h, crop, jelly, wrap, wn, fast, act, out, patch, goods, load });
      Object.assign(b.pos, { x, y, z });
      Object.assign(b.vel, { x: vx, y: vy, z: vz });
      if (cmd) b.brain.resume({ ...cmd }, started === 1);
      this.place(b);
      Object.assign(b.prev, b.pos);
    }
    this.trips = d.trips;
    this.lost = d.lost;
    this.nectarIn = d.nectarIn;
    this.pollenIn = d.pollenIn;
    this.births = d.births;
    this.deaths = d.deaths;
    this.laid = d.laid;
    this.starved = d.starved;
    this.hungry = d.hungry;
    for (const f of Object.values(this.fields)) f.at = -Infinity;
  }
}

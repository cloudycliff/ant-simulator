import { Behavior, type Routine as CoreRoutine } from '../../../core/sim/behavior';
import type { IdPool } from '../../../core/sim/ids';
import { turnToward } from '../../../core/move/surface';
import type { Point3 } from '../../../core/sim/events';
import { TAU, clamp, wrapAngle } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import { CELL, CELLS, GRID, SITES, cellFace, cellSite, siteU, siteV, type Comb } from './comb';
import { APPROACH, DEPART, DOCK, DOOR, MOUTH, TUBE_LEN, steer, tubeAt } from './flight';
import { landingPoint, patchOpenness, plantCount, plantsOf, type FlowerPatch, type Flowers } from './flowers';
import { Field, NODES, WalkMap, cellNode, nodeAt, nodeU, nodeV } from './walk';
import { HEAT, heatAt, type Heat } from './heat';

const B = CONFIG.bees;
const C = CONFIG.care;
const H = CONFIG.hive;
const P = CONFIG.cell.pitch;
const F = CONFIG.forage;
const D = CONFIG.dance;
const S = CONFIG.shift;
const SPECIES = CONFIG.flowers.species;
const HT = CONFIG.heat;
const HN = CONFIG.hornets;
/** 每个走路格在哪个温度格 */
const NODE_HEAT = (() => {
  const a = new Int16Array(NODES);
  for (let n = 0; n < NODES; n++) a[n] = heatAt(nodeU(n), nodeV(n));
  return a;
})();

/** 每个位置离所在那框框梁中间多远（按框的半宽、高度归一化的椭圆半径），补巢脾时先补小的 */
const REPAIR_K = (() => {
  const a = new Float32Array(SITES);
  for (let s = 0; s < SITES; s++) {
    const top = (s >= GRID.rows * GRID.cols ? GRID.frameStep : 0) + H.frameH;
    a[s] = Math.hypot((siteU(s) - H.combW / 2) / (H.combW / 2), (top - siteV(s)) / H.frameH);
  }
  return a;
})();

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
  'scout',
  'watch',
  'followDance',
  'flyAim',
  'search',
  'dance',
  'roundDance',
  'tremble',
  'offer',
  'giveNectar',
  'goReceive',
  'receive',
  'takeNectar',
  'goHeat',
  'heat',
  'goFan',
  'fan',
  'shimmer',
  'goBall',
  'ball',
] as const;
export type Act = (typeof ACTS)[number];

/** 要去的地方各有一张路程场 */
const FIELD_KEYS = ['larvae', 'dirty', 'layable', 'food', 'pollen', 'ripen', 'frontier', 'store', 'pollenStore', 'entrance', 'floor', 'cold'] as const;
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
  | { k: 'sip'; t: number }
  /** 在舞场停着看舞；结果是看见的跳舞蜂的编号，没看见是 -1 */
  | { k: 'watch'; t: number }
  /** 跟在跳舞的蜂身后：seen 是跟上了几圈，last 是上一步那支舞还剩几圈；跟够了读出舞里说的地方（Bee.aim） */
  | { k: 'follow'; id: number; seen: number; last: number; t: number }
  | DanceCmd
  /** 颤抖舞：慢慢走、抖身子 */
  | { k: 'tremble'; t: number }
  /** 在巢门附近边走边找接蜜的内勤蜂；结果是找没找到（找到的记在两边的 partner） */
  | { k: 'offer'; t: number }
  /** 走到 partner 跟前；把花蜜交给 partner */
  | { k: 'meet'; t: number }
  | { k: 'give'; t: number }
  /** 内勤蜂停着等采集蜂来交花蜜；结果是接没接到 */
  | { k: 'receive'; t: number }
  /** 停在子脾上振翅产热；停在巢门边背着巢门扇风 */
  | { k: 'heat'; t: number }
  | { k: 'fan'; t: number }
  /** 飞到胡蜂 id 的热球上第 i 个位置，围着它振翅产热，胡蜂死了就散 */
  | { k: 'ball'; id: number; i: number; t: number };
/** 跳舞：中心 (cu, cv)，摆动的方向 a（巢面里的角度），摆动段 w 秒、长 len cm（w 为 0 是圆舞）；还剩 n 圈，这一圈过了 ph 秒 */
export type DanceCmd = { k: 'dance'; cu: number; cv: number; a: number; w: number; len: number; n: number; ph: number };
type Routine = CoreRoutine<Cmd>;

/**
 * 跟舞读出来的地方：(x, z) 附近 r 以内找开着的花丛，sp 种的花闻得出来、优先；goods 采什么。
 * patch 是跳舞的蜂真去的那片，只用来统计招募准不准，蜂自己不知道
 */
export interface Aim {
  /** 读出来的模拟时刻，过了 aimLife 秒还没飞出去就忘了 */
  at: number;
  x: number;
  z: number;
  r: number;
  sp: number;
  goods: number;
  patch: number;
}

/** 绕过巢脾边时离边多远（cm） */
const WRAP_R = 0.45;
/** 前面走不通时依次试着偏开的角度 */
const DODGE = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5];
/** 圆舞绕的圈的半径（cm） */
export const ROUND_R = 0.5;
/** 找跳舞的地方：先试脚下，再往巢脾里面挪（cm） */
const SPOTS = [[0, 0]];
for (let r = 0.5; r <= 3; r += 0.5) for (let k = 0; k < 8; k++) SPOTS.push([Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r]);
/** 查舞场站不站得下时看的一圈方向 */
const RING = Array.from({ length: 12 }, (_, k) => [Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)]);

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
  /** 分工看的日龄：平时和日龄一起长，蜂群缺哪种蜂时长得快慢不同，缺哺育蜂时内勤蜂会退回去（T-015） */
  dev = 0;
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
  /** 交接的另一方（采集蜂和接蜜的内勤蜂互相记着，-1 没有） */
  partner = -1;
  /** 这一趟回来找接蜜的蜂等了多久、带回来多少（份），跳不跳舞看它们 */
  waited = 0;
  haul = 0;
  /** 跟舞读出来、还没去的地方 */
  aim: Aim | null = null;
  /** 只给画面：这一步在摆动（1）、颤抖或抖翅（2）还是振翅产热（3） */
  waggle = 0;
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

/** 分工看的日龄 t 对应第几种工作（ROLE_KEYS 的编号） */
function roleIndex(t: number): number {
  const R = B.roles;
  return t < R.nurse ? 0 : t < R.house ? 1 : t < R.guard ? 2 : t < R.forager ? 3 : 4;
}

/** 工蜂现在的分工；雄蜂、蜂王没有 */
export function roleOf(b: Bee): RoleKey | null {
  return b.caste === CASTE.worker ? ROLE_KEYS[roleIndex(b.dev)] : null;
}

/** 工蜂按日龄本该做的；和 roleOf 不一样就是按蜂群的需要提前或推后了 */
export function ageRoleOf(b: Bee): RoleKey | null {
  return b.caste === CASTE.worker ? ROLE_KEYS[roleIndex(b.age)] : null;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

type BeeSave = [
  ...[id: number, caste: number, age: number, life: number, face: number, u: number, v: number, h: number, crop: number, jelly: number, wrap: number, wn: number, fast: number],
  ...[act: Act, cmd: Cmd | null, started: number],
  ...[out: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, patch: number, goods: number, load: number],
  ...[partner: number, waited: number, haul: number, aim: number[] | null, dev: number],
];
export interface BeesSave {
  bees: BeeSave[];
  trips: number;
  lost: number;
  nectarIn: number;
  pollenIn: number;
  dances: number;
  recruits: number;
  arrived: number;
  hits: number;
  handoffs: number;
  selfStored: number;
  trembles: number;
  tremble: number;
  pollenNeed: number;
  honeyNeed: number;
  pace: number[];
  reverted: number;
  needAt: number;
  births: number;
  deaths: number;
  laid: number;
  starved: number;
  hungry: number;
  coldNeed: number;
  hotNeed: number;
}

/** 蜂在巢外要知道的：花丛、此刻几点、太阳的方位（atan2(z, x)）、地面多高；天气能不能出巢、在外面的蜂每秒往回飞的机会 */
export interface BeeEnv {
  flowers: Flowers;
  hour: () => number;
  sun: () => number;
  ground: (x: number, z: number) => number;
  flyable: () => boolean;
  recall: () => number;
  heat: Heat;
  /** 胡蜂（T-022）：巢门外有没有、采集蜂不敢出去的机会、管口装没装防护片、热球的中心 */
  hornets: { threat(): boolean; danger(): number; plate(): boolean; ballAt(id: number): Point3 | null };
  /** 开箱后蜂躁动的程度（0..1，T-023） */
  alarm(): number;
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
  /** 跳过的舞；跟舞读出地方的蜂、飞到地方的、找到的正是舞里那片花的 */
  dances = 0;
  recruits = 0;
  arrived = 0;
  hits = 0;
  /** 花蜜交给内勤蜂的次数、等不到自己放的次数、颤抖舞 */
  handoffs = 0;
  selfStored = 0;
  trembles = 0;
  /** 颤抖舞的余波：内勤蜂去接蜜的机会多这么多，慢慢衰减 */
  tremble = 0;
  /** 缺粉程度 0..1，每 10 秒按储粉算一次 */
  pollenNeed = 0.5;
  /** 缺蜜程度 0..1，储蜜在 honeyTarget 时是 0.5；也是每 10 秒算一次 */
  honeyNeed = 0.5;
  /** 子脾冷、热的程度 0..1（冷的、热的子占多少），也是每 10 秒算一次（T-021） */
  coldNeed = 0;
  hotNeed = 0;
  /** 每种分工的蜂分工日龄长得多快（按 ROLE_KEYS），和缺蜜、缺粉一起算 */
  pace = ROLE_KEYS.map(() => 1);
  /** 缺哺育蜂时退回去哺育的内勤蜂、守卫 */
  reverted = 0;
  /** 这一步开头在巢门抖翅的蜂；巢门外有胡蜂 */
  shimmering = 0;
  private threat = false;
  private needAt = 0;
  /** 这一步开头在跳舞的蜂、等着接蜜的内勤蜂 */
  private dancers: Bee[] = [];
  private receivers: Bee[] = [];
  /** 这一步开头在巢外的蜂（管里、飞着、在花上） */
  private outside = 0;
  private byId = new Map<number, Bee>();
  private fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, new Field(k === 'entrance' || k === 'floor')])) as Record<FieldKey, Field>;
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
      if (roleOf(b) === 'forager' && rng.chance(F.known)) {
        const P = this.env.flowers.patches;
        this.adopt(b, P[rng.int(0, P.length - 1)], rng.chance(F.pollenShare / 2));
      }
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
    b.dev = age;
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

  /**
   * 割蜜、换框以后脚下没有巢脾的蜂挪到还在的巢脾上，手里的活作废：换框时是那一框上的蜂（frame），
   * 割蜜时挪到 (u, v) 附近 keeper.scatter 以内
   */
  dislodge(frame: number, u = NaN, v = NaN): void {
    this.map.sync(this.comb);
    const r = CONFIG.keeper.scatter;
    for (const b of this.list) {
      if (b.out || !b.alive) continue;
      const onFrame = frame >= 0 && (frame ? b.v > H.frameH + H.bar : b.v < H.frameH);
      if (!onFrame && this.map.ok(b.u, b.v)) continue;
      this.unpark(b);
      b.wrap = 0;
      this.placeAt(b, frame >= 0 ? (n, _f, nv) => this.map.walk[n] === 1 && (frame ? nv < H.frameH : nv > H.frameH + H.bar) : (_n, _f, nv, nu) => Math.hypot(nu - u, nv - v) < r);
      b.brain.start(this.idle(b, 0.8));
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
    this.syncRepair();
    this.dt = dt;
    this.dancers.length = 0;
    this.receivers.length = 0;
    this.outside = 0;
    this.shimmering = 0;
    this.threat = this.env.hornets.threat();
    for (const b of this.list) {
      if (b.out) this.outside++;
      if (b.act === 'shimmer') this.shimmering++;
      const k = b.brain.cmd?.k;
      if (k === 'dance') this.dancers.push(b);
      else if (k === 'receive' && b.partner < 0) this.receivers.push(b);
    }
    this.tremble *= Math.exp(-dt / D.trembleDecay);
    if (this.now() >= this.needAt) {
      this.needAt = this.now() + S.every;
      this.assess();
    }
    let dead = 0;
    const recall = this.env.recall() * dt;
    for (const b of this.list) {
      b.waggle = 0;
      b.prev.x = b.pos.x;
      b.prev.y = b.pos.y;
      b.prev.z = b.pos.z;
      b.age += dt;
      if (b.caste === CASTE.worker) b.dev += dt * this.pace[roleIndex(b.dev)];
      if (b.caste !== CASTE.queen) {
        b.crop = Math.max(0, b.crop - dt / (b.out === 2 ? F.flyBurn : b.caste === CASTE.drone ? B.droneBurn : B.burn));
        b.fast = b.crop > 0 ? 0 : b.fast + dt;
      }
      if (b.age >= b.life || b.fast > B.starve) {
        if (b.fast > B.starve) this.hungry++;
        b.alive = false;
        this.unpark(b);
        this.release(b);
        dead++;
        continue;
      }
      // 要下雨了：飞着的、停在花上的蜂丢下手里的活往回飞
      if (recall > 0 && b.out >= 2 && b.act !== 'flyHome' && b.act !== 'ball' && this.rng.chance(recall)) b.brain.start(this.comeHome(b));
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

  /**
   * 看看蜂群缺什么：缺粉、缺蜜的程度；每只哺育蜂要照顾的幼虫多了，清理蜂提前去哺育、哺育蜂推后换工作，
   * 再多就有内勤蜂、守卫退回去哺育；采集蜂少了，内勤蜂、守卫提前去采集，多了推后
   */
  private assess(): void {
    const ht = this.env.heat;
    let cold = 0;
    let hot = 0;
    let all = 0;
    for (let i = 0; i < HEAT.n; i++) {
      const n = ht.brood[i];
      if (!n) continue;
      const t = ht.temp[i];
      all += n;
      cold += n * clamp((HT.ideal[0] - t) / 2, 0, 1);
      hot += n * clamp((t - HT.ideal[1]) / 2, 0, 1);
    }
    this.coldNeed = all ? r4(cold / all) : 0;
    this.hotNeed = all ? r4(hot / all) : 0;
    const c = this.comb.census();
    this.pollenNeed = clamp((D.pollenTarget - c.pollenCells) / (D.pollenTarget / 2), 0, 1);
    this.honeyNeed = clamp((D.honeyTarget - c.honeyCells) / D.honeySpan + 0.5, 0, 1);
    const n = ROLE_KEYS.map(() => 0);
    for (const b of this.list) if (b.caste === CASTE.worker) n[roleIndex(b.dev)]++;
    const workers = n.reduce((a, x) => a + x, 0);
    const load = c.counts.larva / Math.max(1, n[1] * S.perNurse);
    const share = n[4] / Math.max(1, workers);
    const pf = clamp(1 + (S.foragerGain * (S.foragers - share)) / S.foragers, S.pace[0], S.pace[1]);
    this.pace[0] = clamp(1 + S.nurseGain * Math.max(0, load - 1), S.pace[0], S.pace[1]);
    this.pace[1] = clamp(1 - S.nurseGain * (load - 1), S.pace[0], S.pace[1]);
    this.pace[2] = this.pace[3] = pf;
    this.pace[4] = 1;
    if (load <= S.revertAt) return;
    const k = Math.min(1, S.revert * (load - S.revertAt));
    for (const b of this.list) {
      const r = b.caste === CASTE.worker && !b.out && b.load <= 0 ? roleIndex(b.dev) : -1;
      if ((r !== 2 && r !== 3) || !this.rng.chance(k)) continue;
      b.dev = B.roles.house - this.rng.range(0, S.backTo);
      this.reverted++;
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
        // 守卫在巢门边：外面有胡蜂就一齐抖翅
        if (b.act === 'guard' || b.act === 'shimmer') {
          b.act = this.threat ? 'shimmer' : 'guard';
          if (this.threat) b.waggle = 2;
        }
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
        // 拉直的路的那一格有蜂站着就按格子走，否则会一直朝着它顶
        const v = f.via ? f.via[n] : m;
        const w = (v >= NODES) === (b.face === 1) && this.occ[v] === 0 ? v : m;
        this.walkTo(b, nodeU(w), nodeV(w), this.occ[m] > 0 || f.dist[n] <= c.near + 2);
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
      case 'heat':
      case 'fan': {
        this.settle(b);
        if (c.k === 'heat') b.waggle = 3;
        else b.h = turnToward(b.h, 0, B.turn, dt);
        // 焐热了、凉下来了就不用再待着
        const done = c.k === 'heat' ? this.env.heat.temp[heatAt(b.u, b.v)] >= HT.ideal[1] - 0.5 : this.hotNeed <= 0.01;
        if ((c.t -= dt) > 0 && !done) return false;
        this.unpark(b);
        return true;
      }
      case 'ball':
        return this.stepBall(b, c);
      case 'sip':
        b.out = 3;
        b.vel.x = b.vel.y = b.vel.z = 0;
        return (c.t -= dt) <= 0;
      case 'watch': {
        this.settle(b);
        const d = this.danceNear(b);
        if (!d && (c.t -= dt) > 0) return false;
        this.unpark(b);
        b.brain.result = d ? d.id : -1;
        return true;
      }
      case 'follow':
        return this.stepFollow(b, c);
      case 'dance':
        return this.stepDance(b, c);
      case 'tremble':
        b.waggle = 2;
        b.h += (this.rng.next() - 0.5) * 4 * dt;
        this.forward(b, this.speed(b) * 0.25 * dt);
        return (c.t -= dt) <= 0;
      case 'offer': {
        b.waited += dt;
        const r = this.receiverNear(b);
        if (r) {
          r.partner = b.id;
          b.partner = r.id;
          b.brain.result = true;
          return true;
        }
        if ((c.t -= dt) <= 0) {
          b.brain.result = false;
          return true;
        }
        // 边走边找，走远了往巢门那边回
        const f = this.field('entrance');
        const n = this.nodeOf(b);
        const m = n >= 0 && f.dist[n] > D.give[1] + 6 ? f.next(this.map, n, this.occ) : -1;
        if (m >= 0 && (m >= NODES) === (b.face === 1)) this.walkTo(b, nodeU(m), nodeV(m), true);
        else {
          b.h += (this.rng.next() - 0.5) * 6 * dt;
          this.forward(b, this.speed(b) * 0.6 * dt);
        }
        return false;
      }
      case 'meet': {
        b.waited += dt;
        const r = this.byId.get(b.partner);
        if (!r || r.partner !== b.id || r.face !== b.face || (c.t -= dt) <= 0) {
          this.release(b);
          b.brain.result = false;
          return true;
        }
        const du = r.u - b.u;
        const dv = r.v - b.v;
        if (du * du + dv * dv < 0.64) {
          b.brain.result = true;
          return true;
        }
        this.walkTo(b, r.u, r.v, true);
        return false;
      }
      case 'give': {
        const r = this.byId.get(b.partner);
        if (!r || r.partner !== b.id) {
          this.release(b);
          b.brain.result = false;
          return true;
        }
        b.h = turnToward(b.h, Math.atan2(r.v - b.v, r.u - b.u), B.turn, dt);
        if ((c.t -= dt) > 0) return false;
        r.load = b.load;
        r.goods = 0;
        b.load = 0;
        this.handoffs++;
        this.release(b);
        b.brain.result = true;
        return true;
      }
      case 'receive': {
        this.settle(b);
        if (b.load > 0) {
          this.unpark(b);
          b.brain.result = true;
          return true;
        }
        const f = b.partner >= 0 ? this.byId.get(b.partner) : undefined;
        if (f && f.partner === b.id) {
          // 采集蜂走过来、交接时一直等着，时限在它那边
          b.act = 'takeNectar';
          b.h = turnToward(b.h, Math.atan2(f.v - b.v, f.u - b.u), B.turn, dt);
          return false;
        }
        b.partner = -1;
        b.act = 'receive';
        if ((c.t -= dt) > 0) return false;
        this.unpark(b);
        b.brain.result = false;
        return true;
      }
    }
  }

  /** 解开交接的一对 */
  private release(b: Bee): void {
    if (b.partner < 0) return;
    const o = this.byId.get(b.partner);
    if (o && o.partner === b.id) o.partner = -1;
    b.partner = -1;
  }

  /** 身边 see 以内、同一面上最近的一支舞 */
  private danceNear(b: Bee): Bee | null {
    let best: Bee | null = null;
    let bestD = D.see * D.see;
    for (const d of this.dancers) {
      if (d === b || d.face !== b.face || !d.alive || d.brain.cmd?.k !== 'dance') continue;
      const dd = (d.u - b.u) ** 2 + (d.v - b.v) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  /** 身边 see 以内、同一面上还没接别人花蜜的内勤蜂 */
  private receiverNear(b: Bee): Bee | null {
    let best: Bee | null = null;
    let bestD = D.see * D.see;
    for (const r of this.receivers) {
      if (r.partner >= 0 || r.face !== b.face || !r.alive || r.load > 0 || r.brain.cmd?.k !== 'receive') continue;
      const dd = (r.u - b.u) ** 2 + (r.v - b.v) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = r;
      }
    }
    return best;
  }

  /** 跟舞：贴在跳舞的蜂身后一侧，它每跳完一圈时贴得够近就算跟上一圈 */
  private stepFollow(b: Bee, c: Extract<Cmd, { k: 'follow' }>): boolean {
    const d = this.byId.get(c.id);
    const dc = d?.brain.cmd;
    if (!d || !d.alive || dc?.k !== 'dance' || d.face !== b.face || (c.t -= this.dt) <= 0) {
      b.brain.result = false;
      return true;
    }
    const close = (d.u - b.u) ** 2 + (d.v - b.v) ** 2 < 1.44;
    if (dc.n !== c.last) {
      if (close && c.last >= 0) c.seen++;
      c.last = dc.n;
    }
    if (c.seen >= D.follow) {
      b.aim = this.decode(d, dc);
      this.recruits++;
      b.brain.result = true;
      return true;
    }
    const side = b.id & 1 ? 1 : -1;
    const a = d.h + Math.PI + side * (0.4 + ((b.id * 0.618034) % 1) * 0.8);
    const tu = d.u + Math.cos(a) * 0.6;
    const tv = d.v + Math.sin(a) * 0.6;
    if ((tu - b.u) ** 2 + (tv - b.v) ** 2 > 0.04) this.walkTo(b, tu, tv, true);
    else b.h = Math.atan2(d.v - b.v, d.u - b.u);
    return false;
  }

  /** 把舞读成花园里的地方：摆动方向和竖直向上的夹角就是花丛和太阳的夹角，摆得越久越远；圆舞只说“就在附近” */
  private decode(d: Bee, dc: DanceCmd): Aim {
    const sp = this.env.flowers.get(d.patch)?.species ?? -1;
    const at = this.now();
    if (dc.w <= 0) return { at, x: MOUTH.x, z: MOUTH.z, r: D.round, sp, goods: d.goods, patch: d.patch };
    const du = Math.cos(dc.a);
    const th = Math.atan2(d.face ? -du : du, Math.sin(dc.a));
    const bearing = this.env.sun() + th + this.rng.gauss(0, D.angleNoise);
    const dist = ((dc.w - D.w0) / D.perM) * 100 * (1 + this.rng.gauss(0, D.distNoise));
    return { at, x: MOUTH.x + Math.cos(bearing) * dist, z: MOUTH.z + Math.sin(bearing) * dist, r: D.search, sp, goods: d.goods, patch: d.patch };
  }

  /** 跳舞：摆动段走直线、身子左右摆，回转时左右两边轮流绕半圈回到起点；圆舞左右轮流绕小圈 */
  private stepDance(b: Bee, c: DanceCmd): boolean {
    this.unpark(b);
    const side = c.n % 2 ? 1 : -1;
    let u: number;
    let v: number;
    let h: number;
    let period: number;
    if (c.w > 0) {
      const eu = Math.cos(c.a);
      const ev = Math.sin(c.a);
      const half = c.len / 2;
      const back = (Math.PI * half) / D.turn;
      period = c.w + back;
      if (c.ph < c.w) {
        const k = c.ph / c.w - 0.5;
        u = c.cu + eu * c.len * k;
        v = c.cv + ev * c.len * k;
        h = c.a;
        b.waggle = 1;
      } else {
        const phi = (Math.min(c.ph - c.w, back) / back) * Math.PI;
        const pu = -ev * side;
        const pv = eu * side;
        u = c.cu + eu * half * Math.cos(phi) + pu * half * Math.sin(phi);
        v = c.cv + ev * half * Math.cos(phi) + pv * half * Math.sin(phi);
        h = Math.atan2(-ev * Math.sin(phi) + pv * Math.cos(phi), -eu * Math.sin(phi) + pu * Math.cos(phi));
      }
    } else {
      period = (2 * Math.PI * ROUND_R) / D.turn;
      const phi = (c.ph / period) * 2 * Math.PI * side;
      u = c.cu + ROUND_R * Math.cos(phi);
      v = c.cv + ROUND_R * Math.sin(phi);
      h = phi + (side * Math.PI) / 2;
    }
    this.moveTo(b, u, v, h);
    c.ph += this.dt;
    if (c.ph < period) return false;
    c.ph -= period;
    // 太阳在动，跳舞的蜂每一圈都按此刻的太阳摆；花合上了就不跳了
    const p = this.env.flowers.get(b.patch);
    if (!p || !this.isOpen(p)) return true;
    if (c.w > 0) c.a = this.danceAngle(b, p);
    return --c.n <= 0;
  }

  /** 摇摆舞的摆动方向（巢面里的角度）：和竖直向上的夹角等于花丛和太阳的方位差，从正面看顺时针为正；背面看过去左右反过来 */
  private danceAngle(b: Bee, p: FlowerPatch): number {
    const th = wrapAngle(Math.atan2(p.z - MOUTH.z, p.x - MOUTH.x) - this.env.sun());
    return Math.atan2(Math.cos(th), b.face ? -Math.sin(th) : Math.sin(th));
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
    // 防护片的缝窄，过管口慢
    const slow = this.env.hornets.plate() && c.s > TUBE_LEN - HN.plateLen;
    c.s += c.dir * F.tubeWalk * (slow ? HN.plateSlow : 1) * this.dt;
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

  /** 割掉、换掉后要补的地方，蜂先补这里；只补离框梁中间最近的一圈，新巢脾像舌头一样从框梁往下长 */
  private isRepair = (c: number) => this.isFrontier(c) && this.comb.repair[cellSite(c)] === 1 && REPAIR_K[cellSite(c)] <= this.repairK;
  private repairK = Infinity;
  private repairAt = '';

  /** 要补的那一圈只在有位置开始造、补好时变（读档后第一步按同样的巢脾重算，走得一样） */
  private syncRepair(): void {
    const cb = this.comb;
    const at = `${cb.shape}|${cb.repairs}`;
    if (at === this.repairAt) return;
    this.repairAt = at;
    let k = Infinity;
    for (let s = 0; s < SITES; s++) if (cb.repair[s] && cb.build[s] > 0 && cb.build[s] < 1) k = Math.min(k, REPAIR_K[s]);
    this.repairK = k + CONFIG.keeper.repairBand;
  }

  private field(key: FieldKey): Field {
    const f = this.fields[key];
    const now = this.now();
    const every = key === 'entrance' || key === 'floor' ? Infinity : key === 'cold' ? HT.refresh : C.refresh[key];
    if (f.shape !== this.map.shape || now - f.at >= every) f.compute(this.map, this.sources(key), now);
    return f;
  }

  private *sources(key: FieldKey): Generator<number> {
    const cb = this.comb;
    if (key === 'entrance') {
      for (let n = 0; n < NODES; n++) {
        const u = nodeU(n);
        const v = nodeV(n);
        if (u < 0 && Math.abs(v - DOOR.v) < 1) {
          yield n;
          yield n + NODES;
        }
      }
      return;
    }
    if (key === 'floor') {
      // 舞场：每一面离巢门最近的那一片造好的巢脾（框条上不跳）
      const e = this.field('entrance').dist;
      const m = this.map.walk;
      for (let face = 0; face < 2; face++) {
        let near = Infinity;
        for (let n = 0; n < NODES; n++) if (m[n] === 1 && e[face * NODES + n] < near) near = e[face * NODES + n];
        for (let n = 0; n < NODES; n++) if (m[n] === 1 && e[face * NODES + n] <= near + D.floor) yield face * NODES + n;
      }
      return;
    }
    if (key === 'cold') {
      // 育儿区里比该有的温度低的格
      const ht = this.env.heat;
      const m = this.map.walk;
      for (let n = 0; n < NODES; n++) {
        const i = NODE_HEAT[n];
        if (m[n] !== 1 || ht.brood[i] < HT.broodCells || ht.temp[i] >= HT.ideal[0]) continue;
        yield n;
        yield n + NODES;
      }
      return;
    }
    if (key === 'frontier') {
      let found = 0;
      for (let c = 0; c < CELLS; c++)
        if (this.isRepair(c)) {
          found++;
          yield cellNode(c);
        }
      if (found) return;
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
    const role = roleOf(b);
    // 子脾冷了年轻的蜂去抱团产热，热了去巢门扇风（T-021）
    if (this.coldNeed > 0 && b.load <= 0 && (role === 'cleaner' || role === 'house') && this.rng.chance(this.coldNeed * HT.heaters)) return yield* this.warm(b);
    if (this.hotNeed > 0 && b.load <= 0 && (role === 'house' || role === 'guard') && this.rng.chance(this.hotNeed * HT.fanners)) return yield* this.fan(b);
    switch (role) {
      case 'cleaner':
        return yield* this.clean(b);
      case 'nurse':
        return yield* this.nurse(b);
      case 'house':
        return yield* this.house(b);
      case 'guard':
        if (this.rng.chance(this.threat || this.env.alarm() > CONFIG.keeper.alarmGuard ? HN.threatGuards : C.guards)) {
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

  /** 采集蜂：带着东西先放下；跟舞读出地方的去那儿找，认得开着的花丛就去采，其余去舞场看舞或者去侦察 */
  private *forage(b: Bee): Routine {
    if (b.load > 0) return yield* this.unload(b);
    if (!this.env.flyable()) return yield* this.wait(b);
    if (b.aim && this.now() - b.aim.at > D.aimLife) b.aim = null;
    if (b.aim) return yield* this.goOut(b, null);
    const p = this.pickPatch(b);
    if (p) return yield* this.goOut(b, p);
    return yield* this.lookForWork(b);
  }

  private isOpen = (p: FlowerPatch) => patchOpenness(p, this.env.hour()) >= F.minOpen;

  /** 认得的花丛开着就去；合上了有时忘了它 */
  private pickPatch(b: Bee): FlowerPatch | null {
    if (b.patch < 0) return null;
    const p = this.env.flowers.get(b.patch);
    if (p && this.isOpen(p)) return p;
    if (!p || this.rng.chance(F.scout)) b.patch = -1;
    return null;
  }

  /** 认下一片花丛；goods 0 是花蜜，1 起是花粉（颜色 + 1），只有粉的花只能采粉 */
  private adopt(b: Bee, p: FlowerPatch, pollen: boolean): void {
    const sp = SPECIES[p.species];
    b.patch = p.id;
    b.goods = sp.nectar <= 0 || (pollen && sp.pollen > 0) ? sp.pollenKind + 1 : 0;
  }

  /** 没有花丛可去：不认得花丛的少数去侦察，其余到舞场看舞，跟上一支舞就照着去 */
  private *lookForWork(b: Bee): Routine {
    const open = this.env.flowers.patches.filter(this.isOpen);
    if (!open.length) return yield* this.wait(b);
    // 缺蜜、缺粉时闲着的采集蜂更愿意出去找
    if (b.patch < 0 && this.rng.chance(F.scout * Math.max(2 * this.honeyNeed, this.pollenNeed))) {
      const p = open[this.rng.int(0, open.length - 1)];
      this.adopt(b, p, this.rng.chance(this.pollenNeed * F.pollenShare));
      return yield* this.goOut(b, p, true);
    }
    if (!this.rng.chance(D.floorVisit)) return yield* this.wait(b);
    b.act = 'watch';
    if (!((yield { k: 'go', f: 'floor', near: 0, t: 90 }) as boolean)) return yield* this.idle(b);
    const id = (yield { k: 'watch', t: this.rng.range(D.watch[0], D.watch[1]) }) as number;
    if (id < 0) return;
    b.act = 'followDance';
    if (!((yield { k: 'follow', id, seen: 0, last: -1, t: 40 }) as boolean)) return;
    yield* this.goOut(b, null);
  }

  /** 出巢：去花丛 p；p 为空时飞到跟舞读出的地方，在那儿找开着的花丛，闻得出舞蜂身上那种花的优先 */
  private *goOut(b: Bee, p: FlowerPatch | null, scout = false): Routine {
    if (b.crop < F.depart) return yield* this.eat(b);
    b.act = 'leave';
    // 挤到巢门花了太久，花已经合上了、天变了就不出去
    if (!((yield { k: 'go', f: 'entrance', near: 0, t: 120 }) as boolean) || (p && !this.isOpen(p)) || !this.env.flyable()) return yield* this.idle(b);
    // 巢门外有胡蜂悬停、刚开过箱，不敢出去（采集停滞）
    const stop = 1 - (1 - this.env.hornets.danger()) * (1 - this.env.alarm() * CONFIG.keeper.alarmStop);
    if (this.rng.chance(stop)) return yield* this.wait(b);
    if (!((yield { k: 'tube', dir: 1, s: 0, face: b.face, t: 10 }) as boolean)) return yield* this.idle(b);
    b.act = scout ? 'scout' : p ? 'flyOut' : 'flyAim';
    yield { k: 'fly', ...DEPART, r: 15, v: F.speed, stop: false, t: 30 };
    if (!p) {
      const a = b.aim;
      if (!a) return;
      const y = this.env.ground(a.x, a.z) + 40;
      if (Math.hypot(b.pos.x - a.x, b.pos.z - a.z) > a.r / 2) yield { k: 'fly', x: a.x, y, z: a.z, r: 40, v: F.speed, stop: false, t: 120 };
      b.act = 'search';
      b.aim = null;
      this.arrived++;
      p = this.findPatch(a);
      if (!p) {
        const ang = this.rng.range(0, TAU);
        yield { k: 'fly', x: a.x + Math.cos(ang) * a.r * 0.5, y, z: a.z + Math.sin(ang) * a.r * 0.5, r: 30, v: F.speed, stop: false, t: 60 };
        return;
      }
      if (p.id === a.patch) this.hits++;
      this.adopt(b, p, a.goods > 0);
      b.act = 'flyOut';
    }
    yield* this.gather(b, p);
    // 回巢由 task 开头的 comeHome 接着做（读档后也一样）
  }

  /** a 附近 r 以内开着的花丛，挑最近的；舞蜂身上那种花的气味让同种的近 scent */
  private findPatch(a: Aim): FlowerPatch | null {
    let best: FlowerPatch | null = null;
    let bestS = Infinity;
    for (const p of this.env.flowers.patches) {
      if (!this.isOpen(p)) continue;
      const d = Math.max(0, Math.hypot(p.x - a.x, p.z - a.z) - p.r);
      if (d > a.r) continue;
      const s = d - (p.species === a.sp ? D.scent : 0);
      if (s < bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
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
      if (k > 0) b.act = b.goods ? 'gatherPollen' : 'sipNectar';
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
    if (b.load > 0) {
      this.trips++;
      b.haul = b.load;
      b.waited = 0;
    }
  }

  /**
   * 带回来的：花粉先跳舞再自己蹬进巢房，不缺粉时有的改采花蜜；花蜜先在巢门附近找内勤蜂接，
   * 等不到就自己放，然后看等了多久决定跳不跳舞
   */
  private *unload(b: Bee): Routine {
    if (b.goods > 0) {
      yield* this.maybeDance(b);
      yield* this.store(b);
      if (b.load <= 0 && this.pollenNeed < D.sated && this.rng.chance(D.switch)) {
        const p = this.env.flowers.get(b.patch);
        if (p && SPECIES[p.species].nectar > 0) b.goods = 0;
        else b.patch = -1;
      }
      return;
    }
    if (!(yield* this.handoff(b))) {
      this.selfStored++;
      yield* this.store(b);
    }
    yield* this.maybeDance(b);
  }

  /** 在巢门附近找接蜜的内勤蜂，交出去；一共等 giveUp 秒 */
  private *handoff(b: Bee): Generator<Cmd, boolean, unknown> {
    this.release(b);
    b.act = 'offer';
    yield { k: 'go', f: 'entrance', near: this.rng.int(D.give[0], D.give[1]), t: 30 };
    while (b.waited < D.giveUp) {
      b.act = 'offer';
      if (!((yield { k: 'offer', t: D.giveUp - b.waited }) as boolean)) return false;
      b.act = 'giveNectar';
      if (!((yield { k: 'meet', t: 8 }) as boolean)) continue;
      if ((yield { k: 'give', t: D.handoff }) as boolean) return true;
    }
    return false;
  }

  /**
   * 跳不跳舞、跳几圈：花蜜按这趟带回多少和交接等了多久（等得太久改跳颤抖舞，有的不再去那片），
   * 花粉按带回多少和缺粉程度。远的跳摇摆舞：摆动的方向和竖直向上的夹角等于花丛和太阳的方位差，摆得越久越远
   */
  private *maybeDance(b: Bee): Routine {
    const haul = b.haul;
    const waited = b.waited;
    b.haul = 0;
    b.waited = 0;
    if (haul <= 0) return;
    const pollen = b.goods > 0;
    if (!pollen && waited > D.slow && this.foraging()) {
      if (this.rng.chance(D.quit)) b.patch = -1;
      this.tremble += D.trembleGain;
      this.trembles++;
      b.act = 'tremble';
      yield { k: 'tremble', t: this.rng.range(D.tremble[0], D.tremble[1]) };
      return;
    }
    const p = b.patch >= 0 ? this.env.flowers.get(b.patch) : undefined;
    if (!p || !this.isOpen(p) || !this.env.flyable()) return;
    const q = haul * (pollen ? this.pollenNeed : clamp((D.slow - waited) / (D.slow - D.quick), 0, 1) * 2 * this.honeyNeed);
    const n = Math.round(D.circuits * q * this.rng.range(0.7, 1.3));
    if (n < 1) return;
    b.act = 'seek';
    if (!((yield { k: 'go', f: 'floor', near: 0, t: 60 }) as boolean)) return;
    const dx = p.x - MOUTH.x;
    const dz = p.z - MOUTH.z;
    const dist = Math.hypot(dx, dz);
    const round = dist < D.round;
    const w = round ? 0 : D.w0 + (dist / 100) * D.perM;
    const len = w * D.waggle;
    const a = this.danceAngle(b, p);
    // 舞从脚下开始：摆动段的起点、圆舞的圈上
    const spot = round
      ? this.danceSpot(b.u - ROUND_R, b.v, ROUND_R)
      : this.danceSpot(b.u + (Math.cos(a) * len) / 2, b.v + (Math.sin(a) * len) / 2, len / 2);
    if (!spot) return;
    b.act = round ? 'roundDance' : 'dance';
    this.dances++;
    yield { k: 'dance', cu: spot[0], cv: spot[1], a, w, len, n, ph: 0 };
  }

  /** 还有采集蜂在外面、或者有花开着 */
  private foraging(): boolean {
    return this.outside > 0 || this.env.flowers.patches.some(this.isOpen);
  }

  /** 舞场中心：(cu, cv) 附近、周围 r 以内都能站的地方（每圈按太阳转方向，整个圈都要站得下） */
  private danceSpot(cu: number, cv: number, r: number): [number, number] | null {
    const m = this.map;
    const fits = (u: number, v: number) => {
      for (let R = 0.25; R < r + 0.55; R += 0.25) if (!RING.every(([x, y]) => m.ok(u + x * R, v + y * R))) return false;
      return m.ok(u, v);
    };
    for (const [du, dv] of SPOTS) if (fits(cu + du, cv + dv)) return [cu + du, cv + dv];
    return null;
  }

  /** 把带着的花蜜、花粉放进巢房；放不下就带着，过一会再找 */
  private *store(b: Bee): Routine {
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

  /** 走到冷的子脾上，停着振翅产热 */
  private *warm(b: Bee): Routine {
    b.act = 'goHeat';
    if (!((yield { k: 'go', f: 'cold', near: 0, t: 60 }) as boolean)) return yield* this.idle(b);
    b.act = 'heat';
    yield { k: 'heat', t: this.rng.range(HT.hold[0], HT.hold[1]) };
  }

  /** 走到巢门边扇风：中蜂扇风时头背着巢门（意蜂朝着巢门，BALANCE） */
  private *fan(b: Bee): Routine {
    b.act = 'goFan';
    if (!((yield { k: 'go', f: 'entrance', near: this.rng.int(1, 8), t: 60 }) as boolean)) return yield* this.idle(b);
    b.act = 'fan';
    yield { k: 'fan', t: this.rng.range(HT.hold[0], HT.hold[1]) };
  }

  /** 去围胡蜂：走到巢门、出管口，飞到热球上自己的位置 */
  private *mob(b: Bee, id: number, i: number): Routine {
    b.act = 'goBall';
    if (!((yield { k: 'go', f: 'entrance', near: 0, t: 60 }) as boolean) || !this.env.hornets.ballAt(id)) return yield* this.idle(b);
    if (!((yield { k: 'tube', dir: 1, s: 0, face: b.face, t: 20 }) as boolean)) return yield* this.idle(b);
    b.act = 'ball';
    yield { k: 'ball', id, i, t: 300 };
  }

  /** 叫巢门附近 n 只没带东西的工蜂（守卫、内勤蜂、采集蜂）去围胡蜂 id，离巢门近的先去；返回叫了几只 */
  recruitBall(id: number, n: number): number {
    const f = this.field('entrance');
    const pick: [number, Bee][] = [];
    for (const b of this.list) {
      const r = roleOf(b);
      if (b.out || b.wrap > 0 || b.load > 0 || (r !== 'house' && r !== 'guard' && r !== 'forager')) continue;
      const node = this.nodeOf(b);
      if (node >= 0 && f.reachable(node)) pick.push([f.dist[node], b]);
    }
    pick.sort((a, c) => a[0] - c[0] || a[1].id - c[1].id);
    const k = Math.min(n, pick.length);
    for (let i = 0; i < k; i++) {
      const b = pick[i][1];
      this.unpark(b);
      this.release(b);
      b.brain.start(this.mob(b, id, i));
    }
    return k;
  }

  /** 已经围在胡蜂 id 身上的蜂 */
  ball(id: number): Bee[] {
    return this.list.filter((b) => b.out === 3 && b.act === 'ball' && b.brain.cmd?.k === 'ball' && b.brain.cmd.id === id);
  }

  /** 热球：第 i 只围在离中心 ballR(i) 的一层上，方向按黄金角错开；先飞过去，到了就贴着不动、身子颤 */
  private stepBall(b: Bee, c: Extract<Cmd, { k: 'ball' }>): boolean {
    const o = this.env.hornets.ballAt(c.id);
    if (!o || (c.t -= this.dt) <= 0) {
      b.out = 2;
      b.vel.x = b.vel.y = b.vel.z = 0;
      return true;
    }
    const y = 1 - 2 * ((c.i * 0.7548777 + 0.5) % 1);
    const s = Math.sqrt(1 - y * y);
    const a = c.i * 2.3999632;
    const dx = s * Math.cos(a);
    const dz = s * Math.sin(a);
    // 胡蜂身子约 1.2 cm 粗，每只蜂约占 0.35 cm³
    const r = Math.cbrt(1.2 ** 3 + ((c.i + 1) * 0.35) / ((4 / 3) * Math.PI));
    const T = this.target;
    T.x = o.x + dx * r;
    T.y = o.y + y * r;
    T.z = o.z + dz * r;
    if (b.out !== 3) {
      b.out = 2;
      if (steer(b, T, F.hop, true, this.dt, this.env.ground(b.pos.x, b.pos.z), this.now()) > 0.4) return false;
      b.out = 3;
    }
    Object.assign(b.pos, T);
    // 停着时 vel 记着背朝哪（往外），画面按它摆蜂身
    b.vel.x = dx;
    b.vel.y = y;
    b.vel.z = dz;
    b.h = Math.atan2(-dz, -dx);
    b.waggle = 3;
    return false;
  }

  /** 内勤蜂：带着接来的花蜜先放下；有花开着时一部分去巢门附近等着接蜜（颤抖舞之后更多） */
  private *house(b: Bee): Routine {
    if (b.load > 0) return yield* this.store(b);
    if (this.rng.chance(Math.min(0.8, D.receive + this.tremble) * Math.min(1, 2 * this.honeyNeed)) && this.foraging()) {
      b.act = 'goReceive';
      if ((yield { k: 'go', f: 'entrance', near: this.rng.int(D.receiveAt[0], D.receiveAt[1]), t: 60 }) as boolean) {
        b.act = 'receive';
        yield { k: 'receive', t: this.rng.range(D.receiveWait[0], D.receiveWait[1]) };
        if (b.load > 0) yield* this.store(b);
      }
      return;
    }
    const build = this.rng.chance(this.comb.repairs ? CONFIG.keeper.repairBuilders : C.builders);
    if (build) {
      const cell = yield* this.seek(b, 'frontier', this.isFrontier, 'goBuild', this.comb.repairs ? this.isRepair : this.isFrontier);
      if (cell >= 0) {
        yield* this.work(b, cell, 'build', C.work.build);
        this.comb.buildUp(cellSite(cell), C.build, C.start);
        b.crop = Math.max(0, b.crop - C.buildCost);
        // 补巢脾的蜂挂在缺口边上接着造，不每造一下就走开
        for (let i = 1; i < CONFIG.keeper.repairStay && this.comb.repairs && b.crop > B.hungry; i++) {
          const next = this.findNear(b, this.isRepair, 2.4);
          if (next < 0 || !((yield { k: 'to', cell: next, t: 6 }) as boolean)) break;
          yield* this.work(b, next, 'build', C.work.build);
          this.comb.buildUp(cellSite(next), C.build, C.start);
          b.crop = Math.max(0, b.crop - C.buildCost);
        }
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
          ...[b.act, c ? (c.k === 'dance' ? { ...c, ph: r4(c.ph) } : { ...c, t: r4(c.t) }) : null, c && b.brain.started ? 1 : 0],
          // 巢脾上的蜂位置由 u、v 算出来，不存
          ...[b.out, ...(b.out ? [r4(p.x), r4(p.y), r4(p.z), r4(v.x), r4(v.y), r4(v.z)] : [0, 0, 0, 0, 0, 0]), b.patch, b.goods, r4(b.load)],
          ...[b.partner, r4(b.waited), r4(b.haul), b.aim ? [r4(b.aim.at), r4(b.aim.x), r4(b.aim.z), b.aim.r, b.aim.sp, b.aim.goods, b.aim.patch] : null, r4(b.dev)],
        ] as BeeSave;
      }),
      trips: this.trips,
      lost: this.lost,
      nectarIn: r4(this.nectarIn),
      pollenIn: r4(this.pollenIn),
      dances: this.dances,
      recruits: this.recruits,
      arrived: this.arrived,
      hits: this.hits,
      handoffs: this.handoffs,
      selfStored: this.selfStored,
      trembles: this.trembles,
      tremble: r4(this.tremble),
      pollenNeed: r4(this.pollenNeed),
      honeyNeed: r4(this.honeyNeed),
      pace: this.pace.map(r4),
      reverted: this.reverted,
      needAt: r4(this.needAt),
      births: this.births,
      deaths: this.deaths,
      laid: this.laid,
      starved: this.starved,
      hungry: this.hungry,
      coldNeed: this.coldNeed,
      hotNeed: this.hotNeed,
    };
  }

  restore(d: BeesSave): void {
    this.list.length = 0;
    this.byId.clear();
    this.occ.fill(0);
    for (const [id, caste, age, life, face, u, v, h, crop, jelly, wrap, wn, fast, act, cmd, started, out, x, y, z, vx, vy, vz, patch, goods, load, partner, waited, haul, aim, dev] of d.bees) {
      const b = this.add(caste, age, life, id);
      Object.assign(b, { face, u, v, h, crop, jelly, wrap, wn, fast, act, out, patch, goods, load, partner, waited, haul, dev });
      b.aim = aim ? { at: aim[0], x: aim[1], z: aim[2], r: aim[3], sp: aim[4], goods: aim[5], patch: aim[6] } : null;
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
    this.dances = d.dances;
    this.recruits = d.recruits;
    this.arrived = d.arrived;
    this.hits = d.hits;
    this.handoffs = d.handoffs;
    this.selfStored = d.selfStored;
    this.trembles = d.trembles;
    this.tremble = d.tremble;
    this.pollenNeed = d.pollenNeed;
    this.honeyNeed = d.honeyNeed;
    this.pace = [...d.pace];
    this.reverted = d.reverted;
    this.needAt = d.needAt;
    this.births = d.births;
    this.deaths = d.deaths;
    this.laid = d.laid;
    this.starved = d.starved;
    this.hungry = d.hungry;
    this.coldNeed = d.coldNeed;
    this.hotNeed = d.hotNeed;
    for (const f of Object.values(this.fields)) f.at = -Infinity;
  }
}

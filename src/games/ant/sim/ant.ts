import * as THREE from 'three';
import { CONFIG, type Role } from '../config';
import { asText, L, type Text } from '../../../core/i18n';
import { GraphWalker, tunnelFloor } from '../../../core/move/graph';
import { Skirt, alignToGround, turnToward } from '../../../core/move/surface';
import { clamp } from '../../../core/util/math';
import type { NestEdge } from '../nest/nest';
import type { World } from '../world/world';
import type { Item } from './items';

/** 行为协程向“运动层”下达的原子指令，完成后协程才会继续执行。 */
export type Command =
  | { k: 'goto'; node: number }
  | { k: 'room'; chamber: number; time: number; point?: THREE.Vector3 }
  /** giveUp：所有入口都被封住时不再等待，指令以结果 'blocked' 结束 */
  | { k: 'exit'; giveUp?: boolean }
  | { k: 'enter' }
  | { k: 'search'; time: number }
  | { k: 'walk'; x: number; z: number; r: number }
  | { k: 'patrol'; x: number; z: number; radius: number; time: number }
  | { k: 'wait'; time: number }
  /** 沿植物茎爬到 top 高度，停留 stay 秒后爬回地面 */
  | { k: 'climb'; x: number; z: number; angle: number; r: number; top: number; stay: number };

export type Routine = Generator<Command, void, unknown>;

/** t 是模拟秒数；较早的存档里 t 和 msg 都是拼好的中文 */
export interface LogEntry {
  t: number | string;
  msg: Text;
}

const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();

export interface AntSave {
  id: number;
  role: Role;
  scout: boolean;
  age: number;
  life: number;
  hunger: number;
  health: number;
  size: number;
  bias: number;
  surface: boolean;
  p: number[];
  h: number;
  room: number;
  node: number;
  crop: number;
  eatAt: number;
  trips: number;
  delivered: number;
  next: Role | null;
  excited: number;
  /** 照料的蚜虫群在 AphidManager.colonies 中的序号 */
  herd: number;
  mem: number[] | null;
  contacts: number;
  shares: number;
  log: { t: number | string; msg: Text | string }[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Ant {
  id: number;
  role: Role;
  scout = false;
  // 构造函数里才抽随机数的数值字段也先给 0：没有初值的字段先是 undefined，V8 就不再按浮点数原地存放，3000 只时每步慢约 9%
  ageDays = 0;
  lifespan = 0;
  hunger = 0;
  health = 1;
  alive = true;
  size = 0;

  domain: 'surface' | 'nest' = 'nest';
  pos = new THREE.Vector3();
  fwd = new THREE.Vector3(1, 0, 0);
  up = new THREE.Vector3(0, 1, 0);
  moving = false;
  gait = 0;

  // 地表运动
  heading = 0;
  private entranceTarget = -1;
  private pathNoise = 0;
  /** 觅食地点记忆（黑毛蚁觅食蚁具有地点忠诚性） */
  memory: { x: number; z: number } | null = null;
  private memoryChecked = false;

  // 巢内运动
  room = -1;
  /** 在隧道网络里的位置（房间里时 node 是 -1） */
  readonly walk = new GraphWalker<NestEdge>();
  private lane = 0;
  /** 隧道里为避开同伴而偏离 lane 的横向距离（隧道半径的倍数） */
  private side = 0;
  /** Colony.separate 的临时量：沿边坐标、横向坐标、横向推力 */
  sepS = 0;
  sepLat = 0;
  sepPush = 0;
  /** 个体步速差异：同时出发的同伴不会一直并排走 */
  private pace = 0;
  private localTarget = new THREE.Vector3();
  private navTarget = new THREE.Vector3();
  private pauseT = 0;

  carrying: Item | null = null;
  /** 嗉囊内的液体食物 0..1 */
  crop = 0;
  /** 进食失败后在此模拟时刻之前不再尝试进食 */
  eatRetryAt = 0;

  cmd: Command | null = null;
  private cmdInit = false;
  private timer = 0;
  private result: unknown = undefined;
  routine: Routine | null = null;
  activity: Text = L('act.idle');
  log: LogEntry[] = [];

  trips = 0;
  delivered = 0;

  /** 分工调整后待切换的职别，在当前任务结束后生效 */
  nextRole: Role | null = null;
  /** 行为年龄相对真实日龄的偏移：同龄工蚁转换分工有早有晚 */
  ageBias = 0;
  /** 触角接触、交哺时原地停留的剩余秒数 */
  holdT = 0;
  /** 被水洼挡住的累计时间，超过阈值后蹚水通过 */
  wadeT = 0;
  /** 在蚁狮陷阱里的时间 */
  pitT = 0;
  private pitX = 0;
  private pitZ = 0;
  /** 爬出过的陷阱，之后绕开走 */
  avoidPit: { x: number; z: number } | null = null;
  private pitAvoidT = 0;
  /** 闻到警报后增援的剩余秒数，期间暂停原来的任务 */
  alarmT = 0;
  private alarmX = 0;
  private alarmZ = 0;
  private nextAlarmCheck = 0;
  private taskActivity: Text = L('act.idle');
  /** 正在撕咬的狼蛛 */
  mobTarget = -1;
  /** 因为狼蛛逼近而出巢警戒（日常的入口巡逻不算） */
  guarding = false;
  /** 正在去封堵 / 清开的入口编号 */
  plugging = -1;
  private exitBlocked = false;
  /** 体温决定的速度系数，每 0.5 秒按所在深度重新计算 */
  private tempK = 1;
  private tempAt = 0;
  private tempDomain: 'surface' | 'nest' = 'nest';
  private skirtNav = new Skirt();
  nextContactAt = 0;
  contacts = 0;
  shares = 0;
  /** 被满载归来的同伴激发、更想出巢觅食的截止时刻 */
  excitedUntil = 0;
  /** 照料的蚜虫群（蚜虫放牧同样有地点忠诚性） */
  herd = -1;
  /** 正在前往或挖掘的工作面节点 */
  digNode = -1;

  private climbS = 0;
  private climbPhase = 0;
  private climbR0 = 0;
  private climbY0 = 0;

  constructor(role: Role, ageDays: number, w: World, id = w.ids.next('ant')) {
    const r = w.rng;
    this.id = id;
    this.role = role;
    this.ageDays = ageDays;
    this.hunger = r.range(0, 0.4);
    this.size = r.range(0.86, 1.08);
    this.gait = r.range(0, 6.28);
    this.heading = r.range(-Math.PI, Math.PI);
    this.lane = r.range(-0.15, 0.75);
    this.pace = r.range(0.88, 1.12);
    this.ageBias = r.gauss(0, CONFIG.polyethism.ageJitterDays);
    this.nextAlarmCheck = r.range(0, 0.5);
    this.nextContactAt = r.range(0, 10);
    const [a, b] = CONFIG.colony.workerLifespanDays;
    this.lifespan = role === 'queen' ? 9999 : r.range(a, b);
  }

  toSave(w: World): AntSave {
    const surface = this.domain === 'surface';
    return {
      id: this.id,
      role: this.role,
      scout: this.scout,
      age: r3(this.ageDays),
      life: r3(this.lifespan),
      hunger: r3(this.hunger),
      health: r3(this.health),
      size: r3(this.size),
      bias: r3(this.ageBias),
      surface,
      p: [r3(this.pos.x), r3(this.pos.y), r3(this.pos.z)],
      h: r3(this.heading),
      room: surface ? -1 : this.room,
      node: surface || this.room >= 0 ? -1 : this.currentNode(w),
      crop: r3(this.crop),
      eatAt: Math.round(this.eatRetryAt),
      trips: this.trips,
      delivered: this.delivered,
      next: this.nextRole,
      excited: Math.round(this.excitedUntil),
      herd: w.aphids.colonies.findIndex((c) => c.id === this.herd),
      mem: this.memory ? [r3(this.memory.x), r3(this.memory.z)] : null,
      contacts: this.contacts,
      shares: this.shares,
      log: this.log.slice(0, 4),
    };
  }

  /** 读档：恢复个体状态和位置，任务协程从头开始。走在隧道中途的蚂蚁放到最近的节点上，爬在植物上的放回地面 */
  static fromSave(s: AntSave, w: World): Ant {
    const a = new Ant(s.role, s.age, w, s.id);
    w.ids.seen('ant', s.id);
    a.scout = s.scout;
    a.lifespan = s.life;
    a.hunger = s.hunger;
    a.health = s.health;
    a.size = s.size;
    a.ageBias = s.bias;
    a.crop = s.crop;
    a.eatRetryAt = s.eatAt;
    a.trips = s.trips;
    a.delivered = s.delivered;
    a.nextRole = s.next;
    a.excitedUntil = s.excited;
    a.herd = w.aphids.colonies[s.herd]?.id ?? -1;
    a.memory = s.mem ? { x: s.mem[0], z: s.mem[1] } : null;
    a.contacts = s.contacts;
    a.shares = s.shares;
    a.log = s.log.map((e) => ({ t: e.t, msg: asText(e.msg) }));
    a.heading = s.h;
    const nest = w.nest;
    if (s.surface) {
      a.placeOnSurface(s.p[0], s.p[2], w);
      a.fwd.set(Math.cos(s.h), 0, Math.sin(s.h));
    } else if (s.room >= 0 && nest.chambers[s.room]) {
      a.domain = 'nest';
      a.room = s.room;
      a.pos.set(s.p[0], s.p[1], s.p[2]);
    } else {
      a.domain = 'nest';
      a.walk.at(nest.nodes[s.node] ? s.node : nest.entrances[0].node);
      a.pos.copy(nest.nodes[a.walk.node].pos);
    }
    a.localTarget.copy(a.pos);
    a.navTarget.copy(a.pos);
    return a;
  }

  note(w: World, msg: Text): void {
    this.log.unshift({ t: Math.round(w.clock.seconds), msg });
    if (this.log.length > 14) this.log.pop();
  }

  get behaviorAge(): number {
    return this.ageDays + this.ageBias;
  }

  /** 原地停留 t 秒并转向 target */
  hold(t: number, target: THREE.Vector3): void {
    this.holdT = Math.max(this.holdT, t);
    this.faceTo(target);
  }

  faceTo(target: THREE.Vector3): void {
    _f.copy(target).sub(this.pos);
    _f.addScaledVector(this.up, -_f.dot(this.up));
    if (_f.lengthSq() > 1e-4) this.fwd.copy(_f.normalize());
  }

  /** 从自己的嗉囊中取食，返回实际消耗量 */
  eatFromCrop(): number {
    const used = Math.min(this.crop, CONFIG.ant.eatAmount);
    this.crop -= used;
    this.hunger = Math.max(0, this.hunger - (0.85 * used) / CONFIG.ant.eatAmount);
    return used;
  }

  /** 立刻放到某个房间内（初始化用） */
  placeInRoom(w: World, chamber: number): void {
    const c = w.nest.chambers[chamber];
    this.domain = 'nest';
    this.room = chamber;
    this.walk.at(-1);
    w.nest.randomFloorPoint(c, () => w.rng.next(), this.pos);
    this.localTarget.copy(this.pos);
    this.navTarget.copy(this.pos);
    this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
  }

  placeOnSurface(x: number, z: number, w: World): void {
    this.domain = 'surface';
    this.room = -1;
    this.walk.edge = null;
    this.pos.set(x, w.terrain.heightAt(x, z), z);
  }

  /** 正在走的隧道 */
  get edge(): NestEdge | null {
    return this.walk.edge;
  }

  /** 当前所在的蚁穴节点（用于寻路起点） */
  currentNode(w: World): number {
    if (this.room >= 0) return w.nest.chambers[this.room].door;
    return this.walk.nearNode();
  }

  locationLabel(w: World): Text {
    if (this.domain === 'surface') return L('loc.surface');
    if (this.room >= 0) return w.nest.chambers[this.room].label;
    if (this.edge) return L(this.edge.isShaft ? 'loc.shaft' : 'loc.tunnel');
    const n = w.nest.nodes[this.walk.node];
    if (n?.kind === 'entrance') return L('loc.entrance');
    return L('loc.tunnel');
  }

  depth(w: World): number {
    return Math.max(0, w.nest.surfaceY - this.pos.y);
  }

  /** 体温随环境温度变化，影响行进速度 */
  private speedFactor(w: World): number {
    const now = w.clock.seconds;
    if (now >= this.tempAt || this.tempDomain !== this.domain) {
      this.tempAt = now + 0.5;
      this.tempDomain = this.domain;
      this.tempK = clamp((w.soil.temperatureAt(this.domain === 'surface' ? 0 : this.depth(w)) - 4) / 18, 0.3, 1.25);
    }
    const f = this.tempK;
    const wet = this.domain === 'surface' ? 1 - CONFIG.weather.rainSlow * w.weather.rain : 1;
    return f * wet * (this.role === 'queen' ? 0.35 : 1) * (this.health < 0.4 ? 0.6 : 1);
  }

  update(dt: number, w: World): void {
    if (this.holdT > 0) {
      this.holdT -= dt;
      this.moving = false;
      if (this.domain === 'nest') this.smoothNest(dt);
      return;
    }
    if (this.domain === 'surface' && this.role !== 'queen') {
      if (this.alarmT <= 0 && w.clock.seconds >= this.nextAlarmCheck) this.checkAlarm(w);
      if (this.alarmT > 0) {
        this.defend(dt, w);
        return;
      }
    }
    for (let guard = 0; guard < 4; guard++) {
      if (!this.cmd) {
        if (!this.routine) this.routine = w.colony.newRoutine(this);
        const r = this.routine.next(this.result);
        this.result = undefined;
        if (r.done) {
          this.routine = null;
          continue;
        }
        this.cmd = r.value;
        this.cmdInit = false;
      }
      const done = this.step(dt, w, this.cmd);
      if (!done) break;
      this.cmd = null;
    }
    if (this.domain === 'nest') this.smoothNest(dt);
  }

  // ---------------- 警报与防御 ----------------

  /** 搬着东西、爬在植物上或陷在坑里的蚂蚁不响应 */
  private checkAlarm(w: World): void {
    this.nextAlarmCheck = w.clock.seconds + 0.5;
    if (this.climbing || this.carrying || this.pitT > 0) return;
    const D = CONFIG.defense;
    const src = w.alarm.strongest(this.pos.x, this.pos.z);
    if (!src || src.level < D.respondLevel) return;
    this.alarmT = w.rng.range(D.defendSec[0], D.defendSec[1]);
    this.alarmX = src.x;
    this.alarmZ = src.z;
    this.taskActivity = this.activity;
    this.note(w, L('note.alarm'));
  }

  /** 冲向警报源；附近有狼蛛就贴身撕咬，并不断补充警报招来更多同伴 */
  private defend(dt: number, w: World): void {
    const D = CONFIG.defense;
    this.alarmT -= dt;
    this.mobTarget = -1;
    const s = w.predators.nearestSpider(this.pos.x, this.pos.z, D.chaseRange);
    if (s) {
      this.alarmX = s.x;
      this.alarmZ = s.z;
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < D.biteRange) {
        this.mobTarget = s.id;
        this.moving = false;
        _f.set(s.x, this.pos.y, s.z);
        this.faceTo(_f);
        this.alarmT = Math.max(this.alarmT, 2);
        w.alarm.emit(s.x, s.z, D.mobEmit * dt);
        this.activity = L('act.mobSpider');
        return;
      }
      this.activity = L('act.rushSpider');
      this.surfaceMove(dt, w, Math.atan2(s.z - this.pos.z, s.x - this.pos.x), 8, D.rushSpeed);
    } else {
      const dx = this.alarmX - this.pos.x;
      const dz = this.alarmZ - this.pos.z;
      const far = dx * dx + dz * dz > 2.25;
      this.activity = L('act.searchEnemy');
      this.surfaceMove(dt, w, far ? Math.atan2(dz, dx) : this.heading + w.rng.gauss(0, 1) * 2 * Math.sqrt(dt), 6, far ? D.rushSpeed : 0.7);
    }
    if (this.alarmT <= 0) {
      this.activity = this.taskActivity;
      this.note(w, L('note.alarmEnd'));
    }
  }

  /** 强制中断当前协程（死亡或任务失效时） */
  abort(): void {
    this.routine = null;
    this.cmd = null;
    this.exitBlocked = false;
    this.plugging = -1;
    this.guarding = false;
  }

  private step(dt: number, w: World, cmd: Command): boolean {
    const first = !this.cmdInit;
    this.cmdInit = true;
    this.moving = false;
    switch (cmd.k) {
      case 'goto':
        return this.domain === 'surface' ? true : this.stepGoto(dt, w, cmd.node);
      case 'room':
        return this.stepRoom(dt, w, cmd, first);
      case 'exit':
        return this.stepExit(dt, w, first, cmd.giveUp === true);
      case 'enter':
        return this.stepEnter(dt, w, first);
      case 'search':
        return this.stepSearch(dt, w, cmd, first);
      case 'walk':
        return this.stepWalk(dt, w, cmd);
      case 'patrol':
        return this.stepPatrol(dt, w, cmd, first);
      case 'wait':
        if (first) this.timer = cmd.time;
        this.timer -= dt;
        return this.timer <= 0;
      case 'climb':
        return this.stepClimb(dt, w, cmd, first);
    }
  }

  // ---------------- 巢内运动 ----------------

  private nestSpeed(w: World): number {
    return CONFIG.ant.speedNest * this.pace * this.speedFactor(w);
  }

  private stepGoto(dt: number, w: World, target: number): boolean {
    const nest = w.nest;
    const step = this.nestSpeed(w) * dt;
    if (this.room >= 0) {
      const c = nest.chambers[this.room];
      if (!this.moveOnFloor(nest.nodes[c.door].pos, step, c.floor.y)) return false;
      this.room = -1;
      this.walk.node = c.door;
    }
    const r = this.walk.advance(nest, step, target);
    if (this.walk.moved) {
      this.moving = true;
      this.gait += this.walk.walked * 9;
    }
    if (r === 'walking') this.placeOnEdge(w);
    else if (r === 'arrived') this.navTarget.copy(nest.nodes[target].pos);
    return r === 'arrived' || r === 'noRoute';
  }

  /** 沿隧道地面行走：位置贴近隧道底部，并按靠右通行偏移 */
  private placeOnEdge(w: World): void {
    const e = this.walk.edge!;
    w.nest.sampleEdge(e, this.walk.from, this.walk.s, _c, _t);
    tunnelFloor(_c, _t, e.radius, this.laneOffset(), this.navTarget, _f);
    this.fwd.lerp(_t, 0.35).normalize();
    this.up.lerp(_f.negate(), 0.25).normalize();
  }

  private moveOnFloor(target: THREE.Vector3, step: number, floorY: number): boolean {
    const dx = target.x - this.navTarget.x;
    const dz = target.z - this.navTarget.z;
    const d = Math.hypot(dx, dz);
    this.navTarget.y += (floorY - this.navTarget.y) * 0.2;
    if (d < 0.25) return true;
    const k = Math.min(1, step / d);
    this.navTarget.x += dx * k;
    this.navTarget.z += dz * k;
    _f.set(dx / d, 0, dz / d);
    this.fwd.lerp(_f, 0.25).normalize();
    this.up.lerp(_n.set(0, 1, 0), 0.2).normalize();
    this.moving = true;
    this.gait += step * 9;
    return false;
  }

  private laneOffset(): number {
    return clamp(this.lane * 0.42 + this.side, -0.55, 0.55);
  }

  /** 在隧道里时写入 sepS（从 edge.a 量起的沿边坐标）和 sepLat（不随行进方向翻转的横向坐标） */
  measureTunnel(): void {
    const e = this.walk.edge!;
    this.sepS = this.walk.along();
    this.sepLat = this.walk.dir() * this.laneOffset() * e.radius;
    this.sepPush = 0;
  }

  /** 按 sepPush（横向坐标上的推力）往旁边让；没有推力时慢慢回到自己的 lane */
  shiftSide(dt: number): void {
    const e = this.walk.edge!;
    if (this.sepPush !== 0) {
      this.side = clamp(this.side + (this.walk.dir() * this.sepPush * 0.5) / e.radius, -0.8, 0.8);
    } else this.side -= this.side * Math.min(1, dt * 0.5);
  }

  /**
   * 地表和房间里与 near 中的同伴互相推开，dt 是两次调用的间隔。走动中的只轻推，保证能走到目标点。
   * 隧道里的避让见 Colony.separate。
   */
  avoid(w: World, near: Ant[], dt: number): void {
    if (this.climbing || this.pitT > 0 || (this.domain === 'nest' && this.room < 0)) return;
    const R = CONFIG.ant.personalSpace;
    let px = 0;
    let pz = 0;
    for (const b of near) {
      if (b.domain !== this.domain || b.climbing) continue;
      const queen = b.role === 'queen';
      const min = R * (queen ? 1 + CONFIG.ant.queenScale : 2);
      const dx = this.pos.x - b.pos.x;
      const dy = this.pos.y - b.pos.y;
      const dz = this.pos.z - b.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min) continue;
      const k = (min - Math.sqrt(d2)) * (queen ? 1 : 0.5);
      const dh = Math.hypot(dx, dz);
      if (dh < 1e-3) {
        const a = this.id * 2.39996;
        px += Math.cos(a) * k;
        pz += Math.sin(a) * k;
      } else {
        px += (dx / dh) * k;
        pz += (dz / dh) * k;
      }
    }
    const len = Math.hypot(px, pz);
    if (len < 1e-4) return;
    const cap = (this.moving ? 0.18 : 0.6) * dt;
    if (len > cap) {
      px *= cap / len;
      pz *= cap / len;
    }
    const nx = this.pos.x + px;
    const nz = this.pos.z + pz;
    if (this.domain === 'surface') {
      if (w.veg.obstacleAt(nx, nz, 0.3, true) || Math.hypot(nx, nz) > CONFIG.world.forageRadius) return;
      this.pos.set(nx, w.terrain.heightAt(nx, nz) + w.predators.liftAt(nx, nz), nz);
    } else {
      if (!w.nest.insideFloor(w.nest.chambers[this.room], nx, nz, 0.8)) return;
      this.pos.x = nx;
      this.pos.z = nz;
      this.navTarget.x += px;
      this.navTarget.z += pz;
    }
  }

  private smoothNest(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    this.pos.lerp(this.navTarget, k);
  }

  private stepRoom(dt: number, w: World, cmd: Extract<Command, { k: 'room' }>, first: boolean): boolean {
    const c = w.nest.chambers[cmd.chamber];
    if (this.domain === 'surface') return true;
    if (this.room !== cmd.chamber) {
      if (!this.stepGoto(dt, w, c.door)) return false;
      this.room = cmd.chamber;
      this.walk.node = -1;
      first = true;
    }
    if (first) {
      this.timer = cmd.time;
      this.pauseT = 0;
      if (cmd.point) this.localTarget.copy(cmd.point);
      else w.nest.randomFloorPoint(c, () => w.rng.next(), this.localTarget);
    }
    this.timer -= dt;
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return this.timer <= 0;
    }
    const arrived = this.moveOnFloor(this.localTarget, this.nestSpeed(w) * dt * 0.7, c.floor.y);
    if (arrived) {
      if (cmd.point) return this.timer <= 0;
      this.pauseT = w.rng.range(0.6, 4.5);
      w.nest.randomFloorPoint(c, () => w.rng.next(), this.localTarget);
    }
    return this.timer <= 0 && !cmd.point;
  }

  private stepExit(dt: number, w: World, first: boolean, giveUp: boolean): boolean {
    if (this.domain === 'surface') return true;
    if (first) {
      const from = this.currentNode(w);
      const open = w.nest.entrances.filter((e) => e.plug < 1);
      let best = w.nest.entrances[0];
      let bd = Infinity;
      for (const e of open.length ? open : w.nest.entrances) {
        const d = w.nest.routeLength(from, e.node) * w.rng.range(0.8, 1.25);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      this.entranceTarget = w.nest.entrances.indexOf(best);
    }
    const ent = w.nest.entrances[this.entranceTarget];
    if (!this.stepGoto(dt, w, ent.node)) return false;
    if (ent.plug >= 1) {
      const other = w.nest.entrances.findIndex((e) => e.plug < 1);
      if (other >= 0) this.entranceTarget = other;
      else if (giveUp) {
        this.result = 'blocked';
        return true;
      } else if (!this.exitBlocked) {
        this.exitBlocked = true;
        this.taskActivity = this.activity;
        this.activity = L('act.waitSealed', { ent: ent.label });
      }
      return false;
    }
    if (this.exitBlocked) {
      this.exitBlocked = false;
      this.activity = this.taskActivity;
    }
    this.placeOnSurface(ent.x, ent.z, w);
    this.heading = Math.atan2(ent.z, ent.x) + w.rng.range(-1.6, 1.6);
    if (ent.x === 0 && ent.z === 0) this.heading = w.rng.range(-Math.PI, Math.PI);
    this.memoryChecked = false;
    return true;
  }

  // ---------------- 地表运动 ----------------

  private skirt(cx: number, cz: number): void {
    this.heading = this.skirtNav.steer(this.pos.x, this.pos.z, this.heading, cx, cz);
  }

  private surfaceMove(dt: number, w: World, desired: number | null, turnRate = 5, speedMul = 1): void {
    if (desired !== null) this.heading = turnToward(this.heading, desired, turnRate, dt);
    const wetHere = w.water.at(this.pos.x, this.pos.z);
    const pit = w.predators.pitAt(this.pos.x, this.pos.z);
    let pdx = 0;
    let pdz = 0;
    let pull = 0;
    if (pit) {
      // 坑壁的松沙让蚂蚁往中心滑，越靠中心越陡；发觉打滑后拼命往坑外爬。蚁狮进食时不再扬沙，坑壁滑得慢
      const P = CONFIG.predators;
      pdx = this.pos.x - pit.x;
      pdz = this.pos.z - pit.z;
      const r = Math.hypot(pdx, pdz) || 0.01;
      pdx /= r;
      pdz /= r;
      pull = P.pitPull * (pit.feedT > 0 ? 0.35 : 1) * (0.4 + 0.6 * (1 - r / P.pitRadius)) * dt;
      this.pitT += dt;
      this.pitX = pit.x;
      this.pitZ = pit.z;
      if (this.pitT > 0.6) this.heading = Math.atan2(pdz, pdx) + (((this.id * 0.618) % 1) - 0.5) * 0.8;
    } else {
      if (this.pitT > 0.6) {
        this.avoidPit = { x: this.pitX, z: this.pitZ };
        this.note(w, L('note.escapedPit'));
      }
      this.pitT = 0;
    }
    const step = CONFIG.ant.speedSurface * this.speedFactor(w) * speedMul * (wetHere ? 0.35 : 1) * (pit ? 0.4 : 1) * dt;
    let nx = this.pos.x + Math.cos(this.heading) * step - pdx * pull;
    let nz = this.pos.z + Math.sin(this.heading) * step - pdz * pull;
    // 水洼是软障碍：先沿边缘绕行，被挡住几秒（目标在水里、或水洼盖住入口）就蹚水过去
    this.skirtNav.track(this.pos.x, this.pos.z, dt);
    const pd = wetHere ? null : w.water.at(nx, nz);
    if (pd && this.wadeT < 4) {
      this.wadeT += dt;
      this.skirt(pd.x, pd.z);
      nx = this.pos.x + Math.cos(this.heading) * step;
      nz = this.pos.z + Math.sin(this.heading) * step;
      if (w.water.at(nx, nz)) {
        nx = this.pos.x;
        nz = this.pos.z;
      }
    } else if (!pd && !wetHere) this.wadeT = Math.max(0, this.wadeT - dt * 0.5);
    const ap = this.avoidPit;
    if (ap && !pit) {
      const R = CONFIG.predators.pitRadius + CONFIG.defense.pitAvoidPad;
      if ((nx - ap.x) ** 2 + (nz - ap.z) ** 2 < R * R) {
        this.pitAvoidT += dt;
        // 目标就在坑里时绕不开，绕了一会儿就不再理会
        if (this.pitAvoidT > 6) this.avoidPit = null;
        else {
          this.skirt(ap.x, ap.z);
          nx = this.pos.x + Math.cos(this.heading) * step;
          nz = this.pos.z + Math.sin(this.heading) * step;
        }
      } else this.pitAvoidT = Math.max(0, this.pitAvoidT - dt);
    }
    const ob = w.veg.obstacleAt(nx, nz, 0.35, true);
    if (ob) {
      this.skirt(ob.x, ob.z);
      nx = this.pos.x + Math.cos(this.heading) * step;
      nz = this.pos.z + Math.sin(this.heading) * step;
      const ob2 = w.veg.obstacleAt(nx, nz, 0.3, true);
      if (ob2) {
        const a = Math.atan2(nz - ob2.z, nx - ob2.x);
        nx = ob2.x + Math.cos(a) * (ob2.r + 0.4);
        nz = ob2.z + Math.sin(a) * (ob2.r + 0.4);
      }
    }
    if (Math.hypot(nx, nz) > CONFIG.world.forageRadius) {
      this.heading = Math.atan2(-this.pos.z, -this.pos.x) + w.rng.range(-0.6, 0.6);
      return;
    }
    this.pos.set(nx, w.terrain.heightAt(nx, nz) + w.predators.liftAt(nx, nz), nz);
    w.pheromone.depositHome(nx, nz, CONFIG.pheromone.depositHome * dt);
    w.terrain.normalAt(nx, nz, _n);
    alignToGround(this.up, this.fwd, this.heading, _n);
    this.moving = true;
    this.gait += step * 9;
  }

  private stepEnter(dt: number, w: World, first: boolean): boolean {
    if (this.domain === 'nest') return true;
    if (first) {
      const e = w.nest.nearestEntrance(this.pos.x, this.pos.z);
      this.entranceTarget = w.nest.entrances.indexOf(e);
      this.pathNoise = w.rng.range(-0.25, 0.25);
    }
    const ent = w.nest.entrances[this.entranceTarget];
    const dx = ent.x - this.pos.x;
    const dz = ent.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) {
      this.domain = 'nest';
      this.walk.at(ent.node);
      this.room = -1;
      this.navTarget.copy(this.pos);
      return true;
    }
    // 路径整合：直接朝向巢口，误差随距离减小
    this.pathNoise += w.rng.gauss(0, 0.6) * dt;
    this.pathNoise *= 0.995;
    const desired = Math.atan2(dz, dx) + this.pathNoise * Math.min(1, d / 30);
    this.surfaceMove(dt, w, desired, 4);
    const carryingFood = this.crop > 0 || this.carrying?.type === 'food';
    if (carryingFood && this.layTrail > 0) w.pheromone.deposit(this.pos.x, this.pos.z, this.layTrail * dt);
    return false;
  }

  /** 返巢时释放的路径信息素强度，由行为层根据食物质量设置 */
  layTrail = 0;

  private stepSearch(dt: number, w: World, cmd: Extract<Command, { k: 'search' }>, first: boolean): boolean {
    if (this.domain === 'nest') return true;
    if (first) this.timer = cmd.time;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.result = null;
      return true;
    }
    const x = this.pos.x;
    const z = this.pos.z;
    const food = w.food.nearest(x, z, CONFIG.ant.senseFoodRadius);
    const aphid = food ? null : w.aphids.nearest(x, z, CONFIG.ant.senseFoodRadius);
    let desired: number | null = null;
    if (food) {
      const d = Math.hypot(food.x - x, food.z - z);
      if (d < food.radius + 0.5) {
        this.result = food;
        return true;
      }
      desired = Math.atan2(food.z - z, food.x - x);
    } else if (aphid) {
      // 植物茎是障碍物，走到茎旁约 1.7 单位处就算到达
      if (Math.hypot(aphid.x - x, aphid.z - z) < 1.9) {
        this.result = aphid;
        return true;
      }
      desired = Math.atan2(aphid.z - z, aphid.x - x);
    } else if (this.memory && !this.memoryChecked) {
      const dx = this.memory.x - x;
      const dz = this.memory.z - z;
      if (dx * dx + dz * dz < 16) {
        this.memoryChecked = true;
        this.memory = null;
      } else desired = Math.atan2(dz, dx) + w.rng.gauss(0, 0.15);
    } else {
      desired = this.followTrail(w);
    }
    if (desired === null) {
      this.heading += w.rng.gauss(0, 1) * 1.4 * Math.sqrt(dt);
      if (this.scout && w.pheromone.sampleHome(x + Math.cos(this.heading) * 4, z + Math.sin(this.heading) * 4) > 0.3) {
        desired = this.leastMarked(w);
      }
    }
    this.surfaceMove(dt, w, desired, food || aphid ? 6 : 3.5);
    return false;
  }

  /** 侦察蚁偏向同伴足迹较少的方向，以探索未开发的区域 */
  private leastMarked(w: World): number | null {
    let best = Infinity;
    let bestA: number | null = null;
    for (const off of [-0.8, 0, 0.8]) {
      const a = this.heading + off;
      const v = w.pheromone.sampleHome(this.pos.x + Math.cos(a) * 4, this.pos.z + Math.sin(a) * 4);
      if (v < best) {
        best = v;
        bestA = a;
      }
    }
    return bestA;
  }

  /** 三个触角感受点比较信息素浓度；出巢时偏向远离蚁穴的一侧 */
  private followTrail(w: World): number | null {
    const sd = 2.2;
    const fidelity = this.scout ? 0.25 : 1;
    const ent = w.nest.entrances[0];
    const ax = this.pos.x - ent.x;
    const az = this.pos.z - ent.z;
    const al = Math.hypot(ax, az) || 1;
    let best = 0;
    let bestA = 0;
    for (const off of [-0.65, 0, 0.65]) {
      const a = this.heading + off;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const p = w.pheromone.sample(this.pos.x + cx * sd, this.pos.z + cz * sd);
      const out = (cx * ax + cz * az) / al;
      const v = p * fidelity * Math.max(0.05, 1 + 0.9 * out);
      if (v > best) {
        best = v;
        bestA = a;
      }
    }
    return best > 0.06 ? bestA + w.rng.gauss(0, 0.1) : null;
  }

  private stepWalk(dt: number, w: World, cmd: Extract<Command, { k: 'walk' }>): boolean {
    if (this.domain === 'nest') return true;
    const dx = cmd.x - this.pos.x;
    const dz = cmd.z - this.pos.z;
    if (dx * dx + dz * dz < cmd.r * cmd.r) return true;
    this.surfaceMove(dt, w, Math.atan2(dz, dx) + w.rng.gauss(0, 0.2), 5);
    return false;
  }

  private stepPatrol(dt: number, w: World, cmd: Extract<Command, { k: 'patrol' }>, first: boolean): boolean {
    if (this.domain === 'nest') return true;
    if (first) this.timer = cmd.time;
    this.timer -= dt;
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return this.timer <= 0;
    }
    if (w.rng.chance(dt * 0.25)) this.pauseT = w.rng.range(0.5, 3);
    const dx = cmd.x - this.pos.x;
    const dz = cmd.z - this.pos.z;
    let desired: number | null = null;
    if (dx * dx + dz * dz > cmd.radius * cmd.radius) desired = Math.atan2(dz, dx);
    else this.heading += w.rng.gauss(0, 1) * 4 * Math.sqrt(dt);
    this.surfaceMove(dt, w, desired, 4, 0.7);
    return this.timer <= 0;
  }

  /** 路径：先沿地面靠近茎，再沿茎竖直向上；climbS 是沿路径走过的距离 */
  private stepClimb(dt: number, w: World, cmd: Extract<Command, { k: 'climb' }>, first: boolean): boolean {
    if (this.domain === 'nest') return true;
    const ra = cmd.r + 0.05;
    if (first) {
      this.climbS = 0;
      this.climbPhase = 0;
      this.climbR0 = Math.max(ra, Math.hypot(this.pos.x - cmd.x, this.pos.z - cmd.z));
      this.climbY0 = w.terrain.heightAt(cmd.x + Math.cos(cmd.angle) * ra, cmd.z + Math.sin(cmd.angle) * ra);
      this.timer = cmd.stay;
    }
    const flat = this.climbR0 - ra;
    const total = flat + Math.max(0, cmd.top - this.climbY0);
    const sp = CONFIG.ant.speedSurface * this.speedFactor(w) * 0.6 * dt;
    if (this.climbPhase === 0) {
      this.climbS = Math.min(total, this.climbS + sp);
      if (this.climbS >= total) this.climbPhase = 1;
    } else if (this.climbPhase === 1) {
      this.timer -= dt;
      if (this.timer <= 0) this.climbPhase = 2;
    } else {
      this.climbS -= sp;
      if (this.climbS <= 0) {
        this.heading = cmd.angle;
        this.placeOnSurface(cmd.x + Math.cos(cmd.angle) * this.climbR0, cmd.z + Math.sin(cmd.angle) * this.climbR0, w);
        return true;
      }
    }
    const ca = Math.cos(cmd.angle);
    const sa = Math.sin(cmd.angle);
    const s = this.climbS;
    const dir = this.climbPhase === 2 ? -1 : 1;
    if (s < flat) {
      const rad = this.climbR0 - s;
      const px = cmd.x + ca * rad;
      const pz = cmd.z + sa * rad;
      this.pos.set(px, w.terrain.heightAt(px, pz), pz);
      w.terrain.normalAt(px, pz, _n);
      _f.set(-ca * dir, 0, -sa * dir);
    } else {
      this.pos.set(cmd.x + ca * ra, this.climbY0 + (s - flat), cmd.z + sa * ra);
      _n.set(ca, 0, sa);
      _f.set(0, dir, 0);
    }
    this.up.lerp(_n, 0.3).normalize();
    // 在茎顶掉头时前向反转，插值无法跨过 180°
    if (this.fwd.dot(_f) < -0.3) this.fwd.copy(_f);
    else this.fwd.lerp(_f, 0.3).normalize();
    if (this.climbPhase !== 1) {
      this.moving = true;
      this.gait += sp * 9;
    }
    return false;
  }

  /** 正在植物茎上（爬升、停留或下降中） */
  get climbing(): boolean {
    return this.cmd?.k === 'climb' && this.cmdInit;
  }

  /** 携带物在上颚处的位置 */
  mouthPosition(out: THREE.Vector3): THREE.Vector3 {
    const s = this.size * (this.role === 'queen' ? CONFIG.ant.queenScale : 1);
    return out
      .copy(this.pos)
      .addScaledVector(this.fwd, 0.55 * s)
      .addScaledVector(this.up, 0.16 * s);
  }
}

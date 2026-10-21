import * as THREE from 'three';
import { CONFIG, type Role } from '../config';
import { clamp, wrapAngle } from '../util/math';
import { rng } from '../util/random';
import type { NestEdge } from '../nest/nest';
import type { World } from '../world/world';
import type { Item } from './items';

/** 行为协程向“运动层”下达的原子指令，完成后协程才会继续执行。 */
export type Command =
  | { k: 'goto'; node: number }
  | { k: 'room'; chamber: number; time: number; point?: THREE.Vector3 }
  | { k: 'exit' }
  | { k: 'enter' }
  | { k: 'search'; time: number }
  | { k: 'walk'; x: number; z: number; r: number }
  | { k: 'patrol'; x: number; z: number; radius: number; time: number }
  | { k: 'wait'; time: number }
  /** 沿植物茎爬到 top 高度，停留 stay 秒后爬回地面 */
  | { k: 'climb'; x: number; z: number; angle: number; r: number; top: number; stay: number };

export type Routine = Generator<Command, void, unknown>;

export interface LogEntry {
  t: string;
  msg: string;
}

const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _n = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

let nextAntId = 1;

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
  log: LogEntry[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Ant {
  id = nextAntId++;
  role: Role;
  scout = false;
  ageDays: number;
  lifespan: number;
  hunger = rng.range(0, 0.4);
  health = 1;
  alive = true;
  size = rng.range(0.86, 1.08);

  domain: 'surface' | 'nest' = 'nest';
  pos = new THREE.Vector3();
  fwd = new THREE.Vector3(1, 0, 0);
  up = new THREE.Vector3(0, 1, 0);
  moving = false;
  gait = rng.range(0, 6.28);

  // 地表运动
  heading = rng.range(-Math.PI, Math.PI);
  private entranceTarget = -1;
  private pathNoise = 0;
  /** 觅食地点记忆（黑毛蚁觅食蚁具有地点忠诚性） */
  memory: { x: number; z: number } | null = null;
  private memoryChecked = false;

  // 巢内运动
  node = -1;
  room = -1;
  edge: NestEdge | null = null;
  private edgeFrom = -1;
  private edgeS = 0;
  private lane = rng.range(-0.15, 0.75);
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
  activity = '待命';
  log: LogEntry[] = [];

  trips = 0;
  delivered = 0;

  /** 分工调整后待切换的职别，在当前任务结束后生效 */
  nextRole: Role | null = null;
  /** 行为年龄相对真实日龄的偏移：同龄工蚁转换分工有早有晚 */
  ageBias = rng.gauss(0, CONFIG.polyethism.ageJitterDays);
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
  private nextAlarmCheck = rng.range(0, 0.5);
  private taskActivity = '';
  /** 正在撕咬的狼蛛 */
  mobTarget = -1;
  /** 因为狼蛛逼近而出巢警戒（日常的入口巡逻不算） */
  guarding = false;
  private avoidSign = 1;
  private avoidT = 0;
  private blockedT = 0;
  private blockX = 0;
  private blockZ = 0;
  nextContactAt = rng.range(0, 10);
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

  constructor(role: Role, ageDays: number) {
    this.role = role;
    this.ageDays = ageDays;
    const [a, b] = CONFIG.colony.workerLifespanDays;
    this.lifespan = role === 'queen' ? 9999 : rng.range(a, b);
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
    const a = new Ant(s.role, s.age);
    a.id = s.id;
    nextAntId = Math.max(nextAntId, s.id + 1);
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
    a.log = s.log;
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
      a.node = nest.nodes[s.node] ? s.node : nest.entrances[0].node;
      a.pos.copy(nest.nodes[a.node].pos);
    }
    a.localTarget.copy(a.pos);
    a.navTarget.copy(a.pos);
    return a;
  }

  note(w: World, msg: string): void {
    this.log.unshift({ t: w.clock.stamp(), msg });
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
    this.node = -1;
    this.edge = null;
    w.nest.randomFloorPoint(c, rng.next.bind(rng), this.pos);
    this.localTarget.copy(this.pos);
    this.navTarget.copy(this.pos);
    this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
  }

  placeOnSurface(x: number, z: number, w: World): void {
    this.domain = 'surface';
    this.room = -1;
    this.edge = null;
    this.pos.set(x, w.terrain.heightAt(x, z), z);
  }

  /** 当前所在的蚁穴节点（用于寻路起点） */
  currentNode(w: World): number {
    if (this.room >= 0) return w.nest.chambers[this.room].door;
    if (this.edge) return this.edgeS > this.edge.length / 2 ? (this.edge.a === this.edgeFrom ? this.edge.b : this.edge.a) : this.edgeFrom;
    return this.node;
  }

  locationLabel(w: World): string {
    if (this.domain === 'surface') return '地表';
    if (this.room >= 0) return w.nest.chambers[this.room].name;
    if (this.edge) return this.edge.isShaft ? '主竖井' : '隧道';
    const n = w.nest.nodes[this.node];
    if (n?.kind === 'entrance') return '入口';
    return '隧道';
  }

  depth(w: World): number {
    return Math.max(0, w.nest.surfaceY - this.pos.y);
  }

  /** 体温随环境温度变化，影响行进速度 */
  private speedFactor(w: World): number {
    const t = w.clock.temperatureAt(this.domain === 'surface' ? 0 : this.depth(w));
    const f = clamp((t - 4) / 18, 0.3, 1.25);
    return f * (this.role === 'queen' ? 0.35 : 1) * (this.health < 0.4 ? 0.6 : 1);
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
    this.alarmT = rng.range(D.defendSec[0], D.defendSec[1]);
    this.alarmX = src.x;
    this.alarmZ = src.z;
    this.taskActivity = this.activity;
    this.note(w, '闻到警报信息素，赶去增援');
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
        this.activity = '围攻狼蛛：咬住它的腿，喷射蚁酸';
        return;
      }
      this.activity = '闻到警报信息素，冲向狼蛛';
      this.surfaceMove(dt, w, Math.atan2(s.z - this.pos.z, s.x - this.pos.x), 8, D.rushSpeed);
    } else {
      const dx = this.alarmX - this.pos.x;
      const dz = this.alarmZ - this.pos.z;
      const far = dx * dx + dz * dz > 2.25;
      this.activity = '闻到警报信息素，在附近搜寻敌人';
      this.surfaceMove(dt, w, far ? Math.atan2(dz, dx) : this.heading + rng.gauss(0, 1) * 2 * Math.sqrt(dt), 6, far ? D.rushSpeed : 0.7);
    }
    if (this.alarmT <= 0) {
      this.activity = this.taskActivity;
      this.note(w, '警报解除，回去继续工作');
    }
  }

  /** 强制中断当前协程（死亡或任务失效时） */
  abort(): void {
    this.routine = null;
    this.cmd = null;
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
        return this.stepExit(dt, w, first);
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
    return CONFIG.ant.speedNest * this.speedFactor(w);
  }

  private stepGoto(dt: number, w: World, target: number): boolean {
    const nest = w.nest;
    let step = this.nestSpeed(w) * dt;
    if (this.room >= 0) {
      const c = nest.chambers[this.room];
      if (!this.moveOnFloor(nest.nodes[c.door].pos, step, c.floor.y)) return false;
      this.room = -1;
      this.node = c.door;
    }
    for (let i = 0; i < 3; i++) {
      if (this.edge) {
        this.edgeS += step;
        this.moving = true;
        this.gait += step * 9;
        if (this.edgeS < this.edge.length) {
          this.placeOnEdge(w);
          return false;
        }
        step = this.edgeS - this.edge.length;
        this.node = this.edge.a === this.edgeFrom ? this.edge.b : this.edge.a;
        this.edge = null;
      }
      if (this.node === target) {
        this.navTarget.copy(nest.nodes[this.node].pos);
        return true;
      }
      const nh = nest.nextHop(this.node, target);
      if (nh < 0) return true;
      this.edge = nest.edgeBetween(this.node, nh);
      this.edgeFrom = this.node;
      this.edgeS = 0;
    }
    return false;
  }

  /** 沿隧道地面行走：位置贴近隧道底部，并按靠右通行偏移 */
  private placeOnEdge(w: World): void {
    const e = this.edge!;
    w.nest.sampleEdge(e, this.edgeFrom, this.edgeS, _c, _t);
    _f.copy(DOWN).addScaledVector(_t, -DOWN.dot(_t));
    if (_f.lengthSq() < 0.04) _f.set(1, 0, 0).cross(_t);
    _f.normalize();
    _l.crossVectors(_t, _f).normalize();
    this.navTarget
      .copy(_c)
      .addScaledVector(_f, e.radius * 0.66)
      .addScaledVector(_l, this.lane * e.radius * 0.42);
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
      this.node = -1;
      first = true;
    }
    if (first) {
      this.timer = cmd.time;
      this.pauseT = 0;
      if (cmd.point) this.localTarget.copy(cmd.point);
      else w.nest.randomFloorPoint(c, rng.next.bind(rng), this.localTarget);
    }
    this.timer -= dt;
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return this.timer <= 0;
    }
    const arrived = this.moveOnFloor(this.localTarget, this.nestSpeed(w) * dt * 0.7, c.floor.y);
    if (arrived) {
      if (cmd.point) return this.timer <= 0;
      this.pauseT = rng.range(0.6, 4.5);
      w.nest.randomFloorPoint(c, rng.next.bind(rng), this.localTarget);
    }
    return this.timer <= 0 && !cmd.point;
  }

  private stepExit(dt: number, w: World, first: boolean): boolean {
    if (this.domain === 'surface') return true;
    if (first) {
      const from = this.currentNode(w);
      let best = w.nest.entrances[0];
      let bd = Infinity;
      for (const e of w.nest.entrances) {
        const d = w.nest.routeLength(from, e.node) * rng.range(0.8, 1.25);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      this.entranceTarget = w.nest.entrances.indexOf(best);
    }
    const ent = w.nest.entrances[this.entranceTarget];
    if (!this.stepGoto(dt, w, ent.node)) return false;
    this.placeOnSurface(ent.x, ent.z, w);
    this.heading = Math.atan2(ent.z, ent.x) + rng.range(-1.6, 1.6);
    if (ent.x === 0 && ent.z === 0) this.heading = rng.range(-Math.PI, Math.PI);
    this.memoryChecked = false;
    return true;
  }

  // ---------------- 地表运动 ----------------

  /**
   * 沿障碍物边缘绕行。绕行方向（顺/逆时针）会保持一段时间，否则在凹角处每步重新选择会来回摆动、原地打转；
   * 长时间没有离开原地时换一个方向。
   */
  private skirt(cx: number, cz: number): void {
    const radial = Math.atan2(this.pos.z - cz, this.pos.x - cx);
    if (this.avoidT <= 0) {
      this.avoidSign = Math.abs(wrapAngle(radial + Math.PI / 2 - this.heading)) < Math.PI / 2 ? 1 : -1;
      this.blockX = this.pos.x;
      this.blockZ = this.pos.z;
      this.blockedT = 0;
    }
    this.avoidT = 1.5;
    if (this.blockedT > 3) {
      this.avoidSign = -this.avoidSign;
      this.blockedT = 0;
    }
    this.heading = radial + (this.avoidSign * Math.PI) / 2;
  }

  /** 绕行期间按真实时间累计“没走出 3 cm”的时长 */
  private trackBlocked(dt: number): void {
    if (this.avoidT <= 0) return;
    if (Math.hypot(this.pos.x - this.blockX, this.pos.z - this.blockZ) > 3) {
      this.blockX = this.pos.x;
      this.blockZ = this.pos.z;
      this.blockedT = 0;
    } else this.blockedT += dt;
  }

  private surfaceMove(dt: number, w: World, desired: number | null, turnRate = 5, speedMul = 1): void {
    if (desired !== null) {
      const d = wrapAngle(desired - this.heading);
      this.heading += clamp(d, -turnRate * dt, turnRate * dt);
    }
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
        this.note(w, '从蚁狮的陷阱里爬了出来，记住了这个地方');
      }
      this.pitT = 0;
    }
    const step = CONFIG.ant.speedSurface * this.speedFactor(w) * speedMul * (wetHere ? 0.35 : 1) * (pit ? 0.4 : 1) * dt;
    let nx = this.pos.x + Math.cos(this.heading) * step - pdx * pull;
    let nz = this.pos.z + Math.sin(this.heading) * step - pdz * pull;
    // 水洼是软障碍：先沿边缘绕行，被挡住几秒（目标在水里、或水洼盖住入口）就蹚水过去
    this.trackBlocked(dt);
    this.avoidT -= dt;
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
      this.heading = Math.atan2(-this.pos.z, -this.pos.x) + rng.range(-0.6, 0.6);
      return;
    }
    this.pos.set(nx, w.terrain.heightAt(nx, nz) + w.predators.liftAt(nx, nz), nz);
    w.pheromone.depositHome(nx, nz, CONFIG.pheromone.depositHome * dt);
    w.terrain.normalAt(nx, nz, _n);
    this.up.lerp(_n, 0.2).normalize();
    _f.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    _f.addScaledVector(this.up, -_f.dot(this.up)).normalize();
    this.fwd.copy(_f);
    this.moving = true;
    this.gait += step * 9;
  }

  private stepEnter(dt: number, w: World, first: boolean): boolean {
    if (this.domain === 'nest') return true;
    if (first) {
      const e = w.nest.nearestEntrance(this.pos.x, this.pos.z);
      this.entranceTarget = w.nest.entrances.indexOf(e);
      this.pathNoise = rng.range(-0.25, 0.25);
    }
    const ent = w.nest.entrances[this.entranceTarget];
    const dx = ent.x - this.pos.x;
    const dz = ent.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) {
      this.domain = 'nest';
      this.node = ent.node;
      this.room = -1;
      this.edge = null;
      this.navTarget.copy(this.pos);
      return true;
    }
    // 路径整合：直接朝向巢口，误差随距离减小
    this.pathNoise += rng.gauss(0, 0.6) * dt;
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
      } else desired = Math.atan2(dz, dx) + rng.gauss(0, 0.15);
    } else {
      desired = this.followTrail(w);
    }
    if (desired === null) {
      this.heading += rng.gauss(0, 1) * 1.4 * Math.sqrt(dt);
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
    return best > 0.06 ? bestA + rng.gauss(0, 0.1) : null;
  }

  private stepWalk(dt: number, w: World, cmd: Extract<Command, { k: 'walk' }>): boolean {
    if (this.domain === 'nest') return true;
    const dx = cmd.x - this.pos.x;
    const dz = cmd.z - this.pos.z;
    if (dx * dx + dz * dz < cmd.r * cmd.r) return true;
    this.surfaceMove(dt, w, Math.atan2(dz, dx) + rng.gauss(0, 0.2), 5);
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
    if (rng.chance(dt * 0.25)) this.pauseT = rng.range(0.5, 3);
    const dx = cmd.x - this.pos.x;
    const dz = cmd.z - this.pos.z;
    let desired: number | null = null;
    if (dx * dx + dz * dz > cmd.radius * cmd.radius) desired = Math.atan2(dz, dx);
    else this.heading += rng.gauss(0, 1) * 4 * Math.sqrt(dt);
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

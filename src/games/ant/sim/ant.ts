import * as THREE from 'three';
import { CONFIG, type Role } from '../config';
import { asText, L, type Text } from '../../../core/i18n';
import { GraphWalker } from '../../../core/move/graph';
import { Behavior, type Routine as CoreRoutine } from '../../../core/sim/behavior';
import { Skirt } from '../../../core/move/surface';
import { clamp } from '../../../core/util/math';
import type { NestEdge } from '../nest/nest';
import type { World } from '../world/world';
import type { Item } from './items';
import { smoothNest, stepExit, stepGoto, stepRoom } from './antNest';
import { stepClimb, stepEnter, stepPatrol, stepSearch, stepWalk, surfaceMove } from './antSurface';

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

export type Routine = CoreRoutine<Command>;

/** t 是模拟秒数；较早的存档里 t 和 msg 都是拼好的中文 */
export interface LogEntry {
  t: number | string;
  msg: Text;
}

const _f = new THREE.Vector3();

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
  /** 手里拿着的物品编号；较早的存档没有，读档时那些物品直接送到目的地 */
  carry?: number;
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

  // 地表运动（antSurface.ts 读写，下面不带注释的字段也只给运动层用）
  heading = 0;
  entranceTarget = -1;
  pathNoise = 0;
  /** 觅食地点记忆（黑毛蚁觅食蚁具有地点忠诚性） */
  memory: { x: number; z: number } | null = null;
  memoryChecked = false;

  // 巢内运动（antNest.ts 读写）
  room = -1;
  /** 在隧道网络里的位置（房间里时 node 是 -1） */
  readonly walk = new GraphWalker<NestEdge>();
  lane = 0;
  /** 隧道里为避开同伴而偏离 lane 的横向距离（隧道半径的倍数） */
  side = 0;
  /** separate（colonySocial.ts）的临时量：沿边坐标、横向坐标、横向推力 */
  sepS = 0;
  sepLat = 0;
  sepPush = 0;
  /** 个体步速差异：同时出发的同伴不会一直并排走 */
  pace = 0;
  localTarget = new THREE.Vector3();
  navTarget = new THREE.Vector3();
  pauseT = 0;

  carrying: Item | null = null;
  /** 嗉囊内的液体食物 0..1 */
  crop = 0;
  /** 进食失败后在此模拟时刻之前不再尝试进食 */
  eatRetryAt = 0;

  readonly behavior = new Behavior<Command>();
  timer = 0;
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
  /** 返巢时释放的路径信息素强度，由行为层根据食物质量设置 */
  layTrail = 0;
  /** 被水洼挡住的累计时间，超过阈值后蹚水通过 */
  wadeT = 0;
  /** 在蚁狮陷阱里的时间 */
  pitT = 0;
  pitX = 0;
  pitZ = 0;
  /** 爬出过的陷阱，之后绕开走 */
  avoidPit: { x: number; z: number } | null = null;
  pitAvoidT = 0;
  /** 闻到警报后增援的剩余秒数，期间暂停原来的任务 */
  alarmT = 0;
  private alarmX = 0;
  private alarmZ = 0;
  private nextAlarmCheck = 0;
  taskActivity: Text = L('act.idle');
  /** 正在撕咬的狼蛛 */
  mobTarget = -1;
  /** 因为狼蛛逼近而出巢警戒（日常的入口巡逻不算） */
  guarding = false;
  /** 正在去封堵 / 清开的入口编号 */
  plugging = -1;
  exitBlocked = false;
  /** 体温决定的速度系数，每 0.5 秒按所在深度重新计算 */
  private tempK = 1;
  private tempAt = 0;
  private tempDomain: 'surface' | 'nest' = 'nest';
  skirtNav = new Skirt();
  nextContactAt = 0;
  contacts = 0;
  shares = 0;
  /** 被满载归来的同伴激发、更想出巢觅食的截止时刻 */
  excitedUntil = 0;
  /** 照料的蚜虫群（蚜虫放牧同样有地点忠诚性） */
  herd = -1;
  /** 正在前往或挖掘的工作面节点 */
  digNode = -1;

  climbS = 0;
  climbPhase = 0;
  climbR0 = 0;
  climbY0 = 0;

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
      ...(this.carrying ? { carry: this.carrying.id } : {}),
    };
  }

  /** 读档：恢复个体状态和位置，任务协程从头开始（手里的东西由 Colony.restore 交还，先送到再选新任务）。走在隧道中途的蚂蚁放到最近的节点上，爬在植物上的放回地面 */
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
  speedFactor(w: World): number {
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
      if (this.domain === 'nest') smoothNest(this, dt);
      return;
    }
    if (this.domain === 'surface' && this.role !== 'queen') {
      if (this.alarmT <= 0 && w.clock.seconds >= this.nextAlarmCheck) this.checkAlarm(w);
      if (this.alarmT > 0) {
        this.defend(dt, w);
        return;
      }
    }
    this.behavior.run(
      () => w.colony.newRoutine(this),
      (cmd, first) => this.step(dt, w, cmd, first),
    );
    if (this.domain === 'nest') smoothNest(this, dt);
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
      surfaceMove(this, dt, w, Math.atan2(s.z - this.pos.z, s.x - this.pos.x), 8, D.rushSpeed);
    } else {
      const dx = this.alarmX - this.pos.x;
      const dz = this.alarmZ - this.pos.z;
      const far = dx * dx + dz * dz > 2.25;
      this.activity = L('act.searchEnemy');
      surfaceMove(this, dt, w, far ? Math.atan2(dz, dx) : this.heading + w.rng.gauss(0, 1) * 2 * Math.sqrt(dt), 6, far ? D.rushSpeed : 0.7);
    }
    if (this.alarmT <= 0) {
      this.activity = this.taskActivity;
      this.note(w, L('note.alarmEnd'));
    }
  }

  /** 强制中断当前协程（死亡或任务失效时） */
  abort(): void {
    this.behavior.abort();
    this.exitBlocked = false;
    this.plugging = -1;
    this.guarding = false;
  }

  private step(dt: number, w: World, cmd: Command, first: boolean): boolean {
    this.moving = false;
    switch (cmd.k) {
      case 'goto':
        return this.domain === 'surface' ? true : stepGoto(this, dt, w, cmd.node);
      case 'room':
        return stepRoom(this, dt, w, cmd, first);
      case 'exit':
        return stepExit(this, dt, w, first, cmd.giveUp === true);
      case 'enter':
        return stepEnter(this, dt, w, first);
      case 'search':
        return stepSearch(this, dt, w, cmd, first);
      case 'walk':
        return stepWalk(this, dt, w, cmd);
      case 'patrol':
        return stepPatrol(this, dt, w, cmd, first);
      case 'wait':
        if (first) this.timer = cmd.time;
        this.timer -= dt;
        return this.timer <= 0;
      case 'climb':
        return stepClimb(this, dt, w, cmd, first);
    }
  }

  /** 正在植物茎上（爬升、停留或下降中） */
  get climbing(): boolean {
    return this.behavior.cmd?.k === 'climb' && this.behavior.started;
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

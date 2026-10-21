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
  | { k: 'wait'; time: number };

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

  constructor(role: Role, ageDays: number) {
    this.role = role;
    this.ageDays = ageDays;
    const [a, b] = CONFIG.colony.workerLifespanDays;
    this.lifespan = role === 'queen' ? 9999 : rng.range(a, b);
  }

  note(w: World, msg: string): void {
    this.log.unshift({ t: w.clock.stamp(), msg });
    if (this.log.length > 14) this.log.pop();
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

  private surfaceMove(dt: number, w: World, desired: number | null, turnRate = 5, speedMul = 1): void {
    if (desired !== null) {
      const d = wrapAngle(desired - this.heading);
      this.heading += clamp(d, -turnRate * dt, turnRate * dt);
    }
    const step = CONFIG.ant.speedSurface * this.speedFactor(w) * speedMul * dt;
    let nx = this.pos.x + Math.cos(this.heading) * step;
    let nz = this.pos.z + Math.sin(this.heading) * step;
    const ob = w.veg.obstacleAt(nx, nz, 0.35);
    if (ob) {
      const radial = Math.atan2(this.pos.z - ob.z, this.pos.x - ob.x);
      const t1 = radial + Math.PI / 2;
      const t2 = radial - Math.PI / 2;
      this.heading = Math.abs(wrapAngle(t1 - this.heading)) < Math.abs(wrapAngle(t2 - this.heading)) ? t1 : t2;
      nx = this.pos.x + Math.cos(this.heading) * step;
      nz = this.pos.z + Math.sin(this.heading) * step;
      const ob2 = w.veg.obstacleAt(nx, nz, 0.3);
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
    this.pos.set(nx, w.terrain.heightAt(nx, nz), nz);
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
    let desired: number | null = null;
    if (food) {
      const d = Math.hypot(food.x - x, food.z - z);
      if (d < food.radius + 0.5) {
        this.result = food;
        return true;
      }
      desired = Math.atan2(food.z - z, food.x - x);
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
    if (desired === null) this.heading += rng.gauss(0, 1) * 1.4 * Math.sqrt(dt);
    this.surfaceMove(dt, w, desired, food ? 6 : 3.5);
    return false;
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

  /** 携带物在上颚处的位置 */
  mouthPosition(out: THREE.Vector3): THREE.Vector3 {
    const s = this.size * (this.role === 'queen' ? CONFIG.ant.queenScale : 1);
    return out
      .copy(this.pos)
      .addScaledVector(this.fwd, 0.55 * s)
      .addScaledVector(this.up, 0.16 * s);
  }
}

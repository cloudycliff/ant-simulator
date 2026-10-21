import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, TAU, wrapAngle } from '../util/math';
import { rng, type Rng } from '../util/random';
import type { Ant } from '../sim/ant';
import { Item } from '../sim/items';
import type { Terrain } from './terrain';
import type { Vegetation } from './vegetation';
import type { World } from './world';

export type PredatorKind = 'spider' | 'antlion';

export const PREDATOR_INFO: Record<PredatorKind, { name: string; desc: string }> = {
  spider: {
    name: '狼蛛',
    desc: '狼蛛科（Lycosidae）的游猎型蜘蛛，不结网，靠视觉和地面振动发现猎物，突然冲刺扑击。地表的觅食蚁是它常见的猎物。抓到后注入毒液、吸食体液，留下空壳。',
  },
  antlion: {
    name: '蚁狮',
    desc: '蚁蛉（Myrmeleontidae）的幼虫。它在干燥松软的地面倒退着挖出漏斗形的坑，自己埋在坑底只露出大颚。蚂蚁踩到坑壁会顺着松沙滑下去，越往下越难爬出来；被抓住后体液被吸干，空壳会被蚁狮甩出坑外。',
  },
};

/** 坑口外沿堆起的松沙到 PIT_EDGE 倍半径处落回地面 */
const PIT_EDGE = 1.35;
/** 陷阱表面高度（t 为到中心的距离 / 陷阱半径）：地形网格建好后不能再挖，坑做成中心贴地、四周堆高的沙环 */
function pitLift(t: number): number {
  return t < 1 ? 0.03 + 0.62 * t * t : 0.65 * Math.max(0, (PIT_EDGE - t) / (PIT_EDGE - 1));
}

export type SpiderState = 'wander' | 'pause' | 'chase' | 'feed' | 'leave';

let nextPredatorId = 1;

export class Spider {
  id = nextPredatorId++;
  readonly kind = 'spider';
  state: SpiderState = 'wander';
  timer = 0;
  target = -1;
  meals = 0;
  caught = 0;
  stayLeft: number;
  moving = false;
  gait = 0;
  /** 游荡时缓缓前往的地点，到了再换一个 */
  gx = 0;
  gz = 0;
  /** 累计被咬的程度（工蚁数 × 秒），超过上限就逃走 */
  harass = 0;
  /** 当前贴身围攻的工蚁数 */
  mob = 0;
  /** 是被蚂蚁赶走的 */
  fled = false;
  constructor(
    public x: number,
    public z: number,
    public heading: number,
    public placed: boolean,
    public mesh: THREE.Group,
  ) {
    const [a, b] = CONFIG.predators.spiderStayDays;
    this.stayLeft = rng.range(a, b);
    this.pickGoal();
  }

  pickGoal(): void {
    const a = rng.range(0, TAU);
    const d = rng.range(12, CONFIG.world.forageRadius * 0.7);
    this.gx = Math.cos(a) * d;
    this.gz = Math.sin(a) * d;
  }
}

export class Antlion {
  id = nextPredatorId++;
  readonly kind = 'antlion';
  /** 正在进食的剩余秒数，进食时不再捕猎 */
  feedT = 0;
  caught = 0;
  constructor(
    public x: number,
    public z: number,
    public placed: boolean,
    public mesh: THREE.Group,
  ) {}
}

export type Predator = Spider | Antlion;

export interface PredatorSave {
  spiders: { x: number; z: number; h: number; state: SpiderState; timer: number; meals: number; caught: number; stay: number; placed: boolean }[];
  antlions: { x: number; z: number; feed: number; caught: number; placed: boolean }[];
}

/** 地表天敌：游荡的狼蛛和挖坑的蚁狮。捕食通过 Colony.kill 结算，空壳作为同伴尸体留在地表 */
export class PredatorManager {
  group = new THREE.Group();
  spiders: Spider[] = [];
  antlions: Antlion[] = [];
  /** 有狼蛛逼近的入口编号，没有时为 -1 */
  threatEntrance = -1;
  /** 正在入口警戒的工蚁数 */
  guardsOut = 0;
  private surface: Ant[] = [];
  private mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 }),
    head: new THREE.MeshStandardMaterial({ color: 0x5e4a35, roughness: 0.75 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xa48c66, roughness: 0.8 }),
    leg: new THREE.MeshStandardMaterial({ color: 0x3b2e22, roughness: 0.8 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.5 }),
    prey: new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.5 }),
    sand: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    jaw: new THREE.MeshStandardMaterial({ color: 0x6b4b2a, roughness: 0.6 }),
  };

  constructor(
    private terrain: Terrain,
    private veg: Vegetation,
    worldRng: Rng,
  ) {
    // 蚁狮偏好干燥、草少的裸露地面
    for (let k = 0; k < 400 && this.antlions.length < CONFIG.predators.antlions; k++) {
      const a = worldRng.range(0, TAU);
      const d = worldRng.range(18, 75);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.terrain.grassDensity(x, z) > 0.25 || this.veg.obstacleAt(x, z, CONFIG.predators.pitRadius + 1)) continue;
      if (this.antlions.some((p) => Math.hypot(p.x - x, p.z - z) < 25)) continue;
      this.addAntlion(x, z, false);
    }
  }

  // ---------------- 增删 ----------------

  addSpider(x: number, z: number, heading: number, placed: boolean): Spider {
    const s = new Spider(x, z, heading, placed, this.spiderMesh());
    s.mesh.traverse((o) => (o.userData.pick = { kind: 'predator', id: s.id }));
    this.group.add(s.mesh);
    this.spiders.push(s);
    return s;
  }

  addAntlion(x: number, z: number, placed: boolean): Antlion {
    const p = new Antlion(x, z, placed, this.pitMesh(x, z));
    p.mesh.traverse((o) => (o.userData.pick = { kind: 'predator', id: p.id }));
    this.group.add(p.mesh);
    this.antlions.push(p);
    return p;
  }

  remove(p: Predator): void {
    this.group.remove(p.mesh);
    if (p instanceof Spider) this.spiders.splice(this.spiders.indexOf(p), 1);
    else this.antlions.splice(this.antlions.indexOf(p), 1);
  }

  byId(id: number): Predator | undefined {
    return this.spiders.find((s) => s.id === id) ?? this.antlions.find((p) => p.id === id);
  }

  near(x: number, z: number, r: number): Predator | null {
    let best: Predator | null = null;
    let bd = r;
    for (const p of [...this.spiders, ...this.antlions]) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** r 以内最近的、还在捕猎的狼蛛（离开中的不算） */
  nearestSpider(x: number, z: number, r: number): Spider | null {
    let best: Spider | null = null;
    let bd = r * r;
    for (const s of this.spiders) {
      if (s.state === 'leave') continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** (x,z) 所在的蚁狮陷阱 */
  pitAt(x: number, z: number): Antlion | null {
    const R = CONFIG.predators.pitRadius;
    for (const p of this.antlions) if ((p.x - x) ** 2 + (p.z - z) ** 2 < R * R) return p;
    return null;
  }

  /** 陷阱沙面高出地面的量，地表的东西要贴着它走 */
  liftAt(x: number, z: number): number {
    const R = CONFIG.predators.pitRadius;
    for (const p of this.antlions) {
      const t = Math.hypot(p.x - x, p.z - z) / R;
      if (t < PIT_EDGE) return pitLift(t);
    }
    return 0;
  }

  // ---------------- 模拟 ----------------

  update(dt: number, w: World): void {
    const P = CONFIG.predators;
    const days = dt / CONFIG.time.dayLength;
    this.surface.length = 0;
    this.guardsOut = 0;
    for (const a of w.colony.ants) {
      if (a.domain !== 'surface' || a.role === 'queen') continue;
      if (a.guarding) this.guardsOut++;
      if (!a.climbing) this.surface.push(a);
    }
    this.threatEntrance = -1;
    let td = CONFIG.defense.guardRadius;
    for (const s of this.spiders) {
      if (s.state === 'leave') continue;
      w.nest.entrances.forEach((e, i) => {
        const d = Math.hypot(e.x - s.x, e.z - s.z);
        if (d < td) {
          td = d;
          this.threatEntrance = i;
        }
      });
    }

    const natural = this.spiders.filter((s) => !s.placed).length;
    if (natural < P.maxNaturalSpiders && this.spiders.length < P.maxSpiders && rng.chance(days * P.spiderPerDay)) {
      const R = CONFIG.world.forageRadius - 3;
      for (let k = 0; k < 10; k++) {
        const a = rng.range(0, TAU);
        const x = Math.cos(a) * R;
        const z = Math.sin(a) * R;
        if (this.veg.obstacleAt(x, z, 2, true)) continue;
        this.addSpider(x, z, a + Math.PI + rng.range(-0.5, 0.5), false);
        w.colony.pushEvent('一只狼蛛游荡进了蚂蚁的觅食范围');
        break;
      }
    }
    for (let i = this.spiders.length - 1; i >= 0; i--) this.updateSpider(this.spiders[i], dt, days, w);
    for (const p of this.antlions) this.updateAntlion(p, dt, w);
  }

  private speedFactor(w: World): number {
    return clamp((w.clock.temperatureAt(0) - 4) / 18, 0.3, 1.25);
  }

  private updateSpider(s: Spider, dt: number, days: number, w: World): void {
    const P = CONFIG.predators;
    s.moving = false;
    if (!s.placed) s.stayLeft -= days;
    if (s.state !== 'leave' && this.mobbed(s, dt, w)) return;
    if (s.state !== 'feed' && s.state !== 'leave' && (s.stayLeft <= 0 || s.meals >= P.spiderMeals)) {
      s.state = 'leave';
      s.timer = 90;
    }
    s.timer -= dt;
    const sf = this.speedFactor(w);
    switch (s.state) {
      case 'feed':
        if (s.timer <= 0) {
          this.dropHusk(w, s.x + Math.cos(s.heading) * 1.8, s.z + Math.sin(s.heading) * 1.8);
          s.state = 'pause';
          s.timer = rng.range(4, 10);
        }
        return;
      case 'pause':
        if (s.timer <= 0) s.state = 'wander';
        else this.lookForPrey(s);
        return;
      case 'leave':
        this.walk(s, Math.atan2(s.z, s.x), P.spiderWalk * (s.fled ? 2.4 : 1.6) * sf * dt);
        // 被石块、植物困住太久就当作已经从缝隙里钻走了
        if (Math.hypot(s.x, s.z) > CONFIG.world.forageRadius + 2 || s.timer <= 0) {
          this.remove(s);
          w.colony.pushEvent(s.meals > 0 ? `狼蛛吃了 ${s.meals} 只蚂蚁后离开了` : '狼蛛离开了觅食范围');
        }
        return;
      case 'chase': {
        const a = this.surface.find((b) => b.id === s.target);
        if (!a || !a.alive || s.timer <= 0) {
          s.state = 'pause';
          s.timer = rng.range(3, 8);
          return;
        }
        const dx = a.pos.x - s.x;
        const dz = a.pos.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1) {
          w.alarm.emit(a.pos.x, a.pos.z, CONFIG.defense.alarmOnAttack);
          if (rng.chance(P.spiderCatch)) {
            s.state = 'feed';
            s.timer = P.spiderFeedSec;
            s.meals++;
            s.caught++;
            s.heading = Math.atan2(dz, dx);
            w.colony.stats.preyed++;
            w.colony.pushEvent(`觅食蚁 #${a.id} 被狼蛛捕食`);
            w.colony.kill(a, '被狼蛛捕食', false);
          } else {
            a.note(w, '被狼蛛扑击，侥幸逃脱');
            s.state = 'pause';
            s.timer = rng.range(2, 5);
          }
          return;
        }
        this.walk(s, Math.atan2(dz, dx), P.spiderRush * sf * dt);
        return;
      }
      case 'wander': {
        if (rng.chance(dt * 0.06)) {
          s.state = 'pause';
          s.timer = rng.range(4, 12);
          return;
        }
        if (Math.hypot(s.gx - s.x, s.gz - s.z) < 6) s.pickGoal();
        const toGoal = wrapAngle(Math.atan2(s.gz - s.z, s.gx - s.x) - s.heading);
        s.heading += clamp(toGoal, -0.6 * dt, 0.6 * dt) + rng.gauss(0, 1) * 1.2 * Math.sqrt(dt);
        // 循着地面振动往蚂蚁来往多的地方靠（蚂蚁走过处都留有归巢信息素，正好反映来往的多少）
        const sense = (da: number) => w.pheromone.sampleHome(s.x + Math.cos(s.heading + da) * 5, s.z + Math.sin(s.heading + da) * 5);
        const l = sense(-0.7);
        const r = sense(0.7);
        if (Math.abs(l - r) > 0.02 + 0.15 * (l + r)) s.heading += (l > r ? -1 : 1) * P.spiderTrailTurn * dt;
        if (Math.hypot(s.x, s.z) > CONFIG.world.forageRadius - 4) s.heading = Math.atan2(-s.z, -s.x) + rng.range(-0.8, 0.8);
        this.walk(s, s.heading, P.spiderWalk * sf * dt);
        this.lookForPrey(s);
      }
    }
  }

  /**
   * 贴身撕咬的工蚁让狼蛛累积“被咬程度”，超过上限就丢下猎物逃走；围攻期间它不再扑击新的猎物，
   * 但每只围攻的工蚁都有被它咬死的风险。返回 true 表示本步狼蛛只顾着应付围攻
   */
  private mobbed(s: Spider, dt: number, w: World): boolean {
    const D = CONFIG.defense;
    const r2 = (D.biteRange + 0.5) ** 2;
    let mob = 0;
    for (const a of this.surface) if (a.mobTarget === s.id && a.alive && (a.pos.x - s.x) ** 2 + (a.pos.z - s.z) ** 2 < r2) mob++;
    s.mob = mob;
    s.harass = Math.max(0, s.harass + (mob > 0 ? mob : -D.harassRecover) * dt);
    if (!mob) return false;
    for (const a of this.surface) {
      if (a.mobTarget !== s.id || !a.alive || !rng.chance(D.mobKillPerSec * dt)) continue;
      w.colony.stats.preyed++;
      w.colony.kill(a, '围攻狼蛛时被咬死');
      break;
    }
    if (s.harass < D.harassLimit) return mob >= 2;
    if (s.state === 'feed') this.dropHusk(w, s.x + Math.cos(s.heading) * 1.4, s.z + Math.sin(s.heading) * 1.4);
    s.state = 'leave';
    s.timer = 90;
    s.fled = true;
    s.mob = 0;
    w.colony.stats.repelled++;
    w.colony.pushEvent(`${mob} 只工蚁围攻狼蛛，把它赶走了`);
    return true;
  }

  private lookForPrey(s: Spider): void {
    const P = CONFIG.predators;
    if (s.meals >= P.spiderMeals || s.mob >= 2) return;
    let best: Ant | null = null;
    let bd = P.spiderSense * P.spiderSense;
    for (const a of this.surface) {
      if (!a.alive) continue;
      const d = (a.pos.x - s.x) ** 2 + (a.pos.z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best) return;
    s.state = 'chase';
    s.target = best.id;
    s.timer = P.spiderRushTime;
  }

  /** 朝 heading 方向移动；碰到石块、植物时转向 */
  private walk(s: Spider, heading: number, step: number): void {
    const d = wrapAngle(heading - s.heading);
    s.heading += clamp(d, -0.25, 0.25);
    const nx = s.x + Math.cos(s.heading) * step;
    const nz = s.z + Math.sin(s.heading) * step;
    if (this.veg.obstacleAt(nx, nz, 1, true)) {
      s.heading += s.id % 2 ? 0.6 : -0.6;
      return;
    }
    s.x = nx;
    s.z = nz;
    s.moving = true;
    s.gait += step * 2.2;
  }

  private updateAntlion(p: Antlion, dt: number, w: World): void {
    if (p.feedT > 0) {
      p.feedT -= dt;
      if (p.feedT <= 0) {
        const a = rng.range(0, TAU);
        const r = CONFIG.predators.pitRadius + 0.8;
        this.dropHusk(w, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      }
      return;
    }
    for (const a of this.surface) {
      if (!a.alive || (a.pos.x - p.x) ** 2 + (a.pos.z - p.z) ** 2 > 0.6) continue;
      p.feedT = CONFIG.predators.antlionFeedSec;
      p.caught++;
      w.colony.stats.preyed++;
      w.colony.pushEvent(`觅食蚁 #${a.id} 滑进蚁狮的陷阱被抓住了`);
      w.colony.kill(a, '落入蚁狮陷阱', false);
      return;
    }
  }

  /** 被吸干的空壳留在地表，内务蚁会把它当作同伴尸体搬去垃圾堆 */
  private dropHusk(w: World, x: number, z: number): void {
    const it = new Item('corpse');
    it.yaw = rng.range(0, TAU);
    w.colony.dropOnSurface(it, x, z);
  }

  // ---------------- 渲染 ----------------

  sync(time: number): void {
    for (const s of this.spiders) {
      const y = this.terrain.heightAt(s.x, s.z);
      s.mesh.position.set(s.x, y, s.z);
      s.mesh.rotation.y = -s.heading;
      const legs = s.mesh.userData.legs as THREE.Object3D[];
      legs.forEach((l, i) => {
        const phase = (i % 2 === 0) === i < 4 ? 0 : Math.PI;
        l.rotation.y = l.userData.base + (s.moving ? Math.sin(s.gait + phase) * 0.28 : 0);
      });
      (s.mesh.userData.prey as THREE.Object3D).visible = s.state === 'feed';
      s.mesh.userData.body.position.y = 1.15 + (s.moving ? Math.abs(Math.sin(s.gait)) * 0.06 : Math.sin(time * 1.5) * 0.02);
    }
    for (const p of this.antlions) {
      (p.mesh.userData.prey as THREE.Object3D).visible = p.feedT > 0;
      const jaws = p.mesh.userData.jaws as THREE.Object3D;
      jaws.rotation.y = p.feedT > 0 ? 0 : Math.sin(time * 0.7 + p.id) * 0.15;
    }
  }

  private spiderMesh(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 1.15;
    g.add(body);
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const add = (parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(sphere, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    add(body, this.mats.body, -1.25, 0.15, 0, 1.35, 0.95, 1.0);
    add(body, this.mats.stripe, -1.2, 0.72, 0, 0.9, 0.35, 0.28);
    add(body, this.mats.head, 0.55, 0, 0, 0.95, 0.6, 0.8);
    add(body, this.mats.stripe, 0.5, 0.42, 0, 0.75, 0.22, 0.22);
    for (const [ex, ez, er] of [[1.38, 0.18, 0.13], [1.38, -0.18, 0.13], [1.25, 0.32, 0.09], [1.25, -0.32, 0.09]]) add(body, this.mats.eye, ex, 0.32, ez, er, er, er);
    const seg = new THREE.CylinderGeometry(0.09, 0.12, 1, 5);
    const legs: THREE.Object3D[] = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? 1 : -1;
      const k = i % 4;
      const leg = new THREE.Group();
      leg.position.set(0.85 - k * 0.32, 1.15, side * 0.45);
      // 腿组的局部 +x 指向腿伸出的方向：前两对偏向前方，后两对偏向后方
      const spread = Math.PI / 2 + (k - 1.5) * 0.42;
      leg.userData.base = side > 0 ? -spread : spread;
      // 上段向外上方抬起，下段向外下方落地
      const upper = new THREE.Mesh(seg, this.mats.leg);
      upper.scale.set(1, 1.5, 1);
      upper.position.set(0.65, 0.35, 0);
      upper.rotation.z = -1.1;
      const lower = new THREE.Mesh(seg, this.mats.leg);
      lower.scale.set(0.8, 1.9, 0.8);
      lower.position.set(1.75, -0.2, 0);
      lower.rotation.z = 0.55;
      upper.castShadow = lower.castShadow = true;
      leg.add(upper, lower);
      leg.rotation.y = leg.userData.base;
      g.add(leg);
      legs.push(leg);
    }
    const prey = add(body, this.mats.prey, 1.55, -0.3, 0, 0.55, 0.22, 0.25);
    g.userData.legs = legs;
    g.userData.prey = prey;
    g.userData.body = body;
    g.scale.setScalar(0.75);
    return g;
  }

  /** 漏斗形的坑：坑口一圈松沙略高于地面，向中心逐渐变低 */
  private pitMesh(x: number, z: number): THREE.Group {
    const R = CONFIG.predators.pitRadius;
    const rings = 7;
    const segs = 28;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const light = new THREE.Color(0x9a7d58);
    const dark = new THREE.Color(0x3a2c1e);
    const c = new THREE.Color();
    const h0 = this.terrain.heightAt(x, z);
    pos.push(0, pitLift(0), 0);
    c.copy(dark);
    col.push(c.r, c.g, c.b);
    for (let k = 1; k <= rings; k++) {
      const t = (k / rings) * PIT_EDGE;
      c.copy(dark).lerp(light, Math.min(1, Math.pow(t, 0.8)));
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const px = Math.cos(a) * t * R;
        const pz = Math.sin(a) * t * R;
        pos.push(px, this.terrain.heightAt(x + px, z + pz) - h0 + pitLift(t), pz);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * segs;
      const a1 = 1 + k * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.position.set(x, h0, z);
    const pit = new THREE.Mesh(geo, this.mats.sand);
    pit.receiveShadow = true;
    g.add(pit);
    // 坑底只露出一对弯曲的大颚
    const jaws = new THREE.Group();
    jaws.position.y = 0.1;
    const jawGeo = new THREE.TorusGeometry(0.35, 0.05, 4, 8, Math.PI * 0.6).rotateX(Math.PI / 2);
    for (const side of [1, -1]) {
      const j = new THREE.Mesh(jawGeo, this.mats.jaw);
      j.scale.z = side;
      j.position.x = -0.2;
      jaws.add(j);
    }
    g.add(jaws);
    const prey = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), this.mats.prey);
    prey.scale.set(0.38, 0.14, 0.16);
    prey.position.set(0.15, 0.1, 0);
    g.add(prey);
    g.userData.jaws = jaws;
    g.userData.prey = prey;
    return g;
  }

  // ---------------- 存档 ----------------

  toSave(): PredatorSave {
    return {
      spiders: this.spiders.map((s) => ({ x: s.x, z: s.z, h: s.heading, state: s.state === 'chase' ? 'wander' : s.state, timer: s.timer, meals: s.meals, caught: s.caught, stay: s.stayLeft, placed: s.placed })),
      antlions: this.antlions.map((p) => ({ x: p.x, z: p.z, feed: p.feedT, caught: p.caught, placed: p.placed })),
    };
  }

  restore(s: PredatorSave): void {
    for (const p of [...this.spiders, ...this.antlions]) this.remove(p);
    for (const d of s.spiders) {
      const sp = this.addSpider(d.x, d.z, d.h, d.placed);
      sp.state = d.state;
      sp.timer = d.timer;
      sp.meals = d.meals;
      sp.caught = d.caught;
      sp.stayLeft = d.stay;
    }
    for (const d of s.antlions) {
      const p = this.addAntlion(d.x, d.z, d.placed);
      p.feedT = d.feed;
      p.caught = d.caught;
    }
  }
}

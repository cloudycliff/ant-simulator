import * as THREE from 'three';
import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { TAU } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import type { AphidColony, AphidManager } from './aphids';
import type { World } from './world';

export type LadybugState = 'arrive' | 'feed' | 'leave';

/** 飞来、飞走各用几秒 */
const FLIGHT_SEC = 3;
/** 离开时飞到植物外多远、多高 */
const FLIGHT_DIST = 16;
const FLIGHT_RISE = 10;
/** 每隔多少秒数一次茎上的工蚁 */
const COUNT_SEC = 0.5;

export interface LadybugSave {
  colony: number;
  state: LadybugState;
  t: number;
  eaten: number;
  appetite: number;
  harass: number;
  ang: number;
  h: number;
  flyAng: number;
  placed: boolean;
  fled: boolean;
  eatAcc: number;
}

/** 飞到蚜虫群上捕食的瓢虫 */
export class Ladybug {
  state: LadybugState = 'arrive';
  /** 当前状态已持续的秒数 */
  t = 0;
  eaten = 0;
  harass = 0;
  /** 最近一次数到的、爬在这株植物上的工蚁数 */
  chasers = 0;
  /** 是被蚂蚁赶走的 */
  fled = false;
  eatAcc = 0;
  appetite: number;
  /** 在茎上的方位角，和在蚜虫茎段里的高度（0..1） */
  ang: number;
  h: number;
  /** 飞来、飞走的水平方向 */
  flyAng: number;

  constructor(
    public colony: AphidColony,
    public placed: boolean,
    public mesh: THREE.Group,
    rng: Rng,
  ) {
    const [a, b] = CONFIG.ladybug.appetite;
    this.appetite = Math.round(rng.range(a, b));
    this.ang = rng.range(0, TAU);
    this.h = rng.range(0.2, 0.8);
    this.flyAng = rng.range(0, TAU);
  }

  get feeding(): boolean {
    return this.state === 'feed';
  }
}

/**
 * 瓢虫：晴天白天飞到较大的蚜虫群上吃蚜虫。爬在那株植物上的工蚁会驱赶它，累计被赶得够了就飞走；
 * 吃饱了、蚜虫太少了也飞走。蚂蚁照料的蚜虫群因此损失少，没人照料的会被吃掉一大半。
 */
export class LadybugManager {
  group = new THREE.Group();
  ladybugs: Ladybug[] = [];
  /** 累计飞来、被蚂蚁赶走的只数，被吃掉的蚜虫数 */
  visits = 0;
  repelled = 0;
  eaten = 0;
  private countT = 0;
  private mats = {
    shell: new THREE.MeshStandardMaterial({ color: 0xd2261c, roughness: 0.25, metalness: 0.05 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }),
    wing: new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.3, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  };

  constructor(
    private aphids: AphidManager,
    private rng: Rng,
  ) {}

  /** 正在这群蚜虫上（飞来中或在吃）的瓢虫 */
  on(c: AphidColony): Ladybug | null {
    return this.ladybugs.find((l) => l.colony === c && l.state !== 'leave') ?? null;
  }

  add(c: AphidColony, placed: boolean): Ladybug {
    const l = new Ladybug(c, placed, this.makeMesh(), this.rng);
    l.mesh.traverse((o) => (o.userData.pick = { kind: 'plant', id: c.plant.index }));
    this.group.add(l.mesh);
    this.ladybugs.push(l);
    this.visits++;
    return l;
  }

  /** 让它飞走；fled 为真时算作被赶走 */
  shoo(l: Ladybug, fled: boolean): void {
    if (l.state === 'leave') return;
    l.state = 'leave';
    l.t = 0;
    l.fled = fled;
    if (fled) this.repelled++;
  }

  update(dt: number, w: World): void {
    const C = CONFIG.ladybug;
    const days = dt / CONFIG.time.dayLength;
    const flyWeather = w.weather.phase === 'clear' && !w.clock.isNight && w.soil.temperatureAt(0) >= C.minTemp;
    if (flyWeather && this.ladybugs.length < C.max && this.rng.chance(days * C.perDay)) this.arrive(w);

    this.countT -= dt;
    const recount = this.countT <= 0;
    if (recount) this.countT = COUNT_SEC;
    for (let i = this.ladybugs.length - 1; i >= 0; i--) {
      const l = this.ladybugs[i];
      l.t += dt;
      if (l.state === 'arrive') {
        if (l.t >= FLIGHT_SEC) [l.state, l.t] = ['feed', 0];
        continue;
      }
      if (l.state === 'leave') {
        if (l.t >= FLIGHT_SEC) {
          this.group.remove(l.mesh);
          this.ladybugs.splice(i, 1);
        }
        continue;
      }
      if (recount) l.chasers = this.chasers(l.colony, w);
      this.feed(l, dt, w);
      // 下雨前躲起来，不算被赶走
      if (l.feeding && w.weather.phase !== 'clear') this.shoo(l, false);
    }
  }

  private arrive(w: World): void {
    const C = CONFIG.ladybug;
    const cands = this.aphids.colonies.filter((c) => c.count >= C.minAphids * 1.5 && !this.on(c));
    if (!cands.length) return;
    // 瓢虫循着植物受害后的气味找来，蚜虫越多越容易被找到
    let total = 0;
    for (const c of cands) total += c.count * c.count;
    let r = this.rng.next() * total;
    let pick = cands[cands.length - 1];
    for (const c of cands) {
      r -= c.count * c.count;
      if (r <= 0) {
        pick = c;
        break;
      }
    }
    this.add(pick, false);
    w.events.push(L('ev.ladybugArrived', { place: w.describePlace(pick.x, pick.z) }), { kind: 'plant', id: pick.plant.index });
  }

  /** 爬在这株植物上的工蚁（大多在蚜虫附近转） */
  private chasers(c: AphidColony, w: World): number {
    let n = 0;
    for (const a of w.colony.ants) if (a.climbing && a.alive && Math.abs(a.pos.x - c.x) < 1.2 && Math.abs(a.pos.z - c.z) < 1.2) n++;
    return n;
  }

  private feed(l: Ladybug, dt: number, w: World): void {
    const C = CONFIG.ladybug;
    const c = l.colony;
    const n = l.chasers;
    l.harass = n > 0 ? l.harass + n * dt : Math.max(0, l.harass - C.harassRecover * dt);
    // 被追着时边躲边换位置，几乎吃不上
    l.ang += dt * (n > 0 ? 1.2 : 0.08) * (Math.sin(l.t * 0.7 + l.flyAng) > 0 ? 1 : -1);
    l.h = Math.min(0.95, Math.max(0.05, l.h + dt * 0.03 * Math.sin(l.t * 0.4 + l.ang)));
    l.eatAcc += (dt * C.eatPerDay) / CONFIG.time.dayLength / (1 + C.chasedSlow * n);
    while (l.eatAcc >= 1 && c.count > 4) {
      l.eatAcc--;
      c.count--;
      c.eaten++;
      l.eaten++;
      this.eaten++;
    }
    const ref = { kind: 'plant' as const, id: c.plant.index };
    const place = w.describePlace(c.x, c.z);
    if (l.harass >= C.harassLimit) {
      this.shoo(l, true);
      w.events.push(L('ev.ladybugRepelled', { place, n: l.eaten }), ref);
    } else if (l.eaten >= l.appetite || c.count < C.minAphids) {
      this.shoo(l, false);
      w.events.push(L('ev.ladybugLeft', { place, n: l.eaten }), ref);
    }
  }

  // ---------------- 渲染 ----------------

  private stemPoint(l: Ladybug, out: THREE.Vector3): THREE.Vector3 {
    const c = l.colony;
    const r = c.stemRadius + 0.25;
    return out.set(c.x + Math.cos(l.ang) * r, c.bandLo + (c.bandHi - c.bandLo) * l.h, c.z + Math.sin(l.ang) * r);
  }

  private readonly _p = new THREE.Vector3();
  private readonly _q = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _side = new THREE.Vector3();
  private readonly _m = new THREE.Matrix4();

  sync(time: number): void {
    for (const l of this.ladybugs) {
      const stem = this.stemPoint(l, this._p);
      const flying = l.state !== 'feed';
      const wings = l.mesh.userData.wings as THREE.Object3D[];
      const elytra = l.mesh.userData.elytra as THREE.Object3D[];
      if (flying) {
        // 飞来时从空中落到茎上，飞走时反过来；k = 0 在茎上，1 在空中
        const u = Math.min(1, l.t / FLIGHT_SEC);
        const k = l.state === 'arrive' ? 1 - u : u;
        const e = k * k * (3 - 2 * k);
        const air = this._q.set(l.colony.x + Math.cos(l.flyAng) * FLIGHT_DIST, stem.y + FLIGHT_RISE, l.colony.z + Math.sin(l.flyAng) * FLIGHT_DIST);
        this._fwd.copy(air).sub(stem).normalize();
        if (l.state === 'arrive') this._fwd.negate();
        l.mesh.position.lerpVectors(stem, air, e);
        l.mesh.position.y += Math.sin(time * 9) * 0.15 * e;
        this._fwd.y *= 0.3;
        this._fwd.normalize();
        this._up.set(0, 1, 0);
      } else {
        l.mesh.position.copy(stem);
        // 趴在茎上，头朝上，背朝外
        this._fwd.set(0, 1, 0);
        this._up.set(Math.cos(l.ang), 0, Math.sin(l.ang));
      }
      this._side.crossVectors(this._fwd, this._up).normalize();
      this._up.crossVectors(this._side, this._fwd);
      this._m.makeBasis(this._fwd, this._up, this._side);
      l.mesh.quaternion.setFromRotationMatrix(this._m);
      const flap = Math.sin(time * 60) * 0.5;
      wings.forEach((g, i) => {
        g.visible = flying;
        g.rotation.x = (i === 0 ? 1 : -1) * (0.9 + flap);
      });
      // 飞的时候鞘翅向两侧张开
      elytra.forEach((g, i) => (g.rotation.x = flying ? (i === 0 ? 1 : -1) * 0.6 : 0));
    }
  }

  /** 约 1.3 cm 长（工蚁的 1.3 倍）：红色鞘翅上 7 个黑点，黑色前胸背板两侧有白斑；局部 +x 是头，+y 是背 */
  private makeMesh(): THREE.Group {
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.scale.setScalar(1.6);
    root.add(g);
    const sphere = new THREE.SphereGeometry(1, 14, 10, 0, TAU, 0, Math.PI / 2);
    const ball = new THREE.SphereGeometry(1, 8, 6);
    const elytra: THREE.Object3D[] = [];
    for (const side of [1, -1]) {
      // 左右两片鞘翅各是半个半球，绕身体中线张开
      const pivot = new THREE.Group();
      const half = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8, side > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2), this.mats.shell);
      half.scale.set(0.32, 0.24, 0.27);
      half.castShadow = true;
      pivot.add(half);
      for (const [x, z] of [[0.1, 0.13], [-0.12, 0.15], [-0.02, 0.2]]) {
        const spot = new THREE.Mesh(ball, this.mats.black);
        const y = Math.sqrt(Math.max(0, 1 - (x / 0.32) ** 2 - (z / 0.27) ** 2)) * 0.24;
        spot.position.set(x, y, z * side);
        spot.scale.set(0.045, 0.02, 0.045);
        pivot.add(spot);
      }
      g.add(pivot);
      elytra.push(pivot);
    }
    const mid = new THREE.Mesh(ball, this.mats.black);
    mid.position.set(0.2, 0.2, 0);
    mid.scale.set(0.05, 0.02, 0.05);
    g.add(mid);
    const belly = new THREE.Mesh(sphere, this.mats.black);
    belly.rotation.x = Math.PI;
    belly.scale.set(0.3, 0.06, 0.25);
    g.add(belly);
    const pron = new THREE.Mesh(ball, this.mats.black);
    pron.position.set(0.3, 0.06, 0);
    pron.scale.set(0.09, 0.08, 0.17);
    g.add(pron);
    for (const side of [1, -1]) {
      const patch = new THREE.Mesh(ball, this.mats.white);
      patch.position.set(0.31, 0.08, 0.1 * side);
      patch.scale.set(0.05, 0.05, 0.05);
      g.add(patch);
    }
    const head = new THREE.Mesh(ball, this.mats.black);
    head.position.set(0.39, 0.02, 0);
    head.scale.set(0.06, 0.05, 0.09);
    g.add(head);
    const wings: THREE.Object3D[] = [];
    const wingGeo = new THREE.PlaneGeometry(0.5, 0.22).rotateX(-Math.PI / 2).translate(-0.05, 0, 0.13);
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.y = 0.12;
      const wing = new THREE.Mesh(wingGeo, this.mats.wing);
      wing.scale.z = side;
      pivot.add(wing);
      pivot.visible = false;
      g.add(pivot);
      wings.push(pivot);
    }
    root.userData.wings = wings;
    root.userData.elytra = elytra;
    return root;
  }

  // ---------------- 存档 ----------------

  toSave(): { ladybugs: LadybugSave[]; visits: number; repelled: number; eaten: number } {
    return {
      ladybugs: this.ladybugs.map((l) => ({
        colony: this.aphids.colonies.indexOf(l.colony),
        state: l.state,
        t: l.t,
        eaten: l.eaten,
        appetite: l.appetite,
        harass: l.harass,
        ang: l.ang,
        h: l.h,
        flyAng: l.flyAng,
        placed: l.placed,
        fled: l.fled,
        eatAcc: l.eatAcc,
      })),
      visits: this.visits,
      repelled: this.repelled,
      eaten: this.eaten,
    };
  }

  restore(s: ReturnType<LadybugManager['toSave']>): void {
    for (const l of this.ladybugs) this.group.remove(l.mesh);
    this.ladybugs = [];
    for (const d of s.ladybugs) {
      const c = this.aphids.colonies[d.colony];
      if (!c) continue;
      const l = this.add(c, d.placed);
      Object.assign(l, { state: d.state, t: d.t, eaten: d.eaten, appetite: d.appetite, harass: d.harass, ang: d.ang, h: d.h, flyAng: d.flyAng, fled: d.fled, eatAcc: d.eatAcc });
    }
    this.visits = s.visits;
    this.repelled = s.repelled;
    this.eaten = s.eaten;
  }
}

import { L, type Text } from '../../../core/i18n';
import type { Point3 } from '../../../core/sim/events';
import { TAU } from '../../../core/util/math';
import type { SimClock } from '../../../core/sim/clock';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import type { Bee, Bees } from './bees';
import { MOUTH, steer } from './flight';

const N = CONFIG.hornets;
const F = CONFIG.forage;

/**
 * come 飞过来；hawk 在巢门外悬停；strike 扑向一只蜂；land 扑到管口上；ball 被围在热球里；
 * leave 飞走（带着抓到的蜂，或者待够了）；away 飞走了、过一会回来；dead 死了掉在地上
 */
export type HornetState = 'come' | 'hawk' | 'strike' | 'land' | 'ball' | 'leave' | 'away' | 'dead';

export class Hornet {
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly vel = { x: 0, y: 0, z: 0 };
  readonly prev = { x: 0, y: 0, z: 0 };
  readonly spot = { x: 0, y: 0, z: 0 };
  h = 0;
  state: HornetState = 'come';
  /** 这个状态还剩几秒（悬停时是换下一个点、死了是在地上躺了多久） */
  t = 0;
  /** 在巢门外还能待几秒；扑一次后歇几秒 */
  left = 0;
  cool = 0;
  prey = -1;
  /** 带着抓到的蜂 */
  carrying = false;
  /** 热球里的温度（°C）、热过 lethal 累计了几秒 */
  heat = 0;
  dose = 0;

  constructor(readonly id: number) {}
}

type HornetSave = [id: number, state: HornetState, pos: number[], vel: number[], spot: number[], h: number, t: number, left: number, cool: number, prey: number, carrying: number, heat: number, dose: number];

export interface HornetsSave {
  list: HornetSave[];
  day: number;
  today: boolean;
  hourAcc: number;
  plate: boolean;
  stats: number[];
}

/** 胡蜂要知道的：蜂、气温、能不能飞、地面、时刻，记事件 */
export interface HornetHost {
  bees: Bees;
  air(): number;
  flyable(): boolean;
  ground(x: number, z: number): number;
  clock: Pick<SimClock, 'totalDays' | 'hour' | 'seconds' | 'seasonalValue'>;
  log(msg: Text, id?: number): void;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const v3 = (p: Point3) => [r3(p.x), r3(p.y), r3(p.z)];

/**
 * 胡蜂（P-012、T-022）：午后来巢门外悬停，扑抓进出的蜂；守卫抖翅让它难抓中，扑到管口上就被围成热球闷死。
 * 胡蜂多了采集蜂不敢出去（Bees 按 danger 看）。玩家能用电蚊拍打死它、在管口装防护片
 */
export class Hornets {
  readonly list: Hornet[] = [];
  /** 管口装了防护片 */
  plate = false;
  /** 来过几只、抓走几只蜂、热球闷死几只、电蚊拍打死几只、围过几次热球 */
  visits = 0;
  caught = 0;
  killed = 0;
  swatted = 0;
  balls = 0;
  private day = -1;
  private today = false;
  private hourAcc = 0;
  private target = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly rng: Rng,
    private readonly nextId: () => number,
    private readonly dayLength: number,
    private readonly host: HornetHost,
  ) {}

  get(id: number): Hornet | undefined {
    return this.list.find((h) => h.id === id);
  }

  /** 巢门外有活着的胡蜂（守卫抖翅） */
  threat(): boolean {
    return this.list.some((h) => h.state !== 'away' && h.state !== 'dead' && h.state !== 'leave' && dist(h.pos, MOUTH) < N.threatR);
  }

  /** 采集蜂走到巢门时不出去的机会：每只悬停的胡蜂 paralysis */
  danger(): number {
    let n = 0;
    for (const h of this.list) if ((h.state === 'hawk' || h.state === 'strike') && dist(h.pos, MOUTH) < N.threatR) n++;
    return Math.min(N.paralysisMax, n * N.paralysis);
  }

  /** 扑中一只蜂抓走的机会：守卫抖翅的越多越难，装了防护片更难 */
  catchChance(): number {
    const shimmer = Math.min(1, this.host.bees.shimmering / N.shimmerFull);
    return N.catch * (1 - N.shimmerCut * shimmer) * (this.plate ? N.plateCatch : 1);
  }

  /** 热球的中心；这只胡蜂没在热球里是 null */
  ballAt(id: number): Point3 | null {
    const h = this.get(id);
    return h && h.state === 'ball' ? h.pos : null;
  }

  /** 马上来 n 只（测试、截图用） */
  spawn(n = 1): void {
    for (let i = 0; i < n; i++) this.arrive();
  }

  /** 电蚊拍：打死一只；dry 为真时只看打不打得到 */
  swat(id: number, dry = false): boolean {
    const h = this.get(id);
    if (!h || h.state === 'dead' || h.state === 'away') return false;
    if (dry) return true;
    this.die(h);
    this.swatted++;
    this.host.log(L('ev.hornetSwat'), h.id);
    return true;
  }

  update(dt: number): void {
    const host = this.host;
    const day = Math.floor(host.clock.totalDays);
    if (day !== this.day) {
      this.day = day;
      this.today = host.clock.totalDays >= N.firstDay && this.rng.chance(host.clock.seasonalValue(CONFIG.seasons.hornets));
    }
    const hour = host.clock.hour;
    // 箱子空着（T-025）没有蜂可抓，不来
    const open = this.today && host.flyable() && hour >= N.hours[0] && hour < N.hours[1] && host.bees.list.length > 0;
    this.hourAcc += dt;
    if (this.hourAcc >= this.dayLength / 24) {
      this.hourAcc = 0;
      if (open && this.active() < N.max && this.rng.chance(N.perHour)) this.arrive();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      Object.assign(h.prev, h.pos);
      if (!this.step(h, dt, open)) this.list.splice(i, 1);
    }
  }

  /** 在花园里的（不算飞走了在外面等着回来的、死的） */
  private active(): number {
    return this.list.filter((h) => h.state !== 'away' && h.state !== 'dead').length;
  }

  private arrive(): void {
    const h = new Hornet(this.nextId());
    this.far(h.pos);
    h.left = this.rng.range(N.stay[0], N.stay[1]);
    this.enter(h);
    this.list.push(h);
    this.visits++;
    this.host.log(L('ev.hornet'), h.id);
  }

  private enter(h: Hornet): void {
    h.state = 'come';
    h.cool = this.rng.range(N.strike[0], N.strike[1]);
    this.pickSpot(h);
  }

  /** 花园边上随便一个方向、巡航高度的一点 */
  private far(out: Point3): void {
    const a = this.rng.range(0, TAU);
    out.x = Math.cos(a) * 1500;
    out.z = Math.sin(a) * 1500;
    out.y = this.host.ground(out.x, out.z) + 250;
  }

  private pickSpot(h: Hornet): void {
    const S = N.spot;
    h.spot.x = MOUTH.x - this.rng.range(S.out[0], S.out[1]);
    h.spot.y = MOUTH.y + this.rng.range(S.up[0], S.up[1]);
    h.spot.z = this.rng.range(-S.side, S.side);
    h.t = this.rng.range(N.drift[0], N.drift[1]);
  }

  private fly(h: Hornet, to: Point3, v: number, stop: boolean, dt: number): number {
    return steer(h, to, v, stop, dt, this.host.ground(h.pos.x, h.pos.z), this.host.clock.seconds);
  }

  private faceMouth(h: Hornet): void {
    h.h = Math.atan2(MOUTH.z - h.pos.z, MOUTH.x - h.pos.x);
  }

  /** 走一步；返回假时去掉这只 */
  private step(h: Hornet, dt: number, open: boolean): boolean {
    const host = this.host;
    switch (h.state) {
      case 'come':
        if (!host.flyable()) {
          this.leave(h);
          return true;
        }
        if (this.fly(h, h.spot, N.speed, true, dt) < 3) h.state = 'hawk';
        return true;
      case 'hawk': {
        h.left -= dt;
        if (h.left <= 0 || !host.flyable()) {
          this.leave(h);
          return true;
        }
        if ((h.t -= dt) <= 0) this.pickSpot(h);
        this.fly(h, h.spot, N.hover, true, dt);
        this.faceMouth(h);
        if (!this.plate && this.rng.chance(N.land * dt)) {
          h.state = 'land';
          return true;
        }
        if ((h.cool -= dt) > 0) return true;
        const b = this.preyNear(h);
        if (b) {
          h.state = 'strike';
          h.prey = b.id;
          h.t = 1.5;
        }
        return true;
      }
      case 'strike': {
        const b = host.bees.get(h.prey);
        if (!b || b.out !== 2 || (h.t -= dt) <= 0) {
          this.miss(h);
          return true;
        }
        if (this.fly(h, b.pos, N.dart, false, dt) > 1.2) return true;
        if (!this.rng.chance(this.catchChance())) {
          this.miss(h);
          return true;
        }
        b.life = b.age;
        this.caught++;
        h.carrying = true;
        host.log(L('ev.hornetCatch'), h.id);
        this.leave(h);
        return true;
      }
      case 'land': {
        const T = this.target;
        T.x = MOUTH.x - 1.6;
        T.y = MOUTH.y + 0.3;
        T.z = MOUTH.z;
        if (this.plate) {
          this.miss(h);
          return true;
        }
        if (this.fly(h, T, F.hop, true, dt) > 0.6) return true;
        h.state = 'ball';
        Object.assign(h.pos, T);
        h.vel.x = h.vel.y = h.vel.z = 0;
        h.heat = host.air();
        h.dose = 0;
        h.t = 0;
        this.balls++;
        host.bees.recruitBall(h.id, this.rng.int(N.ball[0], N.ball[1]));
        host.log(L('ev.ball'), h.id);
        return true;
      }
      case 'ball': {
        h.t += dt;
        const members = host.bees.ball(h.id);
        const air = host.air();
        const want = air + (N.ballMax - air) * Math.min(1, members.length / N.ballFull);
        h.heat += (want - h.heat) * Math.min(1, dt / N.ballRise);
        if (h.heat > N.lethal) h.dose += dt;
        if (h.dose >= N.dose) {
          // 球里也有蜂被蜇死、热死
          for (const b of members) if (this.rng.chance(N.ballLoss)) b.life = b.age;
          this.die(h);
          this.killed++;
          host.log(L('ev.ballKill'), h.id);
        } else if (h.t > 4 * N.dose && members.length < N.ballFull / 4) {
          // 围上来的蜂太少，胡蜂挣脱了
          this.leave(h);
          host.log(L('ev.ballEscape'), h.id);
        }
        return true;
      }
      case 'leave':
        if ((h.t -= dt) > 0 && this.fly(h, h.spot, N.speed, false, dt) > 40) return true;
        if (h.carrying && open && this.rng.chance(N.back)) {
          h.state = 'away';
          h.carrying = false;
          h.t = this.rng.range(N.backIn[0], N.backIn[1]);
          return true;
        }
        return false;
      case 'away':
        if ((h.t -= dt) > 0) return true;
        if (!open) return false;
        this.far(h.pos);
        h.vel.x = h.vel.y = h.vel.z = 0;
        this.enter(h);
        return true;
      case 'dead': {
        h.t += dt;
        const g = host.ground(h.pos.x, h.pos.z) + 0.4;
        if (h.pos.y > g) {
          h.vel.y -= 980 * dt;
          h.pos.y = Math.max(g, h.pos.y + h.vel.y * dt);
          h.pos.x += h.vel.x * dt;
          h.pos.z += h.vel.z * dt;
          h.vel.x *= 0.9;
          h.vel.z *= 0.9;
        } else h.vel.x = h.vel.y = h.vel.z = 0;
        return h.t < N.deadTime;
      }
    }
  }

  /** 离它 reach 以内、飞着的蜂里最近的一只 */
  private preyNear(h: Hornet): Bee | null {
    let best: Bee | null = null;
    let bestD = N.reach;
    for (const b of this.host.bees.list) {
      if (b.out !== 2 || b.act === 'ball') continue;
      const d = dist(b.pos, h.pos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private miss(h: Hornet): void {
    h.state = 'hawk';
    h.prey = -1;
    h.cool = this.rng.range(N.strike[0], N.strike[1]);
    this.pickSpot(h);
  }

  private leave(h: Hornet): void {
    h.state = 'leave';
    h.prey = -1;
    this.far(h.spot);
    h.t = 30;
  }

  private die(h: Hornet): void {
    h.state = 'dead';
    h.prey = -1;
    h.carrying = false;
    h.t = 0;
    h.vel.y = Math.min(0, h.vel.y);
  }

  toSave(): HornetsSave {
    return {
      list: this.list.map((h) => [h.id, h.state, v3(h.pos), v3(h.vel), v3(h.spot), r3(h.h), r3(h.t), r3(h.left), r3(h.cool), h.prey, h.carrying ? 1 : 0, r3(h.heat), r3(h.dose)]),
      day: this.day,
      today: this.today,
      hourAcc: r3(this.hourAcc),
      plate: this.plate,
      stats: [this.visits, this.caught, this.killed, this.swatted, this.balls],
    };
  }

  restore(d: HornetsSave): void {
    this.list.length = 0;
    for (const [id, state, pos, vel, spot, hh, t, left, cool, prey, carrying, heat, dose] of d.list) {
      const h = new Hornet(id);
      Object.assign(h, { state, h: hh, t, left, cool, prey, carrying: carrying === 1, heat, dose });
      [h.pos.x, h.pos.y, h.pos.z] = pos;
      [h.vel.x, h.vel.y, h.vel.z] = vel;
      [h.spot.x, h.spot.y, h.spot.z] = spot;
      Object.assign(h.prev, h.pos);
      this.list.push(h);
    }
    this.day = d.day;
    this.today = d.today;
    this.hourAcc = d.hourAcc;
    this.plate = d.plate;
    [this.visits, this.caught, this.killed, this.swatted, this.balls] = d.stats;
  }
}

const dist = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

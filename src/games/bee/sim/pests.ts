import { L, type Text } from '../../../core/i18n';
import { TAU } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';
import type { Bee } from './bees';
import { CELL, SITES, cellSite, siteNeighbors, siteU, siteV, type Comb } from './comb';

const M = CONFIG.pests.moth;
const S = CONFIG.pests.sacbrood;

/** 巢虫：在 face 那一面的房底下沿中肋爬，dir 是往哪个方向（巢面坐标的角度） */
export class Worm {
  /** 下一格还要爬几秒、活了多久 */
  next = 0;
  age = 0;

  constructor(
    readonly id: number,
    public face: number,
    public site: number,
    public dir: number,
    public life: number,
  ) {}

  get cell(): number {
    return this.face * SITES + this.site;
  }
}

type WormSave = [id: number, face: number, site: number, dir: number, life: number, next: number, age: number];

export interface PestsSave {
  worms: WormSave[];
  day: number;
  hourAcc: number;
  acc: number;
  announce: boolean;
  baldDay: number;
  stats: number[];
}

/** 巢虫、中囊病要知道的：巢里的蜂、时刻，记事件 */
export interface PestsHost {
  bees: () => readonly Bee[];
  clock: { totalDays: number; hour: number };
  log(msg: Text, cell?: number): void;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const isHoney = (c: number) => c === CELL.nectar || c === CELL.honey || c === CELL.cappedHoney;

/**
 * 巢虫和中囊病（T-024）。巢虫是蜡螟的幼虫，弱群里夜里飞进来的蜡螟多，孵出的巢虫在房底下打隧道，
 * 上面的封盖子成了白头蛹；蜂多的地方巢虫容易被拖出去。中囊病由哺育蜂、清理蜂在幼虫之间传（传染写在 Bees 里），
 * 染病的幼虫到封盖时死成囊。没有治病的按钮：割掉、换掉巢脾能连巢虫一起拿走
 */
export class Pests {
  readonly worms: Worm[] = [];
  /** 来过几窝蜡螟、孵出几条巢虫、被蜂拖出去的、爬出去化蛹的、随巢脾割掉换掉的 */
  clutches = 0;
  hatched = 0;
  removed = 0;
  matured = 0;
  culled = 0;
  /** 白头蛹、被丝缠死的蛹 */
  bald = 0;
  entangled = 0;
  /** 发过几次中囊病、染上的幼虫、死成囊的 */
  outbreaks = 0;
  infected = 0;
  sacs = 0;
  private day = -1;
  private hourAcc = 0;
  private acc = 0;
  /** 这次发病还没死出第一个囊（死出来时记事件） */
  private announce = false;
  /** 白头蛹的事件一天最多记一次 */
  private baldDay = -1;
  private nb: number[] = [];

  constructor(
    private readonly rng: Rng,
    private readonly nextId: () => number,
    private readonly comb: Comb,
    private readonly dayLength: number,
    private readonly host: PestsHost,
  ) {}

  get(id: number): Worm | undefined {
    return this.worms.find((w) => w.id === id);
  }

  /** 这个巢房下面的巢虫 */
  wormAt(cell: number): Worm | undefined {
    return this.worms.find((w) => w.cell === cell);
  }

  update(dt: number): void {
    const clock = this.host.clock;
    const day = Math.floor(clock.totalDays);
    if (day !== this.day) {
      this.day = day;
      if (clock.totalDays >= S.firstDay && this.rng.chance(S.days)) this.outbreak();
    }
    this.hourAcc += dt;
    if (this.hourAcc >= this.dayLength / 24) {
      this.hourAcc = 0;
      const h = clock.hour;
      if (clock.totalDays >= M.firstDay && (h >= M.hours[0] || h < M.hours[1]) && this.rng.chance(this.mothChance())) this.lay();
    }
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i];
      w.age += dt;
      if (w.age >= w.life) {
        this.worms.splice(i, 1);
        this.matured++;
        this.comb.version++;
        continue;
      }
      w.next -= dt;
      if (w.next <= 0) this.crawl(w);
    }
    this.acc += dt;
    if (this.acc >= 1) {
      const step = this.acc;
      this.acc = 0;
      this.hunt(step);
    }
  }

  /** 这个小时飞进一只蜡螟的机会：蜂群越弱（每个造好的位置上的蜂越少）越大 */
  mothChance(): number {
    let built = 0;
    for (let s = 0; s < SITES; s++) if (this.comb.build[s] >= 1) built++;
    let inside = 0;
    for (const b of this.host.bees()) if (!b.out) inside++;
    const weak = Math.max(0, Math.min(1, 1 - inside / Math.max(1, built) / M.cover));
    return M.perHour[0] + (M.perHour[1] - M.perHour[0]) * weak;
  }

  /**
   * 一只蜡螟在巢脾边上产一窝卵，孵出几条巢虫，朝子脾钻（测试、截图也用）：挑一个封盖子，从离它最近的巢脾边上进去；
   * 没有封盖子就随便一处巢脾边
   */
  lay(n = this.rng.int(M.clutch[0], M.clutch[1])): void {
    const cb = this.comb;
    const edge: number[] = [];
    for (let s = 0; s < SITES; s++) if (cb.build[s] >= 1 && siteNeighbors(s, this.nb).some((x) => cb.build[x] < 1)) edge.push(s);
    if (!edge.length) return;
    const capped: number[] = [];
    for (let c = 0; c < 2 * SITES; c++) if (cb.content[c] === CELL.capped) capped.push(c);
    let site = edge[this.rng.int(0, edge.length - 1)];
    let face = this.rng.int(0, 1);
    let aim = -1;
    if (capped.length) {
      aim = capped[this.rng.int(0, capped.length - 1)];
      face = aim >= SITES ? 1 : 0;
      const u = siteU(cellSite(aim));
      const v = siteV(cellSite(aim));
      let best = Infinity;
      for (const s of edge) {
        const d = (siteU(s) - u) ** 2 + (siteV(s) - v) ** 2;
        if (d < best) (best = d), (site = s);
      }
    }
    this.clutches++;
    for (let i = 0; i < n; i++) {
      const dir = aim >= 0 ? Math.atan2(siteV(cellSite(aim)) - siteV(site), siteU(cellSite(aim)) - siteU(site)) + this.rng.range(-0.5, 0.5) : this.rng.range(0, TAU);
      const w = new Worm(this.nextId(), face, site, dir, this.rng.range(M.life[0], M.life[1]));
      w.next = this.rng.range(M.crawl[0], M.crawl[1]);
      this.worms.push(w);
      this.hatched++;
    }
  }

  /** 爬到下一格：大体顺着原来的方向，偶尔拐弯，偏爱封盖子底下；不进蜜房、没造好的地方，走不通就掉头 */
  private crawl(w: Worm): void {
    const cb = this.comb;
    w.next = this.rng.range(M.crawl[0], M.crawl[1]);
    if (this.rng.chance(M.turn)) w.dir += (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 3);
    const u = siteU(w.site);
    const v = siteV(w.site);
    let best = -1;
    let bestDot = -Infinity;
    for (const n of siteNeighbors(w.site, this.nb)) {
      if (cb.build[n] < 1 || isHoney(cb.content[w.face * SITES + n])) continue;
      const d = Math.cos(Math.atan2(siteV(n) - v, siteU(n) - u) - w.dir) + (cb.content[w.face * SITES + n] === CELL.capped ? M.brood : 0);
      if (d > bestDot) {
        bestDot = d;
        best = n;
      }
    }
    if (best < 0 || bestDot < 0) {
      w.dir += Math.PI;
      return;
    }
    w.site = best;
    if (cb.bore(w.cell, M.silk, this.rng.chance(M.bald))) {
      this.bald++;
      const day = Math.floor(this.host.clock.totalDays);
      if (day !== this.baldDay) {
        this.baldDay = day;
        this.host.log(L('ev.bald'), w.cell);
      }
    }
  }

  /** 蜂把身边的巢虫拖出去：附近的蜂越多越快，躲在封盖子下面的难找 */
  private hunt(step: number): void {
    if (!this.worms.length) return;
    const bees = this.host.bees();
    const r2 = M.seeR * M.seeR;
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i];
      const u = siteU(w.site);
      const v = siteV(w.site);
      let n = 0;
      for (const b of bees) if (!b.out && b.face === w.face && (b.u - u) ** 2 + (b.v - v) ** 2 < r2) n++;
      const hidden = this.comb.content[w.cell] === CELL.capped ? M.hidden : 1;
      if (!this.rng.chance(M.remove * Math.min(1, n / M.crowd) * hidden * step)) continue;
      this.worms.splice(i, 1);
      this.removed++;
      this.comb.version++;
    }
  }

  /** 割掉、换掉的巢脾上的巢虫一起拿走 */
  cull(sites: readonly number[]): void {
    const gone = new Set(sites);
    for (let i = this.worms.length - 1; i >= 0; i--)
      if (gone.has(this.worms[i].site)) {
        this.worms.splice(i, 1);
        this.culled++;
        this.comb.version++;
      }
  }

  /** 发一次中囊病：一只幼虫和它身边同一面的几只染上 */
  outbreak(): boolean {
    const cb = this.comb;
    const larvae: number[] = [];
    for (let c = 0; c < 2 * SITES; c++) if (cb.content[c] === CELL.larva && !cb.sick[c]) larvae.push(c);
    if (!larvae.length) return false;
    const first = larvae[this.rng.int(0, larvae.length - 1)];
    const u = siteU(cellSite(first));
    const v = siteV(cellSite(first));
    const near = larvae
      .filter((c) => (c >= SITES) === (first >= SITES))
      .map((c) => [c, Math.hypot(siteU(cellSite(c)) - u, siteV(cellSite(c)) - v)] as const)
      .filter(([, d]) => d < S.seedR)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .slice(0, this.rng.int(S.seed[0], S.seed[1]));
    for (const [c] of near) this.infect(c);
    this.outbreaks++;
    this.announce = true;
    return true;
  }

  infect(cell: number): void {
    if (this.comb.content[cell] !== CELL.larva || this.comb.sick[cell]) return;
    this.comb.sick[cell] = 1;
    this.infected++;
  }

  /** 一只染病的幼虫死成了囊（Comb.develop 回调） */
  onSac(cell: number): void {
    this.sacs++;
    if (!this.announce) return;
    this.announce = false;
    this.host.log(L('ev.sac'), cell);
  }

  /** 巢里还有几只染病的幼虫、几个死囊没拖走 */
  disease(): { sick: number; sacs: number } {
    const cb = this.comb;
    let sick = 0;
    let sacs = 0;
    for (let c = 0; c < 2 * SITES; c++) {
      if (cb.sick[c]) sick++;
      if (cb.content[c] === CELL.sac) sacs++;
    }
    return { sick, sacs };
  }

  toSave(): PestsSave {
    return {
      worms: this.worms.map((w) => [w.id, w.face, w.site, r3(w.dir), r3(w.life), r3(w.next), r3(w.age)]),
      day: this.day,
      hourAcc: r3(this.hourAcc),
      acc: r3(this.acc),
      announce: this.announce,
      baldDay: this.baldDay,
      stats: [this.clutches, this.hatched, this.removed, this.matured, this.culled, this.bald, this.entangled, this.outbreaks, this.infected, this.sacs],
    };
  }

  restore(d: PestsSave): void {
    this.worms.length = 0;
    for (const [id, face, site, dir, life, next, age] of d.worms) {
      const w = new Worm(id, face, site, dir, life);
      w.next = next;
      w.age = age;
      this.worms.push(w);
    }
    this.day = d.day;
    this.hourAcc = d.hourAcc;
    this.acc = d.acc;
    this.announce = d.announce;
    this.baldDay = d.baldDay;
    [this.clutches, this.hatched, this.removed, this.matured, this.culled, this.bald, this.entangled, this.outbreaks, this.infected, this.sacs] = d.stats;
  }
}

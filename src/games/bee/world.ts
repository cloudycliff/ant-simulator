import { L, t, type Text } from '../../core/i18n';
import { SaveSlot, type SaveMeta } from '../../core/platform/saveSlot';
import type { Point3 } from '../../core/sim/events';
import { Simulation } from '../../core/sim/simulation';
import { clamp } from '../../core/util/math';
import { Noise2D } from '../../core/util/random';
import { CONFIG } from './config';
import { CELLS, COMB_H, Comb, cellFace, cellPos, cellSite, type CombSave } from './sim/comb';
import { Bees, type Bee, type BeesSave } from './sim/bees';
import type { ToolResult } from '../../core/ui/tools';
import { Flowers, SUGAR, type FlowerSave } from './sim/flowers';
import { Weather, type WeatherSave } from './sim/weather';
import { Heat, SITE_HEAT, broodRate, broodRisk, type HeatSave } from './sim/heat';

/** 能选中的东西。巢房的 id 就是巢房编号，花丛、蜂的 id 是 ids.next 发的号，都不随读档变 */
export type BeeRef = { kind: 'hive'; id: number } | { kind: 'cell'; id: number } | { kind: 'flower'; id: number } | { kind: 'bee'; id: number };

/** 花园和观察箱。地形由编号生成，不进存档 */
export class BeeWorld extends Simulation<BeeRef> {
  readonly comb = new Comb();
  readonly flowers = new Flowers();
  readonly bees: Bees;
  readonly weather: Weather;
  readonly heat = new Heat();
  private noise: Noise2D;
  private followPos: Point3 = { x: 0, y: 0, z: 0 };
  private broodClock = 0;

  constructor(readonly seed: number) {
    super(CONFIG.clock.dayLength, CONFIG.clock.startHour, seed);
    this.noise = new Noise2D(seed);
    const H = CONFIG.hive;
    this.comb.generate(this.rng, seed);
    this.flowers.generate(this.rng, () => this.ids.next('flower'));
    this.weather = new Weather(this.rng, CONFIG.clock.dayLength, this.clock, (msg) => this.events.push(msg));
    this.bees = new Bees(this.comb, this.rng, this.ids, () => this.clock.seconds, {
      flowers: this.flowers,
      hour: () => this.clock.hour,
      sun: () => this.clock.sunAzimuth,
      ground: (x, z) => this.groundAt(x, z),
      flyable: () => this.weather.flyable,
      heat: this.heat,
      recall: () => (this.weather.phase === 'rain' ? CONFIG.weather.recall[1] : this.weather.phase === 'overcast' ? CONFIG.weather.recall[0] : 0),
    });
    this.bees.generate();
    this.heat.update(0, this.weather.air(this.clock.hour), this.bees.list, this.comb);
    this.addSystem('brood', (dt) => {
      this.broodClock += dt;
      if (this.broodClock < 1) return;
      const step = this.broodClock;
      const temp = this.heat.temp;
      this.comb.develop(
        step,
        (cell) => this.bees.emerge(cell),
        () => this.bees.starved++,
        (cell) => broodRate(temp[SITE_HEAT[cellSite(cell)]]),
        (cell) => {
          const r = broodRisk(temp[SITE_HEAT[cellSite(cell)]]);
          if (r <= 0 || !this.rng.chance(r * step)) return false;
          this.heat.chilled++;
          return true;
        },
      );
      this.broodClock = 0;
    });
    this.addSystem('weather', (dt) => this.weather.update(dt));
    this.addSystem('heat', (dt) => this.heat.update(dt, this.weather.air(this.clock.hour), this.bees.list, this.comb));
    this.addSystem('bees', (dt) => this.bees.update(dt));
    this.addSystem('flowers', (dt) => this.flowers.update(dt, this.clock.hour, this.weather.rain));
    this.saves.add(
      'comb',
      () => ({ ...this.comb.toSave(), clock: this.broodClock }),
      (d: CombSave & { clock: number }) => {
        this.comb.restore(d);
        this.broodClock = d.clock;
      },
    );
    this.saves.add(
      'bees',
      () => this.bees.toSave(),
      (d: BeesSave) => this.bees.restore(d),
    );
    this.saves.add(
      'flowers',
      () => this.flowers.toSave(),
      (d: FlowerSave) => this.flowers.restore(d),
    );
    this.saves.add(
      'heat',
      () => this.heat.toSave(),
      (d: HeatSave) => this.heat.restore(d),
    );
    this.saves.add(
      'weather',
      () => this.weather.toSave(),
      (d: WeatherSave) => this.weather.restore(d),
    );
    this.entities.define('hive', {
      pos: () => ({ x: 0, y: H.baseY + COMB_H / 2, z: 0 }),
      viewDistance: 110,
      viewDir: (_r, from) => ({ x: 0.15, y: 0.1, z: from.z < 0 ? -1 : 1 }),
    });
    this.entities.define('cell', {
      pos: (r) => (r.id >= 0 && r.id < CELLS ? cellPos(r.id) : null),
      viewDistance: 7,
      viewDir: (r) => ({ x: 0.2, y: 0.25, z: cellFace(r.id) ? -1 : 1 }),
    });
    this.entities.define('flower', {
      pos: (r) => {
        const p = this.flowers.get(r.id);
        return p ? { x: p.x, y: this.groundAt(p.x, p.z) + (p.species === SUGAR ? 45 : 30), z: p.z } : null;
      },
      viewDistance: (r) => (this.flowers.get(r.id)?.species === SUGAR ? 110 : 450),
    });
    this.entities.define('bee', {
      pos: (r) => {
        const b = this.bees.get(r.id);
        return b ? this.beePos(b, this.followPos) : null;
      },
      viewDistance: 5,
      follow: true,
      // 巢里从玻璃那边看；在外面从身后上方看
      viewDir: (r) => {
        const b = this.bees.get(r.id);
        if (!b) return null;
        return b.out ? { x: -Math.cos(b.h), y: 0.6, z: -Math.sin(b.h) } : { x: 0.25, y: 0.4, z: b.face ? -1 : 1 };
      },
    });
  }

  /** 画面上这只蜂在哪：在上一步和这一步的位置之间按 alpha 插值，飞得快的蜂才不会一顿一顿 */
  beePos(b: Bee, out: Point3): Point3 {
    const k = this.alpha;
    out.x = b.prev.x + (b.pos.x - b.prev.x) * k;
    out.y = b.prev.y + (b.pos.y - b.prev.y) * k;
    out.z = b.prev.z + (b.pos.z - b.prev.z) * k;
    return out;
  }

  /** 种一片花（species 不能是糖水）；dry 为真时只看能不能种 */
  plant(species: number, x: number, z: number, dry = false): ToolResult {
    const T = CONFIG.tools;
    const sp = CONFIG.flowers.species[species];
    if (this.flowers.patches.filter((p) => p.planted && p.species !== SUGAR).length >= T.maxPlanted) return { ok: false, msg: L('tool.tooManyPlanted', { n: T.maxPlanted }) };
    const err = this.flowers.checkSpot(x, z, sp.plantR);
    if (err) return fail(err);
    if (dry) return { ok: true };
    const p = this.flowers.add(this.ids.next('flower'), species, x, z, Math.floor(this.rng.next() * 2 ** 31));
    const msg = L('tool.planted', { place: this.describePlace(x, z), flower: L(`flower.${sp.key}`) });
    this.events.push(msg, { kind: 'flower', id: p.id });
    return { ok: true, msg };
  }

  /** 放一碟糖水；点在已有的碟子上是添满 */
  feed(x: number, z: number, dry = false): ToolResult {
    const T = CONFIG.tools;
    const dishes = this.flowers.patches.filter((p) => p.species === SUGAR);
    const near = dishes.find((p) => Math.hypot(p.x - x, p.z - z) < T.refillR);
    if (near) {
      if (dry) return { ok: true };
      near.nectar = CONFIG.flowers.species[SUGAR].nectar;
      return { ok: true, msg: L('tool.refilled') };
    }
    if (dishes.length >= T.maxFeeders) return { ok: false, msg: L('tool.tooManyFeeders', { n: T.maxFeeders }) };
    const err = this.flowers.checkSpot(x, z, CONFIG.flowers.species[SUGAR].plantR);
    if (err) return fail(err);
    if (dry) return { ok: true };
    const p = this.flowers.add(this.ids.next('flower'), SUGAR, x, z, Math.floor(this.rng.next() * 2 ** 31));
    const msg = L('tool.fed', { place: this.describePlace(x, z) });
    this.events.push(msg, { kind: 'flower', id: p.id });
    return { ok: true, msg };
  }

  /** 离蜂箱多远、在哪个方向（事件里用） */
  describePlace(x: number, z: number): Text {
    const sector = Math.round(Math.atan2(z, x) / (Math.PI / 4));
    return L('place.dir', { dir: L(COMPASS[(sector + 8) % 8]), m: (Math.hypot(x, z) / 100).toFixed(0) });
  }

  /** 地面高度：蜂箱周围是平的，往外慢慢起伏 */
  groundAt(x: number, z: number): number {
    const G = CONFIG.garden;
    return G.bump * this.noise.fbm(x * 0.002, z * 0.002, 3) * clamp((Math.hypot(x, z) - G.flatR) / 200, 0, 1);
  }
}

/** 方位：+x 是东，+z 是南（和太阳的方位角一样） */
const COMPASS = ['dir.e', 'dir.se', 'dir.s', 'dir.sw', 'dir.w', 'dir.nw', 'dir.n', 'dir.ne'] as const;
const fail = (key: Parameters<typeof L>[0]): ToolResult => ({ ok: false, msg: L(key) });

const SAVE_VERSION = 10;

export interface BeeSaveData {
  version: number;
  seed: number;
  savedAt: number;
  clock: { seconds: number; speed: number };
  camera?: number[];
  bees?: BeesSave;
}

export type BeeSaveMeta = SaveMeta & { bees?: number };

export const beeSave = {
  slot: new SaveSlot<BeeSaveData, BeeSaveMeta>('cyber-bee-save'),
  write: (w: BeeWorld, savedAt: number) => ({ version: SAVE_VERSION, seed: w.seed, savedAt, ...w.saves.save() }) as unknown as BeeSaveData,
  read(w: BeeWorld, d: BeeSaveData): void {
    if (w.seed !== d.seed) throw new Error(t('save.seedMismatch'));
    if (d.version !== SAVE_VERSION) throw new Error(t('save.incompatible'));
    w.saves.restore(d as unknown as Record<string, unknown>);
  },
  problem: (d: BeeSaveData) => (d.version !== SAVE_VERSION ? L('save.incompatible') : null),
  meta: (d: BeeSaveData): BeeSaveMeta => ({ savedAt: d.savedAt, seconds: Math.round(d.clock.seconds), bees: d.bees?.bees.length }),
};

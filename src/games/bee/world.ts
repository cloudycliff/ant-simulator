import { L, t } from '../../core/i18n';
import { SaveSlot, type SaveMeta } from '../../core/platform/saveSlot';
import type { Point3 } from '../../core/sim/events';
import { Simulation } from '../../core/sim/simulation';
import { clamp } from '../../core/util/math';
import { Noise2D } from '../../core/util/random';
import { CONFIG } from './config';
import { CELLS, COMB_H, Comb, cellFace, cellPos, type CombSave } from './sim/comb';
import { Bees, type Bee, type BeesSave } from './sim/bees';
import { Flowers, type FlowerSave } from './sim/flowers';

/** 能选中的东西。巢房的 id 就是巢房编号，花丛、蜂的 id 是 ids.next 发的号，都不随读档变 */
export type BeeRef = { kind: 'hive'; id: number } | { kind: 'cell'; id: number } | { kind: 'flower'; id: number } | { kind: 'bee'; id: number };

/** 花园和观察箱。地形由编号生成，不进存档 */
export class BeeWorld extends Simulation<BeeRef> {
  readonly comb = new Comb();
  readonly flowers = new Flowers();
  readonly bees: Bees;
  private noise: Noise2D;
  private followPos: Point3 = { x: 0, y: 0, z: 0 };
  private broodClock = 0;

  constructor(readonly seed: number) {
    super(CONFIG.clock.dayLength, CONFIG.clock.startHour, seed);
    this.noise = new Noise2D(seed);
    const H = CONFIG.hive;
    this.comb.generate(this.rng, seed);
    this.flowers.generate(this.rng, () => this.ids.next('flower'));
    this.bees = new Bees(this.comb, this.rng, this.ids, () => this.clock.seconds, {
      flowers: this.flowers,
      hour: () => this.clock.hour,
      sun: () => this.clock.sunAzimuth,
      ground: (x, z) => this.groundAt(x, z),
    });
    this.bees.generate();
    this.addSystem('brood', (dt) => {
      this.broodClock += dt;
      if (this.broodClock < 1) return;
      this.comb.develop(
        this.broodClock,
        (cell) => this.bees.emerge(cell),
        () => this.bees.starved++,
      );
      this.broodClock = 0;
    });
    this.addSystem('bees', (dt) => this.bees.update(dt));
    this.addSystem('flowers', (dt) => this.flowers.update(dt, this.clock.hour));
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
        return p ? { x: p.x, y: this.groundAt(p.x, p.z) + 30, z: p.z } : null;
      },
      viewDistance: 450,
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

  /** 地面高度：蜂箱周围是平的，往外慢慢起伏 */
  groundAt(x: number, z: number): number {
    const G = CONFIG.garden;
    return G.bump * this.noise.fbm(x * 0.002, z * 0.002, 3) * clamp((Math.hypot(x, z) - G.flatR) / 200, 0, 1);
  }
}

const SAVE_VERSION = 7;

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

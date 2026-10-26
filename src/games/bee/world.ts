import { L, t } from '../../core/i18n';
import { SaveSlot, type SaveMeta } from '../../core/platform/saveSlot';
import { Simulation } from '../../core/sim/simulation';
import { clamp } from '../../core/util/math';
import { Noise2D } from '../../core/util/random';
import { CONFIG } from './config';
import { CELLS, COMB_H, Comb, cellFace, cellPos, type CombSave } from './sim/comb';

/** 能选中的东西；蜂、花丛加进来时在这里扩充。巢房的 id 就是巢房编号，不随读档变 */
export type BeeRef = { kind: 'hive'; id: number } | { kind: 'cell'; id: number };

/** 花园和观察箱。地形由编号生成，不进存档 */
export class BeeWorld extends Simulation<BeeRef> {
  readonly comb = new Comb();
  /** 还没有蜂时羽化的只数（蜂加进来后去掉） */
  emerged = 0;
  private noise: Noise2D;
  private broodClock = 0;

  constructor(readonly seed: number) {
    super(CONFIG.clock.dayLength, CONFIG.clock.startHour, seed);
    this.noise = new Noise2D(seed);
    const H = CONFIG.hive;
    this.comb.generate(this.rng, seed);
    this.addSystem('brood', (dt) => {
      this.broodClock += dt;
      if (this.broodClock < 1) return;
      this.emerged += this.comb.develop(this.broodClock);
      this.broodClock = 0;
    });
    this.saves.add(
      'comb',
      () => ({ ...this.comb.toSave(), emerged: this.emerged, clock: this.broodClock }),
      (d: CombSave & { emerged: number; clock: number }) => {
        this.comb.restore(d);
        this.emerged = d.emerged;
        this.broodClock = d.clock;
      },
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
  }

  /** 地面高度：蜂箱周围是平的，往外慢慢起伏 */
  groundAt(x: number, z: number): number {
    const G = CONFIG.garden;
    return G.bump * this.noise.fbm(x * 0.002, z * 0.002, 3) * clamp((Math.hypot(x, z) - G.flatR) / 200, 0, 1);
  }
}

const SAVE_VERSION = 2;

export interface BeeSaveData {
  version: number;
  seed: number;
  savedAt: number;
  clock: { seconds: number; speed: number };
  camera?: number[];
}

export type BeeSaveMeta = SaveMeta;

export const beeSave = {
  slot: new SaveSlot<BeeSaveData, BeeSaveMeta>('cyber-bee-save'),
  write: (w: BeeWorld, savedAt: number) => ({ version: SAVE_VERSION, seed: w.seed, savedAt, ...w.saves.save() }) as unknown as BeeSaveData,
  read(w: BeeWorld, d: BeeSaveData): void {
    if (w.seed !== d.seed) throw new Error(t('save.seedMismatch'));
    if (d.version !== SAVE_VERSION) throw new Error(t('save.incompatible'));
    w.saves.restore(d as unknown as Record<string, unknown>);
  },
  problem: (d: BeeSaveData) => (d.version !== SAVE_VERSION ? L('save.incompatible') : null),
  meta: (d: BeeSaveData): BeeSaveMeta => ({ savedAt: d.savedAt, seconds: Math.round(d.clock.seconds) }),
};

import { CONFIG } from '../config';
import { TAU } from '../util/math';
import { Rng } from '../util/random';
import { Nest, type Chamber } from '../nest/nest';
import type { Ant } from '../sim/ant';
import { SimClock } from '../sim/clock';
import { Colony } from '../sim/colony';
import { AphidManager } from './aphids';
import { FoodManager } from './food';
import { PheromoneField } from './pheromone';
import { Terrain } from './terrain';
import { Vegetation } from './vegetation';

/** 模拟世界：持有所有模拟状态，按固定步长推进。不依赖渲染。 */
export class World {
  readonly rng: Rng;
  readonly clock = new SimClock();
  readonly terrain: Terrain;
  readonly nest: Nest;
  readonly veg: Vegetation;
  readonly food: FoodManager;
  readonly aphids: AphidManager;
  readonly pheromone: PheromoneField;
  readonly colony: Colony;
  private acc = 0;
  /** 最近一帧实际执行的模拟步数（性能面板用） */
  lastSteps = 0;

  constructor(seed = CONFIG.seed) {
    this.rng = new Rng(seed);
    this.terrain = new Terrain(seed);
    for (const e of Nest.entranceLayout()) this.terrain.addMound(e.x, e.z, e.name === '主入口' ? 4.2 : 3.2, e.name === '主入口' ? 1.3 : 0.9);
    this.terrain.build();
    this.nest = new Nest(this.terrain);
    this.nest.generate(seed + 1);
    this.veg = new Vegetation(this.terrain, this.rng);
    this.veg.build();
    for (const c of this.nest.chambers) {
      c.underStone = this.veg.obstacles.some((o) => o.kind === 'stone' && o.r > 3 && Math.hypot(o.x - c.floor.x, o.z - c.floor.z) < o.r + 3);
    }
    this.food = new FoodManager(this.terrain, this.veg, this.rng);
    this.food.init();
    this.aphids = new AphidManager(this.veg, this.rng);
    this.pheromone = new PheromoneField(this.terrain);
    this.colony = new Colony(this);
    this.colony.init();
  }

  /** 房间温度：土壤温度随深度变化；石块下方的房间白天额外吸热升温 */
  chamberTemperature(c: Chamber): number {
    const t = this.clock.temperatureAt(c.depth);
    if (!c.underStone) return t;
    const W = CONFIG.world;
    const heat = Math.max(0, Math.sin(((this.clock.hour - 9) / 24) * TAU));
    return t + W.stoneHeat * heat * Math.max(0, 1 - c.depth / W.stoneHeatDepth);
  }

  antTemperature(a: Ant): number {
    if (a.domain === 'surface') return this.clock.temperatureAt(0);
    if (a.room >= 0) return this.chamberTemperature(this.nest.chambers[a.room]);
    return this.clock.temperatureAt(a.depth(this));
  }

  /** 推进真实时间 realDt 秒（已乘以倍速） */
  advance(realDt: number): void {
    this.lastSteps = 0;
    if (this.clock.paused) return;
    const step = CONFIG.time.fixedStep;
    this.acc += Math.min(realDt * this.clock.speed, step * CONFIG.time.maxStepsPerFrame);
    while (this.acc >= step) {
      this.acc -= step;
      this.tick(step);
      this.lastSteps++;
    }
  }

  private tick(dt: number): void {
    this.clock.seconds += dt;
    this.colony.update(dt);
    this.food.update(dt);
    this.aphids.update(dt, this.clock.seconds);
    this.pheromone.update(dt);
  }
}

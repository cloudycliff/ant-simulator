import { CONFIG } from '../config';
import { Rng } from '../util/random';
import { Nest } from '../nest/nest';
import { SimClock } from '../sim/clock';
import { Colony } from '../sim/colony';
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
    this.food = new FoodManager(this.terrain, this.veg, this.rng);
    this.food.init();
    this.pheromone = new PheromoneField(this.terrain);
    this.colony = new Colony(this);
    this.colony.init();
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
    this.pheromone.update(dt);
  }
}

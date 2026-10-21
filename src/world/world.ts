import { CONFIG } from '../config';
import { TAU } from '../util/math';
import { Rng } from '../util/random';
import { Nest, type Chamber } from '../nest/nest';
import type { Ant } from '../sim/ant';
import { SimClock } from '../sim/clock';
import { Colony } from '../sim/colony';
import { AlarmField } from './alarm';
import { AphidManager } from './aphids';
import { FoodManager, SOURCE_INFO, type FoodSourceType } from './food';
import { PheromoneField } from './pheromone';
import { PREDATOR_INFO, PredatorManager, Spider, type Predator, type PredatorKind } from './predators';
import { Terrain } from './terrain';
import { OBSTACLE_INFO, Vegetation, type PlaceableObstacle } from './vegetation';
import { WaterManager } from './water';
import { WeatherSystem } from './weather';

/** 干预操作的结果，msg 用于提示玩家 */
export interface ToolResult {
  ok: boolean;
  msg: string;
}

const COMPASS = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];

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
  readonly water: WaterManager;
  readonly predators: PredatorManager;
  readonly alarm: AlarmField;
  readonly weather: WeatherSystem;
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
    this.water = new WaterManager(this.terrain, this.veg, this.pheromone);
    this.predators = new PredatorManager(this.terrain, this.veg, this.rng);
    this.alarm = new AlarmField(this.terrain);
    this.weather = new WeatherSystem(this.rng);
    this.colony = new Colony(this);
    this.colony.init();
  }

  // ---------------- 玩家干预 ----------------

  /** “蚁穴东北 32 cm 处”。+x 为东，+z 为南 */
  describePlace(x: number, z: number): string {
    const d = Math.hypot(x, z);
    if (d < 6) return '蚁穴入口旁';
    const sector = Math.round(Math.atan2(z, x) / (Math.PI / 4));
    return `蚁穴${COMPASS[(sector + 8) % 8]} ${d.toFixed(0)} cm 处`;
  }

  private checkSpot(x: number, z: number, r: number, blocking: boolean): string | null {
    if (Math.hypot(x, z) > CONFIG.world.forageRadius - r - 1) return '超出了蚂蚁的活动范围';
    if (!blocking) return null;
    for (const e of this.nest.entrances) if (Math.hypot(e.x - x, e.z - z) < r + 4) return '离蚁穴入口太近，会把入口堵住';
    if (this.veg.obstacleAt(x, z, r)) return '这里已经有石块、植物或水洼了';
    for (const s of this.food.sources) if (Math.hypot(s.x - x, s.z - z) < r + s.radius) return '这里已经有食物了';
    return null;
  }

  // 以下干预方法在 dry 为 true 时只做检查、不改动世界（用于放置预览）

  dropFood(type: FoodSourceType, x: number, z: number, dry = false): ToolResult {
    const info = SOURCE_INFO[type];
    if (this.food.placedCount() >= CONFIG.intervention.maxPlacedFood) return { ok: false, msg: '投放的食物太多了，等蚂蚁搬完一些再投' };
    const err = this.checkSpot(x, z, info.radius, false);
    if (err) return { ok: false, msg: err };
    if (this.veg.obstacleAt(x, z, info.radius * 0.5)) return { ok: false, msg: '这里被石块、植物或水洼占着' };
    if (dry) return { ok: true, msg: '' };
    const src = this.food.spawn(0, type, { x, z });
    if (!src) return { ok: false, msg: '无法在这里投放' };
    src.placed = true;
    const msg = `你在${this.describePlace(x, z)}投放了${info.name}`;
    this.colony.pushEvent(msg);
    return { ok: true, msg };
  }

  placeObstacle(kind: PlaceableObstacle, x: number, z: number, yaw: number, dry = false): ToolResult {
    const info = OBSTACLE_INFO[kind];
    if (this.veg.placed.length >= CONFIG.intervention.maxPlacedObstacles) return { ok: false, msg: '放置的障碍物太多了，先移除一些' };
    const pts = kind === 'twig' ? [-0.5, -0.25, 0, 0.25, 0.5].map((t) => [x + Math.cos(yaw) * t * info.len!, z + Math.sin(yaw) * t * info.len!]) : [[x, z]];
    for (const [px, pz] of pts) {
      const err = this.checkSpot(px, pz, info.r, true);
      if (err) return { ok: false, msg: err };
    }
    if (dry) return { ok: true, msg: '' };
    this.veg.place(kind, x, z, yaw);
    const msg = `你在${this.describePlace(x, z)}放了一${kind === 'twig' ? '根' : '块'}${info.name}`;
    this.colony.pushEvent(msg);
    return { ok: true, msg };
  }

  removeObstacle(x: number, z: number, dry = false): ToolResult {
    const p = this.veg.placedNear(x, z, 2.5);
    if (!p) return { ok: false, msg: '这里没有你放置的障碍物（自然生成的石块和植物不能移除）' };
    if (dry) return { ok: true, msg: '' };
    this.veg.removePlaced(p);
    return { ok: true, msg: `移除了${OBSTACLE_INFO[p.kind].name}` };
  }

  removePlacedById(id: number): ToolResult {
    const p = this.veg.placedById(id);
    if (!p) return { ok: false, msg: '已经移除了' };
    this.veg.removePlaced(p);
    return { ok: true, msg: `移除了${OBSTACLE_INFO[p.kind].name}` };
  }

  pourWater(x: number, z: number, big: boolean, dry = false): ToolResult {
    const r = CONFIG.intervention.waterRadius[big ? 1 : 0];
    const err = this.checkSpot(x, z, r, false);
    if (err) return { ok: false, msg: err };
    if (dry) return { ok: true, msg: '' };
    this.water.pour(x, z, r);
    const msg = `你在${this.describePlace(x, z)}浇了${big ? '一大杯' : '一点'}水，冲掉了那里的信息素`;
    this.colony.pushEvent(msg);
    return { ok: true, msg };
  }

  placePredator(kind: PredatorKind, x: number, z: number, dry = false): ToolResult {
    const P = CONFIG.predators;
    const name = PREDATOR_INFO[kind].name;
    if (kind === 'spider') {
      if (this.predators.spiders.length >= P.maxSpiders) return { ok: false, msg: '狼蛛已经够多了' };
      const err = this.checkSpot(x, z, 1, false);
      if (err) return { ok: false, msg: err };
      if (this.veg.obstacleAt(x, z, 1, true)) return { ok: false, msg: '这里被石块或植物占着' };
      if (dry) return { ok: true, msg: '' };
      this.predators.addSpider(x, z, Math.atan2(-z, -x), true);
    } else {
      if (this.predators.antlions.filter((p) => p.placed).length >= P.maxPlacedAntlions) return { ok: false, msg: '放入的蚁狮太多了，先移除一些' };
      const err = this.checkSpot(x, z, P.pitRadius, true);
      if (err) return { ok: false, msg: err };
      if (this.predators.antlions.some((p) => Math.hypot(p.x - x, p.z - z) < P.pitRadius * 2.5)) return { ok: false, msg: '离另一个蚁狮陷阱太近' };
      if (this.water.at(x, z)) return { ok: false, msg: '蚁狮只在干燥的地面挖坑' };
      if (dry) return { ok: true, msg: '' };
      this.predators.addAntlion(x, z, true);
    }
    const msg = `你在${this.describePlace(x, z)}放入了一只${name}`;
    this.colony.pushEvent(msg);
    return { ok: true, msg };
  }

  removePredator(x: number, z: number, dry = false): ToolResult {
    const p = this.predators.near(x, z, CONFIG.predators.pitRadius + 1);
    if (!p) return { ok: false, msg: '这里没有天敌' };
    if (dry) return { ok: true, msg: '' };
    return this.dismissPredator(p);
  }

  removePredatorById(id: number): ToolResult {
    const p = this.predators.byId(id);
    if (!p) return { ok: false, msg: '它已经不在了' };
    return this.dismissPredator(p);
  }

  callRain(dry = false): ToolResult {
    if (this.weather.phase !== 'clear') return { ok: false, msg: '已经在下雨了' };
    if (dry) return { ok: true, msg: '' };
    this.weather.startRain(this);
    return { ok: true, msg: '你招来了一片雨云，马上就要下雨了' };
  }

  private dismissPredator(p: Predator): ToolResult {
    this.predators.remove(p);
    const msg = p instanceof Spider ? '赶走了狼蛛' : '填平了蚁狮的陷阱';
    this.colony.pushEvent(msg);
    return { ok: true, msg };
  }

  /** 房间温度：土壤温度随深度变化；石块下方的房间白天额外吸热升温 */
  chamberTemperature(c: Chamber): number {
    const t = this.clock.temperatureAt(c.depth);
    if (!c.underStone) return t;
    const W = CONFIG.world;
    const heat = Math.max(0, Math.sin(((this.clock.hour - 9) / 24) * TAU)) * (1 - this.weather.cloud);
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
    this.weather.update(dt, this);
    this.colony.update(dt);
    this.predators.update(dt, this);
    this.alarm.update(dt);
    this.food.update(dt);
    this.aphids.update(dt, this.clock.seconds);
    this.water.update(dt, this.clock);
    this.pheromone.update(dt);
  }
}

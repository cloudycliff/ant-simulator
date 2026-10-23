import { CONFIG } from '../config';
import { L, type MsgKey, type Text } from '../../../core/i18n';
import { Simulation } from '../../../core/sim/simulation';
import { TAU } from '../../../core/util/math';
import { Nest, type Chamber } from '../nest/nest';
import type { Ant } from '../sim/ant';
import { Colony } from '../sim/colony';
import { AlarmField } from './alarm';
import { AphidManager } from './aphids';
import { defineEntities, type GameRef } from './entities';
import { FoodManager, SOURCE_INFO, type FoodSourceType } from './food';
import { LadybugManager } from './ladybugs';
import { PheromoneField } from './pheromone';
import { PREDATOR_INFO, PredatorManager, Spider, type Predator, type PredatorKind } from './predators';
import { Terrain } from './terrain';
import { OBSTACLE_INFO, Vegetation, type PlaceableObstacle } from './vegetation';
import { Soil } from './soil';
import { WaterManager } from './water';
import { WeatherSystem } from './weather';
import type { ToolResult } from '../../../core/ui/tools';

/** 干预操作的结果，msg 用于提示玩家；只做检查（dry）时成功没有 msg */
export type { ToolResult };

const fail = (k: MsgKey): ToolResult => ({ ok: false, msg: L(k) });
/** 放瓢虫、赶瓢虫时，离蚜虫植物多远以内算点中 */
const LADYBUG_REACH = 6;
const COMPASS = ['dir.0', 'dir.1', 'dir.2', 'dir.3', 'dir.4', 'dir.5', 'dir.6', 'dir.7'] as const;

/** 模拟世界：持有所有模拟状态，按固定步长推进。不依赖渲染。 */
export class World extends Simulation<GameRef> {
  readonly soil: Soil;
  readonly terrain: Terrain;
  readonly nest: Nest;
  readonly veg: Vegetation;
  readonly food: FoodManager;
  readonly aphids: AphidManager;
  readonly ladybugs: LadybugManager;
  readonly pheromone: PheromoneField;
  readonly water: WaterManager;
  readonly predators: PredatorManager;
  readonly alarm: AlarmField;
  readonly weather: WeatherSystem;
  readonly colony: Colony;
  /** 开局工蚁数，入口和初始蚁穴按它生成 */
  readonly initialWorkers = CONFIG.colony.initialWorkers;

  constructor(readonly seed: number = CONFIG.seed) {
    super(CONFIG.time.dayLength, CONFIG.time.startHour, seed);
    this.soil = new Soil(this.clock);
    this.terrain = new Terrain(seed);
    for (const e of Nest.entranceLayout()) this.terrain.addMound(e.x, e.z, e.main ? 4.2 : 3.2, e.main ? 1.3 : 0.9);
    this.terrain.build();
    this.nest = new Nest(this.terrain);
    this.nest.generate(seed + 1);
    this.veg = new Vegetation(this.terrain, this.rng);
    this.veg.build();
    for (const c of this.nest.chambers) {
      c.underStone = this.veg.obstacles.some((o) => o.kind === 'stone' && o.r > 3 && Math.hypot(o.x - c.floor.x, o.z - c.floor.z) < o.r + 3);
    }
    this.food = new FoodManager(this.terrain, this.veg, this.rng, this.ids);
    this.food.init();
    this.aphids = new AphidManager(this.veg, this.rng, this.ids);
    this.ladybugs = new LadybugManager(this.aphids, this.rng);
    this.pheromone = new PheromoneField(this.terrain);
    this.water = new WaterManager(this.terrain, this.veg, this.pheromone, this.ids);
    this.predators = new PredatorManager(this.terrain, this.veg, this.rng, this.ids);
    this.alarm = new AlarmField(this.terrain);
    this.weather = new WeatherSystem(this.rng);
    this.colony = new Colony(this);
    this.colony.init();
    defineEntities(this);

    this.addSystem('weather', (dt) => this.weather.update(dt, this));
    this.addSystem('colony', (dt) => this.colony.update(dt));
    this.addSystem('predators', (dt) => this.predators.update(dt, this));
    this.addSystem('alarm', (dt) => this.alarm.update(dt));
    this.addSystem('food', (dt) => this.food.update(dt));
    this.addSystem('aphids', (dt) => this.aphids.update(dt, this));
    this.addSystem('ladybugs', (dt) => this.ladybugs.update(dt, this));
    this.addSystem('water', (dt) => this.water.update(dt, this.soil));
    this.addSystem('pheromone', (dt) => this.pheromone.update(dt));

    // 读档顺序：蚁群最后，因为蚂蚁的位置和物品所在的房间都引用蚁穴的节点和房间编号
    const S = this.saves;
    S.add('nest', () => this.nest.toSave(), (d) => this.nest.restore(d));
    S.add(
      'placed',
      () => this.veg.placed.map((p) => ({ kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, ...(p.kind === 'twig' ? {} : { shape: p.shape }) })),
      (d: { kind: PlaceableObstacle; x: number; z: number; yaw: number; shape?: number }[]) => {
        for (const p of d) this.veg.place(p.kind, p.x, p.z, p.yaw, p.shape);
      },
    );
    S.add('puddles', () => this.water.toSave(), (d) => this.water.restore(d));
    S.add('predators', () => this.predators.toSave(), (d) => this.predators.restore(d), true);
    S.add('weather', () => this.weather.toSave(this), (d) => this.weather.restore(d, this), true);
    S.add('food', () => this.food.toSave(), (d) => this.food.restore(d));
    S.add('aphids', () => this.aphids.toSave(), (d) => this.aphids.restore(d));
    S.add('ladybugs', () => this.ladybugs.toSave(), (d) => this.ladybugs.restore(d), true);
    S.add('pheromone', () => this.pheromone.toSave(), (d) => this.pheromone.restore(d));
    S.add('colony', () => this.colony.toSave(), (d) => this.colony.restore(d));
  }

  // ---------------- 玩家干预 ----------------

  /** “蚁穴东北 32 cm 处”。+x 为东，+z 为南 */
  describePlace(x: number, z: number): Text {
    const d = Math.hypot(x, z);
    if (d < 6) return L('place.nearEntrance');
    const sector = Math.round(Math.atan2(z, x) / (Math.PI / 4));
    return L('place.dir', { dir: L(COMPASS[(sector + 8) % 8]), d: d.toFixed(0) });
  }

  private checkSpot(x: number, z: number, r: number, blocking: boolean): ToolResult | null {
    if (Math.hypot(x, z) > CONFIG.world.forageRadius - r - 1) return fail('tool.outOfRange');
    if (!blocking) return null;
    for (const e of this.nest.entrances) if (Math.hypot(e.x - x, e.z - z) < r + 4) return fail('tool.nearEntrance');
    if (this.veg.obstacleAt(x, z, r)) return fail('tool.occupied');
    for (const s of this.food.sources) if (Math.hypot(s.x - x, s.z - z) < r + s.radius) return fail('tool.hasFood');
    return null;
  }

  // 以下干预方法在 dry 为 true 时只做检查、不改动世界（用于放置预览）

  dropFood(type: FoodSourceType, x: number, z: number, dry = false): ToolResult {
    const info = SOURCE_INFO[type];
    if (this.food.placedCount() >= CONFIG.intervention.maxPlacedFood) return fail('tool.tooMuchFood');
    const err = this.checkSpot(x, z, info.radius, false);
    if (err) return err;
    if (this.veg.obstacleAt(x, z, info.radius * 0.5)) return fail('tool.blockedFood');
    if (dry) return { ok: true };
    const src = this.food.spawn(0, type, { x, z });
    if (!src) return fail('tool.cantDrop');
    src.placed = true;
    const msg = L('tool.dropped', { place: this.describePlace(x, z), food: info.name });
    this.events.push(msg, { kind: 'food', id: src.id });
    return { ok: true, msg };
  }

  placeObstacle(kind: PlaceableObstacle, x: number, z: number, yaw: number, dry = false): ToolResult {
    const info = OBSTACLE_INFO[kind];
    if (this.veg.placed.length >= CONFIG.intervention.maxPlacedObstacles) return fail('tool.tooManyObstacles');
    const pts = kind === 'twig' ? [-0.5, -0.25, 0, 0.25, 0.5].map((t) => [x + Math.cos(yaw) * t * info.len!, z + Math.sin(yaw) * t * info.len!]) : [[x, z]];
    for (const [px, pz] of pts) {
      const err = this.checkSpot(px, pz, info.r, true);
      if (err) return err;
    }
    if (dry) return { ok: true };
    const p = this.veg.place(kind, x, z, yaw);
    const msg = L(kind === 'twig' ? 'tool.placedTwig' : 'tool.placedStone', { place: this.describePlace(x, z), name: info.name });
    this.events.push(msg, { kind: 'placed', id: p.id });
    return { ok: true, msg };
  }

  removeObstacle(x: number, z: number, dry = false): ToolResult {
    const p = this.veg.placedNear(x, z, 2.5);
    if (!p) return fail('tool.noPlaced');
    if (dry) return { ok: true };
    this.veg.removePlaced(p);
    return { ok: true, msg: L('tool.removed', { name: OBSTACLE_INFO[p.kind].name }) };
  }

  removePlacedById(id: number): ToolResult {
    const p = this.veg.placedById(id);
    if (!p) return fail('tool.alreadyRemoved');
    this.veg.removePlaced(p);
    return { ok: true, msg: L('tool.removed', { name: OBSTACLE_INFO[p.kind].name }) };
  }

  pourWater(x: number, z: number, big: boolean, dry = false): ToolResult {
    const r = CONFIG.intervention.waterRadius[big ? 1 : 0];
    const err = this.checkSpot(x, z, r, false);
    if (err) return err;
    if (dry) return { ok: true };
    this.water.pour(x, z, r);
    const msg = L(big ? 'tool.pouredBig' : 'tool.pouredSmall', { place: this.describePlace(x, z) });
    this.events.push(msg, undefined, { x, y: this.terrain.heightAt(x, z), z });
    return { ok: true, msg };
  }

  placePredator(kind: PredatorKind, x: number, z: number, dry = false): ToolResult {
    const P = CONFIG.predators;
    const name = PREDATOR_INFO[kind].name;
    let placed: Predator;
    if (kind === 'spider') {
      if (this.predators.spiders.length >= P.maxSpiders) return fail('tool.tooManySpiders');
      const err = this.checkSpot(x, z, 1, false);
      if (err) return err;
      if (this.veg.obstacleAt(x, z, 1, true)) return fail('tool.blockedSpider');
      if (dry) return { ok: true };
      placed = this.predators.addSpider(x, z, Math.atan2(-z, -x), true);
    } else {
      if (this.predators.antlions.filter((p) => p.placed).length >= P.maxPlacedAntlions) return fail('tool.tooManyAntlions');
      const err = this.checkSpot(x, z, P.pitRadius, true);
      if (err) return err;
      if (this.predators.antlions.some((p) => Math.hypot(p.x - x, p.z - z) < P.pitRadius * 2.5)) return fail('tool.antlionTooClose');
      if (this.water.at(x, z)) return fail('tool.antlionDry');
      if (dry) return { ok: true };
      placed = this.predators.addAntlion(x, z, true);
    }
    const msg = L('tool.placedPredator', { place: this.describePlace(x, z), name });
    this.events.push(msg, { kind: 'predator', id: placed.id });
    return { ok: true, msg };
  }

  removePredator(x: number, z: number, dry = false): ToolResult {
    const p = this.predators.near(x, z, CONFIG.predators.pitRadius + 1);
    const c = p ? null : this.aphids.nearestColony(x, z, LADYBUG_REACH);
    const bug = c && this.ladybugs.on(c);
    if (!p && !bug) return fail('tool.noPredator');
    if (dry) return { ok: true };
    if (bug) {
      this.ladybugs.shoo(bug, false);
      return { ok: true, msg: L('tool.ladybugShooed') };
    }
    return this.dismissPredator(p!);
  }

  /** 瓢虫只能放在蚜虫群上：落到 LADYBUG_REACH 以内最近的一群 */
  placeLadybug(x: number, z: number, dry = false): ToolResult {
    const c = this.aphids.nearestColony(x, z, LADYBUG_REACH);
    if (!c) return fail('tool.noAphidsNear');
    if (this.ladybugs.on(c)) return fail('tool.ladybugThere');
    if (this.ladybugs.ladybugs.length >= CONFIG.ladybug.max) return fail('tool.tooManyLadybugs');
    if (dry) return { ok: true };
    this.ladybugs.add(c, true);
    const msg = L('tool.ladybugPlaced', { place: this.describePlace(c.x, c.z) });
    this.events.push(msg, { kind: 'plant', id: c.plant.index });
    return { ok: true, msg };
  }

  removePredatorById(id: number): ToolResult {
    const p = this.predators.byId(id);
    if (!p) return fail('tool.predatorGone');
    return this.dismissPredator(p);
  }

  callRain(dry = false): ToolResult {
    if (this.weather.phase !== 'clear') return fail('tool.alreadyRaining');
    if (dry) return { ok: true };
    this.weather.startRain(this);
    return { ok: true, msg: L('tool.rainCalled') };
  }

  private dismissPredator(p: Predator): ToolResult {
    this.predators.remove(p);
    const msg = L(p instanceof Spider ? 'tool.spiderDismissed' : 'tool.pitFilled');
    this.events.push(msg, undefined, { x: p.x, y: this.terrain.heightAt(p.x, p.z), z: p.z });
    return { ok: true, msg };
  }

  /** 房间温度：土壤温度随深度变化；石块下方的房间白天额外吸热升温 */
  chamberTemperature(c: Chamber): number {
    const t = this.soil.temperatureAt(c.depth);
    if (!c.underStone) return t;
    const W = CONFIG.world;
    const heat = Math.max(0, Math.sin(((this.clock.hour - 9) / 24) * TAU)) * (1 - this.weather.cloud);
    return t + W.stoneHeat * heat * Math.max(0, 1 - c.depth / W.stoneHeatDepth);
  }

  antTemperature(a: Ant): number {
    if (a.domain === 'surface') return this.soil.temperatureAt(0);
    if (a.room >= 0) return this.chamberTemperature(this.nest.chambers[a.room]);
    return this.soil.temperatureAt(a.depth(this));
  }
}

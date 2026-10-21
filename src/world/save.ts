import { CONFIG } from '../config';
import type { NestSave } from '../nest/nest';
import type { ColonySave } from '../sim/colony';
import type { PlaceableObstacle } from './vegetation';
import type { FoodSave } from './food';
import type { PredatorSave } from './predators';
import type { World } from './world';

/** 存档结构变化时加 1；旧版本的存档不再读取 */
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  seed: number;
  /** 保存时的现实时间（毫秒） */
  savedAt: number;
  /** 保存时的游戏时刻，如“第3天 14:20” */
  stamp: string;
  clock: { seconds: number; speed: number };
  nest: NestSave;
  colony: ColonySave;
  food: FoodSave;
  aphids: ReturnType<World['aphids']['toSave']>;
  pheromone: { trail: string; home: string };
  placed: { kind: PlaceableObstacle; x: number; z: number; yaw: number }[];
  puddles: ReturnType<World['water']['toSave']>;
  /** 天敌之后才加入，旧存档没有这一项时沿用新世界自然生成的蚁狮 */
  predators?: PredatorSave;
  /** 界面层附加的相机位置与注视点 */
  camera?: number[];
}

/**
 * 地形、植被、初始蚁穴由世界种子决定，不写进存档；
 * 存档记录之后会变化的一切：蚁穴扩建、蚁群、食物源、蚜虫群、信息素和玩家的干预。
 */
export function saveWorld(w: World, savedAt: number): SaveData {
  return {
    version: SAVE_VERSION,
    seed: CONFIG.seed,
    savedAt,
    stamp: w.clock.stamp(),
    clock: { seconds: w.clock.seconds, speed: w.clock.speed },
    nest: w.nest.toSave(),
    colony: w.colony.toSave(),
    food: w.food.toSave(),
    aphids: w.aphids.toSave(),
    pheromone: w.pheromone.toSave(),
    placed: w.veg.placed.map((p) => ({ kind: p.kind, x: p.x, z: p.z, yaw: p.yaw })),
    puddles: w.water.toSave(),
    predators: w.predators.toSave(),
  };
}

/** 存档不能用于当前版本时返回原因 */
export function saveProblem(d: SaveData): string | null {
  if (d.version !== SAVE_VERSION) return '存档来自不兼容的旧版本';
  if (d.seed !== CONFIG.seed) return '存档对应的世界种子不同';
  return null;
}

/** 把存档套到一个刚生成的世界上，必须在创建任何视图之前调用 */
export function loadWorld(w: World, d: SaveData): void {
  const problem = saveProblem(d);
  if (problem) throw new Error(problem);
  w.clock.seconds = d.clock.seconds;
  w.clock.speed = d.clock.speed;
  w.nest.restore(d.nest);
  for (const p of d.placed) w.veg.place(p.kind, p.x, p.z, p.yaw);
  w.water.restore(d.puddles);
  if (d.predators) w.predators.restore(d.predators);
  w.food.restore(d.food);
  w.aphids.restore(d.aphids);
  w.pheromone.restore(d.pheromone);
  w.colony.restore(d.colony);
  w.aphids.sync();
}

import { L, t, tr, type Text } from '../../../core/i18n';
import { SaveSlot, type SaveMeta } from '../../../core/platform/saveSlot';
import type { NestSave } from '../nest/nest';
import type { ColonySave } from '../sim/colony';
import type { PlaceableObstacle } from './vegetation';
import type { FoodSave } from './food';
import type { PredatorSave } from './predators';
import type { WeatherSave } from './weather';
import type { World } from './world';

/** 存档结构变化时加 1；旧版本的存档不再读取 */
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  seed: number;
  /** 保存时的现实时间（毫秒） */
  savedAt: number;
  /** 较早的存档里有保存时的游戏时刻，如“第3天 14:20”；现在由 clock.seconds 算出 */
  stamp?: string;
  clock: { seconds: number; speed: number };
  /** 模拟随机数的状态，较早的存档没有，读进来后的运行就不能复现 */
  rng?: number;
  nest: NestSave;
  colony: ColonySave;
  food: FoodSave;
  aphids: ReturnType<World['aphids']['toSave']>;
  pheromone: { trail: string; home: string };
  /** shape 是石块的形状参数，较早的存档没有 */
  placed: { kind: PlaceableObstacle; x: number; z: number; yaw: number; shape?: number }[];
  puddles: ReturnType<World['water']['toSave']>;
  /** 天敌之后才加入，旧存档没有这一项时沿用新世界自然生成的蚁狮 */
  predators?: PredatorSave;
  /** 天气、入口封堵与房间积水，旧存档没有这一项时为晴天 */
  weather?: WeatherSave;
  /** 界面层附加的相机位置与注视点 */
  camera?: number[];
}

/**
 * 地形、植被、初始蚁穴由世界种子决定，读档时用存档里的种子重新生成；
 * 存档记录之后会变化的一切：蚁穴扩建、蚁群、食物源、蚜虫群、信息素和玩家的干预。
 * 各部分在 World 的构造函数里登记（w.saves），字段名和 SaveData 一致。
 */
export function saveWorld(w: World, savedAt: number): SaveData {
  return { version: SAVE_VERSION, seed: w.seed, savedAt, ...w.saves.save() } as unknown as SaveData;
}

export interface AntSaveMeta extends SaveMeta {
  ants: number;
}

export const saveSlot = new SaveSlot<SaveData, AntSaveMeta>('cyber-ant-save');

export function saveMeta(d: SaveData): AntSaveMeta {
  return { savedAt: d.savedAt, seconds: Math.round(d.clock.seconds), ants: d.colony.ants.length };
}

/** 存档不能用于当前版本时返回原因 */
export function saveProblem(d: SaveData): Text | null {
  if (d.version !== SAVE_VERSION) return L('save.incompatible');
  return null;
}

/** 把存档套到一个用 d.seed 刚生成的世界上，必须在创建任何视图之前调用 */
export function loadWorld(w: World, d: SaveData): void {
  if (w.seed !== d.seed) throw new Error(t('save.seedMismatch'));
  const problem = saveProblem(d);
  if (problem) throw new Error(tr(problem));
  w.saves.restore(d as unknown as Record<string, unknown>);
  w.aphids.sync();
}

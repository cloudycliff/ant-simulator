/** 世界单位：1 单位 ≈ 1 厘米。蚂蚁体长按观察需要放大到约 1 单位（真实黑毛蚁工蚁 3–5 毫米）。 */
export const CONFIG = {
  seed: 20261021,

  world: {
    size: 240,
    forageRadius: 112,
    terrainSegments: 220,
    /** 大石块正午对下方土壤的最大加温（°C），随深度线性衰减到 stoneHeatDepth 处为 0 */
    stoneHeat: 6,
    stoneHeatDepth: 26,
  },

  time: {
    /** 一个游戏日对应的模拟秒数（1 倍速下即真实秒数）。 */
    dayLength: 600,
    startHour: 7.5,
    fixedStep: 1 / 30,
    maxStepsPerFrame: 24,
  },

  colony: {
    initialWorkers: 1000,
    maxPopulation: 3000,
    roleRatio: { nurse: 0.26, maintenance: 0.24, forager: 0.5 },
    scoutRatio: 0.12,
    initialFood: 120,
    initialBrood: { egg: 50, larva: 70, pupa: 45 },
    eggsPerDay: 36,
    workerLifespanDays: [45, 90] as [number, number],
    /** 开局时嗉囊里带有甜液的工蚁比例 */
    initialCropShare: 0.4,
  },

  /** 按日龄分工（年龄多型性）与按需调整 */
  polyethism: {
    /** 每隔多少游戏日重新评估一次各职别需求 */
    reviewDays: 0.02,
    /** 每次评估最多转换的工蚁比例 */
    maxShift: 0.02,
    /** 个体“行为年龄”相对真实日龄的随机偏移（标准差，天） */
    ageJitterDays: 4,
    nurseBase: 50,
    nursePerBrood: 1.1,
  },

  social: {
    /** 每次交哺传递的液体量（嗉囊容量为 1） */
    shareAmount: 0.3,
    contactRadius: 0.9,
    contactCooldown: [6, 16] as [number, number],
  },

  aphid: {
    colonies: 6,
    initialCount: [16, 36] as [number, number],
    maxCount: 80,
    honeydewPerAphidDay: 0.2,
    maxHoneydew: 6,
  },

  expansion: {
    /** 每单位房间地板面积（rx·rz）可容纳的成虫与幼体数 */
    capacityPerArea: 1.8,
    /** 占用率超过该值时规划新房间 */
    trigger: 0.88,
    tunnelSoilPerUnit: 4,
    chamberSoilPerArea: 4,
    maxDiggers: 18,
    maxChambers: 22,
  },

  brood: {
    eggDays: 2,
    larvaDays: 3.2,
    pupaDays: 2.4,
    larvaFeedsNeeded: 3,
  },

  ant: {
    workerLength: 1.0,
    queenScale: 2.1,
    speedSurface: 3.2,
    speedNest: 2.4,
    hungerPerDay: 0.4,
    eatAmount: 0.25,
    senseFoodRadius: 7,
  },

  pheromone: {
    cellSize: 1,
    trailHalfLife: 90,
    depositFood: 1.0,
    /** 工蚁足迹碳氢化合物（领地标记）的半衰期与每秒沉积量 */
    homeHalfLife: 900,
    depositHome: 0.03,
  },

  food: {
    initialSources: 12,
    spawnIntervalSec: 35,
    maxSources: 20,
  },

  nest: {
    tunnelRadius: 1.0,
    shaftRadius: 1.25,
  },
};

export type Role = 'queen' | 'nurse' | 'maintenance' | 'forager';

export const ROLE_NAMES: Record<Role, string> = {
  queen: '蚁后',
  nurse: '保育蚁',
  maintenance: '内务蚁',
  forager: '觅食蚁',
};

export const ROLE_COLORS: Record<Role, number> = {
  queen: 0xffb13b,
  nurse: 0xf06fb0,
  maintenance: 0x5fb8ff,
  forager: 0x7ee06a,
};

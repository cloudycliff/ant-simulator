/** 世界单位：1 单位 ≈ 1 厘米。蚂蚁体长按观察需要放大到约 1 单位（真实黑毛蚁工蚁 3–5 毫米）。 */
export const CONFIG = {
  seed: 20261021,

  world: {
    size: 240,
    forageRadius: 112,
    terrainSegments: 220,
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

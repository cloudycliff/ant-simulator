import './i18n';

export type Species = 'neon' | 'angel' | 'cory';

/** 长度单位是厘米，时间单位是模拟秒 */
export const CONFIG = {
  /**
   * 一天 20 分钟，早上 9 点开局。季节（T-076，检验框架的日历）：一季 2 天，开局在春天第一天；
   * 缸里没有加热棒，水温跟着屋里的季节走，roomTemp 是春夏秋冬各差几度
   */
  clock: { dayLength: 1200, startHour: 9, calendar: { lengths: [2, 2, 2, 2] as [number, number, number, number], start: 0 } },
  roomTemp: [0, 1.5, -0.5, -2.5],
  /** 鱼缸内部：x 在 ±w/2、z 在 ±d/2，y 从缸底 0 到缸口 h；水面高 water，沙层平均厚 sand */
  tank: { w: 120, d: 50, h: 60, water: 54, sand: 5 },
  /** 鱼缸灯几点开、几点关，开关时渐变几小时 */
  light: { on: 8, off: 21, ramp: 0.5 },
  /** 灯、房间、夜里的蓝光强度（three.js 单位） */
  render: { lamp: 3.2, room: 0.9, night: 0.35 },
  food: { max: 300, floatSec: 6, sink: 2.4, rotSec: 300, portion: 0.18, eatRadius: 1.4, sense: 45 },
  fish: {
    hungerPerDay: 0.9,
    /** 饥饿超过它才去追鱼食 */
    hungry: 0.15,
    /** 离缸壁、水面、沙面多近开始转开 */
    wall: 6,
    /** 受惊游开的秒数、多远的鱼会受惊 */
    fleeSec: 1.6,
    fleeRadius: 25,
  },
  /** 平均饥饿超过它记一条“鱼饿了”的事件，降到 reset 以下才会再记 */
  hungryEvent: 0.75,
  hungryReset: 0.5,
};

export interface SpeciesInfo {
  count: number;
  len: number;
  speed: number;
  /** 群游：看得见同伴的距离、保持的间距、对齐和聚拢的权重 */
  view: number;
  sep: number;
  align: number;
  cohere: number;
  /** 喜欢的水层：离沙面的高度范围 */
  band: [number, number];
  /** 关灯后的活动量（鼠鱼夜里更活跃） */
  night: number;
  /** 只吃沉底的鱼食 */
  bottom: boolean;
}

export const SPECIES: Record<Species, SpeciesInfo> = {
  neon: { count: 24, len: 3.4, speed: 9, view: 12, sep: 3, align: 1.2, cohere: 0.9, band: [14, 40], night: 0.3, bottom: false },
  angel: { count: 3, len: 9, speed: 5, view: 30, sep: 14, align: 0.3, cohere: 0.15, band: [16, 36], night: 0.25, bottom: false },
  cory: { count: 6, len: 5, speed: 6, view: 14, sep: 4, align: 0.4, cohere: 0.5, band: [0.5, 3], night: 1.2, bottom: true },
};

export const SPECIES_LIST = Object.keys(SPECIES) as Species[];

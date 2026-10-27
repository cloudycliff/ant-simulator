import { CELL } from './sim/comb';

/** 巢房的配色：远处的着色器平板和近处的实例网格共用（T-005），两种画法的颜色要一样 */
export const PALETTE = {
  /** 房壁、造到一半的新蜡、房底（没东西时看到的深处） */
  wax: 0xe8c878,
  newWax: 0xf6e8b8,
  bottom: 0xa27a40,
  egg: 0xfbf8ee,
  larva: 0xf4efdf,
  capped: 0xbc8a48,
  droneCap: 0xcc9e5c,
  nectar: 0xf2e08e,
  honey: 0xc98a1e,
  cappedHoney: 0xf2e5bf,
  /** 病虫（T-024）：中囊病死的囊和翘起来的头、白头蛹和它的眼睛、巢虫的丝、巢虫和它的头 */
  sac: 0xd9cf9c,
  sacHead: 0x5e3f22,
  pupa: 0xf6f0e2,
  pupaEye: 0x5a2f4a,
  silk: 0xc4beb2,
  worm: 0xe9e3d3,
  wormHead: 0x7a4a24,
  /** 几种花粉（Comb.pollen 的编号） */
  pollen: [0xf0be2c, 0xe5822a, 0xb4582e, 0xa8a656, 0xece2c4],
};

/** 分工着色的视图：和蜡黄、褐色的巢脾分得开的颜色；蜂王白色（像养蜂人在蜂王背上点的漆） */
export const ROLE_COLORS = {
  cleaner: 0x58d2e8,
  nurse: 0xf272bc,
  house: 0x6cd04a,
  guard: 0xec4a3a,
  forager: 0x4c74f2,
  drone: 0x6e6e6e,
  queen: 0xffffff,
};

/** 巢房内容着色的视图：子脾由浅到深的红、蜜由浅到深的蓝、花粉橙、空房暗；死囊黄绿、白头蛹紫、巢虫的丝灰蓝。顺序就是着色器里的编号 */
export const MAP_COLORS = {
  building: 0x9c9c9c,
  empty: 0x34302c,
  dirty: 0x6e5438,
  egg: 0xffe2ee,
  larva: 0xf28aaa,
  capped: 0xc8304e,
  droneCap: 0x7c2a5c,
  nectar: 0x9ed8ff,
  honey: 0x3f8ae8,
  cappedHoney: 0x1c4aa2,
  pollen: 0xf49a1a,
  sac: 0xd8e040,
  bald: 0x9a5cf0,
  silk: 0x5c6c78,
};
export type MapKey = keyof typeof MAP_COLORS;
export const MAP_KEYS = Object.keys(MAP_COLORS) as MapKey[];

/** 幼虫蜷成 C 形，缺口朝哪边：按行列错开，平板和实例网格算法一样（弧度，巢面坐标里） */
export const larvaTurn = (row: number, col: number) => (((row * 7 + col * 3) % 6) * Math.PI) / 3 + 0.4;
/** C 形的缺口占的角度的一半 */
export const LARVA_GAP = 0.6;

/** 有光泽的内容（花蜜、蜂蜜） */
export const glossy = (c: number) => c === CELL.nectar || c === CELL.honey;

/** 花丛：叶、花、远看时花丛底下那一片地的颜色，按花的 key */
export const FLOWER_COLORS: Record<string, { leaf: number; bloom: number; tint: number }> = {
  clover: { leaf: 0x4f8a34, bloom: 0xf4f0e2, tint: 0xd6dcc0 },
  sunflower: { leaf: 0x4d7c2a, bloom: 0xf5c21a, tint: 0xd8b830 },
  pumpkin: { leaf: 0x3d6e26, bloom: 0xf6a01e, tint: 0x6f9a34 },
  lavender: { leaf: 0x7f9c7a, bloom: 0x8b6cd0, tint: 0x9a86c8 },
  corn: { leaf: 0x5f9032, bloom: 0xd8c47c, tint: 0x86a848 },
  sugar: { leaf: 0x8a6238, bloom: 0xe8b85a, tint: 0x9a8a60 },
};

/** 温度视图的色阶（°C, 颜色）：冷的蓝、子正好的绿、热的橙红；中间按温度插值 */
export const HEAT_COLORS: [number, number][] = [
  [24, 0x2a3cb4],
  [30, 0x3cb4e6],
  [34, 0x58d058],
  [36, 0x58d058],
  [37.5, 0xf0b428],
  [40, 0xe63228],
];

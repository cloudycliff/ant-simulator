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
  /** 几种花粉（Comb.pollen 的编号） */
  pollen: [0xf0be2c, 0xe5822a, 0xb4582e, 0xa8a656, 0xece2c4],
};

/** 幼虫蜷成 C 形，缺口朝哪边：按行列错开，平板和实例网格算法一样（弧度，巢面坐标里） */
export const larvaTurn = (row: number, col: number) => (((row * 7 + col * 3) % 6) * Math.PI) / 3 + 0.4;
/** C 形的缺口占的角度的一半 */
export const LARVA_GAP = 0.6;

/** 有光泽的内容（花蜜、蜂蜜） */
export const glossy = (c: number) => c === CELL.nectar || c === CELL.honey;

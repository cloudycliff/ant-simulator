import './i18n';

/** 长度单位是厘米，时间单位是模拟秒；真实数值和来源见 docs/bee/BALANCE.md */
export const CONFIG = {
  /** 一天 10 分钟（DECISIONS T-002），早上 9 点开局 */
  clock: { dayLength: 600, startHour: 9 },
  /**
   * 观察箱：两框巢脾竖着摞，中间隔一根木条。巢脾坐标 u 横向 0..combW、v 竖向 0..2·frameH+bar，
   * 巢脾中心面在 z = 0，两面各在 ±combHalf；baseY 是下框底边离地的高度
   */
  hive: { combW: 40, frameH: 22, bar: 1.5, combHalf: 1.1, baseY: 80 },
  /**
   * 巢房：尖角朝上的六边形，中心距 pitch，房壁厚 wall，房深 depth（房底到房口；中肋在两面房底之间）。
   * 中蜂工蜂房内径约 0.48 cm（BALANCE）；房壁比真的厚，远处才看得见
   */
  cell: { pitch: 0.5, wall: 0.06, depth: 1.0 },
  /**
   * 开局的巢脾（P-007）：每框从顶梁往下长成半个椭圆，下框、上框各自的半轴（cm），边缘起伏 edge，
   * 最外一圈 rim 以内的巢房还没造完。育儿区是跨过中间木条的椭圆，外面一圈花粉，上框顶上是蜜
   */
  opening: {
    built: [
      { ax: 16, ay: 15 },
      { ax: 23, ay: 24 },
    ],
    edge: 1.5,
    rim: 0.7,
    brood: { u: 20, v: 22.75, ru: 10, rv: 8, fill: 0.9 },
    pollen: 2.2,
    honey: 10,
    capped: 4.5,
    drones: 2.5,
  },
  /** 发育各阶段的秒数（T-002：1 游戏日 600 秒，真实天数压到约 1/3，见 BALANCE） */
  brood: {
    worker: { egg: 600, larva: 1200, capped: 2220 },
    drone: { egg: 600, larva: 1380, capped: 2580 },
  },
  /** 花园：边长 size 的正方形，蜂箱在中心；地面起伏的幅度，离蜂箱 flatR 以内是平的；外面的平地铺到 horizon */
  garden: { size: 6000, bump: 6, flatR: 60, horizon: 16000 },
  render: {
    /** 户外光照（three.js 单位）。白天和蚂蚁的差不多；夜里一大片朝上的草地被月光照得发白，比蚂蚁调暗 */
    light: { sun: 3.2, hemiDay: 1.15, hemiNight: 0.5, moon: 1, surfaceLamp: 3, xrayLamp: 12 },
    /** 顶棚下的巢脾只有天光，两面各补一盏不投影的灯（白天的强度，随天光变） */
    fill: 1.1,
    /** 天空、雾（cm）；阴影在蜂箱附近和远处各覆盖多大 */
    sky: 4000,
    fog: [2000, 6000] as [number, number],
    shadowNear: 60,
    shadowFar: 400,
    /** 相机离蜂箱多近时阴影围着蜂箱 */
    hiveFocus: 300,
    /**
     * 巢脾（T-005）：巢房在屏幕上宽过 nearPx 像素时改用实例网格画出真的深度；相机每动 rebuild cm
     * 重新挑一次这些巢房
     */
    comb: { nearPx: 10, rebuild: 0.5 },
  },
};

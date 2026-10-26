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
  },
};

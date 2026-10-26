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
  /**
   * 蜂（BALANCE“游戏里的取值”）。开局 workers 只工蜂、drones 只雄蜂和一只蜂王，日龄在寿命里均匀分布。
   * life、droneLife 是寿命（秒）的范围；roles 是日龄（秒）到了换下一种工作：清理 → 哺育 → 内勤（筑巢、酿蜜）→ 守卫 → 采集
   */
  bees: {
    workers: 2400,
    drones: 60,
    life: [6000, 8400] as [number, number],
    droneLife: [4800, 7200] as [number, number],
    roles: { nurse: 600, house: 2400, guard: 3600, forager: 4200 },
    /** 工蜂身长（cm）；身体中心离巢面多高（腿撑着） */
    length: 1.1,
    lift: 0.2,
    /** 爬行速度（cm/s）、转向（rad/s）；绕过巢脾边到另一面用的秒数；闲逛走到巢脾边时绕过去的机会 */
    walk: 1.5,
    droneWalk: 1,
    queenWalk: 0.8,
    turn: 5,
    wrapTime: 0.8,
    wrapChance: 0.3,
    /** 蜜囊吃满能撑 burn 秒（雄蜂 droneBurn），低于 hungry 去吃；吃满一次用掉 meal 房蜜；饿空 starve 秒饿死 */
    burn: 200,
    droneBurn: 120,
    hungry: 0.3,
    meal: 0.006,
    starve: 300,
    /** 做完一件事后歇一会的机会和秒数 */
    rest: 0.3,
    restTime: [3, 8] as [number, number],
  },
  /**
   * 巢里的活（秒）。幼虫喂饱后 feedEvery 秒饿空，再过 starve 秒饿死；饿到 hungry 以下哺育蜂来喂。
   * 哺育蜂吃一次花粉（pollenMeal 房）能喂 feeds 次。筑巢一次加高 build（造好是 1），新开始的位置从 start 起；
   * 酿蜜一次 ripen 成；蜂蜜装到 capAt 就封盖。蜂王看一眼 inspect、产一粒 lay，产完歇一会的机会 queenRest；
   * 雄蜂子超过 droneBrood 个时不在雄蜂房产卵
   */
  care: {
    feedEvery: 120,
    starve: 240,
    hungry: 0.5,
    pollenMeal: 0.05,
    feeds: 6,
    build: 0.01,
    start: 0.05,
    buildCost: 0.15,
    ripen: 0.05,
    capAt: 0.9,
    work: { feed: 2.5, pollen: 2, eat: 2, clean: 3, build: 4, ripen: 3, cap: 3 },
    inspect: 0.6,
    lay: 0.6,
    queenRest: 0.1,
    droneBrood: 80,
    /** 内勤蜂去筑巢的机会（不然去酿蜜、封盖）；守卫日龄的蜂去巢门站岗的机会 */
    builders: 0.35,
    guards: 0.35,
    /** 路程场多久重算一次（秒）：要喂的幼虫、要清理的、能产卵的、食物、花粉、要酿的蜜、在造的巢房 */
    refresh: { larvae: 2, dirty: 5, layable: 3, food: 5, pollen: 5, ripen: 5, frontier: 10 },
  },
  /**
   * 花丛（BALANCE“花”一节）。开局 patches 片，离蜂箱 near～far cm，彼此至少隔 gap。
   * 每种花：hours 是开放（流蜜、散粉）的时刻，前后各用 ramp 小时慢慢开合；nectar、pollen 是每株满的时候
   * 有几份（一份 = 一只采集蜂一趟带回的量），采空后开着的时候 refill 秒长满；pollenKind 是花粉团的颜色
   * （PALETTE.pollen 的编号）。r 是花丛的半径，spacing 是株距；closes 的花合上时画面上也合起来
   */
  flowers: {
    patches: 9,
    near: 500,
    far: 2200,
    gap: 150,
    margin: 300,
    species: [
      { key: 'clover', hours: [7, 18], ramp: 1, nectar: 0.08, pollen: 0.02, refill: 150, pollenKind: 2, r: [150, 240], spacing: 11, closes: false },
      { key: 'sunflower', hours: [7, 18.5], ramp: 1, nectar: 0.8, pollen: 1.5, refill: 200, pollenKind: 0, r: [90, 140], spacing: 42, closes: false },
      { key: 'pumpkin', hours: [5, 10.5], ramp: 0.8, nectar: 2.5, pollen: 2, refill: 120, pollenKind: 1, r: [120, 190], spacing: 60, closes: true },
      { key: 'lavender', hours: [8.5, 18], ramp: 1.2, nectar: 1.2, pollen: 0.15, refill: 160, pollenKind: 4, r: [90, 150], spacing: 48, closes: false },
      { key: 'corn', hours: [7.5, 11.5], ramp: 1, nectar: 0, pollen: 1.2, refill: 180, pollenKind: 3, r: [90, 140], spacing: 35, closes: false },
    ] as const,
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
    /** 蜂身（T-006）：屏幕上长过 nearPx 像素画完整的模型，短于 farPx 画八面体，中间画三个球；淡化时的不透明度（P-009） */
    bees: { nearPx: 30, farPx: 8, fade: 0.18 },
  },
};

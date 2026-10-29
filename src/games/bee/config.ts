import './i18n';

/** 长度单位是厘米，时间单位是模拟秒；真实数值和来源见 docs/bee/BALANCE.md */
export const CONFIG = {
  /**
   * 一天 10 分钟（DECISIONS T-002），早上 9 点开局。一季 5 天、一年 20 天（P-015），开局在夏天第一天
   * （日历的 start 是第一天 0 点在一年里的第几天，春天第一天是 0）
   */
  clock: { dayLength: 600, startHour: 9, calendar: { lengths: [5, 5, 5, 5] as [number, number, number, number], start: 5 } },
  /**
   * 季节（P-015、T-076）：每项是春、夏、秋、冬四个值，一季的最后一天慢慢变到下一季（SimClock.seasonalValue）。
   * air：一天最凉、最热的气温（°C）；rain：平均每天几场阵雨；laying：蜂王产卵的多少（每回有 1 - laying 的机会不产）；
   * hornets：那天是“胡蜂天”的机会；moth：蜡螟飞来的机会乘几；sacbrood：那天发一次中囊病的机会。
   * broodZone：蜂王产卵的范围乘几（凉的季节育儿区缩小，保得住温）；aging：工蜂、雄蜂老得多快（冬天的蜂是越冬蜂，
   * 老得慢，不然冬天停产、春天新蜂出房前老蜂就死光了）。气温低于 flyMin 不出巢，在外面的蜂往回飞
   */
  seasons: {
    airLo: [14, 23, 16, 3],
    airHi: [24, 33, 27, 12],
    rain: [0.7, 0.5, 0.35, 0.2],
    laying: [1, 1, 0.5, 0],
    broodZone: [0.85, 1, 0.75, 0.6],
    aging: [0.6, 1, 1, 0.25],
    hornets: [0.15, 0.75, 0.9, 0],
    moth: [0.6, 1, 1, 0],
    sacbrood: [0.45, 0.3, 0.15, 0],
    flyMin: 7,
  },
  /**
   * 观察箱：两框巢脾竖着摞，中间隔一根木条。巢脾坐标 u 横向 0..combW、v 竖向 0..2·frameH+bar，
   * 巢脾中心面在 z = 0，两面各在 ±combHalf；baseY 是下框底边离地的高度。
   * 巢门管从巢脾左边往外 from～to cm，中心在 v 的高度、半径 r
   */
  hive: { combW: 40, frameH: 22, bar: 1.5, combHalf: 1.1, baseY: 80, tube: { v: 3, r: 1.1, from: 2.5, to: 10 } },
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
    drone: { egg: 600, larva: 1200, capped: 2800 },
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
    /** 路程场多久重算一次（秒）：要喂的幼虫、要清理的、能产卵的、食物、花粉、要酿的蜜、在造的巢房、放花蜜和花粉的房 */
    refresh: { larvae: 2, dirty: 5, layable: 3, droneLay: 5, cluster: 10, food: 5, pollen: 5, ripen: 5, frontier: 10, store: 5, pollenStore: 5 },
    /** 育儿区（开局育儿区的椭圆）往外到 ring 倍是放花粉的一圈，再往外放花蜜；蜂王在 queen 倍以内产卵 */
    ring: 1.5,
    queen: 1.4,
    /** 蜂王只在不低于这个温度（°C，巢脾上那一格）的空房产卵 */
    layWarm: 34,
  },
  /**
   * 摇摆舞和交接（T-014）。
   * 舞：花丛离蜂箱不到 round cm 跳圆舞（不指方向），远了跳摇摆舞：摆动段 w0 + 距离（m）× perM 秒，摆动时走 waggle cm/s，
   * 回转半圈走 turn cm/s。带回 1 份、马上交出去的一趟跳 circuits 圈，带得少、等得久、不缺粉（采粉的）就少跳，不到 1 圈不跳。
   * 舞场是每一面离巢门最近的那片造好的巢脾、往里 floor 步（0.5 cm 一步）。没活的采集蜂每回有 floorVisit 的机会去舞场
   * 等 watch 秒（不然歇着），看得见 see cm 内的舞，跟上 follow 圈就飞出去。
   * 读舞有误差：方向差 angleNoise（rad，标准差）、距离差 distNoise 成；飞到地方在 search cm 内找花丛，同种的花（认得气味）
   * 当作近 scent cm。读出来 aimLife 秒还没飞出去就忘了。
   * 交接：回巢的采集蜂在离巢门 give 步内找接蜜的内勤蜂，碰上了交 handoff 秒；等过 giveUp 秒自己放。
   * 等不到 quick 秒照常跳，过了 slow 秒不跳摇摆舞，改跳颤抖舞 tremble 秒，每支让内勤蜂去接蜜的机会多 trembleGain，
   * 按 trembleDecay 秒衰减；等过 slow 的蜂有 quit 的机会不再去那片花。
   * 内勤蜂白天有 receive 的机会去巢门附近（离巢门 receiveAt 步）等着接蜜，一次等 receiveWait 秒。
   * 储粉到 pollenTarget 满房就不缺粉，一半以下最缺；缺粉程度低于 sated 时采粉的蜂回来有 switch 的机会改采蜜。
   * 缺蜜程度：储蜜在 honeyTarget 满房时 0.5，少 honeySpan / 2 是 1、多 honeySpan / 2 是 0。采蜜的舞跳的圈数乘 2 × 缺蜜程度，
   * 内勤蜂去接蜜的机会在缺蜜程度不到 0.5 时按比例少（巢里放蜜的地方紧了，接了也没处放），蜜越多交接等得越久、越不跳舞
   */
  dance: {
    round: 600,
    w0: 0.3,
    perM: 0.09,
    waggle: 0.8,
    turn: 1.6,
    circuits: 10,
    floor: 8,
    floorVisit: 0.5,
    watch: [15, 30] as [number, number],
    see: 3,
    follow: 3,
    angleNoise: 0.15,
    distNoise: 0.1,
    search: 300,
    aimLife: 60,
    scent: 200,
    give: [2, 8] as [number, number],
    handoff: 4,
    giveUp: 60,
    quick: 15,
    slow: 40,
    tremble: [10, 20] as [number, number],
    trembleGain: 0.05,
    trembleDecay: 120,
    quit: 0.5,
    receive: 0.3,
    receiveAt: [4, 16] as [number, number],
    receiveWait: [15, 30] as [number, number],
    pollenTarget: 800,
    honeyTarget: 3000,
    honeySpan: 800,
    sated: 0.2,
    switch: 0.5,
  },
  /**
   * 按需要调整分工（T-015）。每 every 秒看一次：每只哺育蜂照顾 perNurse 只幼虫正好；多了（倍数 load > 1）清理蜂的
   * 分工日龄长得快 nurseGain × (load - 1)、哺育蜂慢同样多，少了哺育蜂快；load 过了 revertAt，每回每只内勤蜂、守卫有
   * revert × (load - revertAt) 的机会退回哺育（分工日龄退到哺育的最后 backTo 秒里）。采集蜂占工蜂的比例比 foragers 少时
   * 内勤蜂、守卫长得快 foragerGain × 少的比例，多了慢。快慢都限在 pace 以内
   */
  shift: {
    every: 10,
    perNurse: 1.5,
    nurseGain: 1,
    revertAt: 1.5,
    revert: 0.02,
    backTo: 300,
    foragers: 0.35,
    foragerGain: 1,
    pace: [0.2, 3] as [number, number],
  },
  /**
   * 出巢采集（T-013）。飞行用转向：最快 speed、在花间 hop（cm/s），加速度不过 accel，离目标 d 时想要的速度是
   * d × brake（不低于 slow）；离目标水平 descend 以外按 cruise 的高度（离地）飞，左右摆 wobble 成、wobbleHz 次每秒。
   * 飞着的蜂蜜囊 flyBurn 秒用空；出巢前蜜囊低于 depart 先去吃。
   * 不认得花丛的采集蜂每回想出巢时 scout × max(2 × 缺蜜程度, 缺粉程度) 的机会去侦察（不然去舞场看舞，T-014、T-015）；花开到 minOpen 才去；
   * 侦察蜂采花粉的机会是缺粉程度 × pollenShare。开局 known 的采集蜂已经认得一片花丛。
   * 一趟最多落 visits 朵花，每朵停 visit 秒，带满 1 份回巢；不到 keep 份就不再去这片花丛。
   * 一份花蜜放进巢房是 nectarLoad 房、花粉 pollenLoad 房；放的时候停 unload 秒。巢门管里跑得快，tubeWalk cm/s。
   * 每趟有 risk 的机会死在外面
   */
  forage: {
    speed: 300,
    hop: 60,
    slow: 15,
    accel: 900,
    brake: 2,
    descend: 250,
    cruise: [180, 260] as [number, number],
    wobble: 0.15,
    wobbleHz: 0.7,
    flyBurn: 100,
    depart: 0.5,
    scout: 0.05,
    minOpen: 0.3,
    pollenShare: 0.6,
    known: 0.5,
    visits: 16,
    visit: [2, 4] as [number, number],
    keep: 0.3,
    nectarLoad: 0.1,
    pollenLoad: 0.12,
    unload: 3,
    tubeWalk: 4,
    risk: 0.01,
  },
  /**
   * 花丛（BALANCE“花”一节）。开局 patches 片，离蜂箱 near～far cm，彼此至少隔 gap。
   * 每种花：hours 是开放（流蜜、散粉）的时刻，前后各用 ramp 小时慢慢开合；nectar、pollen 是每株满的时候
   * 有几份（一份 = 一只采集蜂一趟带回的量），采空后开着的时候 refill 秒长满；pollenKind 是花粉团的颜色
   * （PALETTE.pollen 的编号）。r 是花丛的半径，spacing 是株距；closes 的花合上时画面上也合起来。
   * land 是蜂落在一株上的几个落脚点（株的坐标，cm，没乘个头）：花序顶上、花盘面上、南瓜花的喇叭里、
   * 薰衣草穗的侧面、玉米雄穗的枝上；画面的南瓜花和前几根薰衣草穗按它摆。
   * wild 的花开局会长（每种至少一片，其余随机）；extra 里的花开局各长一片，放在最后（蜂生出来以后才摆，前面的世界和没有它们时一样）；
   * plantR 是玩家种一片的半径。refill 为 0 的（糖水）采空了不长回来；花丛比株距的一半还小时只有中间一株。
   * bloom 是春夏秋冬开花的多少（乘在开合上，0 就是不在花期），leafy 是茎叶长得多大（0 就是这一季地里没有它）
   */
  flowers: {
    patches: 9,
    near: 500,
    far: 2200,
    gap: 150,
    margin: 300,
    extra: ['rapeseed', 'buckwheat'] as const,
    species: [
      { key: 'clover', bloom: [0.8, 1, 0.4, 0], leafy: [1, 1, 1, 0.7], wild: true, plantR: 120, hours: [7, 18], ramp: 1, nectar: 0.08, pollen: 0.02, refill: 150, pollenKind: 2, r: [150, 240], spacing: 11, closes: false, land: [[0.5, 13.7, 0]] },
      {
        key: 'sunflower',
        wild: true,
        bloom: [0, 1, 0.5, 0],
        leafy: [0.35, 1, 0.9, 0],
        plantR: 90,
        hours: [7, 18.5],
        ramp: 1,
        nectar: 0.8,
        pollen: 1.5,
        refill: 200,
        pollenKind: 0,
        r: [90, 140],
        spacing: 42,
        closes: false,
        land: [[4.3, 171.4, 0], [5.5, 174.1, 0], [4.3, 171.4, 3], [3, 168.7, 0], [4.3, 171.4, -3]],
      },
      { key: 'pumpkin', bloom: [0, 1, 0.8, 0], leafy: [0.3, 1, 0.9, 0], wild: true, plantR: 110, hours: [5, 12], ramp: 0.8, nectar: 2.5, pollen: 2, refill: 120, pollenKind: 1, r: [120, 190], spacing: 60, closes: true, land: [[17.55, 27, 9.59], [-17.07, 24, 10.42], [-0.47, 30, -19.99]] },
      { key: 'lavender', bloom: [0.3, 1, 0.2, 0], leafy: [1, 1, 1, 1], wild: true, plantR: 90, hours: [8.5, 18], ramp: 1.2, nectar: 1.2, pollen: 0.15, refill: 160, pollenKind: 4, r: [90, 150], spacing: 48, closes: false, land: [[15.4, 51, 0], [0, 48, 13.4], [-13.3, 55, -5.5], [6.5, 45, -16.3]] },
      { key: 'corn', bloom: [0, 1, 0.3, 0], leafy: [0.3, 1, 0.9, 0], wild: true, plantR: 90, hours: [7.5, 11.5], ramp: 1, nectar: 0, pollen: 1.2, refill: 180, pollenKind: 3, r: [90, 140], spacing: 35, closes: false, land: [[7, 221.6, 0], [0, 221.6, 7], [-7, 221.6, 0], [0, 221.6, -7]] },
      // 油菜：春天的主要蜜源，秋天种下、冬天是贴地的一丛叶，春天抽薹开黄花；荞麦：夏天种、秋天开白花，秋天的蜜源（BALANCE）
      { key: 'rapeseed', wild: false, plantR: 110, bloom: [1, 0, 0, 0], leafy: [1, 0.4, 0.3, 0.5], hours: [7, 18], ramp: 1, nectar: 1, pollen: 0.8, refill: 160, pollenKind: 0, r: [120, 180], spacing: 30, closes: false, land: [[0, 101, 0], [6, 94, 2], [-5, 96, -4], [2, 90, 6]] },
      { key: 'buckwheat', wild: false, plantR: 100, bloom: [0, 0, 1, 0], leafy: [0, 0.6, 1, 0], hours: [7, 16], ramp: 1, nectar: 0.9, pollen: 0.5, refill: 170, pollenKind: 2, r: [110, 170], spacing: 26, closes: false, land: [[0, 72, 0], [5, 68, 3], [-4, 69, -3]] },
      // 糖水碟：一个木墩上放一碟糖水，只有一“株”；白天蜂才来，喝完了不会自己长回来
      { key: 'sugar', bloom: [1, 1, 1, 1], leafy: [1, 1, 1, 1], wild: false, plantR: 10, hours: [6.5, 18.5], ramp: 0.5, nectar: 150, pollen: 0, refill: 0, pollenKind: 0, r: [10, 10], spacing: 60, closes: false, land: [[8, 47.2, 0], [0, 47.2, 8], [-8, 47.2, 0], [0, 47.2, -8], [5.7, 47.2, 5.7], [-5.7, 47.2, -5.7]] },
    ] as const,
  },
  /**
   * 玩家的工具（T-016）。种下的花丛 grow 秒长成，长成前不开花；最多种 maxPlanted 片。种花、放糖水的地方离蜂箱至少
   * hiveClear cm、离别的花丛 gap cm、离花园边 flowers.margin。糖水碟最多 maxFeeders 个，在碟子 refillR cm 内再放一次是添满
   */
  tools: { grow: 300, maxPlanted: 12, maxFeeders: 3, hiveClear: 250, gap: 40, refillR: 40 },
  /**
   * 天气（T-020）。平均每天 seasons.rain 场阵雨，第 firstRainDay 天以前不下；showers 点之间下雨的机会是平时的 showerPeak 倍，
   * 其余时候 showerOff 倍（一天平均是 1）。转阴 overcast 秒后下雨，雨下 hours 小时，雨势 strength。
   * 转阴时在外面的蜂每秒有 recall[0] 的机会往回飞，下雨时 recall[1]；雨把花里的花蜜、花粉冲掉，大雨 wash 秒冲掉约六成。
   * 气温（°C）在 seasons.airLo～airHi 之间，最热在 warmest 点、最凉在它前后 12 小时；每天整体偏冷偏热 swing 之间（半天里慢慢变过去）；
   * 阴雨按云量最多降 rainCool
   */
  weather: {
    firstRainDay: 1,
    showers: [11, 19] as [number, number],
    showerPeak: 2,
    showerOff: 0.5,
    overcast: 25,
    hours: [1.5, 4] as [number, number],
    strength: [0.4, 1] as [number, number],
    recall: [0.1, 1] as [number, number],
    wash: 90,
    warmest: 14,
    swing: [-3, 4] as [number, number],
    rainCool: 5,
  },
  /**
   * 巢脾上的温度（T-021、P-011）。温度格 cell cm 见方，两面共用。每秒每格：每只蜂升温 bee °C，振翅产热的蜂再加 heater；
   * 往外面的空气散 loss × 和气温的差，在巢门扇风的蜂每只让散热快 vent 倍；和四邻拉平 spread。
   * 蜂产的热随温度降，到 cook 不再产；振翅产热的蜂到 ideal 上沿就停。扇风的蜂到 fanFull 只时蒸发让巢里比气温凉 evap 度。
   * 子在 ideal 之间发育正常，偏出去每度慢 slowPerC（最慢 slowest 倍）；低于 chill、高于 cook 每秒有（差几度 + 1）/ killTime 的机会死。
   * 有子不到 broodCells 个的格不算育儿区。育儿区里冷的子占的比例 × heaters 是清理蜂、内勤蜂去子脾上产热的机会（采集蜂、守卫 × oldHeaters），
   * 热的比例 × fanners 是内勤蜂、守卫去巢门扇风的机会；一次 hold 秒。冷的子 refresh 秒重找一次
   */
  heat: {
    cell: 2,
    bee: 0.012,
    heater: 0.08,
    loss: 0.01,
    vent: 0.015,
    evap: 4,
    fanFull: 150,
    spread: 0.1,
    ideal: [34, 36] as [number, number],
    slowPerC: 0.07,
    slowest: 0.3,
    chill: 28,
    cook: 38,
    killTime: 2500,
    broodCells: 3,
    heaters: 1,
    oldHeaters: 0.5,
    fanners: 0.5,
    hold: [20, 40] as [number, number],
    refresh: 5,
  },
  /**
   * 胡蜂（P-012、T-022）：黄腿胡蜂 Vespa velutina。第 firstDay 天起，每天有 seasons.hornets 的机会是“胡蜂天”，那天 hours 点之间
   * 每个游戏小时有 perHour 的机会来一只，同时最多 max 只；阴雨天不来、在的也走。一只来了在巢门外待 stay 秒，
   * 悬停在管口外 spot.out cm、上下 spot.up、左右 spot.side 以内的一点，每 drift 秒换一个点，飞 speed、悬停时 hover cm/s。
   * 离它 reach cm 内飞着的蜂，过了 strike 秒的间隔扑一次（扑的时候 dart cm/s），扑中了有 catch 的机会抓走，
   * 巢门边抖翅的蜂（shimmer）到 shimmerFull 只时抓中的机会少 shimmerCut，装了防护片再乘 plateCatch。
   * 抓到了带着飞走，有 back 的机会过 backIn 秒回来接着抓。悬停时每秒有 land 的机会扑到管口上抓守卫（装了防护片不会），
   * 一扑上去就被围住：巢门附近 ball 只蜂出来围成热球，球里到 ballFull 只时温度升到 ballMax（°C），按 ballRise 秒接近；
   * 热过 lethal 累计 dose 秒胡蜂死。离管口 threatR cm 内有胡蜂时守卫抖翅、守卫日龄的蜂 threatGuards 的机会去巢门；
   * 每有一只胡蜂悬停，采集蜂走到巢门时有 paralysis 的机会不出去（最多 paralysisMax）。
   * 防护片让管口最后 plateLen cm 走得慢（乘 plateSlow）。死胡蜂掉在地上 deadTime 秒；胡蜂身长 length
   */
  hornets: {
    firstDay: 1,
    hours: [13, 18] as [number, number],
    perHour: 0.5,
    max: 3,
    stay: [80, 160] as [number, number],
    spot: { out: [15, 40] as [number, number], up: [-3, 18] as [number, number], side: 25 },
    drift: [3, 8] as [number, number],
    speed: 350,
    hover: 25,
    reach: 14,
    strike: [5, 12] as [number, number],
    dart: 220,
    catch: 0.3,
    shimmerCut: 0.6,
    shimmerFull: 25,
    plateCatch: 0.4,
    back: 0.5,
    backIn: [30, 80] as [number, number],
    land: 0.012,
    ball: [120, 180] as [number, number],
    ballFull: 100,
    ballMax: 46.5,
    ballRise: 8,
    lethal: 45,
    dose: 30,
    ballLoss: 0.03,
    threatR: 70,
    threatGuards: 0.8,
    paralysis: 0.3,
    paralysisMax: 0.9,
    plateSlow: 0.4,
    plateLen: 1.5,
    deadTime: 300,
    length: 2.8,
  },
  /**
   * 养蜂人开箱（P-013、T-023）。割蜜割下点的那一块封盖蜜脾：从点的位置往外 cutR cm 以内、连成一片、两面都没有子和花粉、
   * 至少一面是封盖蜜的巢房，割掉的地方蜂再从缺口边上造回来（有要补的地方时内勤蜂 repairBuilders 的机会去筑巢，先去补，补的时候一次加高 repairBoost 倍，一趟在缺口边上接着造最多 repairStay 下；
   * 只补离框梁中间最近的一圈：按框的半宽、高度归一化的椭圆半径比最近的要补的位置大不过 repairBand）；被割掉的巢脾上的蜂挪到 scatter cm 以内还在的巢脾上。
   * 换框把一框换成空巢框，只有框梁下中间三分之一刚起头的巢房。开箱让蜂躁动（割蜜加 alarm.harvest、换框加 alarm.swap，最多 1），
   * 按 alarmTime 秒的时间常数退；躁动时采集蜂走到巢门有 躁动 × alarmStop 的机会不出去，过 alarmGuard 时守卫日龄的蜂
   * 像有胡蜂时一样多去巢门。惊扰的压力（割蜜加 stress.harvest、换框加 stress.swap）按 stressDays 天的时间常数退，飞逃用
   */
  keeper: {
    cutR: 3,
    scatter: 8,
    repairBoost: 30,
    repairBuilders: 0.7,
    repairBand: 0.3,
    repairStay: 6,
    alarm: { harvest: 0.6, swap: 1 },
    alarmTime: 90,
    alarmStop: 0.6,
    alarmGuard: 0.3,
    stress: { harvest: 0.15, swap: 0.3 },
    stressDays: 1.5,
  },
  /**
   * 巢虫和中囊病（T-024）。
   * 巢虫：第 firstDay 天起，夜里 hours 点之间每个游戏小时有一次机会飞进来一只蜡螟产卵，孵出 clutch 条巢虫：
   * 机会在 perHour 之间按蜂群弱的程度插值、再乘 seasons.moth（巢里的蜂数 / 造好的位置，到 cover 算强、0 最弱）。巢虫从离一处封盖子最近的巢脾边上钻进去、朝那里爬，
   * 在一面的房底下沿中肋打隧道，每 crawl 秒爬一格，每格有 turn 的机会拐弯，挑下一格时封盖子底下加 brood 分（方向的余弦是 -1..1），不进蜜房；爬过的巢房留丝 silk 秒，
   * 空房变脏，封盖子有 bald 的机会成白头蛹，白头蛹羽化时有 entangle 的机会被丝缠死。
   * 巢虫离 seeR cm 内的蜂越多越容易被拖出去：每秒 remove × min(1, 蜂数 / crowd)，躲在封盖子下面再乘 hidden。
   * 活过 life 秒的爬出去化蛹（没了）。
   * 中囊病：第 firstDay 天起每天有 seasons.sacbrood 的机会发一次病，那时巢里一只幼虫和它 seedR cm 内最多 seed 只幼虫染上。
   * 哺育蜂喂染病的幼虫有 pick 的机会带上病毒，带着的 carry 秒里每喂一只健康的幼虫有 pass 的机会传过去；
   * 清理蜂拖死囊（多花 cleanWork 倍的时间）有 cleanPick 的机会带上
   */
  pests: {
    moth: {
      firstDay: 1,
      hours: [20, 4] as [number, number],
      perHour: [0.02, 0.5] as [number, number],
      cover: 0.5,
      clutch: [2, 5] as [number, number],
      crawl: [30, 60] as [number, number],
      turn: 0.2,
      brood: 0.6,
      silk: 900,
      bald: 0.7,
      entangle: 0.3,
      seeR: 2,
      crowd: 6,
      remove: 0.004,
      hidden: 0.1,
      life: [1800, 3000] as [number, number],
    },
    sacbrood: {
      firstDay: 2,
      seed: [3, 6] as [number, number],
      seedR: 3,
      pick: 0.4,
      carry: 200,
      pass: 0.05,
      cleanPick: 0.3,
      cleanWork: 2,
    },
  },
  /**
   * 飞逃和野生蜂群（P-010、T-025）。每 every 秒看一次蜂群的处境，四样压力各 0..1：开箱（keeper.stress / stressFull）、
   * 缺蜜（储蜜从 hungerAt 满房往下到 hungerFull 由 0 到 1）、胡蜂（胡蜂的危险程度按 hornetDays 天平滑后 / hornetFull）、
   * 病虫（巢里的白头蛹、死囊加 worm 倍的巢虫数 / pestFull）。按 weights 加权加起来（最多 1）是处境，飞逃的压力按 days 天的
   * 时间常数趋向处境（储蜜不到 hungerFull 时快 starveRate 倍）：处境一直是 1 也要两天多才飞逃，一样压力到头也不够。
   * 压力过 restless 有征兆（回到 calm 以下才消失），征兆的程度按压力从 calm 到 leave 由 0 到 1：采集蜂走到巢门有 征兆 × stopForage
   * 的机会不出去，蜂王每回有 征兆 × stopLaying 的机会不产卵，蜂吃到 gorge 才停。压力过 leave、在 hours 点之间、能飞时飞逃。
   * 工蜂少于 collapse 只时蜂群没了，和飞逃一样箱子空出来。
   * 飞逃：巢里的蜂做完手上的事就去巢门出去，在外面的丢下活飞过去，在 cloud 附近 cloudR 内盘旋；都出来了（最多 leaveMax 秒）
   * 再盘旋 cloudTime 秒，然后以 speed cm/s 飞走，飞出 farR 整群没了，留下的子死了。
   * 空箱 vacant 天以后、scoutHours 点之间能飞时来 scouts 只侦察蜂，在巢门进进出出 scoutTime 秒；然后（hours 点之间、能飞时）
   * workers 只工蜂（日龄在寿命的 0..young 之间，蜂群里年轻的蜂多）、drones 只雄蜂和一只蜂王的野生蜂群从 farR 外飞来，在 land 附近 landR 内盘旋，每只每盘旋一趟有 enter 的机会进巢，
   * 过 landMax 秒剩下的都进去；每只工蜂带来 carry 房蜜，先带在身上，有空房就吐进最靠上的空房（带着的也算存蜜）。
   * renew：箱子一空就把两框换成空巢框，新来的蜂群从框梁下重新造。
   * 只在 seasons 里的季节飞逃、来侦察蜂（P-017：冬天不飞逃，冬天死了的箱子开春才有蜂群来）
   */
  abscond: {
    seasons: ['spring', 'summer', 'autumn'] as readonly string[],
    every: 5,
    stressFull: 0.6,
    hungerAt: 250,
    hungerFull: 20,
    hornetDays: 1,
    hornetFull: 0.2,
    worm: 3,
    pestFull: 240,
    weights: { stress: 0.6, hunger: 0.8, hornets: 0.5, pests: 0.5 },
    days: 2,
    starveRate: 4,
    restless: 0.45,
    calm: 0.35,
    leave: 0.7,
    stopForage: 0.6,
    stopLaying: 0.7,
    gorge: 0.9,
    hours: [9, 14] as [number, number],
    collapse: 30,
    cloud: { x: -350, y: 300, z: 0 },
    cloudR: 150,
    leaveMax: 120,
    cloudTime: 20,
    speed: 120,
    farR: 3000,
    vacant: [0.5, 1.5] as [number, number],
    scoutHours: [8, 12] as [number, number],
    scouts: [6, 12] as [number, number],
    scoutTime: 100,
    workers: [1800, 2400] as [number, number],
    carry: 0.12,
    young: 0.5,
    renew: true,
    drones: [10, 30] as [number, number],
    land: { x: -120, y: 130, z: 0 },
    landR: 70,
    enter: 0.08,
    landMax: 150,
  },
  /**
   * 分蜂（P-016、T-027）。春天每个游戏小时看一次：蜂王在产卵、工蜂不少于 minWorkers、子不少于 minBrood、今年还没分过时有 perHour 的机会
   * 开始造王台：在巢脾的下缘（离框底至少 minV cm）造 cells 个，彼此隔开 gap cm；每个过 layIn 秒老蜂王在里面产一粒卵。
   * 王台里的蜂王按 dev 发育（卵、幼虫、封盖，秒）。第一个王台封盖以后，hours 点之间能飞时分蜂：巢里的工蜂每只有 share 的机会、
   * 雄蜂 droneShare 的机会跟老蜂王走（在外面的采集蜂不走），吃饱蜜从巢门出去，在 cloud 附近 cloudR 内盘旋，都出来了（最多 leaveMax 秒）
   * 再盘旋 cloudTime 秒，以 speed cm/s 飞走，飞出 farR 没了。老蜂王还在时，王台里的蜂王到了时候也不出房（工蜂把她关在里面）。
   * 老蜂王走了以后第一个出房的蜂王把别的王台咬开，咬开的 torn 秒后清掉。处女王出房 mateAfter 秒后，flightHours 点之间能飞时出巢婚飞，
   * 在 flightAt 附近 flightR 内飞 flightTime 秒再回来；回来 layAfter 秒后开始产卵。
   * 没有蜂王、也没有王台时（王台被割掉、换掉了），有卵或小幼虫就从它们改造 emergency 个急造王台，没有就只能等蜂群慢慢没了
   */
  swarming: {
    seasons: ['spring'] as readonly string[],
    minWorkers: 2000,
    minBrood: 500,
    perHour: 0.15,
    cells: [4, 7] as [number, number],
    minV: 3,
    gap: 3,
    layIn: [60, 600] as [number, number],
    dev: { egg: 600, larva: 1000, capped: 1600 },
    hours: [10, 15] as [number, number],
    share: 0.55,
    droneShare: 0.5,
    cloud: { x: 380, y: 320, z: 120 },
    cloudR: 160,
    leaveMax: 150,
    cloudTime: 60,
    speed: 120,
    farR: 3000,
    torn: 600,
    mateAfter: 900,
    flightHours: [12, 16] as [number, number],
    flightAt: { x: 2400, y: 1400, z: -1800 },
    flightR: 600,
    flightTime: 60,
    layAfter: 480,
    emergency: 3,
  },
  /**
   * 冬天抱团（P-017、T-029）。气温低于 air °C 时蜂在巢脾上抱成一团，团的中心在开局育儿区的中心，每只蜂在一面上占 area cm²（两面各一半）。
   * 工蜂、没在产卵的蜂王每次闲下来有 share 的机会回团里待 hold 秒（算产热的蜂）；团里的蜂蜜囊空得快 burn 倍，吃一次多用 meal 倍的蜜（产热要吃蜜）。
   * 巢里比 chill °C 冷的地方的工蜂每秒有 1/chillTime 的机会冻死。冬天存蜜少于 lowStores 满房时记一次事件
   */
  cluster: {
    air: 12,
    area: 0.45,
    share: 0.85,
    hold: [20, 40] as [number, number],
    burn: 2,
    meal: 4,
    chill: 10,
    chillTime: 400,
    lowStores: 400,
  },
  /**
   * 雄蜂的季节变化（T-028）。四个一组的是春、夏、秋、冬。蜂王产雄蜂卵的上限是 care.droneBrood 乘 brood，
   * 没到上限时每产一粒有 lay 的机会专门去找雄蜂房（巢脾下缘离育儿区远、凉一些，不低于 layWarm °C 就产）；
   * 新开始造的位置离框梁不少于 combDepth 倍框高时，有 comb 的机会造成雄蜂房。
   * 出巢：flight 乘 flightChance 是一只闲着的雄蜂出巢的机会（只在 flightHours 点能飞时、日龄过了寿命的 mature），
   * 先吃饱，在雄蜂集结区（和婚飞同一带）飞 flightTime 秒回来。
   * 赶出巢：每游戏小时每只巢里的雄蜂有 evict 的机会被工蜂赶出去，走出巢门，落在箱前 drop 附近 dropR 内的地上，die 秒后死
   */
  drones: {
    brood: [1.2, 1, 0, 0],
    lay: 0.2,
    layWarm: 33,
    comb: [0.5, 0.25, 0, 0],
    combDepth: 0.4,
    flight: [1, 1, 0, 0],
    flightChance: 0.06,
    flightHours: [12, 16] as [number, number],
    mature: 0.2,
    flightTime: [30, 60] as [number, number],
    evict: [0, 0, 0.03, 0.3],
    drop: { x: -60, z: 0 },
    dropR: 30,
    die: [60, 180] as [number, number],
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
    /**
     * 蜂身的动作：腿迈一步走 stride cm；翅膀在画面上一秒扇 wingHz 次（真的约 230 次，画出来只能是频闪）；
     * 触角一秒摆 antennaHz 次。一帧里腿最多转 maxGait 弧度，快进时不乱成一团
     */
    anim: { stride: 0.3, wingHz: 19, antennaHz: 1.3, maxGait: 1.6 },
    /** 飞着的蜂短于 minPx 像素时放大到 minPx（T-007）；巢里的蜂不放大，不然远看整箱是一团 */
    minPx: 5,
  },
};

import './i18n';

/** 长度单位是厘米，时间单位是模拟秒；真实数值和来源见 docs/bee/BALANCE.md */
export const CONFIG = {
  /** 一天 10 分钟（DECISIONS T-002），早上 9 点开局 */
  clock: { dayLength: 600, startHour: 9 },
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
    refresh: { larvae: 2, dirty: 5, layable: 3, food: 5, pollen: 5, ripen: 5, frontier: 10, store: 5, pollenStore: 5 },
    /** 育儿区（开局育儿区的椭圆）往外到 ring 倍是放花粉的一圈，再往外放花蜜；蜂王在 queen 倍以内产卵 */
    ring: 1.5,
    queen: 1.4,
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
   * wild 的花开局会长；plantR 是玩家种一片的半径。refill 为 0 的（糖水）采空了不长回来；花丛比株距的一半还小时只有中间一株
   */
  flowers: {
    patches: 9,
    near: 500,
    far: 2200,
    gap: 150,
    margin: 300,
    species: [
      { key: 'clover', wild: true, plantR: 120, hours: [7, 18], ramp: 1, nectar: 0.08, pollen: 0.02, refill: 150, pollenKind: 2, r: [150, 240], spacing: 11, closes: false, land: [[0.5, 13.7, 0]] },
      {
        key: 'sunflower',
        wild: true,
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
      { key: 'pumpkin', wild: true, plantR: 110, hours: [5, 12], ramp: 0.8, nectar: 2.5, pollen: 2, refill: 120, pollenKind: 1, r: [120, 190], spacing: 60, closes: true, land: [[17.55, 27, 9.59], [-17.07, 24, 10.42], [-0.47, 30, -19.99]] },
      { key: 'lavender', wild: true, plantR: 90, hours: [8.5, 18], ramp: 1.2, nectar: 1.2, pollen: 0.15, refill: 160, pollenKind: 4, r: [90, 150], spacing: 48, closes: false, land: [[15.4, 51, 0], [0, 48, 13.4], [-13.3, 55, -5.5], [6.5, 45, -16.3]] },
      { key: 'corn', wild: true, plantR: 90, hours: [7.5, 11.5], ramp: 1, nectar: 0, pollen: 1.2, refill: 180, pollenKind: 3, r: [90, 140], spacing: 35, closes: false, land: [[7, 221.6, 0], [0, 221.6, 7], [-7, 221.6, 0], [0, 221.6, -7]] },
      // 糖水碟：一个木墩上放一碟糖水，只有一“株”；白天蜂才来，喝完了不会自己长回来
      { key: 'sugar', wild: false, plantR: 10, hours: [6.5, 18.5], ramp: 0.5, nectar: 150, pollen: 0, refill: 0, pollenKind: 0, r: [10, 10], spacing: 60, closes: false, land: [[8, 47.2, 0], [0, 47.2, 8], [-8, 47.2, 0], [0, 47.2, -8], [5.7, 47.2, 5.7], [-5.7, 47.2, -5.7]] },
    ] as const,
  },
  /**
   * 玩家的工具（T-016）。种下的花丛 grow 秒长成，长成前不开花；最多种 maxPlanted 片。种花、放糖水的地方离蜂箱至少
   * hiveClear cm、离别的花丛 gap cm、离花园边 flowers.margin。糖水碟最多 maxFeeders 个，在碟子 refillR cm 内再放一次是添满
   */
  tools: { grow: 300, maxPlanted: 12, maxFeeders: 3, hiveClear: 250, gap: 40, refillR: 40 },
  /**
   * 天气（T-020）。平均每天 rainPerDay 场阵雨，第 firstRainDay 天以前不下；showers 点之间下雨的机会是平时的 showerPeak 倍，
   * 其余时候 showerOff 倍（一天平均是 1）。转阴 overcast 秒后下雨，雨下 hours 小时，雨势 strength。
   * 转阴时在外面的蜂每秒有 recall[0] 的机会往回飞，下雨时 recall[1]；雨把花里的花蜜、花粉冲掉，大雨 wash 秒冲掉约六成。
   * 气温（°C）在 air 之间，最热在 warmest 点、最凉在它前后 12 小时；每天整体偏冷偏热 swing 之间（半天里慢慢变过去）；
   * 阴雨按云量最多降 rainCool
   */
  weather: {
    rainPerDay: 0.5,
    firstRainDay: 1,
    showers: [11, 19] as [number, number],
    showerPeak: 2,
    showerOff: 0.5,
    overcast: 25,
    hours: [1.5, 4] as [number, number],
    strength: [0.4, 1] as [number, number],
    recall: [0.1, 1] as [number, number],
    wash: 90,
    air: [23, 33] as [number, number],
    warmest: 14,
    swing: [-3, 4] as [number, number],
    rainCool: 5,
  },
  /**
   * 巢脾上的温度（T-021、P-011）。温度格 cell cm 见方，两面共用。每秒每格：每只蜂升温 bee °C，振翅产热的蜂再加 heater；
   * 往外面的空气散 loss × 和气温的差，在巢门扇风的蜂每只让散热快 vent 倍；和四邻拉平 spread。
   * 蜂产的热随温度降，到 cook 不再产；振翅产热的蜂到 ideal 上沿就停。扇风的蜂到 fanFull 只时蒸发让巢里比气温凉 evap 度。
   * 子在 ideal 之间发育正常，偏出去每度慢 slowPerC（最慢 slowest 倍）；低于 chill、高于 cook 每秒有（差几度 + 1）/ killTime 的机会死。
   * 有子不到 broodCells 个的格不算育儿区。育儿区里冷的子占的比例 × heaters 是清理蜂、内勤蜂去子脾上产热的机会，
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
    fanners: 0.5,
    hold: [20, 40] as [number, number],
    refresh: 5,
  },
  /**
   * 胡蜂（P-012、T-022）：黄腿胡蜂 Vespa velutina。第 firstDay 天起，每天有 days 的机会是“胡蜂天”，那天 hours 点之间
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
    days: 0.75,
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

import { L, type Text } from '../../core/i18n';
// 游戏的各模块都读配置，在这里登记词典，保证第一次翻译之前已经登记
import './i18n';

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
    /** 相机能去的范围：水平 ±cameraRange，高度 cameraMinY 到 cameraMaxY（地下最深的房间约 -80） */
    cameraRange: 300,
    cameraMinY: -140,
    cameraMaxY: 320,
  },

  time: {
    /** 一个游戏日对应的模拟秒数（1 倍速下即真实秒数）。 */
    dayLength: 600,
    startHour: 7.5,
  },

  /** 光照强度（three.js 单位）；地下的观察灯只在透视时打开 */
  light: {
    sun: 3.2,
    hemiDay: 1.15,
    hemiNight: 0.95,
    moon: 2.4,
    /** 夜间地表跟随相机的冷色观察灯，让黑色的蚂蚁在深色地面上分得出来 */
    surfaceLamp: 5,
    xrayLamp: 12,
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

  /** 储备充足时待命的觅食蚁：一部分不回休息室，在巢口附近闲逛，不带食物回来 */
  loiter: {
    /** 白天待命时改为出巢闲逛的概率；地表低于 minTemp（°C）时不出去 */
    chance: 0.45,
    minTemp: 14,
    /** 闲逛中心离入口的距离、闲逛半径（cm）、时长（秒） */
    offset: [2, 7] as [number, number],
    radius: [3, 5] as [number, number],
    time: [30, 80] as [number, number],
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
    /** 需要扩建时改为扩大已有房间的概率（房间数到上限后只扩大） */
    enlargeChance: 0.4,
    /** 每次扩大的线性倍数（以门口为不动点）；房间半径的上限 */
    enlargeScale: 1.2,
    maxRoomRadius: 12,
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
    /** 离相机超过该距离的工蚁改用简化网格且不投影（此时在 720p 画面上约 20 像素长） */
    lodDistance: 35,
    /** 地表和房间里两只工蚁中心至少相隔 2 倍该值（蚁后按体型放大） */
    personalSpace: 0.32,
    /** 隧道里前后相距不到该值、左右不到 0.4 的同伴算挨得太近，各自横向让开 */
    tunnelGap: 0.9,
    speedSurface: 3.2,
    /** 贴边绕行：朝障碍一侧弯的角速度（弧度/秒）、目标方向前方探测的距离、最长连续贴边秒数 */
    hugRate: 2.5,
    hugProbe: 2.5,
    hugMax: 25,
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

  /** 玩家干预工具 */
  intervention: {
    /** 玩家投放的食物同时存在的上限（不计自然刷新的） */
    maxPlacedFood: 30,
    maxPlacedObstacles: 40,
    /** 水洼半径（小 / 大） */
    waterRadius: [4, 8] as [number, number],
    /** 20°C 时水洼完全蒸发渗干所需的游戏日 */
    waterDays: 0.25,
    /** 浇水瞬间残留的信息素比例：路径 / 足迹 */
    washTrail: 0.05,
    washHome: 0.3,
  },

  /** 天敌 */
  predators: {
    /** 平均每个游戏日游荡进活动范围的狼蛛数；同时最多 maxNaturalSpiders 只 */
    spiderPerDay: 1.2,
    maxNaturalSpiders: 2,
    /** 狼蛛停留的游戏日（吃够 spiderMeals 只也会离开） */
    spiderStayDays: [0.4, 0.8] as [number, number],
    spiderMeals: 3,
    /** 发现蚂蚁的距离（cm） */
    spiderSense: 7,
    /** 游荡时朝蚂蚁来往多的一侧转向的角速度（rad/s） */
    spiderTrailTurn: 1.5,
    /** 游荡 / 扑击速度（cm/s，随温度变化） */
    spiderWalk: 2.2,
    spiderRush: 6,
    /** 扑到蚂蚁身边时的捕获概率；扑击超过 rushTime 秒就放弃 */
    spiderCatch: 0.6,
    spiderRushTime: 3.5,
    spiderFeedSec: 90,
    /** 开局的蚁狮陷阱数 */
    antlions: 3,
    pitRadius: 2.6,
    /** 坑壁把蚂蚁往中心拉的速度（cm/s），越靠中心越陡 */
    pitPull: 2.2,
    antlionFeedSec: 240,
    maxSpiders: 4,
    maxPlacedAntlions: 8,
  },

  defense: {
    /** 警报信息素半衰期（秒）、有效半径（cm）、单处上限 */
    alarmHalfLife: 6,
    alarmRadius: 10,
    alarmMax: 1.5,
    /** 狼蛛扑击时在现场释放的警报强度 */
    alarmOnAttack: 1,
    /** 闻到的浓度（强度 × 距离衰减）超过该值时赶去增援；增援持续秒数 */
    respondLevel: 0.15,
    defendSec: [15, 30] as [number, number],
    /** 附近没有狼蛛、闻到的警报也低于 respondLevel 时，增援最多再持续这么多秒 */
    calmSec: 4,
    /** 增援时的速度倍数；发现狼蛛的距离；贴身撕咬的距离 */
    rushSpeed: 1.3,
    chaseRange: 12,
    biteRange: 1.3,
    /** 每只围攻的工蚁每秒补充的警报强度 */
    mobEmit: 0.5,
    /** 狼蛛累计被咬（工蚁数 × 秒）超过该值就逃走；没有被咬时每秒恢复的量 */
    harassLimit: 14,
    harassRecover: 1,
    /** 围攻时每只工蚁每秒被狼蛛咬死的概率 */
    mobKillPerSec: 0.025,
    /**
     * 没闻到警报的地表工蚁离捕猎中的狼蛛这么近（cm，比狼蛛发现蚂蚁的距离稍远）时，每 0.5 秒有一定概率发觉它：
     * 狼蛛在走动时容易发觉，静止伏击时难；发觉后朝远离它的方向跑开几秒，速度倍数 fleeSpeed
     */
    fleeRange: 10,
    fleeNoticeMoving: 0.35,
    fleeNoticeStill: 0.08,
    fleeSec: [2, 4] as [number, number],
    fleeSpeed: 1.25,
    /** 狼蛛离入口这么近时，觅食蚁留巢、内务蚁出来警戒 */
    guardRadius: 20,
    holdBackProb: 0.7,
    guardProb: 0.5,
    maxGuards: 24,
    /** 威胁刚出现时，离那个入口最近的这么多只空手内务蚁放下手头的事出来警戒 */
    callGuards: 8,
    /** 警戒时每隔这么多秒看一眼威胁还在不在 */
    guardCheckSec: 2,
    /** 爬出陷阱的蚂蚁记住它，此后绕开（陷阱半径之外再留的距离） */
    pitAvoidPad: 1,
  },

  weather: {
    /** 平均每个游戏日开始下雨的次数 */
    rainPerDay: 0.6,
    /** 第一个游戏日不自然下雨，先让玩家看清晴天的蚁群 */
    firstRainDay: 1,
    /** 下雨前转阴的秒数（玩家招来的雨用 calledOvercastSec）；一场雨的游戏日长度；雨势范围 */
    overcastSec: 25,
    calledOvercastSec: 20,
    rainDays: [0.1, 0.25] as [number, number],
    rainStrength: [0.45, 1] as [number, number],
    /** 下雨时地表降温（°C，乘云量） */
    rainCool: 5,
    /** 大雨中路径信息素 / 领地足迹的半衰期（秒），雨小时按雨势放慢 */
    rainTrailHalfLife: 8,
    rainHomeHalfLife: 90,
    /** 大雨中每秒新出现一个积水洼的概率，水洼半径 */
    puddlePerSec: 0.06,
    puddleRadius: [2.5, 5] as [number, number],
    /** 大雨下地面湿透需要的秒数；放晴后约 20°C 时晾干需要的秒数 */
    soakSec: 40,
    drySec: 180,
    /** 雨中地表移动减速比例 */
    rainSlow: 0.4,
    /** 雨停后地面湿润度低于 reopenWet 才清开入口、恢复出巢；低于 dryWet 前非侦察觅食蚁按比例留巢 */
    reopenWet: 0.7,
    dryWet: 0.4,
    /** 每次封堵 / 清开改变的封堵程度；同时在一个入口干活的内务蚁上限 */
    plugPerLoad: 0.25,
    maxPluggers: 6,
    /** 地面湿润度在此区间内，地表径流从无到满，雨水才会从入口灌进来 */
    runoffWet: [0.2, 0.6] as [number, number],
    /** 入口未封堵时雨水灌入浅层房间：深度小于 floodDepth（cm）的房间，每秒进水量，每秒渗干量 */
    floodDepth: 14,
    floodRate: 0.09,
    drainRate: 0.003,
    /** 积水超过该值的房间：蛹搬走，储食变质加快的倍数 */
    floodedAt: 0.25,
    floodSpoil: 3,
  },

  nest: {
    tunnelRadius: 1.0,
    shaftRadius: 1.25,
  },
};

export type Role = 'queen' | 'nurse' | 'maintenance' | 'forager';

export const ROLE_NAMES: Record<Role, Text> = {
  queen: L('role.queen'),
  nurse: L('role.nurse'),
  maintenance: L('role.maintenance'),
  forager: L('role.forager'),
};

export const ROLE_COLORS: Record<Role, number> = {
  queen: 0xffb13b,
  nurse: 0xf06fb0,
  maintenance: 0x5fb8ff,
  forager: 0x7ee06a,
};

# 架构说明

## 目录结构

```
index.html              页面骨架（各面板的容器）；Vite 的源码模板，不能直接双击运行
赛博养蚂蚁.html         构建生成的单文件发布版，双击即可运行（不要手改）
vite.config.ts          构建配置；singleFile 插件把产物内联成单个 HTML，并复制到根目录
src/
  main.ts               入口：创建渲染器、场景、各视图，处理按键与选择，驱动主循环
  config.ts             全局配置与常量（职别名称、颜色）；调参优先改这里
  style.css             界面样式
  util/
    random.ts           Rng（可设种子的随机数）、Noise2D（梯度噪声、分形噪声）；`rng` 为运行时共享实例
    math.ts             clamp / lerp / smoothstep / wrapAngle 等
  sim/                  —— 模拟层，不依赖 WebGL ——
    clock.ts            SimClock：游戏日、时刻、昼夜、土壤温湿度模型
    ant.ts              Ant：个体状态 + 运动层（执行指令）
    routines.ts         行为层：各职别的任务协程
    colony.ts           Colony：种群、物品、幼体发育、食物储备、死亡、分工评估、接触、蛹的温度调节、统计历史
    items.ts            Item：卵/幼虫/蛹/食物/垃圾/土粒/尸体
    spatial.ts          SpatialHash：每步重建的均匀网格，用于蚂蚁之间的近邻查询
    expansion.ts        NestExpansion：拥挤度、规划新房间、分配挖掘工作面、推进隧道和房间的挖掘
  world/
    world.ts            World：组装所有模拟子系统，按固定步长推进；房间温度（含石块加温）
    terrain.ts          解析式高度场、蚁丘、草被密度、地形网格
    vegetation.ts       草（风动着色器）、石块、落叶、枯枝、植物（含 4 株寄主植物）；地表避障圆与空间网格
    food.ts             食物源类型、生成、网格
    aphids.ts           蚜虫群：附着在植物茎秆上，增殖、蜜露积存、实例化网格
    predators.ts        天敌：狼蛛（游荡、扑击、进食、离开的状态机）与蚁狮陷阱（松沙区、坑底捕食）；网格与存档
    alarm.ts            警报信息素：短暂的点源列表，浓度查询；信息素视图下画成红圈
    weather.ts          天气：晴 / 转阴 / 下雨的阶段与雨势、云量、地面湿润度；积水洼、浅层房间进水；入口封堵任务的分配
    water.ts            玩家浇出的水洼：贴地网格、蒸发收缩、冲刷信息素；同时登记为“软”避障圆
    save.ts             存档：组装各子系统的 toSave / restore，版本与种子检查
    pheromone.ts        信息素网格（路径 + 领地足迹两个通道）与热力图叠加层
  nest/
    nest.ts             蚁穴数据：节点、隧道、房间、入口、挖掘工作面；程序化生成；寻路；扩建用的几何操作
    nestView.ts         蚁穴网格：背面渲染的房间与隧道、土壤剖面墙、入口洞口与土塞、房间积水；每帧 sync 跟随蚁穴变化
  render/
    antView.ts          蚂蚁几何体、步态着色器、实例化更新、选中标记
    itemView.ts         物品的实例化渲染
    environment.ts      天空、日月、半球光、观察灯、雾、星空；阴雨时变灰变暗
    rain.ts             雨丝：跟随相机的循环下落线段
  ui/
    camera.ts           自由飞行 / 跟随相机、平滑飞向目标
    picking.ts          点选（蚂蚁屏幕空间 + 物体射线）；groundPoint 用解析高度场求鼠标下的地面点
    tools.ts            干预工具：当前工具与选项、放置预览圈（绿 / 红）、点击时调用 World 的干预方法
    saveSlot.ts         存档在 localStorage 中的读写（完整存档 + 一份小摘要）
    hud.ts              顶栏、蚁群概况、信息面板、事件列表、帮助、统计曲线、信息素图例、工具面板
scripts/
  simtest.ts            无界面模拟测试
  tooltest.ts           干预工具测试：投食、放树枝和石块、浇水、各种非法放置，统计原地打转的蚂蚁
  savetest.ts           存档往返测试：存档 → 读进新世界 → 对比指标与索引一致性 → 两边各自继续运行
  defensetest.ts        防御测试：在觅食路线上、巢口旁、侧入口外各放一只狼蛛，记录围攻、驱赶和入口警戒
  weathertest.ts        天气测试：招来一场雨，记录返巢、封堵、信息素冲刷、进水和雨后重开
  perftest.ts           性能测试：指定工蚁数量，统计每步耗时、各子系统占比和慢步
  extract-shots.mjs     从浏览器捕获结果中提取截图
docs/                   本文档目录
```

## 主循环

```
requestAnimationFrame
 ├─ world.advance(dt, 10 ms)    按倍速累积时间，按固定步长 1/30 秒逐步 tick；超过帧预算就丢掉剩余时间
 │    └─ tick: clock → weather.update → colony.update → predators.update → alarm.update → food.update → aphids.update → water.update → pheromone.update
 ├─ controller.update(dt)       相机
 ├─ 判断是否需要强制透视        相机在地下，或跟随的蚂蚁在巢内
 ├─ aphids.sync / nestView.sync 蚜虫数量或蚁穴结构变化时更新网格（按 rev 判断，未变化时几乎无开销）
 ├─ predators.sync              狼蛛位置与腿部动画、蚁狮大颚与猎物
 ├─ alarm.sync                  信息素视图打开时更新警报红圈
 ├─ antView / itemView.update   把模拟状态写进实例矩阵
 ├─ env.update                  光照随时刻变化，阴影跟随视点
 ├─ 每 0.4 秒刷新信息素热力图（开启时）
 ├─ 每 0.25 秒刷新界面
 └─ renderer.render
```

## 模拟层

### Colony.update(dt) 的顺序
1. 重建空间哈希（`spatial.rebuild`）
2. 蚁后的产卵额度按 `eggsPerDay × 饱食系数` 累积
3. 逐只蚂蚁：增加日龄和饥饿 → 判断死亡（衰老、饥饿；被捕食由 `PredatorManager` 结算）→ `ant.update` → 每 8 步一次接触检测（`tryContact`）；同时累加社会胃
4. 保持间距（`separate`，DECISIONS T-032）：隧道里每 3 步按边分组排序、横向让开（`Ant.measureTunnel` / `shiftSide`）；地表和房间里每步轮换六分之一的工蚁，用空间哈希找邻居互相推开（`Ant.avoid`）
5. 幼体发育（`updateBrood`，蛹的速度受房间温度影响）
6. 储食变质（`updateStores`）
7. 地表物品分解（`updateSurfaceItems`）
8. 定时任务：分工评估（每 0.02 天）、蛹的房间选择（每 0.01 天）、统计采样（每游戏小时，最多 1440 个点）、扩建（每 0.05 天）

### 分工与社会胃
- `Colony.reviewRoles` 计算 `targets`，按行为年龄给工蚁设置 `nextRole`；`newRoutine` 在开始下一项任务前应用它（`applyRole`）
- 液体只存在 `Ant.crop`。交哺统一走 `Colony.share(from, to, amount)`；`findRoommate` 找同房间里可交哺的同伴
- 交哺和触角接触时双方调用 `Ant.hold(t, 目标点)`：停顿并转向对方，期间 `update` 直接返回

### 蚁穴的动态结构
- **工作面** `DigFace`：`full` 是规划好的完整路径，`edge` 是已经挖出的一段，`node` 是末端节点。`Nest.growFace` 截断路径、移动末端节点、`edge.rev++` 并重算寻路
- **房间**：`Nest.openChamber` 把工作面末端变成新房间的门；`ready = false` 的房间不参与 `chamberOfType` / `chamberAt`，`grow` 控制视图缩放
- **重建**：`Nest.rev` 在节点或房间增减时递增；`NestView.sync` 比较 rev，只重建变化的隧道网格，必要时按新的包围盒重建土壤剖面墙
- **规划**：`NestExpansion.plan` 用 `Nest.isClear` 检查新房间不与已有结构重叠，并在 `nest.reserved` 里占位，避免两个项目抢同一块地
- **扩大房间**：`NestExpansion.planEnlarge` 选每单位面积蚂蚁最多、`Nest.canEnlarge` 通过的房间，项目的 `enlarge` 记录地板中心和半径的起止值，工作面是房间门口。每粒土按比例插值 `floor.x/z`、`rx`、`rz`；房间一直可用。`NestView` 不重建房间网格，而是按建模时的半径（`userData.bx/bz`）非均匀缩放

### 蚂蚁的两层结构

**运动层**（`Ant.step`）。每帧执行当前指令，完成后返回 `true`：

| 指令 | 含义 |
|---|---|
| `goto {node}` | 巢内沿隧道走到节点（房间内的蚂蚁会先走到门口） |
| `room {chamber, time, point?}` | 进入房间，在地板上漫游一段时间；给出 `point` 时走到该点后停留 |
| `exit` | 走到路程最近的入口（带随机性），出到地表 |
| `enter` | 地表上用路径整合返回最近的入口；携带食物时沿途释放信息素 |
| `search {time}` | 地表觅食搜索；返回找到的食物源，超时返回 `null` |
| `walk {x, z, r}` | 地表走到某点 |
| `patrol {x, z, radius, time}` | 在某点周围巡逻 |
| `climb {x, z, angle, r, top, stay}` | 走到植物茎秆旁，沿茎秆爬到 `top` 高度停留 `stay` 秒，再爬下来 |
| `wait {time}` | 原地停留 |

**行为层**（`routines.ts`）。每个职别一个入口协程，按优先级（带随机性）选择一项任务：

| 职别 | 任务优先级 |
|---|---|
| 蚁后 | 在蚁后室漫游 → 有产卵额度时产卵 |
| 保育蚁 | 进食 → 把蚁后室的卵搬到卵室 → 帮助待羽化的蛹破茧 → 搬运需要换房间的幼体（含蛹在蛹室与向阳育幼室之间搬运）→ 喂蚁后 → 喂饥饿的幼虫（嗉囊不足时先乞食）→ 侍奉蚁后（18%）/ 清洁幼体 |
| 内务蚁 | 进食 → 搬尸体到巢外垃圾堆 → 把其他房间的垃圾搬进垃圾室 → 垃圾室满 4 份后运出巢外 → 嗉囊满时分发甜液 → 挖掘（有扩建项目 45%，否则 15%）/ 白天在入口警戒（25%）/ 巡视房间 |
| 觅食蚁 | 进食（储备大于 3 份或自己嗉囊有甜液时）→ 把嗉囊里的甜液分给同伴 → 夜间或地表低于 8°C 时休息 → 储备充足时留巢 → 放牧蚜虫（有固定蚜虫群时）→ 出巢搜索 → 取食或爬上蚜虫植物 → 返巢释放信息素 → 固体存入储食室，液体分给巢内同伴 |

进食顺序：自己的嗉囊 → 向同房间的同伴乞食（60%）→ 储食室的固体 → 在储食室向同伴乞食 → 失败则冷却后继续工作。

### 物品的位置状态（`Item.place`）

`chamber`（房间内，索引在 `byChamber[id]`）、`node`（隧道节点，`nodeItems`）、`surface` / `midden` / `mound`（地表，`surfaceItems`）、`carried`（被携带，`Ant.carrying`）、`gone`（已销毁）。

改变物品位置时必须通过 `Colony` 的方法（`addToChamber`、`dropAtMidden`、`dropOnMound`、`dropOnSurface`、`dropAtNode`、`pickUp`、`release`、`destroy`），这样各个索引才能保持一致。

### 玩家干预（`World` 的干预方法）

`dropFood`、`placeObstacle`、`removeObstacle`、`removePlacedById`、`pourWater`、`placePredator`、`removePredator`、`removePredatorById` 都返回 `ToolResult {ok, msg}`，成功时把 `msg` 记进蚁群事件。传 `dry = true` 只做检查不改动世界，界面用它决定预览圈的颜色。合法性检查集中在 `World.checkSpot`：活动范围、离入口的距离、与石块 / 植物 / 水洼 / 食物是否重叠。

界面层（`ToolController`）只负责选工具和给出地面点，不直接改世界。玩家放的障碍物记在 `Vegetation.placed`，移除时整张避障网格重建；自然生成的石块和植物不能移除。

天敌（`world/predators.ts`）：`PredatorManager.update` 在蚁群之后运行，先收集地表上没在爬植物的工蚁，再推进狼蛛的状态机（`wander → chase → feed → pause`，到时间或吃够后 `leave`）和蚁狮。捕食调用 `Colony.kill(ant, cause, false)`（不留尸体），进食结束再用 `dropOnSurface` 放下空壳。蚁狮陷阱对蚂蚁的影响写在 `Ant.surfaceMove` 里（`pitAt` 减速、拉向中心、`pitT` 计时后转身外爬）。设计见 DECISIONS T-028。

防御（DECISIONS T-029）：`Ant.update` 在 `hold` 之后、执行协程之前检查警报（`checkAlarm`），增援期间由 `Ant.defend` 接管运动，协程和当前指令原样保留，结束后接着执行。撕咬中的工蚁把 `mobTarget` 设为狼蛛编号，`PredatorManager.mobbed` 据此统计围攻数并结算驱赶和反咬。`PredatorManager.threatEntrance` / `guardsOut` 每步更新，`routines.ts` 里觅食蚁出巢前和内务蚁选任务时读取它们。

天气（DECISIONS T-030）：`WeatherSystem.update` 在每个 tick 最先运行，把云量、湿润度、雨势写进 `SimClock`、`PheromoneField.rain`，并更新各房间的 `Chamber.wet`。阶段切换时调用 `Colony.seekShelter` 中断地表工蚁；`Colony.newRoutine` 在 `weather.keepIn` 时给地表工蚁安排躲雨。入口封堵程度是 `Entrance.plug`，由内务蚁的 `plugEntrance` 协程通过 `WeatherSystem.workPlug` 修改，`Ant.stepExit` 只走没封死的入口；全部封死时带 `giveUp` 的 `exit` 指令以结果 `'blocked'` 结束，由协程决定怎么处理手里的东西（T-036）。雨后的分批出巢由 `WeatherSystem.damp` 控制。

地表避障：`Vegetation.obstacleAt(x, z, pad, solid)`。水洼也登记为避障圆（`kind: 'water'`），放置检查能看到它；移动时传 `solid = true` 跳过水洼，水洼由 `Ant.surfaceMove` 单独处理（先绕行，绕不开就蹚水）。

### 存档（`world/save.ts`）

页面启动时 `main.ts` 先 `new World()`，有存档就 `loadWorld` 套上去，然后才创建视图。读档顺序：时钟 → 蚁穴结构 → 玩家障碍物 → 水洼 → 天敌 → 食物源 → 蚜虫群 → 信息素 → 蚁群（蚂蚁、物品、扩建工程）。蚁群必须最后恢复，因为蚂蚁的位置和物品所在的房间都引用蚁穴的节点和房间编号。设计取舍见 DECISIONS T-027。

### 蚁穴生成（`Nest.generate`）
- 主竖井从主入口出发，经过 7 个分岔点向下蜿蜒，深度分别为 6、9、21、34、48、62、76 cm
- 房间按 `specs` 表挂在分岔点上（类型、所在分岔点、方向角、距离、尺寸）。房间是底部被压平的椭球，门开在地板边缘、朝向分岔点。最后一行是第一个分岔点旁、大石块下的向阳育幼室
- 侧入口接到第二个分岔点；另有 3 条盲端隧道作为挖掘工作面（`DigFace`，开局已挖出一段，之后会继续延长）
- 用 Floyd 算法算出所有节点对之间的下一跳（`nextHop`）；节点增减或移动后重算
- 生成后，`World` 把距离半径大于 3 的石块 3 cm 以内的房间标记为 `underStone`

## 渲染层要点
- **地下透视**：`Terrain.setXray` 让地表变透明；`NestView.setXray` 切换蚁穴与地表洞口的可见性；`AntView`、`ItemView` 的 `xray` 决定是否显示巢内的蚂蚁和物品
- **实例容量**：工蚁 `maxPopulation + 50`；物品各类有固定上限（见 `itemView.ts`）
- **蚂蚁细节层级**：`AntView` 有完整和简化两套工蚁实例网格，每帧按离相机的距离（`ant.lodDistance`）分配，共用同一个步态材质；简化网格不投影
- **地形高度**：`Terrain.heightAt` 在网格建好后查 0.5 cm 间距的高度表，模拟里所有地表高度都走这里；`exactHeight` 只用来建表
- **阴影**：方向光的阴影相机 ±45 单位，跟随视点前方的地面点

## 扩展指南

**新增一个任务**
1. 在 `routines.ts` 写一个 `function*`，用 `yield` 下达指令
2. 在对应职别的协程里按优先级调用它
3. 取物品前先设置 `claimedBy`，到达后用 `stillMine` 确认；放弃任务时释放认领
4. 设置 `a.activity`（信息面板显示）；关键事件用 `a.note(w, ...)` 记进个体日志

**新增一个职别**
1. 在 `config.ts` 的 `Role`、`ROLE_NAMES`、`ROLE_COLORS` 里补充
2. 在 `routineFor` 加分支，并在 `hud.ts` 的 `ROLE_DESC` 加说明
3. 在 `Colony.init` 的分配比例里加入

**新增一种房间**
1. 在 `ChamberType` 和 `CHAMBER_INFO` 中补充
2. 在 `Nest.generate` 的 `specs` 里加一行，并在 `nestView.ts` 的 `CHAMBER_TINT` 里设颜色
3. 注意同一深度的房间方向角至少相差约 90°，否则会重叠
4. 想让扩建也能生成这种房间：在 `NestExpansion.plan` 的类型选择里加入
5. 运行中新增的房间要调用 `Colony.ensureChamberSlots`（扩建流程已处理）

**新增一种食物源**：在 `food.ts` 的 `FoodSourceType`、`SOURCE_INFO`、`buildMesh` 中补充；想让玩家能投放，再加进 `PLACEABLE_FOOD`。

**新增会变化的模拟状态**：在所属类的 `toSave` / `restore` 里补上（或新增一对方法并在 `world/save.ts` 中调用）；结构不兼容时把 `SAVE_VERSION` 加 1；只是新增一项时可以像 `predators` 那样设为可选字段，旧存档缺这一项就沿用新世界的初始状态。用 `npx tsx scripts/savetest.ts` 检查读档前后指标一致。

**新增一种干预工具**：在 `World` 写一个带 `dry` 参数、返回 `ToolResult` 的方法，然后在 `tools.ts` 的 `TOOLS` 里加一项（名称、按键、选项），并在 `ToolController.apply` / `hover` 里调用。

**新增一种物品**：在 `items.ts` 的 `ItemType`、`ITEM_NAMES` 和 `itemView.ts` 的图层中补充。

## 验证工具

### 无界面模拟
```
npx tsx scripts/simtest.ts [模拟秒数，默认 1200]
```
每 1/8 进度输出一次：人口、巢外数量、储食室与社会胃、幼体数、各职别实际/目标人数、蛹的位置、拥挤度、房间数、扩建进度、每个蚜虫群（数量、`*` 表示已被发现、积存蜜露）、两种信息素总量、累计统计、平均每步耗时，以及当前最常见的 12 种行为。第一行的每步耗时包含 JIT 预热，偏高属于正常。

在 PowerShell 里重定向输出会变成 UTF-16 乱码，用 `cmd /c "npx tsx scripts/simtest.ts 6000 > shots\simtest.txt"` 保留 UTF-8。

### 截图验证
1. 启动开发服务器：`npm run dev`
2. 用无头 Chrome（Agent 环境下用 `rea` 工具的 `capture_browser_scenario`）打开页面，配合 URL 参数定位视角，按键用 `press` 动作，截图选 `at_end: ["screenshot"]`
3. 每次只截一张图，多张截图会超出工具的返回上限
4. 提取图片：`node scripts/extract-shots.mjs <捕获结果文件> shots/名称`（`shots/` 已加入 .gitignore）
5. 无头 Chrome 用软件渲染，帧率很低：等 `#loading` 消失后再等 8–10 秒，否则界面面板可能还没刷新。用了 `skip` 时加载本身也要十几秒

常用视角（坐标按默认地图测得；新开局会随机换地图，截图时加 `seed=20261021`）：

| 用途 | URL |
|---|---|
| 俯瞰全巢（扩建中） | `?cam=-50,6,-55,0,-36,0&view=xray&skip=1500` |
| 蚁后室特写（自动透视） | `?cam=11,-41,-4,1.9,-50,-14` |
| 向阳育幼室与蛹（中午） | `?select=chamber:10&fly=1&view=xray&hour=15&skip=900` |
| 蚜虫植物面板 + 统计曲线 | `?select=plant:0&fly=1&view=stats&hour=11&skip=1200` |
| 爬茎的觅食蚁特写 | `?cam=-7,10,33,-15,6,26&view=roles&hour=11&skip=1300` |
| 跟随蚁后 | `?select=ant:1&follow=1` |
| 高空看信息素 | `?cam=0,150,95,0,0,-10&view=pheromone&hour=12&skip=1200` |
| 夜景 | `?hour=21.5` |

房间坐标由地图种子决定（`new World()` 用默认种子 `CONFIG.seed`）。改动生成代码后，可以用下面的命令重新打印：
```
npx tsx -e "import { World } from './src/world/world'; const w = new World(); for (const c of w.nest.chambers) console.log(c.id, c.name, c.floor.toArray().map(v=>v.toFixed(1)).join(','))"
```

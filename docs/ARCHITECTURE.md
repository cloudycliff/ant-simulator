# 架构说明

## 目录结构

```
index.html              页面骨架（各面板的容器）
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
    colony.ts           Colony：种群、物品、幼体发育、食物储备、死亡、统计
    items.ts            Item：卵/幼虫/蛹/食物/垃圾/土粒/尸体
  world/
    world.ts            World：组装所有模拟子系统，按固定步长推进
    terrain.ts          解析式高度场、蚁丘、草被密度、地形网格
    vegetation.ts       草（风动着色器）、石块、落叶、枯枝、植物；地表避障圆与空间网格
    food.ts             食物源类型、生成、网格
    pheromone.ts        信息素网格（沉积、挥发、采样）与热力图叠加层
  nest/
    nest.ts             蚁穴数据：节点、隧道、房间、入口；程序化生成；寻路
    nestView.ts         蚁穴网格：背面渲染的房间与隧道、土壤剖面墙、入口洞口
  render/
    antView.ts          蚂蚁几何体、步态着色器、实例化更新、选中标记
    itemView.ts         物品的实例化渲染
    environment.ts      天空、日月、半球光、观察灯、雾、星空
  ui/
    camera.ts           自由飞行 / 跟随相机、平滑飞向目标
    picking.ts          点选（蚂蚁屏幕空间 + 物体射线）
    hud.ts              顶栏、蚁群概况、信息面板、事件列表、帮助
scripts/
  simtest.ts            无界面模拟测试
  extract-shots.mjs     从浏览器捕获结果中提取截图
docs/                   本文档目录
```

## 主循环

```
requestAnimationFrame
 ├─ world.advance(dt)           按倍速累积时间，按固定步长 1/30 秒逐步 tick
 │    └─ tick: clock → colony.update → food.update → pheromone.update
 ├─ controller.update(dt)       相机
 ├─ 判断是否需要强制透视        相机在地下，或跟随的蚂蚁在巢内
 ├─ antView / itemView.update   把模拟状态写进实例矩阵
 ├─ env.update                  光照随时刻变化，阴影跟随视点
 ├─ 每 0.4 秒刷新信息素热力图（开启时）
 ├─ 每 0.25 秒刷新界面
 └─ renderer.render
```

## 模拟层

### Colony.update(dt) 的顺序
1. 蚁后的产卵额度按 `eggsPerDay × 饱食系数` 累积
2. 逐只蚂蚁：增加日龄和饥饿 → 判断死亡（衰老、饥饿、地表意外）→ `ant.update`
3. 幼体发育（`updateBrood`）
4. 储食变质（`updateStores`）
5. 地表物品分解（`updateSurfaceItems`）

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
| `wait {time}` | 原地停留 |

**行为层**（`routines.ts`）。每个职别一个入口协程，按优先级（带随机性）选择一项任务：

| 职别 | 任务优先级 |
|---|---|
| 蚁后 | 在蚁后室漫游 → 有产卵额度时产卵 |
| 保育蚁 | 进食 → 把蚁后室的卵搬到卵室 → 帮助待羽化的蛹破茧 → 搬运需要换房间的幼体 → 喂蚁后 → 喂饥饿的幼虫 → 侍奉蚁后（18%）/ 清洁幼体 |
| 内务蚁 | 进食 → 搬尸体到巢外垃圾堆 → 把其他房间的垃圾搬进垃圾室 → 垃圾室满 4 份后运出巢外 → 挖掘（45%）/ 白天在入口警戒（25%）/ 巡视房间 |
| 觅食蚁 | 进食（仅在储备大于 1 份时）→ 夜间或地表低于 8°C 时休息 → 储备充足时留巢 → 出巢搜索 → 取食 → 返巢释放信息素 → 存入储食室 |

### 物品的位置状态（`Item.place`）

`chamber`（房间内，索引在 `byChamber[id]`）、`node`（隧道节点，`nodeItems`）、`surface` / `midden` / `mound`（地表，`surfaceItems`）、`carried`（被携带，`Ant.carrying`）、`gone`（已销毁）。

改变物品位置时必须通过 `Colony` 的方法（`addToChamber`、`dropAtMidden`、`dropOnMound`、`dropOnSurface`、`dropAtNode`、`pickUp`、`release`、`destroy`），这样各个索引才能保持一致。

### 蚁穴生成（`Nest.generate`）
- 主竖井从主入口出发，经过 7 个分岔点向下蜿蜒，深度分别为 6、9、21、34、48、62、76 cm
- 房间按 `specs` 表挂在分岔点上（类型、所在分岔点、方向角、距离、尺寸）。房间是底部被压平的椭球，门开在地板边缘、朝向分岔点
- 侧入口接到第二个分岔点；另有 3 条盲端隧道作为挖掘工作面
- 开局用 Floyd 算法算出所有节点对之间的下一跳（`nextHop`）

## 渲染层要点
- **地下透视**：`Terrain.setXray` 让地表变透明；`NestView.setXray` 切换蚁穴与地表洞口的可见性；`AntView`、`ItemView` 的 `xray` 决定是否显示巢内的蚂蚁和物品
- **实例容量**：工蚁 `maxPopulation + 50`；物品各类有固定上限（见 `itemView.ts`）
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

**新增一种食物源**：在 `food.ts` 的 `FoodSourceType`、`SOURCE_INFO`、`buildMesh` 中补充。

**新增一种物品**：在 `items.ts` 的 `ItemType`、`ITEM_NAMES` 和 `itemView.ts` 的图层中补充。

## 验证工具

### 无界面模拟
```
npx tsx scripts/simtest.ts [模拟秒数，默认 1200]
```
每 1/8 进度输出一次：人口、巢外数量、储备、幼体数、累计统计、信息素总量、平均每步耗时，以及当前最常见的 10 种行为。第一行的每步耗时包含 JIT 预热，偏高属于正常。

### 截图验证
1. 启动开发服务器：`npm run dev`
2. 用无头 Chrome（Agent 环境下用 `rea` 工具的 `capture_browser_scenario`）打开页面，配合 URL 参数定位视角，按键用 `press` 动作，截图选 `at_end: ["screenshot"]`
3. 每次只截一张图，多张截图会超出工具的返回上限
4. 提取图片：`node scripts/extract-shots.mjs <捕获结果文件> shots/名称`（`shots/` 已加入 .gitignore）

常用视角：

| 用途 | URL |
|---|---|
| 俯瞰全巢（需按 `X`） | `?cam=60,12,45,0,-38,0` |
| 蚁后室特写（自动透视） | `?cam=11,-41,-4,1.9,-50,-14` |
| 跟随蚁后 | `?select=ant:1&follow=1` |
| 高空看信息素（需按 `P`） | `?cam=0,75,70,0,0,-5` |
| 夜景 | `?hour=21.5` |

房间坐标由固定种子决定。改动生成代码后，可以用下面的命令重新打印：
```
npx tsx -e "import { World } from './src/world/world'; const w = new World(); for (const c of w.nest.chambers) console.log(c.id, c.name, c.floor.toArray().map(v=>v.toFixed(1)).join(','))"
```

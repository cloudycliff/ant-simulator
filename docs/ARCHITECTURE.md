# 架构说明

## 目录结构

```
index.html              蚂蚁游戏的页面骨架（各面板的容器）；Vite 的源码模板，不能直接双击运行
aquarium.html           鱼缸示例的页面骨架（同样的容器，没有主屏幕清单）
cyber-ant-farm.html     构建生成的单文件发布版，双击即可运行（不要手改）
vite.config.ts          构建配置：默认构建 index.html，--mode aquarium 构建 aquarium.html；singleFile 插件把产物内联成单个 HTML，蚂蚁游戏的再复制到根目录
src/
  main.ts               入口：把蚂蚁游戏模块交给 runApp
  aquarium.ts           鱼缸示例的入口
  style.css             界面样式
  assets/icon.svg       图标原稿；网页小图标在构建时内联进 HTML
  core/                 —— 框架层：同类模拟游戏可以复用，不能导入 games/（见 scripts/core/layercheck.mjs）——
    config.ts           ENGINE：主循环步长与帧预算、后台运行、画质档位与帧率、自动保存间隔
    util/
      random.ts         Rng（可设种子、可存档的随机数）、Noise2D（梯度噪声、分形噪声）
      math.ts           clamp / lerp / smoothstep / wrapAngle 等
    i18n/
      index.ts          Text（延迟翻译的文字）、L / t / tr、当前语言；Messages（所有键，游戏用声明合并补充）、registerDicts
      zh.ts / en.ts     框架用到的文字（外壳的按钮、提示、帮助、存档面板、画质、时刻）；游戏可以改写其中几条（registerDicts 的 overrides）
    platform/
      device.ts         识别手机和平板的浏览器
      install.ts        添加到主屏幕（安卓弹安装框、iOS 给提示）；注册离线缓存脚本
      background.ts     后台运行：页面隐藏时用 Worker 节拍继续推进模拟
      lang.ts           选择界面语言（网址参数、上次的选择、浏览器语言）与切换
      saveSlot.ts       SaveSlot：localStorage 里的一个存档位（完整存档 + 一份小摘要），存档和摘要的类型由游戏给出
    sim/                不依赖 WebGL 和 DOM
      simulation.ts     Simulation：模拟内核。时钟、随机数 rng、编号 ids、按登记顺序每步推进的子系统、存档登记、最近事件、advance（固定步长、帧预算、实际倍速）
      ids.ts            IdPool：每类对象各自的编号计数，归世界所有并进存档
      saves.ts          SaveRegistry：存档的各部分（字段名、保存、恢复、是否可选），读档按登记顺序恢复；`addLast` 的部分最后恢复
      entities.ts       EntityRegistry：每类对象的位置、相机观察距离、能否跟随、读档后编号是否还对得上；选中、飞过去、跟随、事件定位都查它
      events.ts         EventLog：最近事件（时刻、文字、涉及的对象、位置），对象的位置由游戏提供
      clock.ts          SimClock：游戏日、时刻、昼夜；一天多长、几点开局由游戏传入
      spatial.ts        SpatialHash：每步重建的均匀网格，用于近邻查询；放什么由游戏定（有 pos 和 alive 即可）
    render/
      environment.ts    天空、日月、半球光、观察灯、雾、星空；阴雨时变灰变暗；光照强度由游戏传入
      rain.ts           雨丝：跟随相机的循环下落线段；注视点周围地面溅起的水圈
      quality.ts        画质档位（像素比、阴影贴图）与帧率上限；“自动”持续卡顿时降档，暂停没操作时降帧
    move/               运动方式，不依赖 DOM
      graph.ts          图上行走：Routes（所有节点对的最短路）、GraphWalker（在哪条边上、走了多远、一跳一跳走向目标）、折线边取点、圆管隧道底部的落脚点
      surface.ts        地表运动：限速转向、贴合地面、Skirt（沿圆形障碍绕行，被困时反向）
    space/
      space.ts          Space：相机能去的范围、某处的表面高度、视线和表面的交点；相机、点选、工具都通过它
      heightfield.ts    HeightfieldSpace：一张高度场的地面（沿视线步进再二分求交点）
      volume.ts         VolumeSpace：一个盒子（鱼缸、饲养箱）。从上方看点在顶面，隔着侧壁看点在底面，看向水中没碰到底面时取视线在盒中那段的中点
    ui/
      camera.ts         自由飞行 / 跟随相机、平滑飞向目标；鼠标和触屏手势（单指平移、双指缩放旋转俯仰、点按与双击）分开处理；离地高度和活动范围取自 Space
      tools.ts          ToolController：当前工具与选项、放置预览圈（绿 / 红）、触屏先记下 pending 位置；工具做什么由游戏的 run 决定
      chart.ts          drawChart：按天的折线图
      html.ts           面板 HTML 的小工具（进度条、颜色、首字母大写、转义、“多久以前”）
    app/
      game.ts           GameModule（游戏声明：标题、相机、存档、空间、mount）与 GameSession（场景对象、视图开关、工具、点选、每帧更新、面板内容）
      shell.ts          Shell：界面外壳。顶栏（状态、性能、画质、帮助、存档、语言、GitHub，速度、后台运行、视图、工具）、主面板、信息面板、事件列表、帮助、统计、图例、工具面板；手机布局（一行顶栏 + 底栏 + 抽屉）
      app.ts            runApp：启动（语言、渲染器、相机、读档）、选中与跟随、按键、网址参数、自动保存、后台运行、主循环
  games/ant/            —— 蚂蚁游戏的内容 ——
    game.ts             antGame：蚂蚁游戏模块；mount 搭场景、登记透视 / 信息素 / 分工着色 / 草丛四个视图开关、每帧同步视图
    config.ts           配置与常量（职别名称、颜色）；调参优先改这里。导入它时顺带登记游戏的词典
    space.ts            createSpace：把地形高度场和相机范围包成 Space
    i18n/
      index.ts          把游戏的键并进 Messages，登记词典
      overrides.ts      改写的框架文字（提示里说“蚂蚁”“蚁群”的几条）
      zh.ts             中文词典，也是游戏所有键的来源
      en.ts             英文词典（单复数等写成函数）
    sim/                —— 模拟层，不依赖 WebGL ——
      ant.ts            Ant：个体状态 + 运动层（执行指令）
      routines.ts       行为层：各职别的任务协程
      colony.ts         Colony：种群、物品、幼体发育、食物储备、死亡、分工评估、接触、蛹的温度调节、统计历史
      items.ts          Item：卵/幼虫/蛹/食物/垃圾/土粒/尸体
      expansion.ts      NestExpansion：拥挤度、规划新房间、分配挖掘工作面、推进隧道和房间的挖掘
    world/
      world.ts          World（继承 Simulation）：组装所有模拟子系统，登记每步的更新顺序和存档的各部分；房间温度（含石块加温）
      entities.ts       GameRef（能选中、能出现在事件里的对象）与各类对象在实体注册表里的登记
      soil.ts           Soil：土壤温湿度模型（随深度衰减的日较差、阴雨降温、地面湿润）
      terrain.ts        解析式高度场、蚁丘、草被密度、地形网格
      vegetation.ts     草（风动着色器）、石块、落叶、枯枝、植物（含 4 株寄主植物）；地表避障圆与空间网格
      food.ts           食物源类型、生成、网格
      aphids.ts         蚜虫群：附着在植物茎秆上，增殖、蜜露积存、实例化网格
      predators.ts      天敌：狼蛛（游荡、扑击、进食、离开的状态机）与蚁狮陷阱（松沙区、坑底捕食）；网格与存档
      alarm.ts          警报信息素：短暂的点源列表，浓度查询；信息素视图下画成红圈
      weather.ts        天气：晴 / 转阴 / 下雨的阶段与雨势、云量、地面湿润度；积水洼、浅层房间进水；入口封堵任务的分配
      water.ts          玩家浇出的水洼：贴地网格、蒸发收缩、冲刷信息素；同时登记为“软”避障圆
      save.ts           存档格式 SaveData、版本与种子检查、蚂蚁游戏的存档位和摘要；各部分由 World 登记
      pheromone.ts      信息素网格（路径 + 领地足迹两个通道）与热力图叠加层
    nest/
      nest.ts           蚁穴数据：节点、隧道、房间、入口、挖掘工作面；程序化生成；寻路；扩建用的几何操作
      nestView.ts       蚁穴网格：背面渲染的房间与隧道、土壤剖面墙、入口洞口与土塞、房间积水；每帧 sync 跟随蚁穴变化
    render/
      antView.ts        蚂蚁几何体、步态着色器、实例化更新、选中标记
      itemView.ts       物品的实例化渲染
    ui/
      panels.ts         外壳里的蚂蚁内容：顶栏状态（天气、地表温湿度）、蚁群概况、统计曲线、信息素图例、帮助条目、两个底栏图标
      info.ts           信息面板：10 类对象各一个（类型检查保证不漏）
      picking.ts        点选（蚂蚁屏幕空间 + 物体射线，容差可调，触屏 32 像素）
      tools.ts          干预工具的定义（名称、按键、选项）和执行（调用 World 的干预方法）
  games/aquarium/       —— 鱼缸示例：检验框架边界的最小游戏（DECISIONS T-056）——
    game.ts             aquariumGame：开局视角随屏幕比例退远、体积空间、喂食和敲玻璃两个工具、玻璃 / 气泡 / 饥饿着色三个视图开关、点选、面板内容
    config.ts           鱼缸尺寸、灯的开关时刻、鱼食、三种鱼（霓虹灯鱼、神仙鱼、鼠鱼）的参数
    tank.ts             Tank（继承 Simulation）：鱼群（对齐、聚拢、分离、找鱼食、水层、避开缸壁和石头）、鱼食（漂浮、下沉、沉底、变质）、开关灯和吃完等事件、每小时统计、存档
    view.ts             TankView：房间、底沙、石头、水草（会摆动，可点选）、每种鱼一组实例化网格（尾巴摆动、饥饿着色）、鱼食、气泡、水和玻璃、灯光
    i18n/               鱼缸的词典和改写的框架文字
public/                 原样复制到 dist/ 的网页版文件：manifest.webmanifest、sw.js（离线缓存）、主屏幕图标
scripts/
  check.mjs             一键检查（npm run check / check:fast / check:ui），见“验证工具”一节
  i18ncheck.ts          界面文字检查：两个游戏和框架的中英文占位符一致，游戏的键不和框架重名，框架代码只用框架的键，改写不改占位符，英文模拟中没有漏翻的文字
  core/
    layercheck.mjs      依赖方向检查：core 不能导入 games 和 main.ts，游戏之间不能互相导入
    coretest.ts         框架层单元测试：图上行走、地表转向与绕行、高度场和体积空间求交、存档登记、实体注册表、事件记录、模拟内核的推进、词典重名
  games/ant/            蚂蚁游戏的无界面测试，失败时退出码非零
    simtest.ts          无界面模拟测试
    baseline/           simtest 在固定编号下的输出，check.mjs 拿它逐行对比
    savetest.ts         存档往返测试：存档 → 读进新世界 → 对比指标与索引一致性 → 两边各自继续运行
    tooltest.ts         干预工具测试：投食、放树枝和石块、浇水、各种非法放置，统计原地打转的蚂蚁
    defensetest.ts      防御测试：在觅食路线上、巢口旁、侧入口外各放一只狼蛛，记录围攻、驱赶和入口警戒
    weathertest.ts      天气测试：招来一场雨，记录返巢、封堵、信息素冲刷、进水和雨后重开
    perftest.ts         性能测试：指定工蚁数量，统计每步耗时、各子系统占比和慢步
  games/aquarium/
    aquatest.ts         鱼缸示例的无界面检查：鱼不出缸、喂食后会吃、开关灯和吃完的事件、存档往返、同编号可重现、英文文字
    aquashots.mjs       鱼缸示例的截图（桌面、手机）：白天、夜里、选中的鱼、饥饿着色、统计、英文、喂食、手机抽屉
  ui/                   无头 Chrome 里的页面测试（需要开发服务器，pwatest 需要先构建）；cdp.mjs 是共用的连接代码，环境变量 CHROME 指定浏览器
    saveui.mjs          页面里的存档往返：Ctrl+S 保存，重新打开后从存档恢复；页面标题随语言变化
    selecttest.mjs      页面里的选中、跟随、按 F 取消、飞到房间、点击事件飞过去
    touchtest.mjs 等    见“验证工具”一节
  tools/
    extract-shots.mjs   从浏览器捕获结果中提取截图
    icons.mjs           从 src/assets/icon.svg 生成 public/ 下的主屏幕图标
.github/workflows/check.yml  推送和拉取请求时在 GitHub Actions 上跑 npm run check（不含浏览器测试）
docs/                   本文档目录；FRAMEWORK.md 讲怎样用框架做新游戏，templates/ 是新项目的文档骨架
```

## 分层

`src/core` 是框架层，打算给同类产品（蜂巢、白蚁、鱼缸、地表生态）复用；`src/games/ant` 是蚂蚁游戏的内容。依赖只能从游戏指向框架：`core` 不能导入 `games/` 和 `main.ts`，一个游戏也不能导入另一个游戏。`node scripts/core/layercheck.mjs` 检查这一点。框架需要游戏给的数值和类型时，由游戏在构造时传入（`SimClock` 的日长、`Environment` 的光照强度、`SpatialHash<T>`、`SaveSlot<D, M>`、`EntityRegistry` 里每类对象的位置和观察距离、相机和点选用的 `Space`），而不是框架去读游戏的配置。临时绕不开的依赖可以登记在脚本的 `PENDING` 里，拆掉后要删掉，列着却已经不存在的项也会报错。分层的计划见 DECISIONS T-049 到 T-056。改了 `core` 要跑框架层单元测试 `npx tsx scripts/core/coretest.ts`。

### 游戏模块与界面外壳

`main.ts` 只有一行 `runApp(antGame)`。一个游戏是一个 `GameModule`（`core/app/game.ts`）：标题、相机参数和开局视角、`create(seed)` 建世界、存档的读写和摘要、`space(world)`、`mount(ctx)`。`runApp` 负责和游戏无关的部分：语言、渲染器、相机控制、读档和自动保存、选中 / 飞过去 / 跟随（查实体注册表）、按键、网址参数、后台运行、画质、主循环；`mount` 把场景对象加进去，返回一个 `GameSession`：

- `views`：视图开关（名字、按键、网址参数 `?view=` 用的名字、手机底栏的图标、当前状态、切换）。顶栏、视图面板、按键都按这张表生成；`syncViews` 在任何开关变化后调用一次
- `tools`：`ToolController` 或 `null`（没有工具的游戏不显示工具栏）
- `pick(x, y, 容差)`：屏幕点选，返回实体引用
- `update(dt, frame)`：每帧同步视图，`frame` 给出时间、注视点、选中对象、是否在跟随
- `ui`：外壳里由游戏填的内容。顶栏状态、性能行后缀、主面板（手机底栏第一个按钮）、未选中时的提示、信息面板、统计（可选，有就多一个 T 键开关）、图例（可选）、帮助条目
- `onSelect`、`onToolApplied`、`action`（外壳不认识的按钮，如信息面板里的“移除”）、`applyParams`（游戏自己的网址参数）

信息面板是 `InfoPanels<R>`：实体的每一种 `kind` 一个函数，少登记一种时编译报错。外壳 `Shell`（`core/app/shell.ts`）保留原来的 DOM 结构和 id（`#colony` 是主面板，抽屉名仍叫 `colony`），浏览器测试不用改；`window.hud` 现在就是 `Shell`。框架代码只能用框架词典里的键，`i18ncheck` 会检查。

配置也分两份：`src/core/config.ts` 的 `ENGINE` 是框架的（主循环、后台运行、画质、自动保存），`src/games/ant/config.ts` 的 `CONFIG` 是蚂蚁游戏的。

### 第二个游戏：鱼缸示例

`src/games/aquarium` 是用来检验框架边界的最小游戏（约 1200 行，含两份词典），页面是 `aquarium.html`，线上地址 `/aquarium.html`。它只用 `core`，没有改动蚂蚁游戏。和蚂蚁游戏不同的地方：

- **空间**：`VolumeSpace`（盒子 + 底沙高度场）代替 `HeightfieldSpace`
- **光照**：不用 `core/render/environment.ts`（那是户外的天空和太阳），鱼缸自己放一盏顶灯、一盏夜里的蓝光和半球光，`shadowLight` 交给外壳调阴影
- **点选**：自己写，鱼和鱼食按屏幕距离，水草按射线
- **不能添加到主屏幕**：`installable` 没设，外壳不注册离线缓存、不显示安装按钮
- **开局视角**：`camera.pose` 是宽高比的函数，竖屏时退远把整个缸装下

一个页面只加载一个游戏：两个游戏的词典有同名的键（`help.click` 等），同时登记会报错。`i18ncheck` 直接导入两份词典文件做静态检查，鱼缸的英文模拟文字在 `aquatest` 里查。

## 主循环

```
requestAnimationFrame
 ├─ world.advance(dt, 10 ms)    按倍速累积时间，按固定步长 1/30 秒逐步 tick；超过帧预算就丢掉剩余时间
 │    └─ tick: clock → 按 World 构造时登记的顺序：weather → colony → predators → alarm → food → aphids → water → pheromone
 ├─ controller.update(dt)       相机
 ├─ tools.hover                 工具预览圈
 ├─ session.update(dt, frame)   蚂蚁游戏（games/ant/game.ts）：
 │    ├─ 判断是否需要强制透视        相机在地下，或跟随的蚂蚁在巢内
 │    ├─ aphids.sync / nestView.sync 蚜虫数量或蚁穴结构变化时更新网格（按 rev 判断，未变化时几乎无开销）
 │    ├─ predators.sync              狼蛛位置与腿部动画、蚁狮大颚与猎物
 │    ├─ alarm.sync                  信息素视图打开时更新警报红圈
 │    ├─ antView / itemView.update   把模拟状态写进实例矩阵
 │    ├─ env.update                  光照随时刻变化，阴影跟随视点
 │    └─ 每 0.4 秒刷新信息素热力图（开启时）
 ├─ 每 0.25 秒刷新界面（Shell.refresh）
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

和物种无关的部分在 `core/move/`：隧道里的位置是 `Ant.walk`（`GraphWalker`，`Ant.edge` 是它的 `edge`），`goto` 每步调用 `walk.advance`，再用 `tunnelFloor` 按靠右通行的偏移放到隧道底部；地表的转向、贴地和绕障碍用 `turnToward`、`alignToGround`、`Skirt`。蚁狮陷阱、水洼、信息素、活动范围这些蚂蚁游戏的规则仍写在 `Ant.surfaceMove` 里。白蚁、蜂巢这类游戏可以直接用这两个模块，只需提供自己的图（`NavGraph`：`nextHop`、`edgeBetween`）。

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

`dropFood`、`placeObstacle`、`removeObstacle`、`removePlacedById`、`pourWater`、`placePredator`、`removePredator`、`removePredatorById` 都返回 `ToolResult {ok, msg}`，成功时把 `msg` 记进最近事件（`World.events.push`）。传 `dry = true` 只做检查不改动世界，界面用它决定预览圈的颜色。合法性检查集中在 `World.checkSpot`：活动范围、离入口的距离、与石块 / 植物 / 水洼 / 食物是否重叠。

界面层（`core/ui/tools.ts` 的 `ToolController`）只负责选工具和给出地面点，执行交给游戏传入的 `run`（`games/ant/ui/tools.ts`），由它调用这些方法。玩家放的障碍物记在 `Vegetation.placed`，移除时整张避障网格重建；自然生成的石块和植物不能移除。

天敌（`world/predators.ts`）：`PredatorManager.update` 在蚁群之后运行，先收集地表上没在爬植物的工蚁，再推进狼蛛的状态机（`wander → chase → feed → pause`，到时间或吃够后 `leave`）和蚁狮。捕食调用 `Colony.kill(ant, cause, false)`（不留尸体），进食结束再用 `dropOnSurface` 放下空壳。蚁狮陷阱对蚂蚁的影响写在 `Ant.surfaceMove` 里（`pitAt` 减速、拉向中心、`pitT` 计时后转身外爬）。设计见 DECISIONS T-028。

防御（DECISIONS T-029）：`Ant.update` 在 `hold` 之后、执行协程之前检查警报（`checkAlarm`），增援期间由 `Ant.defend` 接管运动，协程和当前指令原样保留，结束后接着执行。撕咬中的工蚁把 `mobTarget` 设为狼蛛编号，`PredatorManager.mobbed` 据此统计围攻数并结算驱赶和反咬。`PredatorManager.threatEntrance` / `guardsOut` 每步更新，`routines.ts` 里觅食蚁出巢前和内务蚁选任务时读取它们。

天气（DECISIONS T-030）：`WeatherSystem.update` 在每个 tick 最先运行，把云量、湿润度、雨势写进 `Soil`、`PheromoneField.rain`，并更新各房间的 `Chamber.wet`。阶段切换时调用 `Colony.seekShelter` 中断地表工蚁；`Colony.newRoutine` 在 `weather.keepIn` 时给地表工蚁安排躲雨。入口封堵程度是 `Entrance.plug`，由内务蚁的 `plugEntrance` 协程通过 `WeatherSystem.workPlug` 修改，`Ant.stepExit` 只走没封死的入口；全部封死时带 `giveUp` 的 `exit` 指令以结果 `'blocked'` 结束，由协程决定怎么处理手里的东西（T-036）。雨后的分批出巢由 `WeatherSystem.damp` 控制。

地表避障：`Vegetation.obstacleAt(x, z, pad, solid)`。水洼也登记为避障圆（`kind: 'water'`），放置检查能看到它；移动时传 `solid = true` 跳过水洼，水洼由 `Ant.surfaceMove` 单独处理（先绕行，绕不开就蹚水）。

### 存档（`world/save.ts`）

页面启动时 `runApp` 先 `create(seed)`（即 `new World(seed)`），有存档就 `loadWorld` 套上去，然后才创建视图。存档放在 `saveSlot`（`SaveSlot<SaveData, AntSaveMeta>`，键 `cyber-ant-save`），摘要由 `saveMeta` 生成。`saveWorld` 是存档头（版本、种子、保存时间）加上 `World.saves` 登记的各部分，`loadWorld` 检查版本和种子后按登记顺序恢复。读档顺序：时钟 → 蚁穴结构 → 玩家障碍物 → 水洼 → 天敌 → 食物源 → 蚜虫群 → 信息素 → 蚁群（蚂蚁、物品、扩建工程）。蚁群必须最后恢复，因为蚂蚁的位置和物品所在的房间都引用蚁穴的节点和房间编号。设计取舍见 DECISIONS T-027。

### 主循环与后台运行

页面可见时 `requestAnimationFrame` 每帧调用 `world.advance(dt, ENGINE.loop.frameBudgetMs)`，然后同步视图、渲染。页面隐藏时浏览器不再调用 `requestAnimationFrame`，开启了后台运行的话由 `BackgroundRunner` 接手：Worker 每 100 ms 发一次消息，主线程只推进模拟和自动保存，不同步视图也不渲染；视图都是对照当前状态同步的，回到页面后第一帧就能跟上。设计取舍见 DECISIONS T-042。手机和平板的浏览器会冻结后台页面（`BACKGROUND_LIMITED`），那里开关只给说明（T-046）。

每帧开头先问 `Quality.frame`：超过帧率上限（平时 60，省电 30，暂停 2 秒没操作 15）就跳过这一帧，什么都不做；`last` 只在真正画的帧更新，所以模拟时间不受影响。“自动”档统计满帧率时段的平均帧率，连续两个 3 秒都低于 40 就降一档。设计取舍见 DECISIONS T-047。

### 网页版：添加到主屏幕与离线

单文件构建不变：`vite.config.ts` 的插件把 JS、CSS 和 SVG 都内联进 `index.html`。`public/` 下的清单、`sw.js` 和 PNG 图标只给网页版用，Vite 原样复制到 `dist/`，双击打开的单文件里引用它们会失败，但不影响游戏。`sw.js` 联网时优先取网络、存一份，断网或 4 秒没响应时用缓存；改了缓存的文件列表要改 `CACHE` 的版本号。设计取舍见 DECISIONS T-048。

### 界面布局：桌面与手机

界面有两种布局：宽小于 700 或高小于 500 时 `Shell.updateMode` 给 `body` 加上 `compact`（横屏再加 `land`），`renderStatic` 改写成一行顶栏 + 底栏（`#dock`）+ 视图和工具两个选择面板（`#views`、`#toolbox`）；窗口尺寸变化时重新判断并重写界面。手机布局里各面板是“抽屉”，`Shell.sheet` 记着当前打开的那个，`body` 上的 `sheet-*`、`sheet-open`、`show-info`、`tooling` 决定谁显示，位置全部由 CSS 按 `--top`、`--dock`、`--rail` 等变量排（`Shell.layout` 每次刷新时写入）。统计、存档、帮助在手机布局里跟着抽屉开关。设计取舍见 DECISIONS T-045。

### 界面文字（`src/core/i18n` 与 `src/games/ant/i18n`）

模拟层产生的文字（`Ant.activity`、`Ant.log`、`World.events`、`ToolResult.msg`、房间和入口的 `label`、天气的 `label`、死因）都是 `Text`：只有键和参数，由界面用 `tr()` 按当前语言翻译。界面自己的文字直接用 `t(键, 参数)`。语言列表是 `LANGS`，菜单里的语言名在 `LANG_NAMES`；在语言菜单里选中后 `runApp` 调用 `chooseLang` 和 `Shell.relocalize`，并更新页面标题。

词典分两份：外壳和框架用到的在 `src/core/i18n/zh.ts`、`en.ts`（措辞不提蚂蚁），蚂蚁游戏的在 `src/games/ant/i18n/`。游戏想换掉框架的某条措辞（比如“先选中一只蚂蚁”），写进 `overrides.ts`，作为 `registerDicts` 的第二个参数；只能改写框架已有的键，占位符要和框架的一样（`i18ncheck` 检查）。所有键的类型是 `Messages`：框架只放自己的键，游戏在 `games/ant/i18n/index.ts` 里用声明合并（`declare module` + `interface Messages extends Record<keyof typeof zh, true>`）补上自己的，所以 `L` / `t` 照样能检查键写没写错；同一个文件在模块加载时调用 `registerDicts` 把两种语言的词典并进去，键和框架重名时报错。`games/ant/config.ts` 导入它，游戏的任何模块都会先读配置，所以第一次翻译之前词典一定已经登记。

增加语种：在 `Lang`、`LANGS`、`LANG_TAGS`、`LANG_NAMES` 里补上，框架和游戏各新建一份词典（`registerDicts` 的参数要求每种语言都有），再改 `initLang` 的浏览器语言匹配。设计取舍见 DECISIONS T-040、T-050。

### 蚁穴生成（`Nest.generate`）
- 主竖井从主入口出发，经过 7 个分岔点向下蜿蜒，深度分别为 6、9、21、34、48、62、76 cm
- 房间按 `specs` 表挂在分岔点上（类型、所在分岔点、方向角、距离、尺寸）。房间是底部被压平的椭球，门开在地板边缘、朝向分岔点。最后一行是第一个分岔点旁、大石块下的向阳育幼室
- 侧入口接到第二个分岔点；另有 3 条盲端隧道作为挖掘工作面（`DigFace`，开局已挖出一段，之后会继续延长）
- 用 Floyd 算法算出所有节点对之间的下一跳（`nextHop`，`core/move/graph.ts` 的 `Routes`）；节点增减或移动后重算
- 生成后，`World` 把距离半径大于 3 的石块 3 cm 以内的房间标记为 `underStone`

## 渲染层要点
- **地下透视**：`Terrain.setXray` 让地表变透明；`NestView.setXray` 切换蚁穴与地表洞口的可见性；`AntView`、`ItemView` 的 `xray` 决定是否显示巢内的蚂蚁和物品
- **实例容量**：工蚁 `maxPopulation + 50`；物品各类有固定上限（见 `itemView.ts`）
- **蚂蚁细节层级**：`AntView` 有完整和简化两套工蚁实例网格，每帧按离相机的距离（`ant.lodDistance`）分配，共用同一个步态材质；简化网格不投影
- **地形高度**：`Terrain.heightAt` 在网格建好后查 0.5 cm 间距的高度表，模拟里所有地表高度都走这里；`exactHeight` 只用来建表。蚁狮坑用 `Terrain.setDent` 只压低显示网格的顶点（信息素叠加层通过 `linkGeometry` 跟着变），`heightAt` 仍是原地面，坑里的高度由 `PredatorManager.liftAt` 叠加（T-037）
- **阴影**：方向光的阴影相机 ±45 单位，跟随视点前方的地面点

## 扩展指南

**新增一个任务**
1. 在 `routines.ts` 写一个 `function*`，用 `yield` 下达指令
2. 在对应职别的协程里按优先级调用它
3. 取物品前先设置 `claimedBy`，到达后用 `stillMine` 确认；放弃任务时释放认领
4. 设置 `a.activity = L('act.键', 参数)`（信息面板显示）；关键事件用 `a.note(w, L('note.键'))` 记进个体日志。新键在 `zh.ts` 和 `en.ts` 里都要加

**新增一个职别**
1. 在 `config.ts` 的 `Role`、`ROLE_NAMES`、`ROLE_COLORS` 里补充
2. 在 `routineFor` 加分支，并在两个词典里加 `role.职别` 和 `roleDesc.职别`
3. 在 `Colony.init` 的分配比例里加入

**新增一种房间**
1. 在 `ChamberType` 和 `CHAMBER_INFO` 中补充，并在两个词典里加 `chamber.类型` 和 `chamberDesc.类型`
2. 在 `Nest.generate` 的 `specs` 里加一行，并在 `nestView.ts` 的 `CHAMBER_TINT` 里设颜色
3. 注意同一深度的房间方向角至少相差约 90°，否则会重叠
4. 想让扩建也能生成这种房间：在 `NestExpansion.plan` 的类型选择里加入
5. 运行中新增的房间要调用 `Colony.ensureChamberSlots`（扩建流程已处理）

**新增一种食物源**：在 `food.ts` 的 `FoodSourceType`、`SOURCE_INFO`、`buildMesh` 中补充；想让玩家能投放，再加进 `PLACEABLE_FOOD`。

**新增会变化的模拟状态**：在所属类的 `toSave` / `restore` 里补上；新的子系统在 `World` 构造函数里用 `saves.add(字段名, 保存, 恢复)` 登记，并在 `SaveData` 里写上这个字段的类型。注意登记顺序就是读档顺序。结构不兼容时把 `SAVE_VERSION` 加 1；只是新增一项时登记为可选（`saves.add` 的第四个参数），旧存档缺这一项就沿用新世界的初始状态。新的子系统要每步更新的，用 `addSystem(名字, 更新函数)` 登记，`perftest` 会自动统计它的耗时。用 `npx tsx scripts/games/ant/savetest.ts` 检查读档前后指标一致。

**新增一种干预工具**：在 `World` 写一个带 `dry` 参数、返回 `ToolResult` 的方法，然后在 `games/ant/ui/tools.ts` 的 `TOOLS` 里加一项（名称、按键、选项），并在同一文件的 `run` 里调用。

**新增一个视图开关**：在 `games/ant/game.ts` 的 `views` 里加一项（按键、网址参数名、手机底栏图标可选），在 `syncViews` 里把状态应用到视图上；名字在游戏词典里加 `ui.名字`。

**新增一类可选中的对象**：在 `GameRef` 里加一种 `kind`，在 `entities.ts` 里登记位置，在 `info.ts` 里写它的信息面板（不写会编译报错），在 `picking.ts` 里让它能被点到。

**新增一种物品**：在 `items.ts` 的 `ItemType`、`ITEM_NAMES` 和 `itemView.ts` 的图层中补充。

**新增界面文字**：先在 `games/ant/i18n/zh.ts` 加键，再在 `en.ts` 加英文（不加会编译报错）；`core/` 里的代码用的文字加在 `core/i18n/` 里，不能用游戏的键。英文名词小写，需要单复数时写成函数；然后跑 `npx tsx scripts/i18ncheck.ts`。

## 验证工具

### 一键检查
```
npm run check         # 快检 + 模拟基线 + 蚂蚁游戏的无界面测试，约 3 分钟
npm run check:fast    # 只跑类型检查、依赖方向、框架单元测试、界面文字、鱼缸示例，约 10 秒
npm run check:ui      # 构建 + 浏览器测试 + 各屏幕布局截图，约 6 分钟；没开开发服务器时自己起一个
node scripts/check.mjs --all               # 全部
node scripts/check.mjs --update-baseline   # 模拟行为有意改变时，用这次的输出更新基线
```
每项一行“通过 / 失败、耗时、摘要”，失败的项接着打印输出的最后 30 行，有失败时退出码非零。模拟基线是默认世界跑 3000 秒的 `simtest` 输出，去掉耗时后必须逐行相同：只是重构时它应该不变；有意改了行为就加 `--update-baseline`，把基线文件的变化连同提交一起看，并把指标变化写进 `docs/PROGRESS.md`。GitHub Actions 上缺少基线文件时直接判失败。基线和 Node 的版本绑定：Windows 和 Linux 上同一版本逐行相同，Node 22 和 24 跑出来从第一个游戏日晚上起就不同了（数学函数的末位差异被放大）。CI 用 `.nvmrc` 里的版本，升级 Node 时要一起更新基线。

### 无界面模拟
```
npx tsx scripts/games/ant/simtest.ts [模拟秒数，默认 1200]
```
每 1/8 进度输出一次：人口、巢外数量、储食室与社会胃、幼体数、各职别实际/目标人数、蛹的位置、拥挤度、房间数、扩建进度、每个蚜虫群（数量、`*` 表示已被发现、积存蜜露）、两种信息素总量、累计统计、平均每步耗时，以及当前最常见的 12 种行为。第一行的每步耗时包含 JIT 预热，偏高属于正常。

同一个世界每次运行的结果都一样（除了耗时），重构前后可以直接对比输出；设环境变量 `SEED`（如 `$env:SEED=12`）换一个世界。

在 PowerShell 里重定向输出会变成 UTF-16 乱码，用 `cmd /c "npx tsx scripts/games/ant/simtest.ts 6000 > shots\simtest.txt"` 保留 UTF-8。

### 截图验证
1. 启动开发服务器：`npm run dev`
2. 用无头 Chrome（Agent 环境下用 `rea` 工具的 `capture_browser_scenario`）打开页面，配合 URL 参数定位视角，按键用 `press` 动作，截图选 `at_end: ["screenshot"]`
3. 每次只截一张图，多张截图会超出工具的返回上限
4. 无头 Chrome 的默认语言是 en-US，页面会显示英文；要看中文界面加 `?lang=zh`，或在 `environment.locale` 里指定 `zh-CN`
5. 提取图片：`node scripts/tools/extract-shots.mjs <捕获结果文件> shots/名称`（`shots/` 已加入 .gitignore）
6. 无头 Chrome 用软件渲染，帧率很低：等 `#loading` 消失后再等 8–10 秒，否则界面面板可能还没刷新。用了 `skip` 时加载本身也要十几秒

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
npx tsx -e "import { World } from './src/games/ant/world/world'; const w = new World(); for (const c of w.nest.chambers) console.log(c.id, c.name, c.floor.toArray().map(v=>v.toFixed(1)).join(','))"
```

### 触屏与鼠标操作、各种屏幕的截图
```
node scripts/ui/touchtest.mjs   # 390×844 手机视口 + 触屏模拟：平移、捏合、旋转、俯仰、点按、双击、工具两步放置、底栏与菜单、转横屏
node scripts/ui/mousetest.mjs   # 1280×800 桌面：拖拽、滚轮、工具直接放置；窗口变窄切到手机布局再切回
node scripts/ui/pwatest.mjs     # 先 npm run build：清单、图标、安装条件、离线缓存、断网刷新、主屏幕入口、双击打开的单文件
node scripts/ui/saveui.mjs      # 存档：Ctrl+S 保存、重新打开后恢复种子、蚂蚁数、房间数和时间；中英文页面标题
node scripts/ui/qualitytest.mjs # 画质：桌面和手机的默认档位、暂停降帧与操作唤醒、省电、人为卡顿后自动降档、选择记住
node scripts/ui/layoutshots.mjs [phone pad-land ant …] [--en]   # 手机 / 平板 / 桌面、横竖屏 × 几个场景的截图，存到 shots/layout/
```
需要先 `npm run dev`。脚本直接启动无头 Chrome（共用 `scripts/ui/cdp.mjs`），通过 DevTools 协议派发触摸和鼠标事件（`Input.dispatchTouchEvent` / `dispatchMouseEvent`），再读页面上的 `window.world`、`window.camera`、`window.controller`、`window.hud`（界面外壳 `Shell`）、`window.quality`、`window.renderer` 判断结果；手机浏览器用 `Emulation.setUserAgentOverride` 伪装。截图脚本还会列出超出屏幕的面板。测试会先藏起左右的面板，让手指落在画布上；点按和双击时暂停模拟，免得蚂蚁走开。触屏测试在 `shots/touch-tool.png` 留一张工具面板的截图。

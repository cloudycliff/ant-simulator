# 框架对外接口

`src/core` 里游戏可以用的东西，按文件列出：每个名字是什么、调用方要遵守什么、框架保证什么。怎样一步步做一个游戏见 [FRAMEWORK.md](FRAMEWORK.md)，各模块的实现细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

- **给游戏用的**是对外接口。**框架内部**是 `core` 自己的文件之间用的，游戏不要导入；改它们不必顾及游戏
- `node scripts/core/apicheck.mjs`（`npm run check` 的“接口说明”）检查三件事：`core` 的每个导出都在本文它所在文件的一节里出现；游戏导入的名字出现在“给游戏用的”部分；本文提到的文件都存在
- 改对外接口时，两个游戏一起改，并更新本文和 FRAMEWORK.md。只是新增（新的可选字段、新函数）不影响已有游戏

## 给游戏用的

### 模拟内核

#### `core/sim/simulation.ts`

- `Simulation<R>`：游戏世界的基类，`super(一天的秒数, 开局时刻, 种子)`。不依赖 DOM 和渲染，无界面测试直接 `new` 出来跑
  - `clock`、`rng`、`ids`、`saves`、`entities`、`events`，各自见下面的文件
  - `addSystem(name, update)`：登记每个模拟步调用一次的子系统，按登记顺序调用
  - `advance(realDt, budgetMs?, maxSteps?)`：推进现实时间 `realDt` 秒（乘以倍速），每步 `ENGINE.loop.fixedStep` 秒。一帧耗时超过 `budgetMs` 就丢掉没算完的时间，这时 `effectiveSpeed`（实际倍速）低于设定倍速；`lastSteps` 是这一帧走了几步。暂停时什么都不做
  - 内核自己登记了三个存档部分：`clock` 最先恢复，`rng` 和 `ids` 在其他部分之后恢复
- `SimSystem`：`systems` 里的一项 `{ name, update }`。`update` 可以被替换，`perftest` 用它统计各子系统的耗时

#### `core/sim/clock.ts`

- `SimClock`：`seconds`（开局以来的模拟秒数）、`speed`、`paused`、`dayLength`；`day`（从 1 起）、`hour`（0–24）、`totalDays`、`sunElevation`（-1..1，正午为 1）、`daylight`（0 深夜到 1 白天）、`isNight`；`stamp()` / `stampAt(秒数)` 返回“第 3 天 14:20”这样的 `Text`

#### `core/sim/saves.ts`

- `SaveRegistry`：存档由各部分组成，每部分是存档对象里的一个字段
  - `add(key, save, restore, optional?)`：key 重复时报错。读档按登记顺序恢复，所以被别人引用的部分要先登记。存档里缺了非可选的部分时 `restore` 抛错；可选部分缺了就保留新世界的初始状态（后来才加的部分登记成可选，旧存档照常能读）
  - `addLast(key, save, restore)`：在其他部分全部恢复之后才恢复，可选
  - `save()` / `restore(d)`

#### `core/sim/ids.ts`

- `IdPool`：`next(kind)` 每类对象各自从 1 发号；`seen(kind, id)` 读档时登记已有的编号。由内核存档。编号会影响行为时（按编号轮换之类），只能用它发号，不要用模块级的计数器

#### `core/sim/entities.ts`

- `EntityRef`：指向一个对象，`{ kind }` 加上游戏自己的字段（通常是 `id`）。游戏的引用类型是各类引用的联合
- `EntityKind`：`define` 的第二个参数。`pos`：现在的位置，不在了返回 null；可跟随的类型要返回对象自己的位置向量，跟随时每帧读一次。`viewDistance`：飞过去时离多远。`follow`：能否跟随。`unstable`：读档后编号会重新分配，事件存档时只留位置
- `EntityRegistry`：`define(kind, spec)`（重复登记报错）、`has`、`pos`、`viewDistance`、`canFollow`、`stable`、`defaultViewDistance`。选中、飞过去、跟随、事件定位都查它

#### `core/sim/events.ts`

- `EventLog`：最近的事件，新的在前，最多 8 条。`push(msg, ref?, at?)`：`at` 省略时取 `ref` 现在的位置。`toSave(keepRef?)`：`keepRef` 返回假的对象只存位置；`restore(s)`
- `SimEvent`：`t`（模拟秒数）、`msg`（`Text`）、`ref`、`at`
- `SimEventSave`：存档里的事件，较早存档的 `msg` 是拼好的字符串
- `Point3`：`{ x, y, z }`

#### `core/sim/spatial.ts`

- `SpatialHash<T>`：三维均匀网格，`new SpatialHash(格子边长 = 2, 桶数的位数 = 13)`。每步 `rebuild(list)`，`near(x, y, z, r, out, self?)` 把半径 r 内活着的对象（不含 `self`）写进 `out`，按插入顺序
- `Located`：放进去的对象要有 `pos` 和 `alive`

#### `core/sim/behavior.ts`

- `Behavior<C>`：行为协程的调度。指令类型 `C` 和怎样执行由游戏决定
  - `run(next, exec, maxCmds = 4)`：每帧调用。没有指令就从协程取下一条，协程结束了用 `next()` 开新任务；`exec(cmd, first)` 返回 true 表示这条做完，同一帧接着取下一条，最多 `maxCmds` 条。执行者可以设 `result`，协程在 `yield` 处拿到它
  - `start(routine)`：丢掉当前任务，换成这个协程（临时调派）。`abort()`：放弃当前任务，下一帧另选
  - `resume(cmd, started)`：读档后接着执行一条存下来的指令，做完再开新任务；`started` 为真时执行者不再把它当作第一步
  - `routine`、`cmd`、`started`：协程不能存档，可以存 `cmd` 和 `started`
- `Routine<C>`：`Generator<C, void, unknown>`

### 空间与运动

#### `core/space/space.ts`

- `Space`：相机、点选、工具只通过它认识世界的形状。`cameraBox`：相机位置的范围；`surfaceAt(x, z)`：参考面的高度，相机按离它多远决定移动快慢；`raycast(ray, out)`：射线与可放置表面的第一个交点，没有时返回 null

#### `core/space/heightfield.ts`

- `HeightfieldSpace`：`new HeightfieldSpace(heightAt, size, cameraBox)`。地面是高度函数，可放置的范围是边长 `size`、以原点为中心的正方形；射线起点在地下时 `raycast` 返回 null

#### `core/space/volume.ts`

- `VolumeSpace`：`new VolumeSpace(volume, floorAt, cameraBox)`，一个盒子。从顶面上方点在顶面，隔着侧壁点在底面，看向水中没碰到底面时取视线在盒中那段的中点；盒子外的 `surfaceAt` 是盒底的高度

#### `core/move/graph.ts`

- `GraphEdge`：`a`、`b`、`length`。`PolylineEdge` 再加中心线 `points` 和各点的累计长度 `cum`
- `NavGraph`：`nextHop(from, to)`、`edgeBetween(a, b)`，`GraphWalker` 只要这两个
- `Routes`：`build(nodeCount, edges)` 算所有节点对的最短路（Floyd，节点数在几百以内；节点或边变了要重建）；`nextHop`（不连通是 -1）、`length`
- `GraphWalker`：在图上一跳一跳走向目标节点
  - `at(node)`：站到节点上。`advance(g, step, target)`：沿路走 `step`，一次最多换三条边，返回 `WalkResult`；走到半路换了目标、新路线要折回出发那端时就地掉头
  - `node`、`edge`、`from`（从哪端上的边）、`s`（从 `from` 走了多远）、`moved`、`walked`（上一次 `advance` 走过的距离）；`nearNode()`、`along()`（从 `edge.a` 量起）、`dir()`
  - `toSave(edges)` / `restore(save, edges)`：边按它在 `edges` 里的下标存，读档时要传同一份边数组
- `WalkResult`：`arrived`、`walking`、`noRoute`、`pending`（这一步换了三条边还没走完）
- `WalkerSave`：`GraphWalker.toSave` 的结果
- `samplePolyline(edge, from, s, outPos, outTan)`：沿折线边从 `from` 端走过 `s` 处的中心线位置和切线
- `tunnelFloor(c, t, radius, lateral, out, outDown)`：圆管隧道底部的落脚点，`lateral` 是向右偏离的距离（半径的倍数）

#### `core/move/surface.ts`

- `turnToward(heading, desired, rate, dt)`：朝目标方向转，每秒最多 `rate` 弧度，走近的一侧
- `alignToGround(up, fwd, heading, normal)`：身体贴合地面，`up` 向法线靠拢，`fwd` 是贴着地面的朝向
- `Skirt`：沿圆形障碍的边缘绕行，每个个体一个。每步先 `track(x, z, dt)` 再 `steer(x, z, heading, cx, cz, stuckAfter?, keepAfterStuck?)`；绕行方向保持 1.5 秒，`stuckAfter` 秒没走出去就反向，并保持 `keepAfterStuck` 秒。目标方向被挡时用 `hug` 朝障碍一侧弯着走，`following(maxFollow)` 判断还在不在贴边

### 游戏模块与界面

#### `core/app/app.ts`

- `runApp(game)`：页面入口调用一次。处理的网址参数：`?new=1` 开新局、`?seed=` 世界编号、`?skip=` 先快进几秒、`?cam=x,y,z,tx,ty,tz`、`?hour=`、`?select=类型:编号`（加 `&fly=1` 飞过去、`&follow=1` 跟随）、`?view=`、`?lang=`。启动后在 `window` 上挂 `world`、`camera`、`controller`、`hud`、`quality`、`renderer`，给浏览器测试用

#### `core/app/game.ts`

- `GameModule`：游戏交给 `runApp` 的全部东西
  - `title`、`subtitle`、`loading`（生成世界时显示的文字）、`repoUrl`、`installable`
  - `camera`：视角、裁剪面、开局视角（`CameraPose`，可以是宽高比的函数，竖屏退远些）
  - `configure(params)`：建世界之前读网址参数，返回 true 时不读存档
  - `create(seed, saved?)`：读档时 `saved` 是随后要交给 `save.read` 的存档，世界的生成参数要跟着存档走时（比如开局人口）在这里先设好；新开局时为空
  - `space(world)`、`mount(ctx)`
  - `save`：`slot`；`write(world, savedAt)`；`read(world, d)`，把存档套到用 `d.seed` 刚建的世界上，失败时抛错（外壳会改为开新局）；`problem(d)`，存档不能用时返回原因；`meta(d)`；`describe(meta)`，存档面板里的一句摘要
- `GameSave`：存档至少有 `seed`；`camera` 由外壳在保存时写入
- `GameContext`：`mount` 拿到的 `world`、`scene`、`camera`、`dom`、`space`、`toast`、`select`、`following`
- `GameSession`：`mount` 返回的
  - `shadowLight`：投影的方向光，画质档位调它的阴影贴图
  - `views`、`tools`（没有工具给 null）、`ui`
  - `pick(x, y, tolerance?)`：屏幕点选，返回实体引用；触屏时外壳传入较大的容差
  - `update(dt, frame)`：每帧在模拟推进、相机更新之后、渲染之前；`syncViews()`：显示开关变了
  - 可选：`onSelect`、`onToolApplied`、`action`（外壳不认识的按钮动作，比如信息面板里的“移除”）、`applyParams`（在 `?hour=` 之后、`?select=` 之前）
- `FrameInfo`：`update` 的第二个参数，`time`（页面打开以来的秒数）、`focus`（视线落在表面上的点，或跟随的对象）、`selection`、`following`
- `ViewToggle`：显示开关，`id`、`label`、`key`、`param`、`dock`、`on`、`toggle`。按钮、快捷键、`?view=`、手机底栏都由外壳生成
- `GameUi`：面板内容，`status`、`perfExtra`、`panel`、`infoHint`、`info`、`stats`、`legend`、`help`。外壳管面板的位置、开合和手机抽屉，游戏只给 HTML
- `InfoPanels`：每类实体一个信息面板函数，漏一类编译不过；`renderInfo(panels, ref)` 按类型调用
- `CameraPose`：`[x, y, z, tx, ty, tz]`，相机位置和注视点

#### `core/app/shell.ts`

- `svgIcon(body)`：20×20 线条图标的外框，游戏的底栏和面板图标用

#### `core/ui/tools.ts`

- `ToolController`：`new ToolController(defs, runner)`。外壳管选择工具、预览圈、触屏上先选位置再确认；游戏只在 `runner.run` 里决定做什么
- `ToolRunner`：`run(def, option, point, yaw, dry)`，`dry` 为真时只检查能不能放（预览圈变绿或变红），不改世界。写成方法签名，外壳才能把各游戏的 `ToolController<K>` 当作 `ToolController<string>` 用
- `ToolDef`：`kind`、`name`、`key`（数字键）、`hint`、`options`
- `ToolOption`：`label`、`radius`、`len`（线状预览的长度，比如树枝）
- `ToolResult`：`ok`、`msg`

#### `core/ui/camera.ts`

- `CameraController`：外壳创建。`mode`（`free` / `follow`）、`setPose`、`follow`、`stopFollow`、`flyTo(at, dist)`、`update`。`onClick`、`onDoubleClick`、`onUserMove`、`onTouchDragStart`、`onTouchDrag` 由外壳占用，游戏不要改

#### `core/ui/chart.ts`

- `drawChart(canvas, title, days, series)`：统计面板的折线图，横轴是游戏日，纵轴自动取整
- `Series`：`label`、`color`、`values`、`dash`

#### `core/ui/html.ts`

- 面板 HTML 的小工具：`bar(v, color)` 进度条（v 取 0–1）；`hex(n)` 颜色转 `#rrggbb`；`cap(s)` 首字母大写（英文词典里的名词是小写的）；`esc(s)` 转义；`when(clock, t)` 事件和日志的时刻（旧存档里是拼好的字符串）；`agoText(ms)` “几分钟前”；`isTouch()` 主要指针是不是手指

### 渲染

#### `core/render/environment.ts`

- `Environment`：户外的天空、太阳、月亮、半球光、星空、雾，以及夜里和透视地下时跟着相机的观察灯。`new Environment(scene, levels)`，每帧 `update(clock, camera, focus, xray, cloud?)`；`sun` 可以直接当 `shadowLight`。天空不经过色调映射，自己乘上了玩家的亮度倍数
- `LightLevels`：各光源的强度（three.js 单位）

#### `core/render/rain.ts`

- `RainView`：雨丝和地面上的水花，每帧 `sync(dt, camera, focus, rain, heightAt)`，`rain` 是雨势 0..1。什么时候下、下多大归游戏的模拟

### 文字

#### `core/i18n/index.ts`

- `L(key, params?)`：记下键和参数，得到 `Text`。模拟层只用它，界面显示时才翻译，切换语言后已有的事件和状态也跟着变
- `t(key, params?)`：按当前语言翻译成字符串，参数里的 `Text` 也翻译；当前语言没有这条时用中文，都没有时显示键名
- `tr(text)`：翻译一个 `Text`
- `asText(x)`：旧存档里拼好的字符串包成 `Text`，原样显示
- `registerDicts(dicts, overrides?)`：登记游戏的词典，要在第一次翻译之前；和已有的键重名时报错。`overrides` 改写框架文字的措辞，只能改框架已有的键，占位符要相同
- `Text`、`Param`、`Entry`：`Entry` 是词条，字符串里的 `{name}` 换成参数，要按数量变形时写成函数
- `Messages`、`MsgKey`、`CoreKey`：键的类型。游戏用声明合并把自己的键加进 `Messages`；`CoreKey` 是框架自己的键，框架代码只能用这些
- `Lang`：`'zh' | 'en'`

### 工具函数和配置

#### `core/util/random.ts`

- `Rng`：可设种子的随机数，`next`、`range`、`int`（含两端）、`pick`、`chance`、`gauss`、`reseed`；`state` 可以读写，存档用。模拟里只用世界的 `rng`；视图里的随机另开一个，不要消耗模拟的
- `Noise2D`：梯度噪声 `noise(x, y)`（约 ±0.7）和分形叠加 `fbm(x, y, octaves)`

#### `core/util/math.ts`

- `TAU`、`clamp`、`lerp`、`smoothstep`、`wrapAngle`（规整到 ±π）、`dist2`（平面距离的平方）

#### `core/config.ts`

- `ENGINE`：框架的配置：`loop`（固定步长 1/30 秒、每帧最多 24 步、每帧模拟最多 10 ms）、`background`（后台运行的节拍和耗时上限）、`render`（画质档位、自动降档、帧率上限、曝光和亮度滑块的范围）、`save`（自动保存间隔）、`music`（背景音乐的音量、速度、调、旋律疏密、混响）。游戏一般只读 `ENGINE.loop`

#### `core/platform/saveSlot.ts`

- `SaveSlot<D, M>`：`localStorage` 里的一个存档位，`new SaveSlot(键名)`，每个游戏一个名字。`write(d, meta)` 失败时返回原因（空间不够、不允许写），`read()`、`readMeta()`、`clear()`；摘要另存一份，存档面板不用解析整个存档
- `SaveMeta`：摘要至少有 `savedAt`，`seconds` 是保存时的模拟秒数；游戏可以加自己的字段

## 框架内部

#### `core/app/app.ts`

- `App`：运行中的外壳：场景、相机、session、界面外壳，以及选中、跟随、点到表面、使用工具这些共用操作。下面几个文件都拿它做第一个参数

#### `core/app/boot.ts`

- `createRenderer`、`openWorld`（读档或新开局、`?seed=`、`?new=1`、`?skip=`）、`OpenedWorld`

#### `core/app/saving.ts`

- `SaveControl`：手动保存，定时、切到后台、关闭页面时自动保存；读档和重新开始都是重新载入页面，载入前不再保存

#### `core/app/actions.ts`

- `runAction`：按钮、按键、面板里的动作；外壳不认识的交给 `session.action`

#### `core/app/input.ts`

- `bindInput`：点击、双击、触屏拖动预览圈、快捷键、窗口尺寸变化

#### `core/app/urlParams.ts`

- `startPose`（`?cam=` 或存档时的视角）、`applyUrlParams`（`?hour=`、游戏的参数、`?select=`、`?view=`）

#### `core/app/loop.ts`

- `startLoop`：每帧推进模拟、更新相机、同步视图、刷新面板、自动保存、渲染。`startBackground`：页面隐藏时推进模拟，回来时提示离开了多久

#### `core/app/shell.ts`

- `Shell`、`ShellOptions`：顶栏、手机底栏和抽屉、各个面板、提示条。`ShellAction`：外壳认识的动作；`SHEETS`、`Sheet`：手机布局里的抽屉

#### `core/render/quality.ts`

- `Quality`、`QUALITY_MODES`、`QualityMode`、`QUALITY_LEVELS`：画质档位和帧率上限，由外壳的画质按钮控制

#### `core/render/brightness.ts`

- `Brightness`：玩家的亮度设置，白天和夜里各一个曝光倍数（`day`、`night`，1 是默认），记在本地，由外壳的亮度滑块控制。`factor(daylight)` 按时钟的 `daylight` 在两档之间过渡，主循环每帧乘到 `ENGINE.render.exposure` 上；`set(k, v)`、`reset()`、`isDefault`
- `BRIGHTNESS_KEYS`、`BrightnessKey`：`'day'`、`'night'`

#### `core/audio/composer.ts`

- `Composer`：背景音乐的作曲，给一个 `Rng` 就能确定地往后作。`until(t)` 返回开始时间早于 `t` 秒、还没给过的各小节里的音。`key` 是这次的主音
- `MusicNote`、`Voice`：一个音（`pad` 和弦铺底、`bell` 旋律、`bass` 低音），时间和时长都是秒

#### `core/audio/music.ts`

- `Music`：用 Web Audio 把作曲变成声音，外壳的音乐按钮和 <kbd>M</kbd> 控制。`enabled` 是开关（记在本地），`playing` 是此刻是否在出声，`toggle()` / `setEnabled()`

#### `core/platform/background.ts`

- `BackgroundRunner`、`BACKGROUND_LIMITED`：页面隐藏时的后台节拍（来自 Worker）；手机和平板切到后台会冻结整个页面，不起作用

#### `core/platform/device.ts`

- `IOS`、`MOBILE`

#### `core/platform/install.ts`

- `Installer`、`registerServiceWorker`：添加到主屏幕，`GameModule.installable` 为真时外壳才用

#### `core/platform/lang.ts`

- `initLang`、`chooseLang`：选择界面语言并记住

#### `core/i18n/index.ts`

- `getLang`、`setLang`、`LANGS`、`LANG_TAGS`、`LANG_NAMES`：外壳的语言菜单用；游戏切换语言走外壳

#### `core/i18n/zh.ts`、`core/i18n/en.ts`

- `coreZh`、`coreEn`：框架自己的文字。游戏要换说法写进自己的 overrides

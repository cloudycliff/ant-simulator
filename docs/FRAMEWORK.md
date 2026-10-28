# 用框架做一个新游戏

`src/core` 是给“观察型生命模拟”用的框架：一个 3D 的小世界，里面有很多自己行动的个体；时间按固定步长推进，有倍速和昼夜；玩家飞着看、点选、跟随、看统计，用工具干预。蚂蚁游戏（`src/games/ant`）和鱼缸示例（`src/games/aquarium`）都建在它上面。本文讲怎样再做一个，比如蜂巢、白蚁、生态瓶。

框架怎么分出来的见 DECISIONS T-049 到 T-056；每个对外的名字和它的约定见 [API.md](API.md)；各模块的细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 框架给什么

| 模块 | 内容 | 游戏要做的 |
|---|---|---|
| `core/sim` | `Simulation`：时钟、随机数、编号、按登记顺序推进的子系统、存档登记、实体注册表、最近事件、固定步长和帧预算；`SpatialHash`；`Behavior`（行为协程：生成器 yield 指令，逐帧执行，结果传回） | 继承它，登记子系统、存档部分、实体类型；个体行为复杂时用 `Behavior` |
| `core/space` | `Space` 接口；`HeightfieldSpace`（地面）、`VolumeSpace`（盒子） | 选一种，传入高度函数和相机范围 |
| `core/move` | 图上行走（最短路、沿边走）、地表转向、贴地、贴边绕开圆形障碍 | 用得上就用 |
| `core/render` | 户外的天空、太阳、星空、雾（`Environment`）；雨；画质档位；玩家的亮度设置（白天、夜里两档，乘在曝光上） | 户外游戏用 `Environment`，室内自己放灯 |
| `core/ui` | 相机（自由飞行、跟随、飞过去、触屏手势）、工具（选择、预览圈、触屏两步放置）、折线图、面板 HTML 工具 | 给出工具的定义和执行函数 |
| `core/app` | `runApp`：渲染器、读档和自动保存、选中和跟随、按键、网址参数、后台运行、主循环；`Shell`：顶栏、手机底栏和抽屉、信息面板、事件列表、帮助、第一次的提示和笔记、统计、图例、存档面板、语言、画质、亮度、音乐 | 写一个 `GameModule` |
| `core/audio` | 程序生成的背景音乐（`Composer` 作曲、`Music` 发声），外壳自带开关 | 不用管 |
| `core/platform` | 存档位、语言选择、设备识别、后台运行、添加到主屏幕 | 存档位的名字 |
| `core/i18n` | `t` / `L` / `tr`、框架自己的文字、`registerDicts` | 游戏的中英文词典 |

外壳处理的网址参数每个游戏都有：`?new=1` 开新局、`?seed=` 世界编号、`?hour=` 开局时刻、`?skip=` 先快进几秒、`?select=类型:编号`（加 `&fly=1` 飞过去、`&follow=1` 跟随）、`?view=` 打开视图开关、`?cam=x,y,z,tx,ty,tz` 相机、`?lang=en`。游戏自己的参数在 `applyParams` 里读。

## 一个游戏由哪些文件组成

以鱼缸示例为模板（约 1200 行，含两份词典）：

```
<name>.html                 页面骨架：和 index.html 一样的面板容器，入口换成 src/<name>.ts
src/<name>.ts               import './style.css'; runApp(<name>Game)
src/games/<name>/
  config.ts                 玩法数值；文件开头 import './i18n'，导入配置就登记了词典
  i18n/zh.ts                中文词典，游戏所有键的来源
  i18n/en.ts                英文词典，类型是 Record<keyof typeof zh, Entry>，漏一条编译不过
  i18n/overrides.ts         改写的框架文字（比如“先选中一条鱼”）
  i18n/index.ts             声明合并 Messages，registerDicts({ zh, en }, overrides)
  <world>.ts                世界：继承 Simulation，不依赖 DOM 和 WebGL；存档格式和存档位
  view.ts                   场景：网格、灯光、每帧把模拟状态写进网格
  game.ts                   GameModule：把上面这些交给外壳
```

蚂蚁游戏更大，模拟分在 `sim/`、`world/`、`nest/` 几个目录里，界面内容在 `ui/`，结构是一样的。

## 步骤

### 1. 复制模板

把 `src/games/aquarium` 复制成 `src/games/<name>`，`aquarium.html` 和 `src/aquarium.ts` 同样复制改名。在 `vite.config.ts` 里加一个 mode，在 `package.json` 的 `build` 后面接一条 `vite build --mode <name>`。`node scripts/core/layercheck.mjs` 会自动检查新目录：游戏不能导入别的游戏，`core` 不能导入游戏。

### 2. 世界

```ts
export class Hive extends Simulation<HiveRef> {
  constructor(readonly seed: number) {
    super(CONFIG.clock.dayLength, CONFIG.clock.startHour, seed);
    this.generate();
    this.addSystem('bees', (dt) => this.updateBees(dt));      // 每步按登记顺序调用
    this.saves.add('bees', () => ..., (d) => ...);             // 读档按登记顺序恢复，被引用的先登记
    this.entities.define('bee', { pos: (r) => ..., viewDistance: 6, follow: true });
  }
}
```

- **随机数和编号**：模拟里只用 `this.rng`（由世界编号决定）和 `this.ids.next(类型)`，不要用 `Math.random` 或模块级的计数器。两样都由内核存档、最后恢复，所以同一个存档读进来，之后每次运行都一样，测试靠这个；同一进程里的两个世界也不会互相影响。视图里的随机（叶子的形状等）另开一个 `Rng(seed + 1)`，不要消耗模拟的随机数
- **存档**：世界由编号重新生成，存档只存会变的东西。时钟、随机数和编号由内核自己存。后来才加的部分登记成可选（`saves.add(..., true)`），旧存档还能读
- **实体**：能选中、能出现在事件里的对象都登记。`pos` 返回 null 表示已经不在了；可跟随的要返回对象自己的位置；读档后编号会变的设 `unstable`；默认“飞过去”是斜着俯看，竖着的东西（比如巢脾）用 `viewDir` 给出从哪边看
- **行为**：个体的任务写成生成器，`yield` 一条指令（比如 `{ k: 'goto', node }`），由个体每帧执行：
  ```ts
  readonly behavior = new Behavior<Command>();
  update(dt) { this.behavior.run(() => pickTask(this), (cmd, first) => this.step(dt, cmd, first)); }
  ```
  `step` 返回 `true` 表示这条指令做完，`behavior.result` 里放给协程的结果。有急事要临时调派时用 `behavior.start(协程)` 换掉当前任务，`abort()` 则放弃当前任务、下一帧另选。协程不能存档。可以存下 `behavior.cmd`、`behavior.started` 和执行进度，读档后 `behavior.resume(指令, 已开始)` 接着做完这一步再开新任务（隧道里的位置用 `GraphWalker.toSave` / `restore`）；手里拿着东西的，新任务先把它送到（蚂蚁的做法见 DECISIONS T-059、T-067）。鱼的行为简单，鱼缸没用它
- **事件**：`this.events.push(L('ev.xxx', 参数), 涉及的对象, 位置)`，对象和位置都可以省略
- **文字**：模拟里只用 `L()` 记下键和参数，界面显示时再翻译
- 改完写一个无界面测试（照 `scripts/games/aquarium/aquatest.ts`）：跑几个游戏日，检查个体不越界、关键行为发生、存档往返一致、同编号可重现、英文文字没漏翻

### 3. 存档位

```ts
export const hiveSave = {
  slot: new SaveSlot<HiveSaveData, HiveSaveMeta>('cyber-hive-save'),   // 每个游戏一个名字
  write: (w, savedAt) => ({ version: SAVE_VERSION, seed: w.seed, savedAt, ...w.saves.save() }),
  read(w, d) { /* 检查编号和版本，失败抛错 */ w.saves.restore(d); },
  problem: (d) => (d.version !== SAVE_VERSION ? L('save.incompatible') : null),
  meta: (d) => ({ savedAt: d.savedAt, seconds: Math.round(d.clock.seconds), bees: d.bees.length }),
};
```

### 4. 空间

- 有地面、相机贴地飞：`new HeightfieldSpace(高度函数, 可放置范围的边长, 相机范围)`
- 一个缸或箱子：`new VolumeSpace(盒子, 底面高度函数, 相机范围)`。从上方点在顶面，隔着侧壁点在底面，点水里取视线在盒中那段的中点
- 都不合适就实现 `Space` 的三个成员：`cameraBox`、`surfaceAt(x, z)`、`raycast(ray, out)`。相机的离地高度、平移、工具的放置点、注视点都用它

### 5. 视图

`view.ts` 建场景对象，每帧 `update` 把模拟状态写进网格。个体多时用 `InstancedMesh`。必须交给外壳一盏投影的方向光（`shadowLight`），画质档位调它的阴影贴图。户外用 `core/render/environment.ts`，天空、雾、阴影范围默认是蚂蚁那 2.4 m 见方的尺度，场景大小不同时传 `EnvironmentScale`；室内自己放灯。玩家的亮度设置是乘在色调映射曝光上的，普通材质自动跟着变；自己写的 `ShaderMaterial` 不经过色调映射，要亮度一起变就乘上 `renderer.toneMappingExposure / ENGINE.render.exposure`（`Environment` 的天空就是这样做的）。

### 6. 游戏模块

`game.ts` 导出 `GameModule`：

- `title` / `subtitle` / `loading`、`repoUrl`
- `camera`：视角、裁剪面、开局视角。开局视角可以是宽高比的函数，竖屏手机退远一些。世界的尺度和蚂蚁差得多时给 `tuning`：相机的移动和滚轮快慢、跟随的距离和追赶速度、按离什么东西多远来定快慢
- `create(seed, saved?)`（读档时收到要读的存档，生成参数要跟存档走时在这里设）、`save`（上面的存档位加 `describe`：存档面板里的一句摘要）、`space(world)`
- `installable`：要能添加到主屏幕才设。页面要有自己的清单，`public/sw.js` 现在只缓存蚂蚁游戏的页面，第二个可安装的游戏要给它自己的离线缓存脚本
- `mount(ctx)` 返回 `GameSession`：
  - `views`：视图开关（名字、按键、`?view=` 的名字、手机底栏图标、状态、切换），按钮、按键、视图面板都由外壳生成
  - `tools`：`new ToolController(定义, { run })`，`run(def, option, point, yaw, dry)` 在 `dry` 为真时只检查能不能放；没有工具给 `null`
  - `pick(x, y, 容差)`：屏幕点选，返回实体引用。小东西按屏幕距离、大东西按射线比较好点中
  - `update(dt, frame)`：每帧同步视图
  - `ui`：顶栏状态、性能行后缀、主面板、信息面板（每种实体一个，漏了编译不过）、统计（可选）、图例（可选）、帮助条目、笔记和第一次的提示（可选，`notes`：条目和“这一刻看到了什么”，外壳弹提示卡、记住看过的；顶栏“帮助”旁边的笔记（<kbd>N</kbd>，手机底栏一格）列出所有条目，看到过的能重读，没看到的写着在哪能看到）
  - 可选：`onSelect`、`onToolApplied`、`action`（信息面板里外壳不认识的按钮）、`applyParams`

### 7. 文字

- 游戏的键写进自己的 `zh.ts` 和 `en.ts`。**不能和框架的键重名**，登记时会报错；要换框架文字的说法，写进 `overrides.ts`，占位符不能变
- 两个游戏可以有同名的键，因为一个页面只登记一个游戏的词典
- 把新游戏的两份词典和 overrides 加进 `scripts/i18ncheck.ts` 的检查列表
- 类型上 `MsgKey` 是所有游戏的键的并集，写了别的游戏的键编译也能过，运行时会显示成键名。界面上出现英文键名就是这个原因

### 8. 验证

- 自己的无界面测试放在 `scripts/games/<name>/`，照 `scripts/games/aquarium/aquatest.ts`，失败时设 `process.exitCode = 1`；然后加进 `scripts/check.mjs` 的步骤列表
- `npm run check` 全部通过：类型检查、依赖方向、接口说明（游戏只用了 API.md 里“给游戏用的”名字）、框架单元测试、界面文字、各个游戏的无界面测试和蚂蚁游戏的模拟基线。改了 `src/core` 时它同时回归了已有的游戏；动了外壳再跑 `npm run check:ui`
- 截图，照 `scripts/games/aquarium/aquashots.mjs`：桌面和竖屏手机，白天、夜里、选中、工具、英文

## 还没有的

这些等真有游戏需要时再做，免得过度设计：

- 绕着对象转的相机模式（现在只有自由飞行和跟随）
- 室内灯光的预设（鱼缸自己放灯）
- 三维的网格场（水里的氧气、温度分布）、三维的空间哈希
- 通用的鱼群 / 鸟群运动（鱼缸的写在 `tank.ts` 里）
- 通用的点选（两个游戏各写一份，分组规则不同）
- 一个页面里放多个游戏、插件式加载、联网

## 文档模板

`docs/templates/` 里是一套新项目用的文档骨架：`AGENTS.md`（给开发 Agent 的约定）、`PROGRESS.md`（当前状态和开发日志）、`DECISIONS.md`（产品和技术决策）、`ARCHITECTURE.md`（目录、分层、主循环、验证工具）、`ROADMAP.md`（分阶段计划）、`BALANCE.md`（数值和调参记录）。新游戏放在本仓库里时，在这几份现有文档里各加一节即可；单独开仓库时复制模板，把 `<游戏名>` 之类的占位换掉。

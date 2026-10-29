# 赛博养蚂蚁

基于 Three.js 的 Web 版蚂蚁生态模拟。以黑毛蚁 *Lasius niger* 为原型，还原地下蚁穴结构和蚁穴周围的觅食环境。约 1000 只蚂蚁按社会分工自主行动，玩家可以在场景中自由飞行观察，点选蚂蚁、房间和植物查看信息。

**在线试玩：** https://cyberant.pages.dev

- 工蚁随日龄从保育蚁转为内务蚁、觅食蚁，并按蚁群需要动态调整
- 甜液装在工蚁的嗉囊（“社会胃”）里，靠嘴对嘴交哺在蚁群中流动
- 觅食蚁在植物上放牧蚜虫、采集蜜露；满载归来时通过触角接触激发同伴出巢
- 白天保育蚁把蛹搬到大石块下晒暖的房间，傍晚搬回深处
- 蚁穴拥挤时，内务蚁会挖出新的隧道和房间
- 地表有天敌：游荡捕猎的狼蛛，挖漏斗陷阱的蚁狮，飞来吃蚜虫、被照料蚜虫的工蚁赶走的瓢虫；蚜虫太挤时长出翅膀飞走
- 受到攻击的蚂蚁释放警报信息素，附近的同伴赶来围攻、把狼蛛赶走；巢口有天敌时觅食蚁留在巢里，内务蚁出来警戒；爬出过陷阱的蚂蚁会绕开它
- 会下雨：雨水冲淡信息素、积成水洼，觅食蚁回巢躲雨，内务蚁在雨前用土粒封住入口、雨后清开；入口没封好时浅层房间会进水，蛹被搬到深处
- 玩家可以投放食物、放置石块和树枝路障、浇水或招来一场雨、放入或赶走天敌，观察蚁群如何应对
- 自动存档，下次打开接着养
- 最小化浏览器或切到其他标签页时蚁群照样生活（顶栏“后台运行”，默认开启，可以关掉改成离开即暂停）。手机和平板的浏览器会冻结后台页面，那里离开时蚁群暂停，回来接着过
- 中英文界面：第一次打开按浏览器语言自动选择，顶栏右上角的语言菜单随时切换（English UI is available: it is picked automatically for non-Chinese browsers, and the language menu at the top right switches it at any time）

当前进度：**第三阶段进行中**（干预工具、存档、天敌、警报与防御、天气已完成）。详见 [docs/PROGRESS.md](docs/PROGRESS.md)。

代码分成可复用的框架层 `src/core` 和游戏内容 `src/games/`。为了检验框架，仓库里还有一个很小的鱼缸示例（霓虹灯鱼、神仙鱼、鼠鱼，可以喂食、敲玻璃）：https://cyberant.pages.dev/aquarium.html ，本地是 `npm run dev` 后打开 http://localhost:5173/aquarium.html 。第二个游戏“赛博养蜂”（花园里的中华蜜蜂观察箱）正在开发，在线试玩 https://cyberbee.pages.dev/ ，本地地址 http://localhost:5173/bee.html ，设计和进度见 [docs/bee/](docs/bee/)。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 生产构建，输出单个文件 dist/index.html（并复制为根目录的 cyber-ant-farm.html）、鱼缸示例 dist/aquarium.html 和蜜蜂 dist/bee.html
npm run check      # 一键检查：类型、依赖方向、单元测试、文字、模拟基线和各项无界面测试（约 3 分钟）
npm run check:ui   # 构建 + 无头 Chrome 里的页面测试和各屏幕布局截图（约 6 分钟）

# 单独运行某项测试
npx tsx scripts/games/ant/simtest.ts 3000   # 无界面模拟 5 个游戏日（6000 为 10 天），检查行为与平衡
npx tsx scripts/games/ant/savetest.ts       # 存档往返测试
npx tsx scripts/games/ant/defensetest.ts    # 放入狼蛛，观察警报、围攻与入口警戒
npx tsx scripts/games/ant/weathertest.ts    # 招来一场雨，观察躲雨、封堵入口与进水
npx tsx scripts/games/ant/ladybugtest.ts    # 瓢虫来访、蚜虫涨落，有无蚂蚁照料的对照
npx tsx scripts/games/ant/perftest.ts 3000  # 3000 只工蚁的模拟耗时
npx tsx scripts/games/ant/crowdtest.ts      # 3000 只工蚁时休息室、蚁丘和隧道有多挤
npx tsx scripts/games/ant/notestest.ts      # 蚂蚁笔记：每条都有中英文，什么时候算看到了
npx tsx scripts/i18ncheck.ts      # 中英文词典与英文模拟文字检查
node scripts/core/layercheck.mjs       # 依赖方向检查：框架层 src/core 不能导入游戏 src/games
node scripts/core/apicheck.mjs         # 框架的每个导出都写进了 docs/API.md
npx tsx scripts/core/coretest.ts       # 框架层单元测试
npx tsx scripts/games/aquarium/aquatest.ts       # 鱼缸示例的无界面检查
npx tsx scripts/games/bee/beetest.ts             # 蜜蜂的无界面检查
```

### 不用服务器直接打开

双击根目录下的 **`cyber-ant-farm.html`**，用 Chrome / Edge / Firefox 打开即可运行。它内联了全部脚本和样式（约 790 KB），没有其他依赖文件，可以复制到任意位置单独分享。

- 这个文件由 `npm run build` 生成（内容与 `dist/index.html` 相同），改了代码后要重新构建才会更新
- 根目录的 `index.html` 是给 Vite 用的源码模板，引用的是 TypeScript 源码，不能直接双击运行

### 部署到 Cloudflare

Cloudflare 后台的 Pages 项目 `cyberant` 连接了这个 GitHub 仓库：生产分支 `main`，构建命令 `npm run build`，输出目录 `dist`，Node 版本由 `.node-version` 指定。之后每次推送到 `main` 都会自动重新部署。网页版的存档保存在该网址下的浏览器本地，和双击打开 HTML 文件的存档互不相通。

蜜蜂另有一个 Pages 项目 `cyberbee`（https://cyberbee.pages.dev/ ），连接同一个仓库：生产分支 `main`，构建命令 `npx vite build --mode bee --outDir dist-bee && mv dist-bee/bee.html dist-bee/index.html`，输出目录 `dist-bee`。推送到 `main` 两个项目各自重新部署（[docs/bee/DECISIONS.md](docs/bee/DECISIONS.md) T-030）。

## 操作

| 操作 | 按键 |
|---|---|
| 移动 / 下降、上升 / 加速 | `W A S D` / `Q` `E` / `Shift` |
| 转视角 / 平移 / 推进 | 左键拖拽 / 右键拖拽 / 滚轮 |
| 选择 / 飞到目标 | 左键单击 / 双击 |
| 飞到事件发生的地方 | 单击左下角的事件 |
| 跟随选中的蚂蚁 / 取消选择 | `F` / `Esc` |
| 暂停 / 倍速 1–20× | `空格` / `1`–`5` |
| 地下透视 / 信息素 / 分工着色 / 草丛 / 统计曲线 / 帮助 | `X` / `P` / `C` / `G` / `T` / `H` |
| 投食 / 放障碍 / 浇水或下雨 / 天敌（再按一次切换选项） | `6` / `7` / `8` / `9` |
| 旋转树枝路障 / 退出工具 | `R` / `Esc` |
| 保存（每分钟和关闭页面时也会自动保存） | `Ctrl` + `S`；读取存档、重新开始在顶栏“存档”里 |
| 离开页面时继续运行 / 暂停 | 顶栏速度组里的“后台运行”（默认开启，会记住选择） |
| 切换中文 / 英文 | 顶栏右上角带地球图标的语言菜单（会记住选择） |
| 画质：自动 / 高 / 中 / 低 / 省电 | 顶栏右上角的“画质”，点一下换一档；手机在“更多”菜单里（会记住选择） |
| 亮度（白天、夜里分开调） | 顶栏右上角的“亮度”，拖动滑块；手机在“更多”菜单里（会记住设置） |
| 背景音乐 开 / 关 | `M`，或顶栏右上角的“音乐”；手机在“更多”菜单里（默认开，会记住选择） |
| 蚂蚁笔记 | `N`，或顶栏的“笔记”；手机在底栏最后一格 |

第一次看到蚁穴、信息素路线、蚜虫、下雨、狼蛛这些时，右下角（手机在底栏上方）弹一张小卡片讲真实的黑毛蚁是怎么做的；看过的和更多不弹卡片的条目都收在“笔记”里，没看到的写着在哪能看到。卡片上点“不再弹出提示”关掉，笔记面板底下能再打开。看过什么记在浏览器本地，新开局也留着。

手机和平板上用地图式的手势：

| 操作 | 手势 |
|---|---|
| 平移 / 推近、拉远 / 转向 / 俯仰 | 单指拖动 / 双指捏合 / 双指旋转 / 双指一起上下滑 |
| 选择 / 飞到目标 | 点按 / 双击 |
| 跟随蚂蚁时绕着看 | 单指拖动 |
| 使用工具 | 选好工具后点地面定位置（按住预览圈可以拖动微调），再点工具面板里的“放在这里” |

手机上（竖屏或横屏）界面换成手机布局：顶栏只留时间、暂停、倍速和“更多”菜单（画质、亮度、音乐、帮助、存档、语言、GitHub），蚁群、透视、视图、工具、事件放在底栏（横屏时在左侧），面板从底栏弹出，同一时间只开一个，点画面就收起。选中东西后信息面板从下方弹出（横屏在右侧），点标题可以折叠。平板沿用桌面布局，按钮更大，左侧的蚁群面板点标题可以折叠。

网页版可以添加到手机主屏幕：安卓在“更多”菜单里点“添加到主屏幕”，iPhone、iPad 用浏览器分享菜单里的“添加到主屏幕”。之后从主屏幕打开没有浏览器地址栏，断网也能玩（要先联网打开过一次）。iPhone、iPad 上从主屏幕打开的和浏览器里的存档不互通。

画质默认“自动”：电脑从高画质开始，手机和平板从中画质开始，画面持续卡顿时自动降一档。“省电”用低画质并把帧率限制在每秒 30 帧；不论哪一档，暂停后不操作时都降到每秒 15 帧。

不同屏幕看起来亮暗差别不小，夜景尤其明显。“亮度”里白天和夜里各有一个滑块（50%–250%），黄昏和清晨在两档之间平滑过渡，圆点标出现在用的是哪一档。

背景音乐是程序实时生成的轻音乐（和弦、八音盒似的旋律、低音），每次打开换一个调，和弦进行和旋律疏密也随时在变，不用任何音频文件。浏览器不让网页自动出声，所以第一次点击或按键后才开始；切到别的页面时暂停。

存档保存在浏览器本地（`localStorage`），换浏览器或清除网站数据后会丢失。直接双击 HTML 文件打开时，同一浏览器里所有本地 HTML 文件共用一份存储。

## URL 参数

| 参数 | 作用 |
|---|---|
| `?cam=x,y,z,tx,ty,tz` | 初始相机位置和注视点 |
| `?select=类型:编号` | 开局选中对象，类型见 `src/games/ant/world/entities.ts`，如 `ant:1`（蚁后）、`chamber:4`、`plant:0`（第一株蚜虫寄主植物）、`entrance:0` |
| `&follow=1` / `&fly=1` | 配合 `select`：跟随 / 飞到选中对象 |
| `?hour=21.5` | 快进到下一个指定时刻 |
| `?skip=1500` | 开局先在后台快进模拟若干秒（上限 20000），用来直接观察扩建等慢过程 |
| `?new=1` | 不读取存档，从新的蚁群开始（之后的自动保存会覆盖原存档）；每次新开局随机生成一张地图 |
| `?new=1&seed=20261021` | 用指定编号的地图新开局；地图编号显示在存档面板里 |
| `?view=xray,pheromone,roles,stats` | 开局打开地下透视 / 信息素 / 分工着色 / 统计曲线 |
| `?rain=60` | 开局招来一场雨，并在后台快进指定秒数（上限 2000），用来直接观察雨中的蚁穴 |
| `?tips=0` | 这一页不弹第一次的提示卡（截图、测试用；笔记照样记） |
| `?lang=en` / `?lang=zh` | 本次用指定语言显示（不会被记住；不加时按上次的选择或浏览器语言） |
| `?ants=3000` | 用指定数量的工蚁开局（上限 5000，人口上限随之提高），用来测性能；和 `new=1` 一样不读存档，之后的自动保存会覆盖原存档 |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | 已确认的需求、三阶段计划、工作量预估 |
| [docs/PROGRESS.md](docs/PROGRESS.md) | 当前状态、验证情况、已知问题、开发日志 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 产品与技术决策记录 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码结构、模拟与渲染机制、扩展指南、验证工具 |
| [docs/BALANCE.md](docs/BALANCE.md) | 数值参数一览与调参历史 |
| [docs/FRAMEWORK.md](docs/FRAMEWORK.md) | 怎样用 `src/core` 框架做一个新的模拟游戏 |
| [docs/API.md](docs/API.md) | 框架对外接口：游戏能用的每个名字和它的约定 |
| [docs/templates/](docs/templates/) | 新项目用的文档骨架（AGENTS 和上面五份） |

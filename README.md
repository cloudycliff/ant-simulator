# 赛博养蚂蚁

基于 Three.js 的 Web 版蚂蚁生态模拟。以黑毛蚁 *Lasius niger* 为原型，还原地下蚁穴结构和蚁穴周围的觅食环境。约 1000 只蚂蚁按社会分工自主行动，玩家可以在场景中自由飞行观察，点选蚂蚁、房间和植物查看信息。

**在线试玩：** https://cyber-ant.cloudycliff.workers.dev

- 工蚁随日龄从保育蚁转为内务蚁、觅食蚁，并按蚁群需要动态调整
- 甜液装在工蚁的嗉囊（“社会胃”）里，靠嘴对嘴交哺在蚁群中流动
- 觅食蚁在植物上放牧蚜虫、采集蜜露；满载归来时通过触角接触激发同伴出巢
- 白天保育蚁把蛹搬到大石块下晒暖的房间，傍晚搬回深处
- 蚁穴拥挤时，内务蚁会挖出新的隧道和房间
- 地表有天敌：游荡捕猎的狼蛛，挖漏斗陷阱的蚁狮
- 受到攻击的蚂蚁释放警报信息素，附近的同伴赶来围攻、把狼蛛赶走；巢口有天敌时觅食蚁留在巢里，内务蚁出来警戒；爬出过陷阱的蚂蚁会绕开它
- 会下雨：雨水冲淡信息素、积成水洼，觅食蚁回巢躲雨，内务蚁在雨前用土粒封住入口、雨后清开；入口没封好时浅层房间会进水，蛹被搬到深处
- 玩家可以投放食物、放置石块和树枝路障、浇水或招来一场雨、放入或赶走天敌，观察蚁群如何应对
- 自动存档，下次打开接着养
- 最小化浏览器或切到其他标签页时蚁群照样生活（顶栏“后台运行”，默认开启，可以关掉改成离开即暂停）
- 中英文界面：第一次打开按浏览器语言自动选择，顶栏右上角的语言菜单随时切换（English UI is available: it is picked automatically for non-Chinese browsers, and the language menu at the top right switches it at any time）

当前进度：**第三阶段进行中**（干预工具、存档、天敌、警报与防御、天气已完成）。详见 [docs/PROGRESS.md](docs/PROGRESS.md)。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 生产构建，输出单个文件 dist/index.html，并复制为根目录的 赛博养蚂蚁.html
npx tsx scripts/simtest.ts 3000   # 无界面模拟 5 个游戏日（6000 为 10 天），检查行为与平衡
npx tsx scripts/savetest.ts       # 存档往返测试
npx tsx scripts/defensetest.ts    # 放入狼蛛，观察警报、围攻与入口警戒
npx tsx scripts/weathertest.ts    # 招来一场雨，观察躲雨、封堵入口与进水
npx tsx scripts/perftest.ts 3000  # 3000 只工蚁的模拟耗时
npx tsx scripts/i18ncheck.ts      # 中英文词典与英文模拟文字检查
```

### 不用服务器直接打开

双击根目录下的 **`赛博养蚂蚁.html`**，用 Chrome / Edge / Firefox 打开即可运行。它内联了全部脚本和样式（约 760 KB），没有其他依赖文件，可以复制到任意位置单独分享。

- 这个文件由 `npm run build` 生成（内容与 `dist/index.html` 相同），改了代码后要重新构建才会更新
- 根目录的 `index.html` 是给 Vite 用的源码模板，引用的是 TypeScript 源码，不能直接双击运行

### 部署到 Cloudflare

Cloudflare 后台的 Worker 项目 `cyber-ant` 连接了这个 GitHub 仓库：构建命令 `npm run build`，部署命令 `npx wrangler deploy`，按 `wrangler.jsonc` 把 `dist` 作为静态网站发布，Node 版本由 `.node-version` 指定。之后每次推送到 `main` 都会自动重新部署。网页版的存档保存在该网址下的浏览器本地，和双击打开 HTML 文件的存档互不相通。

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

存档保存在浏览器本地（`localStorage`），换浏览器或清除网站数据后会丢失。直接双击 HTML 文件打开时，同一浏览器里所有本地 HTML 文件共用一份存储。

## URL 参数

| 参数 | 作用 |
|---|---|
| `?cam=x,y,z,tx,ty,tz` | 初始相机位置和注视点 |
| `?select=ant:1`、`chamber:4` 或 `plant:0` | 开局选中对象（`ant:1` 是蚁后，`plant:0` 是第一株蚜虫寄主植物） |
| `&follow=1` / `&fly=1` | 配合 `select`：跟随 / 飞到选中对象 |
| `?hour=21.5` | 快进到下一个指定时刻 |
| `?skip=1500` | 开局先在后台快进模拟若干秒（上限 20000），用来直接观察扩建等慢过程 |
| `?new=1` | 不读取存档，从新的蚁群开始（之后的自动保存会覆盖原存档）；每次新开局随机生成一张地图 |
| `?new=1&seed=20261021` | 用指定编号的地图新开局；地图编号显示在存档面板里 |
| `?view=xray,pheromone,roles,stats` | 开局打开地下透视 / 信息素 / 分工着色 / 统计曲线 |
| `?rain=60` | 开局招来一场雨，并在后台快进指定秒数（上限 2000），用来直接观察雨中的蚁穴 |
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

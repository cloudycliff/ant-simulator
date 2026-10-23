# 给开发 Agent 的说明

## 开始工作前
1. 读 `docs/PROGRESS.md`，了解当前状态和已知问题
2. 读 `docs/ROADMAP.md`，确认要做的是哪个阶段的哪一项
3. 涉及架构或数值时，读 `docs/ARCHITECTURE.md` 和 `docs/BALANCE.md`；不要推翻 `docs/DECISIONS.md` 中已采纳的决策，除非需求方同意
4. 要做新游戏或改 `src/core` 的接口时，读 `docs/FRAMEWORK.md`；新游戏的文档从 `docs/templates/` 复制

## 约定
- 代码注释用中文；标识符用英文
- 分层：`src/core` 是可复用的框架层，`src/games/ant` 是蚂蚁游戏的内容。`core` 不能导入 `games/`，跑 `node scripts/core/layercheck.mjs` 检查（DECISIONS T-049）。只有蚂蚁用得上的东西放进 `games/ant`。框架需要游戏的数值或类型时，由游戏传进去（构造参数、泛型），框架不读游戏的配置。`games/aquarium` 是检验框架的鱼缸示例：改了 `src/core` 要跑 `npx tsx scripts/games/aquarium/aquatest.ts`，确认它也能用（T-056）
- 界面文字不直接写在代码里：中文写进 `src/games/ant/i18n/zh.ts`（键以它为准），英文写进 `src/games/ant/i18n/en.ts`，两边都要有；只有框架代码用的文字写进 `src/core/i18n/` 的两份词典。界面用 `t(键, 参数)` 取文字；模拟层用 `L(键, 参数)` 记下延迟翻译的 `Text`，显示时再 `tr()`（DECISIONS T-040）。改了词典跑 `npx tsx scripts/i18ncheck.ts`
- 注释只写代码本身表达不了的约束，不写“下一行做什么”
- 模拟层（`src/core/sim`、`src/games/ant/sim`、`src/games/ant/world`、`src/games/ant/nest/nest.ts`）不能依赖 WebGL 或 DOM，要能在 Node 中运行 `scripts/games/ant/simtest.ts`
- 模拟里的随机只用 `w.rng`，新对象的编号用 `w.ids.next(类型)`（物品用 `colony.newItem`）；不要用 `Math.random` 和模块级计数器，否则同一个存档读两次跑出来不一样（`savetest` 会查）。只影响画面的随机可以用 `Math.random`
- 物品位置变化必须通过 `Colony` 的方法，不要直接改 `Item.place`
- 数值优先放进 `src/games/ant/config.ts`（主循环、后台运行、画质、自动保存这类框架数值在 `src/core/config.ts`）；写在代码里的数值要同步登记到 `docs/BALANCE.md`

## 完成一轮开发后
1. `npm run check` 必须全部通过（类型检查、依赖方向、框架单元测试、界面文字、鱼缸示例、模拟基线、存档 / 工具 / 防御 / 天气测试）。改动中途可以先跑 `npm run check:fast`
2. 改动了行为或数值：模拟基线会报不同。确认是有意的变化后跑 `node scripts/check.mjs --update-baseline`，基线文件随提交一起提交，指标变化写进 `docs/PROGRESS.md`。只是重构时基线必须不变
3. 改动了界面或画面：跑 `npm run check:ui`（会构建并更新根目录的 `cyber-ant-farm.html`，即双击就能运行的发布文件，提交时一并提交），再按 `docs/ARCHITECTURE.md` 的“验证工具”一节截图检查
4. 更新文档：
   - `docs/PROGRESS.md`：追加开发日志，更新当前状态和已知问题
   - `docs/ROADMAP.md`：勾选完成项
   - `docs/DECISIONS.md`：新的决策新增一条，被推翻的旧决策改状态而不删除
   - `docs/BALANCE.md`：记录调参轮次

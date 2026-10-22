# 给开发 Agent 的说明

## 开始工作前
1. 读 `docs/PROGRESS.md`，了解当前状态和已知问题
2. 读 `docs/ROADMAP.md`，确认要做的是哪个阶段的哪一项
3. 涉及架构或数值时，读 `docs/ARCHITECTURE.md` 和 `docs/BALANCE.md`；不要推翻 `docs/DECISIONS.md` 中已采纳的决策，除非需求方同意

## 约定
- 代码注释用中文；标识符用英文
- 分层：`src/core` 是可复用的框架层，`src/games/ant` 是蚂蚁游戏的内容。`core` 不能导入 `games/`，跑 `node scripts/layercheck.mjs` 检查（DECISIONS T-049）。只有蚂蚁用得上的东西放进 `games/ant`。框架需要游戏的数值或类型时，由游戏传进去（构造参数、泛型），框架不读游戏的配置
- 界面文字不直接写在代码里：中文写进 `src/games/ant/i18n/zh.ts`（键以它为准），英文写进 `src/games/ant/i18n/en.ts`，两边都要有；只有框架代码用的文字写进 `src/core/i18n/` 的两份词典。界面用 `t(键, 参数)` 取文字；模拟层用 `L(键, 参数)` 记下延迟翻译的 `Text`，显示时再 `tr()`（DECISIONS T-040）。改了词典跑 `npx tsx scripts/i18ncheck.ts`
- 注释只写代码本身表达不了的约束，不写“下一行做什么”
- 模拟层（`src/core/sim`、`src/games/ant/sim`、`src/games/ant/world`、`src/games/ant/nest/nest.ts`）不能依赖 WebGL 或 DOM，要能在 Node 中运行 `scripts/simtest.ts`
- 物品位置变化必须通过 `Colony` 的方法，不要直接改 `Item.place`
- 数值优先放进 `src/games/ant/config.ts`（主循环、后台运行、画质、自动保存这类框架数值在 `src/core/config.ts`）；写在代码里的数值要同步登记到 `docs/BALANCE.md`

## 完成一轮开发后
1. `npm run build` 必须通过；它会更新根目录的 `cyber-ant-farm.html`（双击即可运行的发布文件），提交时一并提交
2. 改动了行为或数值：跑 `npx tsx scripts/simtest.ts 3000`，把基线指标的变化写进 `docs/PROGRESS.md`。只是重构、不该改变行为时，设 `SIM_SEED` 跑改动前后两次，输出除耗时外应逐行相同
3. 改动了画面：按 `docs/ARCHITECTURE.md` 的“验证工具”一节截图检查
4. 更新文档：
   - `docs/PROGRESS.md`：追加开发日志，更新当前状态和已知问题
   - `docs/ROADMAP.md`：勾选完成项
   - `docs/DECISIONS.md`：新的决策新增一条，被推翻的旧决策改状态而不删除
   - `docs/BALANCE.md`：记录调参轮次

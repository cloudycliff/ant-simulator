# 给开发 Agent 的说明

<!-- 模板：把 <游戏名>、<name> 换成实际的名字，删掉用不上的条目 -->

## 开始工作前
1. 读 `docs/PROGRESS.md`，了解当前状态和已知问题
2. 读 `docs/ROADMAP.md`，确认要做的是哪个阶段的哪一项
3. 涉及架构或数值时，读 `docs/ARCHITECTURE.md` 和 `docs/BALANCE.md`；不要推翻 `docs/DECISIONS.md` 中已采纳的决策，除非需求方同意
4. 第一次接触框架时读 `docs/FRAMEWORK.md`

## 约定
- 代码注释用中文；标识符用英文
- 分层：`src/core` 是框架，`src/games/<name>` 是 <游戏名> 的内容。`core` 不能导入游戏，游戏之间不能互相导入，跑 `node scripts/core/layercheck.mjs` 检查。框架需要游戏的数值或类型时由游戏传进去，框架不读游戏的配置
- 界面文字不直接写在代码里：中文写进 `src/games/<name>/i18n/zh.ts`（键以它为准），英文写进 `en.ts`。界面用 `t(键, 参数)`；模拟层用 `L(键, 参数)` 记下延迟翻译的文字，显示时再 `tr()`。游戏的键不能和框架重名，改写框架文字写进 `overrides.ts`。改了词典跑 `npx tsx scripts/i18ncheck.ts`
- 注释只写代码本身表达不了的约束，不写“下一行做什么”
- 模拟层（`src/core/sim` 和游戏的世界）不能依赖 WebGL 或 DOM，要能在 Node 里跑无界面测试
- 模拟只用世界的 `rng` 和 `ids`（内核给的，会进存档），不用 `Math.random` 和模块级计数器；同一个编号、同样的操作结果相同
- 数值放进 `src/games/<name>/config.ts`；框架数值在 `src/core/config.ts`。写在代码里的数值要同步登记到 `docs/BALANCE.md`

## 完成一轮开发后
1. `npm run check` 必须全部通过（它同时回归仓库里的其他游戏），动了界面再跑 `npm run check:ui`
2. 改动了行为或数值：跑无界面测试，把基线指标的变化写进 `docs/PROGRESS.md`。只是重构、不该改变行为时，用固定编号跑改动前后两次，输出除耗时外应逐行相同
3. 改动了画面：按 `docs/ARCHITECTURE.md` 的“验证工具”一节截图检查，桌面和竖屏手机都看
4. 更新文档：
   - `docs/PROGRESS.md`：追加开发日志，更新当前状态和已知问题
   - `docs/ROADMAP.md`：勾选完成项
   - `docs/DECISIONS.md`：新的决策新增一条，被推翻的旧决策改状态而不删除
   - `docs/BALANCE.md`：记录调参轮次

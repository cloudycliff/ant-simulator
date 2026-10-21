# 给开发 Agent 的说明

## 开始工作前
1. 读 `docs/PROGRESS.md`，了解当前状态和已知问题
2. 读 `docs/ROADMAP.md`，确认要做的是哪个阶段的哪一项
3. 涉及架构或数值时，读 `docs/ARCHITECTURE.md` 和 `docs/BALANCE.md`；不要推翻 `docs/DECISIONS.md` 中已采纳的决策，除非需求方同意

## 约定
- 界面文字、代码注释用中文；标识符用英文
- 注释只写代码本身表达不了的约束，不写“下一行做什么”
- 模拟层（`src/sim`、`src/world`、`src/nest/nest.ts`）不能依赖 WebGL 或 DOM，要能在 Node 中运行 `scripts/simtest.ts`
- 物品位置变化必须通过 `Colony` 的方法，不要直接改 `Item.place`
- 数值优先放进 `src/config.ts`；写在代码里的数值要同步登记到 `docs/BALANCE.md`

## 完成一轮开发后
1. `npm run build` 必须通过；它会更新根目录的 `赛博养蚂蚁.html`（双击即可运行的发布文件），提交时一并提交
2. 改动了行为或数值：跑 `npx tsx scripts/simtest.ts 3000`，把基线指标的变化写进 `docs/PROGRESS.md`
3. 改动了画面：按 `docs/ARCHITECTURE.md` 的“验证工具”一节截图检查
4. 更新文档：
   - `docs/PROGRESS.md`：追加开发日志，更新当前状态和已知问题
   - `docs/ROADMAP.md`：勾选完成项
   - `docs/DECISIONS.md`：新的决策新增一条，被推翻的旧决策改状态而不删除
   - `docs/BALANCE.md`：记录调参轮次

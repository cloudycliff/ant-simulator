# 黑毛蚁蚁群生态模拟器

基于 Three.js 的 Web 版蚂蚁生态模拟。以黑毛蚁 *Lasius niger* 为原型，还原地下蚁穴结构和蚁穴周围的觅食环境。约 1000 只蚂蚁按社会分工自主行动，玩家可以在场景中自由飞行观察，点选蚂蚁和房间查看信息。

当前进度：**第一阶段（可玩原型）已完成**。详见 [docs/PROGRESS.md](docs/PROGRESS.md)。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 生产构建，输出到 dist/
npx tsx scripts/simtest.ts 3000   # 无界面模拟 5 个游戏日，检查行为与平衡
```

## 操作

| 操作 | 按键 |
|---|---|
| 移动 / 下降、上升 / 加速 | `W A S D` / `Q` `E` / `Shift` |
| 转视角 / 平移 / 推进 | 左键拖拽 / 右键拖拽 / 滚轮 |
| 选择 / 飞到目标 | 左键单击 / 双击 |
| 跟随选中的蚂蚁 / 取消选择 | `F` / `Esc` |
| 暂停 / 倍速 1–20× | `空格` / `1`–`5` |
| 地下透视 / 信息素 / 分工着色 / 草丛 / 帮助 | `X` / `P` / `C` / `G` / `H` |

## URL 参数

| 参数 | 作用 |
|---|---|
| `?cam=x,y,z,tx,ty,tz` | 初始相机位置和注视点 |
| `?select=ant:1` 或 `?select=chamber:4` | 开局选中对象（`ant:1` 是蚁后） |
| `&follow=1` / `&fly=1` | 配合 `select`：跟随 / 飞到选中对象 |
| `?hour=21.5` | 从指定时刻开始 |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | 已确认的需求、三阶段计划、工作量预估 |
| [docs/PROGRESS.md](docs/PROGRESS.md) | 当前状态、验证情况、已知问题、开发日志 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 产品与技术决策记录 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码结构、模拟与渲染机制、扩展指南、验证工具 |
| [docs/BALANCE.md](docs/BALANCE.md) | 数值参数一览与调参历史 |

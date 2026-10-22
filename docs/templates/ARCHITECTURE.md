# 架构说明

## 目录结构

```
<name>.html             页面骨架；Vite 的源码模板，不能直接双击运行
src/
  <name>.ts             入口：runApp(<name>Game)
  core/                 框架（见 docs/FRAMEWORK.md），不能导入游戏
  games/<name>/
    game.ts             GameModule：相机、存档、空间、视图开关、工具、点选、面板内容
    config.ts           玩法数值
    <world>.ts          世界（继承 Simulation）：子系统、存档部分、实体类型
    view.ts             场景和每帧同步
    i18n/               中英文词典和改写的框架文字
scripts/
  <name>test.ts         无界面测试
  <name>shots.mjs       截图
docs/
```

## 世界

### 子系统和每步的顺序

<!-- 按 addSystem 的登记顺序列出，写清楚为什么是这个顺序 -->

```
tick: clock → <系统 1> → <系统 2> → ...
```

### 存档

<!-- 存哪几部分、登记顺序（被引用的先登记）、哪些是可选的、版本号的规则 -->

### 实体

<!-- 能选中的对象类型：位置从哪来、观察距离、能否跟随、读档后编号是否稳定 -->

| 类型 | 能跟随 | 观察距离 | 编号稳定 |
|---|---|---|---|
| <类型> | 是 / 否 | <距离> | 是 / 否 |

## 渲染

<!-- 场景里有什么、个体怎么画（实例化网格、着色）、灯光、视图开关各做什么 -->

## 扩展指南

<!-- 加一种个体、一个视图开关、一个工具、一个存档部分时要改哪几处 -->

## 验证工具

### 无界面测试

`npx tsx scripts/<name>test.ts`：<检查哪些项>

### 截图

`node scripts/<name>shots.mjs`（先 `npm run dev`）：<哪些屏幕、哪些场景>，图片在 `shots/<name>/`

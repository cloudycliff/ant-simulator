# 数值平衡

蚁群经济由三部分组成：
- **收入**：觅食蚁带回固体食物（猎物、种子）和液体（蜜露、花蜜，装在嗉囊里）
- **消耗**：成虫进食、喂养幼虫和蚁后
- **损耗**：储食室里的固体食物变质

储备 `reserve` = 储食室固体 + 社会胃（所有工蚁嗉囊之和）。饱食抑制和分工目标都看这个总量。

调整任何一项之后，都要跑 `npx tsx scripts/simtest.ts 3000`（5 个游戏日），最好再跑 `6000`（10 天），确认储备不会单向漂移，人口也不会崩溃。

## 参数一览

### `src/config.ts` 中的参数

| 参数 | 值 | 说明 |
|---|---|---|
| `time.dayLength` | 600 | 一个游戏日对应的模拟秒数 |
| `time.startHour` | 7.5 | 开局时刻 |
| `time.maxStepsPerFrame / frameBudgetMs` | 24 / 10 | 每帧最多补算的模拟步数；每帧模拟最多占用的毫秒数，超出就降低实际倍速 |
| `colony.initialWorkers` | 1000 | 初始工蚁数 |
| `colony.maxPopulation` | 3000 | 成虫 + 幼体的上限（超过后停止产卵） |
| `colony.roleRatio` | 保育 0.26 / 内务 0.24 / 觅食 0.50 | 初始分工比例 |
| `colony.scoutRatio` | 0.12 | 觅食蚁中侦察蚁的比例 |
| `colony.initialFood` | 120 | 初始储备 |
| `colony.initialBrood` | 卵 50 / 幼虫 70 / 蛹 45 | 初始幼体 |
| `colony.eggsPerDay` | 36 | 蚁后吃饱时的日产卵量 |
| `colony.workerLifespanDays` | 45–90 | 工蚁寿命 |
| `brood.eggDays / larvaDays / pupaDays` | 2 / 3.2 / 2.4 | 各发育期天数 |
| `brood.larvaFeedsNeeded` | 3 | 幼虫化蛹前需要被喂食的次数 |
| `ant.lodDistance` | 35 | 离相机超过该距离的工蚁用简化网格、不投影（只影响画面） |
| `ant.personalSpace` | 0.32 | 地表和房间里两只工蚁的中心至少相隔 2 倍该值，蚁后按体型放大 |
| `ant.tunnelGap` | 0.9 | 隧道里前后相距不到该值、左右不到 0.4 cm 的同伴各自横向让开 |
| `ant.speedSurface / speedNest` | 3.2 / 2.4 | 移动速度（cm/s，会再乘温度系数） |
| `ant.hungerPerDay` | 0.4 | 饥饿增长速度（再乘职别系数） |
| `ant.eatAmount` | 0.25 | 每次进食消耗的储备 |
| `ant.senseFoodRadius` | 7 | 嗅到食物的距离 |
| `pheromone.trailHalfLife` | 90 | 路径信息素半衰期（秒） |
| `pheromone.depositFood` | 1.0 | 返巢释放强度基数 |
| `food.initialSources / spawnIntervalSec / maxSources` | 12 / 35 / 20 | 地表食物源 |
| `world.stoneHeat / stoneHeatDepth` | 6 / 26 | 大石块正午对下方土壤的最大加温（°C），到该深度（cm）衰减为 0 |
| `colony.initialCropShare` | 0.4 | 开局嗉囊里带甜液的工蚁比例 |
| `polyethism.reviewDays` | 0.02 | 分工评估间隔（游戏日，约 12 秒） |
| `polyethism.maxShift` | 0.02 | 每次评估最多转换的工蚁比例 |
| `polyethism.ageJitterDays` | 4 | 行为年龄的个体偏移（标准差） |
| `polyethism.nurseBase / nursePerBrood` | 50 / 1.1 | 保育蚁目标 = 50 + 1.1 × 幼体数，限制在工蚁的 12%–45% |
| `social.shareAmount` | 0.3 | 每次交哺传递量（嗉囊容量 1） |
| `social.contactRadius / contactCooldown` | 0.9 / 6–16 秒 | 触角接触距离与冷却 |
| `aphid.colonies` | 6 | 蚜虫群数量（先占寄主植物，再选距巢 80 cm 内的植物） |
| `aphid.initialCount / maxCount` | 16–36 / 80 | 每群初始与最大蚜虫数 |
| `aphid.honeydewPerAphidDay / maxHoneydew` | 0.2 / 6 | 每只蚜虫每天产蜜露量、每群积存上限 |
| `expansion.capacityPerArea` | 1.8 | 每单位地板面积（rx·rz）容纳的成虫 + 幼体 |
| `expansion.trigger` | 0.88 | 占用率超过该值时规划新房间 |
| `expansion.tunnelSoilPerUnit / chamberSoilPerArea` | 4 / 4 | 每 cm 隧道、每单位房间面积需要挖的土粒数 |
| `expansion.maxDiggers / maxChambers` | 18 / 22 | 同时挖掘的内务蚁上限、房间总数上限 |
| `loiter.chance / minTemp` | 0.45 / 14 | 白天待命的觅食蚁改为出巢闲逛的概率；地表低于该温度（°C）不出去 |
| `loiter.offset / radius / time` | 2–7 / 3–5 / 30–80 | 闲逛中心离入口的距离（cm）、闲逛半径（cm）、时长（秒） |
| `expansion.enlargeChance` | 0.4 | 需要扩建时先尝试扩大已有房间的概率；房间数到上限后总是扩大 |
| `expansion.enlargeScale / maxRoomRadius` | 1.2 / 12 | 每次扩大的线性倍数（面积约 1.44 倍）、房间半径上限（cm） |
| `pheromone.homeHalfLife / depositHome` | 900 / 0.03 | 领地足迹的半衰期（秒）与每秒沉积量 |
| `intervention.maxPlacedFood / maxPlacedObstacles` | 30 / 40 | 玩家投放的食物、障碍物同时存在的上限 |
| `intervention.waterRadius` | 4 / 8 | 一点水、一大杯水形成的水洼半径（cm）；倒在已有水洼上会合并成更大的一片 |
| `intervention.waterDays` | 0.25 | 水洼在约 20°C 时完全蒸发所需的游戏日；越冷越慢（见下表） |
| `intervention.washTrail / washHome` | 0.05 / 0.3 | 浇水时浇到的地方信息素保留的比例（路径 / 足迹） |
| `save.autosaveSec` | 60 | 自动保存间隔（现实秒数）；切到后台和关闭页面时也会保存 |
| `predators.spiderPerDay / maxNaturalSpiders` | 1.2 / 2 | 平均每天游荡进来的狼蛛数、同时存在的自然狼蛛上限 |
| `predators.spiderStayDays / spiderMeals` | 0.4–0.8 / 3 | 狼蛛停留的游戏日；吃够 3 只提前离开（玩家放入的不限时，吃够也会离开） |
| `predators.spiderSense / spiderTrailTurn` | 7 / 1.5 | 发现蚂蚁的距离（cm）；游荡时朝足迹浓的一侧转向的角速度（rad/s） |
| `predators.spiderWalk / spiderRush` | 2.2 / 6 | 游荡、扑击速度（cm/s，乘温度系数） |
| `predators.spiderCatch / spiderRushTime / spiderFeedSec` | 0.6 / 3.5 / 90 | 扑到身边时的捕获概率；扑击超时（秒）；进食时长（秒） |
| `predators.antlions / pitRadius` | 3 / 2.6 | 开局的蚁狮陷阱数（距巢 18–75 cm、草少的地面）；陷阱半径（cm） |
| `predators.pitPull / antlionFeedSec` | 2.2 / 240 | 坑壁把蚂蚁往中心拉的速度（cm/s）；蚁狮进食时长（秒） |
| `predators.maxSpiders / maxPlacedAntlions` | 4 / 8 | 狼蛛总数上限、玩家放入的蚁狮上限 |
| `defense.alarmHalfLife / alarmRadius / alarmMax` | 6 / 10 / 1.5 | 警报信息素半衰期（秒）、有效半径（cm）、单处强度上限 |
| `defense.alarmOnAttack / mobEmit` | 1 / 0.5 | 狼蛛扑击时释放的警报强度；每只围攻工蚁每秒补充的强度 |
| `defense.respondLevel / defendSec` | 0.15 / 15–30 | 闻到的浓度超过该值就去增援；增援持续秒数 |
| `defense.rushSpeed / chaseRange / biteRange` | 1.3 / 12 / 1.3 | 增援时速度倍数；发现狼蛛的距离、贴身撕咬的距离（cm） |
| `defense.harassLimit / harassRecover` | 14 / 1 | 狼蛛被咬程度（工蚁数 × 秒）的上限，超过就逃走；没被咬时每秒恢复量 |
| `defense.mobKillPerSec` | 0.025 | 围攻时每只工蚁每秒被咬死的概率 |
| `defense.guardRadius / holdBackProb / guardProb / maxGuards` | 20 / 0.7 / 0.5 / 24 | 狼蛛离入口多近算威胁；受威胁时觅食蚁留巢的概率、内务蚁出巢警戒的概率与人数上限 |
| `defense.pitAvoidPad` | 1 | 记住陷阱的蚂蚁在陷阱半径外再留出的距离（cm） |
| `weather.rainPerDay / firstRainDay` | 0.6 / 1 | 平均每天下雨次数（每游戏小时判定一次）；第一个游戏日不自然下雨 |
| `weather.overcastSec / rainDays / rainStrength` | 25 / 0.1–0.25 / 0.45–1 | 下雨前转阴的秒数；一场雨的游戏日长度；雨势范围（> 0.75 显示为大雨） |
| `weather.rainCool` | 5 | 阴雨时地表降温（°C × 云量），随深度按与日较差相同的阻尼衰减 |
| `weather.rainTrailHalfLife / rainHomeHalfLife` | 8 / 90 | 大雨中路径信息素、领地足迹的附加消散半衰期（秒），按雨势缩放后与晴天的半衰期叠加 |
| `weather.puddlePerSec / puddleRadius` | 0.06 / 2.5–5 | 大雨中每秒积出一个水洼的概率（× 雨势）；水洼半径（cm） |
| `weather.soakSec / drySec` | 40 / 240 | 大雨下地面湿透的秒数；雨后晾干的基准秒数（随温度、云量变化） |
| `weather.rainSlow` | 0.4 | 大雨中地表移动减速比例 |
| `weather.reopenWet` | 0.45 | 雨停后地面湿润度低于该值才清开入口、恢复出巢 |
| `weather.plugPerLoad / maxPluggers` | 0.2 / 4 | 每次封堵 / 清开改变的封堵程度；同一入口同时干活的内务蚁上限 |
| `weather.floodDepth / floodRate / drainRate` | 14 / 0.09 / 0.003 | 会进水的最大房间深度（cm）；每秒进水量（× 雨势 × 入口平均敞开程度 × 浅度）；每秒渗干量 |
| `weather.floodedAt / floodSpoil` | 0.25 / 3 | 积水达到该值算进水（蛹搬走）；进水的储食室变质加快倍数 |

### 写在代码里的数值

| 位置 | 数值 | 说明 |
|---|---|---|
| `colony.ts` `update` | 饥饿系数：蚁后 1.4、觅食蚁 1.15、其他 0.85 | |
| `colony.ts` `update` | 饥饿到 1 后健康每天下降 0.35；吃饱时每天恢复 0.4 | 饥饿到死约需 3 天 |
| `colony.ts` `update` | 产卵额度上限 4；蚁后饥饿度 ≥ 0.8 时产卵速度降为 30% | |
| `colony.ts` `developBrood` | 幼虫饥饿每天增长 1.3；饥饿 ≥ 1 时发育减慢；饥饿大于 3.5 时死亡 | |
| `colony.ts` `developBrood` | 蛹发育完成 0.5 天后若无保育蚁帮助则自行羽化 | |
| `colony.ts` `updateStores` | 猎物 2.5 天、种子 1.5 天变成垃圾 | 甜液不再进储食室，所以没有干涸规则 |
| `colony.ts` `takeFood` | 吃完时有 30% 概率留下残渣 | |
| `colony.ts` `reviewRoles` | 觅食蚁目标比例 = `lerp(0.58, 0.40, smoothstep(0.5, 3, 储备天数))`，且不超过 `86% − 保育蚁` | 储备天数 = 储备 / (工蚁 × 0.12 + 幼虫 × 1.3) |
| `colony.ts` `reviewRoles` | 逆向转换只在目标职别低于目标 85% 时发生；觅食蚁低于目标 85% 时视为短缺 | |
| `colony.ts` `tryContact` | 每 8 步检测一次；50% 概率发生接触；停顿 0.6–1.3 秒 | |
| `colony.ts` `exchange` | 被满载同伴激发后 90 秒内：夜间留巢概率 0.6 → 0.3，饱食抑制 ×0.3 | |
| `colony.ts` `updateClimate` | 每 0.01 天评估；蛹的评分以 30°C 为最佳；切换阈值 1.2°C | |
| `colony.ts` `updateBrood` | 蛹发育速度系数 = `clamp(0.6 + (温度 − 16) × 0.05, 0.6, 1.3)` | |
| `aphids.ts` `update` | 被照料（90 秒内有蚂蚁来过）增长率 0.35/天，否则 0.1/天并损失 0.08/天 | Logistic，上限 `maxCount` |
| `routines.ts` `tendAphids` | 采集时停留 6–10 秒；蜜露少于 0.6 时守护 25–45 秒；返巢信息素强度 0.8 | |
| `routines.ts` `pickHerd` | 有固定蚜虫群的觅食蚁 80% 回到该群；其他非侦察蚁 30% 按蜜露量挑一群 | |
| `routines.ts` `eat` | 先喝自己嗉囊 → 60% 概率向同伴乞食 → 储食室 → 在储食室乞食 | |
| `routines.ts` 内务蚁 | 有扩建项目时挖掘概率 0.45，否则 0.15 | |
| `expansion.ts` | 每 0.05 天检查一次；挖隧道每粒土延长 0.25 cm；新房间锚定在深于 8 cm 的分岔点，距巢中心 40 cm 内；扩大房间要求与其他房间相距 2 cm、与其他隧道相距 1.2 cm，挖掘点在地板椭圆 0.62 倍处的随机方向 | |
| `ant.ts` `stepSearch` | 侦察蚁前方足迹浓度大于 0.3 时转向足迹最少的方向；嗅到蚜虫群的距离 1.9 cm | |
| `pheromone.ts` | 路径信息素单格上限 12，足迹上限 4 | |
| `colony.ts` `dropOnMound` | 蚁丘土粒上限 1200 | |
| `routines.ts` `wantsToEat` | 饥饿大于 0.6 时去进食；失败后冷却 30–60 秒 | |
| `routines.ts` `eat` | 进食后饥饿减 0.85 | |
| `routines.ts` `fetchFood` | 喂幼虫或蚁后每次取 0.45 份 | |
| `routines.ts` 觅食蚁 | **饱食抑制**：留巢概率 = `min(0.9, max(0, (储备 − 150) / 200))`，侦察蚁减半 | 控制收入的主要旋钮 |
| `routines.ts` 觅食蚁 | 夜间 60% 概率休息；地表低于 8°C 时全部休息 | |
| `routines.ts` 觅食蚁 | 搜索超时：普通 140 秒，侦察蚁 220 秒 | |
| `routines.ts` 觅食蚁 | 返巢信息素强度 = `depositFood × (0.5 + 食物源剩余比例)`，侦察蚁 ×1.3 | |
| `ant.ts` `stepSearch` | 随机游走转向噪声 1.4·√dt | 过大会让搜索范围变小 |
| `ant.ts` `speedFactor` | 速度系数 = `clamp((温度 − 4) / 18, 0.3, 1.25)`；温度部分每只蚂蚁缓存 0.5 秒，换位置域时重算 | |
| `ant.ts` `avoid` | 走动中的蚂蚁被推开的速度最多 0.18 cm/s，停着的 0.6 cm/s；推开后离房间中心超过地板椭圆的 0.8 倍就不推 | 走动中的推力必须小于步速，否则带目标点的指令可能永远走不到 |
| `ant.ts` `shiftSide` | 隧道里横向让开量 = 0.5 × 重叠量；车道偏移限制在隧道半径的 ±0.55 倍；没有冲突时每秒回落一半；巢内个体步速 0.88–1.12 | |
| `terrain.ts` `GRID_STEP` | 地形高度查表间距 0.5 cm（双线性插值） | 与解析式相比平均误差约 0.001 cm，个别陡坡处最大约 0.2 cm |
| `water.ts` `update` | 蒸发速度系数 = `max(0.3, 0.4 + 地表温度 / 33)`；水量低于 0.04 时消失；每 0.5 秒冲刷一次水洼范围（路径信息素清零，足迹保留 60%） | 水洼半径 = 初始半径 × √水量 |
| `ant.ts` `surfaceMove` | 遇到水洼先绕行，绕了 4 秒还没绕开就蹚水；在水里速度 ×0.35；离开后蹚水计时以一半速度回落 | |
| `ant.ts` `skirt` | 沿障碍物边缘绕行，选定的方向保持 1.5 秒；连续 3 秒没有走出 3 cm 就换另一边 | 防止在凹角里来回摆动 |
| `vegetation.ts` `OBSTACLE_INFO` | 小石子半径 1.6、大石块 4；树枝路障长 18、由间距 0.9 的半径 0.5 圆串成 | |
| `clock.ts` | 地表平均温度 19°C，日较差 ±9°C，阻尼深度 12 cm | |
| `predators.ts` 狼蛛 | 游荡中每秒 6% 概率停下 4–12 秒；游荡目标点距巢 12–70 cm，朝目标转向 0.6 rad/s；扑空后停 2–5 秒；离开时速度 ×1.6，90 秒内没走出去就直接消失 | 停得太多时狼蛛到不了蚂蚁密集的内圈 |
| `predators.ts` 蚁狮 | 蚂蚁离坑中心 0.77 cm 内被抓；进食期间坑壁拉力 ×0.35；空壳甩到坑外 0.8 cm | |
| `ant.ts` `defend` | 每 0.5 秒检查一次警报；附近没有狼蛛时先走到警报源，再以 0.7 倍速在 1.5 cm 内搜寻；贴身撕咬时增援时间至少保持 2 秒 | |
| `ant.ts` `surfaceMove` | 记住的陷阱绕行超过 6 秒就忘掉它 | 防止食物就在坑边时永远绕圈 |
| `predators.ts` 狼蛛 | 被赶走后逃离速度为游荡速度 ×2.4（正常离开 ×1.6） | |
| `ant.ts` `surfaceMove` | 在陷阱里速度 ×0.4；拉力 = `pitPull × (0.4 + 0.6 × (1 − r / 半径))`；进坑 0.6 秒后转身往外爬 | 平常温度下约 70% 半径以内就爬不出来 |
| `weather.ts` | 转阴时 60%、下雨时 100% 的地表空手工蚁中断任务返巢；雨势过渡时间常数 6 秒，云量 12 秒；云量 = 0.6 + 0.4 × 雨势；玩家招雨时转阴只持续 8 秒 | |
| `weather.ts` `rainPuddle` | 水洼离入口至少 半径 + 5 cm，避开石块植物、食物源和蚁狮陷阱；最多尝试 6 个位置 | |
| `routines.ts` | 内务蚁有封堵 / 清开任务时 80% 领取；封堵一次干 3–5 秒；入口封着时挖下的土压在隧道壁上，耗时 2–3 秒 | |
| `clock.ts` | 地表湿度 = `62 − 18 × 太阳高度 + 34 × 地面湿润度`，上限 98% | |
| `world.ts` `chamberTemperature` | 石块加温乘 `(1 − 云量)` | |

## 调参历史

| 轮次 | 改动 | 结果 |
|---|---|---|
| 初版 | 饥饿 1.0/天，进食 0.4 份，转向噪声约为现在的 3 倍 | 第 2 天储食耗尽；饥饿的蚂蚁卡在“进食”循环里，觅食蚁也不出门；第 4 天死亡 351 只 |
| 第 2 版 | 饥饿 0.4/天，进食 0.25 份；进食失败后冷却；觅食蚁在食物源处进食；修正转向噪声；食物源 12 / 35 秒 / 20 | 蚁群稳定，但 5 天积累了 2000 份储备 |
| 第 3 版 | 加入饱食抑制 `(储备 − 180) / 250`；猎物和种子会变质 | 储备仍涨到约 1200 份（甜液不会变质） |
| 第 4 版 | 甜液 4 天干涸；抑制改为 `(储备 − 100) / 150`，上限 0.95 | 储备 360–700 份，但巢外只有 60–100 只，太冷清 |
| 第 5 版 | 抑制放宽到 `(储备 − 200) / 250`，上限 0.85 | 巢外 110–250 只，但储备又涨到约 1000 份 |
| 第 6 版（第一阶段终版） | 抑制取中间值 `(储备 − 150) / 200`，上限 0.9；初始储备 120 | 储备 560–900 份，巢外 90–180 只，人口 1001 → 1066 |
| 第 7 版（第二阶段初版） | 加入社会胃、按需分工、蚜虫、扩建；觅食蚁目标比例 `lerp(0.6, 0.42, smoothstep(1, 5, 储备天数))`，上限 `90% − 保育蚁` | 经济稳定，但内务蚁被压到约 12%；大量蚂蚁在去深层休息室的路上 |
| **当前** | 觅食蚁目标改为 `lerp(0.58, 0.40, smoothstep(0.5, 3, 储备天数))`，上限改为 `86% − 保育蚁`（内务蚁至少 14%）；休息时在两间休息室中选近的；石块加温随深度衰减 | 10 天：人口 1001 → 1100，固体 230–620、社会胃 135–240，巢外 80–160 只，扩建 3 间 |

## 调参建议
- **想让地表更热闹**：先调 `loiter.chance` 和 `loiter.time`，闲逛不带食物回来，不影响收入；提高饱食抑制公式里的阈值（150）或加快变质也行，但储食室会堆积更多
- **想让人口增长更快**：提高 `eggsPerDay` 或缩短发育期；人口受 `maxPopulation` 限制
- **觅食效率不够**：先检查 `senseFoodRadius`、搜索超时和转向噪声，再考虑增加食物源
- **想让蚁穴扩建更频繁**：降低 `expansion.capacityPerArea` 或 `trigger`；挖掘速度看 `maxDiggers` 和内务蚁的挖掘概率
- **分工比例**：保育蚁看 `nurseBase / nursePerBrood`，觅食蚁看 `reviewRoles` 里的 58%–40% 区间
- **蜜露太多 / 太少**：调 `aphid.honeydewPerAphidDay`；社会胃有嗉囊容量的天然上限，不会无限堆积
- **雨后停摆太久**：降低 `weather.drySec` 或提高 `reopenWet`；想让进水更常见就提高 `floodRate`，或缩短 `overcastSec`（内务蚁来不及封好）

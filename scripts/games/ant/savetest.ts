// 存档往返测试：运行一段时间后存档，读进新世界，对比关键指标，再各自继续运行
// 用法：npx tsx scripts/games/ant/savetest.ts [存档前模拟秒数，默认 1900] [tunnel|chamber：继续运行到扩建处于该阶段再存档]
import { tr } from '../../../src/core/i18n';
import { World } from '../../../src/games/ant/world/world';
import { loadWorld, saveWorld, type SaveData } from '../../../src/games/ant/world/save';

const step = 1 / 30;
const run = (w: World, sec: number) => {
  for (let i = Math.round(sec / step); i > 0; i--) w.advance(step);
};

function metrics(w: World): Record<string, string | number> {
  const c = w.colony;
  const b = c.broodCounts();
  const p = c.expansion.project;
  let pher = 0;
  for (const v of w.pheromone.trail) pher += v;
  return {
    time: tr(w.clock.stamp()),
    ants: c.ants.length,
    outside: c.outsideCount(),
    brood: `${b.egg}/${b.larva}/${b.pupa}`,
    items: c.items.size,
    food: c.foodStock.toFixed(1),
    liquid: c.liquidStock.toFixed(1),
    chambers: w.nest.chambers.length,
    edges: w.nest.edges.length,
    project: p ? `${p.type} ${p.enlarge ? `扩大#${p.chamber!.id} ${(p.soil / p.soilNeeded).toFixed(2)} r=${p.chamber!.rx.toFixed(2)}` : p.chamber ? `房间 ${(p.soil / p.soilNeeded).toFixed(2)}` : `隧道 ${(p.face.len / p.face.full.length).toFixed(2)}`}` : '-',
    sources: w.food.sources.length,
    aphids: w.aphids.colonies.map((a) => `${Math.round(a.count)}${a.dispersing ? '*' : ''}`).join(','),
    ladybugs: `${w.ladybugs.ladybugs.map((l) => `${w.aphids.colonies.indexOf(l.colony)}:${l.state}:${l.eaten}`).join(',')} / ${w.ladybugs.visits},${w.ladybugs.repelled},${w.ladybugs.eaten}`,
    pheromone: Math.round(pher),
    placed: w.veg.placed.map((p) => (p.kind === 'twig' ? p.kind : `${p.kind}#${p.shape.toFixed(4)}`)).join(' '),
    puddles: w.water.puddles.length,
    predators: `${w.predators.spiders.map((s) => s.state).join(',')} / ${w.predators.antlions.map((p) => `${p.caught}${p.feedT > 0 ? '*' : ''}`).join(',')}`,
    stats: JSON.stringify(c.stats),
    weather: JSON.stringify(w.weather.toSave(w)),
  };
}

function check(w: World): string[] {
  const c = w.colony;
  const bad: string[] = [];
  c.byChamber.forEach((arr, id) => arr.forEach((it) => it.place !== 'chamber' || it.chamber !== id ? bad.push(`物品 ${it.id} 索引错误`) : 0));
  for (const it of c.items) if (it.place === 'carried' && !c.ants.some((a) => a.carrying === it)) bad.push(`物品 ${it.id} 无人携带`);
  for (const a of c.ants) if (a.domain === 'nest' && a.room < 0 && !w.nest.nodes[a.currentNode(w)]) bad.push(`蚂蚁 ${a.id} 位置无效`);
  return bad.slice(0, 5);
}

const before = Number(process.argv[2]) || 1900;
// SEED=数字：用指定种子的世界测试（默认是固定种子）
const a = new World(Number(process.env.SEED) || undefined);
run(a, 60);
a.placeObstacle('twig', 14, 2, Math.PI / 2);
for (const [x, z] of [[-20, 26], [24, -22], [-28, -14], [30, 18]]) if (a.placeObstacle('rock', x, z, 0.7).ok) break;
a.dropFood('syrup', 25, 2);
a.pourWater(19, 12, true);
run(a, before - 60);
// 第二个参数：tunnel / chamber / enlarge 等扩建进行到对应阶段再存档；rain 在下雨、入口封堵中途存档
const stage = process.argv[3];
if (stage === 'rain') {
  a.callRain();
  run(a, 40);
}
for (let t = 0; stage && stage !== 'rain' && t < 12000; t += 10) {
  const p = a.colony.expansion.project;
  if (p && (stage === 'enlarge' ? !!p.enlarge && p.soil > 5 : !p.enlarge && (stage === 'chamber') === !!p.chamber)) break;
  run(a, 10);
}
// 存档时有一只正在吃蚜虫的瓢虫
const aph = a.aphids.colonies[0];
a.placeLadybug(aph.x, aph.z);
run(a, 5);

const t0 = performance.now();
const json = JSON.stringify(saveWorld(a, Date.now()));
const t1 = performance.now();
const data = JSON.parse(json) as SaveData;
const b = new World(data.seed);
const t2 = performance.now();
loadWorld(b, data);
const t3 = performance.now();
console.log(`存档 ${(json.length / 1024).toFixed(0)} KB，序列化 ${(t1 - t0).toFixed(0)} ms，新建世界 ${(t2 - t1).toFixed(0)} ms，读档 ${(t3 - t2).toFixed(0)} ms`);
const sizes = Object.entries(data).map(([k, v]) => `${k} ${(JSON.stringify(v).length / 1024).toFixed(0)}`);
console.log(`各部分（KB）：${sizes.join('  ')}`);

/** 读档后必须原样恢复的指标 */
const EXACT = ['ants', 'outside', 'brood', 'items', 'food', 'liquid', 'chambers', 'edges', 'project', 'sources', 'aphids', 'ladybugs', 'placed', 'puddles', 'predators', 'stats', 'weather'];
const problems: string[] = [];
const ma = metrics(a);
const mb = metrics(b);
console.log('\n指标            原世界 | 读档后');
for (const k of Object.keys(ma)) console.log(`${k.padEnd(10)} ${ma[k]} | ${mb[k]}${ma[k] === mb[k] ? '' : '   ← 不同'}`);
for (const k of EXACT) if (ma[k] !== mb[k]) problems.push(`读档后 ${k} 不同`);
// 信息素按 8 位量化存档，总量允许差一点
const pa = Number(ma.pheromone);
if (Math.abs(pa - Number(mb.pheromone)) > Math.max(2, pa * 0.005)) problems.push('读档后 pheromone 不同');
const carryA = a.colony.ants.filter((x) => x.carrying).length;
const carryB = b.colony.ants.filter((x) => x.carrying).length;
console.log(`搬运中的物品：原世界 ${carryA} 件，读档后 ${carryB} 件`);
if (carryA !== carryB) problems.push('读档后搬运中的物品数不同');
const held = b.colony.ants.filter((x) => x.carrying).map((x) => [x, x.carrying!] as const);
const bad1 = check(b);
console.log('一致性检查：', bad1.join('；') || '通过');
problems.push(...bad1);

// 读档后接着做正在做的那一步：位置不跳、活动说明不变，几秒后大多还和原世界走在一起
const twins = a.colony.ants.map((x) => [x, b.colony.antById(x.id)] as const).filter((p) => p[1]);
const jumped = twins.filter(([x, y]) => x.pos.distanceTo(y!.pos) > 0.01).length;
const sameAct = twins.filter(([x, y]) => tr(x.activity) === tr(y!.activity)).length;
const climbing = [a, b].map((wd) => wd.colony.ants.filter((x) => x.climbing).length);
const kindAt = new Map(twins.map(([x]) => [x.id, x.behavior.cmd?.k ?? '-']));
console.log(`读档后位置变了的 ${jumped} 只，活动说明相同的 ${sameAct}/${twins.length} 只，爬在植物上的 ${climbing[0]} | ${climbing[1]} 只`);
if (jumped) problems.push(`读档后有 ${jumped} 只蚂蚁位置变了`);
if (sameAct < twins.length * 0.99) problems.push(`读档后活动说明不同的有 ${twins.length - sameAct} 只`);
if (climbing[0] !== climbing[1]) problems.push('读档后爬在植物上的蚂蚁数不同');
// 对照：去掉“正在做的那一步”和个体计时，相当于较早的存档，读档后都从新任务开始
const old = JSON.parse(json) as SaveData;
for (const x of old.colony.ants) {
  delete x.step;
  delete x.ind;
  delete x.fx;
}
const o = new World(old.seed);
loadWorld(o, old);
run(a, 5);
run(b, 5);
run(o, 5);
/** 和原世界相差不到 1 cm 的蚂蚁；按读档时的指令分别数走散的 */
const together = (wd: World) => {
  const apart = new Map<string, number[]>();
  let n = 0;
  for (const [x] of twins) {
    const y = wd.colony.antById(x.id);
    const v = apart.get(kindAt.get(x.id)!) ?? [0, 0];
    v[1]++;
    if (x.alive && y?.alive && x.pos.distanceTo(y.pos) < 1) n++;
    else v[0]++;
    apart.set(kindAt.get(x.id)!, v);
  }
  return { n, apart: [...apart].map(([k, [m, all]]) => `${k} ${m}/${all}`).join('，') };
};
const tb = together(b);
const to = together(o);
console.log(`再运行 5 秒，和原世界相差不到 1 cm 的 ${tb.n}/${twins.length} 只（不接着做这一步时 ${to.n} 只）`);
console.log(`  走散的，按读档时的指令：${tb.apart}`);
console.log(`  不接着做时：${to.apart}`);
if (tb.n < twins.length * 0.5) problems.push(`读档 5 秒后只有 ${tb.n} 只还和原世界在一起`);

run(a, 1195);
run(b, 295);
const stuck = held.filter(([x, it]) => x.alive && x.carrying === it).length;
console.log(`读档时搬运中的 ${held.length} 件，300 秒后还拿在原来的蚂蚁手里：${stuck} 件`);
if (stuck) problems.push(`读档后有 ${stuck} 件东西一直没送到`);
run(b, 900);
const ma2 = metrics(a);
const mb2 = metrics(b);
console.log('\n再运行 1200 秒');
for (const k of Object.keys(ma2)) if (k !== 'stats') console.log(`${k.padEnd(10)} ${ma2[k]} | ${mb2[k]}`);
const bad2 = check(b);
console.log('一致性检查：', bad2.join('；') || '通过');
problems.push(...bad2);
if (b.colony.ants.length < 0.9 * a.colony.ants.length) problems.push('读档后的世界蚂蚁明显变少');

const c = new World(data.seed);
loadWorld(c, data);
run(c, 1200);
const mc2 = metrics(c);
const diverged = Object.keys(mb2).filter((k) => mb2[k] !== mc2[k]);
console.log(`同一个存档再读一次、同样跑 1200 秒：${diverged.length ? `${diverged.join('、')} 不同` : '和第一次完全相同'}`);
if (diverged.length) problems.push(`同一个存档两次读档后的运行不同（${diverged.join('、')}）`);
console.log(problems.length ? `失败：${problems.join('；')}` : '全部通过');
if (problems.length) process.exitCode = 1;

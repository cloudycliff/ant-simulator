// 存档往返测试：运行一段时间后存档，读进新世界，对比关键指标，再各自继续运行
// 用法：npx tsx scripts/savetest.ts [存档前模拟秒数，默认 1900] [tunnel|chamber：继续运行到扩建处于该阶段再存档]
import { World } from '../src/world/world';
import { loadWorld, saveWorld, type SaveData } from '../src/world/save';

const step = 1 / 30;
const run = (w: World, sec: number) => {
  for (let t = 0; t < sec; t += step) w.advance(step);
};

function metrics(w: World): Record<string, string | number> {
  const c = w.colony;
  const b = c.broodCounts();
  const p = c.expansion.project;
  let pher = 0;
  for (const v of w.pheromone.trail) pher += v;
  return {
    time: w.clock.stamp(),
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
    aphids: w.aphids.colonies.map((a) => Math.round(a.count)).join(','),
    pheromone: Math.round(pher),
    placed: w.veg.placed.length,
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
const a = new World();
run(a, 60);
a.placeObstacle('twig', 14, 2, Math.PI / 2);
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

const t0 = performance.now();
const json = JSON.stringify(saveWorld(a, Date.now()));
const t1 = performance.now();
const data = JSON.parse(json) as SaveData;
const b = new World();
const t2 = performance.now();
loadWorld(b, data);
const t3 = performance.now();
console.log(`存档 ${(json.length / 1024).toFixed(0)} KB，序列化 ${(t1 - t0).toFixed(0)} ms，新建世界 ${(t2 - t1).toFixed(0)} ms，读档 ${(t3 - t2).toFixed(0)} ms`);
const sizes = Object.entries(data).map(([k, v]) => `${k} ${(JSON.stringify(v).length / 1024).toFixed(0)}`);
console.log(`各部分（KB）：${sizes.join('  ')}`);

const ma = metrics(a);
const mb = metrics(b);
console.log('\n指标            原世界 | 读档后');
for (const k of Object.keys(ma)) console.log(`${k.padEnd(10)} ${ma[k]} | ${mb[k]}${ma[k] === mb[k] ? '' : '   ← 不同'}`);
console.log('一致性检查：', check(b).join('；') || '通过');

run(a, 1200);
run(b, 1200);
const ma2 = metrics(a);
const mb2 = metrics(b);
console.log('\n再运行 1200 秒');
for (const k of Object.keys(ma2)) if (k !== 'stats') console.log(`${k.padEnd(10)} ${ma2[k]} | ${mb2[k]}`);
console.log('一致性检查：', check(b).join('；') || '通过');

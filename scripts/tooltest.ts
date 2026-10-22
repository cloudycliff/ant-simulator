/** 干预工具的无界面回归测试：npx tsx scripts/tooltest.ts */
import { tr } from '../src/core/i18n';
import { World, type ToolResult } from '../src/games/ant/world/world';

const w = new World();
const step = 1 / 30;
const run = (sec: number) => {
  for (let t = 0; t < sec; t += step) w.advance(step);
};

const log = (r: ToolResult) => console.log(r.ok ? 'OK ' : 'ERR', r.msg ? tr(r.msg) : '');

run(60);
// 蚁穴东侧 25 cm 处投放糖水，在它和入口之间横一根树枝、放一块大石，再浇一大杯水
log(w.dropFood('syrup', 25, 2));
log(w.placeObstacle('twig', 14, 2, Math.PI / 2));
log(w.placeObstacle('rock', 19, -8, 0));
log(w.pourWater(19, 8, true));
log(w.placeObstacle('rock', 0.5, 0.5, 0));
log(w.dropFood('syrup', 300, 0));
log(w.removeObstacle(50, 50));

const syrup = w.food.sources.find((s) => s.placed)!;
const start = syrup.amount;
const last = new Map<number, [number, number, number]>();
let stuckMax = 0;
for (let k = 0; k < 12; k++) {
  run(50);
  let stuck = 0;
  const kinds = new Map<string, number>();
  for (const a of w.colony.ants) {
    if (a.domain !== 'surface' || a.holdT > 0 || a.climbing) {
      last.delete(a.id);
      continue;
    }
    const p = last.get(a.id);
    const moved = p ? Math.hypot(a.pos.x - p[0], a.pos.z - p[1]) : 99;
    if (p && moved < 0.3 && a.moving) {
      stuck++;
      const k = `${tr(a.activity).replace(/#\d+/g, '#')}@${a.pos.x.toFixed(0)},${a.pos.z.toFixed(0)}`;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    last.set(a.id, [a.pos.x, a.pos.z, 0]);
  }
  if (kinds.size) console.log('   ', [...kinds].slice(0, 6).map(([k, n]) => `${n}×${k}`).join(' | '));
  stuckMax = Math.max(stuckMax, stuck);
  const pd = w.water.puddles[0];
  console.log(
    `t=${(60 + (k + 1) * 50).toString().padStart(4)}s 糖水剩余 ${syrup.amount}/${start}  巢外 ${w.colony.outsideCount()}  原地打转 ${stuck}  水洼 ${pd ? pd.r.toFixed(1) + 'cm' : '已干'}  事件: ${w.events.entries[0] ? tr(w.events.entries[0].msg) : ''}`,
  );
}
console.log('最多同时原地打转的蚂蚁', stuckMax);
log(w.removeObstacle(14, 2));
console.log('剩余玩家障碍物', w.veg.placed.length, '避障圆总数', w.veg.obstacles.length);

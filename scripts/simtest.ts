/** 无界面运行模拟，检查行为循环与性能：npx tsx scripts/simtest.ts [模拟秒数] */
import { World } from '../src/world/world';

const total = Number(process.argv[2] ?? 1200);
const t0 = performance.now();
const world = new World();
console.log(`init ${(performance.now() - t0).toFixed(0)} ms, ants=${world.colony.ants.length}, chambers=${world.nest.chambers.length}, nodes=${world.nest.nodes.length}`);

const step = 1 / 30;
let simT = 0;
let tickMs = 0;
let ticks = 0;
let nextReport = 0;
while (simT < total) {
  const s = performance.now();
  world.advance(step);
  tickMs += performance.now() - s;
  ticks++;
  simT += step;
  if (simT >= nextReport) {
    nextReport += total / 8;
    const c = world.colony;
    const acts = new Map<string, number>();
    for (const a of c.ants) {
      const k = a.activity.replace(/#\d+/g, '#').replace(/\d+/g, 'n');
      acts.set(k, (acts.get(k) ?? 0) + 1);
    }
    const top = [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const bc = c.broodCounts();
    let pher = 0;
    for (const v of world.pheromone.trail) pher += v;
    console.log(
      `\n[${world.clock.stamp()}] ants=${c.ants.length} outside=${c.outsideCount()} food=${c.foodStock.toFixed(1)} ` +
        `brood=${JSON.stringify(bc)} stats=${JSON.stringify(c.stats)} sources=${world.food.sources.length} pher=${pher.toFixed(0)} ` +
        `queenHunger=${c.queen.hunger.toFixed(2)} avg tick=${(tickMs / ticks).toFixed(2)}ms`,
    );
    for (const [k, v] of top) console.log(`   ${v.toString().padStart(4)}  ${k}`);
    tickMs = 0;
    ticks = 0;
  }
}

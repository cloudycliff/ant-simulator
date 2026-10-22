/**
 * 无界面运行模拟，检查行为循环与性能：npx tsx scripts/simtest.ts [模拟秒数]
 * 设了环境变量 SIM_SEED 时结果可复现，重构前后可以逐行对比
 */
import { tr } from '../src/core/i18n';
import { rng } from '../src/core/util/random';
import { World } from '../src/games/ant/world/world';

const total = Number(process.argv[2] ?? 1200);
if (process.env.SIM_SEED) rng.reseed(Number(process.env.SIM_SEED));
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
      const k = tr(a.activity).replace(/#\d+/g, '#').replace(/\d+/g, 'n');
      acts.set(k, (acts.get(k) ?? 0) + 1);
    }
    const top = [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const bc = c.broodCounts();
    const rc = c.roleCounts();
    const t = c.targets;
    const ex = c.expansion;
    const p = ex.project;
    const aph = world.aphids.colonies.map((x) => `${Math.round(x.count)}${x.discovered ? '*' : ''}/${x.honeydew.toFixed(1)}`).join(' ');
    let pher = 0;
    let home = 0;
    for (const v of world.pheromone.trail) pher += v;
    for (const v of world.pheromone.home) home += v;
    console.log(
      `\n[${tr(world.clock.stamp())}] ants=${c.ants.length} outside=${c.outsideCount()} food=${c.foodStock.toFixed(1)} liquid=${c.liquidStock.toFixed(1)} ` +
        `brood=${JSON.stringify(bc)} queenHunger=${c.queen.hunger.toFixed(2)} avg tick=${(tickMs / ticks).toFixed(2)}ms\n` +
        `  roles N${rc.nurse}/${t.nurse} M${rc.maintenance}/${t.maintenance} F${rc.forager}/${t.forager}  ` +
        `pupae@${tr(world.nest.chambers[c.pupaChamber].label)}  occupancy=${(ex.occupancy() * 100).toFixed(0)}% chambers=${world.nest.chambers.length} ` +
        `enlarged=${ex.enlarged} project=${p ? `${p.enlarge ? `enlarge#${p.chamber!.id} ` : ''}${p.type} tunnel ${p.face.len.toFixed(1)}/${p.face.full.length.toFixed(1)} soil ${p.soil}/${p.soilNeeded}` : '-'}\n` +
        `  aphids ${aph}  sources=${world.food.sources.length} pher=${pher.toFixed(0)} home=${home.toFixed(0)}\n` +
        `  spiders=${world.predators.spiders.map((s) => `${s.state}/${s.caught}`).join(' ') || '-'} antlions=${world.predators.antlions.map((p) => p.caught).join(' ')}` +
        `  weather=${tr(world.weather.label)} rains=${world.weather.rains} wet=${world.weather.wetness.toFixed(2)} plugs=${world.nest.entrances.map((e) => e.plug.toFixed(1)).join('/')}\n` +
        `  stats=${JSON.stringify({ ...c.stats, honeydew: Math.round(c.stats.honeydew) })}`,
    );
    for (const [k, v] of top) console.log(`   ${v.toString().padStart(4)}  ${k}`);
    tickMs = 0;
    ticks = 0;
  }
}

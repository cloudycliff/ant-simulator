/**
 * 性能测试：以指定的工蚁数开局，统计每个模拟步各子系统的耗时。
 * npx tsx scripts/perftest.ts [工蚁数，默认 3000] [模拟秒数，默认 300]
 */
import { CONFIG } from '../src/config';
import { World } from '../src/world/world';

const n = Number(process.argv[2] ?? 3000);
const secs = Number(process.argv[3] ?? 300);
CONFIG.colony.initialWorkers = n;
CONFIG.colony.maxPopulation = Math.max(CONFIG.colony.maxPopulation, n + 200);
const t0 = performance.now();
const w = new World();
console.log(`${n} 只工蚁，建世界 ${(performance.now() - t0).toFixed(0)} ms`);

const parts = ['weather', 'colony', 'predators', 'alarm', 'food', 'aphids', 'water', 'pheromone'] as const;
const cost: Record<string, number> = {};
for (const p of parts) {
  const sys = w[p] as unknown as { update: (...a: unknown[]) => void };
  const orig = sys.update.bind(sys);
  cost[p] = 0;
  sys.update = (...a: unknown[]) => {
    const s = performance.now();
    orig(...a);
    cost[p] += performance.now() - s;
  };
}

/** 身体明显重叠（中心距 < 0.45 cm）的蚂蚁对数，按地表 / 巢内分开 */
function overlaps(): string {
  const near: typeof w.colony.ants = [];
  const n = { surface: 0, nest: 0 };
  for (const a of w.colony.ants) {
    if (a.climbing) continue;
    for (const b of w.colony.spatial.near(a.pos.x, a.pos.y, a.pos.z, 0.45, near, a))
      if (b.id > a.id && b.domain === a.domain && !b.climbing) n[a.domain]++;
  }
  return `重叠 地表 ${n.surface} / 巢内 ${n.nest}`;
}

const step = CONFIG.time.fixedStep;
const steps = Math.round(secs / step);
let worst = 0;
const s0 = performance.now();
for (let i = 0; i < steps; i++) {
  const s = performance.now();
  const before = { ...cost };
  w.advance(step);
  const took = performance.now() - s;
  worst = Math.max(worst, took);
  if (took > 15) {
    const slow = parts.map((p) => [p, cost[p] - before[p]] as const).sort((a, b) => b[1] - a[1])[0];
    console.log(`  慢步 ${took.toFixed(0)} ms @${w.clock.stamp()}：${slow[0]} ${slow[1].toFixed(0)} ms，扩建 ${w.colony.expansion.project ? (w.colony.expansion.project.chamber ? '房间' : '隧道') : '-'}`);
  }
  if (i > 0 && i % Math.round(60 / step) === 0) {
    const el = performance.now() - s0;
    console.log(`${(i * step).toFixed(0)}s ${w.clock.stamp()} 蚂蚁 ${w.colony.ants.length} 巢外 ${w.colony.outsideCount()} 平均每步 ${(el / i).toFixed(2)} ms ${overlaps()}`);
  }
}
const total = performance.now() - s0;
console.log(`\n平均每步 ${(total / steps).toFixed(2)} ms，最慢一步 ${worst.toFixed(1)} ms`);
for (const p of parts) console.log(`  ${p.padEnd(10)} ${(cost[p] / steps).toFixed(3)} ms  ${((cost[p] / total) * 100).toFixed(0)}%`);
console.log(`1 倍速每秒 30 步 ≈ ${((total / steps) * 30).toFixed(0)} ms/s；10 倍速 ≈ ${((total / steps) * 300).toFixed(0)} ms/s`);

/**
 * 拥挤测试：以 3000 只工蚁开局跑一个游戏日，每 2.4 游戏小时统计休息室的密度、巢口附近地表和隧道里身体明显重叠的蚂蚁对数。
 * 开局的蚂蚁是一次性摆进房间的，第一次统计不计入检查。
 * npx tsx scripts/games/ant/crowdtest.ts [工蚁数，默认 3000] [模拟秒数，默认 600]
 */
import { tr } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/ant/config';
import { World } from '../../../src/games/ant/world/world';

const n = Number(process.argv[2] ?? 3000);
const secs = Number(process.argv[3] ?? 600);
/** 休息室每 cm² 可走地板上最多几只；巢口 15 cm 以内的地表最多几对重叠 */
const MAX_REST = Number(process.env.MAX_REST ?? 2.6);
const MAX_MOUND = Number(process.env.MAX_MOUND ?? 300);
CONFIG.colony.initialWorkers = n;
CONFIG.colony.maxPopulation = Math.max(CONFIG.colony.maxPopulation, n + 200);
CONFIG.weather.rainPerDay = 0;
const w = new World();
const step = 1 / 30;
const near: typeof w.colony.ants = [];
const problems: string[] = [];
let worstRest = 0;
let worstMound = 0;

function report(check: boolean): void {
  const room = new Map<number, { n: number; over: number }>();
  let mound = 0;
  let moundN = 0;
  let tunnel = 0;
  for (const a of w.colony.ants) {
    if (a.climbing) continue;
    const de = Math.min(...w.nest.entrances.map((e) => Math.hypot(e.x - a.pos.x, e.z - a.pos.z)));
    if (a.domain === 'nest' && a.room >= 0) {
      const r = room.get(a.room) ?? { n: 0, over: 0 };
      r.n++;
      room.set(a.room, r);
    }
    if (a.domain === 'surface' && de < 15) moundN++;
    for (const b of w.colony.spatial.near(a.pos.x, a.pos.y, a.pos.z, 0.45, near, a)) {
      if (b.id <= a.id || b.domain !== a.domain || b.climbing) continue;
      if (a.domain === 'surface') {
        if (de < 15) mound++;
      } else if (a.room >= 0 && a.room === b.room) room.get(a.room)!.over++;
      else if (a.room < 0) tunnel++;
    }
  }
  const types = ['rest', 'winter', 'food'] as const;
  const parts = types.map((t) => {
    const cs = w.nest.chamberOfType(t).filter((c) => c.ready);
    let cnt = 0;
    let over = 0;
    let max = 0;
    for (const c of cs) {
      const r = room.get(c.id) ?? { n: 0, over: 0 };
      cnt += r.n;
      over += r.over;
      max = Math.max(max, r.n / (Math.PI * c.rx * c.rz * 0.62 * 0.62));
    }
    if (t === 'rest' && check) worstRest = Math.max(worstRest, max);
    return `${tr(cs[0].label).replace(/\d+$/, '')} ${cnt} 只（最挤 ${max.toFixed(1)}/cm²，重叠 ${over}）`;
  });
  if (check) worstMound = Math.max(worstMound, mound);
  console.log(`${tr(w.clock.stamp())} 巢口 15 cm 内 ${moundN} 只、重叠 ${mound}；隧道重叠 ${tunnel}；${parts.join('；')}`);
}

console.log(`${n} 只工蚁，模拟 ${secs} 秒`);
const every = Math.round(CONFIG.time.dayLength / 10 / step);
for (let i = 0; i <= Math.round(secs / step); i++) {
  w.advance(step);
  if (i % every === 0) report(i > 0);
}
if (worstRest > MAX_REST) problems.push(`休息室最挤 ${worstRest.toFixed(1)} 只/cm²（上限 ${MAX_REST}）`);
if (worstMound > MAX_MOUND) problems.push(`巢口附近重叠 ${worstMound} 对（上限 ${MAX_MOUND}）`);
console.log(`休息室最挤 ${worstRest.toFixed(1)} 只/cm²，巢口附近最多重叠 ${worstMound} 对`);
console.log(problems.length ? `失败：${problems.join('；')}` : '全部通过');
if (problems.length) process.exitCode = 1;

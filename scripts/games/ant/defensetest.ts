/**
 * 防御测试：在蚂蚁来往多的地方和巢口附近各放一只狼蛛，观察警报、围攻、驱赶和入口警戒。
 * npx tsx scripts/games/ant/defensetest.ts [热身秒数，默认 500]
 */
import { tr } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/ant/config';
import { World } from '../../../src/games/ant/world/world';

const warm = Number(process.argv[2] ?? 500);
const w = new World();
// 下雨时内务蚁不出巢警戒，测试只看晴天
CONFIG.weather.rainPerDay = 0;
const step = 1 / 30;
for (let t = 0; t < warm; t += step) w.advance(step);
// 不让自然狼蛛干扰
for (const s of [...w.predators.spiders]) w.predators.remove(s);

/** 地表蚂蚁最密集的 4 cm 格子（离入口 12 cm 以外） */
function busiestSpot(): { x: number; z: number; n: number } {
  const cells = new Map<string, { x: number; z: number; n: number }>();
  for (const a of w.colony.ants) {
    if (a.domain !== 'surface' || a.climbing) continue;
    if (w.nest.entrances.some((e) => Math.hypot(e.x - a.pos.x, e.z - a.pos.z) < 12)) continue;
    const k = `${Math.round(a.pos.x / 4)},${Math.round(a.pos.z / 4)}`;
    const c = cells.get(k) ?? { x: Math.round(a.pos.x / 4) * 4, z: Math.round(a.pos.z / 4) * 4, n: 0 };
    c.n++;
    cells.set(k, c);
  }
  return [...cells.values()].sort((a, b) => b.n - a.n)[0];
}

/** outskirts：蚂蚁稀少的外围，狼蛛可能吃饱了才走，只要求有蚂蚁响应 */
function run(label: string, x: number, z: number, secs: number, outskirts = false): void {
  const r = w.placePredator('spider', x, z);
  console.log(`\n== ${label}：(${x.toFixed(0)}, ${z.toFixed(0)}) ${r.msg ? tr(r.msg) : ''}`);
  const s = w.predators.spiders[w.predators.spiders.length - 1];
  const st = w.colony.stats;
  const p0 = st.preyed;
  const r0 = st.repelled;
  let maxMob = 0;
  let maxResp = 0;
  let maxGuards = 0;
  let goneAt = -1;
  for (let t = 0; t < secs; t += step) {
    w.advance(step);
    const resp = w.colony.ants.filter((a) => a.alarmT > 0).length;
    maxResp = Math.max(maxResp, resp);
    maxMob = Math.max(maxMob, s.mob);
    maxGuards = Math.max(maxGuards, w.predators.guardsOut);
    if (goneAt < 0 && !w.predators.spiders.includes(s)) goneAt = t;
    if (Math.round(t / step) % Math.round(5 / step) === 0) {
      console.log(
        `t=${t.toFixed(0).padStart(3)}s ${w.predators.spiders.includes(s) ? `${s.state.padEnd(6)} mob=${s.mob} harass=${s.harass.toFixed(1)} meals=${s.meals}` : '已离开'.padEnd(28)}` +
          ` 警报点=${w.alarm.sources.length} 增援=${resp} 警戒=${w.predators.guardsOut} 威胁入口=${w.predators.threatEntrance} 巢外=${w.colony.outsideCount()}`,
      );
    }
  }
  console.log(`结果：被捕食 / 咬死 ${st.preyed - p0}，赶走 ${st.repelled - r0}，最多同时围攻 ${maxMob}，最多增援 ${maxResp}，最多警戒 ${maxGuards}，${goneAt >= 0 ? `${goneAt.toFixed(0)} 秒后离开` : '仍在场'}`);
  if (w.predators.spiders.includes(s)) w.predators.remove(s);
  if (maxResp === 0 && !(outskirts && maxGuards > 0)) problems.push(`${label}：没有蚂蚁响应警报`);
  if (goneAt < 0 && !outskirts) problems.push(`${label}：狼蛛 ${secs} 秒内没有离开`);
}

const problems: string[] = [];

const spot = busiestSpot();
console.log(`热身 ${warm} 秒，最密集处 ${spot.n} 只`);
run('觅食路线上', spot.x, spot.z, 120);
for (let t = 0; t < 60; t += step) w.advance(step);
const e = w.nest.entrances[0];
run(`${tr(e.label)}外 8 cm`, e.x + 8, e.z + 2, 150);
for (let t = 0; t < 60; t += step) w.advance(step);
const e2 = w.nest.entrances[1];
const ang = Math.atan2(e2.z, e2.x);
run(`${tr(e2.label)}外 16 cm`, e2.x + Math.cos(ang) * 16, e2.z + Math.sin(ang) * 16, 120, true);
console.log(problems.length ? `失败：${problems.join('；')}` : '全部通过');
if (problems.length) process.exitCode = 1;

/**
 * 防御测试：让狼蛛走近觅食路线，看有没有蚂蚁提前躲开；再在蚂蚁来往多的地方和巢口附近各放一只狼蛛，观察警报、围攻、驱赶、躲避和入口警戒。
 * npx tsx scripts/games/ant/defensetest.ts [热身秒数，默认 800，到第二天下午，地表蚂蚁多、内务蚁也在出巢警戒]
 */
import { tr } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/ant/config';
import { World } from '../../../src/games/ant/world/world';

const warm = Number(process.argv[2] ?? 800);
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
  // 那一点被食物、石块占着时在附近换个点
  let r = w.placePredator('spider', x, z);
  for (let i = 0; !r.ok && i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    r = w.placePredator('spider', x + Math.cos(ang) * 2, z + Math.sin(ang) * 2);
    if (r.ok) [x, z] = [x + Math.cos(ang) * 2, z + Math.sin(ang) * 2];
  }
  console.log(`\n== ${label}：(${x.toFixed(0)}, ${z.toFixed(0)}) ${r.msg ? tr(r.msg) : ''}`);
  if (!r.ok) {
    problems.push(`${label}：放不下狼蛛`);
    return;
  }
  const s = w.predators.spiders[w.predators.spiders.length - 1];
  const st = w.colony.stats;
  const p0 = st.preyed;
  const r0 = st.repelled;
  let maxMob = 0;
  let maxResp = 0;
  let maxGuards = 0;
  let goneAt = -1;
  let threatAt = -1;
  let threatEnd = -1;
  let guardsAt = -1;
  let guardsHomeAt = -1;
  /** 威胁解除后，每只警戒蚁没在打斗、还留在外面的累计秒数 */
  const idle = new Map<number, number>();
  let maxIdle = 0;
  let fled = 0;
  let maxFlee = 0;
  let fleeing = new Set<number>();
  for (let t = 0; t < secs + 60; t += step) {
    w.advance(step);
    const now = new Set(w.colony.ants.filter((a) => a.fleeT > 0).map((a) => a.id));
    for (const id of now) if (!fleeing.has(id)) fled++;
    fleeing = now;
    maxFlee = Math.max(maxFlee, now.size);
    const resp = w.colony.ants.filter((a) => a.alarmT > 0).length;
    maxResp = Math.max(maxResp, resp);
    maxMob = Math.max(maxMob, s.mob);
    maxGuards = Math.max(maxGuards, w.predators.guardsOut);
    if (goneAt < 0 && !w.predators.spiders.includes(s)) goneAt = t;
    const threat = w.predators.threatEntrance >= 0;
    if (threat && threatAt < 0) threatAt = t;
    if (threatAt >= 0 && guardsAt < 0 && w.predators.guardsOut >= 3) guardsAt = t;
    if (threatAt >= 0 && !threat && threatEnd < 0) threatEnd = t;
    if (threatEnd >= 0 && guardsHomeAt < 0 && w.predators.guardsOut === 0) guardsHomeAt = t;
    // 狼蛛又逼近入口时，出来的警戒蚁就不算闲逛
    if (threat) idle.clear();
    else if (threatEnd >= 0 && guardsHomeAt < 0) {
      for (const a of w.colony.ants) {
        if (!a.guarding || a.domain !== 'surface' || a.alarmT > 0) continue;
        const v = (idle.get(a.id) ?? 0) + step;
        idle.set(a.id, v);
        maxIdle = Math.max(maxIdle, v);
      }
    }
    if (t >= secs && (threatEnd < 0 || guardsHomeAt >= 0)) break;
    if (Math.round(t / step) % Math.round(5 / step) === 0) {
      console.log(
        `t=${t.toFixed(0).padStart(3)}s ${w.predators.spiders.includes(s) ? `${s.state.padEnd(6)} mob=${s.mob} harass=${s.harass.toFixed(1)} meals=${s.meals}` : '已离开'.padEnd(28)}` +
          ` 警报点=${w.alarm.sources.length} 增援=${resp} 警戒=${w.predators.guardsOut} 威胁入口=${w.predators.threatEntrance} 巢外=${w.colony.outsideCount()}`,
      );
    }
  }
  console.log(`结果：被捕食 / 咬死 ${st.preyed - p0}，赶走 ${st.repelled - r0}，最多同时围攻 ${maxMob}，最多增援 ${maxResp}，最多警戒 ${maxGuards}，${goneAt >= 0 ? `${goneAt.toFixed(0)} 秒后离开` : '仍在场'}`);
  console.log(`躲避：发觉狼蛛靠近而躲开 ${fled} 次，最多同时 ${maxFlee} 只`);
  totalFled += fled;
  if (threatAt >= 0) {
    const arrive = guardsAt >= 0 ? guardsAt - threatAt : Infinity;
    const home = threatEnd >= 0 ? (guardsHomeAt >= 0 ? guardsHomeAt - threatEnd : Infinity) : 0;
    const linger = threatEnd >= 0 && guardsHomeAt < 0 ? Infinity : maxIdle;
    console.log(`警戒：威胁出现后 ${arrive.toFixed(0)} 秒有 3 只在外警戒；威胁解除后每只最多再闲逛 ${linger.toFixed(1)} 秒，${home.toFixed(0)} 秒后全部回巢（其余时间在追打狼蛛、搜寻警报源）`);
    if (arrive > GUARD_ARRIVE) problems.push(`${label}：警戒 ${arrive.toFixed(0)} 秒才到位`);
    if (linger > GUARD_LINGER) problems.push(`${label}：威胁解除后警戒蚁还闲逛了 ${linger.toFixed(0)} 秒`);
  }
  if (w.predators.spiders.includes(s)) w.predators.remove(s);
  if (maxResp === 0 && !(outskirts && maxGuards > 0)) problems.push(`${label}：没有蚂蚁响应警报`);
  if (goneAt < 0 && !outskirts) problems.push(`${label}：狼蛛 ${secs} 秒内没有离开`);
}

const problems: string[] = [];
/**
 * 入口受威胁后几秒内要有 3 只出来警戒；威胁解除后，每只警戒蚁在外面闲逛（不算追打狼蛛、搜寻警报源）最多几秒。
 * 闻得到警报的会一直搜寻到警报散掉（约 20 秒），那段不算
 */
const GUARD_ARRIVE = Number(process.env.GUARD_ARRIVE ?? 15);
const GUARD_LINGER = Number(process.env.GUARD_LINGER ?? 8);
/** 所有场景里合计至少这么多次发觉狼蛛而躲开 */
const MIN_FLED = 10;
let totalFled = 0;

/**
 * 狼蛛从 15 cm 外朝蚂蚁多的地方走过去，看有没有蚂蚁发觉它并躲开。
 * 狼蛛 7 cm 就扑、蚂蚁 10 cm 才察觉，一扑中就停下吃，单这一段躲开几只看运气，只和后面几段合计判定
 */
function approach(x: number, z: number): void {
  // 从 15 cm 外附近蚂蚁最少的方向过来，不然一放下就扑到了旁边的蚂蚁
  let sx = x;
  let sz = z;
  let best = Infinity;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const px = x + Math.cos(ang) * 15;
    const pz = z + Math.sin(ang) * 15;
    if (Math.hypot(px, pz) > CONFIG.world.size / 2 - 3) continue;
    const n = w.colony.ants.filter((a) => a.domain === 'surface' && Math.hypot(a.pos.x - px, a.pos.z - pz) < 12).length;
    if (n < best) [best, sx, sz] = [n, px, pz];
  }
  w.placePredator('spider', sx, sz);
  const s = w.predators.spiders[w.predators.spiders.length - 1];
  console.log(`\n== 狼蛛走近觅食路线：从 (${sx.toFixed(0)}, ${sz.toFixed(0)}) 走向 (${x.toFixed(0)}, ${z.toFixed(0)})`);
  let fled = 0;
  let fleeing = new Set<number>();
  let chaseAt = -1;
  let fledBefore = 0;
  for (let t = 0; t < 20; t += step) {
    if (s.state === 'chase' && chaseAt < 0) [chaseAt, fledBefore] = [t, fled];
    if (s.state === 'wander' || s.state === 'pause') {
      s.gx = x;
      s.gz = z;
      s.state = 'wander';
    }
    w.advance(step);
    if (!w.predators.spiders.includes(s)) break;
    const now = new Set(w.colony.ants.filter((a) => a.fleeT > 0).map((a) => a.id));
    for (const id of now) if (!fleeing.has(id)) fled++;
    fleeing = now;
  }
  console.log(`结果：${chaseAt >= 0 ? `${chaseAt.toFixed(1)} 秒后第一次扑击，之前有 ${fledBefore} 次躲开；` : ''}20 秒里共 ${fled} 次发觉狼蛛而躲开`);
  totalFled += fled;
  w.predators.remove(s);
}

const spot = busiestSpot();
console.log(`热身 ${warm} 秒，最密集处 ${spot.n} 只`);
approach(spot.x, spot.z);
for (let t = 0; t < 30; t += step) w.advance(step);
run('觅食路线上', spot.x, spot.z, 120);
for (let t = 0; t < 60; t += step) w.advance(step);
const e = w.nest.entrances[0];
run(`${tr(e.label)}外 8 cm`, e.x + 8, e.z + 2, 150);
for (let t = 0; t < 60; t += step) w.advance(step);
const e2 = w.nest.entrances[1];
const ang = Math.atan2(e2.z, e2.x);
run(`${tr(e2.label)}外 16 cm`, e2.x + Math.cos(ang) * 16, e2.z + Math.sin(ang) * 16, 120, true);
console.log(`\n躲避合计：${totalFled} 次`);
if (totalFled < MIN_FLED) problems.push(`所有场景合计只有 ${totalFled} 次躲开狼蛛`);
console.log(problems.length ? `失败：${problems.join('；')}` : '全部通过');
if (problems.length) process.exitCode = 1;

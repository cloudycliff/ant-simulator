/**
 * 蜜蜂的无界面检查：巢脾网格和开局布局、子的发育、点选巢房、花丛的位置和开合流蜜、巢里的蜂（爬行、分工、产卵、哺育、筑巢、吃）、
 * 摇摆舞和交接、按需要调整分工、储蜜的反馈、天气、巢脾上的温度、胡蜂和热球、割蜜和换框、巢虫和中囊病、飞逃和野生蜂群、存档往返、同编号可重现、坏存档拒读、英文文字没漏翻。
 * npx tsx scripts/games/bee/beetest.ts
 */
import * as THREE from 'three';
import { L, setLang, t, tr } from '../../../src/core/i18n';
import { CombView } from '../../../src/games/bee/combView';
import { CONFIG } from '../../../src/games/bee/config';
import { CELL, CELLS, CONTENT_KEYS, GRID, SITES, cellPos, siteAt, siteFrame, siteU, siteV, type Comb } from '../../../src/games/bee/sim/comb';
import { ACTS, CASTE, ageRoleOf, roleOf, type Act } from '../../../src/games/bee/sim/bees';
import { Flowers, SUGAR, nectarCap, openness, patchOpenness, plantCount, pollenCap, SPECIES_KEYS } from '../../../src/games/bee/sim/flowers';
import { nodeAt } from '../../../src/games/bee/sim/walk';
import { BeeWorld, beeSave, type BeeRef, type BeeSaveData } from '../../../src/games/bee/world';
import { MOUTH } from '../../../src/games/bee/sim/flight';
import type { HornetState } from '../../../src/games/bee/sim/hornets';
import { en } from '../../../src/games/bee/i18n/en';
import { NOTES, beeNotes } from '../../../src/games/bee/notes';

setLang('en');
const STEP = 1 / 30;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '通过' : '失败'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};
const run = (w: BeeWorld, secs: number) => {
  for (let s = 0; s < secs; s += STEP) w.advance(STEP);
};
const fingerprint = (w: BeeWorld) =>
  `${w.clock.seconds.toFixed(3)}|${w.rng.state}|${w.bees.births}|${w.bees.list.length}|${w.comb.version}|${w.bees.trips}|${w.bees.list.reduce((s, b) => s + b.u + b.v * 3 + b.face + b.pos.x + b.pos.y * 3 + b.pos.z * 7, 0).toFixed(4)}`;

const t0 = performance.now();
const w = new BeeWorld(7);
const comb = w.comb;

let badSites = 0;
for (let s = 0; s < SITES; s++) {
  const u = siteU(s);
  const v = siteV(s);
  for (const [du, dv] of [[0, 0], [0.2, 0], [-0.1, 0.17], [0.1, -0.17]]) if (siteAt(u + du, v + dv) !== s) badSites++;
}
check('网格：巢房中心和房里的点都换算回同一个位置', badSites === 0, `${badSites} 处不对`);

const census0 = comb.census();
const c0 = census0.counts;
check('开局只造了一部分', census0.built > SITES * 0.4 && census0.built < SITES * 0.9 && census0.building > 0, `${census0.built} / ${SITES}，在造 ${census0.building}`);
const OPENING = CONTENT_KEYS.filter((k) => k !== 'sac');
check('开局每种内容都有（死囊除外）', OPENING.every((k) => c0[k] > 0) && c0.sac === 0, OPENING.map((k) => `${k} ${c0[k]}`).join(' '));
const meanV = (want: (c: number) => boolean) => {
  let sum = 0;
  let n = 0;
  for (let cell = 0; cell < CELLS; cell++)
    if (comb.build[cell % SITES] === 1 && want(comb.content[cell])) {
      sum += cellPos(cell).y;
      n++;
    }
  return sum / n;
};
const honeyY = meanV((c) => c === CELL.cappedHoney);
const broodY = meanV((c) => c >= CELL.egg && c <= CELL.capped);
check('封盖蜜在子的上面', honeyY > broodY + 5, `${honeyY.toFixed(1)} / ${broodY.toFixed(1)} cm`);
let unbuiltFull = 0;
for (let cell = 0; cell < CELLS; cell++) if (comb.build[cell % SITES] < 1 && comb.content[cell] !== CELL.empty) unbuiltFull++;
check('没造好的巢房是空的', unbuiltFull === 0);

/** 卵、幼虫、封盖子的阶段和日龄对得上 */
const stageMismatch = (cb: Comb) => {
  let bad = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const c = cb.content[cell];
    if (c < CELL.egg || c > CELL.capped) continue;
    const T = cb.drone[cell % SITES] ? CONFIG.brood.drone : CONFIG.brood.worker;
    const a = cb.age[cell];
    const want = a < T.egg ? CELL.egg : a < T.egg + T.larva ? CELL.larva : CELL.capped;
    if (c !== want || a >= T.egg + T.larva + T.capped) bad++;
  }
  return bad;
};
check('开局子的阶段和日龄对得上', stageMismatch(comb) === 0);

const view = new CombView(comb);
let pickBad = 0;
let picked = 0;
for (let cell = 0; cell < CELLS; cell += 37) {
  if (!comb.built(cell)) continue;
  const p = cellPos(cell);
  const out = cell >= SITES ? -1 : 1;
  const from = new THREE.Vector3(p.x + 3, p.y + 2, p.z + out * 20);
  const ray = new THREE.Ray(from, new THREE.Vector3(p.x, p.y, p.z).sub(from).normalize());
  picked++;
  if (view.pick(ray)?.cell !== cell) pickBad++;
}
check('斜着点巢房选中的是那一个', pickBad === 0, `${picked} 个里 ${pickBad} 个不对`);
const F = CONFIG.flowers;
const patches = w.flowers.patches;
check('花丛：片数对、每种野花都有、没有糖水', patches.length === F.patches && F.species.every((s, i) => !s.wild || patches.some((p) => p.species === i)) && patches.every((p) => F.species[p.species].wild), patches.map((p) => SPECIES_KEYS[p.species]).join(' '));
const lim = CONFIG.garden.size / 2 - F.margin;
const misplaced = patches.filter((p) => {
  const d = Math.hypot(p.x, p.z);
  return d < F.near || d > F.far || Math.abs(p.x) > lim || Math.abs(p.z) > lim || patches.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) < q.r + p.r + F.gap);
});
check('花丛离蜂箱远近合适、在花园里、互不重叠', misplaced.length === 0, misplaced.map((p) => p.id).join(' '));
check('每片花丛都有株', patches.every((p) => plantCount(p) > 5), patches.map((p) => plantCount(p)).join(' '));
const sp = (key: string) => F.species[SPECIES_KEYS.indexOf(key as (typeof SPECIES_KEYS)[number])];
check('夜里花都没开', F.species.every((s) => openness(s, 2) === 0 && openness(s, 22) === 0));
check('南瓜花清早开、下午合', openness(sp('pumpkin'), 7) === 1 && openness(sp('pumpkin'), 14) === 0);
check('三叶草白天一直开着', [8, 12, 17].every((h) => openness(sp('clover'), h) === 1));
const emptied = patches.find((q) => nectarCap(q) > 0)!;
{
  const p = emptied;
  const before = p.nectar;
  const got = w.flowers.take(p, 'nectar', 1, 12);
  check('采蜜：采到多少花丛少多少', got > 0 && Math.abs(p.nectar - (before - got)) < 1e-9, `${got.toFixed(2)} 份`);
  check('花没开时采不到', w.flowers.take(p, 'nectar', 1, 23) === 0 && w.flowers.take(p, 'pollen', 1, 23) === 0);
}
// 长回来单独用一份花丛算，世界里的花丛白天有蜂在采
const regrow = new Flowers();
regrow.patches.push({ ...emptied, nectar: 0 });
for (let s = 0; s < CONFIG.clock.dayLength; s++) regrow.update(1, (9 + (s / CONFIG.clock.dayLength) * 24) % 24);
const regrown = regrow.patches[0];
const corn = patches.find((q) => SPECIES_KEYS[q.species] === 'corn')!;
check('玉米没有花蜜', nectarCap(corn) === 0 && w.flowers.take(corn, 'nectar', 1, 9) === 0);
const B = CONFIG.bees;
const bees = w.bees;
check('开局的蜂：工蜂、雄蜂和一只蜂王', bees.list.length === B.workers + B.drones + 1 && bees.list.filter((b) => b.caste === CASTE.queen).length === 1, `${bees.list.length} 只`);
const inHive = () => bees.list.filter((b) => !b.out);
const offComb = () => inHive().filter((b) => b.wrap === 0 && bees.map.walk[nodeAt(b.u, b.v)] === 0 && nodeAt(b.u, b.v) >= 0).length + inHive().filter((b) => nodeAt(b.u, b.v) < 0).length;
check('开局的蜂都站在巢脾或框条上', offComb() === 0);
const built0 = census0.built;
const honey0 = census0.honeyCells;
const pollen0 = census0.pollenCells;
const seen = new Set<Act>();
let maxOut = 0;
let outAtNight = 0;
let badFlight = 0;
const garden = CONFIG.garden.size / 2;
const stepT0 = performance.now();
let hand300 = 0;
const heat = { lo: Infinity, hi: -Infinity, top: -Infinity, heaters: 0, fanners: 0 };
for (let s = 0; s < CONFIG.clock.dayLength; s += 10) {
  run(w, 10);
  if (s === 290) hand300 = bees.handoffs;
  let out = 0;
  for (const b of bees.list) {
    seen.add(b.act);
    if (!b.out) continue;
    out++;
    const p = b.pos;
    if (Math.abs(p.x) > garden || Math.abs(p.z) > garden || p.y < w.groundAt(p.x, p.z) || p.y > 1000 || !Number.isFinite(p.x + p.y + p.z)) badFlight++;
  }
  maxOut = Math.max(maxOut, out);
  const h = w.heat;
  heat.lo = Math.min(heat.lo, h.broodMean);
  heat.hi = Math.max(heat.hi, h.broodMean);
  heat.top = Math.max(heat.top, h.broodMax);
  heat.heaters = Math.max(heat.heaters, h.heating);
  heat.fanners = Math.max(heat.fanners, h.fanning);
  if (w.clock.hour > 23 || w.clock.hour < 3) outAtNight = Math.max(outAtNight, out);
}
const stepMs = (performance.now() - stepT0) / (CONFIG.clock.dayLength * 30);
check('一天过去了', w.clock.day === 2, tr(w.clock.stamp()));
check('采空的花丛一天里长回来、不超过满', patches.every((p) => p.nectar <= nectarCap(p) + 1e-9 && p.pollen <= pollenCap(p) + 1e-9) && regrown.nectar > nectarCap(regrown) * 0.99, `${((regrown.nectar / nectarCap(regrown)) * 100).toFixed(0)}%`);
check('蜂箱周围的地面是平的', w.groundAt(0, 0) === 0 && w.groundAt(40, -30) === 0);
const ms = performance.now() - t0;
const c1 = comb.census().counts;
check('温度：一天里育儿区的平均温度在 33～36.5 °C，没有格子热过 cook', heat.lo > 33 && heat.hi < 36.5 && heat.top < CONFIG.heat.cook, `平均 ${heat.lo.toFixed(1)}～${heat.hi.toFixed(1)}，最热的格 ${heat.top.toFixed(1)} °C`);
check('温度：凉的时候有蜂产热、热的时候有蜂扇风', heat.heaters > 20 && heat.fanners > 5, `最多 ${heat.heaters} 只产热、${heat.fanners} 只扇风`);
check('温度：冻死、热死的子很少', w.heat.chilled < (c0.egg + c0.larva + c0.capped) * 0.01, `${w.heat.chilled} 个`);
check('一天里有子羽化成蜂', bees.births > 0 && bees.list.filter((b) => b.age < CONFIG.clock.dayLength).length > 0, `${bees.births} 只`);
check('一天后蜂都还站在巢脾或框条上', offComb() === 0);
const face1 = bees.list.filter((b) => b.face === 1).length;
check('两面都有蜂（绕过巢脾边换面）', face1 > bees.list.length * 0.3 && face1 < bees.list.length * 0.7, `背面 ${face1} / ${bees.list.length}`);
check('只数没有崩', bees.list.length > (B.workers + B.drones) * 0.9, `${bees.list.length} 只，羽化 ${bees.births}、死 ${bees.deaths}`);
check('蜂王一天产了一两百粒以上的卵', bees.laid > 180, `${bees.laid} 粒`);
check('幼虫没有饿死', bees.starved === 0, `${bees.starved} 只`);
check('成蜂没有饿死', bees.hungry === 0, `${bees.hungry} 只`);
const census1 = comb.census();
check('巢脾在长', census1.built > built0 + 50, `${built0} → ${census1.built}`);
check('采集蜂出巢、带回花蜜和花粉', bees.trips > 500 && bees.nectarIn > 20 && bees.pollenIn > 20, `最多 ${maxOut} 只在外面，${bees.trips} 趟，花蜜 ${bees.nectarIn.toFixed(0)} 房、花粉 ${bees.pollenIn.toFixed(0)} 房`);
check('飞着的蜂都在花园里、地面以上', badFlight === 0, `${badFlight} 次`);
check('半夜蜂都在巢里', outAtNight === 0, `${outAtNight} 只在外面`);
check('储蜜、储粉一天后没有单向漂移', Math.abs(census1.honeyCells / honey0 - 1) < 0.05 && Math.abs(census1.pollenCells / pollen0 - 1) < 0.15, `蜜 ${honey0.toFixed(0)} → ${census1.honeyCells.toFixed(0)}、粉 ${pollen0.toFixed(0)} → ${census1.pollenCells.toFixed(0)} 满房`);
check('采集蜂跳舞，招募的蜂大多飞到舞里那片花', bees.dances > 100 && bees.arrived >= 20 && bees.hits / bees.arrived >= 0.5, `${bees.dances} 支舞，招募 ${bees.recruits}，飞到 ${bees.arrived}，找到那片 ${((bees.hits / Math.max(1, bees.arrived)) * 100).toFixed(0)}%`);
check('花蜜大多交给内勤蜂', bees.handoffs > bees.selfStored * 3, `交 ${bees.handoffs}、自己放 ${bees.selfStored}、颤抖舞 ${bees.trembles}`);
{
  // 没有误差时，舞读出来的地方就是那片花：两面、各个方向、跳舞和读舞之间太阳动了也一样
  const x = new BeeWorld(9) as unknown as { bees: Record<string, (...a: unknown[]) => unknown>; flowers: BeeWorld['flowers']; advance: BeeWorld['advance'] };
  const DC = CONFIG.dance as { angleNoise: number; distNoise: number };
  const noise = [DC.angleNoise, DC.distNoise];
  DC.angleNoise = DC.distNoise = 0;
  let worst = 0;
  for (const p of x.flowers.patches)
    for (const face of [0, 1]) {
      const d = { face, patch: p.id, goods: 0 };
      const dist = Math.hypot(p.x - MOUTH.x, p.z - MOUTH.z);
      if (dist < CONFIG.dance.round) continue;
      const wv = CONFIG.dance.w0 + (dist / 100) * CONFIG.dance.perM;
      const aim = x.bees.decode.call(x.bees, d, { k: 'dance', cu: 0, cv: 0, a: x.bees.danceAngle.call(x.bees, d, p), w: wv, len: wv, n: 1, ph: 0 }) as { x: number; z: number };
      worst = Math.max(worst, Math.hypot(aim.x - p.x, aim.z - p.z));
    }
  [DC.angleNoise, DC.distNoise] = noise;
  check('没有误差时舞里说的就是那片花（两面）', worst < 1, `差 ${worst.toFixed(3)} cm`);
}
{
  // 按需要调整分工、储蜜的反馈：开局拿掉八成哺育蜂、八成采集蜂，或者多放 500 房蜜，跑 300 秒
  const variant = (setup: (x: BeeWorld) => void) => {
    const x = new BeeWorld(7);
    setup(x);
    run(x, 300);
    return x;
  };
  const kill = (x: BeeWorld, role: string) => {
    let n = 0;
    for (const b of x.bees.list) if (roleOf(b) === role && x.rng.chance(0.8)) b.life = b.age;
    for (const b of x.bees.list) if (roleOf(b) === role && b.life > b.age) n++;
    return n;
  };
  const count = (x: BeeWorld, role: string) => x.bees.list.filter((b) => roleOf(b) === role).length;
  let nurses0 = 0;
  const a = variant((x) => (nurses0 = kill(x, 'nurse')));
  check('缺哺育蜂时内勤蜂退回去喂、清理蜂提前', count(a, 'nurse') > nurses0 * 1.5 && a.bees.reverted > 20 && a.bees.starved === 0, `剩 ${nurses0} 只 → ${count(a, 'nurse')} 只，退回 ${a.bees.reverted} 只，饿死幼虫 ${a.bees.starved}`);
  let foragers0 = 0;
  const f = variant((x) => (foragers0 = kill(x, 'forager')));
  const early = f.bees.list.filter((b) => roleOf(b) === 'forager' && ageRoleOf(b) !== 'forager').length;
  check('缺采集蜂时提前去采集', early > 50, `剩 ${foragers0} 只 → ${count(f, 'forager')} 只，其中提前的 ${early} 只`);
  let honeyUp = 0;
  const h = variant((x) => {
    const cb = x.comb;
    let want = 500;
    for (let c = 0; c < CELLS && want > 0; c++)
      if (cb.build[c % SITES] >= 1 && cb.content[c] === CELL.empty && cb.amount[c] <= 0 && c % 3 === 0) {
        cb.content[c] = CELL.cappedHoney;
        cb.amount[c] = 1;
        want--;
      }
    honeyUp = cb.census().honeyCells;
  });
  const honeyEnd = h.comb.census().honeyCells;
  check('蜜多了少接蜜、储蜜往回落', h.bees.handoffs < hand300 * 0.2 && honeyEnd < honeyUp, `交接 ${h.bees.handoffs}（平常 ${hand300}），自己放 ${h.bees.selfStored}，储蜜 ${honeyUp.toFixed(0)} → ${honeyEnd.toFixed(0)}`);
}
{
  // 工具：种花、放糖水。另开一个世界，不影响上面一天的数
  const x = new BeeWorld(7);
  const fl = x.flowers;
  const n0 = fl.patches.length;
  const clover = SPECIES_KEYS.indexOf('clover');
  const lavender = SPECIES_KEYS.indexOf('lavender');
  // 离蜂箱 4 m 左右找两处空地
  const spot: number[][] = [];
  for (let a = 0; a < 6.28 && spot.length < 2; a += 0.2) {
    const [sx, sz] = [Math.cos(a) * 400, Math.sin(a) * 400];
    if (!fl.checkSpot(sx, sz, F.species[lavender].plantR) && spot.every(([px, pz]) => Math.hypot(px - sx, pz - sz) > 300)) spot.push([sx, sz]);
  }
  const dry = x.plant(lavender, spot[0][0], spot[0][1], true);
  check('种花：试一下能种、不改世界', dry.ok && fl.patches.length === n0);
  const bad = [x.plant(clover, 50, 50), x.plant(clover, fl.patches[0].x, fl.patches[0].z), x.plant(clover, CONFIG.garden.size / 2 - 10, 0)];
  check('种花：离蜂箱太近、压着别的花丛、出了花园都种不了', bad.every((r) => !r.ok) && fl.patches.length === n0, bad.map((r) => tr(r.msg!)).join(' / '));
  const ok = x.plant(lavender, spot[0][0], spot[0][1]);
  const planted = fl.patches[fl.patches.length - 1];
  check('种花：种下了，还没长成、不开花', ok.ok && fl.patches.length === n0 + 1 && planted.planted && planted.grown === 0 && patchOpenness(planted, 12) === 0 && x.events.entries.length > 0, tr(ok.msg!));
  const fed = x.feed(spot[1][0], spot[1][1]);
  const dish = fl.patches[fl.patches.length - 1];
  check('放糖水：一碟、满的、只有一“株”、只有蜜', fed.ok && dish.species === SUGAR && plantCount(dish) === 1 && dish.nectar === nectarCap(dish) && pollenCap(dish) === 0, tr(fed.msg!));
  check('放糖水：白天蜂来、夜里不来', patchOpenness(dish, 12) === 1 && patchOpenness(dish, 23) === 0);
  run(x, CONFIG.tools.grow + 30);
  const took = nectarCap(dish) - dish.nectar;
  check('种下的花长成了、开花', planted.grown === 1 && patchOpenness(planted, 12) === 1, `长成 ${(planted.grown * 100).toFixed(0)}%`);
  check('蜂找到了糖水、在喝', took > 5 && x.bees.list.some((b) => b.patch === dish.id), `喝了 ${took.toFixed(0)} 份（满 ${nectarCap(dish)}）`);
  // 长成时已经天黑，跑到第二天中午
  run(x, (((12 - x.clock.hour + 24) % 24) / 24) * CONFIG.clock.dayLength);
  const visitors = x.bees.list.filter((b) => b.patch === planted.id).length;
  check('蜂也去种下的花丛', visitors > 0 && planted.nectar < nectarCap(planted), `${visitors} 只认得它，花蜜还剩 ${((planted.nectar / nectarCap(planted)) * 100).toFixed(0)}%`);
  const refill = x.feed(dish.x + 5, dish.z);
  check('在碟子上再放一次是添满', refill.ok && dish.nectar === nectarCap(dish) && fl.patches.length === n0 + 2);
  const saved = JSON.stringify(beeSave.write(x, 1));
  const y = new BeeWorld(7);
  beeSave.read(y, JSON.parse(saved) as BeeSaveData);
  check('读档后种的花、糖水一样', JSON.stringify(y.flowers.patches) === JSON.stringify(fl.patches) && JSON.stringify(beeSave.write(y, 1)) === saved);
}
{
  // 天气：中午下一场雨。另开一个世界
  const x = new BeeWorld(7);
  const Wx = x.weather;
  check('气温：午后比清早热、在夏天的范围里', Wx.air(14) - Wx.air(2) > 8 && Wx.air(2) > 15 && Wx.air(14) < 38, `${Wx.air(2).toFixed(1)} ~ ${Wx.air(14).toFixed(1)} °C`);
  run(x, ((12 - x.clock.hour) / 24) * CONFIG.clock.dayLength);
  const outside = () => x.bees.list.filter((b) => b.out >= 2).length;
  const wild = x.flowers.patches.filter((p) => p.species !== SUGAR && nectarCap(p) > 0);
  const nectar = () => wild.reduce((s, p) => s + p.nectar / nectarCap(p), 0) / wild.length;
  const out0 = outside();
  // 雨势定成大雨、下满 4 小时，冲淡花蜜的多少、测的时候还在不在下才不随随机数变
  const hours = CONFIG.weather.hours;
  CONFIG.weather.hours = [4, 4];
  Wx.startRain();
  Wx.strength = 0.9;
  run(x, CONFIG.weather.overcast + 5);
  CONFIG.weather.hours = hours;
  const cool = Wx.air(x.clock.hour);
  const cloud = Wx.cloud;
  Wx.cloud = 0;
  const sunny = Wx.air(x.clock.hour);
  Wx.cloud = cloud;
  const trips0 = x.bees.trips;
  const nectar0 = nectar();
  let leaving = 0;
  const wasIn = new Set(x.bees.list.filter((b) => !b.out).map((b) => b.id));
  for (let s = 0; s < 60; s += 5) {
    run(x, 5);
    for (const b of x.bees.list) if (b.out >= 2 && wasIn.has(b.id)) leaving++;
  }
  check('下雨：在外面的蜂都飞回来、巢里的不出去', Wx.phase === 'rain' && outside() <= 2 && leaving === 0, `${out0} → ${outside()} 只在外面，雨里出去 ${leaving} 次，回来 ${x.bees.trips - trips0} 趟`);
  check('下雨：凉下来、花蜜被冲淡', cool < sunny - 2 && nectar() < nectar0 * 0.85, `${sunny.toFixed(1)} → ${cool.toFixed(1)} °C，花蜜 ${(nectar0 * 100).toFixed(0)}% → ${(nectar() * 100).toFixed(0)}%`);
  check('下雨：事件里有转阴和下雨', x.events.entries.length >= 2);
  const saved = JSON.stringify(beeSave.write(x, 1));
  const reload = () => {
    const y = new BeeWorld(7);
    beeSave.read(y, JSON.parse(saved) as BeeSaveData);
    return y;
  };
  const [y1, y2] = [reload(), reload()];
  const same = JSON.stringify(beeSave.write(y1, 1)) === saved && y1.weather.phase === 'rain';
  run(y1, 30);
  run(y2, 30);
  check('下雨时存档往返一致、读两次走得一样', same && fingerprint(y1) === fingerprint(y2));
  let t = 0;
  while (Wx.phase !== 'clear' && t < 400) {
    run(x, 5);
    t += 5;
  }
  run(x, 60);
  check('雨停了，采集蜂又出去', Wx.phase === 'clear' && outside() > 20, `下了 ${t + 90} 秒，雨停 60 秒后 ${outside()} 只在外面（${tr(x.clock.stamp())}）`);
}
{
  // 胡蜂：下午两点来两只。另开世界
  const fresh = () => {
    const x = new BeeWorld(7);
    run(x, ((14 - x.clock.hour) / 24) * CONFIG.clock.dayLength);
    return x;
  };
  const x = fresh();
  const H = x.hornets;
  H.spawn(2);
  const land = CONFIG.hornets.land;
  CONFIG.hornets.land = 0;
  run(x, 20);
  for (const b of x.bees.list) seen.add(b.act);
  check('胡蜂：飞到巢门外悬停，守卫抖翅、采集蜂不敢出去', H.list.every((h) => h.state === 'hawk' || h.state === 'strike') && x.bees.shimmering > 10 && H.danger() > 0.5, `${H.list.map((h) => h.state).join(' ')}，抖翅 ${x.bees.shimmering} 只，不出巢的机会 ${H.danger().toFixed(2)}`);
  for (const h of H.list) h.left = 1e9;
  run(x, 120);
  const caught = H.caught;
  check('胡蜂：两分钟里抓走几只蜂，不是几十只', caught >= 1 && caught <= 12, `${caught} 只`);
  const chance = H.catchChance();
  H.plate = true;
  const plated = H.catchChance();
  H.plate = false;
  const y = fresh();
  y.hornets.plate = true;
  y.hornets.spawn(2);
  run(y, 20);
  for (const h of y.hornets.list) h.left = 1e9;
  y.hornets.list[0].state = 'land';
  run(y, 120);
  // 抓中一只胡蜂就飞走，两分钟只抓一两只，比只数看不出差别；比同样抖翅时抓中的机会
  check(
    '防护片：胡蜂扑不了巢门、抓得少',
    y.hornets.balls === 0 && plated < chance * 0.6,
    `抓中的机会 ${chance.toFixed(2)} → ${plated.toFixed(2)}，两分钟抓走 ${y.hornets.caught} 只（没装 ${caught} 只）`,
  );
  CONFIG.hornets.land = land;

  const z = fresh();
  z.hornets.spawn(1);
  run(z, 20);
  const h = z.hornets.list[0];
  h.left = 1e9;
  h.state = 'land' as HornetState;
  run(z, 5);
  for (const b of z.bees.list) seen.add(b.act);
  run(z, 20);
  for (const b of z.bees.list) seen.add(b.act);
  const ball = z.bees.ball(h.id).length;
  const saved = JSON.stringify(beeSave.write(z, 1));
  const reload = () => {
    const r = new BeeWorld(7);
    beeSave.read(r, JSON.parse(saved) as BeeSaveData);
    return r;
  };
  const [r1, r2] = [reload(), reload()];
  const same = JSON.stringify(beeSave.write(r1, 1)) === saved && r1.hornets.get(h.id)?.state === 'ball';
  run(r1, 20);
  run(r2, 20);
  check('热球时存档往返一致、读两次走得一样', same && fingerprint(r1) === fingerprint(r2) && JSON.stringify(r1.hornets.toSave()) === JSON.stringify(r2.hornets.toSave()));
  let tBall = 25;
  let hot = 0;
  while (h.state === 'ball' && tBall < 150) {
    run(z, 5);
    tBall += 5;
    hot = Math.max(hot, h.heat);
  }
  check('热球：上百只蜂围住胡蜂，升到 45 °C 以上把它闷死', ball >= 80 && hot > CONFIG.hornets.lethal && h.state === 'dead', `${ball} 只，最热 ${hot.toFixed(1)} °C，${tBall} 秒`);
  run(z, 60);
  const stuck = z.bees.list.filter((b) => b.act === 'ball' || b.act === 'goBall').length;
  check('热球散了，蜂都回巢、死胡蜂掉在地上', stuck === 0 && h.pos.y < z.groundAt(h.pos.x, h.pos.z) + 1, `还在球里 ${stuck} 只，胡蜂离地 ${(h.pos.y - z.groundAt(h.pos.x, h.pos.z)).toFixed(1)} cm`);

  z.hornets.spawn(1);
  run(z, 20);
  const g = z.hornets.list.find((o) => o.state !== 'dead')!;
  const ok = z.hornets.swat(g.id);
  run(z, 2);
  check('电蚊拍：打死的胡蜂掉下来、记进事件', ok && g.state === 'dead' && z.hornets.swatted === 1 && !z.hornets.swat(g.id) && z.events.entries.some((e) => e.ref?.kind === 'hornet' && e.ref.id === g.id));
  z.hornets.spawn(1);
  run(z, 20);
  z.weather.startRain(true);
  run(z, 5);
  check('下雨了，胡蜂飞走', z.hornets.list.every((o) => o.state === 'dead' || o.state === 'leave') || z.hornets.list.filter((o) => o.state !== 'dead').length === 0);
}
{
  // 养蜂人：割蜜、换框（T-023）。另开世界
  const x = new BeeWorld(7);
  run(x, 10);
  const K = x.keeper;
  const Hv = CONFIG.hive;
  let brood = -1;
  let cell = -1;
  for (let c = 0; c < CELLS; c++) {
    if (brood < 0 && x.comb.content[c] === CELL.capped) brood = c;
    if (cell < 0 && x.comb.content[c] === CELL.cappedHoney && K.cutArea(c).length > 80) cell = c;
  }
  const area = K.cutArea(cell);
  const h0 = x.comb.census().honeyCells;
  const cut = x.harvest(cell);
  const h1 = x.comb.census().honeyCells;
  const off = () => x.bees.list.filter((b) => !b.out && !x.bees.map.ok(b.u, b.v)).length;
  check(
    '割蜜：割下一块封盖蜜，有子的地方不割，蜂挪到还在的巢脾上',
    !x.harvest(brood).ok && cut.ok && area.every((s) => x.comb.build[s] < 1) && Math.abs(h0 - h1 - K.harvested) < 1 && off() === 0 && K.alarm > 0.5,
    `${area.length} 个位置，${Math.round(K.harvested)} 房蜜`,
  );
  run(x, 60);
  const saved = JSON.stringify(beeSave.write(x, 1));
  const reload = () => {
    const r = new BeeWorld(7);
    beeSave.read(r, JSON.parse(saved) as BeeSaveData);
    return r;
  };
  const [r1, r2] = [reload(), reload()];
  const same = JSON.stringify(beeSave.write(r1, 1)) === saved && r1.comb.repairs === x.comb.repairs;
  run(r1, 20);
  run(r2, 20);
  check('补巢脾时存档往返一致、读两次走得一样', same && fingerprint(r1) === fingerprint(r2));
  run(x, 400);
  const rebuilt = area.filter((s) => x.comb.build[s] >= 1).length;
  check('割掉的缺口大半天补回来，躁动退了', rebuilt > area.length * 0.8 && K.alarm < 0.05, `补好 ${rebuilt} / ${area.length}，躁动 ${K.alarm.toFixed(3)}`);
  const upper = () => {
    let n = 0;
    for (let s = 0; s < SITES; s++) if (siteFrame(s) === 1 && x.comb.build[s] > 0) n++;
    return n;
  };
  const was = K.frameContents(1);
  const swapped = x.swapFrame(1).ok;
  const n0 = upper();
  check(
    '换框：上框换成空巢框，只剩框梁下中间一段，上面的蜂挪到下框',
    swapped && n0 > 0 && n0 < GRID.cols / 2 && off() === 0 && x.bees.list.every((b) => b.out || b.v < Hv.frameH + Hv.bar) && K.lostBrood === was.brood && K.stress > 0.3,
    `拿走子 ${was.brood} 个、蜜 ${Math.round(was.honey)} 房`,
  );
  run(x, 300);
  check('空巢框从框梁中间往下造', upper() > 4 * n0, `${n0} → ${upper()} 个位置`);
}
{
  // 巢虫和中囊病（T-024）。另开世界，按 1 秒一步跑得快些
  const fast = (z: BeeWorld, secs: number) => {
    for (let i = 0; i < secs; i++) z.advance(1, Infinity, Infinity);
  };
  const x = new BeeWorld(7);
  const P = x.pests;
  const strong = P.mothChance();
  P.lay(6);
  const start = P.worms[0].site;
  fast(x, 600);
  let silk = 0;
  for (let c = 0; c < CELLS; c++) if (x.comb.silk[c] > 0) silk++;
  const moved = P.worms.some((m) => m.site !== start);
  check('巢虫：从巢脾边钻进去，在房底下打隧道留下丝', moved && silk > 5, `${P.worms.length} 条还在，${silk} 房有丝，白头蛹 ${P.bald}`);
  // 只看这一次发病：不让它每天自己再发
  const SB = CONFIG.pests.sacbrood as { days: number };
  const days = SB.days;
  SB.days = 0;
  P.outbreak();
  const infected = P.infected;
  fast(x, 30);
  const saved = JSON.stringify(beeSave.write(x, 1));
  const reload = () => {
    const r = new BeeWorld(7);
    beeSave.read(r, JSON.parse(saved) as BeeSaveData);
    return r;
  };
  const [r1, r2] = [reload(), reload()];
  const same = JSON.stringify(beeSave.write(r1, 1)) === saved;
  run(r1, 20);
  run(r2, 20);
  check('有巢虫、有染病的幼虫时存档往返一致、读两次走得一样', same && P.worms.length > 0 && fingerprint(r1) === fingerprint(r2));
  let told = false;
  for (let i = 0; i < 140; i++) {
    fast(x, 10);
    told ||= x.events.entries.some((e) => e.ref?.kind === 'cell' && tr(e.msg) === tr(L('ev.sac')));
  }
  const ds = P.disease();
  check(
    '中囊病：染病的幼虫到封盖时死成囊，记进事件，清理蜂拖走',
    infected >= CONFIG.pests.sacbrood.seed[0] && P.sacs > 0 && told && ds.sacs < P.sacs,
    `染上 ${P.infected} 只，死成囊 ${P.sacs}，还没拖走 ${ds.sacs}`,
  );
  check('巢虫：蜂多的群里大多被拖出去', P.removed + P.matured >= P.hatched / 2, `孵出 ${P.hatched}，拖出 ${P.removed}，化蛹 ${P.matured}，还在 ${P.worms.length}，白头蛹 ${P.bald}`);
  fast(x, 1800);
  check('中囊病：强群里几天后自己好了', P.disease().sick === 0, `一共染上 ${P.infected} 只、死成囊 ${P.sacs}`);
  SB.days = days;
  // 弱群：拿掉七成工蜂，蜡螟来得多，白头蛹多、有被丝缠死的
  const y = new BeeWorld(7);
  const keep = y.bees.list.filter((b, i) => b.caste !== CASTE.worker || i % 10 >= 7);
  y.bees.list.length = 0;
  y.bees.list.push(...keep);
  const weak = y.pests.mothChance();
  for (let i = 0; i < 3; i++) y.pests.lay(5);
  fast(y, 1800);
  const Y = y.pests;
  check('巢虫：弱群里蜡螟来得多，白头蛹成片，有的蛹被丝缠死', weak > 3 * strong && Y.bald > 30 && Y.entangled > 0, `来的机会 ${strong.toFixed(3)} → ${weak.toFixed(3)}，白头蛹 ${Y.bald}，缠死 ${Y.entangled}`);
  const wf = Y.worms.length ? siteFrame(Y.worms[0].site) : 0;
  const onFrame = Y.worms.filter((m) => siteFrame(m.site) === wf).length;
  y.swapFrame(wf);
  check('换框连巢虫一起拿走', onFrame > 0 && Y.culled === onFrame && Y.worms.every((m) => siteFrame(m.site) !== wf), `拿走 ${Y.culled} 条`);
}
{
  // 飞逃和野生蜂群（T-025）
  const U = CONFIG.abscond;
  const x = new BeeWorld(7);
  const A = x.abscond;
  const heard = new Set<string>();
  const told = (key: Parameters<typeof L>[0]) => heard.has(key);
  const fast = (secs: number, each = () => {}) => {
    for (let i = 0; i < secs; i++) {
      each();
      x.advance(1, Infinity, Infinity);
      for (const b of x.bees.list) seen.add(b.act);
      for (const e of x.events.entries) if (typeof e.msg === 'object' && 'k' in e.msg) heard.add(e.msg.k);
    }
  };
  // 开箱的压力一天里一直是满的：压力涨了，还没到征兆，更不会飞逃
  fast(600, () => (x.keeper.stress = 1));
  const p1 = A.pressure;
  check('飞逃：处境不好一天，压力涨了但没到征兆', p1 > 0.1 && p1 < U.restless && A.swarm.phase === 'home' && !A.restless, `压力 ${p1.toFixed(3)}，处境 ${A.bad}`);
  A.pressure = U.restless + 0.01;
  fast(10, () => (x.keeper.stress = 1));
  check('飞逃：压力过了一道线有征兆，记进事件', A.restless && A.unrest > 0 && told('ev.restless'), `征兆 ${A.unrest.toFixed(3)}`);
  const n0 = x.bees.list.length;
  A.leave();
  fast(40);
  const outside = x.bees.list.filter((b) => b.out >= 2).length;
  const saved = JSON.stringify(beeSave.write(x, 1));
  const reload = () => {
    const r = new BeeWorld(7);
    beeSave.read(r, JSON.parse(saved) as BeeSaveData);
    return r;
  };
  const [r1, r2] = [reload(), reload()];
  const same = JSON.stringify(beeSave.write(r1, 1)) === saved;
  run(r1, 20);
  run(r2, 20);
  check('飞逃时存档往返一致、读两次走得一样', same && outside > 0 && fingerprint(r1) === fingerprint(r2), `40 秒出来 ${outside} / ${n0} 只`);
  let t = 0;
  for (; t < 600 && A.swarm.phase !== 'empty'; t += 10) fast(10);
  check(
    '飞逃：蜂从巢门涌出、在箱外盘旋、飞走，箱子空了，子死在房里',
    A.swarm.phase === 'empty' && x.bees.list.length === 0 && A.left > n0 * 0.9 && A.abandoned > 1000 && told('ev.abscond') && told('ev.gone') && x.comb.census().counts.larva === 0,
    `${t} 秒飞走 ${A.left} 只，丢下 ${A.abandoned} 个子`,
  );
  let built = 0;
  for (let s = 0; s < SITES; s++) if (x.comb.build[s] > 0) built++;
  const left = x.comb.census();
  check(
    '空箱里换上两框空巢框：旧巢脾、蜜、巢虫都拿走，只有框梁下起了个头',
    built > 0 && built < GRID.cols && left.honeyCells === 0 && left.counts.sac === 0 && x.pests.worms.length === 0 && told('ev.renew'),
    `起头的位置 ${built} 个`,
  );
  const honey0 = x.comb.census().honeyCells;
  for (t = 0; t < 3 * CONFIG.clock.dayLength && A.swarm.phase !== 'home'; t += 10) fast(10);
  const inside = x.bees.list.filter((b) => !b.out).length;
  const brought = x.comb.census().honeyCells + A.stash - honey0;
  check(
    '空箱：侦察蜂来看过，野生蜂群搬进来，有蜂王，带来了蜜',
    A.swarm.phase === 'home' && A.moveIns === 1 && inside > U.workers[0] * 0.8 && !!x.bees.queen && !x.bees.queen.out && told('ev.scouts') && told('ev.moveIn') && brought > U.workers[0] * U.carry * 0.5,
    `空了约 ${(t / CONFIG.clock.dayLength).toFixed(1)} 天，搬进来 ${x.bees.list.length} 只，${inside} 只在巢里，带来约 ${Math.round(brought)} 房蜜`,
  );
  const laid = x.bees.laid;
  fast(600);
  let rebuilt = 0;
  for (let s = 0; s < SITES; s++) if (x.comb.build[s] >= 1) rebuilt++;
  check(
    '野生蜂群住下来：一天里从框梁往下造巢脾，带来的蜜吐进新造的巢房，蜂王产卵',
    rebuilt > 500 && A.stash === 0 && x.bees.laid > laid + 50 && x.bees.list.every((b) => !b.swarm || b.out),
    `造好 ${rebuilt} 个位置，产了 ${x.bees.laid - laid} 粒`,
  );
  // 蜂快死光了：和飞逃一样空出箱子
  const y = new BeeWorld(7);
  const few = y.bees.list.filter((b) => b.caste !== CASTE.worker).concat(y.bees.list.filter((b) => b.caste === CASTE.worker).slice(0, U.collapse - 5));
  y.bees.list.length = 0;
  y.bees.list.push(...few);
  for (let i = 0; i < 10; i++) y.advance(1, Infinity, Infinity);
  check('蜂快死光了，箱子空出来', y.abscond.swarm.phase === 'empty' && y.bees.list.length === 0);
}
const missing = ACTS.filter((a) => !seen.has(a));
check('各种活都有蜂做过', missing.length === 0, missing.length ? `没见到 ${missing.join(' ')}` : `${seen.size} 种`);
check('一天后子的阶段和日龄还对得上', stageMismatch(comb) === 0, `卵 ${c0.egg}→${c1.egg} 幼虫 ${c0.larva}→${c1.larva} 封盖 ${c0.capped}→${c1.capped}`);

const json = JSON.stringify(beeSave.write(w, 1));
const load = () => {
  const d = JSON.parse(json) as BeeSaveData;
  const x = new BeeWorld(d.seed);
  beeSave.read(x, d);
  return x;
};
const a = load();
check('存档往返内容一致', JSON.stringify(beeSave.write(a, 1)) === json, `${(json.length / 1024).toFixed(1)} KB`);
check('读档后巢脾一样', a.comb.content.every((c, i) => c === comb.content[i]) && a.comb.age.every((x, i) => x === comb.age[i]));
check(
  '读档后蜂一样（巢里的和在外面的）',
  a.bees.list.length === bees.list.length &&
    a.bees.list.every((x, i) => {
      const y = bees.list[i];
      return x.id === y.id && x.face === y.face && x.out === y.out && Math.abs(x.u - y.u) < 1e-3 && Math.abs(x.pos.x - y.pos.x) < 1e-3 && Math.abs(x.pos.y - y.pos.y) < 1e-3 && Math.abs(x.load - y.load) < 1e-3 && x.partner === y.partner && Math.abs(x.dev - y.dev) < 1e-3 && !x.aim === !y.aim && (!x.aim || Math.abs(x.aim.x - y.aim!.x) < 1e-3);
    }),
  `${bees.list.filter((x) => x.out).length} 只在外面`,
);
check('读档后花丛一样', JSON.stringify(a.flowers.patches) === JSON.stringify(w.flowers.patches));
const b = load();
run(a, 60);
run(b, 60);
check('同一存档读两次走得一样', fingerprint(a) === fingerprint(b));
let bad: string | null = null;
try {
  beeSave.read(new BeeWorld(8), JSON.parse(json) as BeeSaveData);
} catch (e) {
  bad = (e as Error).message;
}
check('编号不对的存档拒读', bad !== null, bad ?? '');
check('旧版本存档报问题', beeSave.problem({ ...(JSON.parse(json) as BeeSaveData), version: 0 }) !== null);

{
  const missing = NOTES.flatMap((n) => [n.group, n.title, n.body, n.hint!]).filter((k) => !(k in en));
  check('笔记的每一条都有中英文字和没看到时的提示', missing.length === 0 && new Set(NOTES.map((n) => n.id)).size === NOTES.length, missing.join(' ') || `${NOTES.length} 条`);
  const x = new BeeWorld(7);
  let sel: BeeRef | null = null;
  let swapping = false;
  const def = beeNotes(x, { selection: () => sel, tool: () => null, swapping: () => swapping });
  const seen = (known = new Set<string>()) => new Set(def.check(known));
  const first = seen();
  for (let i = 0; i < 120; i++) x.advance(1, Infinity, Infinity);
  const later = seen();
  x.hornets.spawn(1);
  x.advance(1, Infinity, Infinity);
  const hornet = seen();
  sel = { kind: 'cell', id: x.comb.content.findIndex((c, k) => c === CELL.cappedHoney && x.keeper.cutArea(k).length > 0) };
  swapping = true;
  const keeping = seen();
  check(
    '第一次的提示：开局讲观察箱，跳舞、胡蜂、选中封盖蜜、问换框时各弹一张',
    first.has('hive') && !first.has('hornet') && later.has('dance') && hornet.has('hornet') && keeping.has('harvest') && keeping.has('swap'),
    [...keeping].join(' '),
  );
  const look = (ref: BeeRef) => {
    sel = ref;
    return seen();
  };
  const queen = look({ kind: 'bee', id: x.bees.queen!.id });
  const worker = x.bees.list.find((b) => b.caste === CASTE.worker && roleOf(b) === 'nurse')!;
  const nurse = look({ kind: 'bee', id: worker.id });
  const brood = look({ kind: 'cell', id: x.comb.content.indexOf(CELL.larva) });
  const pollen = look({ kind: 'cell', id: x.comb.content.indexOf(CELL.pollen) });
  check(
    '笔记：选中蜂王、一只哺育蜂、幼虫房、花粉房时记下对应的条目',
    queen.has('queen') && nurse.has('nurse') && !nurse.has('queen') && brood.has('comb') && brood.has('brood') && pollen.has('pollen') && !pollen.has('brood'),
    [...nurse, ...pollen].join(' '),
  );
  const before = look({ kind: 'bee', id: worker.id });
  const hive = look({ kind: 'hive', id: 0 });
  sel = null;
  x.harvest(x.comb.content.findIndex((c, k) => c === CELL.cappedHoney && x.keeper.cutArea(k).length > 0));
  x.togglePlate();
  const done = seen(new Set(['hive', 'queen', 'nurse', 'comb', 'brood', 'sac']));
  check(
    '笔记：现实里的养蜂在做过、见过相关的事以后才记下',
    !before.has('honeyPlan') && !before.has('defense') && !before.has('varroa') && hive.has('inspect') && ['cerana', 'honeyPlan', 'defense', 'varroa'].every((id) => done.has(id)) && !done.has('combs') && !done.has('feeding'),
    [...done].join(' '),
  );
}

const texts = new Set<string>([tr(w.clock.stamp())]);
for (const e of w.events.entries) texts.add(tr(e.msg));
for (const k of Object.keys(en) as (keyof typeof en)[]) texts.add(t(k, { w: 40, h: 22, n: 3, b: 2, e: 1, l: 4, c: 5, frame: 'x', face: 'y', row: 6, col: 7, p: 8, t: 'z', d: 2, o: 1, a: 'x', x: 3, flower: 'x', goods: 'y', r: 4, s: 5, dir: 'x', m: 6, role: 'x', place: 'x', weather: 'x', cause: 'x', lo: 1, hi: 2, f: 3, brood: 4, honey: 5 }));
const leaks = [...texts].filter((s) => /[一-鿿]|undefined|\{\w+\}|\[object/.test(s));
check('英文文字没漏翻', leaks.length === 0, leaks.join(' / ') || `${texts.size} 种`);

console.log(`模拟 ${CONFIG.clock.dayLength} 秒用了 ${ms.toFixed(0)} ms，每步 ${stepMs.toFixed(2)} ms（${bees.list.length} 只蜂）`);
if (failed) {
  console.log(`${failed} 项失败`);
  process.exitCode = 1;
} else console.log('全部通过');

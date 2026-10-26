/**
 * 蜜蜂的无界面检查：巢脾网格和开局布局、子的发育、点选巢房、花丛的位置和开合流蜜、存档往返、同编号可重现、坏存档拒读、英文文字没漏翻。
 * 蜂加进来以后在这里补上它们的检查。
 * npx tsx scripts/games/bee/beetest.ts
 */
import * as THREE from 'three';
import { setLang, t, tr } from '../../../src/core/i18n';
import { CombView } from '../../../src/games/bee/combView';
import { CONFIG } from '../../../src/games/bee/config';
import { CELL, CELLS, CONTENT_KEYS, SITES, cellPos, siteAt, siteU, siteV, type Comb } from '../../../src/games/bee/sim/comb';
import { nectarCap, openness, plantCount, pollenCap, SPECIES_KEYS } from '../../../src/games/bee/sim/flowers';
import { BeeWorld, beeSave, type BeeSaveData } from '../../../src/games/bee/world';
import { en } from '../../../src/games/bee/i18n/en';

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
const fingerprint = (w: BeeWorld) => `${w.clock.seconds.toFixed(3)}|${w.rng.state}|${w.emerged}|${w.comb.version}`;

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
check('开局每种内容都有', CONTENT_KEYS.every((k) => c0[k] > 0), CONTENT_KEYS.map((k) => `${k} ${c0[k]}`).join(' '));
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
check('花丛：片数对、每种花都有', patches.length === F.patches && F.species.every((_, i) => patches.some((p) => p.species === i)), patches.map((p) => SPECIES_KEYS[p.species]).join(' '));
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
  p.nectar = 0;
}
const corn = patches.find((q) => SPECIES_KEYS[q.species] === 'corn')!;
check('玉米没有花蜜', nectarCap(corn) === 0 && w.flowers.take(corn, 'nectar', 1, 9) === 0);
run(w, CONFIG.clock.dayLength);
check('一天过去了', w.clock.day === 2, tr(w.clock.stamp()));
check('采空的花丛一天里长回来、不超过满', patches.every((p) => p.nectar <= nectarCap(p) + 1e-9 && p.pollen <= pollenCap(p) + 1e-9) && emptied.nectar > nectarCap(emptied) * 0.99, `${((emptied.nectar / nectarCap(emptied)) * 100).toFixed(0)}%`);
check('蜂箱周围的地面是平的', w.groundAt(0, 0) === 0 && w.groundAt(40, -30) === 0);
const ms = performance.now() - t0;
const c1 = comb.census().counts;
check('一天里有子羽化', w.emerged > 0, `${w.emerged} 只`);
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
check('读档后巢脾一样', a.comb.content.every((c, i) => c === comb.content[i]) && a.comb.age.every((x, i) => x === comb.age[i]) && a.emerged === w.emerged);
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

const texts = new Set<string>([tr(w.clock.stamp())]);
for (const e of w.events.entries) texts.add(tr(e.msg));
for (const k of Object.keys(en) as (keyof typeof en)[]) texts.add(t(k, { w: 40, h: 22, n: 3, b: 2, e: 1, l: 4, c: 5, frame: 'x', face: 'y', row: 6, col: 7, p: 8, t: 'z', d: 2, o: 1, a: 'x' }));
const leaks = [...texts].filter((s) => /[一-鿿]|undefined|\{\w+\}|\[object/.test(s));
check('英文文字没漏翻', leaks.length === 0, leaks.join(' / ') || `${texts.size} 种`);

console.log(`模拟 ${CONFIG.clock.dayLength} 秒用了 ${ms.toFixed(0)} ms`);
if (failed) {
  console.log(`${failed} 项失败`);
  process.exitCode = 1;
} else console.log('全部通过');

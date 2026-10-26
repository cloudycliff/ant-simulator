/**
 * 蜜蜂的无界面检查：存档往返、同编号可重现、坏存档拒读、英文文字没漏翻。
 * 巢脾、蜂、花丛加进来以后在这里补上它们的检查。
 * npx tsx scripts/games/bee/beetest.ts
 */
import { setLang, t, tr } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/bee/config';
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
const fingerprint = (w: BeeWorld) => `${w.clock.seconds.toFixed(3)}|${w.rng.state}`;

const t0 = performance.now();
const w = new BeeWorld(7);
run(w, CONFIG.clock.dayLength);
check('一天过去了', w.clock.day === 2, tr(w.clock.stamp()));
check('蜂箱周围的地面是平的', w.groundAt(0, 0) === 0 && w.groundAt(40, -30) === 0);
const ms = performance.now() - t0;

const json = JSON.stringify(beeSave.write(w, 1));
const load = () => {
  const d = JSON.parse(json) as BeeSaveData;
  const x = new BeeWorld(d.seed);
  beeSave.read(x, d);
  return x;
};
const a = load();
check('存档往返内容一致', JSON.stringify(beeSave.write(a, 1)) === json, `${(json.length / 1024).toFixed(1)} KB`);
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
for (const k of Object.keys(en) as (keyof typeof en)[]) texts.add(t(k, { w: 40, h: 22 }));
const leaks = [...texts].filter((s) => /[一-鿿]|undefined|\{\w+\}|\[object/.test(s));
check('英文文字没漏翻', leaks.length === 0, leaks.join(' / ') || `${texts.size} 种`);

console.log(`模拟 ${CONFIG.clock.dayLength} 秒用了 ${ms.toFixed(0)} ms`);
if (failed) {
  console.log(`${failed} 项失败`);
  process.exitCode = 1;
} else console.log('全部通过');

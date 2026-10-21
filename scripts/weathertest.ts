/**
 * 天气测试：热身后招来一场雨，观察觅食蚁返巢、入口封堵、信息素冲刷、浅层房间进水和雨后重开。
 * npx tsx scripts/weathertest.ts [热身秒数，默认 300] [观察秒数，默认 600]
 */
import { CONFIG } from '../src/config';
import { World } from '../src/world/world';

const warm = Number(process.argv[2] ?? 300);
const secs = Number(process.argv[3] ?? 600);
const w = new World();
const step = 1 / 30;
CONFIG.weather.rainPerDay = 0;
for (let t = 0; t < warm; t += step) w.advance(step);
const log: string[] = [];
const push = w.colony.pushEvent.bind(w.colony);
w.colony.pushEvent = (msg: string) => {
  log.push(`${w.clock.stamp()} ${msg}`);
  push(msg);
};

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
const shallow = w.nest.chambers.filter((c) => c.depth < CONFIG.weather.floodDepth);
const trail0 = sum(w.pheromone.trail);
const out0 = w.colony.outsideCount();
console.log(`热身 ${warm} 秒（${w.clock.hour.toFixed(1)} 时），巢外 ${out0} 只，路径信息素 ${trail0.toFixed(0)}`);
console.log(w.callRain().msg);

const W = w.weather;
let minOut = out0;
let maxBlocked = 0;
let blockedWhy = '';
let maxWet = 0;
let sealedAt = -1;
let reopenAt = -1;
let rainEnd = -1;
for (let t = 0; t < secs; t += step) {
  w.advance(step);
  const out = w.colony.outsideCount();
  minOut = Math.min(minOut, out);
  const blockedAnts = w.colony.ants.filter((a) => a.activity.includes('已被土粒封住'));
  const blocked = blockedAnts.length;
  if (blocked > maxBlocked) {
    maxBlocked = blocked;
    const why = new Map<string, number>();
    for (const a of blockedAnts) {
      const k = `${a.role}:${a.taskActivity}${a.carrying ? '(搬着东西)' : ''}`;
      why.set(k, (why.get(k) ?? 0) + 1);
    }
    blockedWhy = [...why.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}×${k}`).join('，');
  }
  for (const c of shallow) maxWet = Math.max(maxWet, c.wet);
  if (sealedAt < 0 && w.nest.entrances.every((e) => e.plug >= 1)) sealedAt = t;
  if (rainEnd < 0 && W.phase === 'clear') rainEnd = t;
  if (sealedAt >= 0 && reopenAt < 0 && w.nest.entrances.every((e) => e.plug === 0)) reopenAt = t;
  if (Math.round(t / step) % Math.round(15 / step) === 0) {
    const plugs = w.nest.entrances.map((e) => e.plug.toFixed(1)).join('/');
    const wet = shallow.map((c) => `${c.name}${c.wet.toFixed(2)}`).join(' ');
    const pluggers = w.colony.ants.filter((a) => a.plugging >= 0).length;
    console.log(
      `t=${t.toFixed(0).padStart(3)}s ${W.label.padEnd(2)} 雨${W.rain.toFixed(2)} 云${W.cloud.toFixed(2)} 湿${W.wetness.toFixed(2)} ${w.clock.temperatureAt(0).toFixed(1)}°C` +
        ` 巢外=${out} 封堵=${plugs} 封堵中=${pluggers} 等在入口=${blocked} 水洼=${w.water.puddles.length} 信息素=${sum(w.pheromone.trail).toFixed(0)} | ${wet} 蛹室=${w.nest.chambers[w.colony.pupaChamber].name}`,
    );
  }
}
console.log(
  `\n结果：巢外最少 ${minOut} 只（雨前 ${out0}），${sealedAt >= 0 ? `${sealedAt.toFixed(0)} 秒全部封住` : '入口没有全部封住'}，` +
    `${rainEnd >= 0 ? `${rainEnd.toFixed(0)} 秒雨停` : '雨未停'}，${reopenAt >= 0 ? `${reopenAt.toFixed(0)} 秒重新打开` : '尚未重开'}，` +
    `最多 ${maxBlocked} 只等在封住的入口，浅层房间最大积水 ${maxWet.toFixed(2)}，巢外现在 ${w.colony.outsideCount()} 只`,
);
console.log(`等在入口的原因：${blockedWhy}`);
console.log('期间的事件：');
for (const e of log) console.log(' ', e);

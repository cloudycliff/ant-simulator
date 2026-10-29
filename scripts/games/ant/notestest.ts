/**
 * 笔记测试：每一条都有中英文字，以及选中、用工具、天气、天敌、蚂蚁在做的事能记下对应的条目；读档时日志里的旧事件不弹提示卡。
 * npx tsx scripts/games/ant/notestest.ts
 */
import { L } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/ant/config';
import { en } from '../../../src/games/ant/i18n/en';
import { zh } from '../../../src/games/ant/i18n/zh';
import { NOTES, antNotes } from '../../../src/games/ant/ui/notes';
import type { ToolKind } from '../../../src/games/ant/ui/tools';
import type { GameRef } from '../../../src/games/ant/world/entities';
import { World } from '../../../src/games/ant/world/world';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '通过' : '失败'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

const keys = NOTES.flatMap((n) => [n.group, n.title, n.body, n.hint!]);
const missing = keys.filter((k) => !(k in zh) || !(k in en));
check('笔记的每一条都有中英文字和没看到时的提示', missing.length === 0 && new Set(NOTES.map((n) => n.id)).size === NOTES.length, missing.join(' ') || `${NOTES.length} 条`);

const step = 1 / 30;
CONFIG.weather.rainPerDay = 0;
const w = new World();
const run = (secs: number) => {
  for (let t = 0; t < secs; t += step) w.advance(step);
};
// 开始看之前日志里已经有一条会记笔记的事件：像读了一个旧档
run(5);
w.events.push(L('ev.overcast'));

let sel: GameRef | null = null;
let tool: ToolKind | null = null;
let xray = false;
const def = antNotes(w, { selection: () => sel, tool: () => tool, xray: () => xray, pheromone: () => false, roleColors: () => false });
const seen = (known = new Set<string>()) => new Set(def.check(known));
const look = (ref: GameRef | null) => {
  sel = ref;
  return seen();
};

const first = seen();
check('开局讲这窝蚂蚁，日志里的旧事件和蚂蚁正在做的事先不算', first.has('nest') && !first.has('rain') && !first.has('share'), [...first].join(' '));
w.events.push(L('ev.sealed', { ent: 'x' }));
w.events.restore(w.events.toSave());
const restored = seen();
w.events.push(L('ev.sealed', { ent: 'x' }));
const fresh = seen();
check('读档换掉的日志不算新事件，之后新来的算', !restored.has('rain') && fresh.has('rain'), `${[...restored].join(' ')} | ${[...fresh].join(' ')}`);

const queen = w.colony.ants.find((a) => a.role === 'queen')!;
const nurse = w.colony.ants.find((a) => a.role === 'nurse')!;
const forager = w.colony.ants.find((a) => a.role === 'forager' && !a.scout)!;
const onQueen = look({ kind: 'ant', id: queen.id });
const onNurse = look({ kind: 'ant', id: nurse.id });
const roles = def.check(new Set(['nurse', 'forager']));
sel = { kind: 'ant', id: forager.id };
const onForager = new Set(def.check(new Set(['nurse', 'forager'])));
const room = (type: string) => look({ kind: 'chamber', id: w.nest.chambers.findIndex((c) => c.type === type) });
const onQueenRoom = room('queen');
const onLarva = room('larva');
const onWaste = room('waste');
sel = null;
check(
  '选中蚁后、保育蚁、觅食蚁和各种房间时记下对应的条目',
  onQueen.has('queen') &&
    onNurse.has('nurse') &&
    !onNurse.has('queen') &&
    !onNurse.has('roles') &&
    onForager.has('forager') &&
    onForager.has('roles') &&
    onQueenRoom.has('queen') &&
    onLarva.has('brood') &&
    onWaste.has('midden'),
  [...onNurse, '|', ...onForager, '|', ...roles].join(' '),
);

const known = new Set(['queen', 'feed']);
const real = new Set(def.check(known));
check('读过蚁后、用过投食以后记下现实里的蚂蚁', real.has('founding') && real.has('keeping') && !real.has('lifespan'), [...real].join(' '));

tool = 'food';
const feeding = seen();
tool = 'predator';
xray = true;
const predatorTool = seen();
tool = null;
xray = false;
check('选投食工具、天敌工具、打开透视时各记一条', feeding.has('feed') && predatorTool.has('spider') && predatorTool.has('xray'), [...predatorTool].join(' '));

let r = w.placePredator('spider', 4.5, 4);
for (let i = 0; !r.ok && i < 12; i++) r = w.placePredator('spider', 4.5 + Math.cos(i) * 3, 4 + Math.sin(i) * 3);
const spider = seen();
const rain = (w.callRain(), run(2), seen());
check('放狼蛛、招雨的事件记下对应的条目', r.ok && spider.has('spider') && rain.has('rain'), [...rain].join(' '));

const want = new Set(['share', 'memory', 'prey', 'mob']);
const acts = new Set<string>();
for (let t = 0; t < 240 && !acts.has('share'); t += 2) {
  run(2);
  for (const id of def.check(new Set())) if (want.has(id)) acts.add(id);
}
check('有蚂蚁在交哺时记下社会胃', acts.has('share'), [...acts].join(' '));

if (failed) {
  console.log(`${failed} 项失败`);
  process.exitCode = 1;
} else console.log('全部通过');

import type { MsgKey } from '../../../core/i18n';
import type { NoteDef, NotesDef } from '../../../core/app/notes';
import type { SimEvent } from '../../../core/sim/events';
import type { ToolKind } from './tools';
import type { GameRef } from '../world/entities';
import type { World } from '../world/world';

/** 笔记的分组，按这个顺序列 */
type Group = 'nest' | 'workers' | 'forage' | 'aphids' | 'weather' | 'threats' | 'real';

/** 一条笔记：编号就是词典里 note.<id>.title / body / hint 的 <id>；tip 为真的第一次看到弹提示卡 */
const note = (id: string, group: Group, tip = true): NoteDef => ({
  id,
  group: `notes.group.${group}` as MsgKey,
  title: `note.${id}.title` as MsgKey,
  body: `note.${id}.body` as MsgKey,
  hint: `note.${id}.hint` as MsgKey,
  tip,
});

/** 第一次的提示和笔记（T-077、T-078）；顺序就是笔记里的顺序，同一组的放在一起 */
export const NOTES: NoteDef[] = [
  note('nest', 'nest'),
  note('xray', 'nest'),
  note('queen', 'nest', false),
  note('brood', 'nest', false),
  note('expand', 'nest'),
  note('midden', 'nest', false),
  note('roles', 'workers'),
  note('nurse', 'workers', false),
  note('maintenance', 'workers', false),
  note('forager', 'workers', false),
  note('scout', 'workers', false),
  note('shift', 'workers', false),
  note('trail', 'forage'),
  note('memory', 'forage', false),
  note('share', 'forage', false),
  note('prey', 'forage', false),
  note('seeds', 'forage', false),
  note('feed', 'forage'),
  note('obstacle', 'forage'),
  note('aphids', 'aphids'),
  note('ladybug', 'aphids'),
  note('winged', 'aphids', false),
  note('rain', 'weather'),
  note('flood', 'weather', false),
  note('sun', 'weather'),
  note('cold', 'weather', false),
  note('water', 'weather'),
  note('spider', 'threats'),
  note('mob', 'threats'),
  note('antlion', 'threats'),
  note('corpse', 'threats', false),
  note('founding', 'real', false),
  note('lifespan', 'real', false),
  note('keeping', 'real', false),
  note('simplified', 'real', false),
];

/** 事件第一次出现就算看到了 */
const BY_EVENT: Record<string, string> = {
  'ev.digStart': 'expand',
  'ev.enlargeStart': 'expand',
  'ev.tunnelThrough': 'expand',
  'ev.foragerShortage': 'shift',
  'ev.foundFood': 'trail',
  'ev.foundAphids': 'aphids',
  'ev.ladybugArrived': 'ladybug',
  'ev.aphidsDisperse': 'winged',
  'ev.overcast': 'rain',
  'ev.sealed': 'rain',
  'ev.flooded': 'flood',
  'ev.pupaeFlood': 'flood',
  'ev.pupaeUp': 'sun',
  'ev.spiderRepelled': 'mob',
  'ev.antlionAte': 'antlion',
};

/** 有一只蚂蚁在做这件事就算看到了 */
const BY_ACT: Record<string, string> = {
  'act.receiveShare': 'share',
  'act.giveShare': 'share',
  'act.cutAt': 'prey',
  'act.goMemory': 'memory',
  'act.mobSpider': 'mob',
  'act.smellCorpse': 'corpse',
  'act.carryCorpseOut': 'corpse',
  'act.restCold': 'cold',
};
/** 开始看以后过这么多模拟秒才按蚂蚁在做的事记笔记 */
const ACT_AFTER = 20;

/** 选中的蚂蚁按分工记下对应的条目 */
const BY_ROLE: Record<string, string> = { queen: 'queen', nurse: 'nurse', maintenance: 'maintenance', forager: 'forager' };

/** 选中这几类房间讲卵、幼虫和蛹 */
const BROOD_ROOMS = new Set(['egg', 'larva', 'pupa', 'solar']);

/** 选着工具时讲这个工具 */
const BY_TOOL: Record<ToolKind, string> = { food: 'feed', obstacle: 'obstacle', water: 'water', predator: 'spider' };

/** 玩家这一刻在看什么、在用什么 */
export interface NotesLook {
  selection(): GameRef | null;
  tool(): ToolKind | null;
  xray(): boolean;
  pheromone(): boolean;
  roleColors(): boolean;
}

/** 什么时候算看到了。界面层的东西：只读世界，不改模拟 */
export function antNotes(w: World, look: NotesLook): NotesDef {
  /**
   * 上一次问时日志里最新的一条，只算它之后新来的：读一个玩了几天的档时，日志里的旧事件不该一下排出一串提示卡。
   * 读档会换掉整份日志，那时上一条已经不在里面，整份都算旧的
   */
  let last: SimEvent<GameRef> | undefined | null = null;
  let start = -1;
  return {
    key: 'cyber-ant-notes',
    title: 'notes.title',
    entries: NOTES,
    *check(known) {
      // 第一次打开就讲这窝蚂蚁
      yield 'nest';
      const log = w.events.entries;
      if (last !== null && (last === undefined || log.includes(last))) {
        for (const e of log) {
          if (e === last) break;
          const id = BY_EVENT[e.msg.k];
          if (id) yield id;
        }
      }
      last = log[0];
      if (start < 0) start = w.clock.seconds;
      if (look.xray()) yield 'xray';
      if (look.pheromone()) yield 'trail';
      if (look.roleColors()) yield 'roles';
      const tool = look.tool();
      if (tool) yield BY_TOOL[tool];

      const sel = look.selection();
      if (sel?.kind === 'ant') {
        const a = w.colony.antById(sel.id);
        if (a) {
          yield BY_ROLE[a.role];
          if (a.scout) yield 'scout';
          if (a.role !== 'queen' && known.has('nurse') && known.has('forager')) yield 'roles';
        }
      } else if (sel?.kind === 'chamber') {
        const c = w.nest.chambers[sel.id];
        if (c?.type === 'queen') yield 'queen';
        if (c && BROOD_ROOMS.has(c.type)) yield 'brood';
        if (c?.type === 'waste') yield 'midden';
      } else if (sel?.kind === 'midden') yield 'midden';
      else if (sel?.kind === 'food') {
        const s = w.food.sources.find((f) => f.id === sel.id);
        if (s?.type === 'seeds') yield 'seeds';
        else if (s && (s.type === 'beetle' || s.type === 'caterpillar')) yield 'prey';
      } else if (sel?.kind === 'predator') {
        const p = w.predators.byId(sel.id);
        if (p) yield p.kind;
      }

      if (w.predators.spiders.length) yield 'spider';
      if (w.ladybugs.ladybugs.length) yield 'ladybug';
      if (w.predators.antlions.some((p) => p.placed)) yield 'antlion';
      if (w.weather.phase === 'rain') yield 'rain';

      // 交哺、切猎物这些不用选中，有一只蚂蚁在做就算；都看到过了就不用每次数一遍蚂蚁。
      // 开局一秒就有蚂蚁在交哺，先等一会儿，免得「笔记里多了一条」盖掉读档的提示、和第一张提示卡挤在一起
      const want = new Set(Object.entries(BY_ACT).flatMap(([k, id]) => (known.has(id) ? [] : [k])));
      if (want.size && w.clock.seconds - start >= ACT_AFTER) {
        const seen = new Set<string>();
        for (const a of w.colony.ants) if (want.has(a.activity.k)) seen.add(BY_ACT[a.activity.k]);
        yield* seen;
      }

      // 现实里的蚂蚁：玩家看过、做过相关的事以后才记下，讲得深一些
      if (known.has('queen')) yield 'founding';
      if (w.clock.day >= 3) yield 'lifespan';
      if (known.has('feed')) yield 'keeping';
      if (w.clock.day >= 2) yield 'simplified';
    },
  };
}

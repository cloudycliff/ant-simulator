import type { MsgKey } from '../../core/i18n';
import type { NoteDef, NotesDef } from '../../core/app/notes';
import { CONFIG } from './config';
import { CELL } from './sim/comb';
import type { BeeRef, BeeWorld } from './world';

/** 笔记的分组，按这个顺序列 */
type Group = 'hive' | 'forage' | 'climate' | 'threats' | 'keeping';

/** 一条笔记：编号就是词典里 note.<id>.title / note.<id>.body 的 <id> */
const note = (id: string, group: Group, tip = true): NoteDef => ({
  id,
  group: `notes.group.${group}` as MsgKey,
  title: `note.${id}.title` as MsgKey,
  body: `note.${id}.body` as MsgKey,
  tip,
});

/** 第一次的提示（P-014）；顺序就是笔记里的顺序 */
export const NOTES: NoteDef[] = [
  note('hive', 'hive'),
  note('dance', 'forage'),
  note('plant', 'forage'),
  note('sugar', 'keeping'),
  note('warm', 'climate'),
  note('fan', 'climate'),
  note('rain', 'climate'),
  note('hornet', 'threats'),
  note('ball', 'threats'),
  note('moth', 'threats'),
  note('sac', 'threats'),
  note('harvest', 'keeping'),
  note('swap', 'keeping'),
  note('lowHoney', 'keeping'),
  note('restless', 'keeping'),
  note('abscond', 'keeping'),
  note('scouts', 'keeping'),
];

/** 事件第一次出现就算看到了 */
const BY_EVENT: Record<string, string> = {
  'ev.hornet': 'hornet',
  'ev.ball': 'ball',
  'ev.bald': 'moth',
  'ev.sac': 'sac',
  'ev.restless': 'restless',
  'ev.abscond': 'abscond',
  'ev.scouts': 'scouts',
};

/** 玩家这一刻在看什么、在用什么 */
export interface NotesLook {
  selection(): BeeRef | null;
  /** 选着的工具（ToolDef.kind），没选是 null */
  tool(): string | null;
  /** 蜂箱面板里正在问要不要换框 */
  swapping(): boolean;
}

/** 什么时候算看到了。界面层的东西：只读世界，不改模拟 */
export function beeNotes(w: BeeWorld, look: NotesLook): NotesDef {
  return {
    key: 'cyber-bee-notes',
    title: 'notes.title',
    entries: NOTES,
    *check(known) {
      for (const e of w.events.entries) {
        const id = BY_EVENT[e.msg.k];
        if (id) yield id;
      }
      // 第一次打开就讲观察箱
      yield 'hive';
      const sel = look.selection();
      // 割蜜、换框、种花、放糖水在动手之前讲：选中割得下来的封盖蜜、问要不要换框、选了工具
      if (!known.has('harvest') && sel?.kind === 'cell' && w.comb.content[sel.id] === CELL.cappedHoney && w.keeper.cutArea(sel.id).length) yield 'harvest';
      if (look.swapping()) yield 'swap';
      const tool = look.tool();
      if (tool === 'plant' || tool === 'sugar') yield tool;
      if (!known.has('dance') && w.bees.list.some((b) => b.brain.cmd?.k === 'dance')) yield 'dance';
      if (w.heat.heating >= 40) yield 'warm';
      if (w.heat.fanning >= 20) yield 'fan';
      if (w.weather.phase === 'rain') yield 'rain';
      if (w.abscond.restless) yield 'restless';
      if (!known.has('lowHoney') && w.abscond.present && w.comb.census().honeyCells < CONFIG.abscond.hungerAt) yield 'lowHoney';
    },
  };
}

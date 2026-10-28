import type { MsgKey } from '../../core/i18n';
import type { NoteDef, NotesDef } from '../../core/app/notes';
import { CONFIG } from './config';
import { ageRoleOf, CASTE, roleOf, type Act } from './sim/bees';
import { CELL, cellSite, type CellContent } from './sim/comb';
import { SUGAR } from './sim/flowers';
import type { BeeRef, BeeWorld } from './world';

/** 笔记的分组，按这个顺序列 */
type Group = 'hive' | 'workers' | 'forage' | 'year' | 'life' | 'climate' | 'threats' | 'keeping' | 'real';

/** 一条笔记：编号就是词典里 note.<id>.title / body / hint 的 <id>；tip 为真的第一次看到弹提示卡 */
const note = (id: string, group: Group, tip = true): NoteDef => ({
  id,
  group: `notes.group.${group}` as MsgKey,
  title: `note.${id}.title` as MsgKey,
  body: `note.${id}.body` as MsgKey,
  hint: `note.${id}.hint` as MsgKey,
  tip,
});

/** 第一次的提示和笔记（P-014）；顺序就是笔记里的顺序，同一组的放在一起 */
export const NOTES: NoteDef[] = [
  note('hive', 'hive'),
  note('queen', 'hive', false),
  note('drone', 'hive', false),
  note('comb', 'hive', false),
  note('brood', 'hive', false),
  note('cleaner', 'workers', false),
  note('nurse', 'workers', false),
  note('house', 'workers', false),
  note('guard', 'workers', false),
  note('forager', 'workers', false),
  note('shift', 'workers', false),
  note('dance', 'forage'),
  note('roundDance', 'forage', false),
  note('handoff', 'forage', false),
  note('tremble', 'forage', false),
  note('ripen', 'forage', false),
  note('pollen', 'forage', false),
  note('plant', 'forage'),
  note('summer', 'year'),
  note('autumn', 'year'),
  note('winter', 'year'),
  note('spring', 'year'),
  note('queenCells', 'life'),
  note('swarm', 'life'),
  note('virgin', 'life'),
  note('mating', 'life'),
  note('emergency', 'life'),
  note('warm', 'climate'),
  note('fan', 'climate'),
  note('rain', 'climate'),
  note('hornet', 'threats'),
  note('shimmer', 'threats', false),
  note('ball', 'threats'),
  note('moth', 'threats'),
  note('sac', 'threats'),
  note('sugar', 'keeping'),
  note('harvest', 'keeping'),
  note('swap', 'keeping'),
  note('lowHoney', 'keeping'),
  note('restless', 'keeping'),
  note('abscond', 'keeping'),
  note('scouts', 'keeping'),
  note('cerana', 'real', false),
  note('inspect', 'real', false),
  note('honeyPlan', 'real', false),
  note('feeding', 'real', false),
  note('combs', 'real', false),
  note('defense', 'real', false),
  note('varroa', 'real', false),
  note('prevent', 'real', false),
  note('simplified', 'real', false),
];

/** 有蜂在做这件事就算看到了 */
const BY_ACT: Partial<Record<Act, string>> = { roundDance: 'roundDance', tremble: 'tremble', shimmer: 'shimmer' };
/** 选中一只在做这件事的蜂 */
const HANDOFF: ReadonlySet<Act> = new Set<Act>(['offer', 'giveNectar', 'receive', 'takeNectar']);
/** 选中装着这些东西的巢房 */
const BY_CELL: Partial<Record<CellContent, string>> = {
  [CELL.egg]: 'brood',
  [CELL.larva]: 'brood',
  [CELL.capped]: 'brood',
  [CELL.nectar]: 'ripen',
  [CELL.honey]: 'ripen',
  [CELL.cappedHoney]: 'ripen',
  [CELL.pollen]: 'pollen',
};

/** 事件第一次出现就算看到了 */
const BY_EVENT: Record<string, string> = {
  'ev.hornet': 'hornet',
  'ev.ball': 'ball',
  'ev.bald': 'moth',
  'ev.sac': 'sac',
  'ev.restless': 'restless',
  'ev.abscond': 'abscond',
  'ev.scouts': 'scouts',
  'ev.queenCells': 'queenCells',
  'ev.swarmIssue': 'swarm',
  'ev.virgin': 'virgin',
  'ev.virginTore': 'virgin',
  'ev.matingFlight': 'mating',
  'ev.emergencyCells': 'emergency',
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
      if (sel?.kind === 'queenCell') yield 'queenCells';
      if (sel?.kind === 'cell') {
        yield 'comb';
        const id = BY_CELL[w.comb.content[sel.id] as CellContent];
        if (id && w.comb.build[cellSite(sel.id)] >= 1) yield id;
      }
      const bee = sel?.kind === 'bee' ? w.bees.get(sel.id) : undefined;
      if (bee) {
        if (bee.caste === CASTE.queen) yield 'queen';
        else if (bee.caste === CASTE.drone) yield 'drone';
        else {
          const role = roleOf(bee)!;
          yield role;
          if (role !== ageRoleOf(bee)) yield 'shift';
          if (HANDOFF.has(bee.act)) yield 'handoff';
        }
      }
      // 跳舞、抖翅这些不用选中，有一只蜂在做就算；都看到过了就不用每次数一遍蜂
      const want = new Set(Object.entries(BY_ACT).flatMap(([act, id]) => (known.has(id!) ? [] : [act])));
      const dance = !known.has('dance');
      if (want.size || dance) {
        const seen = new Set<string>();
        for (const b of w.bees.list) {
          if (dance && b.brain.cmd?.k === 'dance') seen.add('dance');
          if (want.has(b.act)) seen.add(BY_ACT[b.act]!);
        }
        yield* seen;
      }
      // 一季的第一次到来讲那一季：开局是夏天，跟在观察箱那张后面
      if (w.clock.seasonal) yield w.clock.season;
      if (w.heat.heating >= 40) yield 'warm';
      if (w.heat.fanning >= 20) yield 'fan';
      if (w.weather.phase === 'rain') yield 'rain';
      if (w.abscond.restless) yield 'restless';
      // 现实里的养蜂（P-014）：玩家做过、见过相关的事以后才记下，讲得深一些
      if (known.size >= 6) yield 'cerana';
      if (sel?.kind === 'hive') yield 'inspect';
      if (w.keeper.harvests > 0) yield 'honeyPlan';
      if (w.keeper.swaps > 0) yield 'combs';
      if (w.hornets.swatted > 0 || w.hornets.plate) yield 'defense';
      if (known.has('sac')) yield 'varroa';
      if (known.has('restless')) yield 'prevent';
      if (w.clock.day >= 2) yield 'simplified';
      if (!known.has('feeding') && w.flowers.patches.some((p) => p.species === SUGAR)) yield 'feeding';
      if (!known.has('lowHoney') && w.abscond.present && w.comb.census().honeyCells < CONFIG.abscond.hungerAt) yield 'lowHoney';
    },
  };
}

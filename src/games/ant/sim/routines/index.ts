/**
 * 行为协程：每个函数描述一段完整的任务，通过 yield 把移动/等待指令交给运动层执行。
 * 协程结束后，蚁群会按分工重新为它选择下一项任务。按职别分文件，各职别共用的片段在 common.ts
 */
import { L } from '../../../../core/i18n';
import type { World } from '../../world/world';
import type { Ant, Routine } from '../ant';
import { ITEM_NAMES } from '../items';
import { goHome } from './common';
import { deliverBrood, nurseRoutine, queenRoutine } from './nurse';
import { deliverWasteInside, dumpSoil, maintenanceRoutine, takeOut } from './maintenance';
import { foragerRoutine, storeCarriedFood } from './forager';

export function routineFor(a: Ant, w: World): Routine {
  switch (a.role) {
    case 'queen':
      return queenRoutine(a, w);
    case 'nurse':
      return nurseRoutine(a, w);
    case 'maintenance':
      return maintenanceRoutine(a, w);
    case 'forager':
      return foragerRoutine(a, w);
  }
}

/**
 * 读档时手里还拿着东西的蚂蚁先做这件事：按物品把它送到原来要去的地方。
 * 去哪里只看物品和所在位置（协程不进存档），和原任务的目的地一致
 */
export function* finishCarry(a: Ant, w: World): Routine {
  const it = a.carrying!;
  switch (it.type) {
    case 'food':
      if (a.domain === 'surface') {
        a.activity = L('act.returnFood');
        yield { k: 'enter' };
      }
      yield* storeCarriedFood(a, w);
      return;
    case 'soil':
      return yield* dumpSoil(a, w, false);
    case 'corpse':
      return yield* takeOut(a, w, it, L('act.carryCorpseOut'));
    case 'waste':
      if (a.domain === 'nest') return yield* deliverWasteInside(a, w);
      return yield* takeOut(a, w, it, L('act.carryWasteOut'));
    default:
      yield* goHome(a);
      yield* deliverBrood(a, w, it, L('act.carryBrood', { item: ITEM_NAMES[it.type], room: w.colony.targetChamberFor(it).label }));
  }
}

export { shelter } from './common';

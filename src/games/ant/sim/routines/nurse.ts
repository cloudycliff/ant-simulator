/** 蚁后和保育蚁的任务 */
import { L, type Text } from '../../../../core/i18n';
import type { Chamber } from '../../nest/nest';
import type { World } from '../../world/world';
import type { Ant, Command, Routine } from '../ant';
import { type Item, ITEM_NAMES } from '../items';
import { broodChambers, chamber, eat, goHome, goToItem, here, rest, solicit, stillMine, wantsToEat } from './common';

// ---------------- 蚁后 ----------------

export function* queenRoutine(a: Ant, w: World): Routine {
  const qc = chamber(w, 'queen');
  a.activity = L('act.queenIdle');
  yield { k: 'room', chamber: qc.id, time: w.rng.range(4, 9) };
  while (w.colony.canLay()) {
    a.activity = L('act.lay');
    yield { k: 'wait', time: 2.5 };
    w.colony.layEgg(a);
    a.note(w, L('note.laid', { n: w.colony.stats.eggsLaid }));
  }
  if (a.hunger > 0.85) {
    a.activity = L('act.queenHungry');
    yield { k: 'wait', time: 4 };
  }
}

// ---------------- 保育蚁 ----------------

export function* nurseRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  if (wantsToEat(a, w)) return yield* eat(a, w);

  const egg = col.findItem((i) => i.type === 'egg' && col.chamberType(i.chamber) === 'queen', here(a, w));
  if (egg && w.rng.chance(0.85)) return yield* carryBrood(a, w, egg, L('act.carryEgg'));

  const ready = col.findItem((i) => i.type === 'pupa' && i.ready, here(a, w));
  if (ready && w.rng.chance(0.8)) return yield* helpEclose(a, w, ready);

  const mover = col.findItem((i) => i.isBrood && i.wantsMove, here(a, w));
  if (mover && w.rng.chance(0.75)) {
    const target = col.targetChamberFor(mover);
    return yield* carryBrood(a, w, mover, L('act.carryBrood', { item: ITEM_NAMES[mover.type], room: target.label }));
  }

  if (col.queen.hunger > 0.45 && col.queenTender < 0 && (col.foodStock > 0.5 || a.crop >= 0.3)) return yield* feedQueen(a, w);

  const larva = hungriestLarva(w);
  if (larva && (col.reserve > 0.5 || a.crop >= 0.3) && w.rng.chance(0.8)) return yield* feedLarva(a, w, larva);

  return yield* tendBrood(a, w);
}

function hungriestLarva(w: World): Item | null {
  let best: Item | null = null;
  let bh = 0.45;
  for (const c of w.nest.chamberOfType('larva'))
    for (const it of w.colony.byChamber[c.id])
      if (it.type === 'larva' && it.free && it.hunger > bh) {
        bh = it.hunger + w.rng.range(0, 0.3);
        best = it;
      }
  return best;
}

function* carryBrood(a: Ant, w: World, it: Item, label: Text): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = L('act.fetchBrood', { room: w.nest.chambers[it.chamber].label, item: ITEM_NAMES[it.type] });
  yield* goToItem(a, it);
  if (!stillMine(a, it) || it.place !== 'chamber') {
    if (it.claimedBy === a.id) it.claimedBy = -1;
    return;
  }
  col.pickUp(a, it);
  const target = yield* deliverBrood(a, w, it, label);
  a.activity = L('act.tidyBrood');
  yield { k: 'room', chamber: target.id, time: w.rng.range(1.5, 4) };
}

/** 把手里的幼体放进它该去的房间 */
export function* deliverBrood(a: Ant, w: World, it: Item, label: Text): Generator<Command, Chamber, unknown> {
  const col = w.colony;
  const target = col.targetChamberFor(it);
  const spot = col.pileSpot(target, it.type);
  a.activity = label;
  yield { k: 'room', chamber: target.id, time: 0.3, point: spot };
  const dropped = col.release(a);
  if (dropped) col.addToChamber(dropped, target, spot);
  a.note(w, label);
  return target;
}

function* helpEclose(a: Ant, w: World, pupa: Item): Routine {
  pupa.claimedBy = a.id;
  a.activity = L('act.goEclose', { room: w.nest.chambers[pupa.chamber].label });
  yield* goToItem(a, pupa);
  if (!stillMine(a, pupa)) return;
  a.activity = L('act.eclose');
  yield { k: 'wait', time: 3.5 };
  const born = w.colony.eclose(pupa, a);
  if (born) a.note(w, L('note.helpedEclose', { id: born.id }));
  else if (pupa.claimedBy === a.id) pupa.claimedBy = -1;
}

/** 准备喂食：嗉囊里有甜液就直接反哺；否则去储食室取固体食物，储食室空了就向同伴乞食 */
function* fetchFood(a: Ant, w: World): Generator<Command, 'crop' | 'solid' | null, unknown> {
  const col = w.colony;
  if (a.crop >= 0.3) return 'crop';
  const store = col.foodChamber();
  yield* goHome(a);
  yield { k: 'room', chamber: store.id, time: w.rng.range(0.8, 1.6), point: col.pileSpot(store, 'food') };
  const kind = col.takeFood(0.45);
  if (kind) {
    const piece = w.colony.newItem('food');
    piece.foodKind = kind;
    col.pickUp(a, piece);
    return 'solid';
  }
  if ((yield* solicit(a, w, L('reason.storeEmpty'))) && a.crop >= 0.2) return 'crop';
  return null;
}

/** 反哺：喂出嗉囊里的液体或丢掉携带的固体食物块 */
function consumeFeed(a: Ant, w: World, how: 'crop' | 'solid'): void {
  if (how === 'crop') a.crop = Math.max(0, a.crop - 0.3);
  else {
    const p = w.colony.release(a);
    if (p) w.colony.destroy(p);
  }
}

function* feedLarva(a: Ant, w: World, larva: Item): Routine {
  const col = w.colony;
  larva.claimedBy = a.id;
  a.activity = L(a.crop >= 0.3 ? 'act.feedLarvaCrop' : 'act.feedLarvaFetch');
  const how = yield* fetchFood(a, w);
  if (!how || !stillMine(a, larva) || larva.place !== 'chamber') {
    if (larva.claimedBy === a.id) larva.claimedBy = -1;
    if (how === 'solid') consumeFeed(a, w, how);
    a.activity = L('act.noFood');
    return;
  }
  a.activity = L(how === 'crop' ? 'act.regurgitate' : 'act.feedSolid');
  yield { k: 'room', chamber: larva.chamber, time: 0.3, point: larva.pos.clone() };
  yield { k: 'wait', time: 2.2 };
  consumeFeed(a, w, how);
  if (larva.type === 'larva') {
    larva.hunger = 0;
    larva.feeds++;
    if (w.rng.chance(0.15)) col.addToChamber(w.colony.newItem('waste'), w.nest.chambers[larva.chamber]);
    a.note(w, L(how === 'crop' ? 'note.fedLarvaCrop' : 'note.fedLarvaSolid', { n: larva.feeds }));
  }
  if (larva.claimedBy === a.id) larva.claimedBy = -1;
  a.activity = L('act.tendLarvae');
  yield { k: 'room', chamber: larva.chamber, time: w.rng.range(2, 5) };
}

function* feedQueen(a: Ant, w: World): Routine {
  const col = w.colony;
  col.queenTender = a.id;
  a.activity = L('act.fetchQueen');
  const how = yield* fetchFood(a, w);
  if (!how) {
    col.queenTender = -1;
    return;
  }
  a.activity = L('act.feedQueen');
  const qc = chamber(w, 'queen');
  yield { k: 'room', chamber: qc.id, time: 0.3, point: col.queen.pos.clone() };
  yield { k: 'wait', time: 3 };
  consumeFeed(a, w, how);
  col.queen.hunger = 0;
  col.queenTender = -1;
  col.queen.note(w, L('note.fedBy', { id: a.id }));
  a.note(w, L('note.fedQueen'));
  a.activity = L('act.groomQueen');
  yield { k: 'room', chamber: qc.id, time: w.rng.range(3, 8) };
}

function* tendBrood(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = broodChambers(w).filter((c) => col.byChamber[c.id].some((i) => i.isBrood));
  yield* goHome(a);
  // 嗉囊空了的保育蚁会向路过的同伴讨要甜液，用来反哺幼虫
  if (a.crop < 0.2 && a.room >= 0 && w.rng.chance(0.3) && (yield* solicit(a, w, L('reason.stockUp')))) return;
  // 蚁后身边总围着一圈侍从工蚁，为它梳理、舔舐并传递蚁后信息素
  if (w.rng.chance(0.18)) {
    const qc = chamber(w, 'queen');
    a.activity = L('act.goQueen');
    yield { k: 'room', chamber: qc.id, time: 0.1 };
    a.activity = L('act.attendQueen');
    const near = col.queen.pos.clone();
    near.x += w.rng.range(-1.6, 1.6);
    near.z += w.rng.range(-1.6, 1.6);
    yield { k: 'room', chamber: qc.id, time: w.rng.range(10, 25), point: near };
    return;
  }
  if (options.length === 0) return yield* rest(a, w);
  const c = w.rng.pick(options);
  const clean = c.type === 'egg' ? 'act.cleanEggs' : c.type === 'larva' ? 'act.cleanLarvae' : 'act.cleanPupae';
  a.activity = L('act.goTo', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = L(clean);
  yield { k: 'room', chamber: c.id, time: w.rng.range(8, 18) };
}

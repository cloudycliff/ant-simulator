import * as THREE from 'three';
import { CONFIG } from '../config';
import { L, type Text } from '../../../core/i18n';
import { TAU } from '../../../core/util/math';
import { rng } from '../../../core/util/random';
import type { Chamber } from '../nest/nest';
import { AphidColony } from '../world/aphids';
import type { FoodSource } from '../world/food';
import type { PlugJob } from '../world/weather';
import type { World } from '../world/world';
import type { Ant, Command, Routine } from './ant';
import { Item, ITEM_NAMES } from './items';

/**
 * 行为协程：每个函数描述一段完整的任务，通过 yield 把移动/等待指令交给运动层执行。
 * 协程结束后，蚁群会按分工重新为它选择下一项任务。
 */
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

function chamber(w: World, t: Chamber['type']): Chamber {
  return w.nest.chamberOfType(t)[0];
}

function* goHome(a: Ant): Routine {
  if (a.domain === 'surface') yield { k: 'enter' };
}

/** 走到物品所在处（房间、隧道节点或地表） */
function* goToItem(a: Ant, it: Item): Routine {
  if (it.place === 'chamber') {
    yield* goHome(a);
    yield { k: 'room', chamber: it.chamber, time: 0.5, point: it.pos.clone() };
  } else if (it.place === 'node') {
    yield* goHome(a);
    yield { k: 'goto', node: it.node };
  } else if (it.place === 'surface' || it.place === 'midden') {
    if (a.domain === 'nest') yield { k: 'exit' };
    yield { k: 'walk', x: it.pos.x, z: it.pos.z, r: 0.6 };
  }
}

function stillMine(a: Ant, it: Item): boolean {
  return it.place !== 'gone' && it.carriedBy < 0 && (it.claimedBy === a.id || it.claimedBy < 0);
}

function wantsToEat(a: Ant, w: World): boolean {
  return a.hunger > 0.6 && w.clock.seconds >= a.eatRetryAt;
}

/** 交哺时站到对方面前约 0.75 单位处 */
function approachPoint(target: Ant, from: Ant): THREE.Vector3 {
  const p = from.pos.clone().sub(target.pos).setY(0);
  if (p.lengthSq() < 1e-4) p.set(1, 0, 0);
  return p.normalize().multiplyScalar(0.75).add(target.pos);
}

// ---------------- 交哺 ----------------

/** 向同一房间里嗉囊饱满的同伴乞食：用触角轻拍对方头部，对方反刍出一滴液体 */
function* solicit(a: Ant, w: World, reason: Text): Generator<Command, boolean, unknown> {
  const col = w.colony;
  const donor = col.findRoommate(a, (b) => b.crop > 0.45);
  if (!donor) return false;
  donor.hold(donor.pos.distanceTo(a.pos) / 1.4 + 2, a.pos);
  a.activity = L('act.solicit', { reason, id: donor.id });
  yield { k: 'room', chamber: a.room, time: 0.2, point: approachPoint(donor, a) };
  if (!donor.alive || donor.room !== a.room) return false;
  a.faceTo(donor.pos);
  donor.faceTo(a.pos);
  donor.holdT = Math.max(donor.holdT, 2.6);
  a.activity = L('act.receiveShare', { id: donor.id });
  yield { k: 'wait', time: 2.4 };
  const got = col.share(donor, a);
  donor.holdT = Math.min(donor.holdT, 0.3);
  return got > 0;
}

/** 把嗉囊中的甜液分给同一房间的同伴 */
function* offerCrop(a: Ant, w: World, maxPartners: number, pred: (b: Ant) => boolean = (b) => b.crop < 0.5): Routine {
  const col = w.colony;
  let given = 0;
  let tries = 0;
  while (a.room >= 0 && a.crop > 0.15 && given < maxPartners && tries < maxPartners + 3) {
    tries++;
    const b = col.findRoommate(a, pred);
    if (!b) {
      a.activity = L('act.seekPartner');
      yield { k: 'room', chamber: a.room, time: rng.range(1.5, 3) };
      continue;
    }
    b.hold(b.pos.distanceTo(a.pos) / 1.4 + 2, a.pos);
    a.activity = L('act.approachShare', { id: b.id });
    yield { k: 'room', chamber: a.room, time: 0.2, point: approachPoint(b, a) };
    if (!b.alive || b.room !== a.room) continue;
    a.faceTo(b.pos);
    b.faceTo(a.pos);
    b.holdT = Math.max(b.holdT, 2.6);
    a.activity = L('act.giveShare', { id: b.id });
    yield { k: 'wait', time: 2.4 };
    if (col.share(a, b) > 0) given++;
    b.holdT = Math.min(b.holdT, 0.3);
  }
  if (given) a.note(w, L('note.shared', { n: given }));
}

/** 走到房间里的随机位置再交哺：offerCrop 找最近的同伴，停在门口就会和刚进门的同伴挤成一团 */
function* walkIntoRoom(w: World, c: Chamber): Routine {
  yield { k: 'room', chamber: c.id, time: 0, point: w.nest.randomFloorPoint(c, rng.next.bind(rng), new THREE.Vector3()) };
}

/** 返巢后在储食室（不够再去休息室）把嗉囊里的甜液分出去 */
function* unloadCrop(a: Ant, w: World): Routine {
  const col = w.colony;
  const store = col.foodChamber();
  a.activity = L('act.unloadStore');
  yield* walkIntoRoom(w, store);
  yield* offerCrop(a, w, 4);
  if (a.crop > 0.3) {
    const c = rng.pick(w.nest.chamberOfType('rest'));
    a.activity = L('act.shareIn', { room: c.label });
    yield* walkIntoRoom(w, c);
    yield* offerCrop(a, w, 3);
  }
}

/** 嗉囊饱满的巢内工蚁把甜液带到育幼区，分给保育蚁 */
function* distributeCrop(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = broodChambers(w).filter((c) => col.ants.some((b) => b.room === c.id && b.role === 'nurse'));
  if (!options.length) return;
  const c = rng.pick(options);
  yield* goHome(a);
  a.activity = L('act.bringCrop', { room: c.label });
  yield* walkIntoRoom(w, c);
  yield* offerCrop(a, w, 3, (b) => b.role === 'nurse' && b.crop < 0.4);
}

function broodChambers(w: World): Chamber[] {
  const n = w.nest;
  return [...n.chamberOfType('egg'), ...n.chamberOfType('larva'), ...n.chamberOfType('pupa'), ...n.chamberOfType('solar')];
}

// ---------------- 进食与休息 ----------------

function* eat(a: Ant, w: World): Routine {
  if (a.crop >= 0.1) {
    a.activity = L('act.eatCrop');
    yield { k: 'wait', time: 1.5 };
    a.eatFromCrop();
    return;
  }
  yield* goHome(a);
  if (a.room >= 0 && rng.chance(0.6) && (yield* solicit(a, w, L('reason.hungry')))) {
    a.eatFromCrop();
    a.note(w, L('note.gotShare'));
    return;
  }
  const store = w.colony.foodChamber();
  a.activity = L('act.goEat');
  yield { k: 'room', chamber: store.id, time: 1, point: w.colony.pileCenter(store, 'food') };
  yield { k: 'wait', time: 2 };
  if (w.colony.takeFood(CONFIG.ant.eatAmount)) {
    a.hunger = Math.max(0, a.hunger - 0.85);
    a.note(w, L('note.ateStore'));
  } else if (yield* solicit(a, w, L('reason.noSolid'))) {
    a.eatFromCrop();
    a.note(w, L('note.begged'));
  } else {
    a.note(w, L('note.noFood'));
    a.eatRetryAt = w.clock.seconds + rng.range(30, 60);
  }
}

function* rest(a: Ant, w: World, label: Text = L('act.rest')): Routine {
  yield* goHome(a);
  // 随机挑两间休息室，去路程较近的一间
  const rooms = w.nest.chamberOfType('rest');
  const from = a.currentNode(w);
  const c1 = rng.pick(rooms);
  const c2 = rng.pick(rooms);
  const c = w.nest.routeLength(from, c1.door) <= w.nest.routeLength(from, c2.door) ? c1 : c2;
  a.activity = L('act.goTo', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = label;
  yield { k: 'room', chamber: c.id, time: rng.range(12, 30) };
}

/** 天气转坏时返巢躲雨 */
export function* shelter(a: Ant, w: World): Routine {
  a.layTrail = 0;
  a.activity = L(w.weather.phase === 'rain' ? 'act.shelterRain' : w.weather.phase === 'overcast' ? 'act.shelterCloud' : 'act.shelterWet');
  yield { k: 'enter' };
  yield* rest(a, w, L(w.weather.phase === 'rain' ? 'act.restRain' : 'act.restWet'));
}

// ---------------- 蚁后 ----------------

function* queenRoutine(a: Ant, w: World): Routine {
  const qc = chamber(w, 'queen');
  a.activity = L('act.queenIdle');
  yield { k: 'room', chamber: qc.id, time: rng.range(4, 9) };
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

function* nurseRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  if (wantsToEat(a, w)) return yield* eat(a, w);

  const egg = col.findItem((i) => i.type === 'egg' && col.chamberType(i.chamber) === 'queen', here(a, w));
  if (egg && rng.chance(0.85)) return yield* carryBrood(a, w, egg, L('act.carryEgg'));

  const ready = col.findItem((i) => i.type === 'pupa' && i.ready, here(a, w));
  if (ready && rng.chance(0.8)) return yield* helpEclose(a, w, ready);

  const mover = col.findItem((i) => i.isBrood && i.wantsMove, here(a, w));
  if (mover && rng.chance(0.75)) {
    const target = col.targetChamberFor(mover);
    return yield* carryBrood(a, w, mover, L('act.carryBrood', { item: ITEM_NAMES[mover.type], room: target.label }));
  }

  if (col.queen.hunger > 0.45 && col.queenTender < 0 && (col.foodStock > 0.5 || a.crop >= 0.3)) return yield* feedQueen(a, w);

  const larva = hungriestLarva(w);
  if (larva && (col.reserve > 0.5 || a.crop >= 0.3) && rng.chance(0.8)) return yield* feedLarva(a, w, larva);

  return yield* tendBrood(a, w);
}

function hungriestLarva(w: World): Item | null {
  let best: Item | null = null;
  let bh = 0.45;
  for (const c of w.nest.chamberOfType('larva'))
    for (const it of w.colony.byChamber[c.id])
      if (it.type === 'larva' && it.free && it.hunger > bh) {
        bh = it.hunger + rng.range(0, 0.3);
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
  const target = col.targetChamberFor(it);
  const spot = col.pileSpot(target, it.type);
  a.activity = label;
  yield { k: 'room', chamber: target.id, time: 0.3, point: spot };
  const dropped = col.release(a);
  if (dropped) col.addToChamber(dropped, target, spot);
  a.note(w, label);
  a.activity = L('act.tidyBrood');
  yield { k: 'room', chamber: target.id, time: rng.range(1.5, 4) };
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
  yield { k: 'room', chamber: store.id, time: rng.range(0.8, 1.6), point: col.pileSpot(store, 'food') };
  const kind = col.takeFood(0.45);
  if (kind) {
    const piece = new Item('food');
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
    if (rng.chance(0.15)) col.addToChamber(new Item('waste'), w.nest.chambers[larva.chamber]);
    a.note(w, L(how === 'crop' ? 'note.fedLarvaCrop' : 'note.fedLarvaSolid', { n: larva.feeds }));
  }
  if (larva.claimedBy === a.id) larva.claimedBy = -1;
  a.activity = L('act.tendLarvae');
  yield { k: 'room', chamber: larva.chamber, time: rng.range(2, 5) };
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
  yield { k: 'room', chamber: qc.id, time: rng.range(3, 8) };
}

function* tendBrood(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = broodChambers(w).filter((c) => col.byChamber[c.id].some((i) => i.isBrood));
  yield* goHome(a);
  // 嗉囊空了的保育蚁会向路过的同伴讨要甜液，用来反哺幼虫
  if (a.crop < 0.2 && a.room >= 0 && rng.chance(0.3) && (yield* solicit(a, w, L('reason.stockUp')))) return;
  // 蚁后身边总围着一圈侍从工蚁，为它梳理、舔舐并传递蚁后信息素
  if (rng.chance(0.18)) {
    const qc = chamber(w, 'queen');
    a.activity = L('act.goQueen');
    yield { k: 'room', chamber: qc.id, time: 0.1 };
    a.activity = L('act.attendQueen');
    const near = col.queen.pos.clone();
    near.x += rng.range(-1.6, 1.6);
    near.z += rng.range(-1.6, 1.6);
    yield { k: 'room', chamber: qc.id, time: rng.range(10, 25), point: near };
    return;
  }
  if (options.length === 0) return yield* rest(a, w);
  const c = rng.pick(options);
  const clean = c.type === 'egg' ? 'act.cleanEggs' : c.type === 'larva' ? 'act.cleanLarvae' : 'act.cleanPupae';
  a.activity = L('act.goTo', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = L(clean);
  yield { k: 'room', chamber: c.id, time: rng.range(8, 18) };
}

// ---------------- 内务蚁 ----------------

function* maintenanceRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  if (wantsToEat(a, w)) return yield* eat(a, w);

  const job = w.weather.plugJob(w);
  if (job && rng.chance(0.8)) return yield* plugEntrance(a, w, job);
  // 入口封着或地面还湿时，只做巢内的工作
  if (w.weather.keepIn) {
    const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste', here(a, w));
    if (waste && rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);
    if (a.crop > 0.6 && rng.chance(0.5)) return yield* distributeCrop(a, w);
    return yield* patrolNest(a, w);
  }

  const corpse = findCorpse(a, w);
  if (corpse && rng.chance(0.85)) return yield* carryOut(a, w, corpse, L('act.carryCorpseOut'));

  const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste', here(a, w));
  if (waste && rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);

  const wc = chamber(w, 'waste');
  if (col.countIn(wc.id, 'waste') >= 4 && rng.chance(0.6)) {
    const it = col.byChamber[wc.id].find((i) => i.type === 'waste' && i.free);
    if (it) return yield* carryOut(a, w, it, L('act.carryWasteOut'));
  }

  // 有扩建工程时大量投入挖掘，否则只缓慢延长现有隧道
  const D = CONFIG.defense;
  if (w.predators.threatEntrance >= 0 && w.predators.guardsOut < D.maxGuards && rng.chance(D.guardProb)) return yield* guard(a, w, true);

  const digP = col.expansion.project ? 0.45 : 0.15;
  const r = rng.next();
  if (r < digP) return yield* dig(a, w);
  if (r < digP + 0.25 && !w.clock.isNight) return yield* guard(a, w);
  if (a.crop > 0.6 && rng.chance(0.5)) return yield* distributeCrop(a, w);
  return yield* patrolNest(a, w);
}

/** 下雨前从里面用土粒把入口堵上，雨后地面晾干再清开 */
function* plugEntrance(a: Ant, w: World, job: PlugJob): Routine {
  const e = w.nest.entrances[job.entrance];
  a.plugging = job.entrance;
  yield* goHome(a);
  a.activity = L(job.open ? 'act.goUnplug' : 'act.goPlug', { ent: e.label });
  yield { k: 'goto', node: e.node };
  a.activity = L(job.open ? 'act.unplug' : 'act.plug', { ent: e.label });
  do {
    yield { k: 'wait', time: rng.range(3, 5) };
    w.weather.workPlug(job, w);
    a.note(w, L(job.open ? 'note.unplugged' : 'note.plugged', { ent: e.label }));
  } while (job.open === (w.weather.phase === 'clear') && (job.open ? e.plug > 0 : e.plug < 1));
  a.plugging = -1;
}

/** 蚂蚁所在的巢内节点；在地表时取最近的入口 */
function here(a: Ant, w: World): number {
  return a.domain === 'nest' ? a.currentNode(w) : w.nest.nearestEntrance(a.pos.x, a.pos.z).node;
}

function findCorpse(a: Ant, w: World): Item | null {
  for (const it of w.colony.nodeItems) if (it.type === 'corpse' && it.free) return it;
  const c = w.colony.findItem((i) => i.type === 'corpse', here(a, w));
  if (c) return c;
  for (const it of w.colony.surfaceItems)
    if (it.type === 'corpse' && it.place === 'surface' && it.free && Math.hypot(it.pos.x, it.pos.z) < 30) return it;
  return null;
}

function* carryWasteInside(a: Ant, w: World, it: Item): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = L('act.goCleanWaste', { room: w.nest.chambers[it.chamber].label });
  yield* goToItem(a, it);
  if (!stillMine(a, it) || it.place !== 'chamber') {
    if (it.claimedBy === a.id) it.claimedBy = -1;
    return;
  }
  col.pickUp(a, it);
  const wc = chamber(w, 'waste');
  const spot = col.pileSpot(wc, 'waste');
  a.activity = L('act.carryWasteIn');
  yield { k: 'room', chamber: wc.id, time: 0.3, point: spot };
  const d = col.release(a);
  if (d) col.addToChamber(d, wc, spot);
  a.note(w, L('note.cleanedWaste'));
}

/** 搬到巢外垃圾堆（尸体搬运是蚂蚁的“葬尸行为”，由尸体释放的油酸触发） */
function* carryOut(a: Ant, w: World, it: Item, label: Text): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = L(it.type === 'corpse' ? 'act.smellCorpse' : 'act.goWasteRoom');
  yield* goToItem(a, it);
  if (!stillMine(a, it)) {
    if (it.claimedBy === a.id) it.claimedBy = -1;
    return;
  }
  col.pickUp(a, it);
  a.activity = label;
  if (a.domain === 'nest' && (yield { k: 'exit', giveUp: true }) === 'blocked') {
    const wc = chamber(w, 'waste');
    a.activity = L('act.blockedReturn', { item: ITEM_NAMES[it.type], room: wc.label });
    yield { k: 'room', chamber: wc.id, time: 1 };
    const d = col.release(a);
    if (d) col.addToChamber(d, wc);
    a.note(w, L('note.blockedStored', { item: ITEM_NAMES[it.type], room: wc.label }));
    return;
  }
  const m = col.midden;
  yield { k: 'walk', x: m.x + rng.range(-1.5, 1.5), z: m.z + rng.range(-1.5, 1.5), r: 1.2 };
  const d = col.release(a);
  if (d) col.dropAtMidden(d);
  col.stats.wasteRemoved++;
  a.note(w, L(it.type === 'corpse' ? 'note.droppedCorpse' : 'note.droppedWaste'));
  a.activity = L('act.goHome');
  yield { k: 'enter' };
}

function* dig(a: Ant, w: World): Routine {
  const col = w.colony;
  const ex = col.expansion;
  const face = ex.pickFace();
  if (!face) return yield* patrolNest(a, w);
  const node = face.node;
  const project = ex.isProjectFace(node);
  a.digNode = node;
  yield* goHome(a);
  const enlarge = project && ex.enlarging() !== null;
  a.activity = L(enlarge ? 'act.goEnlarge' : project ? 'act.goSite' : 'act.goFace');
  yield { k: 'goto', node };
  // 房间阶段：走进已挖出的部分，在远端继续挖
  const spot = ex.isProjectFace(node) ? ex.digPoint(new THREE.Vector3()) : null;
  const room = w.nest.nodes[node].chamber;
  if (spot && room !== undefined) yield { k: 'room', chamber: room, time: 0.3, point: spot };
  a.activity = L(!spot ? (project ? 'act.digTunnelNew' : 'act.digTunnel') : ex.enlarging() ? 'act.digEdge' : 'act.digRoom');
  yield { k: 'wait', time: rng.range(3, 6) };
  a.digNode = -1;
  ex.excavate(node);
  if (w.weather.keepIn) {
    a.activity = L('act.packSoilSealed');
    yield { k: 'wait', time: rng.range(2, 3) };
    col.stats.soilExcavated++;
    a.note(w, L(project ? 'note.soilWallProject' : 'note.soilWall'));
    return;
  }
  const soil = new Item('soil');
  col.pickUp(a, soil);
  col.stats.soilExcavated++;
  a.activity = L('act.carrySoil');
  if ((yield { k: 'exit', giveUp: true }) === 'blocked') {
    a.activity = L('act.packSoilBlocked');
    yield { k: 'wait', time: rng.range(2, 3) };
    const d = col.release(a);
    if (d) col.destroy(d);
    a.note(w, L('note.soilBlocked'));
    return;
  }
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = rng.range(0, TAU);
  yield { k: 'walk', x: ent.x + Math.cos(ang) * 3, z: ent.z + Math.sin(ang) * 3, r: 0.8 };
  const d = col.release(a);
  if (d) col.dropOnMound(d, ent);
  a.note(w, L(project ? 'note.soilProject' : 'note.soilMound'));
  a.activity = L('act.goHome');
  yield { k: 'enter' };
}

/** 入口警戒；threat 为 true 时是因为有狼蛛逼近，去受威胁的那个入口，巡逻范围更大 */
function* guard(a: Ant, w: World, threat = false): Routine {
  yield* goHome(a);
  a.guarding = threat;
  a.activity = L(threat ? 'act.guardThreat' : 'act.goGuard');
  yield { k: 'exit' };
  const ti = w.predators.threatEntrance;
  const ent = threat && ti >= 0 ? w.nest.entrances[ti] : w.nest.nearestEntrance(a.pos.x, a.pos.z);
  a.activity = L(threat ? 'act.guardingThreat' : 'act.guarding');
  a.note(w, L(threat ? 'note.guardThreat' : 'note.guard', { ent: ent.label }));
  yield { k: 'patrol', x: ent.x, z: ent.z, radius: threat ? 7 : 4.5, time: rng.range(25, 60) };
  a.guarding = false;
  a.activity = L('act.guardEnd');
  yield { k: 'enter' };
}

/** 待命的觅食蚁在巢口附近闲逛 */
function* loiter(a: Ant, w: World): Routine {
  const LO = CONFIG.loiter;
  a.activity = L('act.loiterOut');
  yield { k: 'exit' };
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = rng.range(0, TAU);
  const d = rng.range(LO.offset[0], LO.offset[1]);
  a.activity = L(rng.chance(0.5) ? 'act.patrolTerritory' : 'act.bask');
  yield { k: 'patrol', x: ent.x + Math.cos(ang) * d, z: ent.z + Math.sin(ang) * d, radius: rng.range(LO.radius[0], LO.radius[1]), time: rng.range(LO.time[0], LO.time[1]) };
  a.activity = L('act.loiterEnd');
  yield { k: 'enter' };
}

function* patrolNest(a: Ant, w: World): Routine {
  yield* goHome(a);
  const c = rng.pick(w.nest.chambers.filter((x) => x.ready && x.type !== 'queen'));
  a.activity = L('act.inspect', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = L('act.cleanRoom', { room: c.label });
  yield { k: 'room', chamber: c.id, time: rng.range(8, 20) };
}

// ---------------- 觅食蚁 ----------------

function tenders(w: World, c: AphidColony): number {
  let n = 0;
  for (const a of w.colony.ants) if (a.herd === c.id) n++;
  return n;
}

/** 选择要去照料的蚜虫群：已有照料对象的大多回到原处，其余按蜜露多少被吸引 */
function pickHerd(a: Ant, w: World): AphidColony | null {
  const aph = w.aphids;
  if (a.herd >= 0) {
    const c = aph.byId(a.herd);
    if (c && rng.chance(0.8)) return c;
    if (!c) a.herd = -1;
  }
  if (a.scout || !rng.chance(0.3)) return null;
  const known = aph.colonies.filter((c) => c.discovered && tenders(w, c) < 4 + c.count / 8);
  if (!known.length) return null;
  let total = 0;
  for (const c of known) total += c.honeydew + 0.5;
  let r = rng.next() * total;
  for (const c of known) {
    r -= c.honeydew + 0.5;
    if (r <= 0) return c;
  }
  return known[known.length - 1];
}

function* foragerRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  const now = w.clock.seconds;
  // 储备耗尽时，觅食蚁不会留在巢里挨饿，而是出去在食物源处进食
  if (wantsToEat(a, w) && (col.reserve > 3 || a.crop >= 0.1)) return yield* eat(a, w);
  if (a.domain === 'nest' && a.crop > 0.3 && a.room >= 0 && rng.chance(0.5)) return yield* offerCrop(a, w, 3);
  const surfaceT = w.clock.temperatureAt(0);
  const excited = a.excitedUntil > now;
  if (a.domain === 'nest' && ((w.clock.isNight && rng.chance(excited ? 0.3 : 0.6)) || surfaceT < 8)) {
    return yield* rest(a, w, L(surfaceT < 8 ? 'act.restCold' : 'act.restNight'));
  }
  // 储备越充足，返巢蚁越难把食物交出去，出巢觅食的积极性随之下降；被同伴激发时则更容易出巢
  const satiation = Math.min(0.9, Math.max(0, (col.reserve - 150) / 200)) * (a.scout ? 0.5 : 1) * (excited ? 0.3 : 1);
  if (a.domain === 'nest' && rng.chance(satiation)) {
    if (a.crop > 0.6 && rng.chance(0.4)) return yield* distributeCrop(a, w);
    const LO = CONFIG.loiter;
    const calm = !w.clock.isNight && w.weather.damp === 0 && w.predators.threatEntrance < 0 && surfaceT >= LO.minTemp;
    if (calm && rng.chance(LO.chance)) return yield* loiter(a, w);
    return yield* rest(a, w, L('act.restFull'));
  }

  if (a.domain === 'nest' && w.weather.keepIn) {
    const P = w.weather.phase;
    return yield* rest(a, w, L(P === 'rain' ? 'act.restRaining' : P === 'overcast' ? 'act.restOvercast' : 'act.restDrying'));
  }
  // 雨后入口刚清开：侦察蚁先出去，其余觅食蚁随地面变干陆续出巢
  if (a.domain === 'nest' && !a.scout && rng.chance(w.weather.damp)) return yield* rest(a, w, L('act.restDamp'));

  if (a.domain === 'nest' && w.predators.threatEntrance >= 0 && rng.chance(CONFIG.defense.holdBackProb)) {
    return yield* rest(a, w, L('act.restSpider'));
  }

  const herd = pickHerd(a, w);
  if (herd) return yield* tendAphids(a, w, herd, false);

  if (a.domain === 'nest') {
    a.activity = L(a.scout ? 'act.scoutOut' : excited ? 'act.excitedOut' : 'act.forageOut');
    yield { k: 'exit' };
  }
  a.activity = L(a.memory ? 'act.goMemory' : a.scout ? 'act.scoutSearch' : 'act.search');
  const found = (yield { k: 'search', time: a.scout ? 220 : 140 }) as FoodSource | AphidColony | null;

  if (found instanceof AphidColony) {
    if (!found.discovered) {
      found.discovered = true;
      a.note(w, L('note.foundAphids'));
      col.pushEvent(L('ev.foundAphids', { who: L(a.scout ? 'role.scout' : 'role.forager'), id: a.id }), { kind: 'plant', id: found.plant.index });
    }
    return yield* tendAphids(a, w, found, true);
  }

  if (!found || found.amount < 1) {
    a.activity = L('act.noFoodHome');
    a.layTrail = 0;
    yield { k: 'enter' };
    return yield* rest(a, w);
  }

  const isNew = !found.discovered;
  found.discovered = true;
  a.activity = L(found.kind === 'sugar' ? 'act.sipAt' : 'act.cutAt', { food: found.info.name });
  yield { k: 'wait', time: found.kind === 'sugar' ? 4 : 3 };
  if (!found.take()) {
    a.activity = L('act.foodGone');
    a.memory = null;
    yield { k: 'enter' };
    return;
  }
  if (a.hunger > 0.3) {
    a.hunger = 0;
    a.note(w, L('note.ateAt', { food: found.info.name }));
  }
  if (found.kind === 'sugar') a.crop = 1;
  else {
    const piece = new Item('food');
    piece.foodKind = found.kind;
    col.pickUp(a, piece);
  }
  a.memory = { x: found.x, z: found.z };
  a.layTrail = CONFIG.pheromone.depositFood * (0.5 + found.fraction) * (a.scout ? 1.3 : 1);
  if (isNew) {
    a.note(w, L('note.foundFood', { food: found.info.name }));
    col.pushEvent(L('ev.foundFood', { who: L(a.scout ? 'role.scout' : 'role.forager'), id: a.id, food: found.info.name }), { kind: 'food', id: found.id });
  } else a.note(w, L('note.tookFood', { food: found.info.name }));

  a.activity = L(found.kind === 'sugar' ? 'act.returnSugar' : 'act.returnFood');
  yield { k: 'enter' };
  a.layTrail = 0;
  a.trips++;
  a.delivered++;
  col.stats.foodCollected++;
  if (found.kind === 'sugar') return yield* unloadCrop(a, w);
  const store = col.foodChamber();
  a.activity = L('act.storeFood');
  yield { k: 'room', chamber: store.id, time: 0.3, point: col.pileSpot(store, 'food') };
  col.storeFood(a);
  a.note(w, L('note.storedFood'));
  a.activity = L('act.linger');
  yield { k: 'room', chamber: store.id, time: rng.range(2, 6) };
}

/** 蚜虫放牧：爬上寄主植物，拍打蚜虫收集蜜露；蜜露不多时留下守护蚜虫 */
function* tendAphids(a: Ant, w: World, c: AphidColony, arrived: boolean): Routine {
  const col = w.colony;
  if (a.domain === 'nest') {
    a.activity = L('act.goHerd');
    yield { k: 'exit' };
  }
  if (!arrived) {
    const ang = rng.range(0, TAU);
    a.activity = L('act.goPlant');
    yield { k: 'walk', x: c.x + Math.cos(ang) * 1.6, z: c.z + Math.sin(ang) * 1.6, r: 0.6 };
  }
  const guard = c.honeydew < 0.6;
  const ang = Math.atan2(a.pos.z - c.z, a.pos.x - c.x);
  a.activity = L(guard ? 'act.guardAphids' : 'act.milkAphids');
  c.lastTended = w.clock.seconds;
  yield { k: 'climb', x: c.x, z: c.z, angle: ang, r: c.stemRadius, top: rng.range(c.bandLo, c.bandHi) - 0.3, stay: guard ? rng.range(25, 45) : rng.range(6, 10) };
  c.lastTended = w.clock.seconds;
  a.herd = c.id;
  const amt = Math.min(1 - a.crop, c.honeydew);
  c.honeydew -= amt;
  c.collected += amt;
  a.crop += amt;
  col.stats.honeydew += amt;
  if (amt < 0.2) {
    a.note(w, L('note.guardedAphids'));
    a.activity = L('act.returnHome');
    yield { k: 'enter' };
    if (a.crop > 0.3) yield* unloadCrop(a, w);
    return;
  }
  a.note(w, L('note.milked', { pct: Math.round(a.crop * 100) }));
  a.layTrail = CONFIG.pheromone.depositFood * 0.8;
  a.activity = L('act.returnHoneydew');
  yield { k: 'enter' };
  a.layTrail = 0;
  a.trips++;
  a.delivered++;
  col.stats.foodCollected++;
  yield* unloadCrop(a, w);
}

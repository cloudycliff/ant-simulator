/** 各职别共用的任务片段：取物、交哺、进食、休息、躲雨 */
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { L, type Text } from '../../../../core/i18n';
import type { Chamber } from '../../nest/nest';
import type { World } from '../../world/world';
import type { Ant, Command, Routine } from '../ant';
import type { Item } from '../items';

/** 休息室挤满时可以去歇着的房间（育幼室、蚁后室、垃圾室不去） */
const REST_SPILL: Chamber['type'][] = ['rest', 'winter', 'food'];

export function chamber(w: World, t: Chamber['type']): Chamber {
  return w.nest.chamberOfType(t)[0];
}

/** 随机挑两间，去巢内路程较近的一间：既分散开，又不总是横穿整个蚁穴 */
export function nearerOf(a: Ant, w: World, rooms: Chamber[]): Chamber {
  const from = here(a, w);
  const c1 = w.rng.pick(rooms);
  const c2 = w.rng.pick(rooms);
  return w.nest.routeLength(from, c1.door) <= w.nest.routeLength(from, c2.door) ? c1 : c2;
}

export function* goHome(a: Ant): Routine {
  if (a.domain === 'surface') yield { k: 'enter' };
}

/** 走到物品所在处（房间、隧道节点或地表） */
export function* goToItem(a: Ant, it: Item): Routine {
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

export function stillMine(a: Ant, it: Item): boolean {
  return it.place !== 'gone' && it.carriedBy < 0 && (it.claimedBy === a.id || it.claimedBy < 0);
}

/** 蚂蚁所在的巢内节点；在地表时取最近的入口 */
export function here(a: Ant, w: World): number {
  return a.domain === 'nest' ? a.currentNode(w) : w.nest.nearestEntrance(a.pos.x, a.pos.z).node;
}

export function wantsToEat(a: Ant, w: World): boolean {
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
export function* solicit(a: Ant, w: World, reason: Text): Generator<Command, boolean, unknown> {
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
export function* offerCrop(a: Ant, w: World, maxPartners: number, pred: (b: Ant) => boolean = (b) => b.crop < 0.5): Routine {
  const col = w.colony;
  let given = 0;
  let tries = 0;
  while (a.room >= 0 && a.crop > 0.15 && given < maxPartners && tries < maxPartners + 3) {
    tries++;
    const b = col.findRoommate(a, pred);
    if (!b) {
      a.activity = L('act.seekPartner');
      yield { k: 'room', chamber: a.room, time: w.rng.range(1.5, 3) };
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
  yield { k: 'room', chamber: c.id, time: 0, point: w.nest.randomFloorPoint(c, () => w.rng.next(), new THREE.Vector3()) };
}

/** 返巢后在储食室（不够再去休息室）把嗉囊里的甜液分出去 */
export function* unloadCrop(a: Ant, w: World): Routine {
  const col = w.colony;
  const store = col.foodChamber();
  a.activity = L('act.unloadStore');
  yield* walkIntoRoom(w, store);
  yield* offerCrop(a, w, 4);
  if (a.crop > 0.3) {
    const c = w.rng.pick(w.nest.chamberOfType('rest'));
    a.activity = L('act.shareIn', { room: c.label });
    yield* walkIntoRoom(w, c);
    yield* offerCrop(a, w, 3);
  }
}

/** 嗉囊饱满的巢内工蚁把甜液带到育幼区，分给保育蚁 */
export function* distributeCrop(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = broodChambers(w).filter((c) => col.ants.some((b) => b.room === c.id && b.role === 'nurse'));
  if (!options.length) return;
  const c = w.rng.pick(options);
  yield* goHome(a);
  a.activity = L('act.bringCrop', { room: c.label });
  yield* walkIntoRoom(w, c);
  yield* offerCrop(a, w, 3, (b) => b.role === 'nurse' && b.crop < 0.4);
}

export function broodChambers(w: World): Chamber[] {
  const n = w.nest;
  return [...n.chamberOfType('egg'), ...n.chamberOfType('larva'), ...n.chamberOfType('pupa'), ...n.chamberOfType('solar')];
}

// ---------------- 进食与休息 ----------------

export function* eat(a: Ant, w: World): Routine {
  if (a.crop >= 0.1) {
    a.activity = L('act.eatCrop');
    yield { k: 'wait', time: 1.5 };
    a.eatFromCrop();
    return;
  }
  yield* goHome(a);
  if (a.room >= 0 && w.rng.chance(0.6) && (yield* solicit(a, w, L('reason.hungry')))) {
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
    a.eatRetryAt = w.clock.seconds + w.rng.range(30, 60);
  }
}

export function* rest(a: Ant, w: World, label: Text = L('act.rest')): Routine {
  yield* goHome(a);
  // 随机挑两间休息室，去路程较近的一间
  const from = a.currentNode(w);
  let c = nearerOf(a, w, w.nest.chamberOfType('rest').filter((x) => x.ready));
  // 休息室挤满了就去最近的没挤满的房间；都挤满了才去最空的那间
  const col = w.colony;
  const cap = CONFIG.crowd.restDensity;
  if (col.roomDensity(c) > cap) {
    const spill = w.nest.chambers.filter((o) => o.ready && REST_SPILL.includes(o.type));
    const roomy = spill.filter((o) => col.roomDensity(o) <= cap);
    if (roomy.length) c = roomy.reduce((p, o) => (w.nest.routeLength(from, o.door) < w.nest.routeLength(from, p.door) ? o : p));
    else for (const o of spill) if (col.roomDensity(o) < col.roomDensity(c)) c = o;
  }
  a.activity = L('act.goTo', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = label;
  yield { k: 'room', chamber: c.id, time: w.rng.range(12, 30) };
}

/** 天气转坏时返巢躲雨 */
export function* shelter(a: Ant, w: World): Routine {
  a.layTrail = 0;
  a.activity = L(w.weather.phase === 'rain' ? 'act.shelterRain' : w.weather.phase === 'overcast' ? 'act.shelterCloud' : 'act.shelterWet');
  yield { k: 'enter' };
  yield* rest(a, w, L(w.weather.phase === 'rain' ? 'act.restRain' : 'act.restWet'));
}

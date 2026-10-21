import * as THREE from 'three';
import { CONFIG } from '../config';
import { TAU } from '../util/math';
import { rng } from '../util/random';
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
function* solicit(a: Ant, w: World, reason: string): Generator<Command, boolean, unknown> {
  const col = w.colony;
  const donor = col.findRoommate(a, (b) => b.crop > 0.45);
  if (!donor) return false;
  donor.hold(donor.pos.distanceTo(a.pos) / 1.4 + 2, a.pos);
  a.activity = `${reason}，向 #${donor.id} 乞食`;
  yield { k: 'room', chamber: a.room, time: 0.2, point: approachPoint(donor, a) };
  if (!donor.alive || donor.room !== a.room) return false;
  a.faceTo(donor.pos);
  donor.faceTo(a.pos);
  donor.holdT = Math.max(donor.holdT, 2.6);
  a.activity = `与 #${donor.id} 交哺：接受反刍的甜液`;
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
      a.activity = '在房间里寻找需要食物的同伴';
      yield { k: 'room', chamber: a.room, time: rng.range(1.5, 3) };
      continue;
    }
    b.hold(b.pos.distanceTo(a.pos) / 1.4 + 2, a.pos);
    a.activity = `走向 #${b.id}，准备交哺`;
    yield { k: 'room', chamber: a.room, time: 0.2, point: approachPoint(b, a) };
    if (!b.alive || b.room !== a.room) continue;
    a.faceTo(b.pos);
    b.faceTo(a.pos);
    b.holdT = Math.max(b.holdT, 2.6);
    a.activity = `与 #${b.id} 交哺：反刍嗉囊中的甜液`;
    yield { k: 'wait', time: 2.4 };
    if (col.share(a, b) > 0) given++;
    b.holdT = Math.min(b.holdT, 0.3);
  }
  if (given) a.note(w, `通过交哺把甜液分给 ${given} 只同伴`);
}

/** 返巢后在储食室（不够再去休息室）把嗉囊里的甜液分出去 */
function* unloadCrop(a: Ant, w: World): Routine {
  const col = w.colony;
  const store = col.foodChamber();
  a.activity = '进入储食室，把甜液分给巢内同伴';
  yield { k: 'room', chamber: store.id, time: rng.range(0.5, 1.5) };
  yield* offerCrop(a, w, 4);
  if (a.crop > 0.3) {
    const c = rng.pick(w.nest.chamberOfType('rest'));
    a.activity = `前往${c.name}分享甜液`;
    yield { k: 'room', chamber: c.id, time: 0.3 };
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
  a.activity = `把嗉囊中的甜液带到${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.3 };
  yield* offerCrop(a, w, 3, (b) => b.role === 'nurse' && b.crop < 0.4);
}

function broodChambers(w: World): Chamber[] {
  const n = w.nest;
  return [...n.chamberOfType('egg'), ...n.chamberOfType('larva'), ...n.chamberOfType('pupa'), ...n.chamberOfType('solar')];
}

// ---------------- 进食与休息 ----------------

function* eat(a: Ant, w: World): Routine {
  if (a.crop >= 0.1) {
    a.activity = '从自己的嗉囊中取食';
    yield { k: 'wait', time: 1.5 };
    a.eatFromCrop();
    return;
  }
  yield* goHome(a);
  if (a.room >= 0 && rng.chance(0.6) && (yield* solicit(a, w, '饥饿'))) {
    a.eatFromCrop();
    a.note(w, '通过交哺从同伴处获得食物');
    return;
  }
  const store = w.colony.foodChamber();
  a.activity = '饥饿，前往储食室进食';
  yield { k: 'room', chamber: store.id, time: 1, point: w.colony.pileCenter(store, 'food') };
  yield { k: 'wait', time: 2 };
  if (w.colony.takeFood(CONFIG.ant.eatAmount)) {
    a.hunger = Math.max(0, a.hunger - 0.85);
    a.note(w, '在储食室进食');
  } else if (yield* solicit(a, w, '储食室没有固体食物')) {
    a.eatFromCrop();
    a.note(w, '储食室空了，从同伴处乞得甜液');
  } else {
    a.note(w, '没有找到食物，未能进食');
    a.eatRetryAt = w.clock.seconds + rng.range(30, 60);
  }
}

function* rest(a: Ant, w: World, label = '在休息室休息'): Routine {
  yield* goHome(a);
  // 随机挑两间休息室，去路程较近的一间
  const rooms = w.nest.chamberOfType('rest');
  const from = a.currentNode(w);
  const c1 = rng.pick(rooms);
  const c2 = rng.pick(rooms);
  const c = w.nest.routeLength(from, c1.door) <= w.nest.routeLength(from, c2.door) ? c1 : c2;
  a.activity = `前往${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = label;
  yield { k: 'room', chamber: c.id, time: rng.range(12, 30) };
}

/** 天气转坏时返巢躲雨 */
export function* shelter(a: Ant, w: World): Routine {
  a.layTrail = 0;
  a.activity = w.weather.phase === 'rain' ? '下雨了，赶回巢内躲雨' : w.weather.phase === 'overcast' ? '天色转阴，提前返巢' : '地面还湿，返回巢内';
  yield { k: 'enter' };
  yield* rest(a, w, w.weather.phase === 'rain' ? '在巢内躲雨' : '等地面晾干');
}

// ---------------- 蚁后 ----------------

function* queenRoutine(a: Ant, w: World): Routine {
  const qc = chamber(w, 'queen');
  a.activity = '在蚁后室中缓慢移动，接受工蚁照料';
  yield { k: 'room', chamber: qc.id, time: rng.range(4, 9) };
  while (w.colony.canLay()) {
    a.activity = '产卵';
    yield { k: 'wait', time: 2.5 };
    w.colony.layEgg(a);
    a.note(w, `产下一枚卵（累计 ${w.colony.stats.eggsLaid} 枚）`);
  }
  if (a.hunger > 0.85) {
    a.activity = '饥饿，等待保育蚁喂食';
    yield { k: 'wait', time: 4 };
  }
}

// ---------------- 保育蚁 ----------------

function* nurseRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  if (wantsToEat(a, w)) return yield* eat(a, w);

  const egg = col.findItem((i) => i.type === 'egg' && col.chamberType(i.chamber) === 'queen');
  if (egg && rng.chance(0.85)) return yield* carryBrood(a, w, egg, '把卵从蚁后室搬到卵室');

  const ready = col.findItem((i) => i.type === 'pupa' && i.ready);
  if (ready && rng.chance(0.8)) return yield* helpEclose(a, w, ready);

  const mover = col.findItem((i) => i.isBrood && i.wantsMove);
  if (mover && rng.chance(0.75)) {
    const target = col.targetChamberFor(mover);
    return yield* carryBrood(a, w, mover, `把${ITEM_NAMES[mover.type]}搬到${target.name}`);
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

function* carryBrood(a: Ant, w: World, it: Item, label: string): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = `前往${w.nest.chambers[it.chamber].name}取${ITEM_NAMES[it.type]}`;
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
  a.activity = '整理幼体堆';
  yield { k: 'room', chamber: target.id, time: rng.range(1.5, 4) };
}

function* helpEclose(a: Ant, w: World, pupa: Item): Routine {
  pupa.claimedBy = a.id;
  a.activity = `前往${w.nest.chambers[pupa.chamber].name}，帮助新蚁破茧`;
  yield* goToItem(a, pupa);
  if (!stillMine(a, pupa)) return;
  a.activity = '用上颚撕开茧壳，帮助新工蚁羽化';
  yield { k: 'wait', time: 3.5 };
  const born = w.colony.eclose(pupa, a);
  if (born) a.note(w, `帮助新工蚁 #${born.id} 破茧`);
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
  if ((yield* solicit(a, w, '储食室空了')) && a.crop >= 0.2) return 'crop';
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
  a.activity = a.crop >= 0.3 ? '带着嗉囊里的甜液去喂幼虫' : '前往储食室，为幼虫取食';
  const how = yield* fetchFood(a, w);
  if (!how || !stillMine(a, larva) || larva.place !== 'chamber') {
    if (larva.claimedBy === a.id) larva.claimedBy = -1;
    if (how === 'solid') consumeFeed(a, w, how);
    a.activity = '没有取到食物';
    return;
  }
  a.activity = how === 'crop' ? '口对口把甜液反哺给幼虫' : '把食物碎块喂给幼虫';
  yield { k: 'room', chamber: larva.chamber, time: 0.3, point: larva.pos.clone() };
  yield { k: 'wait', time: 2.2 };
  consumeFeed(a, w, how);
  if (larva.type === 'larva') {
    larva.hunger = 0;
    larva.feeds++;
    if (rng.chance(0.15)) col.addToChamber(new Item('waste'), w.nest.chambers[larva.chamber]);
    a.note(w, `给幼虫喂食${how === 'crop' ? '甜液' : '固体食物'}（第 ${larva.feeds} 次）`);
  }
  if (larva.claimedBy === a.id) larva.claimedBy = -1;
  a.activity = '在幼虫室照料幼虫';
  yield { k: 'room', chamber: larva.chamber, time: rng.range(2, 5) };
}

function* feedQueen(a: Ant, w: World): Routine {
  const col = w.colony;
  col.queenTender = a.id;
  a.activity = '为蚁后取食';
  const how = yield* fetchFood(a, w);
  if (!how) {
    col.queenTender = -1;
    return;
  }
  a.activity = '喂食蚁后';
  const qc = chamber(w, 'queen');
  yield { k: 'room', chamber: qc.id, time: 0.3, point: col.queen.pos.clone() };
  yield { k: 'wait', time: 3 };
  consumeFeed(a, w, how);
  col.queen.hunger = 0;
  col.queenTender = -1;
  col.queen.note(w, `接受保育蚁 #${a.id} 喂食`);
  a.note(w, '喂食了蚁后');
  a.activity = '为蚁后梳理清洁';
  yield { k: 'room', chamber: qc.id, time: rng.range(3, 8) };
}

function* tendBrood(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = broodChambers(w).filter((c) => col.byChamber[c.id].some((i) => i.isBrood));
  yield* goHome(a);
  // 嗉囊空了的保育蚁会向路过的同伴讨要甜液，用来反哺幼虫
  if (a.crop < 0.2 && a.room >= 0 && rng.chance(0.3) && (yield* solicit(a, w, '为喂幼虫储备食物'))) return;
  // 蚁后身边总围着一圈侍从工蚁，为它梳理、舔舐并传递蚁后信息素
  if (rng.chance(0.18)) {
    const qc = chamber(w, 'queen');
    a.activity = '前往蚁后室';
    yield { k: 'room', chamber: qc.id, time: 0.1 };
    a.activity = '侍奉蚁后：梳理、舔舐蚁后体表';
    const near = col.queen.pos.clone();
    near.x += rng.range(-1.6, 1.6);
    near.z += rng.range(-1.6, 1.6);
    yield { k: 'room', chamber: qc.id, time: rng.range(10, 25), point: near };
    return;
  }
  if (options.length === 0) return yield* rest(a, w);
  const c = rng.pick(options);
  const what = c.type === 'egg' ? '卵团' : c.type === 'larva' ? '幼虫' : '蛹';
  a.activity = `前往${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = `舔舐清洁${what}，防止霉菌滋生`;
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
    const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste');
    if (waste && rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);
    if (a.crop > 0.6 && rng.chance(0.5)) return yield* distributeCrop(a, w);
    return yield* patrolNest(a, w);
  }

  const corpse = findCorpse(w);
  if (corpse && rng.chance(0.85)) return yield* carryOut(a, w, corpse, '把同伴尸体搬到巢外垃圾堆');

  const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste');
  if (waste && rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);

  const wc = chamber(w, 'waste');
  if (col.countIn(wc.id, 'waste') >= 4 && rng.chance(0.6)) {
    const it = col.byChamber[wc.id].find((i) => i.type === 'waste' && i.free);
    if (it) return yield* carryOut(a, w, it, '把垃圾运出巢外');
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
  a.activity = job.open ? `雨停了，前往${e.name}清开封土` : `要下雨了，前往${e.name}封堵入口`;
  yield { k: 'goto', node: e.node };
  a.activity = job.open ? `把堵在${e.name}的土粒搬开` : `用土粒一层层堵住${e.name}`;
  yield { k: 'wait', time: rng.range(3, 5) };
  a.plugging = -1;
  w.weather.workPlug(job, w);
  a.note(w, job.open ? `清开了${e.name}的一部分封土` : `往${e.name}填了一层土`);
}

function findCorpse(w: World): Item | null {
  for (const it of w.colony.nodeItems) if (it.type === 'corpse' && it.free) return it;
  const c = w.colony.findItem((i) => i.type === 'corpse');
  if (c) return c;
  for (const it of w.colony.surfaceItems)
    if (it.type === 'corpse' && it.place === 'surface' && it.free && Math.hypot(it.pos.x, it.pos.z) < 30) return it;
  return null;
}

function* carryWasteInside(a: Ant, w: World, it: Item): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = `前往${w.nest.chambers[it.chamber].name}清理垃圾`;
  yield* goToItem(a, it);
  if (!stillMine(a, it) || it.place !== 'chamber') {
    if (it.claimedBy === a.id) it.claimedBy = -1;
    return;
  }
  col.pickUp(a, it);
  const wc = chamber(w, 'waste');
  const spot = col.pileSpot(wc, 'waste');
  a.activity = '把垃圾搬到垃圾室';
  yield { k: 'room', chamber: wc.id, time: 0.3, point: spot };
  const d = col.release(a);
  if (d) col.addToChamber(d, wc, spot);
  a.note(w, '清理了一份垃圾');
}

/** 搬到巢外垃圾堆（尸体搬运是蚂蚁的“葬尸行为”，由尸体释放的油酸触发） */
function* carryOut(a: Ant, w: World, it: Item, label: string): Routine {
  const col = w.colony;
  it.claimedBy = a.id;
  a.activity = it.type === 'corpse' ? '察觉到尸体散发的油酸气味，前去搬运' : '前往垃圾室';
  yield* goToItem(a, it);
  if (!stillMine(a, it)) {
    if (it.claimedBy === a.id) it.claimedBy = -1;
    return;
  }
  col.pickUp(a, it);
  a.activity = label;
  if (a.domain === 'nest') yield { k: 'exit' };
  const m = col.midden;
  yield { k: 'walk', x: m.x + rng.range(-1.5, 1.5), z: m.z + rng.range(-1.5, 1.5), r: 1.2 };
  const d = col.release(a);
  if (d) col.dropAtMidden(d);
  col.stats.wasteRemoved++;
  a.note(w, it.type === 'corpse' ? '把同伴尸体丢到垃圾堆' : '把垃圾丢到巢外垃圾堆');
  a.activity = '返回巢内';
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
  a.activity = enlarge ? '前往要扩大的房间' : project ? '前往扩建工地' : '前往隧道尽头的挖掘面';
  yield { k: 'goto', node };
  // 房间阶段：走进已挖出的部分，在远端继续挖
  const spot = ex.isProjectFace(node) ? ex.digPoint(new THREE.Vector3()) : null;
  const room = w.nest.nodes[node].chamber;
  if (spot && room !== undefined) yield { k: 'room', chamber: room, time: 0.3, point: spot };
  a.activity = !spot ? (project ? '挖掘通往新房间的隧道' : '用上颚挖掘土壤，延长隧道') : ex.enlarging() ? '啃下房间边缘的土，扩大房间' : '在新房间里挖掘，扩大空间';
  yield { k: 'wait', time: rng.range(3, 6) };
  a.digNode = -1;
  ex.excavate(node);
  if (w.weather.keepIn) {
    a.activity = '入口封着，把挖下的土粒压实在隧道壁上';
    yield { k: 'wait', time: rng.range(2, 3) };
    col.stats.soilExcavated++;
    a.note(w, project ? '为扩建工程挖出一粒土，压在隧道壁上' : '挖出一粒土，压在隧道壁上');
    return;
  }
  const soil = new Item('soil');
  col.pickUp(a, soil);
  col.stats.soilExcavated++;
  a.activity = '把土粒运出巢外';
  yield { k: 'exit' };
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = rng.range(0, TAU);
  yield { k: 'walk', x: ent.x + Math.cos(ang) * 3, z: ent.z + Math.sin(ang) * 3, r: 0.8 };
  const d = col.release(a);
  if (d) col.dropOnMound(d, ent);
  a.note(w, project ? '为扩建工程挖出一粒土' : '挖出一粒土堆在蚁丘上');
  a.activity = '返回巢内';
  yield { k: 'enter' };
}

/** 入口警戒；threat 为 true 时是因为有狼蛛逼近，去受威胁的那个入口，巡逻范围更大 */
function* guard(a: Ant, w: World, threat = false): Routine {
  yield* goHome(a);
  a.guarding = threat;
  a.activity = threat ? '狼蛛逼近巢口，出巢警戒' : '前往入口执勤';
  yield { k: 'exit' };
  const ti = w.predators.threatEntrance;
  const ent = threat && ti >= 0 ? w.nest.entrances[ti] : w.nest.nearestEntrance(a.pos.x, a.pos.z);
  a.activity = threat ? '在巢口外警戒，准备迎击狼蛛' : '在入口附近警戒巡逻，检查来者气味';
  a.note(w, `在${ent.name}警戒${threat ? '（有狼蛛逼近）' : ''}`);
  yield { k: 'patrol', x: ent.x, z: ent.z, radius: threat ? 7 : 4.5, time: rng.range(25, 60) };
  a.guarding = false;
  a.activity = '结束警戒，返回巢内';
  yield { k: 'enter' };
}

function* patrolNest(a: Ant, w: World): Routine {
  yield* goHome(a);
  const c = rng.pick(w.nest.chambers.filter((x) => x.ready && x.type !== 'queen'));
  a.activity = `巡视${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = `在${c.name}内整理、清洁巢壁`;
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
    return yield* rest(a, w, surfaceT < 8 ? '地表太冷，在巢内等待' : '夜间在巢内休息');
  }
  // 储备越充足，返巢蚁越难把食物交出去，出巢觅食的积极性随之下降；被同伴激发时则更容易出巢
  const satiation = Math.min(0.9, Math.max(0, (col.reserve - 150) / 200)) * (a.scout ? 0.5 : 1) * (excited ? 0.3 : 1);
  if (a.domain === 'nest' && rng.chance(satiation)) {
    if (a.crop > 0.6 && rng.chance(0.4)) return yield* distributeCrop(a, w);
    return yield* rest(a, w, '食物储备充足，留在巢内待命');
  }

  if (a.domain === 'nest' && w.weather.keepIn) {
    const P = w.weather.phase;
    return yield* rest(a, w, P === 'rain' ? '外面在下雨，留在巢内' : P === 'overcast' ? '天色阴沉，留在巢内' : '地面还湿，等晾干再出巢');
  }

  if (a.domain === 'nest' && w.predators.threatEntrance >= 0 && rng.chance(CONFIG.defense.holdBackProb)) {
    return yield* rest(a, w, '巢口附近有狼蛛，暂时留在巢内');
  }

  const herd = pickHerd(a, w);
  if (herd) return yield* tendAphids(a, w, herd, false);

  if (a.domain === 'nest') {
    a.activity = a.scout ? '出巢侦察' : excited ? '受同伴激发，出巢觅食' : '出巢觅食';
    yield { k: 'exit' };
  }
  a.activity = a.memory ? '前往记忆中的觅食地点' : a.scout ? '侦察新的食物源' : '搜索食物，留意信息素路径';
  const found = (yield { k: 'search', time: a.scout ? 220 : 140 }) as FoodSource | AphidColony | null;

  if (found instanceof AphidColony) {
    if (!found.discovered) {
      found.discovered = true;
      a.note(w, '发现一群蚜虫');
      col.pushEvent(`${a.scout ? '侦察蚁' : '觅食蚁'} #${a.id} 发现了一群蚜虫`);
    }
    return yield* tendAphids(a, w, found, true);
  }

  if (!found || found.amount < 1) {
    a.activity = '没有找到食物，返巢';
    a.layTrail = 0;
    yield { k: 'enter' };
    return yield* rest(a, w);
  }

  const isNew = !found.discovered;
  found.discovered = true;
  a.activity = `在${found.info.name}处${found.kind === 'sugar' ? '吸食甜液' : '切割搬运'}`;
  yield { k: 'wait', time: found.kind === 'sugar' ? 4 : 3 };
  if (!found.take()) {
    a.activity = '食物已被搬空，返巢';
    a.memory = null;
    yield { k: 'enter' };
    return;
  }
  if (a.hunger > 0.3) {
    a.hunger = 0;
    a.note(w, `在${found.info.name}处进食`);
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
    a.note(w, `发现新的食物源：${found.info.name}`);
    col.pushEvent(`${a.scout ? '侦察蚁' : '觅食蚁'} #${a.id} 发现了${found.info.name}`);
  } else a.note(w, `从${found.info.name}获取食物`);

  a.activity = found.kind === 'sugar' ? '嗉囊装满甜液返巢，沿途释放路径信息素' : '携带食物返巢，沿途释放路径信息素';
  yield { k: 'enter' };
  a.layTrail = 0;
  a.trips++;
  a.delivered++;
  col.stats.foodCollected++;
  if (found.kind === 'sugar') return yield* unloadCrop(a, w);
  const store = col.foodChamber();
  a.activity = '把食物送进储食室';
  yield { k: 'room', chamber: store.id, time: 0.3, point: col.pileSpot(store, 'food') };
  col.storeFood(a);
  a.note(w, '把食物存入储食室');
  a.activity = '在储食室短暂停留';
  yield { k: 'room', chamber: store.id, time: rng.range(2, 6) };
}

/** 蚜虫放牧：爬上寄主植物，拍打蚜虫收集蜜露；蜜露不多时留下守护蚜虫 */
function* tendAphids(a: Ant, w: World, c: AphidColony, arrived: boolean): Routine {
  const col = w.colony;
  if (a.domain === 'nest') {
    a.activity = '出巢前往照料的蚜虫群';
    yield { k: 'exit' };
  }
  if (!arrived) {
    const ang = rng.range(0, TAU);
    a.activity = '前往蚜虫所在的植物';
    yield { k: 'walk', x: c.x + Math.cos(ang) * 1.6, z: c.z + Math.sin(ang) * 1.6, r: 0.6 };
  }
  const guard = c.honeydew < 0.6;
  const ang = Math.atan2(a.pos.z - c.z, a.pos.x - c.x);
  a.activity = guard ? '爬上植物守护蚜虫，驱赶瓢虫等天敌' : '爬上植物，用触角拍打蚜虫收集蜜露';
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
    a.note(w, '守护了一阵蚜虫群，蜜露不多');
    a.activity = '返巢';
    yield { k: 'enter' };
    if (a.crop > 0.3) yield* unloadCrop(a, w);
    return;
  }
  a.note(w, `从蚜虫群收集蜜露（嗉囊 ${Math.round(a.crop * 100)}%）`);
  a.layTrail = CONFIG.pheromone.depositFood * 0.8;
  a.activity = '嗉囊装满蜜露返巢，沿途释放路径信息素';
  yield { k: 'enter' };
  a.layTrail = 0;
  a.trips++;
  a.delivered++;
  col.stats.foodCollected++;
  yield* unloadCrop(a, w);
}

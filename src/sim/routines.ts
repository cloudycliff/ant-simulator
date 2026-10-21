import { CONFIG } from '../config';
import { rng } from '../util/random';
import type { Chamber } from '../nest/nest';
import type { FoodSource } from '../world/food';
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

function* eat(a: Ant, w: World): Routine {
  if (a.crop > 0.2) {
    a.activity = '从自己的嗉囊中取食';
    yield { k: 'wait', time: 1.5 };
    a.crop = Math.max(0, a.crop - 0.4);
    a.hunger = 0;
    return;
  }
  yield* goHome(a);
  const store = w.colony.foodChamber();
  a.activity = '饥饿，前往储食室进食';
  yield { k: 'room', chamber: store.id, time: 1, point: w.colony.pileCenter(store, 'food') };
  yield { k: 'wait', time: 2 };
  if (w.colony.takeFood(CONFIG.ant.eatAmount)) {
    a.hunger = Math.max(0, a.hunger - 0.85);
    a.note(w, '在储食室进食');
  } else {
    a.note(w, '储食室没有食物，未能进食');
    a.eatRetryAt = w.clock.seconds + rng.range(30, 60);
  }
}

function* rest(a: Ant, w: World, label = '在休息室休息'): Routine {
  yield* goHome(a);
  const rooms = w.nest.chamberOfType('rest');
  const c = rng.pick(rooms);
  a.activity = `前往${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = label;
  yield { k: 'room', chamber: c.id, time: rng.range(12, 30) };
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

  if (col.queen.hunger > 0.45 && col.queenTender < 0 && col.foodStock > 0.5) return yield* feedQueen(a, w);

  const larva = hungriestLarva(w);
  if (larva && col.foodStock > 0.5 && rng.chance(0.8)) return yield* feedLarva(a, w, larva);

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
  a.activity = '前往蛹室，帮助新蚁破茧';
  yield* goToItem(a, pupa);
  if (!stillMine(a, pupa)) return;
  a.activity = '用上颚撕开茧壳，帮助新工蚁羽化';
  yield { k: 'wait', time: 3.5 };
  const born = w.colony.eclose(pupa, a);
  if (born) a.note(w, `帮助新工蚁 #${born.id} 破茧`);
  else if (pupa.claimedBy === a.id) pupa.claimedBy = -1;
}

function* fetchFood(a: Ant, w: World): Generator<Command, boolean, unknown> {
  const col = w.colony;
  const store = col.foodChamber();
  yield* goHome(a);
  yield { k: 'room', chamber: store.id, time: rng.range(0.8, 1.6), point: col.pileSpot(store, 'food') };
  const kind = col.takeFood(0.45);
  if (!kind) return false;
  const piece = new Item('food');
  piece.foodKind = kind;
  col.pickUp(a, piece);
  return true;
}

function* feedLarva(a: Ant, w: World, larva: Item): Routine {
  const col = w.colony;
  larva.claimedBy = a.id;
  a.activity = '前往储食室，为幼虫取食';
  const ok = yield* fetchFood(a, w);
  if (!ok || !stillMine(a, larva) || larva.place !== 'chamber') {
    if (larva.claimedBy === a.id) larva.claimedBy = -1;
    const p = col.release(a);
    if (p) col.destroy(p);
    a.activity = '没有取到食物';
    return;
  }
  a.activity = '把食物喂给幼虫';
  yield { k: 'room', chamber: larva.chamber, time: 0.3, point: larva.pos.clone() };
  yield { k: 'wait', time: 2.2 };
  const p = col.release(a);
  if (p) col.destroy(p);
  if (larva.type === 'larva') {
    larva.hunger = 0;
    larva.feeds++;
    if (rng.chance(0.15)) col.addToChamber(new Item('waste'), w.nest.chambers[larva.chamber]);
    a.note(w, `给幼虫喂食（第 ${larva.feeds} 次）`);
  }
  if (larva.claimedBy === a.id) larva.claimedBy = -1;
  a.activity = '在幼虫室照料幼虫';
  yield { k: 'room', chamber: larva.chamber, time: rng.range(2, 5) };
}

function* feedQueen(a: Ant, w: World): Routine {
  const col = w.colony;
  col.queenTender = a.id;
  a.activity = '为蚁后取食';
  const ok = yield* fetchFood(a, w);
  if (!ok) {
    col.queenTender = -1;
    return;
  }
  a.activity = '喂食蚁后';
  const qc = chamber(w, 'queen');
  yield { k: 'room', chamber: qc.id, time: 0.3, point: col.queen.pos.clone() };
  yield { k: 'wait', time: 3 };
  const p = col.release(a);
  if (p) col.destroy(p);
  col.queen.hunger = 0;
  col.queenTender = -1;
  col.queen.note(w, `接受保育蚁 #${a.id} 喂食`);
  a.note(w, '喂食了蚁后');
  a.activity = '为蚁后梳理清洁';
  yield { k: 'room', chamber: qc.id, time: rng.range(3, 8) };
}

function* tendBrood(a: Ant, w: World): Routine {
  const col = w.colony;
  const options = [...w.nest.chamberOfType('egg'), ...w.nest.chamberOfType('larva'), ...w.nest.chamberOfType('pupa')].filter(
    (c) => col.byChamber[c.id].some((i) => i.isBrood),
  );
  yield* goHome(a);
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

  const corpse = findCorpse(w);
  if (corpse && rng.chance(0.85)) return yield* carryOut(a, w, corpse, '把同伴尸体搬到巢外垃圾堆');

  const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste');
  if (waste && rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);

  const wc = chamber(w, 'waste');
  if (col.countIn(wc.id, 'waste') >= 4 && rng.chance(0.6)) {
    const it = col.byChamber[wc.id].find((i) => i.type === 'waste' && i.free);
    if (it) return yield* carryOut(a, w, it, '把垃圾运出巢外');
  }

  const r = rng.next();
  if (r < 0.45) return yield* dig(a, w);
  if (r < 0.7 && !w.clock.isNight) return yield* guard(a, w);
  return yield* patrolNest(a, w);
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
  yield* goHome(a);
  const face = rng.pick(w.nest.deadEnds);
  a.activity = '前往隧道尽头的挖掘面';
  yield { k: 'goto', node: face };
  a.activity = '用上颚挖掘土壤，扩建隧道';
  yield { k: 'wait', time: rng.range(3, 6) };
  const soil = new Item('soil');
  col.pickUp(a, soil);
  col.stats.soilExcavated++;
  a.activity = '把土粒运出巢外';
  yield { k: 'exit' };
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = rng.range(0, Math.PI * 2);
  yield { k: 'walk', x: ent.x + Math.cos(ang) * 3, z: ent.z + Math.sin(ang) * 3, r: 0.8 };
  const d = col.release(a);
  if (d) col.dropOnMound(d, ent);
  a.note(w, '挖出一粒土堆在蚁丘上');
  a.activity = '返回巢内';
  yield { k: 'enter' };
}

function* guard(a: Ant, w: World): Routine {
  yield* goHome(a);
  a.activity = '前往入口执勤';
  yield { k: 'exit' };
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  a.activity = '在入口附近警戒巡逻，检查来者气味';
  a.note(w, `在${ent.name}警戒`);
  yield { k: 'patrol', x: ent.x, z: ent.z, radius: 4.5, time: rng.range(25, 60) };
  a.activity = '结束警戒，返回巢内';
  yield { k: 'enter' };
}

function* patrolNest(a: Ant, w: World): Routine {
  yield* goHome(a);
  const c = rng.pick(w.nest.chambers.filter((x) => x.type !== 'queen'));
  a.activity = `巡视${c.name}`;
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = `在${c.name}内整理、清洁巢壁`;
  yield { k: 'room', chamber: c.id, time: rng.range(8, 20) };
}

// ---------------- 觅食蚁 ----------------

function* foragerRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  // 储食室空了的时候，觅食蚁不会留在巢里挨饿，而是出去在食物源处进食
  if (wantsToEat(a, w) && (col.foodStock > 1 || a.crop > 0.2)) return yield* eat(a, w);
  const surfaceT = w.clock.temperatureAt(0);
  if (a.domain === 'nest' && ((w.clock.isNight && rng.chance(0.6)) || surfaceT < 8)) {
    return yield* rest(a, w, surfaceT < 8 ? '地表太冷，在巢内等待' : '夜间在巢内休息');
  }
  // 储备越充足，返巢蚁在巢内越难卸下食物，出巢觅食的积极性随之下降
  const satiation = Math.min(0.9, Math.max(0, (col.foodStock - 150) / 200)) * (a.scout ? 0.5 : 1);
  if (a.domain === 'nest' && rng.chance(satiation)) {
    return yield* rest(a, w, '食物储备充足，留在巢内待命');
  }

  if (a.domain === 'nest') {
    a.activity = a.scout ? '出巢侦察' : '出巢觅食';
    yield { k: 'exit' };
  }
  a.activity = a.memory ? '前往记忆中的觅食地点' : a.scout ? '侦察新的食物源' : '搜索食物，留意信息素路径';
  const found = (yield { k: 'search', time: a.scout ? 220 : 140 }) as FoodSource | null;

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

  a.activity = '携带食物返巢，沿途释放路径信息素';
  yield { k: 'enter' };
  a.layTrail = 0;
  const store = col.foodChamber();
  a.activity = '把食物送进储食室';
  yield { k: 'room', chamber: store.id, time: 0.3, point: col.pileSpot(store, 'food') };
  col.storeFood(a, found.kind);
  a.trips++;
  a.delivered++;
  a.note(w, `把${found.kind === 'sugar' ? '嗉囊里的甜液反哺' : '食物'}存入储食室`);
  a.activity = '在储食室短暂停留';
  yield { k: 'room', chamber: store.id, time: rng.range(2, 6) };
}

/** 内务蚁的任务：搬尸体和垃圾、挖掘、封堵入口、警戒、巡视 */
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { L, type Text } from '../../../../core/i18n';
import { TAU } from '../../../../core/util/math';
import type { PlugJob } from '../../world/weather';
import type { World } from '../../world/world';
import type { Ant, Routine } from '../ant';
import { type Item, ITEM_NAMES } from '../items';
import { chamber, distributeCrop, eat, goHome, goToItem, here, stillMine, wantsToEat } from './common';

// ---------------- 内务蚁 ----------------

export function* maintenanceRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  if (wantsToEat(a, w)) return yield* eat(a, w);

  const job = w.weather.plugJob(w);
  if (job && w.rng.chance(0.8)) return yield* plugEntrance(a, w, job);
  // 入口封着或地面还湿时，只做巢内的工作
  if (w.weather.keepIn) {
    const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste', here(a, w));
    if (waste && w.rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);
    if (a.crop > 0.6 && w.rng.chance(0.5)) return yield* distributeCrop(a, w);
    return yield* patrolNest(a, w);
  }

  const corpse = findCorpse(a, w);
  if (corpse && w.rng.chance(0.85)) return yield* carryOut(a, w, corpse, L('act.carryCorpseOut'));

  const waste = col.findItem((i) => i.type === 'waste' && col.chamberType(i.chamber) !== 'waste', here(a, w));
  if (waste && w.rng.chance(0.7)) return yield* carryWasteInside(a, w, waste);

  const wc = chamber(w, 'waste');
  if (col.countIn(wc.id, 'waste') >= 4 && w.rng.chance(0.6)) {
    const it = col.byChamber[wc.id].find((i) => i.type === 'waste' && i.free);
    if (it) return yield* carryOut(a, w, it, L('act.carryWasteOut'));
  }

  // 有扩建工程时大量投入挖掘，否则只缓慢延长现有隧道
  const D = CONFIG.defense;
  if (w.predators.threatEntrance >= 0 && w.predators.guardsOut < D.maxGuards && w.rng.chance(D.guardProb)) return yield* guard(a, w, true);

  const digP = col.expansion.project ? 0.45 : 0.15;
  const r = w.rng.next();
  if (r < digP) return yield* dig(a, w);
  if (r < digP + 0.25 && !w.clock.isNight) return yield* guard(a, w);
  if (a.crop > 0.6 && w.rng.chance(0.5)) return yield* distributeCrop(a, w);
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
    yield { k: 'wait', time: w.rng.range(3, 5) };
    w.weather.workPlug(job, w);
    a.note(w, L(job.open ? 'note.unplugged' : 'note.plugged', { ent: e.label }));
  } while (job.open === (w.weather.phase === 'clear') && (job.open ? e.plug > 0 : e.plug < 1));
  a.plugging = -1;
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
  yield* deliverWasteInside(a, w);
}

export function* deliverWasteInside(a: Ant, w: World): Routine {
  const col = w.colony;
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
  yield* takeOut(a, w, it, label);
}

/** 把手里的尸体或垃圾搬到巢外垃圾堆；入口全封住时放进垃圾室 */
export function* takeOut(a: Ant, w: World, it: Item, label: Text): Routine {
  const col = w.colony;
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
  yield { k: 'walk', x: m.x + w.rng.range(-1.5, 1.5), z: m.z + w.rng.range(-1.5, 1.5), r: 1.2 };
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
  yield { k: 'wait', time: w.rng.range(3, 6) };
  a.digNode = -1;
  ex.excavate(node);
  if (w.weather.keepIn) {
    a.activity = L('act.packSoilSealed');
    yield { k: 'wait', time: w.rng.range(2, 3) };
    col.stats.soilExcavated++;
    a.note(w, L(project ? 'note.soilWallProject' : 'note.soilWall'));
    return;
  }
  const soil = w.colony.newItem('soil');
  col.pickUp(a, soil);
  col.stats.soilExcavated++;
  yield* dumpSoil(a, w, project);
}

/** 把挖出的土粒搬到巢外蚁丘上；入口全封住时压进隧道壁 */
export function* dumpSoil(a: Ant, w: World, project: boolean): Routine {
  const col = w.colony;
  a.activity = L('act.carrySoil');
  if ((yield { k: 'exit', giveUp: true }) === 'blocked') {
    a.activity = L('act.packSoilBlocked');
    yield { k: 'wait', time: w.rng.range(2, 3) };
    const d = col.release(a);
    if (d) col.destroy(d);
    a.note(w, L('note.soilBlocked'));
    return;
  }
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = w.rng.range(0, TAU);
  yield { k: 'walk', x: ent.x + Math.cos(ang) * 3, z: ent.z + Math.sin(ang) * 3, r: 0.8 };
  const d = col.release(a);
  if (d) col.dropOnMound(d, ent);
  a.note(w, L(project ? 'note.soilProject' : 'note.soilMound'));
  a.activity = L('act.goHome');
  yield { k: 'enter' };
}

/** 入口警戒；threat 为 true 时是因为有狼蛛逼近，去受威胁的那个入口，巡逻范围更大 */
export function* guard(a: Ant, w: World, threat = false): Routine {
  yield* goHome(a);
  a.guarding = threat;
  a.activity = L(threat ? 'act.guardThreat' : 'act.goGuard');
  yield { k: 'exit' };
  const ti = w.predators.threatEntrance;
  const ent = threat && ti >= 0 ? w.nest.entrances[ti] : w.nest.nearestEntrance(a.pos.x, a.pos.z);
  a.activity = L(threat ? 'act.guardingThreat' : 'act.guarding');
  a.note(w, L(threat ? 'note.guardThreat' : 'note.guard', { ent: ent.label }));
  const D = CONFIG.defense;
  if (threat) {
    // 分段巡逻，每段结束看一眼威胁还在不在；狼蛛走了就回巢
    const until = w.clock.seconds + w.rng.range(25, 60);
    do yield { k: 'patrol', x: ent.x, z: ent.z, radius: 7, time: D.guardCheckSec };
    while (w.clock.seconds < until && w.predators.threatEntrance >= 0);
  } else yield { k: 'patrol', x: ent.x, z: ent.z, radius: 4.5, time: w.rng.range(25, 60) };
  a.guarding = false;
  a.activity = L('act.guardEnd');
  yield { k: 'enter' };
}

/** 待命的觅食蚁在巢口附近闲逛 */
export function* loiter(a: Ant, w: World): Routine {
  const LO = CONFIG.loiter;
  a.activity = L('act.loiterOut');
  yield { k: 'exit' };
  const ent = w.nest.nearestEntrance(a.pos.x, a.pos.z);
  const ang = w.rng.range(0, TAU);
  const d = w.rng.range(LO.offset[0], LO.offset[1]);
  a.activity = L(w.rng.chance(0.5) ? 'act.patrolTerritory' : 'act.bask');
  yield { k: 'patrol', x: ent.x + Math.cos(ang) * d, z: ent.z + Math.sin(ang) * d, radius: w.rng.range(LO.radius[0], LO.radius[1]), time: w.rng.range(LO.time[0], LO.time[1]) };
  a.activity = L('act.loiterEnd');
  yield { k: 'enter' };
}

function* patrolNest(a: Ant, w: World): Routine {
  yield* goHome(a);
  const c = w.rng.pick(w.nest.chambers.filter((x) => x.ready && x.type !== 'queen'));
  a.activity = L('act.inspect', { room: c.label });
  yield { k: 'room', chamber: c.id, time: 0.1 };
  a.activity = L('act.cleanRoom', { room: c.label });
  yield { k: 'room', chamber: c.id, time: w.rng.range(8, 20) };
}

/** 觅食蚁的任务：出巢搜索、取食、放牧蚜虫、返巢储存 */
import { CONFIG } from '../../config';
import { L } from '../../../../core/i18n';
import { TAU } from '../../../../core/util/math';
import type { Chamber } from '../../nest/nest';
import { AphidColony } from '../../world/aphids';
import type { FoodSource } from '../../world/food';
import type { World } from '../../world/world';
import type { Ant, Command, Routine } from '../ant';
import { distributeCrop, eat, offerCrop, rest, unloadCrop, wantsToEat } from './common';
import { loiter } from './maintenance';

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
    if (c && w.rng.chance(0.8)) return c;
    if (!c) a.herd = -1;
  }
  if (a.scout || !w.rng.chance(0.3)) return null;
  const known = aph.colonies.filter((c) => c.discovered && tenders(w, c) < 4 + c.count / 8);
  if (!known.length) return null;
  let total = 0;
  for (const c of known) total += c.honeydew + 0.5;
  let r = w.rng.next() * total;
  for (const c of known) {
    r -= c.honeydew + 0.5;
    if (r <= 0) return c;
  }
  return known[known.length - 1];
}

export function* foragerRoutine(a: Ant, w: World): Routine {
  const col = w.colony;
  const now = w.clock.seconds;
  // 储备耗尽时，觅食蚁不会留在巢里挨饿，而是出去在食物源处进食
  if (wantsToEat(a, w) && (col.reserve > 3 || a.crop >= 0.1)) return yield* eat(a, w);
  if (a.domain === 'nest' && a.crop > 0.3 && a.room >= 0 && w.rng.chance(0.5)) return yield* offerCrop(a, w, 3);
  const surfaceT = w.soil.temperatureAt(0);
  const excited = a.excitedUntil > now;
  if (a.domain === 'nest' && ((w.clock.isNight && w.rng.chance(excited ? 0.3 : 0.6)) || surfaceT < 8)) {
    return yield* rest(a, w, L(surfaceT < 8 ? 'act.restCold' : 'act.restNight'));
  }
  // 储备越充足，返巢蚁越难把食物交出去，出巢觅食的积极性随之下降；被同伴激发时则更容易出巢
  const satiation = Math.min(0.9, Math.max(0, (col.reserve - 150) / 200)) * (a.scout ? 0.5 : 1) * (excited ? 0.3 : 1);
  if (a.domain === 'nest' && w.rng.chance(satiation)) {
    if (a.crop > 0.6 && w.rng.chance(0.4)) return yield* distributeCrop(a, w);
    const LO = CONFIG.loiter;
    const calm = !w.clock.isNight && w.weather.damp === 0 && w.predators.threatEntrance < 0 && surfaceT >= LO.minTemp;
    if (calm && w.rng.chance(LO.chance) && w.colony.moundHasRoom(a)) return yield* loiter(a, w);
    return yield* rest(a, w, L('act.restFull'));
  }

  if (a.domain === 'nest' && w.weather.keepIn) {
    const P = w.weather.phase;
    return yield* rest(a, w, L(P === 'rain' ? 'act.restRaining' : P === 'overcast' ? 'act.restOvercast' : 'act.restDrying'));
  }
  // 雨后入口刚清开：侦察蚁先出去，其余觅食蚁随地面变干陆续出巢
  if (a.domain === 'nest' && !a.scout && w.rng.chance(w.weather.damp)) return yield* rest(a, w, L('act.restDamp'));

  if (a.domain === 'nest' && w.predators.threatEntrance >= 0 && w.rng.chance(CONFIG.defense.holdBackProb)) {
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
      w.events.push(L('ev.foundAphids', { who: L(a.scout ? 'role.scout' : 'role.forager'), id: a.id }), { kind: 'plant', id: found.plant.index });
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
    const piece = w.colony.newItem('food');
    piece.foodKind = found.kind;
    col.pickUp(a, piece);
  }
  a.memory = { x: found.x, z: found.z };
  a.layTrail = CONFIG.pheromone.depositFood * (0.5 + found.fraction) * (a.scout ? 1.3 : 1);
  if (isNew) {
    a.note(w, L('note.foundFood', { food: found.info.name }));
    w.events.push(L('ev.foundFood', { who: L(a.scout ? 'role.scout' : 'role.forager'), id: a.id, food: found.info.name }), { kind: 'food', id: found.id });
  } else a.note(w, L('note.tookFood', { food: found.info.name }));

  a.activity = L(found.kind === 'sugar' ? 'act.returnSugar' : 'act.returnFood');
  yield { k: 'enter' };
  a.layTrail = 0;
  a.trips++;
  a.delivered++;
  col.stats.foodCollected++;
  if (found.kind === 'sugar') return yield* unloadCrop(a, w);
  const store = yield* storeCarriedFood(a, w);
  a.activity = L('act.linger');
  yield { k: 'room', chamber: store.id, time: w.rng.range(2, 6) };
}

export function* storeCarriedFood(a: Ant, w: World): Generator<Command, Chamber, unknown> {
  const col = w.colony;
  const store = col.foodChamber();
  a.activity = L('act.storeFood');
  yield { k: 'room', chamber: store.id, time: 0.3, point: col.pileSpot(store, 'food') };
  col.storeFood(a);
  a.note(w, L('note.storedFood'));
  return store;
}

/** 蚜虫放牧：爬上寄主植物，拍打蚜虫收集蜜露；蜜露不多时留下守护蚜虫 */
function* tendAphids(a: Ant, w: World, c: AphidColony, arrived: boolean): Routine {
  const col = w.colony;
  if (a.domain === 'nest') {
    a.activity = L('act.goHerd');
    yield { k: 'exit' };
  }
  if (!arrived) {
    const ang = w.rng.range(0, TAU);
    a.activity = L('act.goPlant');
    yield { k: 'walk', x: c.x + Math.cos(ang) * 1.6, z: c.z + Math.sin(ang) * 1.6, r: 0.6 };
  }
  const guard = c.honeydew < 0.6;
  const ang = Math.atan2(a.pos.z - c.z, a.pos.x - c.x);
  a.activity = L(guard ? 'act.guardAphids' : 'act.milkAphids');
  c.lastTended = w.clock.seconds;
  yield { k: 'climb', x: c.x, z: c.z, angle: ang, r: c.stemRadius, top: w.rng.range(c.bandLo, c.bandHi) - 0.3, stay: guard ? w.rng.range(25, 45) : w.rng.range(6, 10) };
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

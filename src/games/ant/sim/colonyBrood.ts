/** 幼体发育、蛹的房间随温度切换、储食变质、地表物品分解。Colony.update 调用 */
import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { clamp } from '../../../core/util/math';
import type { Chamber } from '../nest/nest';
import type { Colony } from './colony';
import type { Item } from './items';

/** 蛹偏好 24–30°C：比较深层蛹室与石块下的向阳育幼室，温差明显时更换蛹的目标房间 */
export function updateClimate(col: Colony): void {
  const nest = col.w.nest;
  const dry = (c: Chamber) => c.wet < CONFIG.weather.floodedAt;
  const cands = [...nest.chamberOfType('pupa'), ...nest.chamberOfType('solar')].filter(dry);
  if (!cands.length) return;
  const score = (c: Chamber) => {
    const t = col.w.chamberTemperature(c);
    return t <= 30 ? t : 60 - t;
  };
  const cur = nest.chambers[col.pupaChamber];
  const flooded = !dry(cur);
  let best = flooded ? cands[0] : cur;
  let bs = flooded ? -Infinity : score(cur);
  for (const c of cands) {
    const s = score(c);
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  if (best === cur || (!flooded && bs < score(cur) + 1.2)) return;
  col.pupaChamber = best.id;
  for (const arr of col.byChamber) for (const it of arr) if (it.type === 'pupa') it.wantsMove = it.chamber !== best.id;
  const t = col.w.chamberTemperature(best).toFixed(1);
  const ref = { kind: 'chamber', id: best.id } as const;
  if (flooded) col.w.events.push(L('ev.pupaeFlood', { from: cur.label, to: best.label }), ref);
  else col.w.events.push(L(best.type === 'solar' ? 'ev.pupaeUp' : 'ev.pupaeDown', { room: best.label, t }), ref);
}

/** 猎物碎块放久了会变质；种子的油质体吃完后，种子被当作垃圾丢弃 */
export function updateStores(col: Colony, days: number): void {
  let changed = false;
  for (const c of col.w.nest.chamberOfType('food')) {
    const arr = col.byChamber[c.id];
    const rot = c.wet >= CONFIG.weather.floodedAt ? CONFIG.weather.floodSpoil : 1;
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      if (it.type !== 'food') continue;
      it.age += days * rot;
      const limit = it.foodKind === 'prey' ? 2.5 : 1.5;
      if (it.age <= limit || !it.free) continue;
      it.type = 'waste';
      changed = true;
    }
  }
  if (changed) col.refreshFoodStock();
}

export function updateBrood(col: Colony, days: number): void {
  const B = CONFIG.brood;
  for (const arr of col.byChamber)
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      if (!it.isBrood) continue;
      developBrood(col, it, days, B);
    }
  for (const a of col.ants) if (a.carrying?.isBrood) developBrood(col, a.carrying, days, B);
}

function developBrood(col: Colony, it: Item, days: number, B: typeof CONFIG.brood): void {
  if (it.type === 'egg') {
    it.stageAge += days;
    if (it.stageAge >= B.eggDays) {
      it.type = 'larva';
      it.stageAge = 0;
      it.hunger = 0.3;
      it.feeds = 0;
      if (it.place === 'chamber') it.wantsMove = !col.isHome(it, col.w.nest.chambers[it.chamber]);
    }
  } else if (it.type === 'larva') {
    it.hunger += days * 1.3;
    if (it.hunger < 1) it.stageAge += days;
    if (it.stageAge >= B.larvaDays && it.feeds >= B.larvaFeedsNeeded) {
      it.type = 'pupa';
      it.stageAge = 0;
      if (it.place === 'chamber') it.wantsMove = !col.isHome(it, col.w.nest.chambers[it.chamber]);
    } else if (it.hunger > 3.5 && it.place === 'chamber') {
      it.type = 'waste';
      it.wantsMove = false;
      col.w.events.push(L('ev.larvaStarved'), { kind: 'chamber', id: it.chamber }, it.pos);
    }
  } else if (it.type === 'pupa') {
    // 温暖处发育更快
    const t = it.place === 'chamber' ? col.w.chamberTemperature(col.w.nest.chambers[it.chamber]) : 20;
    it.stageAge += days * clamp(0.6 + (t - 16) * 0.05, 0.6, 1.3);
    if (it.stageAge >= B.pupaDays) {
      if (!it.ready) it.ready = true;
      it.readyTime += days;
      if (it.readyTime > 0.5 && it.free && col.ants.length < CONFIG.colony.maxPopulation) col.eclose(it, null);
    }
  }
}

export function updateSurfaceItems(col: Colony, days: number): void {
  for (let i = col.surfaceItems.length - 1; i >= 0; i--) {
    const it = col.surfaceItems[i];
    it.age += days;
    // 地表尸体与垃圾会被分解者逐渐分解
    if (it.place === 'midden' && it.age > 6 && col.w.rng.chance(days * 0.5)) col.destroy(it);
    else if (it.place === 'surface' && it.age > 2 && it.free) col.destroy(it);
  }
}

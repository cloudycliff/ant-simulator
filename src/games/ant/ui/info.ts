import { CONFIG, ROLE_COLORS, ROLE_NAMES, type Role } from '../config';
import { t, tr } from '../../../core/i18n';
import type { InfoPanels } from '../../../core/app/game';
import { bar, cap, esc, hex, when } from '../../../core/ui/html';
import { CHAMBER_INFO } from '../nest/nest';
import { ITEM_NAMES } from '../sim/items';
import type { GameRef } from '../world/entities';
import { FOOD_KIND_NAMES } from '../world/food';
import { PREDATOR_INFO, Spider } from '../world/predators';
import { OBSTACLE_INFO } from '../world/vegetation';
import type { World } from '../world/world';

/** 信息面板：每类对象一个，following 为真时蚂蚁面板的按钮显示“取消跟随” */
export function infoPanels(w: World, following: () => boolean): InfoPanels<GameRef> {
  return {
    ant: (r) => antInfo(w, r.id, following()),
    chamber: (r) => chamberInfo(w, r.id),
    food: (r) => foodInfo(w, r.id),
    entrance: (r) => entranceInfo(w, r.id),
    midden: () => middenInfo(w),
    stone: () => `<h2>${t('info.stone')}</h2><p class="desc">${t('info.stoneDesc')}</p>`,
    plant: (r) => plantInfo(w, r.id),
    placed: (r) => {
      const p = w.veg.placedById(r.id);
      return p
        ? `<h2>${cap(tr(OBSTACLE_INFO[p.kind].name))}<span class="tag next">${t('info.placedTag')}</span></h2>
             <p class="desc">${t(p.kind === 'twig' ? 'info.twigDesc' : 'info.rockDesc')}</p>
             <div class="actions"><button data-a="removePlaced" data-v="${p.id}">${t('tool.remove')}</button></div>`
        : `<h2>${t('info.obstacle')}</h2><p class="desc">${t('info.obstacleGone')}</p>`;
    },
    puddle: (r) => {
      const p = w.water.byId(r.id);
      return p
        ? `<h2>${t('info.puddle')}</h2>
             <p class="desc">${t('info.puddleDesc')}</p>
             <div class="kv"><span>${t('info.radius')}</span><b>${p.r.toFixed(1)} cm</b><span>${t('info.waterLeft')}</span><b>${bar(p.water, '#5f9ccc')}</b></div>`
        : `<h2>${t('info.puddle')}</h2><p class="desc">${t('info.puddleGone')}</p>`;
    },
    predator: (r) => predatorInfo(w, r.id),
  };
}

function predatorInfo(w: World, id: number): string {
  const p = w.predators.byId(id);
  if (!p) return `<h2>${t('info.predator')}</h2><p class="desc">${t('info.predatorGone')}</p>`;
  const info = PREDATOR_INFO[p.kind];
  const tag = p.placed ? `<span class="tag next">${t('info.putTag')}</span>` : '';
  let state: string;
  let extra = '';
  if (p instanceof Spider) {
    state = p.mob > 0 ? t('info.mobbed', { n: p.mob }) : p.state === 'leave' && p.fled ? t('info.fleeing') : t(`spiderState.${p.state}`);
    const D = CONFIG.defense;
    extra = `<span>${t('info.canEat')}</span><b>${t('unit.ants', { n: Math.max(0, CONFIG.predators.spiderMeals - p.meals) })}</b><span>${t('info.harass')}</span><b>${bar(p.harass / D.harassLimit, '#e0604a')}</b>`;
  } else state = p.feedT > 0 ? t('info.antlionFeeding', { n: Math.ceil(p.feedT) }) : t('info.antlionWaiting');
  return `<h2>${cap(tr(info.name))}${tag}</h2>
      <p class="desc">${tr(info.desc)}</p>
      <div class="kv"><span>${t('info.state')}</span><b>${state}</b><span>${t('info.caught')}</span><b>${t('unit.ants', { n: p.caught })}</b>${extra}</div>
      <div class="actions"><button data-a="removePredator" data-v="${p.id}">${t(p instanceof Spider ? 'tool.dismiss' : 'info.fillPit')}</button></div>`;
}

function antInfo(w: World, id: number, following: boolean): string {
  const a = w.colony.antById(id);
  if (!a) return `<h2>${cap(t('role.worker'))} #${id}</h2><p class="desc">${t('info.antDead')}</p>`;
  const isQ = a.role === 'queen';
  const tags = [`<span class="tag" style="background:${hex(ROLE_COLORS[a.role])}">${cap(tr(ROLE_NAMES[a.role]))}</span>`];
  if (a.scout) tags.push(`<span class="tag scout">${cap(t('role.scout'))}</span>`);
  if (a.nextRole) tags.push(`<span class="tag next">${t('info.willBecome', { role: ROLE_NAMES[a.nextRole] })}</span>`);
  let carry = t('unit.none');
  if (a.carrying) {
    const it = a.carrying;
    carry = tr(it.type === 'food' ? FOOD_KIND_NAMES[it.foodKind] : ITEM_NAMES[it.type]);
  }
  const depth = a.domain === 'nest' ? t('info.depth', { n: a.depth(w).toFixed(0) }) : a.climbing ? t('info.onStem') : '';
  const logs = a.log.map((l) => `<li><span>${when(w.clock, l.t)}</span>${esc(tr(l.msg))}</li>`).join('') || `<li>${t('info.noLog')}</li>`;
  const herd = a.herd >= 0 ? w.aphids.byId(a.herd) : undefined;
  return `
      <h2>${cap(t(isQ ? 'role.queen' : 'role.worker'))} #${a.id} ${tags.join('')}</h2>
      <div class="kv">
        <span>${t('info.activity')}</span><b class="act">${esc(tr(a.activity))}</b>
        <span>${t('info.location')}</span><b>${cap(tr(a.locationLabel(w)))}${depth}</b>
        <span>${t('info.antTemp')}</span><b>${w.antTemperature(a).toFixed(1)}°C</b>
        <span>${t('info.age')}</span><b>${isQ ? t('info.queenAge') : t('info.antAge', { age: a.ageDays.toFixed(1), life: a.lifespan.toFixed(0) })}</b>
        <span>${t('info.length')}</span><b>${(a.size * (isQ ? 9 : 4)).toFixed(1)} mm</b>
        <span>${t('info.carry')}</span><b>${carry}</b>
        <span>${t('info.crop')}</span><b>${bar(a.crop, '#f2c25a')} ${Math.round(a.crop * 100)}%</b>
        <span>${t('info.fed')}</span><b>${bar(1 - a.hunger, '#7ee06a')}</b>
        <span>${t('info.health')}</span><b>${bar(a.health, '#5fb8ff')}</b>
        ${isQ ? '' : `<span>${t('info.social')}</span><b>${t('info.socialVal', { c: a.contacts, s: a.shares })}</b>`}
        ${a.role === 'forager' ? `<span>${t('info.delivered')}</span><b>${t('unit.times', { n: a.delivered })}</b>` : ''}
        ${herd ? `<span>${t('info.herd')}</span><b>${t('info.herdVal', { n: Math.round(herd.count) })}</b>` : ''}
      </div>
      <p class="desc">${t(`roleDesc.${a.role}`)}</p>
      <h3>${t('info.recent')}</h3>
      <ul class="log">${logs}</ul>
      <div class="actions">
        <button data-a="follow" class="${following ? 'on' : ''}">${t(following ? 'info.unfollow' : 'info.follow')} <kbd>F</kbd></button>
        <button data-a="flyto">${t('info.flyNear')}</button>
      </div>`;
}

function chamberInfo(w: World, id: number): string {
  const c = w.nest.chambers[id];
  const col = w.colony;
  const temp = w.chamberTemperature(c);
  const stoneBonus = temp - w.soil.temperatureAt(c.depth);
  const h = w.soil.humidityAt(c.depth);
  const counts: Record<Role, number> = { queen: 0, nurse: 0, maintenance: 0, forager: 0 };
  for (const a of col.ants) if (a.room === id) counts[a.role]++;
  const items = col.byChamber[id];
  let egg = 0;
  let larva = 0;
  let hungry = 0;
  let pupa = 0;
  let ready = 0;
  let food = 0;
  let waste = 0;
  let corpse = 0;
  for (const it of items) {
    if (it.type === 'egg') egg++;
    else if (it.type === 'larva') {
      larva++;
      if (it.hunger > 0.6) hungry++;
    } else if (it.type === 'pupa') {
      pupa++;
      if (it.ready) ready++;
    } else if (it.type === 'food') food += it.amount;
    else if (it.type === 'waste') waste++;
    else if (it.type === 'corpse') corpse++;
  }
  const rows: string[] = [];
  if (egg) rows.push(`<span>${t('info.eggs')}</span><b>${egg}</b>`);
  if (larva) rows.push(`<span>${t('info.larvae')}</span><b>${t('info.larvaeVal', { n: larva, h: hungry })}</b>`);
  if (pupa) rows.push(`<span>${t('info.pupae')}</span><b>${t('info.pupaeVal', { n: pupa, r: ready })}</b>`);
  if (food) rows.push(`<span>${t('info.food')}</span><b>${t('unit.portions', { n: food.toFixed(0) })}</b>`);
  if (waste) rows.push(`<span>${t('info.waste')}</span><b>${waste}</b>`);
  if (corpse) rows.push(`<span>${t('info.corpses')}</span><b>${corpse}</b>`);
  if (!rows.length) rows.push(`<span>${t('info.contents')}</span><b>${t('info.empty')}</b>`);
  const antRows = (Object.keys(counts) as Role[])
    .filter((r) => counts[r] > 0)
    .map((r) => `<span><i class="dot" style="background:${hex(ROLE_COLORS[r])}"></i>${cap(tr(ROLE_NAMES[r]))}</span><b>${counts[r]}</b>`)
    .join('');
  const pupaNote =
    c.type === 'pupa' || c.type === 'solar'
      ? `<span>${t('info.pupaTarget')}</span><b>${t(col.pupaChamber === id ? 'info.pupaHere' : 'info.pupaElsewhere')}</b>`
      : '';
  const ep = col.expansion.enlarging() === c ? col.expansion.project! : null;
  const eprog = ep ? Math.min(1, ep.soil / ep.soilNeeded) : 0;
  const building = !c.ready
    ? `<span>${t('info.digProgress')}</span><b>${bar(c.grow, '#d9a066')} ${Math.round(c.grow * 100)}%</b>`
    : ep
      ? `<span>${t('info.enlargeProgress')}</span><b>${bar(eprog, '#d9a066')} ${Math.round(eprog * 100)}%</b>`
      : '';
  return `
      <h2>${cap(tr(c.label))}${!c.ready ? `<span class="tag next">${t('info.building')}</span>` : ep ? `<span class="tag next">${t('info.enlarging')}</span>` : ''}</h2>
      <p class="desc">${tr(CHAMBER_INFO[c.type].desc)}${c.underStone ? t('info.underStone') : ''}</p>
      <div class="kv">
        ${building}
        <span>${t('info.depthLabel')}</span><b>${c.depth.toFixed(0)} cm</b>
        <span>${t('info.size')}</span><b>${(c.rx * 2 * 0.71).toFixed(0)} × ${(c.rz * 2 * 0.71).toFixed(0)} × ${(c.ry * 1.7).toFixed(0)} cm${c.enlarged ? t('info.enlargedTimes', { n: c.enlarged }) : ''}</b>
        <span>${t('info.temp')}</span><b>${temp.toFixed(1)}°C${stoneBonus > 0.05 ? t('info.stoneBonus', { t: stoneBonus.toFixed(1) }) : ''}</b>
        <span>${t('info.humidity')}</span><b>${Math.round(h)}%</b>
        ${c.wet > 0.02 ? `<span>${t('info.wet')}</span><b>${Math.round(c.wet * 100)}%${c.wet >= CONFIG.weather.floodedAt ? t('info.floodedNote') : ''}</b>` : ''}
        ${pupaNote}
      </div>
      <h3>${t('info.contents')}</h3><div class="kv">${rows.join('')}</div>
      <h3>${t('info.antsInRoom')}</h3><div class="kv">${antRows || `<span>${cap(t('unit.none'))}</span><b></b>`}</div>
      <div class="actions"><button data-a="flyto">${t('info.flyRoom')}</button></div>`;
}

function plantInfo(w: World, id: number): string {
  const ac = w.aphids.byPlant(id);
  if (!ac) {
    return `<h2>${t('info.plant')}</h2><p class="desc">${t('info.plantDesc')}</p>`;
  }
  const now = w.clock.seconds;
  let onPlant = 0;
  let herders = 0;
  for (const a of w.colony.ants) {
    if (a.herd === ac.id) herders++;
    if (a.climbing && Math.hypot(a.pos.x - ac.x, a.pos.z - ac.z) < 1) onPlant++;
  }
  return `
      <h2>${t('info.aphids')}<span class="tag" style="background:#9bd04a">${t('info.hostPlant')}</span></h2>
      <p class="desc">${t('info.aphidDesc')}</p>
      <div class="kv">
        <span>${t('info.aphidCount')}</span><b>${t('info.aboutN', { n: Math.round(ac.count) })}</b>
        <span>${t('info.honeydew')}</span><b>${bar(ac.honeydew / 6, '#f2c25a')} ${t('unit.portions', { n: ac.honeydew.toFixed(1) })}</b>
        <span>${t('info.state')}</span><b>${t(!ac.discovered ? 'info.undiscovered' : ac.tended(now) ? 'info.tended' : 'info.untended')}</b>
        <span>${t('info.onPlant')}</span><b>${onPlant}</b>
        <span>${t('info.herders')}</span><b>${t('unit.ants', { n: herders })}</b>
        <span>${t('info.collected')}</span><b>${t('unit.portions', { n: ac.collected.toFixed(1) })}</b>
        <span>${t('info.distance')}</span><b>${Math.hypot(ac.x, ac.z).toFixed(0)} cm</b>
      </div>
      <div class="actions"><button data-a="flyto">${t('info.flyNear')}</button></div>`;
}

function foodInfo(w: World, id: number): string {
  const f = w.food.byId(id);
  if (!f) return `<h2>${t('info.foodSource')}</h2><p class="desc">${t('info.foodGone')}</p>`;
  let near = 0;
  for (const a of w.colony.ants) if (a.domain === 'surface' && Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.radius + 3) near++;
  const dist = Math.hypot(f.x, f.z);
  return `
      <h2>${cap(tr(f.info.name))}${f.placed ? `<span class="tag next">${t('info.droppedTag')}</span>` : ''}</h2>
      <p class="desc">${tr(f.info.desc)}</p>
      <div class="kv">
        <span>${t('info.foodType')}</span><b>${cap(tr(FOOD_KIND_NAMES[f.kind]))}</b>
        <span>${t('info.left')}</span><b>${t('info.leftVal', { a: f.amount.toFixed(0), b: f.initial })} ${bar(f.fraction, '#e0a030')}</b>
        <span>${t('info.distance')}</span><b>${dist.toFixed(0)} cm</b>
        <span>${t('info.state')}</span><b>${t(f.discovered ? 'info.discovered' : 'info.notDiscovered')}</b>
        <span>${t('info.nearAnts')}</span><b>${near}</b>
        <span>${t('info.taken')}</span><b>${t('unit.portions', { n: f.takenTotal })}</b>
      </div>
      <div class="actions"><button data-a="flyto">${t('info.flyNear')}</button></div>`;
}

function entranceInfo(w: World, id: number): string {
  const e = w.nest.entrances[id];
  let near = 0;
  for (const a of w.colony.ants) if (a.domain === 'surface' && Math.hypot(a.pos.x - e.x, a.pos.z - e.z) < 6) near++;
  let soil = 0;
  for (const it of w.colony.surfaceItems) if (it.place === 'mound') soil++;
  return `
      <h2>${t('info.entranceTitle', { ent: e.label })}</h2>
      <p class="desc">${t('info.entranceDesc')}</p>
      <div class="kv">
        <span>${t('info.state')}</span><b>${e.plug >= 1 ? t('info.sealed') : e.plug > 0 ? t('info.sealing', { n: Math.round(e.plug * 100) }) : t('info.open')}</b>
        <span>${t('info.nearEntrance')}</span><b>${near}</b>
        <span>${t('info.moundSoil')}</span><b>${soil}</b>
        <span>${t('info.soilTotal')}</span><b>${w.colony.stats.soilExcavated}</b>
      </div>
      <div class="actions"><button data-a="flyto">${t('info.flyEntrance')}</button></div>`;
}

function middenInfo(w: World): string {
  let waste = 0;
  let corpse = 0;
  for (const it of w.colony.surfaceItems)
    if (it.place === 'midden') {
      if (it.type === 'corpse') corpse++;
      else waste++;
    }
  return `
      <h2>${t('info.midden')}</h2>
      <p class="desc">${t('info.middenDesc')}</p>
      <div class="kv">
        <span>${t('info.waste')}</span><b>${waste}</b>
        <span>${t('info.corpses')}</span><b>${corpse}</b>
        <span>${t('info.removedTotal')}</span><b>${w.colony.stats.wasteRemoved}</b>
      </div>
      <div class="actions"><button data-a="flyto">${t('info.flyNear')}</button></div>`;
}

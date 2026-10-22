import { ROLE_COLORS, ROLE_NAMES, type Role } from '../config';
import { t, tr } from '../../../core/i18n';
import type { GameUi } from '../../../core/app/game';
import { svgIcon } from '../../../core/app/shell';
import { drawChart } from '../../../core/ui/chart';
import { bar, cap, hex } from '../../../core/ui/html';
import { CHAMBER_INFO } from '../nest/nest';
import type { ColonySample } from '../sim/colony';
import type { GameRef } from '../world/entities';
import type { World } from '../world/world';
import { infoPanels } from './info';

export const ICON = {
  colony: svgIcon('<circle cx="10" cy="4.5" r="2"/><ellipse cx="10" cy="9.5" rx="1.8" ry="2.2"/><ellipse cx="10" cy="15" rx="2.8" ry="3.2"/><path d="M8.2 9 4 7M11.8 9 16 7M8.2 10.5 4 12M11.8 10.5 16 12M8 14 4.5 17M12 14l3.5 3"/>'),
  xray: svgIcon('<path d="M10 3 2.5 7 10 11l7.5-4z"/><path d="m2.5 10.5 7.5 4 7.5-4"/><path d="m2.5 14 7.5 4 7.5-4"/>'),
};

/** 蚂蚁游戏的面板内容；pheromone 为真时显示信息素图例 */
export function antUi(w: World, opts: { following: () => boolean; pheromone: () => boolean }): GameUi<GameRef> {
  let drawn = -1;
  return {
    status: (compact) => {
      const c = w.clock;
      const wp = w.weather.phase;
      return {
        icon: wp === 'rain' ? '🌧️' : wp === 'overcast' ? '☁️' : c.isNight ? '🌙' : c.daylight < 0.6 ? '🌅' : '☀️',
        text: t(compact ? 'ui.tempShort' : 'ui.temp', { weather: w.weather.label, t: w.soil.temperatureAt(0).toFixed(1), h: Math.round(w.soil.humidityAt(0)) }),
      };
    },
    perfExtra: () => t('ui.perfCount', { n: w.colony.ants.length }),
    panel: { icon: ICON.colony, label: () => t('dock.colony'), html: (folded) => colonyPanel(w, folded) },
    infoHint: () => t('info.hint'),
    info: infoPanels(w, opts.following),
    stats: {
      html: `
      <canvas id="chart-pop"></canvas>
      <canvas id="chart-food"></canvas>`,
      draw: (force) => {
        const h = w.colony.history;
        if (!force && h.length === drawn) return;
        drawn = h.length;
        drawStats(h);
      },
    },
    legend: {
      html: () => `
      <div><i style="background:linear-gradient(90deg,#ff7a2a,#fff07a)"></i>${t('legend.trail')}</div>
      <div><i style="background:#3c96ff"></i>${t('legend.home')}</div>
      <div><i style="background:transparent;border:2px solid #ff4a3a;height:4px"></i>${t('legend.alarm')}</div>`,
      visible: opts.pheromone,
    },
    help: {
      mouse: ['help.move', 'help.mouse', 'help.click', 'help.events', 'help.follow', 'help.views', 'help.tools'],
      touch: ['help.touchMove', 'help.touchTap', 'help.events', 'help.touchTools'],
    },
  };
}

function drawStats(h: ColonySample[]): void {
  const days = h.map((x) => x.day);
  const pick = (k: keyof ColonySample) => h.map((x) => x[k]);
  const role = (r: Role) => cap(tr(ROLE_NAMES[r]));
  drawChart(document.getElementById('chart-pop') as HTMLCanvasElement, t('chart.pop'), days, [
    { label: role('nurse'), color: hex(ROLE_COLORS.nurse), values: pick('nurse') },
    { label: role('maintenance'), color: hex(ROLE_COLORS.maintenance), values: pick('maintenance') },
    { label: role('forager'), color: hex(ROLE_COLORS.forager), values: pick('forager') },
    { label: t('chart.brood'), color: '#f3ead0', values: pick('brood'), dash: true },
    { label: t('chart.outside'), color: '#9d9484', values: pick('outside'), dash: true },
  ]);
  drawChart(document.getElementById('chart-food') as HTMLCanvasElement, t('chart.food'), days, [
    { label: cap(t('chamber.food')), color: '#c0703a', values: pick('food') },
    { label: t('chart.social'), color: '#f2c25a', values: pick('liquid') },
    { label: t('chart.total'), color: '#e9e4da', values: h.map((x) => x.food + x.liquid), dash: true },
  ]);
}

function colonyPanel(w: World, folded: boolean): string {
  const col = w.colony;
  const rc = col.roleCounts();
  const bc = col.broodCounts();
  const tg = col.targets;
  let scouts = 0;
  for (const a of col.ants) if (a.scout) scouts++;
  const st = col.stats;
  const roleRow = (r: Role) => {
    const target = r === 'queen' ? '' : ` <small>/ ${tg[r]}</small>`;
    return `<div class="row"><span class="dot" style="background:${hex(ROLE_COLORS[r])}"></span>${cap(tr(ROLE_NAMES[r]))}<b>${rc[r]}${target}</b></div>`;
  };
  const aph = w.aphids.colonies;
  const known = aph.filter((a) => a.discovered).length;
  const ex = col.expansion;
  const p = ex.project;
  let build = `<div class="row sub">${t('col.build')}<b>${cap(t('unit.none'))}</b></div>`;
  if (p) {
    const prog = p.chamber ? p.soil / p.soilNeeded : p.face.len / p.face.full.length;
    build = `<div class="row sub">${t(p.enlarge ? 'col.enlarge' : 'col.build')}<b>${cap(tr(p.enlarge ? p.chamber!.label : CHAMBER_INFO[p.type].name))}</b></div>
      <div class="row sub">${t(p.enlarge ? 'col.digEdge' : p.chamber ? 'col.digRoom' : 'col.digTunnel')} ${bar(prog, '#d9a066')}</div>`;
  }
  const pupaRoom = w.nest.chambers[col.pupaChamber];
  const stat = (k: Parameters<typeof t>[0], v: string | number) => `<span>${t(k)}</span><b>${v}</b>`;
  return `
      <h3 class="fold" title="${t(folded ? 'col.unfold' : 'col.fold')}">${t('col.title')}</h3>
      <div class="row big">${t('col.adults')}<b>${col.ants.length}</b></div>
      ${roleRow('queen')}${roleRow('nurse')}${roleRow('maintenance')}${roleRow('forager')}
      <div class="row sub">${t('col.scouts')}<b>${scouts}</b></div>
      <div class="row sub">${t('col.targetsNote')}</div>
      <div class="row">${t('col.outside')}<b>${col.outsideCount()}</b></div>
      <h3>${t('col.brood')}</h3>
      <div class="row">${t('col.broodCounts')}<b>${bc.egg} / ${bc.larva} / ${bc.pupa}</b></div>
      <div class="row sub">${t('col.pupaeAt')}<b>${pupaRoom ? cap(tr(pupaRoom.label)) : '-'}</b></div>
      <h3>${t('col.resources')}</h3>
      <div class="row">${cap(t('chamber.food'))}<b>${t('unit.portions', { n: col.foodStock.toFixed(0) })}</b></div>
      <div class="row">${t('col.social')}<b>${t('unit.portions', { n: col.liquidStock.toFixed(0) })}</b></div>
      <div class="row">${t('col.queenFed')} ${bar(1 - col.queen.hunger, '#ffb13b')}</div>
      <div class="row">${t('col.foodSources')}<b>${w.food.sources.length}</b></div>
      <div class="row">${t('col.aphids')}<b>${known} / ${aph.length}</b></div>
      <h3>${t('col.nest')}</h3>
      <div class="row">${t('col.rooms')}<b>${w.nest.chambers.filter((c) => c.ready).length}${ex.enlarged ? ` <small>${t('col.enlargedTimes', { n: ex.enlarged })}</small>` : ''}</b></div>
      <div class="row">${t('col.crowding')} ${bar(ex.occupancy(), ex.occupancy() > 0.88 ? '#e0803a' : '#7ec06a')}</div>
      ${build}
      <h3>${t('col.totals')}</h3>
      <div class="grid">
        ${stat('stat.eggs', st.eggsLaid)}${stat('stat.emerged', st.emerged)}
        ${stat('stat.deaths', st.deaths)}${stat('stat.food', st.foodCollected)}
        ${stat('stat.honeydew', st.honeydew.toFixed(0))}${stat('stat.troph', st.trophallaxis)}
        ${stat('stat.waste', st.wasteRemoved)}${stat('stat.soil', st.soilExcavated)}
        ${stat('stat.roles', st.roleChanges)}${stat('stat.contacts', st.contacts >= 10000 ? (st.contacts / 1000).toFixed(0) + 'k' : st.contacts)}
        ${stat('stat.preyed', st.preyed)}${stat('stat.repelled', st.repelled)}
      </div>`;
}

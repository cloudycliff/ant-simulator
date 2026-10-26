import * as THREE from 'three';
import { t } from '../../core/i18n';
import type { CameraPose, GameContext, GameModule, GameSession, GameUi, ViewToggle } from '../../core/app/game';
import { svgIcon } from '../../core/app/shell';
import { HeightfieldSpace } from '../../core/space/heightfield';
import { CONFIG } from './config';
import { BeeView } from './view';
import { CASTE, CASTE_KEYS, ROLE_KEYS, roleOf } from './sim/bees';
import { CELL, COMB_H, CONTENT_KEYS, GRID, cellFace, cellSite, siteFrame } from './sim/comb';
import { nectarCap, openness, plantCount, pollenCap } from './sim/flowers';
import { BeeWorld, beeSave, type BeeRef, type BeeSaveData, type BeeSaveMeta } from './world';

const H = CONFIG.hive;
const G = CONFIG.garden;

/** 正对着玻璃稍偏右，退到蜂箱的宽度装得下为止（竖屏手机退得远些） */
function openingPose(aspect: number): CameraPose {
  const halfFov = Math.atan(Math.tan((50 * Math.PI) / 360) * aspect);
  const dist = Math.max(90, (H.combW / 2 + 14) / Math.tan(halfFov));
  const cy = H.baseY + COMB_H / 2;
  return [dist * 0.25, cy + 10, dist, 0, cy, 0];
}

/** 观察箱（含架子和顶棚）的范围，相机贴近它时按离它多远定快慢 */
const HIVE_BOX = new THREE.Box3(new THREE.Vector3(-30, 0, -13), new THREE.Vector3(30, H.baseY + COMB_H + 20, 13));

export const beeGame: GameModule<BeeWorld, BeeRef, BeeSaveData, BeeSaveMeta> = {
  title: () => t('app.title'),
  subtitle: () => t('app.subtitle'),
  loading: () => t('app.loading'),
  repoUrl: 'https://github.com/cloudycliff/ant-simulator',
  camera: {
    fov: 50,
    near: 0.1,
    far: CONFIG.garden.horizon + 4000,
    pose: openingPose,
    // 巢里按真实大小（1 cm 的蜂），花园 60 m 见方，快慢的范围比蚂蚁宽得多
    tuning: {
      clearance: (p) => Math.max(0.5, Math.min(p.y, HIVE_BOX.distanceToPoint(p))),
      speed: [3, 800],
      wheel: [0.3, 300],
      reach: [3, 3000],
      follow: [2, 400],
      followStart: [4, 30],
      followRate: 30,
    },
  },
  create: (seed) => new BeeWorld(seed),
  save: { ...beeSave, describe: (m) => t('save.what', { n: m.bees ?? 0 }) },
  space: (w) => new HeightfieldSpace((x, z) => w.groundAt(x, z), G.size, new THREE.Box3(new THREE.Vector3(-G.size / 2 + 200, 1, -G.size / 2 + 200), new THREE.Vector3(G.size / 2 - 200, 1500, G.size / 2 - 200))),
  mount,
};

const ICON = svgIcon('<path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z"/><path d="M10 7.5l2.2 1.25v2.5L10 12.5l-2.2-1.25v-2.5z"/>');

function mount(ctx: GameContext<BeeWorld, BeeRef>): GameSession<BeeRef> {
  const { world: w, scene, camera, dom } = ctx;
  const view = new BeeView(w, scene);
  const views: ViewToggle[] = [
    { id: 'glass', label: () => t('ui.glass'), key: 'G', on: () => view.glass, toggle: () => (view.glass = !view.glass) },
    { id: 'fade', label: () => t('ui.fade'), key: 'B', on: () => view.bees.fade, toggle: () => (view.bees.fade = !view.bees.fade) },
  ];
  return {
    shadowLight: view.env.sun,
    views,
    tools: null,
    pick: (x, y, tol) => pick(view, camera, dom, x, y, tol),
    syncViews: () => view.syncViews(),
    update: (_dt, f) => view.update(camera, dom.clientHeight, f.focus, f.following, f.selection),
    ui: beeUi(w, ctx.following),
  };
}

const ray = new THREE.Raycaster();

/** 蜂按屏幕距离优先；淡化蜂时巢房优先，点不到巢房才选蜂（P-009） */
function pick(view: BeeView, camera: THREE.PerspectiveCamera, dom: HTMLElement, x: number, y: number, tol = 16): BeeRef | null {
  const rect = dom.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(view.pickables, false)[0];
  const cell = view.comb.pick(ray.ray);
  const bee = view.bees.pick(camera, rect.width, rect.height, x - rect.left, y - rect.top, tol);
  const front = cell && (!hit || cell.dist < hit.distance) ? cell.dist : (hit?.distance ?? Infinity);
  if (bee && !(view.bees.fade && cell) && bee.dist < front + 2) return { kind: 'bee', id: bee.id };
  if (cell && (!hit || cell.dist < hit.distance)) return { kind: 'cell', id: cell.cell };
  return (hit?.object.userData.ref as BeeRef | undefined) ?? null;
}

/** 模拟秒数折成游戏里的时长 */
function span(seconds: number): string {
  const h = Math.max(1, Math.round((seconds / CONFIG.clock.dayLength) * 24));
  return h < 24 ? t('info.hours', { h }) : t('info.days', { d: Math.floor(h / 24), h: h % 24 });
}

function cellInfo(w: BeeWorld, cell: number): string {
  const cb = w.comb;
  const site = cellSite(cell);
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const local = site % (GRID.rows * GRID.cols);
  const where = t('info.whereValue', {
    frame: t(siteFrame(site) ? 'info.upper' : 'info.lower'),
    face: t(cellFace(cell) ? 'info.back' : 'info.front'),
    row: GRID.rows - Math.floor(local / GRID.cols),
    col: (local % GRID.cols) + 1,
  });
  const drone = cb.drone[site] === 1;
  let body = kv(t('info.where'), where) + kv(t('info.caste'), t(drone ? 'info.drone' : 'info.worker'));
  let key: (typeof CONTENT_KEYS)[number] | 'building';
  if (cb.build[site] < 1) {
    key = 'building';
    body += kv(t('info.built'), t('info.percent', { p: Math.round(cb.build[site] * 100) }));
  } else {
    const c = cb.content[cell];
    key = CONTENT_KEYS[c];
    const T = drone ? CONFIG.brood.drone : CONFIG.brood.worker;
    const a = cb.age[cell];
    if (c === CELL.egg) body += kv(t('info.hatch'), t('info.inTime', { t: span(T.egg - a) }));
    else if (c === CELL.larva) body += kv(t('info.seal'), t('info.inTime', { t: span(T.egg + T.larva - a) }));
    else if (c === CELL.capped) body += kv(t('info.emerge'), t('info.inTime', { t: span(T.egg + T.larva + T.capped - a) }));
    else if (c !== CELL.empty) body += kv(t('info.amount'), t('info.percent', { p: Math.round(cb.amount[cell] * 100) }));
  }
  return `<h2>${t('info.cell')} · ${t(`cell.${key}`)}</h2>${body}<p class="desc">${t(`cellDesc.${key}`)}</p>`;
}

/** 7.5 → 7:30 */
const clockTime = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function flowerInfo(w: BeeWorld, id: number): string {
  const p = w.flowers.get(id);
  if (!p) return '';
  const sp = CONFIG.flowers.species[p.species];
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const k = openness(sp, w.clock.hour);
  const rising = openness(sp, w.clock.hour + 0.1) > k;
  const now = k >= 1 ? 'info.open' : k <= 0 ? 'info.closed' : rising ? 'info.opening' : 'info.closing';
  const pct = (v: number, cap: number) => (cap > 0 ? t('info.percent', { p: Math.round((v / cap) * 100) }) : t('info.none'));
  return `<h2>${t('info.flower')} · ${t(`flower.${sp.key}`)}</h2>
    ${kv(t('info.plants'), t('info.plantsValue', { n: plantCount(p) }))}
    ${kv(t('info.openHours'), t('info.hoursValue', { a: clockTime(sp.hours[0]), b: clockTime(sp.hours[1]) }))}
    ${kv(t('info.now'), t(now))}
    ${kv(t('info.nectar'), pct(p.nectar, nectarCap(p)))}
    ${kv(t('info.pollen'), pct(p.pollen, pollenCap(p)))}
    <p class="desc">${t(`flowerDesc.${sp.key}`)}</p>`;
}

function beeInfo(w: BeeWorld, id: number, following: boolean): string {
  const b = w.bees.get(id);
  if (!b) return `<h2>${t('info.gone')}</h2>`;
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const role = roleOf(b);
  const title = t(`caste.${CASTE_KEYS[b.caste]}`) + (role ? ` · ${t(`role.${role}`)}` : '');
  let body = kv(t('info.beeAge'), span(b.age));
  if (b.caste !== CASTE.queen) body += kv(t('info.lifeLeft'), span(b.life - b.age));
  body += kv(t('info.doing'), t(`act.${b.act}`));
  if (b.caste !== CASTE.queen) body += kv(t('info.crop'), t('info.percent', { p: Math.round(b.crop * 100) }));
  if (role === 'nurse') body += kv(t('info.jelly'), t('info.jellyValue', { n: Math.max(0, Math.floor(b.jelly)) }));
  return `<h2>${title}</h2>${body}<p class="desc">${t(`beeDesc.${role ?? (b.caste === CASTE.drone ? 'drone' : 'queen')}`)}</p>
    <div class="actions">
      <button data-a="follow" class="${following ? 'on' : ''}">${t(following ? 'info.unfollow' : 'info.follow')} <kbd>F</kbd></button>
      <button data-a="flyto">${t('info.flyNear')}</button>
    </div>`;
}

function beeUi(w: BeeWorld, following: () => boolean): GameUi<BeeRef> {
  const row = (label: string, value: string) => `<div class="row">${label}<b>${value}</b></div>`;
  return {
    status: () => ({ icon: w.clock.isNight ? '🌙' : '☀️', text: t(w.clock.isNight ? 'ui.statusNight' : 'ui.status') }),
    perfExtra: () => '',
    panel: {
      icon: ICON,
      label: () => t('dock.colony'),
      html: (folded) => {
        const c = w.comb.census();
        const n = c.counts;
        const B = w.bees;
        const roles = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as Record<(typeof ROLE_KEYS)[number], number>;
        let drones = 0;
        for (const b of B.list) {
          const r = roleOf(b);
          if (r) roles[r]++;
          else if (b.caste === CASTE.drone) drones++;
        }
        return `
      <h3 class="fold" title="${t(folded ? 'colony.unfold' : 'colony.fold')}">${t('colony.title')}</h3>
      ${row(t('colony.season'), t('colony.summer'))}
      ${row(t('colony.bees'), t('colony.beesValue', { n: B.list.length, d: drones }))}
      ${ROLE_KEYS.map((k) => `<div class="row sub">${t(`role.${k}`)}<b>${roles[k]}</b></div>`).join('')}
      ${row(t('colony.cells'), t('colony.cellsValue', { n: c.built * 2, b: c.building * 2 }))}
      ${row(t('colony.brood'), t('colony.broodValue', { e: n.egg, l: n.larva, c: n.capped }))}
      ${row(t('colony.honey'), t('colony.fullCells', { n: Math.round(c.honeyCells) }))}
      ${row(t('colony.pollen'), t('colony.fullCells', { n: Math.round(c.pollenCells) }))}
      ${row(t('colony.since'), t('colony.sinceValue', { b: B.births, d: B.deaths, l: B.laid }))}
      ${B.starved ? row(t('colony.starved'), String(B.starved)) : ''}
      ${row(t('colony.flowers'), t('colony.flowersValue', { n: w.flowers.patches.length, o: w.flowers.patches.filter((p) => openness(CONFIG.flowers.species[p.species], w.clock.hour) > 0).length }))}
      <p class="desc">${t('colony.todo')}</p>`;
      },
    },
    infoHint: () => t('info.hint'),
    info: {
      hive: () => `<h2>${t('info.hive')}</h2>
      <div class="kv"><span>${t('info.size')}</span><b>${t('info.sizeValue', { w: H.combW, h: H.frameH })}</b></div>
      <p class="desc">${t('info.hiveDesc')}</p>`,
      cell: (r) => cellInfo(w, r.id),
      flower: (r) => flowerInfo(w, r.id),
      bee: (r) => beeInfo(w, r.id, following()),
    },
    help: {
      mouse: ['help.move', 'help.mouse', 'help.click', 'help.follow', 'help.views'],
      touch: ['help.touchMove', 'help.touchTap'],
    },
  };
}

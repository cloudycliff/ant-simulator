import * as THREE from 'three';
import { L, t, tr } from '../../core/i18n';
import type { CameraPose, GameContext, GameModule, GameSession, GameUi, ViewToggle } from '../../core/app/game';
import { svgIcon } from '../../core/app/shell';
import { HeightfieldSpace } from '../../core/space/heightfield';
import { ToolController, type ToolDef } from '../../core/ui/tools';
import { wrapAngle } from '../../core/util/math';
import { CONFIG } from './config';
import { BeeView, HIVE_BOX } from './view';
import { HEAT_COLORS, MAP_COLORS, MAP_KEYS, ROLE_COLORS } from './palette';
import { CASTE, CASTE_KEYS, ROLE_KEYS, ageRoleOf, roleOf, type Bee } from './sim/bees';
import { MOUTH } from './sim/flight';
import { CELL, COMB_H, CONTENT_KEYS, GRID, SITES, cellFace, cellSite, siteFrame } from './sim/comb';
import { SITE_HEAT } from './sim/heat';
import { SUGAR, nectarCap, openness, patchOpenness, plantCount, pollenCap } from './sim/flowers';
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
      followRate: 60,
    },
  },
  create: (seed) => new BeeWorld(seed),
  save: { ...beeSave, describe: (m) => t('save.what', { n: m.bees ?? 0 }) },
  space: (w) => new HeightfieldSpace((x, z) => w.groundAt(x, z), G.size, new THREE.Box3(new THREE.Vector3(-G.size / 2 + 200, 1, -G.size / 2 + 200), new THREE.Vector3(G.size / 2 - 200, 1500, G.size / 2 - 200))),
  mount,
};

type ToolKind = 'plant' | 'sugar' | 'swatter' | 'plate';
/** 种花的选项：开局会长的几种花 */
const PLANTABLE = CONFIG.flowers.species.map((_, i) => i).filter((i) => CONFIG.flowers.species[i].wild);
const TOOLS: ToolDef<ToolKind>[] = [
  {
    kind: 'plant',
    name: L('tool.plant'),
    key: '6',
    hint: L('tool.plantHint'),
    options: PLANTABLE.map((i) => ({ label: L(`flower.${CONFIG.flowers.species[i].key}`), radius: CONFIG.flowers.species[i].plantR })),
  },
  { kind: 'sugar', name: L('tool.sugar'), key: '7', hint: L('tool.sugarHint'), options: [{ label: L('tool.dish'), radius: CONFIG.flowers.species[SUGAR].plantR + 4 }] },
  { kind: 'swatter', name: L('tool.swatter'), key: '8', hint: L('tool.swatterHint'), options: [{ label: L('tool.swatter'), radius: 6 }] },
  { kind: 'plate', name: L('tool.plate'), key: '9', hint: L('tool.plateHint'), options: [{ label: L('tool.plate'), radius: 6 }] },
];

const ICON = svgIcon('<path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z"/><path d="M10 7.5l2.2 1.25v2.5L10 12.5l-2.2-1.25v-2.5z"/>');

function mount(ctx: GameContext<BeeWorld, BeeRef>): GameSession<BeeRef> {
  const { world: w, scene, camera, dom } = ctx;
  const view = new BeeView(w, scene);
  const tools = new ToolController<ToolKind>(TOOLS, {
    run: (def, option, p, _yaw, dry) => {
      if (def.kind === 'plant') return w.plant(PLANTABLE[option], p.x, p.z, dry);
      if (def.kind === 'sugar') return w.feed(p.x, p.z, dry);
      if (def.kind === 'plate') return dry ? { ok: true } : w.togglePlate();
      const h = hornetOnRay(w, camera.position, p);
      if (h < 0) return { ok: false, msg: L('tool.noHornet') };
      return w.hornets.swat(h, dry) ? { ok: true } : { ok: false, msg: L('tool.noHornet') };
    },
  });
  const views: ViewToggle[] = [
    { id: 'glass', label: () => t('ui.glass'), key: 'G', on: () => view.glass, toggle: () => (view.glass = !view.glass) },
    { id: 'fade', label: () => t('ui.fade'), key: 'B', on: () => view.bees.fade, toggle: () => (view.bees.fade = !view.bees.fade) },
    { id: 'dance', label: () => t('ui.dance'), key: 'V', on: () => view.dance.on, toggle: () => (view.dance.on = !view.dance.on) },
    { id: 'roles', label: () => t('ui.roles'), key: 'T', on: () => view.bees.roles, toggle: () => (view.bees.roles = !view.bees.roles) },
    { id: 'cells', label: () => t('ui.cells'), key: 'C', on: () => view.comb.contentMap, toggle: () => (view.comb.contentMap = !view.comb.contentMap) },
    { id: 'heat', label: () => t('ui.heat'), key: 'K', on: () => view.heat.on, toggle: () => (view.heat.on = !view.heat.on) },
  ];
  return {
    shadowLight: view.env.sun,
    views,
    tools,
    pick: (x, y, tol) => pick(view, camera, dom, x, y, tol),
    action: (a, v) => {
      if (a === 'swat') w.hornets.swat(v ?? -1);
      else if (a === 'plate') ctx.toast(tr(w.togglePlate().msg!));
      else if (a === 'harvest') ctx.toast(tr(w.harvest(v ?? -1).msg!));
      else if (a === 'swapAsk') swapAsk = v ?? null;
      else if (a === 'swapNo') swapAsk = null;
      else if (a === 'swap' && swapAsk !== null) {
        ctx.toast(tr(w.swapFrame(swapAsk).msg!));
        swapAsk = null;
      } else return false;
      return true;
    },
    // ?run=秒数：先往前跑一段（截图用，比如等采集蜂飞出去）；?rain=1 马上下雨
    applyParams: (params) => {
      if (params.get('rain')) w.weather.startRain(true);
      // ?hornet=只数：马上来几只胡蜂；?plate=1 装上防护片
      if (params.get('plate')) w.hornets.plate = true;
      w.hornets.spawn(Math.min(5, Number(params.get('hornet')) || 0));
      const secs = Math.min(600, Number(params.get('run')) || 0);
      for (let s = 0; s < secs; s += 1) w.advance(1, Infinity, Infinity);
    },
    syncViews: () => view.syncViews(),
    update: (dt, f) => view.update(dt, camera, dom.clientHeight, f.focus, f.following, f.selection),
    ui: beeUi(w, view, ctx.following),
  };
}

const ray = new THREE.Raycaster();
const _hp = new THREE.Vector3();
const _seg = new THREE.Ray();
/** 蜂箱面板里等着确认要换的框（0 下框、1 上框） */
let swapAsk: number | null = null;

/** 从相机到地面上那一点的视线最近的胡蜂（离视线不到 3 cm 或相机距离的 2.5%）；没有是 -1 */
function hornetOnRay(w: BeeWorld, cam: THREE.Vector3, p: THREE.Vector3): number {
  _seg.origin.copy(cam);
  _seg.direction.copy(p).sub(cam).normalize();
  let best = -1;
  let bestD = Infinity;
  for (const h of w.hornets.list) {
    if (h.state === 'away' || h.state === 'dead' || !w.hornetPos(h.id, _hp)) continue;
    const d = Math.sqrt(_seg.distanceSqToPoint(_hp));
    if (d < Math.max(3, cam.distanceTo(_hp) * 0.025) && d < bestD) {
      bestD = d;
      best = h.id;
    }
  }
  return best;
}

/** 蜂按屏幕距离优先；淡化蜂时巢房优先，点不到巢房才选蜂（P-009） */
function pick(view: BeeView, camera: THREE.PerspectiveCamera, dom: HTMLElement, x: number, y: number, tol = 16): BeeRef | null {
  const rect = dom.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(view.pickables, false)[0];
  const cell = view.comb.pick(ray.ray);
  const bee = view.bees.pick(camera, rect.width, rect.height, x - rect.left, y - rect.top, tol);
  const hornet = view.hornets.pick(camera, rect.width, rect.height, x - rect.left, y - rect.top, tol * 1.5);
  if (hornet && (!bee || hornet.dist < bee.dist + 5)) return { kind: 'hornet', id: hornet.id };
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
  body += kv(t('info.temp'), t('info.tempValue', { t: w.heat.temp[SITE_HEAT[site]].toFixed(1) }));
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
  const area = w.keeper.cutArea(cell);
  let honey = 0;
  for (const s of area) for (const k of [s, s + SITES]) if (cb.content[k] >= CELL.nectar && cb.content[k] <= CELL.cappedHoney) honey += cb.amount[k];
  const cut = area.length ? `<div class="actions"><button data-a="harvest" data-v="${cell}">${t('info.harvestHere', { n: Math.round(honey) })}</button></div>` : '';
  return `<h2>${t('info.cell')} · ${t(`cell.${key}`)}</h2>${body}<p class="desc">${t(`cellDesc.${key}`)}</p>${cut}`;
}

/** 7.5 → 7:30 */
const clockTime = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function flowerInfo(w: BeeWorld, id: number): string {
  const p = w.flowers.get(id);
  if (!p) return '';
  const sp = CONFIG.flowers.species[p.species];
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const pct = (v: number, cap: number) => (cap > 0 ? t('info.percent', { p: Math.round((v / cap) * 100) }) : t('info.none'));
  const hours = kv(t(p.species === SUGAR ? 'info.visitHours' : 'info.openHours'), t('info.hoursValue', { a: clockTime(sp.hours[0]), b: clockTime(sp.hours[1]) }));
  if (p.species === SUGAR)
    return `<h2>${t('flower.sugar')}</h2>
    ${kv(t('info.syrup'), pct(p.nectar, nectarCap(p)))}
    ${hours}
    <p class="desc">${t('flowerDesc.sugar')}</p>`;
  const k = openness(sp, w.clock.hour);
  const rising = openness(sp, w.clock.hour + 0.1) > k;
  const now = p.grown < 1 ? 'info.growing' : k >= 1 ? 'info.open' : k <= 0 ? 'info.closed' : rising ? 'info.opening' : 'info.closing';
  return `<h2>${t('info.flower')} · ${t(`flower.${sp.key}`)}</h2>
    ${kv(t('info.plants'), t('info.plantsValue', { n: plantCount(p) }))}
    ${p.grown < 1 ? kv(t('info.grown'), t('info.grownValue', { p: Math.round(p.grown * 100), t: span((1 - p.grown) * CONFIG.tools.grow) })) : ''}
    ${hours}
    ${kv(t('info.now'), t(now))}
    ${kv(t('info.nectar'), pct(p.nectar, nectarCap(p)))}
    ${kv(t('info.pollen'), pct(p.pollen, pollenCap(p)))}
    <p class="desc">${t(`flowerDesc.${sp.key}`)}${p.planted ? ` ${t('info.plantedNote')}` : ''}</p>`;
}

function beeInfo(w: BeeWorld, id: number, following: boolean): string {
  const b = w.bees.get(id);
  if (!b) return `<h2>${t('info.gone')}</h2>`;
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const role = roleOf(b);
  const title = t(`caste.${CASTE_KEYS[b.caste]}`) + (role ? ` · ${t(`role.${role}`)}` : '');
  let body = kv(t('info.beeAge'), span(b.age));
  if (b.caste !== CASTE.queen) body += kv(t('info.lifeLeft'), span(b.life - b.age));
  const byAge = ageRoleOf(b);
  if (role && byAge && byAge !== role) {
    const early = ROLE_KEYS.indexOf(role) > ROLE_KEYS.indexOf(byAge);
    body += kv(t('info.byAge'), t(early ? 'info.byAgeEarly' : 'info.byAgeLate', { role: t(`role.${byAge}`) }));
  }
  body += kv(t('info.doing'), t(`act.${b.act}`));
  if (b.caste !== CASTE.queen) body += kv(t('info.crop'), t('info.percent', { p: Math.round(b.crop * 100) }));
  if (role === 'nurse') body += kv(t('info.jelly'), t('info.jellyValue', { n: Math.max(0, Math.floor(b.jelly)) }));
  if (role === 'forager') {
    const p = b.patch >= 0 ? w.flowers.get(b.patch) : undefined;
    const goods = t(b.goods ? 'info.goodsPollen' : 'info.goodsNectar');
    const where = !p ? t('info.noPatch') : p.species === SUGAR ? t('info.patchSugar') : t('info.patchValue', { flower: t(`flower.${CONFIG.flowers.species[p.species].key}`), goods });
    body += kv(t('info.patch'), where);
    if (b.load > 0) body += kv(t('info.load'), `${goods} ${t('info.percent', { p: Math.round(b.load * 100) })}`);
  }
  if (role === 'house' && b.load > 0) body += kv(t('info.load'), `${t('info.goodsNectar')} ${t('info.percent', { p: Math.round(b.load * 100) })}`);
  body += danceRows(w, b);
  return `<h2>${title}</h2>${body}<p class="desc">${t(`beeDesc.${role ?? (b.caste === CASTE.drone ? 'drone' : 'queen')}`)}</p>
    <div class="actions">
      <button data-a="follow" class="${following ? 'on' : ''}">${t(following ? 'info.unfollow' : 'info.follow')} <kbd>F</kbd></button>
      <button data-a="flyto">${t('info.flyNear')}</button>
    </div>`;
}

function hornetInfo(w: BeeWorld, id: number, following: boolean): string {
  const h = w.hornets.get(id);
  if (!h || h.state === 'away') return `<h2>${t('info.hornetGone')}</h2>`;
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  let body = kv(t('info.hornetState'), t(`hornet.${h.state}`));
  if (h.state === 'ball') body += kv(t('info.ballHeat'), t('info.ballHeatValue', { t: h.heat.toFixed(1), n: w.bees.ball(h.id).length }));
  const alive = h.state !== 'dead';
  return `<h2>${t('info.hornet')}</h2>${body}<p class="desc">${t('info.hornetDesc')}</p>
    <div class="actions">
      ${alive ? `<button data-a="swat" data-v="${h.id}">${t('info.swat')}</button>` : ''}
      <button data-a="follow" class="${following ? 'on' : ''}">${t(following ? 'info.unfollow' : 'info.follow')} <kbd>F</kbd></button>
    </div>`;
}

/** 换框的按钮；点了一个先问一句（框上的子、蜜会一起拿走） */
function swapPanel(w: BeeWorld): string {
  if (swapAsk === null)
    return `<div class="actions"><button data-a="swapAsk" data-v="1">${t('info.swapUpper')}</button><button data-a="swapAsk" data-v="0">${t('info.swapLower')}</button></div>`;
  const got = w.keeper.frameContents(swapAsk);
  return `<p class="desc">${t('info.swapAsk', { frame: t(swapAsk ? 'info.upper' : 'info.lower'), brood: got.brood, honey: Math.round(got.honey) })}</p>
    <div class="actions"><button data-a="swap">${t('info.swapYes')}</button><button data-a="swapNo">${t('info.swapNo')}</button></div>`;
}

/** 和太阳方向差 th（从上往下看顺时针为正，也就是面朝太阳时的右边）写成文字 */
function sunSide(th: number): string {
  const d = Math.round((wrapAngle(th) * 180) / Math.PI);
  return Math.abs(d) < 3 ? t('info.sunAt') : t(d > 0 ? 'info.sunRight' : 'info.sunLeft', { d: Math.abs(d) });
}

/** 跳舞的蜂：舞里说的方向和距离、还剩几圈；跟舞读出地方的蜂：读出来的 */
function danceRows(w: BeeWorld, b: Bee): string {
  const kv = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const c = b.brain.cmd;
  if (c?.k === 'dance') {
    if (c.w <= 0) return kv(t('info.danceSays'), t('info.danceNear')) + kv(t('info.circuits'), String(c.n));
    // 摆动方向和竖直向上的夹角就是花丛和太阳的方位差；背面看过去左右反过来
    const th = Math.atan2(b.face ? -Math.cos(c.a) : Math.cos(c.a), Math.sin(c.a));
    const m = Math.round((c.w - CONFIG.dance.w0) / CONFIG.dance.perM);
    return kv(t('info.danceSays'), t('info.danceValue', { dir: sunSide(th), m, s: c.w.toFixed(1) })) + kv(t('info.circuits'), String(c.n));
  }
  if (b.aim) {
    const a = b.aim;
    const m = Math.round(Math.hypot(a.x - MOUTH.x, a.z - MOUTH.z) / 100);
    const where = a.r === CONFIG.dance.round && m < 1 ? t('info.danceNear') : t('info.aimValue', { dir: sunSide(Math.atan2(a.z - MOUTH.z, a.x - MOUTH.x) - w.clock.sunAzimuth), m });
    return kv(t('info.aim'), where);
  }
  return '';
}

function beeUi(w: BeeWorld, view: BeeView, following: () => boolean): GameUi<BeeRef> {
  const row = (label: string, value: string) => `<div class="row">${label}<b>${value}</b></div>`;
  const sub = (label: string, value: number) => `<div class="row sub">${label}<b>${value}</b></div>`;
  const stat = (key: Parameters<typeof t>[0], value: number | string) => `<span>${t(key)}</span><b>${value}</b>`;
  return {
    status: () => {
      const ph = w.weather.phase;
      return {
        icon: ph === 'rain' ? '🌧️' : ph === 'overcast' ? '☁️' : w.clock.isNight ? '🌙' : '☀️',
        text: t(w.clock.isNight ? 'ui.statusNight' : 'ui.status', { weather: tr(w.weather.label), t: Math.round(w.weather.air(w.clock.hour)) }),
      };
    },
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
        let out = 0;
        let early = 0;
        let late = 0;
        for (const b of B.list) {
          if (b.out) out++;
          const r = roleOf(b);
          if (r) {
            roles[r]++;
            const d = ROLE_KEYS.indexOf(r) - ROLE_KEYS.indexOf(ageRoleOf(b)!);
            if (d > 0) early++;
            else if (d < 0) late++;
          } else if (b.caste === CASTE.drone) drones++;
        }
        const flowers = w.flowers.patches.filter((p) => p.species !== SUGAR);
        const hn = w.hornets.list.filter((h) => h.state !== 'away' && h.state !== 'dead' && h.state !== 'leave').length;
        const HN = w.hornets;
        const dishes = w.flowers.patches.filter((p) => p.species === SUGAR);
        return `
      <h3 class="fold" title="${t(folded ? 'colony.unfold' : 'colony.fold')}">${t('colony.title')}</h3>
      ${row(t('colony.season'), t('colony.summer'))}
      ${row(t('colony.bees'), t('colony.beesValue', { n: B.list.length, d: drones }))}
      ${ROLE_KEYS.map((k) => sub(t(`role.${k}`), roles[k])).join('')}
      ${row(t('colony.shift'), t('colony.shiftValue', { a: early, b: late }))}
      <h3>${t('colony.comb')}</h3>
      ${row(t('colony.cells'), t('colony.cellsValue', { n: c.built * 2, b: c.building * 2 }))}
      ${row(t('colony.brood'), String(n.egg + n.larva + n.capped))}
      ${sub(t('colony.eggs'), n.egg)}${sub(t('colony.larvae'), n.larva)}${sub(t('colony.capped'), n.capped)}
      ${B.starved ? sub(t('colony.starved'), B.starved) : ''}
      ${w.heat.chilled ? sub(t('colony.chilled'), w.heat.chilled) : ''}
      ${row(t('colony.broodTemp'), t('colony.broodTempValue', { t: w.heat.broodMean.toFixed(1), lo: w.heat.broodMin.toFixed(1), hi: w.heat.broodMax.toFixed(1) }))}
      ${row(t('colony.climate'), t('colony.climateValue', { h: w.heat.heating, f: w.heat.fanning }))}
      ${row(t('colony.honey'), t('colony.fullCells', { n: Math.round(c.honeyCells) }))}
      ${row(t('colony.pollen'), t('colony.fullCells', { n: Math.round(c.pollenCells) }))}
      <h3>${t('colony.forage')}</h3>
      ${row(t('colony.out'), String(out))}
      ${row(t('colony.flowers'), t('colony.flowersValue', { n: flowers.length, o: flowers.filter((p) => patchOpenness(p, w.clock.hour) > 0).length }))}
      ${row(t('colony.hornets'), hn ? t('colony.hornetsValue', { n: hn }) : t('colony.hornetsNone'))}
      ${row(t('colony.alarm'), t(w.keeper.alarm > 0.05 ? 'colony.alarmOn' : 'colony.alarmOff'))}
      ${dishes.length ? row(t('colony.sugar'), t('colony.sugarValue', { n: dishes.length, p: Math.round((dishes.reduce((s, p) => s + p.nectar, 0) / (dishes.length * nectarCap(dishes[0]))) * 100) })) : ''}
      <h3>${t('colony.since')}</h3>
      <div class="grid">
        ${stat('total.emerged', B.births)}${stat('total.died', B.deaths)}
        ${stat('total.laid', B.laid)}${stat('total.lost', B.lost)}
        ${stat('total.trips', B.trips)}${stat('total.dances', B.dances)}
        ${stat('total.nectar', Math.round(B.nectarIn))}${stat('total.pollen', Math.round(B.pollenIn))}
        ${stat('total.recruits', B.recruits)}${stat('total.hits', `${B.arrived ? Math.round((B.hits / B.arrived) * 100) : 0}%`)}
        ${stat('total.handoffs', B.handoffs)}${stat('total.selfStored', B.selfStored)}
        ${stat('total.trembles', B.trembles)}${stat('total.reverted', B.reverted)}
        ${stat('total.hornets', HN.visits)}${stat('total.caught', HN.caught)}
        ${stat('total.balls', HN.balls)}${stat('total.hornetKills', `${HN.killed} / ${HN.swatted}`)}
        ${stat('total.harvests', w.keeper.harvests)}${stat('total.harvested', Math.round(w.keeper.harvested))}
        ${stat('total.swaps', w.keeper.swaps)}${stat('total.lostBrood', w.keeper.lostBrood)}
      </div>`;
      },
    },
    infoHint: () => t('info.hint'),
    info: {
      hive: () => `<h2>${t('info.hive')}</h2>
      <div class="kv"><span>${t('info.size')}</span><b>${t('info.sizeValue', { w: H.combW, h: H.frameH })}</b></div>
      <div class="kv"><span>${t('info.plate')}</span><b>${t(w.hornets.plate ? 'info.plateOn' : 'info.plateOff')}</b></div>
      <p class="desc">${t('info.hiveDesc')}</p>
      <div class="actions"><button data-a="plate">${t(w.hornets.plate ? 'info.plateRemove' : 'info.plateAdd')}</button></div>
      ${swapPanel(w)}`,
      cell: (r) => cellInfo(w, r.id),
      flower: (r) => flowerInfo(w, r.id),
      bee: (r) => beeInfo(w, r.id, following()),
      hornet: (r) => hornetInfo(w, r.id, following()),
    },
    legend: {
      html: () => {
        const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
        const chips = (title: string, items: [number, string][]) =>
          `<b>${title}</b><div class="chips">${items.map(([c, s]) => `<span><i style="background:${hex(c)}"></i>${s}</span>`).join('')}</div>`;
        let html = '';
        if (view.bees.roles)
          html += chips(t('legend.roles'), [
            ...ROLE_KEYS.map((k): [number, string] => [ROLE_COLORS[k], t(`role.${k}`)]),
            [ROLE_COLORS.drone, t('caste.drone')],
            [ROLE_COLORS.queen, t('caste.queen')],
          ]);
        if (view.comb.contentMap) html += chips(t('legend.cells'), MAP_KEYS.map((k) => [MAP_COLORS[k], t(`legend.cell.${k}`)]));
        if (view.heat.on) {
          const [a, b] = CONFIG.heat.ideal;
          const stops = HEAT_COLORS.filter(([v]) => v !== b);
          const label = (v: number, i: number) =>
            v === a ? t('legend.heatIdeal', { a, b }) : t(i === 0 ? 'legend.heatBelow' : i === stops.length - 1 ? 'legend.heatAbove' : 'legend.heatDeg', { t: v });
          html += chips(t('legend.heat'), stops.map(([v, c], i): [number, string] => [c, label(v, i)]));
        }
        return html;
      },
      visible: () => view.bees.roles || view.comb.contentMap || view.heat.on,
    },
    help: {
      mouse: ['help.move', 'help.mouse', 'help.click', 'help.follow', 'help.views', 'help.tools'],
      touch: ['help.touchMove', 'help.touchTap'],
    },
  };
}

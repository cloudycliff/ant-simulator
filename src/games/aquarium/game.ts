import * as THREE from 'three';
import { L, t, tr } from '../../core/i18n';
import type { CameraPose, GameContext, GameModule, GameSession, GameUi, ViewToggle } from '../../core/app/game';
import type { NotesDef } from '../../core/app/notes';
import { svgIcon } from '../../core/app/shell';
import { VolumeSpace } from '../../core/space/volume';
import { drawChart } from '../../core/ui/chart';
import { bar, cap } from '../../core/ui/html';
import { ToolController, type ToolDef } from '../../core/ui/tools';
import { CONFIG, SPECIES, SPECIES_LIST } from './config';
import { Tank, aqSave, type AqRef, type AqSaveData, type AqSaveMeta } from './tank';
import { TankView } from './view';

const T = CONFIG.tank;

/** 正面稍高处看鱼缸，退到整缸宽度装得下为止 */
function openingPose(aspect: number): CameraPose {
  const halfFov = Math.atan(Math.tan((50 * Math.PI) / 360) * aspect);
  const dist = Math.max(136, (T.w / 2 + 6) / Math.tan(halfFov));
  const k = dist / 136;
  return [0, 26 + 12 * k, 135 * k, 0, 26, 0];
}

export const aquariumGame: GameModule<Tank, AqRef, AqSaveData, AqSaveMeta> = {
  title: () => t('app.title'),
  subtitle: () => t('app.subtitle'),
  loading: () => t('app.loading'),
  repoUrl: 'https://github.com/cloudycliff/ant-simulator',
  camera: { fov: 50, near: 0.5, far: 3000, pose: openingPose },
  create: (seed) => new Tank(seed),
  save: { ...aqSave, describe: (m) => t('save.what', { n: m.fish }) },
  space: (w) =>
    new VolumeSpace(
      new THREE.Box3(new THREE.Vector3(-T.w / 2, 0, -T.d / 2), new THREE.Vector3(T.w / 2, T.water, T.d / 2)),
      (x, z) => w.floorAt(x, z),
      new THREE.Box3(new THREE.Vector3(-240, 2, -85), new THREE.Vector3(240, 220, 420)),
    ),
  mount,
};

type ToolKind = 'feed' | 'tap';
const TOOLS: ToolDef<ToolKind>[] = [
  { kind: 'feed', name: L('tool.feed'), key: '6', hint: L('tool.feedHint'), options: [{ label: L('tool.pinch'), radius: 3 }, { label: L('tool.handful'), radius: 7 }] },
  { kind: 'tap', name: L('tool.tap'), key: '7', hint: L('tool.glassHint'), options: [{ label: L('tool.knock'), radius: 2 }] },
];
const FEED_FLAKES = [8, 24];

const ICON = svgIcon('<path d="M2.5 10c3-4.5 8-5 11.5-1.6L17.5 6v8L14 11.6C10.5 15 5.5 14.5 2.5 10z"/><circle cx="7" cy="9.2" r=".8"/>');

function mount(ctx: GameContext<Tank, AqRef>): GameSession<AqRef> {
  const { world: tank, scene, camera, dom } = ctx;
  const view = new TankView(tank, scene);
  const tools = new ToolController<ToolKind>(TOOLS, {
    run: (def, option, p, _yaw, dry) => (def.kind === 'feed' ? tank.feed(p.x, p.z, FEED_FLAKES[option], def.options[option].radius, dry) : tank.tap(p, dry)),
  });
  let selection: AqRef | null = null;
  const views: ViewToggle[] = [
    { id: 'glass', label: () => t('ui.glass'), key: 'G', on: () => view.glass, toggle: () => (view.glass = !view.glass) },
    { id: 'bubbles', label: () => t('ui.bubbles'), key: 'B', on: () => view.bubbles, toggle: () => (view.bubbles = !view.bubbles) },
    { id: 'hungerColors', label: () => t('ui.hungerColors'), key: 'C', param: 'hunger', on: () => view.hungerColors, toggle: () => (view.hungerColors = !view.hungerColors) },
  ];
  return {
    shadowLight: view.lamp,
    views,
    tools,
    pick: (x, y, tol = 14) => pick(tank, view, camera, dom, x, y, tol),
    applyParams: () => tank.settle(),
    syncViews: () => view.syncViews(),
    update: (dt, f) => {
      selection = f.selection;
      view.update(dt, f.time, camera, f.selection);
    },
    ui: { ...tankUi(tank, view, ctx.following), notes: tankNotes(tank, () => (tools.active >= 0 ? TOOLS[tools.active].kind : null), () => selection) },
  };
}

/** 笔记和第一次的提示（T-077）：开局讲鱼缸，第一次拿起鱼食、鱼饿了时各讲一次；选中一条鼠鱼只记进笔记，不弹 */
function tankNotes(tank: Tank, tool: () => ToolKind | null, selection: () => AqRef | null): NotesDef {
  const note = (id: 'tank' | 'feed' | 'hungry' | 'cory', tip = true) => ({
    id,
    group: 'notes.group' as const,
    title: `note.${id}.title` as const,
    body: `note.${id}.body` as const,
    hint: `note.${id}.hint` as const,
    tip,
  });
  return {
    key: 'aquarium-notes',
    title: 'notes.title',
    entries: [note('tank'), note('feed'), note('hungry'), note('cory', false)],
    *check() {
      yield 'tank';
      if (tool() === 'feed') yield 'feed';
      if (tank.events.entries.some((e) => e.msg.k === 'ev.hungry')) yield 'hungry';
      const sel = selection();
      if (sel?.kind === 'fish' && tank.fishById(sel.id)?.species === 'cory') yield 'cory';
    },
  };
}

const _v = new THREE.Vector3();
const ray = new THREE.Raycaster();

/** 鱼和鱼食按屏幕距离选（小，射线很难点中），水草按射线 */
function pick(tank: Tank, view: TankView, camera: THREE.Camera, dom: HTMLElement, x: number, y: number, tol: number): AqRef | null {
  const rect = dom.getBoundingClientRect();
  let best: AqRef | null = null;
  let bd = tol;
  const near = (p: THREE.Vector3, ref: AqRef, pad: number) => {
    _v.copy(p).project(camera);
    if (_v.z > 1) return;
    const d = Math.hypot(((_v.x + 1) / 2) * rect.width + rect.left - x, ((1 - _v.y) / 2) * rect.height + rect.top - y) - pad;
    if (d < bd) {
      bd = d;
      best = ref;
    }
  };
  for (const f of tank.fish) near(f.pos, { kind: 'fish', id: f.id }, 4);
  for (const p of tank.food) near(p.pos, { kind: 'food', id: p.id }, 0);
  if (best) return best;
  ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(view.pickables, false)[0];
  return (hit?.object.userData.ref as AqRef | undefined) ?? null;
}

function tankUi(tank: Tank, view: TankView, following: () => boolean): GameUi<AqRef> {
  let drawn = -1;
  const row = (label: string, value: string) => `<div class="row">${label}<b>${value}</b></div>`;
  const clockAt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return {
    status: (compact) => {
      const lit = tank.light() > 0.5;
      return {
        icon: lit ? '💡' : '🌙',
        text: t(compact ? 'ui.statusShort' : 'ui.status', { t: tank.waterTemp().toFixed(1), light: t(lit ? 'light.on' : 'light.off') }),
      };
    },
    perfExtra: () => t('ui.perfCount', { n: tank.fish.length }),
    panel: {
      icon: ICON,
      label: () => t('dock.tank'),
      html: (folded) => {
        const avg = tank.fish.reduce((s, f) => s + f.hunger, 0) / Math.max(1, tank.fish.length);
        const bottom = tank.food.filter((p) => p.state === 'bottom').length;
        const lit = tank.light() > 0.5;
        const st = tank.stats;
        return `
      <h3 class="fold" title="${t(folded ? 'tank.unfold' : 'tank.fold')}">${t('tank.title')}</h3>
      ${SPECIES_LIST.map((s) => row(cap(t(`species.${s}`)), String(tank.fish.filter((f) => f.species === s).length))).join('')}
      <div class="row">${t('tank.hunger')} ${bar(avg, avg > 0.7 ? '#e0803a' : '#7ec06a')}</div>
      ${row(t('tank.food'), t('tank.flakes', { n: tank.food.length }))}
      <div class="row sub">${t('tank.bottom')}<b>${t('tank.flakes', { n: bottom })}</b></div>
      ${row(t('tank.light'), t(lit ? 'tank.lightOn' : 'tank.lightOff', { time: clockAt(lit ? CONFIG.light.off : CONFIG.light.on) }))}
      <h3>${t('tank.totals')}</h3>
      <div class="grid">
        <span>${t('stat.feeds')}</span><b>${st.feeds}</b><span>${t('stat.eaten')}</span><b>${st.eaten}</b>
        <span>${t('stat.rotted')}</span><b>${st.rotted}</b>
      </div>`;
      },
    },
    infoHint: () => t('info.hint'),
    info: {
      fish: ({ id }) => {
        const f = tank.fishById(id);
        if (!f) return '';
        const S = SPECIES[f.species];
        return `<h2>${cap(t(`species.${f.species}`))} #${f.id}</h2>
      <div class="kv">
        <span>${t('info.activity')}</span><b class="act">${tr(f.activity)}</b>
        <span>${t('info.hunger')}</span>${bar(f.hunger, f.hunger > 0.7 ? '#e0803a' : '#7ec06a')}
        <span>${t('info.age')}</span><b>${t('info.days', { n: Math.floor((tank.clock.seconds - f.born) / tank.clock.dayLength) })}</b>
        <span>${t('info.length')}</span><b>${t('info.cm', { n: (S.len * f.size).toFixed(1) })}</b>
        <span>${t('info.height')}</span><b>${t('info.cm', { n: (f.pos.y - tank.floorAt(f.pos.x, f.pos.z)).toFixed(0) })}</b>
        <span>${t('info.eaten')}</span><b>${t('tank.flakes', { n: f.eaten })}</b>
      </div>
      <p class="desc">${t(`speciesDesc.${f.species}`)}</p>
      <div class="actions">
        <button data-a="follow" class="${following() ? 'on' : ''}">${t(following() ? 'info.unfollow' : 'info.follow')} <kbd>F</kbd></button>
        <button data-a="flyto">${t('info.flyNear')}</button>
      </div>`;
      },
      plant: ({ id }) => {
        const p = tank.plants[id];
        return `<h2>${cap(t(`plant.${p.kind}`))}</h2>
      <div class="kv"><span>${t('info.height')}</span><b>${t('info.cm', { n: p.height.toFixed(0) })}</b></div>
      <p class="desc">${t(`plantDesc.${p.kind}`)}</p>`;
      },
      food: ({ id }) => {
        const p = tank.food.find((x) => x.id === id);
        if (!p) return '';
        return `<h2>${t('info.food')}</h2>
      <div class="kv"><span>${t('info.foodState')}</span><b>${t(`info.${p.state}`)}</b></div>
      <p class="desc">${t('info.foodDesc')}</p>`;
      },
    },
    stats: {
      html: '<canvas id="chart-tank"></canvas>',
      draw: (force) => {
        const h = tank.history;
        if (!force && h.length === drawn) return;
        drawn = h.length;
        drawChart(document.getElementById('chart-tank') as HTMLCanvasElement, t('chart.hunger'), h.map((x) => x.day), [
          { label: t('chart.hungerLine'), color: '#e0803a', values: h.map((x) => x.hunger) },
          { label: t('chart.foodLine'), color: '#c8742e', values: h.map((x) => x.food), dash: true },
        ]);
      },
    },
    legend: {
      html: () => `<div><i style="background:#7ee07a"></i>${t('legend.full')}</div><div><i style="background:#ff5a3a"></i>${t('legend.hungry')}</div>`,
      visible: () => view.hungerColors,
    },
    help: {
      mouse: ['help.move', 'help.mouse', 'help.click', 'help.events', 'help.follow', 'help.views', 'help.tools'],
      touch: ['help.touchMove', 'help.touchTap', 'help.events', 'help.touchTools'],
    },
  };
}

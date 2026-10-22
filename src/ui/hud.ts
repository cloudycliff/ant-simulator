import { CONFIG, ROLE_COLORS, ROLE_NAMES, type Role } from '../config';
import { getLang, LANG_NAMES, LANGS, t, tr } from '../i18n';
import { CHAMBER_INFO } from '../nest/nest';
import { FOOD_KIND_NAMES } from '../world/food';
import { PREDATOR_INFO, Spider } from '../world/predators';
import { stampAt } from '../sim/clock';
import { ITEM_NAMES } from '../sim/items';
import type { ColonyEvent, ColonySample } from '../sim/colony';
import { OBSTACLE_INFO } from '../world/vegetation';
import type { World } from '../world/world';
import type { Selection } from './picking';
import { TOOLS, type ToolController } from './tools';
import type { SaveMeta } from './saveSlot';

export type HudAction =
  | 'pause'
  | 'speed'
  | 'xray'
  | 'pheromone'
  | 'roleColors'
  | 'grass'
  | 'stats'
  | 'follow'
  | 'flyto'
  | 'deselect'
  | 'help'
  | 'tool'
  | 'toolopt'
  | 'toolexit'
  | 'removePlaced'
  | 'removePredator'
  | 'savePanel'
  | 'saveNow'
  | 'loadSave'
  | 'newGame'
  | 'langMenu'
  | 'lang';

const SPEEDS = [1, 2, 5, 10, 20];
const GLOBE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6.4"/><ellipse cx="8" cy="8" rx="2.7" ry="6.4"/><path d="M1.8 6h12.4M1.8 10h12.4"/></g></svg>';
const REPO_URL = 'https://github.com/cloudycliff/ant-simulator';
const HELP_LINES = ['help.move', 'help.mouse', 'help.click', 'help.events', 'help.follow', 'help.views', 'help.tools'] as const;

function bar(v: number, color: string): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<span class="bar"><i style="width:${p}%;background:${color}"></i></span>`;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** 英文词典里的名词是小写的，放在标题、行首时大写首字母 */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 事件和日志的时刻：新记录是模拟秒数，旧存档里是拼好的中文 */
function when(x: number | string): string {
  return typeof x === 'number' ? tr(stampAt(x)) : x;
}

function agoText(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s < 10) return t('ago.now');
  if (s < 60) return t('ago.sec', { n: Math.floor(s / 10) * 10 });
  if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.hour', { n: Math.floor(s / 3600) });
  return t('ago.day', { n: Math.floor(s / 86400) });
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

interface Series {
  label: string;
  color: string;
  values: number[];
  dash?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** 简单折线图：横轴为游戏日，纵轴自动取整 */
function drawChart(cv: HTMLCanvasElement, title: string, days: number[], series: Series[]): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr;
    cv.height = H * dpr;
  }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const X0 = 38;
  const R = 8;
  const T = 30;
  const B = 18;
  g.font = '11px "Microsoft YaHei", sans-serif';
  g.fillStyle = '#c9a06a';
  g.fillText(title, 2, 12);
  let lx = 2;
  for (const s of series) {
    g.fillStyle = s.color;
    g.fillRect(lx, 18, 10, 3);
    g.fillStyle = '#b8ae9c';
    g.fillText(s.label, lx + 13, 23);
    lx += 18 + g.measureText(s.label).width + 8;
  }
  if (days.length < 2) {
    g.fillStyle = '#8f877a';
    g.fillText(t('chart.wait'), X0 + 10, T + 30);
    return;
  }
  let max = 0;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  const ymax = niceMax(max * 1.05);
  const d0 = days[0];
  const d1 = days[days.length - 1];
  const px = (d: number) => X0 + ((d - d0) / Math.max(1e-6, d1 - d0)) * (W - X0 - R);
  const py = (v: number) => H - B - (v / ymax) * (H - T - B);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.fillStyle = '#8f877a';
  g.lineWidth = 1;
  g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    const y = Math.round(py(v)) + 0.5;
    g.beginPath();
    g.moveTo(X0, y);
    g.lineTo(W - R, y);
    g.stroke();
    g.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), X0 - 4, y + 4);
  }
  g.textAlign = 'center';
  const span = d1 - d0;
  const stepD = span > 12 ? 4 : span > 5 ? 2 : span > 1.5 ? 1 : 0.25;
  for (let d = Math.ceil(d0 / stepD) * stepD; d <= d1; d += stepD) {
    const label = stepD < 1 ? t('chart.hour', { h: Math.round((d % 1) * 24) }) : t('chart.day', { d: Math.floor(d) + 1 });
    g.fillText(label, px(d), H - 4);
  }
  g.textAlign = 'left';
  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 1.6;
    g.setLineDash(s.dash ? [4, 3] : []);
    g.beginPath();
    s.values.forEach((v, i) => {
      const x = px(days[i]);
      const y = py(v);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  g.setLineDash([]);
}

export class Hud {
  private top = document.getElementById('topbar')!;
  private colonyEl = document.getElementById('colony')!;
  private infoEl = document.getElementById('info')!;
  private eventsEl = document.getElementById('events')!;
  private helpEl = document.getElementById('help')!;
  private toastEl = document.getElementById('toast')!;
  private statsEl = document.getElementById('stats')!;
  private legendEl = document.getElementById('legend')!;
  private toolEl = document.getElementById('tool')!;
  private toolKey = '';
  tools: ToolController | null = null;
  private saveEl = document.getElementById('save')!;
  private saveKey = '';
  saveOpen = false;
  saveMeta: SaveMeta | null = null;
  private toastTimer = 0;
  private statsDrawn = -1;
  onAction: ((a: HudAction, arg?: number) => void) | null = null;
  onEvent: ((e: ColonyEvent) => void) | null = null;
  private shownEvents: ColonyEvent[] = [];
  private eventsKey = '';
  state = { xray: false, forcedXray: false, pheromone: false, roleColors: false, grass: true, stats: false, following: false };

  constructor(private world: World) {
    this.renderStatic();
    this.statsEl.innerHTML = `
      <canvas id="chart-pop"></canvas>
      <canvas id="chart-food"></canvas>`;
    const handler = (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!b) return;
      this.onAction?.(b.dataset.a as HudAction, b.dataset.v ? Number(b.dataset.v) : undefined);
    };
    this.top.addEventListener('click', handler);
    window.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('#lang')) this.setLangMenu(false);
    });
    this.infoEl.addEventListener('click', handler);
    this.helpEl.addEventListener('click', handler);
    this.toolEl.addEventListener('click', handler);
    this.saveEl.addEventListener('click', handler);
    this.infoEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.statsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.toolEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.saveEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    // 列表随时会重写，等不到 click
    this.eventsEl.addEventListener('pointerdown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
      if (!row || e.button !== 0) return;
      e.stopPropagation();
      const ev = this.shownEvents[Number(row.dataset.ev)];
      if (ev) this.onEvent?.(ev);
    });
  }

  /** 顶栏、帮助和图例：只在创建和切换语言时重写，按钮的开关状态由 refresh 每帧补上 */
  private renderStatic(): void {
    const sc = (key: string) => t('ui.shortcut', { key });
    const toggle = (a: string, label: string, key: string) => `<button data-a="${a}" id="btn-${a}" title="${sc(key)}">${label} <kbd>${key}</kbd></button>`;
    const cur = getLang();
    this.top.innerHTML = `
      <div class="tb-row">
        <div class="title">${t('app.title')} <em>${t('app.subtitle')}</em></div>
        <div class="clock"><span id="dayicon"></span><span id="clock"></span><span id="temp"></span></div>
        <div class="perf" id="perf"></div>
        <div class="meta">
          <button data-a="savePanel" id="btn-save" title="${t('save.buttonTitle')}">${t('save.title')}</button>
          <div class="lang" id="lang">
            <button data-a="langMenu" id="btn-lang" title="${t('ui.langTitle')}" aria-haspopup="menu" aria-expanded="false">${GLOBE}${LANG_NAMES[cur]}<i class="caret"></i></button>
            <div class="menu hidden" id="lang-menu" role="menu">
              ${LANGS.map((l, i) => `<button data-a="lang" data-v="${i}" role="menuitemradio" aria-checked="${l === cur}" class="${l === cur ? 'on' : ''}">${LANG_NAMES[l]}</button>`).join('')}
            </div>
          </div>
          <a class="repo" href="${REPO_URL}" target="_blank" rel="noopener" title="${t('ui.repoTitle')}">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            GitHub
          </a>
        </div>
      </div>
      <div class="tb-row controls">
        <div class="group" id="speeds">
          <span class="label">${t('ui.groupSpeed')}</span>
          <button data-a="pause" id="btn-pause" title="${sc(t('ui.space'))}">⏸</button>
          ${SPEEDS.map((s) => `<button data-a="speed" data-v="${s}">${s}×</button>`).join('')}
        </div>
        <div class="group">
          <span class="label">${t('ui.groupView')}</span>
          ${toggle('xray', t('ui.xray'), 'X')}
          ${toggle('pheromone', t('ui.pheromone'), 'P')}
          ${toggle('roleColors', t('ui.roleColors'), 'C')}
          ${toggle('grass', t('ui.grass'), 'G')}
          ${toggle('stats', t('ui.stats'), 'T')}
        </div>
        <div class="group" id="tools">
          <span class="label">${t('ui.groupTools')}</span>
          ${TOOLS.map((d, i) => `<button data-a="tool" data-v="${i}" title="${t('ui.toolTitle', { key: d.key })}">${tr(d.name)} <kbd>${d.key}</kbd></button>`).join('')}
        </div>
        <button data-a="help" class="help" title="${sc('H')}">${t('ui.help')} <kbd>H</kbd></button>
      </div>`;
    this.helpEl.innerHTML = `<b>${t('help.title')}</b>` + HELP_LINES.map((k) => `<div>${t(k)}</div>`).join('');
    this.legendEl.innerHTML = `
      <div><i style="background:linear-gradient(90deg,#ff7a2a,#fff07a)"></i>${t('legend.trail')}</div>
      <div><i style="background:#3c96ff"></i>${t('legend.home')}</div>
      <div><i style="background:transparent;border:2px solid #ff4a3a;height:4px"></i>${t('legend.alarm')}</div>`;
  }

  setLangMenu(open: boolean): void {
    const menu = document.getElementById('lang-menu');
    if (!menu || menu.classList.contains('hidden') === !open) return;
    menu.classList.toggle('hidden', !open);
    document.getElementById('btn-lang')!.setAttribute('aria-expanded', String(open));
  }

  toggleLangMenu(): void {
    this.setLangMenu(!!document.getElementById('lang-menu')?.classList.contains('hidden'));
  }

  /** 切换语言后重写所有界面文字，包括已经产生的事件和日志 */
  relocalize(): void {
    this.renderStatic();
    this.toolKey = '';
    this.saveKey = '';
    this.eventsKey = '';
    this.statsDrawn = -1;
  }

  /** 存档面板：按钮只在有无存档变化时重写，“多久之前”单独更新文字 */
  renderSave(): void {
    document.getElementById('btn-save')!.classList.toggle('on', this.saveOpen);
    this.saveEl.classList.toggle('hidden', !this.saveOpen);
    if (!this.saveOpen) return;
    const m = this.saveMeta;
    const key = m ? 'has' : 'none';
    if (key !== this.saveKey) {
      this.saveKey = key;
      this.saveEl.innerHTML = `
        <div class="head"><b>${t('save.title')}</b>${t('save.where')}</div>
        <div class="row" id="save-status"></div>
        <div class="row">${t('save.seed', { seed: this.world.seed })} <small>${t('save.seedHint')}</small></div>
        <div class="opts">
          <button data-a="saveNow">${t('save.now')} <kbd>Ctrl S</kbd></button>
          <button data-a="loadSave" ${m ? '' : 'disabled'}>${t('save.load')}</button>
          <button data-a="newGame" class="danger">${t('save.new')}</button>
        </div>`;
    }
    document.getElementById('save-status')!.textContent = m
      ? t('save.status', { stamp: m.seconds !== undefined ? tr(stampAt(m.seconds)) : (m.stamp ?? ''), n: m.ants, ago: agoText(Date.now() - m.savedAt) })
      : t('save.none');
  }

  toggleHelp(): void {
    this.helpEl.classList.toggle('hidden');
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.2;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  refresh(sel: Selection | null, fps: number, perf?: { sim: number; views: number; render: number }): void {
    const w = this.world;
    const c = w.clock;
    document.getElementById('clock')!.textContent = tr(c.stamp());
    const wp = w.weather.phase;
    document.getElementById('dayicon')!.textContent = wp === 'rain' ? '🌧️' : wp === 'overcast' ? '☁️' : c.isNight ? '🌙' : c.daylight < 0.6 ? '🌅' : '☀️';
    document.getElementById('temp')!.textContent = t('ui.temp', { weather: w.weather.label, t: c.temperatureAt(0).toFixed(1), h: Math.round(c.humidityAt(0)) });
    const pe = document.getElementById('perf')!;
    const lagging = !c.paused && w.effectiveSpeed < c.speed * 0.9;
    pe.textContent =
      t('ui.perf', { fps: Math.round(fps), n: w.colony.ants.length }) +
      (perf ? t('ui.perfTimes', { sim: perf.sim.toFixed(1), view: (perf.views + perf.render).toFixed(1) }) : '') +
      (lagging ? t('ui.perfLag', { x: w.effectiveSpeed.toFixed(1) }) : '');
    pe.classList.toggle('lag', lagging);
    if (perf) pe.title = t('ui.perfTitle', { sim: perf.sim.toFixed(2), views: perf.views.toFixed(2), render: perf.render.toFixed(2) });
    this.top.querySelectorAll<HTMLButtonElement>('[data-a="speed"]').forEach((b) => {
      b.classList.toggle('on', !c.paused && Number(b.dataset.v) === c.speed);
    });
    document.getElementById('btn-pause')!.classList.toggle('on', c.paused);
    const s = this.state;
    document.getElementById('btn-xray')!.classList.toggle('on', s.xray || s.forcedXray);
    document.getElementById('btn-pheromone')!.classList.toggle('on', s.pheromone);
    document.getElementById('btn-roleColors')!.classList.toggle('on', s.roleColors);
    document.getElementById('btn-grass')!.classList.toggle('on', s.grass);
    document.getElementById('btn-stats')!.classList.toggle('on', s.stats);
    this.statsEl.classList.toggle('hidden', !s.stats);
    this.legendEl.classList.toggle('hidden', !s.pheromone);
    if (s.stats) this.renderStats();
    this.renderTool();
    this.renderSave();

    this.renderColony();
    this.renderInfo(sel);
    const events = w.colony.events;
    const texts = events.map((e) => `<span>${when(e.t)}</span>${esc(tr(e.msg))}`);
    const key = texts.join('|');
    if (key !== this.eventsKey) {
      this.eventsKey = key;
      this.shownEvents = events.slice();
      const title = t('ui.eventTitle');
      this.eventsEl.innerHTML = events.map((e, i) => (e.at ? `<div class="go" data-ev="${i}" title="${title}">${texts[i]}</div>` : `<div>${texts[i]}</div>`)).join('');
    }
    this.layout();
  }

  /** 工具选项面板：只在工具或选项变化时重写 DOM，避免点击时按钮被替换 */
  renderTool(): void {
    const tc = this.tools;
    const active = tc?.active ?? -1;
    this.top.querySelectorAll<HTMLButtonElement>('[data-a="tool"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === active));
    document.body.classList.toggle('tooling', active >= 0);
    const key = tc && active >= 0 ? `${active}:${tc.option[active]}` : '';
    if (key === this.toolKey) return;
    this.toolKey = key;
    this.toolEl.classList.toggle('hidden', !key);
    if (!tc || !key) return;
    const d = TOOLS[active];
    const cur = tc.option[active];
    this.toolEl.innerHTML = `
      <div class="head"><b>${tr(d.name)}</b><span>${tr(d.hint)}</span></div>
      <div class="opts">
        ${d.options.map((o, i) => `<button data-a="toolopt" data-v="${i}" class="${i === cur ? 'on' : ''}">${cap(tr(o.label))}</button>`).join('')}
        <button data-a="toolexit" class="exit">${t('tool.exit')} <kbd>Esc</kbd></button>
      </div>`;
  }

  private layout(): void {
    const top = Math.round(this.top.getBoundingClientRect().bottom + 8);
    const H = window.innerHeight;
    this.colonyEl.style.top = this.infoEl.style.top = this.saveEl.style.top = `${top}px`;
    this.toastEl.style.top = `${top + 4}px`;
    this.colonyEl.style.maxHeight = `${Math.max(160, H - top - this.eventsEl.offsetHeight - 20)}px`;
    const legend = this.state.pheromone ? this.legendEl.offsetHeight + 10 : 0;
    this.infoEl.style.maxHeight = `${Math.max(160, H - top - legend - 10)}px`;
  }

  private renderStats(): void {
    const h = this.world.colony.history;
    if (h.length === this.statsDrawn) return;
    this.statsDrawn = h.length;
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

  /** 统计数据重新开始绘制（例如面板刚打开） */
  invalidateStats(): void {
    this.statsDrawn = -1;
  }

  private renderColony(): void {
    const w = this.world;
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
    this.colonyEl.innerHTML = `
      <h3>${t('col.title')}</h3>
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

  private renderInfo(sel: Selection | null): void {
    if (!sel) {
      this.infoEl.classList.add('empty');
      this.infoEl.innerHTML = `<div class="hint">${t('info.hint')}</div>`;
      return;
    }
    this.infoEl.classList.remove('empty');
    let html = '';
    switch (sel.kind) {
      case 'ant':
        html = this.antInfo(sel.id);
        break;
      case 'chamber':
        html = this.chamberInfo(sel.id);
        break;
      case 'food':
        html = this.foodInfo(sel.id);
        break;
      case 'entrance':
        html = this.entranceInfo(sel.id);
        break;
      case 'midden':
        html = this.middenInfo();
        break;
      case 'stone':
        html = `<h2>${t('info.stone')}</h2><p class="desc">${t('info.stoneDesc')}</p>`;
        break;
      case 'plant':
        html = this.plantInfo(sel.id);
        break;
      case 'placed': {
        const p = this.world.veg.placedById(sel.id);
        html = p
          ? `<h2>${cap(tr(OBSTACLE_INFO[p.kind].name))}<span class="tag next">${t('info.placedTag')}</span></h2>
             <p class="desc">${t(p.kind === 'twig' ? 'info.twigDesc' : 'info.rockDesc')}</p>
             <div class="actions"><button data-a="removePlaced" data-v="${p.id}">${t('tool.remove')}</button></div>`
          : `<h2>${t('info.obstacle')}</h2><p class="desc">${t('info.obstacleGone')}</p>`;
        break;
      }
      case 'puddle': {
        const p = this.world.water.byId(sel.id);
        html = p
          ? `<h2>${t('info.puddle')}</h2>
             <p class="desc">${t('info.puddleDesc')}</p>
             <div class="kv"><span>${t('info.radius')}</span><b>${p.r.toFixed(1)} cm</b><span>${t('info.waterLeft')}</span><b>${bar(p.water, '#5f9ccc')}</b></div>`
          : `<h2>${t('info.puddle')}</h2><p class="desc">${t('info.puddleGone')}</p>`;
        break;
      }
      case 'predator':
        html = this.predatorInfo(sel.id);
        break;
    }
    this.infoEl.innerHTML = html + `<div class="actions"><button data-a="deselect">${t('info.deselect')} <kbd>Esc</kbd></button></div>`;
  }

  private predatorInfo(id: number): string {
    const p = this.world.predators.byId(id);
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

  private antInfo(id: number): string {
    const w = this.world;
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
    const logs = a.log.map((l) => `<li><span>${when(l.t)}</span>${esc(tr(l.msg))}</li>`).join('') || `<li>${t('info.noLog')}</li>`;
    const following = this.state.following;
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

  private chamberInfo(id: number): string {
    const w = this.world;
    const c = w.nest.chambers[id];
    const col = w.colony;
    const temp = w.chamberTemperature(c);
    const stoneBonus = temp - w.clock.temperatureAt(c.depth);
    const h = w.clock.humidityAt(c.depth);
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

  private plantInfo(id: number): string {
    const w = this.world;
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

  private foodInfo(id: number): string {
    const w = this.world;
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

  private entranceInfo(id: number): string {
    const w = this.world;
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

  private middenInfo(): string {
    const w = this.world;
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
}

import type { Music } from '../audio/music';
import { getLang, LANG_NAMES, LANGS, t, tr } from '../i18n';
import type { SimEvent } from '../sim/events';
import type { EntityRef } from '../sim/entities';
import type { Simulation } from '../sim/simulation';
import type { SaveMeta } from '../platform/saveSlot';
import { BACKGROUND_LIMITED } from '../platform/background';
import type { Installer } from '../platform/install';
import { BRIGHTNESS_KEYS, type Brightness, type BrightnessKey } from '../render/brightness';
import { QUALITY_LEVELS, QUALITY_MODES, type Quality } from '../render/quality';
import { ENGINE } from '../config';
import { agoText, cap, esc, isTouch, when } from '../ui/html';
import type { ToolController } from '../ui/tools';
import { renderInfo, type GameUi, type ViewToggle } from './game';

export type ShellAction =
  | 'pause'
  | 'speed'
  | 'follow'
  | 'flyto'
  | 'deselect'
  | 'help'
  | 'tool'
  | 'toolopt'
  | 'toolexit'
  | 'toolPlace'
  | 'toolRotate'
  | 'savePanel'
  | 'saveNow'
  | 'loadSave'
  | 'newGame'
  | 'langMenu'
  | 'brightMenu'
  | 'brightReset'
  | 'background'
  | 'quality'
  | 'music'
  | 'install'
  | 'lang'
  | 'sheet'
  | 'menu';

/** 手机布局里从底栏打开的面板，同一时间只开一个；colony 是游戏的主面板 */
export const SHEETS = ['colony', 'views', 'tools', 'events', 'stats', 'save', 'help'] as const;
export type Sheet = (typeof SHEETS)[number];

const SPEEDS = [1, 2, 5, 10, 20];
export const svgIcon = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
const ICON = {
  views: svgIcon('<path d="M1.5 10S5 4.5 10 4.5 18.5 10 18.5 10 15 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.6"/>'),
  tools: svgIcon('<path d="M13.5 2.8a4 4 0 0 0-4.6 5.3L3 14a1.9 1.9 0 0 0 2.7 2.7l5.9-5.9a4 4 0 0 0 5.3-4.6l-2.3 2.3-2.4-.6-.6-2.4z"/>'),
  events: svgIcon('<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13z"/><path d="M8.3 17.5a1.8 1.8 0 0 0 3.4 0"/>'),
  more: svgIcon('<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/>'),
};
const GITHUB =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const GLOBE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6.4"/><ellipse cx="8" cy="8" rx="2.7" ry="6.4"/><path d="M1.8 6h12.4M1.8 10h12.4"/></g></svg>';

export interface ShellOptions<R extends EntityRef, M extends SaveMeta> {
  world: Simulation<R>;
  seed: number;
  title(): string;
  subtitle(): string;
  repoUrl?: string;
  ui: GameUi<R>;
  views: ViewToggle[];
  tools: ToolController | null;
  describeSave(m: M): string;
}

/**
 * 界面外壳：顶栏（时刻、倍速、视图开关、工具、画质、亮度、音乐、帮助、存档、语言）、主面板、信息面板、事件列表、帮助、
 * 统计、工具选项、存档面板、提示条；手机布局（一行顶栏 + 底栏 + 抽屉）。面板里的内容由游戏的 GameUi 给出
 */
export class Shell<R extends EntityRef, M extends SaveMeta = SaveMeta> {
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
  quality: Quality | null = null;
  music: Music | null = null;
  brightness: Brightness | null = null;
  installer: Installer | null = null;
  private saveEl = document.getElementById('save')!;
  private viewsEl = document.getElementById('views')!;
  private toolboxEl = document.getElementById('toolbox')!;
  private dockEl = document.getElementById('dock')!;
  private saveKey = '';
  saveOpen = false;
  saveMeta: M | null = null;
  private toastTimer = 0;
  private statsDirty = true;
  onAction: ((a: string, arg?: number) => void) | null = null;
  onEvent: ((e: SimEvent<R>) => void) | null = null;
  private shownEvents: SimEvent<R>[] = [];
  private eventsKey = '';
  state = { stats: false, following: false, background: true };
  /** 手机布局：一行顶栏 + 底栏，面板改为抽屉（见 updateMode） */
  compact = false;
  sheet: Sheet | null = null;
  /** 手机顶栏里展开的菜单：0 倍速，1 更多 */
  private menu: number | null = null;
  private colonyFolded = false;
  private readonly world: Simulation<R>;
  private readonly ui: GameUi<R>;
  /** 游戏的显示开关，有统计面板时最后加上“统计” */
  readonly views: ViewToggle[];
  readonly tools: ToolController | null;

  constructor(private readonly opt: ShellOptions<R, M>) {
    this.world = opt.world;
    this.ui = opt.ui;
    this.tools = opt.tools;
    this.views = [...opt.views];
    if (opt.ui.stats) {
      this.views.push({ id: 'stats', label: () => t('ui.stats'), key: 'T', on: () => this.state.stats, toggle: () => this.toggleStats() });
      this.statsEl.innerHTML = opt.ui.stats.html;
    }
    this.updateMode(true);
    // 竖屏平板上左右两块面板会把画面挤得很窄，开局先把主面板折起来
    this.colonyFolded = isTouch() && innerHeight > innerWidth;
    this.colonyEl.classList.toggle('folded', this.colonyFolded);
    const handler = (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!b) return;
      const a = b.dataset.a!;
      const v = b.dataset.v ? Number(b.dataset.v) : undefined;
      if (a === 'sheet') this.toggleSheet(SHEETS[v ?? 0]);
      if (a === 'menu') this.setMenu(this.menu === v ? null : (v ?? null));
      else if (b.closest('.pop') && !b.closest('.bright')) this.setMenu(null);
      this.onAction?.(a, v);
    };
    for (const el of [this.top, this.infoEl, this.helpEl, this.toolEl, this.saveEl, this.viewsEl, this.toolboxEl, this.dockEl]) el.addEventListener('click', handler);
    this.top.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const k = el.dataset.bright as BrightnessKey | undefined;
      if (!k || !this.brightness) return;
      this.brightness.set(k, Number(el.value));
      this.syncBrightness();
    });
    // 捕获阶段：面板会拦下 pointerdown，菜单也要能关掉
    window.addEventListener(
      'pointerdown',
      (e) => {
        const el = e.target as HTMLElement;
        if (!el.closest('#lang')) this.setLangMenu(false);
        if (!el.closest('#bright')) this.setBrightMenu(false);
        if (!el.closest('.popwrap')) this.setMenu(null);
      },
      true,
    );
    this.infoEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.statsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.toolEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.saveEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.infoEl.addEventListener('click', (e) => {
      if (this.compact && (e.target as HTMLElement).closest('h2')) this.infoEl.classList.toggle('folded');
    });
    this.colonyEl.addEventListener('click', (e) => {
      if (this.compact || !(e.target as HTMLElement).closest('h3.fold')) return;
      this.colonyFolded = !this.colonyFolded;
      this.colonyEl.classList.toggle('folded', this.colonyFolded);
    });
    // 列表随时会重写，等不到 click
    this.eventsEl.addEventListener('pointerdown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
      if (!row || e.button !== 0) return;
      e.stopPropagation();
      const ev = this.shownEvents[Number(row.dataset.ev)];
      if (this.compact) this.setSheet(null);
      if (ev) this.onEvent?.(ev);
    });
  }

  /** 宽小于 700 或高小于 500（手机竖屏和横屏）用手机布局；切换时重写界面 */
  updateMode(force = false): void {
    const compact = innerWidth < 700 || innerHeight < 500;
    document.body.classList.toggle('land', compact && innerWidth > innerHeight);
    if (compact === this.compact && !force) return;
    this.compact = compact;
    document.body.classList.toggle('compact', compact);
    this.menu = null;
    this.relocalize();
    // 手机上帮助以抽屉的形式在开局时打开，和桌面一样过一会儿自动收起
    this.setSheet(compact && !this.helpEl.classList.contains('hidden') ? 'help' : null);
  }

  toggleSheet(s: Sheet): void {
    this.setSheet(this.sheet === s ? null : s);
  }

  /** 手机布局里打开一个抽屉（null 全部收起）；统计、存档、帮助的开关跟着抽屉走 */
  setSheet(s: Sheet | null): void {
    if (!this.compact) s = null;
    else {
      this.state.stats = s === 'stats';
      this.saveOpen = s === 'save';
      this.helpEl.classList.toggle('hidden', s !== 'help');
    }
    if (s === 'stats' && this.sheet !== 'stats') this.statsDirty = true;
    this.sheet = s;
    const b = document.body.classList;
    for (const x of SHEETS) b.toggle(`sheet-${x}`, s === x);
    b.toggle('sheet-open', !!s);
    this.syncDock();
  }

  private syncDock(): void {
    const toolOn = (this.tools?.active ?? -1) >= 0;
    this.dockEl.querySelectorAll<HTMLElement>('[data-a="sheet"]').forEach((b) => {
      const s = SHEETS[Number(b.dataset.v)];
      b.classList.toggle('on', s === this.sheet || (s === 'tools' && toolOn && !this.sheet));
    });
  }

  private setMenu(i: number | null): void {
    if (i === this.menu) return;
    this.menu = i;
    this.top.querySelectorAll<HTMLElement>('.pop').forEach((p, k) => p.classList.toggle('hidden', k !== i));
    this.top.querySelectorAll<HTMLElement>('[data-a="menu"]').forEach((b, k) => b.classList.toggle('on', k === i));
  }

  /** “自动”后面带上当前实际的档位 */
  qualityLabel(): string {
    const q = this.quality;
    if (!q) return '';
    if (q.mode !== 'auto') return t(`quality.${q.mode}`);
    return t('ui.qualityAuto', { q: t(`quality.${QUALITY_LEVELS[q.level]}`) });
  }

  toggleStats(): void {
    if (this.compact) return this.toggleSheet('stats');
    this.state.stats = !this.state.stats;
    this.statsDirty = true;
    if (this.state.stats) this.hideHelp();
  }

  toggleSave(): void {
    if (this.compact) this.toggleSheet('save');
    else this.saveOpen = !this.saveOpen;
  }

  /** 顶栏、帮助和图例：只在创建和切换语言时重写，按钮的开关状态由 refresh 每帧补上 */
  private renderStatic(): void {
    const sc = (key: string) => t('ui.shortcut', { key });
    const toggle = (a: string, label: string, key?: string) =>
      key ? `<button data-a="${a}" id="btn-${a}" title="${sc(key)}">${label} <kbd>${key}</kbd></button>` : `<button data-a="${a}" id="btn-${a}">${label}</button>`;
    const cur = getLang();
    const tools = this.tools?.defs ?? [];
    const title = `<div class="title">${this.opt.title()} <em>${this.opt.subtitle()}</em></div>`;
    const clock = `<div class="clock"><span id="dayicon"></span><span id="clock"></span><span id="temp"></span></div>`;
    const repo = this.opt.repoUrl ? `<a class="repo" href="${this.opt.repoUrl}" target="_blank" rel="noopener" title="${t('ui.repoTitle')}">${GITHUB}<span>GitHub</span></a>` : '';
    const speeds = SPEEDS.map((s) => `<button data-a="speed" data-v="${s}">${s}×</button>`).join('');
    const B = ENGINE.render.brightness;
    const bright = `<div class="bright">${BRIGHTNESS_KEYS.map(
      (k) =>
        `<label class="slider" id="bright-${k}"><span>${t(`ui.bright.${k}`)}</span><input type="range" min="${B.min}" max="${B.max}" step="${B.step}" value="${this.brightness?.[k] ?? 1}" data-bright="${k}"><output></output></label>`,
    ).join('')}<button data-a="brightReset">${t('ui.brightReset')}</button></div>`;
    const bgBtn = `<button data-a="background" id="btn-background" class="bg${BACKGROUND_LIMITED ? ' limited' : ''}" title="${t(BACKGROUND_LIMITED ? 'ui.backgroundLimitedTitle' : 'ui.backgroundTitle')}">${t('ui.background')}</button>`;
    if (this.compact) {
      this.top.innerHTML = `
        <div class="tb-row">
          ${title}${clock}
          <div class="tb-acts">
            <button data-a="pause" id="btn-pause" title="${t('ui.pause')}">⏸</button>
            <div class="popwrap">
              <button data-a="menu" data-v="0" id="btn-speedmenu" title="${t('ui.groupSpeed')}"></button>
              <div class="pop hidden"><div class="speeds">${speeds}</div>${bgBtn}</div>
            </div>
            <div class="popwrap">
              <button data-a="menu" data-v="1" title="${t('ui.more')}" aria-label="${t('ui.more')}">${ICON.more}</button>
              <div class="pop hidden">
                <div class="perf" id="perf"></div>
                <div class="label" id="quality-label"></div>
                <div class="opts" id="quality-opts">${QUALITY_MODES.map((m, i) => `<button data-a="quality" data-v="${i}">${t(`quality.${m}`)}</button>`).join('')}</div>
                <div class="label" title="${t('ui.brightTitle')}">${t('ui.brightness')}</div>
                ${bright}
                <button data-a="music" id="btn-music" title="${t('ui.musicTitle')}">${t('ui.music')}</button>
                <button data-a="help">${t('ui.help')}</button>
                <button data-a="savePanel" id="btn-save">${t('save.title')}</button>
                <button data-a="install" id="btn-install" class="hidden" title="${t('ui.installTitle')}">${t('ui.install')}</button>
                <div class="label">${GLOBE}${t('ui.language')}</div>
                <div class="langs">${LANGS.map((l, i) => `<button data-a="lang" data-v="${i}" class="${l === cur ? 'on' : ''}">${LANG_NAMES[l]}</button>`).join('')}</div>
                ${repo}
              </div>
            </div>
          </div>
        </div>`;
      const dockBtn = (s: Sheet, icon: string, label: string) => `<button data-a="sheet" data-v="${SHEETS.indexOf(s)}">${icon}<span>${label}</span></button>`;
      this.dockEl.innerHTML =
        dockBtn('colony', this.ui.panel.icon, this.ui.panel.label()) +
        this.views
          .filter((v) => v.dock)
          .map((v) => `<button data-a="${v.id}" id="btn-${v.id}">${v.dock!.icon}<span>${v.dock!.label()}</span></button>`)
          .join('') +
        dockBtn('views', ICON.views, t('ui.groupView')) +
        (tools.length ? dockBtn('tools', ICON.tools, t('ui.groupTools')) : '') +
        dockBtn('events', ICON.events, t('dock.events'));
      this.viewsEl.innerHTML = `<h3>${t('ui.groupView')}</h3><div class="grid">${this.views
        .filter((v) => !v.dock)
        .map((v) => `<button data-a="${v.id}" id="btn-${v.id}">${v.label()}</button>`)
        .join('')}</div>`;
      this.toolboxEl.innerHTML = tools.length
        ? `<h3>${t('ui.groupTools')}</h3><div class="grid">${tools
            .map((d, i) => `<button data-a="tool" data-v="${i}"><b>${tr(d.name)}</b><small>${d.options.map((o) => cap(tr(o.label))).join(' · ')}</small></button>`)
            .join('')}</div>`
        : '';
    } else {
      this.dockEl.innerHTML = this.viewsEl.innerHTML = this.toolboxEl.innerHTML = '';
      const toolGroup = tools.length
        ? `
        <div class="group" id="tools">
          <span class="label">${t('ui.groupTools')}</span>
          ${tools.map((d, i) => `<button data-a="tool" data-v="${i}" title="${t('ui.toolTitle', { key: d.key })}">${tr(d.name)} <kbd>${d.key}</kbd></button>`).join('')}
        </div>`
        : '';
      this.top.innerHTML = `
      <div class="tb-row">
        ${title}${clock}
        <div class="perf" id="perf"></div>
        <div class="meta">
          <button data-a="quality" id="btn-quality" title="${t('ui.qualityTitle')}"></button>
          <div class="drop" id="bright">
            <button data-a="brightMenu" id="btn-bright" title="${t('ui.brightTitle')}" aria-haspopup="true" aria-expanded="false">${t('ui.brightness')}<i class="caret"></i></button>
            <div class="menu hidden" id="bright-menu"><div class="hint">${t('ui.brightTitle')}</div>${bright}</div>
          </div>
          <button data-a="music" id="btn-music" title="${t('ui.musicTitle')}">${t('ui.music')} <kbd>M</kbd></button>
          <button data-a="help" title="${sc('H')}">${t('ui.help')} <kbd>H</kbd></button>
          <button data-a="savePanel" id="btn-save" title="${t('save.buttonTitle')}">${t('save.title')}</button>
          <div class="drop" id="lang">
            <button data-a="langMenu" id="btn-lang" title="${t('ui.langTitle')}" aria-haspopup="menu" aria-expanded="false">${GLOBE}${LANG_NAMES[cur]}<i class="caret"></i></button>
            <div class="menu hidden" id="lang-menu" role="menu">
              ${LANGS.map((l, i) => `<button data-a="lang" data-v="${i}" role="menuitemradio" aria-checked="${l === cur}" class="${l === cur ? 'on' : ''}">${LANG_NAMES[l]}</button>`).join('')}
            </div>
          </div>
          ${repo}
        </div>
      </div>
      <div class="tb-row controls">
        <div class="group" id="speeds">
          <span class="label">${t('ui.groupSpeed')}</span>
          <button data-a="pause" id="btn-pause" title="${sc(t('ui.space'))}">⏸</button>
          ${speeds}
          ${bgBtn}
        </div>
        <div class="group">
          <span class="label">${t('ui.groupView')}</span>
          ${this.views.map((v) => toggle(v.id, v.label(), v.key)).join('')}
        </div>${toolGroup}
      </div>`;
    }
    const lines = (isTouch() ? this.ui.help.touch : this.ui.help.mouse).map((k) => (this.compact && k === 'help.events' ? 'help.dockEvents' : k));
    // 手机布局的“添加到主屏幕”在“更多”菜单里，平板放在帮助里，免得挤占顶栏
    const install = this.compact ? '' : `<div class="install hidden" id="install-row"><button data-a="install" id="btn-install">${t('ui.install')}</button><span>${t('ui.installTitle')}</span></div>`;
    this.helpEl.innerHTML = `<b>${t('help.title')}</b>` + lines.map((k) => `<div>${t(k)}</div>`).join('') + install;
    this.legendEl.innerHTML = this.ui.legend?.html() ?? '';
  }

  /** 桌面顶栏的下拉菜单（语言、亮度） */
  private setDrop(id: string, open: boolean): void {
    const menu = document.getElementById(`${id}-menu`);
    if (!menu || menu.classList.contains('hidden') === !open) return;
    menu.classList.toggle('hidden', !open);
    document.getElementById(`btn-${id}`)!.setAttribute('aria-expanded', String(open));
  }

  setLangMenu(open: boolean): void {
    this.setDrop('lang', open);
  }

  toggleLangMenu(): void {
    this.setLangMenu(!!document.getElementById('lang-menu')?.classList.contains('hidden'));
  }

  setBrightMenu(open: boolean): void {
    this.setDrop('bright', open);
  }

  toggleBrightMenu(): void {
    this.setBrightMenu(!!document.getElementById('bright-menu')?.classList.contains('hidden'));
  }

  /** 亮度滑块的数值；圆点标出现在起作用的是哪一档 */
  syncBrightness(): void {
    const br = this.brightness;
    if (!br) return;
    const now: BrightnessKey = this.world.clock.daylight >= 0.5 ? 'day' : 'night';
    for (const k of BRIGHTNESS_KEYS) {
      const row = document.getElementById(`bright-${k}`);
      if (!row) continue;
      row.classList.toggle('now', k === now);
      row.querySelector('output')!.textContent = `${Math.round(br[k] * 100)}%`;
      const input = row.querySelector('input')!;
      if (document.activeElement !== input) input.value = String(br[k]);
    }
  }

  /** 切换语言后重写所有界面文字，包括已经产生的事件和日志 */
  relocalize(): void {
    this.renderStatic();
    this.menu = null;
    this.syncDock();
    this.toolKey = '';
    this.saveKey = '';
    this.eventsKey = '';
    this.statsDirty = true;
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
        <div class="row">${t('save.seed', { seed: this.opt.seed })} <small>${t('save.seedHint')}</small></div>
        <div class="opts">
          <button data-a="saveNow">${t('save.now')} <kbd>Ctrl S</kbd></button>
          <button data-a="loadSave" ${m ? '' : 'disabled'}>${t('save.load')}</button>
          <button data-a="newGame" class="danger">${t('save.new')}</button>
        </div>`;
    }
    document.getElementById('save-status')!.textContent = m
      ? t('save.status', {
          stamp: m.seconds !== undefined ? tr(this.world.clock.stampAt(m.seconds)) : (m.stamp ?? ''),
          what: this.opt.describeSave(m),
          ago: agoText(Date.now() - m.savedAt),
        })
      : t('save.none');
  }

  toggleHelp(): void {
    if (this.compact) this.toggleSheet('help');
    else this.helpEl.classList.toggle('hidden');
  }

  hideHelp(): void {
    if (!this.compact) this.helpEl.classList.add('hidden');
    else if (this.sheet === 'help') this.setSheet(null);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = Math.max(2.2, Math.min(6, msg.length * 0.09));
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  refresh(sel: R | null, fps: number, perf?: { sim: number; views: number; render: number }): void {
    const w = this.world;
    const c = w.clock;
    document.getElementById('clock')!.textContent = tr(c.stamp());
    const st = this.ui.status(this.compact);
    document.getElementById('dayicon')!.textContent = st.icon;
    document.getElementById('temp')!.textContent = st.text;
    const pe = document.getElementById('perf')!;
    const lagging = !c.paused && w.effectiveSpeed < c.speed * 0.9;
    pe.textContent =
      t('ui.perf', { fps: Math.round(fps) }) +
      this.ui.perfExtra() +
      (perf ? t('ui.perfTimes', { sim: perf.sim.toFixed(1), view: (perf.views + perf.render).toFixed(1) }) : '') +
      (lagging ? t('ui.perfLag', { x: w.effectiveSpeed.toFixed(1) }) : '') +
      (this.quality?.idle ? t('ui.perfIdle') : '');
    pe.classList.toggle('lag', lagging);
    if (perf) pe.title = t('ui.perfTitle', { sim: perf.sim.toFixed(2), views: perf.views.toFixed(2), render: perf.render.toFixed(2) });
    this.top.querySelectorAll<HTMLButtonElement>('[data-a="speed"]').forEach((b) => {
      b.classList.toggle('on', !c.paused && Number(b.dataset.v) === c.speed);
    });
    document.getElementById('btn-pause')!.classList.toggle('on', c.paused);
    document.getElementById('btn-music')!.classList.toggle('on', !!this.music?.enabled);
    this.syncBrightness();
    const sm = document.getElementById('btn-speedmenu');
    if (sm) sm.textContent = `${c.speed}×`;
    document.body.classList.toggle('show-info', !!sel);
    document.getElementById('btn-background')!.classList.toggle('on', this.state.background && !BACKGROUND_LIMITED);
    const canInstall = !!this.installer?.kind;
    document.getElementById('btn-install')!.classList.toggle('hidden', !canInstall);
    document.getElementById('install-row')?.classList.toggle('hidden', !canInstall);
    const ql = document.getElementById(this.compact ? 'quality-label' : 'btn-quality');
    if (ql) ql.textContent = t('ui.quality', { q: this.qualityLabel() });
    this.top.querySelectorAll<HTMLElement>('#quality-opts button').forEach((b) => b.classList.toggle('on', QUALITY_MODES[Number(b.dataset.v)] === this.quality?.mode));
    for (const v of this.views) document.getElementById(`btn-${v.id}`)?.classList.toggle('on', v.on());
    this.statsEl.classList.toggle('hidden', !this.state.stats);
    this.legendEl.classList.toggle('hidden', !this.ui.legend?.visible());
    if (this.state.stats && this.ui.stats) {
      this.ui.stats.draw(this.statsDirty);
      this.statsDirty = false;
    }
    this.renderTool();
    this.renderSave();

    this.colonyEl.innerHTML = this.ui.panel.html(this.colonyFolded);
    this.renderInfo(sel);
    const events = w.events.entries;
    const texts = events.map((e) => `<span>${when(this.world.clock, e.t)}</span>${esc(tr(e.msg))}`);
    const key = texts.join('|');
    if (key !== this.eventsKey) {
      this.eventsKey = key;
      this.shownEvents = events.slice();
      const title = t('ui.eventTitle');
      this.eventsEl.innerHTML =
        `<h3>${t('events.title')}</h3>` +
        (events.map((e, i) => (e.at ? `<div class="go" data-ev="${i}" title="${title}">${texts[i]}</div>` : `<div>${texts[i]}</div>`)).join('') || `<p>${t('events.none')}</p>`);
    }
    this.layout();
  }

  /** 工具选项面板：只在工具或选项变化时重写 DOM，避免点击时按钮被替换 */
  renderTool(): void {
    const tc = this.tools;
    const active = tc?.active ?? -1;
    document.querySelectorAll<HTMLButtonElement>('#topbar [data-a="tool"], #toolbox [data-a="tool"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === active));
    document.body.classList.toggle('tooling', active >= 0);
    this.syncDock();
    const key = tc && active >= 0 ? `${active}:${tc.option[active]}:${tc.pending ? 1 : 0}` : '';
    if (key === this.toolKey) return;
    this.toolKey = key;
    this.toolEl.classList.toggle('hidden', !key);
    if (!tc || !key) return;
    const d = tc.defs[active];
    const cur = tc.option[active];
    const touch = isTouch();
    const actions = [
      d.options[cur].len ? `<button data-a="toolRotate">${t('tool.rotate')} <kbd>R</kbd></button>` : '',
      tc.pending ? `<button data-a="toolPlace" class="place">${t('tool.place')}</button>` : touch ? `<span class="tap">${t('tool.tapHint')}</span>` : '',
    ].join('');
    this.toolEl.innerHTML = `
      <div class="head"><b>${tr(d.name)}</b><span>${tr(d.hint)}</span></div>
      <div class="opts">
        ${d.options.map((o, i) => `<button data-a="toolopt" data-v="${i}" class="${i === cur ? 'on' : ''}">${cap(tr(o.label))}</button>`).join('')}
        <button data-a="toolexit" class="exit">${t('tool.exit')} <kbd>Esc</kbd></button>
      </div>
      ${actions ? `<div class="opts acts">${actions}</div>` : ''}`;
  }

  /** 面板的位置由 CSS 按这几个变量排：顶栏下沿、底栏高度（横屏时是左侧竖排的宽度）、事件列表和图例的高度 */
  private layout(): void {
    const s = document.body.style;
    s.setProperty('--top', `${Math.round(this.top.getBoundingClientRect().bottom + 6)}px`);
    const dock = this.compact ? this.dockEl.getBoundingClientRect() : null;
    const land = document.body.classList.contains('land');
    s.setProperty('--dock', `${dock && !land ? Math.round(innerHeight - dock.top) : 0}px`);
    s.setProperty('--rail', `${dock && land ? Math.round(dock.right) : 0}px`);
    s.setProperty('--events', `${this.compact ? 0 : this.eventsEl.offsetHeight}px`);
    s.setProperty('--legend', `${this.ui.legend?.visible() ? this.legendEl.offsetHeight + 10 : 0}px`);
  }

  private renderInfo(sel: R | null): void {
    if (!sel) {
      this.infoEl.classList.add('empty');
      this.infoEl.innerHTML = `<div class="hint">${this.ui.infoHint()}</div>`;
      return;
    }
    this.infoEl.classList.remove('empty');
    this.infoEl.innerHTML = renderInfo(this.ui.info, sel) + `<div class="actions"><button data-a="deselect">${t('info.deselect')} <kbd>Esc</kbd></button></div>`;
  }
}

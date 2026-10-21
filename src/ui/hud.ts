import { CONFIG, ROLE_COLORS, ROLE_NAMES, type Role } from '../config';
import { CHAMBER_INFO } from '../nest/nest';
import { FOOD_KIND_NAMES } from '../world/food';
import { PREDATOR_INFO, Spider, type SpiderState } from '../world/predators';
import { ITEM_NAMES } from '../sim/items';
import type { ColonySample } from '../sim/colony';
import { OBSTACLE_INFO } from '../world/vegetation';
import type { World } from '../world/world';
import type { Selection } from './picking';
import { TOOLS, type ToolController } from './tools';
import type { SaveMeta } from './saveSlot';

const ROLE_DESC: Record<Role, string> = {
  queen: '蚁群唯一的繁殖者。婚飞交配后脱落翅膀、独自建巢，此后终生产卵；交配时储存的精子可使用十余年。',
  nurse: '多为羽化不久的年轻工蚁，留在巢内照料卵、幼虫和蛹，喂养幼虫与蚁后，帮助新蚁破茧。随年龄增长会逐渐转向巢外工作。',
  maintenance: '中年工蚁，负责挖掘扩建隧道、把垃圾和同伴尸体运出巢外、在巢口警戒巡逻。',
  forager: '年长工蚁，承担风险最高的巢外工作：搜索并搬运食物、放牧蚜虫，返巢时沿途释放路径信息素招募同伴。侦察蚁更倾向于探索未知区域。',
};

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
  | 'newGame';

const SPEEDS = [1, 2, 5, 10, 20];

const SPIDER_STATE: Record<SpiderState, string> = {
  wander: '四处游荡，寻找猎物',
  pause: '伏地不动，感知振动',
  chase: '正在扑向一只蚂蚁',
  feed: '正在进食',
  leave: '吃饱了，正在离开',
};

function bar(v: number, color: string): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<span class="bar"><i style="width:${p}%;background:${color}"></i></span>`;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function agoText(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s < 10) return '刚刚';
  if (s < 60) return `${Math.floor(s / 10) * 10} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
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
  const L = 38;
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
    g.fillText('数据积累中…', L + 10, T + 30);
    return;
  }
  let max = 0;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  const ymax = niceMax(max * 1.05);
  const d0 = days[0];
  const d1 = days[days.length - 1];
  const px = (d: number) => L + ((d - d0) / Math.max(1e-6, d1 - d0)) * (W - L - R);
  const py = (v: number) => H - B - (v / ymax) * (H - T - B);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.fillStyle = '#8f877a';
  g.lineWidth = 1;
  g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    const y = Math.round(py(v)) + 0.5;
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(W - R, y);
    g.stroke();
    g.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), L - 4, y + 4);
  }
  g.textAlign = 'center';
  const span = d1 - d0;
  const stepD = span > 12 ? 4 : span > 5 ? 2 : span > 1.5 ? 1 : 0.25;
  for (let d = Math.ceil(d0 / stepD) * stepD; d <= d1; d += stepD) {
    const label = stepD < 1 ? `${Math.round((d % 1) * 24)}时` : `第${Math.floor(d) + 1}天`;
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
  state = { xray: false, forcedXray: false, pheromone: false, roleColors: false, grass: true, stats: false, following: false };

  constructor(private world: World) {
    this.top.innerHTML = `
      <div class="title">赛博养蚂蚁 <em>黑毛蚁 Lasius niger</em></div>
      <div class="clock"><span id="dayicon"></span><span id="clock"></span><span id="temp"></span></div>
      <div class="group" id="speeds">
        <button data-a="pause" id="btn-pause" title="快捷键 空格">⏸</button>
        ${SPEEDS.map((s) => `<button data-a="speed" data-v="${s}">${s}×</button>`).join('')}
      </div>
      <div class="group">
        <button data-a="xray" id="btn-xray" title="快捷键 X">地下透视 <kbd>X</kbd></button>
        <button data-a="pheromone" id="btn-pheromone" title="快捷键 P">信息素 <kbd>P</kbd></button>
        <button data-a="roleColors" id="btn-roleColors" title="快捷键 C">分工着色 <kbd>C</kbd></button>
        <button data-a="grass" id="btn-grass" title="快捷键 G">草丛 <kbd>G</kbd></button>
        <button data-a="stats" id="btn-stats" title="快捷键 T">统计 <kbd>T</kbd></button>
        <button data-a="help" title="快捷键 H">帮助 <kbd>H</kbd></button>
      </div>
      <div class="group" id="tools">
        ${TOOLS.map((t, i) => `<button data-a="tool" data-v="${i}" title="快捷键 ${t.key}，重复按切换选项">${t.name} <kbd>${t.key}</kbd></button>`).join('')}
      </div>
      <div class="group">
        <button data-a="savePanel" id="btn-save" title="保存、读取存档或重新开始">存档</button>
      </div>
      <div class="perf" id="perf"></div>`;
    this.helpEl.innerHTML = `
      <b>操作</b>
      <div><kbd>W A S D</kbd> 移动　<kbd>Q</kbd>/<kbd>E</kbd> 下降/上升　<kbd>Shift</kbd> 加速</div>
      <div>左键拖拽 转视角　右键拖拽 平移　滚轮 推进/拉远</div>
      <div>左键单击 选择蚂蚁/房间/食物/植物　双击 飞到目标</div>
      <div><kbd>F</kbd> 跟随选中的蚂蚁　<kbd>Esc</kbd> 取消选择　<kbd>空格</kbd> 暂停/继续</div>
      <div><kbd>1</kbd>–<kbd>5</kbd> 切换倍速　<kbd>X</kbd> 地下透视　<kbd>P</kbd> 信息素　<kbd>C</kbd> 分工着色　<kbd>G</kbd> 草丛　<kbd>T</kbd> 统计曲线</div>
      <div><kbd>6</kbd> 投食　<kbd>7</kbd> 障碍　<kbd>8</kbd> 浇水　<kbd>9</kbd> 天敌（重复按切换选项，<kbd>Esc</kbd> 退出工具）　<kbd>Ctrl</kbd>+<kbd>S</kbd> 保存（也会自动保存）</div>`;
    this.statsEl.innerHTML = `
      <canvas id="chart-pop"></canvas>
      <canvas id="chart-food"></canvas>`;
    this.legendEl.innerHTML = `
      <div><i style="background:linear-gradient(90deg,#ff7a2a,#fff07a)"></i>路径信息素：携带食物返巢的工蚁释放，约 1.5 分钟减半</div>
      <div><i style="background:#3c96ff"></i>领地足迹：所有工蚁在地表留下的碳氢化合物，挥发很慢</div>
      <div><i style="background:transparent;border:2px solid #ff4a3a;height:4px"></i>警报信息素：受到攻击时释放，几秒内散去，附近的工蚁会赶来围攻</div>`;
    const handler = (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!b) return;
      this.onAction?.(b.dataset.a as HudAction, b.dataset.v ? Number(b.dataset.v) : undefined);
    };
    this.top.addEventListener('click', handler);
    this.infoEl.addEventListener('click', handler);
    this.helpEl.addEventListener('click', handler);
    this.toolEl.addEventListener('click', handler);
    this.saveEl.addEventListener('click', handler);
    this.infoEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.statsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.toolEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.saveEl.addEventListener('pointerdown', (e) => e.stopPropagation());
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
        <div class="head"><b>存档</b>保存在本浏览器里；每分钟和关闭页面时自动保存</div>
        <div class="row" id="save-status"></div>
        <div class="opts">
          <button data-a="saveNow">立即保存 <kbd>Ctrl S</kbd></button>
          <button data-a="loadSave" ${m ? '' : 'disabled'}>读取上次存档</button>
          <button data-a="newGame" class="danger">重新开始</button>
        </div>`;
    }
    document.getElementById('save-status')!.textContent = m ? `上次保存：${m.stamp}，${m.ants} 只蚂蚁（${agoText(Date.now() - m.savedAt)}）` : '还没有存档';
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
    document.getElementById('clock')!.textContent = c.stamp();
    const wp = w.weather.phase;
    document.getElementById('dayicon')!.textContent = wp === 'rain' ? '🌧️' : wp === 'overcast' ? '☁️' : c.isNight ? '🌙' : c.daylight < 0.6 ? '🌅' : '☀️';
    document.getElementById('temp')!.textContent = `${w.weather.label} · 地表 ${c.temperatureAt(0).toFixed(1)}°C · 湿度 ${Math.round(c.humidityAt(0))}%`;
    const pe = document.getElementById('perf')!;
    const lagging = !c.paused && w.effectiveSpeed < c.speed * 0.9;
    pe.textContent = `${Math.round(fps)} FPS · ${w.colony.ants.length} 只${perf ? ` · 模拟 ${perf.sim.toFixed(1)} / 画面 ${(perf.views + perf.render).toFixed(1)} ms` : ''}${lagging ? ` · 实际 ${w.effectiveSpeed.toFixed(1)}×` : ''}`;
    pe.classList.toggle('lag', lagging);
    if (perf) pe.title = `每帧主线程耗时：模拟 ${perf.sim.toFixed(2)} ms，视图同步 ${perf.views.toFixed(2)} ms，提交渲染 ${perf.render.toFixed(2)} ms`;
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
    this.eventsEl.innerHTML = w.colony.events.map((e) => `<div><span>${e.t}</span>${esc(e.msg)}</div>`).join('');
    this.layout();
  }

  /** 工具选项面板：只在工具或选项变化时重写 DOM，避免点击时按钮被替换 */
  renderTool(): void {
    const t = this.tools;
    const active = t?.active ?? -1;
    this.top.querySelectorAll<HTMLButtonElement>('[data-a="tool"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === active));
    document.body.classList.toggle('tooling', active >= 0);
    const key = t && active >= 0 ? `${active}:${t.option[active]}` : '';
    if (key === this.toolKey) return;
    this.toolKey = key;
    this.toolEl.classList.toggle('hidden', !key);
    if (!t || !key) return;
    const d = TOOLS[active];
    const cur = t.option[active];
    this.toolEl.innerHTML = `
      <div class="head"><b>${d.name}</b><span>${d.hint}</span></div>
      <div class="opts">
        ${d.options.map((o, i) => `<button data-a="toolopt" data-v="${i}" class="${i === cur ? 'on' : ''}">${o.label}</button>`).join('')}
        <button data-a="toolexit" class="exit">退出 <kbd>Esc</kbd></button>
      </div>`;
  }

  private layout(): void {
    const top = Math.round(this.top.getBoundingClientRect().bottom + 8);
    const H = window.innerHeight;
    this.colonyEl.style.top = this.infoEl.style.top = this.saveEl.style.top = `${top}px`;
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
    drawChart(document.getElementById('chart-pop') as HTMLCanvasElement, '人口', days, [
      { label: '保育蚁', color: hex(ROLE_COLORS.nurse), values: pick('nurse') },
      { label: '内务蚁', color: hex(ROLE_COLORS.maintenance), values: pick('maintenance') },
      { label: '觅食蚁', color: hex(ROLE_COLORS.forager), values: pick('forager') },
      { label: '幼体', color: '#f3ead0', values: pick('brood'), dash: true },
      { label: '巢外', color: '#9d9484', values: pick('outside'), dash: true },
    ]);
    drawChart(document.getElementById('chart-food') as HTMLCanvasElement, '食物储备（份）', days, [
      { label: '储食室', color: '#c0703a', values: pick('food') },
      { label: '社会胃', color: '#f2c25a', values: pick('liquid') },
      { label: '合计', color: '#e9e4da', values: h.map((x) => x.food + x.liquid), dash: true },
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
      const t = r === 'queen' ? '' : ` <small>/ ${tg[r]}</small>`;
      return `<div class="row"><span class="dot" style="background:${hex(ROLE_COLORS[r])}"></span>${ROLE_NAMES[r]}<b>${rc[r]}${t}</b></div>`;
    };
    const aph = w.aphids.colonies;
    const known = aph.filter((a) => a.discovered).length;
    const ex = col.expansion;
    const p = ex.project;
    let build = '<div class="row sub">扩建<b>无</b></div>';
    if (p) {
      const prog = p.chamber ? p.soil / p.soilNeeded : p.face.len / p.face.full.length;
      build = `<div class="row sub">扩建<b>${CHAMBER_INFO[p.type].name}</b></div>
      <div class="row sub">${p.chamber ? '挖房间' : '挖隧道'} ${bar(prog, '#d9a066')}</div>`;
    }
    this.colonyEl.innerHTML = `
      <h3>蚁群概况</h3>
      <div class="row big">成虫总数<b>${col.ants.length}</b></div>
      ${roleRow('queen')}${roleRow('nurse')}${roleRow('maintenance')}${roleRow('forager')}
      <div class="row sub">其中侦察蚁<b>${scouts}</b></div>
      <div class="row sub">斜线后为按需分工的目标</div>
      <div class="row">正在巢外活动<b>${col.outsideCount()}</b></div>
      <h3>幼体</h3>
      <div class="row">卵 / 幼虫 / 蛹<b>${bc.egg} / ${bc.larva} / ${bc.pupa}</b></div>
      <div class="row sub">蛹集中在<b>${w.nest.chambers[col.pupaChamber]?.name ?? '-'}</b></div>
      <h3>资源</h3>
      <div class="row">储食室<b>${col.foodStock.toFixed(0)} 份</b></div>
      <div class="row">社会胃（嗉囊甜液）<b>${col.liquidStock.toFixed(0)} 份</b></div>
      <div class="row">蚁后饱食度 ${bar(1 - col.queen.hunger, '#ffb13b')}</div>
      <div class="row">地表食物源<b>${w.food.sources.length}</b></div>
      <div class="row">已发现的蚜虫群<b>${known} / ${aph.length}</b></div>
      <h3>蚁穴</h3>
      <div class="row">房间<b>${w.nest.chambers.filter((c) => c.ready).length}</b></div>
      <div class="row">拥挤程度 ${bar(ex.occupancy(), ex.occupancy() > 0.88 ? '#e0803a' : '#7ec06a')}</div>
      ${build}
      <h3>累计</h3>
      <div class="grid">
        <span>产卵</span><b>${st.eggsLaid}</b><span>羽化</span><b>${st.emerged}</b>
        <span>死亡</span><b>${st.deaths}</b><span>带回食物</span><b>${st.foodCollected}</b>
        <span>采集蜜露</span><b>${st.honeydew.toFixed(0)}</b><span>交哺</span><b>${st.trophallaxis}</b>
        <span>运出垃圾</span><b>${st.wasteRemoved}</b><span>挖出土粒</span><b>${st.soilExcavated}</b>
        <span>分工转换</span><b>${st.roleChanges}</b><span>触角接触</span><b>${st.contacts >= 10000 ? (st.contacts / 1000).toFixed(0) + 'k' : st.contacts}</b>
        <span>被天敌捕食</span><b>${st.preyed}</b><span>赶走狼蛛</span><b>${st.repelled}</b>
      </div>`;
  }

  private renderInfo(sel: Selection | null): void {
    if (!sel) {
      this.infoEl.classList.add('empty');
      this.infoEl.innerHTML = `<div class="hint">点击蚂蚁、蚁穴房间（地下透视模式）、食物或植物查看详情</div>`;
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
        html = `<h2>石块</h2><p class="desc">石块白天吸热、夜间缓慢放热，下方土壤温暖且不易干燥。黑毛蚁常把蚁巢建在石块下方，利用这种微环境育幼。</p>`;
        break;
      case 'plant':
        html = this.plantInfo(sel.id);
        break;
      case 'placed': {
        const p = this.world.veg.placedById(sel.id);
        html = p
          ? `<h2>${OBSTACLE_INFO[p.kind].name}<span class="tag next">你放置的</span></h2>
             <p class="desc">${p.kind === 'twig' ? '横在地上的树枝会截断蚂蚁的路线。被挡住的蚂蚁会沿着树枝走到尽头再绕过去，信息素路径也会随之改道。' : '蚂蚁不会爬上石块，而是贴着边缘绕行。大石块会让路过的蚂蚁明显绕路。'}</p>
             <div class="actions"><button data-a="removePlaced" data-v="${p.id}">移除</button></div>`
          : '<h2>障碍物</h2><p class="desc">已被移除。</p>';
        break;
      }
      case 'puddle': {
        const p = this.world.water.byId(sel.id);
        html = p
          ? `<h2>水洼</h2>
             <p class="desc">蚂蚁会绕开积水。水会冲掉地面上的路径信息素和足迹，原本沿路径往返的觅食蚁要重新搜索。气温越高蒸发得越快。</p>
             <div class="kv"><span>半径</span><b>${p.r.toFixed(1)} cm</b><span>剩余水量</span><b>${bar(p.water, '#5f9ccc')}</b></div>`
          : '<h2>水洼</h2><p class="desc">已经蒸发、渗进土里了。</p>';
        break;
      }
      case 'predator':
        html = this.predatorInfo(sel.id);
        break;
    }
    this.infoEl.innerHTML = html + `<div class="actions"><button data-a="deselect">取消选择 <kbd>Esc</kbd></button></div>`;
  }

  private predatorInfo(id: number): string {
    const p = this.world.predators.byId(id);
    if (!p) return '<h2>天敌</h2><p class="desc">它已经离开了。</p>';
    const info = PREDATOR_INFO[p.kind];
    const tag = p.placed ? '<span class="tag next">你放入的</span>' : '';
    let state: string;
    let extra = '';
    if (p instanceof Spider) {
      state = p.mob > 0 ? `正被 ${p.mob} 只工蚁围攻` : p.state === 'leave' && p.fled ? '被工蚁赶走，正在逃离' : SPIDER_STATE[p.state];
      const D = CONFIG.defense;
      extra = `<span>还能再吃</span><b>${Math.max(0, CONFIG.predators.spiderMeals - p.meals)} 只</b><span>被咬程度</span><b>${bar(p.harass / D.harassLimit, '#e0604a')}</b>`;
    } else state = p.feedT > 0 ? `正在进食（还要 ${Math.ceil(p.feedT)} 秒）` : '埋在坑底等待';
    return `<h2>${info.name}${tag}</h2>
      <p class="desc">${info.desc}</p>
      <div class="kv"><span>状态</span><b>${state}</b><span>已捕食</span><b>${p.caught} 只</b>${extra}</div>
      <div class="actions"><button data-a="removePredator" data-v="${p.id}">${p instanceof Spider ? '赶走' : '填平陷阱'}</button></div>`;
  }

  private antInfo(id: number): string {
    const w = this.world;
    const a = w.colony.antById(id);
    if (!a) return `<h2>工蚁 #${id}</h2><p class="desc">这只蚂蚁已经死亡，尸体会被内务蚁搬到巢外垃圾堆。</p>`;
    const isQ = a.role === 'queen';
    const tags = [`<span class="tag" style="background:${hex(ROLE_COLORS[a.role])}">${ROLE_NAMES[a.role]}</span>`];
    if (a.scout) tags.push('<span class="tag scout">侦察蚁</span>');
    if (a.nextRole) tags.push(`<span class="tag next">即将转为${ROLE_NAMES[a.nextRole]}</span>`);
    let carry = '无';
    if (a.carrying) {
      const it = a.carrying;
      carry = it.type === 'food' ? FOOD_KIND_NAMES[it.foodKind] : ITEM_NAMES[it.type];
    }
    const depth = a.domain === 'nest' ? `（深 ${a.depth(w).toFixed(0)} cm）` : a.climbing ? '（植物茎上）' : '';
    const logs = a.log.map((l) => `<li><span>${l.t}</span>${esc(l.msg)}</li>`).join('') || '<li>暂无记录</li>';
    const following = this.state.following;
    const herd = a.herd >= 0 ? w.aphids.byId(a.herd) : undefined;
    return `
      <h2>${isQ ? '蚁后' : '工蚁'} #${a.id} ${tags.join('')}</h2>
      <div class="kv">
        <span>当前行为</span><b class="act">${esc(a.activity)}</b>
        <span>位置</span><b>${a.locationLabel(w)}${depth}</b>
        <span>环境温度</span><b>${w.antTemperature(a).toFixed(1)}°C</b>
        <span>日龄</span><b>${isQ ? '约 3 年' : `${a.ageDays.toFixed(1)} 天 / 预期寿命 ${a.lifespan.toFixed(0)} 天`}</b>
        <span>体长</span><b>${(a.size * (isQ ? 9 : 4)).toFixed(1)} mm</b>
        <span>携带</span><b>${carry}</b>
        <span>嗉囊</span><b>${bar(a.crop, '#f2c25a')} ${Math.round(a.crop * 100)}%</b>
        <span>饱食度</span><b>${bar(1 - a.hunger, '#7ee06a')}</b>
        <span>健康</span><b>${bar(a.health, '#5fb8ff')}</b>
        ${isQ ? '' : `<span>社交</span><b>触角接触 ${a.contacts} 次 · 交哺 ${a.shares} 次</b>`}
        ${a.role === 'forager' ? `<span>运回食物</span><b>${a.delivered} 次</b>` : ''}
        ${herd ? `<span>放牧</span><b>照料一群约 ${Math.round(herd.count)} 只的蚜虫</b>` : ''}
      </div>
      <p class="desc">${ROLE_DESC[a.role]}</p>
      <h3>近期行为</h3>
      <ul class="log">${logs}</ul>
      <div class="actions">
        <button data-a="follow" class="${following ? 'on' : ''}">${following ? '停止跟随' : '跟随观察'} <kbd>F</kbd></button>
        <button data-a="flyto">飞到附近</button>
      </div>`;
  }

  private chamberInfo(id: number): string {
    const w = this.world;
    const c = w.nest.chambers[id];
    const col = w.colony;
    const t = w.chamberTemperature(c);
    const stoneBonus = t - w.clock.temperatureAt(c.depth);
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
    if (egg) rows.push(`<span>卵</span><b>${egg}</b>`);
    if (larva) rows.push(`<span>幼虫</span><b>${larva}（饥饿 ${hungry}）</b>`);
    if (pupa) rows.push(`<span>蛹</span><b>${pupa}（待羽化 ${ready}）</b>`);
    if (food) rows.push(`<span>食物</span><b>${food.toFixed(0)} 份</b>`);
    if (waste) rows.push(`<span>垃圾</span><b>${waste}</b>`);
    if (corpse) rows.push(`<span>尸体</span><b>${corpse}</b>`);
    if (!rows.length) rows.push('<span>内容物</span><b>空</b>');
    const antRows = (Object.keys(counts) as Role[])
      .filter((r) => counts[r] > 0)
      .map((r) => `<span><i class="dot" style="background:${hex(ROLE_COLORS[r])}"></i>${ROLE_NAMES[r]}</span><b>${counts[r]}</b>`)
      .join('');
    const pupaNote =
      c.type === 'pupa' || c.type === 'solar'
        ? `<span>蛹的去向</span><b>${col.pupaChamber === id ? '保育蚁正把蛹集中到这里' : '目前蛹被安置在另一处'}</b>`
        : '';
    const building = !c.ready
      ? `<span>挖掘进度</span><b>${bar(c.grow, '#d9a066')} ${Math.round(c.grow * 100)}%</b>`
      : '';
    return `
      <h2>${c.name}${c.ready ? '' : '<span class="tag next">扩建中</span>'}</h2>
      <p class="desc">${CHAMBER_INFO[c.type].desc}${c.underStone ? ' 这间房间正位于大石块下方。' : ''}</p>
      <div class="kv">
        ${building}
        <span>深度</span><b>${c.depth.toFixed(0)} cm</b>
        <span>尺寸</span><b>${(c.rx * 2 * 0.71).toFixed(0)} × ${(c.rz * 2 * 0.71).toFixed(0)} × ${(c.ry * 1.7).toFixed(0)} cm</b>
        <span>温度</span><b>${t.toFixed(1)}°C${stoneBonus > 0.05 ? `（石块 +${stoneBonus.toFixed(1)}°C）` : ''}</b>
        <span>相对湿度</span><b>${Math.round(h)}%</b>
        ${c.wet > 0.02 ? `<span>积水</span><b>${Math.round(c.wet * 100)}%${c.wet >= CONFIG.weather.floodedAt ? '（进水，蛹会被搬走、储食加快变质）' : ''}</b>` : ''}
        ${pupaNote}
      </div>
      <h3>内容物</h3><div class="kv">${rows.join('')}</div>
      <h3>房间内的蚂蚁</h3><div class="kv">${antRows || '<span>无</span><b></b>'}</div>
      <div class="actions"><button data-a="flyto">飞到房间</button></div>`;
  }

  private plantInfo(id: number): string {
    const w = this.world;
    const ac = w.aphids.byPlant(id);
    if (!ac) {
      return `<h2>草本植物</h2><p class="desc">蚂蚁会攀爬植物茎叶寻找小型猎物和花外蜜腺。黑毛蚁尤其喜欢照料聚集在嫩茎上的蚜虫，以获取它们分泌的蜜露。</p>`;
    }
    const now = w.clock.seconds;
    let onPlant = 0;
    let herders = 0;
    for (const a of w.colony.ants) {
      if (a.herd === ac.id) herders++;
      if (a.climbing && Math.hypot(a.pos.x - ac.x, a.pos.z - ac.z) < 1) onPlant++;
    }
    return `
      <h2>蚜虫群<span class="tag" style="background:#9bd04a">寄主植物</span></h2>
      <p class="desc">蚜虫吸食植物汁液，把多余的糖分以蜜露排出。黑毛蚁用触角拍打蚜虫“挤奶”，并驱赶瓢虫、草蛉等天敌作为回报——被照料的蚜虫群繁殖更快。蜜露是黑毛蚁最主要的糖类来源。</p>
      <div class="kv">
        <span>蚜虫数量</span><b>约 ${Math.round(ac.count)} 只</b>
        <span>积存蜜露</span><b>${bar(ac.honeydew / 6, '#f2c25a')} ${ac.honeydew.toFixed(1)} 份</b>
        <span>状态</span><b>${!ac.discovered ? '尚未被蚂蚁发现' : ac.tended(now) ? '正在被照料' : '暂时无人照料'}</b>
        <span>茎上的蚂蚁</span><b>${onPlant}</b>
        <span>固定照料者</span><b>${herders} 只</b>
        <span>累计被采集</span><b>${ac.collected.toFixed(1)} 份</b>
        <span>距蚁穴</span><b>${Math.hypot(ac.x, ac.z).toFixed(0)} cm</b>
      </div>
      <div class="actions"><button data-a="flyto">飞到附近</button></div>`;
  }

  private foodInfo(id: number): string {
    const w = this.world;
    const f = w.food.byId(id);
    if (!f) return `<h2>食物源</h2><p class="desc">这个食物源已经被搬空了。</p>`;
    let near = 0;
    for (const a of w.colony.ants) if (a.domain === 'surface' && Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.radius + 3) near++;
    const dist = Math.hypot(f.x, f.z);
    return `
      <h2>${f.info.name}${f.placed ? '<span class="tag next">你投放的</span>' : ''}</h2>
      <p class="desc">${f.info.desc}</p>
      <div class="kv">
        <span>食物类型</span><b>${FOOD_KIND_NAMES[f.kind]}</b>
        <span>剩余</span><b>${f.amount.toFixed(0)} / ${f.initial} 份 ${bar(f.fraction, '#e0a030')}</b>
        <span>距蚁穴</span><b>${dist.toFixed(0)} cm</b>
        <span>状态</span><b>${f.discovered ? '已被发现' : '尚未被发现'}</b>
        <span>周围的蚂蚁</span><b>${near}</b>
        <span>已搬走</span><b>${f.takenTotal} 份</b>
      </div>
      <div class="actions"><button data-a="flyto">飞到附近</button></div>`;
  }

  private entranceInfo(id: number): string {
    const w = this.world;
    const e = w.nest.entrances[id];
    let near = 0;
    for (const a of w.colony.ants) if (a.domain === 'surface' && Math.hypot(a.pos.x - e.x, a.pos.z - e.z) < 6) near++;
    let soil = 0;
    for (const it of w.colony.surfaceItems) if (it.place === 'mound') soil++;
    return `
      <h2>${e.name}与蚁丘</h2>
      <p class="desc">黑毛蚁把挖掘出的土粒堆在巢口周围，形成火山口状的小土丘。土丘能挡雨、吸收阳光为浅层育幼室加温。蚁穴通常有多个入口，便于通风和疏散。下雨前内务蚁会从里面用土粒把入口堵上，防止雨水灌进浅层房间，雨后地面晾干再清开。</p>
      <div class="kv">
        <span>状态</span><b>${e.plug >= 1 ? '已用土粒封住' : e.plug > 0 ? `封堵中 ${Math.round(e.plug * 100)}%` : '敞开'}</b>
        <span>入口附近的蚂蚁</span><b>${near}</b>
        <span>土丘上的土粒</span><b>${soil}</b>
        <span>累计挖出土粒</span><b>${w.colony.stats.soilExcavated}</b>
      </div>
      <div class="actions"><button data-a="flyto">飞到入口</button></div>`;
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
      <h2>巢外垃圾堆</h2>
      <p class="desc">工蚁把食物残渣、茧壳和同伴尸体集中堆放在巢外固定地点，远离育幼区，以降低病原体传播风险。负责搬运垃圾的工蚁通常不再回到育幼室工作。</p>
      <div class="kv">
        <span>垃圾</span><b>${waste}</b>
        <span>尸体</span><b>${corpse}</b>
        <span>累计运出</span><b>${w.colony.stats.wasteRemoved}</b>
      </div>
      <div class="actions"><button data-a="flyto">飞到附近</button></div>`;
  }
}

import { ROLE_COLORS, ROLE_NAMES, type Role } from '../config';
import { CHAMBER_INFO } from '../nest/nest';
import { FOOD_KIND_NAMES } from '../world/food';
import { ITEM_NAMES } from '../sim/items';
import type { World } from '../world/world';
import type { Selection } from './picking';

const ROLE_DESC: Record<Role, string> = {
  queen: '蚁群唯一的繁殖者。婚飞交配后脱落翅膀、独自建巢，此后终生产卵；交配时储存的精子可使用十余年。',
  nurse: '多为羽化不久的年轻工蚁，留在巢内照料卵、幼虫和蛹，喂养幼虫与蚁后，帮助新蚁破茧。随年龄增长会逐渐转向巢外工作。',
  maintenance: '中年工蚁，负责挖掘扩建隧道、把垃圾和同伴尸体运出巢外、在巢口警戒巡逻。',
  forager: '年长工蚁，承担风险最高的巢外工作：搜索并搬运食物，返巢时沿途释放路径信息素招募同伴。侦察蚁更倾向于探索未知区域。',
};

export type HudAction =
  | 'pause'
  | 'speed'
  | 'xray'
  | 'pheromone'
  | 'roleColors'
  | 'grass'
  | 'follow'
  | 'flyto'
  | 'deselect'
  | 'help';

const SPEEDS = [1, 2, 5, 10, 20];

function bar(v: number, color: string): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<span class="bar"><i style="width:${p}%;background:${color}"></i></span>`;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

export class Hud {
  private top = document.getElementById('topbar')!;
  private colonyEl = document.getElementById('colony')!;
  private infoEl = document.getElementById('info')!;
  private eventsEl = document.getElementById('events')!;
  private helpEl = document.getElementById('help')!;
  private toastEl = document.getElementById('toast')!;
  private toastTimer = 0;
  onAction: ((a: HudAction, arg?: number) => void) | null = null;
  state = { xray: false, forcedXray: false, pheromone: false, roleColors: false, grass: true, following: false };

  constructor(private world: World) {
    this.top.innerHTML = `
      <div class="title">黑毛蚁 <em>Lasius niger</em> 蚁群生态模拟</div>
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
        <button data-a="help" title="快捷键 H">帮助 <kbd>H</kbd></button>
      </div>
      <div class="perf" id="perf"></div>`;
    this.helpEl.innerHTML = `
      <b>操作</b>
      <div><kbd>W A S D</kbd> 移动　<kbd>Q</kbd>/<kbd>E</kbd> 下降/上升　<kbd>Shift</kbd> 加速</div>
      <div>左键拖拽 转视角　右键拖拽 平移　滚轮 推进/拉远</div>
      <div>左键单击 选择蚂蚁/房间/食物　双击 飞到目标</div>
      <div><kbd>F</kbd> 跟随选中的蚂蚁　<kbd>Esc</kbd> 取消选择　<kbd>空格</kbd> 暂停/继续</div>
      <div><kbd>1</kbd>–<kbd>5</kbd> 切换倍速　<kbd>X</kbd> 地下透视　<kbd>P</kbd> 信息素　<kbd>C</kbd> 分工着色　<kbd>G</kbd> 草丛</div>`;
    const handler = (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!b) return;
      this.onAction?.(b.dataset.a as HudAction, b.dataset.v ? Number(b.dataset.v) : undefined);
    };
    this.top.addEventListener('click', handler);
    this.infoEl.addEventListener('click', handler);
    this.helpEl.addEventListener('click', handler);
    this.infoEl.addEventListener('pointerdown', (e) => e.stopPropagation());
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

  refresh(sel: Selection | null, fps: number): void {
    const w = this.world;
    const c = w.clock;
    document.getElementById('clock')!.textContent = c.stamp();
    document.getElementById('dayicon')!.textContent = c.isNight ? '🌙' : c.daylight < 0.6 ? '🌅' : '☀️';
    document.getElementById('temp')!.textContent = `地表 ${c.temperatureAt(0).toFixed(1)}°C · 湿度 ${Math.round(c.humidityAt(0))}%`;
    document.getElementById('perf')!.textContent = `${Math.round(fps)} FPS · ${w.colony.ants.length} 只`;
    this.top.querySelectorAll<HTMLButtonElement>('[data-a="speed"]').forEach((b) => {
      b.classList.toggle('on', !c.paused && Number(b.dataset.v) === c.speed);
    });
    document.getElementById('btn-pause')!.classList.toggle('on', c.paused);
    const s = this.state;
    document.getElementById('btn-xray')!.classList.toggle('on', s.xray || s.forcedXray);
    document.getElementById('btn-pheromone')!.classList.toggle('on', s.pheromone);
    document.getElementById('btn-roleColors')!.classList.toggle('on', s.roleColors);
    document.getElementById('btn-grass')!.classList.toggle('on', s.grass);

    this.renderColony();
    this.renderInfo(sel);
    this.eventsEl.innerHTML = w.colony.events.map((e) => `<div><span>${e.t}</span>${esc(e.msg)}</div>`).join('');
  }

  private renderColony(): void {
    const col = this.world.colony;
    const rc = col.roleCounts();
    const bc = col.broodCounts();
    let scouts = 0;
    for (const a of col.ants) if (a.scout) scouts++;
    const st = col.stats;
    const roleRow = (r: Role) =>
      `<div class="row"><span class="dot" style="background:${hex(ROLE_COLORS[r])}"></span>${ROLE_NAMES[r]}<b>${rc[r]}</b></div>`;
    this.colonyEl.innerHTML = `
      <h3>蚁群概况</h3>
      <div class="row big">成虫总数<b>${col.ants.length}</b></div>
      ${roleRow('queen')}${roleRow('nurse')}${roleRow('maintenance')}${roleRow('forager')}
      <div class="row sub">其中侦察蚁<b>${scouts}</b></div>
      <div class="row">正在巢外活动<b>${col.outsideCount()}</b></div>
      <h3>幼体</h3>
      <div class="row">卵<b>${bc.egg}</b></div>
      <div class="row">幼虫<b>${bc.larva}</b></div>
      <div class="row">蛹<b>${bc.pupa}</b></div>
      <h3>资源</h3>
      <div class="row">储备食物<b>${col.foodStock.toFixed(0)} 份</b></div>
      <div class="row">蚁后饱食度 ${bar(1 - col.queen.hunger, '#ffb13b')}</div>
      <div class="row">地表食物源<b>${this.world.food.sources.length}</b></div>
      <h3>累计</h3>
      <div class="grid">
        <span>产卵</span><b>${st.eggsLaid}</b><span>羽化</span><b>${st.emerged}</b>
        <span>死亡</span><b>${st.deaths}</b><span>带回食物</span><b>${st.foodCollected}</b>
        <span>运出垃圾</span><b>${st.wasteRemoved}</b><span>挖出土粒</span><b>${st.soilExcavated}</b>
      </div>`;
  }

  private renderInfo(sel: Selection | null): void {
    if (!sel) {
      this.infoEl.classList.add('empty');
      this.infoEl.innerHTML = `<div class="hint">点击蚂蚁、蚁穴房间（地下透视模式）或食物查看详情</div>`;
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
        html = `<h2>草本植物</h2><p class="desc">蚂蚁会攀爬植物茎叶寻找小型猎物和花外蜜腺。黑毛蚁尤其喜欢照料聚集在嫩茎上的蚜虫，以获取它们分泌的蜜露。</p>`;
        break;
    }
    this.infoEl.innerHTML = html + `<div class="actions"><button data-a="deselect">取消选择 <kbd>Esc</kbd></button></div>`;
  }

  private antInfo(id: number): string {
    const w = this.world;
    const a = w.colony.antById(id);
    if (!a) return `<h2>工蚁 #${id}</h2><p class="desc">这只蚂蚁已经死亡，尸体会被内务蚁搬到巢外垃圾堆。</p>`;
    const isQ = a.role === 'queen';
    const tags = [`<span class="tag" style="background:${hex(ROLE_COLORS[a.role])}">${ROLE_NAMES[a.role]}</span>`];
    if (a.scout) tags.push('<span class="tag scout">侦察蚁</span>');
    let carry = '无';
    if (a.carrying) {
      const it = a.carrying;
      carry = it.type === 'food' ? FOOD_KIND_NAMES[it.foodKind] : ITEM_NAMES[it.type];
    }
    if (a.crop > 0.01) carry += (carry === '无' ? '' : '；') + `嗉囊中有甜液 ${Math.round(a.crop * 100)}%`;
    const depth = a.domain === 'nest' ? `（深 ${a.depth(w).toFixed(0)} cm）` : '';
    const temp = w.clock.temperatureAt(a.domain === 'surface' ? 0 : a.depth(w));
    const logs = a.log.map((l) => `<li><span>${l.t}</span>${esc(l.msg)}</li>`).join('') || '<li>暂无记录</li>';
    const following = this.state.following;
    return `
      <h2>${isQ ? '蚁后' : '工蚁'} #${a.id} ${tags.join('')}</h2>
      <div class="kv">
        <span>当前行为</span><b class="act">${esc(a.activity)}</b>
        <span>位置</span><b>${a.locationLabel(w)}${depth}</b>
        <span>环境温度</span><b>${temp.toFixed(1)}°C</b>
        <span>日龄</span><b>${isQ ? '约 3 年' : `${a.ageDays.toFixed(1)} 天 / 预期寿命 ${a.lifespan.toFixed(0)} 天`}</b>
        <span>体长</span><b>${(a.size * (isQ ? 9 : 4)).toFixed(1)} mm</b>
        <span>携带</span><b>${carry}</b>
        <span>饱食度</span><b>${bar(1 - a.hunger, '#7ee06a')}</b>
        <span>健康</span><b>${bar(a.health, '#5fb8ff')}</b>
        ${a.role === 'forager' ? `<span>运回食物</span><b>${a.delivered} 次</b>` : ''}
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
    const t = w.clock.temperatureAt(c.depth);
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
    return `
      <h2>${c.name}</h2>
      <p class="desc">${CHAMBER_INFO[c.type].desc}</p>
      <div class="kv">
        <span>深度</span><b>${c.depth.toFixed(0)} cm</b>
        <span>尺寸</span><b>${(c.rx * 2 * 0.71).toFixed(0)} × ${(c.rz * 2 * 0.71).toFixed(0)} × ${(c.ry * 1.7).toFixed(0)} cm</b>
        <span>温度</span><b>${t.toFixed(1)}°C</b>
        <span>相对湿度</span><b>${Math.round(h)}%</b>
      </div>
      <h3>内容物</h3><div class="kv">${rows.join('')}</div>
      <h3>房间内的蚂蚁</h3><div class="kv">${antRows || '<span>无</span><b></b>'}</div>
      <div class="actions"><button data-a="flyto">飞到房间</button></div>`;
  }

  private foodInfo(id: number): string {
    const w = this.world;
    const f = w.food.byId(id);
    if (!f) return `<h2>食物源</h2><p class="desc">这个食物源已经被搬空了。</p>`;
    let near = 0;
    for (const a of w.colony.ants) if (a.domain === 'surface' && Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.radius + 3) near++;
    const dist = Math.hypot(f.x, f.z);
    return `
      <h2>${f.info.name}</h2>
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
      <p class="desc">黑毛蚁把挖掘出的土粒堆在巢口周围，形成火山口状的小土丘。土丘能挡雨、吸收阳光为浅层育幼室加温。蚁穴通常有多个入口，便于通风和疏散。</p>
      <div class="kv">
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

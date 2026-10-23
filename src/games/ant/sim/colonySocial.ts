/** 蚁群里个体之间的互动：保持间距、触角接触、按需调整分工、招呼警戒。Colony.update 和 PredatorManager 调用 */
import { CONFIG, type Role } from '../config';
import { L } from '../../../core/i18n';
import { clamp, lerp, smoothstep } from '../../../core/util/math';
import type { Ant } from './ant';
import { avoid, measureTunnel, shiftSide } from './antNest';
import type { Colony } from './colony';
import { guard } from './routines/maintenance';

const ROLE_ORDER: Record<Role, number> = { queen: -1, nurse: 0, maintenance: 1, forager: 2 };
const bySepS = (a: Ant, b: Ant) => a.sepS - b.sepS;

/**
 * 狼蛛刚逼近某个入口时，离入口最近的几只空手内务蚁放下手头的事出来警戒。
 * 不这样的话要等它们各自做完手头的任务（几十秒）才会挑到警戒
 */
export function callGuards(col: Colony, entrance: number): void {
  const w = col.w;
  if (w.weather.keepIn) return;
  const n = Math.min(CONFIG.defense.callGuards, CONFIG.defense.maxGuards - w.predators.guardsOut);
  if (n <= 0) return;
  const node = w.nest.entrances[entrance].node;
  const picked = col.ants
    .filter((a) => a.role === 'maintenance' && a.alive && a.domain === 'nest' && !a.carrying && a.plugging < 0 && !a.guarding)
    .map((a) => ({ a, d: w.nest.routeLength(a.currentNode(w), node) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, n);
  for (const { a } of picked) {
    a.abort();
    a.behavior.start(guard(a, w, true));
  }
}

/**
 * 让工蚁和身边的同伴保持间距。隧道里按所在的边分组、按沿边位置排序，只比较前后 tunnelGap 以内的同伴，
 * 挨得太近就各自横向让开（每 3 步一次）；地表和房间里每步轮换检查六分之一的工蚁，用空间哈希找邻居互相推开。
 */
export function separate(col: Colony, dt: number): void {
  const t = col.tickN;
  if (t % 3 === 0) {
    for (const g of col.edgeGroups.values()) g.length = 0;
    for (const a of col.ants) {
      if (!a.edge || a.domain !== 'nest') continue;
      measureTunnel(a);
      let g = col.edgeGroups.get(a.edge.id);
      if (!g) col.edgeGroups.set(a.edge.id, (g = []));
      g.push(a);
    }
    const gap = CONFIG.ant.tunnelGap;
    for (const g of col.edgeGroups.values()) {
      if (g.length > 1) g.sort(bySepS);
      for (let i = 0; i < g.length; i++) {
        const a = g[i];
        for (let j = i + 1; j < g.length && g[j].sepS - a.sepS < gap; j++) {
          const b = g[j];
          const d = a.sepLat - b.sepLat;
          const over = 0.4 - Math.abs(d);
          if (over <= 0) continue;
          const s = d > 0.02 ? 1 : d < -0.02 ? -1 : a.id < b.id ? 1 : -1;
          a.sepPush += s * over;
          b.sepPush -= s * over;
        }
      }
      for (const a of g) shiftSide(a, dt * 3);
    }
  }
  const phase = t % 6;
  for (const a of col.ants) {
    if (a.edge || a.role === 'queen' || (a.id + phase) % 6 !== 0 || a.climbing) continue;
    if (a.domain === 'nest' && a.room < 0) continue;
    avoid(a, col.w, col.spatial.near(a.pos.x, a.pos.y, a.pos.z, 0.7, col.near, a), dt * 6);
  }
}

/** 相遇的两只工蚁停下来用触角互相碰触，交换气味信息 */
export function tryContact(col: Colony, a: Ant): void {
  const now = col.w.clock.seconds;
  if (a.holdT > 0 || now < a.nextContactAt || !a.moving || a.climbing) return;
  const p = a.pos;
  const near = col.spatial.near(p.x, p.y, p.z, CONFIG.social.contactRadius, col.near, a);
  for (const b of near) {
    if (b.role === 'queen' || b.holdT > 0 || now < b.nextContactAt || b.domain !== a.domain || b.climbing) continue;
    if (!col.w.rng.chance(0.5)) continue;
    const t = col.w.rng.range(0.6, 1.3);
    a.hold(t, b.pos);
    b.hold(t, a.pos);
    const [c0, c1] = CONFIG.social.contactCooldown;
    a.nextContactAt = now + col.w.rng.range(c0, c1);
    b.nextContactAt = now + col.w.rng.range(c0, c1);
    a.contacts++;
    b.contacts++;
    col.stats.contacts++;
    exchange(col, a, b, now);
    exchange(col, b, a, now);
    return;
  }
}

/** 满载归来的觅食蚁通过接触激发巢内的觅食蚁出巢 */
function exchange(col: Colony, from: Ant, to: Ant, now: number): void {
  if (from.layTrail <= 0 || to.role !== 'forager' || to.excitedUntil > now) return;
  to.excitedUntil = now + 90;
  to.note(col.w, L('note.excited', { id: from.id }));
}

/**
 * 年龄多型性 + 按需调整：按幼体数量和食物储备计算各职别的需求，
 * 再按“行为年龄”从小到大依次分配保育、内务、觅食。正向转换（年轻 → 年长的工作）随需发生，
 * 逆向转换只在缺口明显时发生，且每次评估只转换一小部分工蚁。
 */
export function reviewRoles(col: Colony): void {
  const P = CONFIG.polyethism;
  const workers = col.ants.filter((a) => a.role !== 'queen');
  const W = workers.length;
  if (W === 0) return;
  const bc = col.broodCounts();
  const B = bc.egg + bc.larva + bc.pupa;
  const nurseT = Math.round(clamp(P.nurseBase + B * P.nursePerBrood, 0.12 * W, 0.45 * W));
  const need = W * 0.12 + bc.larva * 1.3;
  const daysOfFood = col.reserve / Math.max(1, need);
  const share = lerp(0.58, 0.4, smoothstep(0.5, 3, daysOfFood));
  const forT = Math.round(Math.max(0, Math.min(W * share, W * 0.86 - nurseT)));
  const maintT = W - nurseT - forT;
  col.targets = { nurse: nurseT, maintenance: maintT, forager: forT };

  workers.sort((a, b) => a.behaviorAge - b.behaviorAge);
  const target: Record<Role, number> = { queen: 0, nurse: nurseT, maintenance: maintT, forager: forT };
  const cur: Record<Role, number> = { queen: 0, nurse: 0, maintenance: 0, forager: 0 };
  for (const a of workers) cur[a.nextRole ?? a.role]++;
  const shortage = cur.forager < forT * 0.85;

  let budget = Math.max(3, Math.round(W * P.maxShift));
  let early = 0;
  for (let i = 0; i < W && budget > 0; i++) {
    const a = workers[i];
    const want: Role = i < nurseT ? 'nurse' : i < nurseT + maintT ? 'maintenance' : 'forager';
    const has = a.nextRole ?? a.role;
    if (want === has) continue;
    if (ROLE_ORDER[want] > ROLE_ORDER[has]) {
      if (cur[has] <= target[has] || cur[want] >= target[want]) continue;
    } else if (cur[want] > target[want] * 0.85 || cur[has] <= target[has]) continue;
    a.nextRole = want === a.role ? null : want;
    cur[has]--;
    cur[want]++;
    budget--;
    if (want === 'forager' && shortage) early++;
  }
  const day = Math.floor(col.w.clock.totalDays);
  if (early >= 5 && day !== col.lastShortageDay) {
    col.lastShortageDay = day;
    col.w.events.push(L('ev.foragerShortage'));
  }
}

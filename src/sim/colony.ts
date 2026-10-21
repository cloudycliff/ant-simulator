import * as THREE from 'three';
import { CONFIG, ROLE_NAMES, type Role } from '../config';
import { clamp, lerp, smoothstep } from '../util/math';
import { rng } from '../util/random';
import type { Chamber, ChamberType } from '../nest/nest';
import type { World } from '../world/world';
import type { FoodKind } from '../world/food';
import { Ant, type AntSave, type Routine } from './ant';
import { NestExpansion, type ExpansionSave } from './expansion';
import { Item, type ItemSave, type ItemType } from './items';
import { routineFor, shelter } from './routines';
import { SpatialHash } from './spatial';

export interface ColonyStats {
  eggsLaid: number;
  emerged: number;
  deaths: number;
  foodCollected: number;
  wasteRemoved: number;
  soilExcavated: number;
  honeydew: number;
  trophallaxis: number;
  contacts: number;
  roleChanges: number;
  /** 被天敌捕食（含围攻时被咬死的） */
  preyed: number;
  /** 被工蚁围攻赶走的狼蛛 */
  repelled: number;
}

/** 每游戏小时记录一次，供统计曲线使用 */
export interface ColonySample {
  day: number;
  nurse: number;
  maintenance: number;
  forager: number;
  brood: number;
  food: number;
  liquid: number;
  outside: number;
}

/** 各职别的需求目标，由分工评估计算 */
export interface RoleTargets {
  nurse: number;
  maintenance: number;
  forager: number;
}

export interface ColonySave {
  ants: AntSave[];
  items: ItemSave[];
  eggCredit: number;
  pupaChamber: number;
  targets: RoleTargets;
  stats: ColonyStats;
  history: ColonySample[];
  events: { t: string; msg: string }[];
  expansion: ExpansionSave;
}

const ROLE_ORDER: Record<Role, number> = { queen: -1, nurse: 0, maintenance: 1, forager: 2 };
const HISTORY_MAX = 24 * 60;
const bySepS = (a: Ant, b: Ant) => a.sepS - b.sepS;

export class Colony {
  ants: Ant[] = [];
  queen!: Ant;
  items = new Set<Item>();
  byChamber: Item[][] = [];
  surfaceItems: Item[] = [];
  nodeItems: Item[] = [];
  /** 储食室中的固体食物（份） */
  foodStock = 0;
  /** 社会胃：所有工蚁嗉囊中的液体食物总量（份） */
  liquidStock = 0;
  eggCredit = 0;
  queenTender = -1;
  midden = { x: 5, z: 12 };
  /** 蛹当前应放在哪个房间（按温度在深层蛹室与向阳育幼室之间切换） */
  pupaChamber = -1;
  targets: RoleTargets = { nurse: 0, maintenance: 0, forager: 0 };
  stats: ColonyStats = {
    eggsLaid: 0,
    emerged: 0,
    deaths: 0,
    foodCollected: 0,
    wasteRemoved: 0,
    soilExcavated: 0,
    honeydew: 0,
    trophallaxis: 0,
    contacts: 0,
    roleChanges: 0,
    preyed: 0,
    repelled: 0,
  };
  history: ColonySample[] = [];
  /** 新出生/死亡等事件，供 UI 做提示 */
  events: { t: string; msg: string }[] = [];
  readonly spatial = new SpatialHash(1);
  private edgeGroups = new Map<number, Ant[]>();
  expansion: NestExpansion;

  private tickN = 0;
  private reviewAcc = 0;
  private climateAcc = 0;
  private sampleAcc = 0;
  private lastShortageDay = -1;
  private near: Ant[] = [];

  constructor(private w: World) {
    this.expansion = new NestExpansion(w);
  }

  /** 固体储备 + 社会胃 */
  get reserve(): number {
    return this.foodStock + this.liquidStock;
  }

  // ---------------- 初始化 ----------------

  init(): void {
    const nest = this.w.nest;
    this.ensureChamberSlots();
    const ch = (t: ChamberType) => nest.chamberOfType(t);

    this.queen = new Ant('queen', 900);
    this.queen.size = 1;
    this.queen.placeInRoom(this.w, ch('queen')[0].id);
    this.ants.push(this.queen);

    const n = CONFIG.colony.initialWorkers;
    const r = CONFIG.colony.roleRatio;
    const brood = [...ch('egg'), ...ch('larva'), ...ch('pupa'), ...ch('queen')];
    const misc = [...ch('rest'), ...ch('food'), ...ch('waste'), ...ch('winter')];
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const role: Role = p < r.nurse ? 'nurse' : p < r.nurse + r.maintenance ? 'maintenance' : 'forager';
      const ant = new Ant(role, 0);
      const span = ant.lifespan;
      ant.ageDays = role === 'nurse' ? rng.range(0, 0.3) * span : role === 'maintenance' ? rng.range(0.25, 0.55) * span : rng.range(0.45, 0.95) * span;
      if (role === 'forager') ant.scout = rng.chance(CONFIG.colony.scoutRatio);
      if (rng.chance(CONFIG.colony.initialCropShare)) ant.crop = rng.range(0.2, 0.7);
      this.liquidStock += ant.crop;
      if (role === 'forager' && rng.chance(0.35)) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(6, 50);
        ant.placeOnSurface(Math.cos(a) * d, Math.sin(a) * d, this.w);
        ant.heading = a;
      } else {
        const pool = role === 'nurse' ? brood : misc;
        ant.placeInRoom(this.w, rng.pick(pool).id);
      }
      this.ants.push(ant);
    }

    this.pupaChamber = ch('pupa')[0].id;
    const b = CONFIG.colony.initialBrood;
    const qc = ch('queen')[0];
    for (let i = 0; i < b.egg; i++) {
      const it = new Item('egg');
      it.stageAge = rng.range(0, CONFIG.brood.eggDays);
      this.addToChamber(it, i < 8 ? qc : ch('egg')[0]);
    }
    for (let i = 0; i < b.larva; i++) {
      const it = new Item('larva');
      it.stageAge = rng.range(0, CONFIG.brood.larvaDays);
      it.feeds = Math.floor(rng.range(0, CONFIG.brood.larvaFeedsNeeded + 1));
      it.hunger = rng.range(0, 0.8);
      this.addToChamber(it, rng.pick(ch('larva')));
    }
    for (let i = 0; i < b.pupa; i++) {
      const it = new Item('pupa');
      it.stageAge = rng.range(0, CONFIG.brood.pupaDays);
      this.addToChamber(it, ch('pupa')[0]);
    }
    // 甜液储存在工蚁的嗉囊里，储食室只放固体食物
    const store = this.foodChamber();
    for (let i = 0; i < CONFIG.colony.initialFood; i++) {
      const it = new Item('food');
      it.foodKind = rng.chance(0.55) ? 'prey' : 'seed';
      it.age = rng.range(0, 1.2);
      this.addToChamber(it, store);
    }
    for (let i = 0; i < 12; i++) this.addToChamber(new Item('waste'), ch('waste')[0]);
    for (let i = 0; i < 6; i++) this.addToChamber(new Item('waste'), rng.pick(ch('larva')));
    for (let i = 0; i < 45; i++) this.dropAtMidden(new Item(rng.chance(0.2) ? 'corpse' : 'waste'));
    for (let i = 0; i < 320; i++) this.dropOnMound(new Item('soil'), rng.pick(this.w.nest.entrances));
    this.refreshFoodStock();
    this.updateClimate();
    this.reviewRoles();
    this.sample();
  }

  toSave(): ColonySave {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      ants: this.ants.map((a) => a.toSave(this.w)),
      items: [...this.items].filter((it) => it.place !== 'gone' && it.place !== 'none').map((it) => it.toSave()),
      eggCredit: this.eggCredit,
      pupaChamber: this.pupaChamber,
      targets: { ...this.targets },
      stats: { ...this.stats },
      history: this.history.map((h) => ({ ...h, day: Math.round(h.day * 1e4) / 1e4, food: r2(h.food), liquid: r2(h.liquid) })),
      events: this.events.slice(),
      expansion: this.expansion.toSave(),
    };
  }

  /** 读档：在蚁穴结构恢复之后调用。被搬运中的物品直接送到它的目的地 */
  restore(s: ColonySave): void {
    this.ants = s.ants.map((as) => Ant.fromSave(as, this.w));
    const queen = this.ants.find((a) => a.role === 'queen');
    if (!queen) throw new Error('存档里没有蚁后');
    this.queen = queen;
    this.items.clear();
    this.byChamber = [];
    this.surfaceItems = [];
    this.nodeItems = [];
    this.ensureChamberSlots();
    this.pupaChamber = s.pupaChamber;
    const carried: Item[] = [];
    for (const is of s.items) {
      const it = Item.fromSave(is);
      if (it.place === 'chamber' && this.byChamber[it.chamber]) this.byChamber[it.chamber].push(it);
      else if (it.place === 'node') this.nodeItems.push(it);
      else if (it.place === 'surface' || it.place === 'midden' || it.place === 'mound') this.surfaceItems.push(it);
      else {
        carried.push(it);
        continue;
      }
      this.items.add(it);
    }
    for (const it of carried) {
      it.place = 'none';
      if (it.type === 'corpse') this.dropAtMidden(it);
      else if (it.type !== 'soil') this.addToChamber(it, this.targetChamberFor(it));
    }
    this.eggCredit = s.eggCredit;
    this.queenTender = -1;
    this.targets = s.targets;
    this.stats = { ...this.stats, ...s.stats };
    this.history = s.history;
    this.events = s.events;
    this.expansion.restore(s.expansion);
    this.refreshFoodStock();
    this.liquidStock = this.ants.reduce((sum, a) => sum + a.crop, 0);
  }

  /** 新增房间后为它分配物品索引 */
  ensureChamberSlots(): void {
    while (this.byChamber.length < this.w.nest.chambers.length) this.byChamber.push([]);
  }

  newRoutine(ant: Ant): Routine {
    if (ant.nextRole && !ant.carrying) this.applyRole(ant);
    if (ant.domain === 'surface' && !ant.carrying && ant.role !== 'queen' && this.w.weather.keepIn) return shelter(ant, this.w);
    return routineFor(ant, this.w);
  }

  /** 天气转坏时，地表上空手、没在爬植物或打斗的工蚁按概率放下手头的事返巢 */
  seekShelter(p: number): void {
    for (const a of this.ants) {
      if (a.domain !== 'surface' || a.carrying || a.climbing || a.alarmT > 0 || a.pitT > 0 || a.role === 'queen') continue;
      if (!rng.chance(p)) continue;
      for (const it of this.items) if (it.claimedBy === a.id) it.claimedBy = -1;
      a.layTrail = 0;
      a.abort();
    }
  }

  private applyRole(a: Ant): void {
    const from = a.role;
    a.role = a.nextRole!;
    a.nextRole = null;
    a.scout = a.role === 'forager' && rng.chance(CONFIG.colony.scoutRatio);
    a.memory = null;
    a.herd = -1;
    a.note(this.w, `由${ROLE_NAMES[from]}转为${ROLE_NAMES[a.role]}${a.scout ? '（侦察蚁）' : ''}，日龄 ${a.ageDays.toFixed(1)} 天`);
    this.stats.roleChanges++;
  }

  // ---------------- 物品放置 ----------------

  foodChamber(): Chamber {
    return this.w.nest.chamberOfType('food')[0];
  }

  chamberType(id: number): ChamberType | null {
    return id >= 0 ? this.w.nest.chambers[id].type : null;
  }

  /** 同类物品在房间内堆放的中心 */
  pileCenter(c: Chamber, type: ItemType, out = new THREE.Vector3()): THREE.Vector3 {
    const seed = (c.id * 7 + type.length * 13) % 11;
    const a = c.yaw + seed * 0.57;
    const k = type === 'waste' ? 0.42 : type === 'food' ? 0.3 : 0.18;
    out.set(c.floor.x + Math.cos(a) * c.rx * k, c.floor.y, c.floor.z + Math.sin(a) * c.rz * k);
    return out;
  }

  pileSpot(c: Chamber, type: ItemType): THREE.Vector3 {
    const p = this.pileCenter(c, type);
    const spread = type === 'food' ? 0.24 : 0.2;
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const x = p.x + rng.gauss(0, c.rx * spread);
      const z = p.z + rng.gauss(0, c.rz * spread);
      v.set(x, c.floor.y + 0.1, z);
      if (this.w.nest.chamberAt(v) === c) {
        p.x = x;
        p.z = z;
        break;
      }
    }
    p.y = c.floor.y;
    return p;
  }

  private itemLift(type: ItemType): number {
    return type === 'egg' ? 0.12 : type === 'larva' ? 0.18 : type === 'pupa' ? 0.22 : 0.15;
  }

  addToChamber(it: Item, c: Chamber, spot?: THREE.Vector3): void {
    this.detach(it);
    const p = spot ?? this.pileSpot(c, it.type);
    const pile = this.byChamber[c.id].length;
    it.pos.set(p.x, c.floor.y + this.itemLift(it.type) + rng.range(0, Math.min(0.5, pile / 300)), p.z);
    it.place = 'chamber';
    it.chamber = c.id;
    this.byChamber[c.id].push(it);
    this.items.add(it);
    if (it.isBrood) it.wantsMove = !this.isHome(it, c);
  }

  dropAtMidden(it: Item): void {
    this.detach(it);
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * 3.2;
    const x = this.midden.x + Math.cos(a) * d;
    const z = this.midden.z + Math.sin(a) * d;
    it.pos.set(x, this.w.terrain.heightAt(x, z) + 0.15 + rng.range(0, 0.3) * (1 - d / 3.2), z);
    it.place = 'midden';
    this.surfaceItems.push(it);
    this.items.add(it);
  }

  dropOnMound(it: Item, ent: { x: number; z: number }): void {
    this.detach(it);
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1.6, 3.6);
    const x = ent.x + Math.cos(a) * d;
    const z = ent.z + Math.sin(a) * d;
    it.pos.set(x, this.w.terrain.heightAt(x, z) + 0.14, z);
    it.place = 'mound';
    this.surfaceItems.push(it);
    this.items.add(it);
    let mound = 0;
    for (const s of this.surfaceItems) if (s.place === 'mound') mound++;
    if (mound > 1200) {
      const old = this.surfaceItems.find((s) => s.place === 'mound');
      if (old) this.destroy(old);
    }
  }

  dropOnSurface(it: Item, x: number, z: number): void {
    this.detach(it);
    it.pos.set(x, this.w.terrain.heightAt(x, z) + 0.15, z);
    it.place = 'surface';
    this.surfaceItems.push(it);
    this.items.add(it);
  }

  dropAtNode(it: Item, node: number, pos: THREE.Vector3): void {
    this.detach(it);
    it.pos.copy(pos);
    it.place = 'node';
    it.node = node;
    this.nodeItems.push(it);
    this.items.add(it);
  }

  /** 从当前位置的索引中移除（但仍存在） */
  detach(it: Item): void {
    if (it.place === 'chamber') {
      const arr = this.byChamber[it.chamber];
      const i = arr.indexOf(it);
      if (i >= 0) arr.splice(i, 1);
    } else if (it.place === 'surface' || it.place === 'midden' || it.place === 'mound') {
      const i = this.surfaceItems.indexOf(it);
      if (i >= 0) this.surfaceItems.splice(i, 1);
    } else if (it.place === 'node') {
      const i = this.nodeItems.indexOf(it);
      if (i >= 0) this.nodeItems.splice(i, 1);
    }
    it.chamber = -1;
    it.node = -1;
    it.place = 'none';
  }

  destroy(it: Item): void {
    this.detach(it);
    this.items.delete(it);
    it.place = 'gone';
  }

  pickUp(ant: Ant, it: Item): void {
    this.detach(it);
    this.items.add(it);
    it.place = 'carried';
    it.carriedBy = ant.id;
    it.claimedBy = ant.id;
    ant.carrying = it;
  }

  /** 放下携带物，物品留在调用方指定的位置 */
  release(ant: Ant): Item | null {
    const it = ant.carrying;
    ant.carrying = null;
    if (it) {
      it.carriedBy = -1;
      it.claimedBy = -1;
    }
    return it;
  }

  homeTypeFor(t: ItemType): ChamberType | null {
    return t === 'egg' ? 'egg' : t === 'larva' ? 'larva' : t === 'pupa' ? 'pupa' : t === 'food' ? 'food' : t === 'waste' ? 'waste' : null;
  }

  private isHome(it: Item, c: Chamber): boolean {
    if (it.type === 'pupa') return c.id === this.pupaChamber;
    return c.type === this.homeTypeFor(it.type);
  }

  /** 物品应去往的房间：蛹按温度选择，幼虫分散到幼虫最少的幼虫室 */
  targetChamberFor(it: Item): Chamber {
    if (it.type === 'pupa' && this.pupaChamber >= 0) return this.w.nest.chambers[this.pupaChamber];
    const t = this.homeTypeFor(it.type) ?? 'rest';
    const list = this.w.nest.chamberOfType(t);
    if (list.length === 1) return list[0];
    let best = list[0];
    let bc = Infinity;
    for (const c of list) {
      const n = this.byChamber[c.id].filter((x) => x.type === it.type).length;
      if (n < bc) {
        bc = n;
        best = c;
      }
    }
    return best;
  }

  findItem(pred: (it: Item) => boolean): Item | null {
    for (const arr of this.byChamber) for (const it of arr) if (it.free && pred(it)) return it;
    return null;
  }

  countIn(chamber: number, type: ItemType): number {
    let n = 0;
    for (const it of this.byChamber[chamber]) if (it.type === type) n++;
    return n;
  }

  // ---------------- 食物 ----------------

  refreshFoodStock(): void {
    let s = 0;
    for (const c of this.w.nest.chamberOfType('food')) for (const it of this.byChamber[c.id]) if (it.type === 'food') s += it.amount;
    this.foodStock = s;
  }

  /** 从储食室消耗固体食物；吃完的猎物碎块可能留下残渣 */
  takeFood(amount: number): FoodKind | null {
    const store = this.foodChamber();
    const arr = this.byChamber[store.id];
    let left = amount;
    let kind: FoodKind | null = null;
    for (let i = arr.length - 1; i >= 0 && left > 0; i--) {
      const it = arr[i];
      if (it.type !== 'food' || !it.free) continue;
      const k = Math.min(left, it.amount);
      it.amount -= k;
      left -= k;
      kind = it.foodKind;
      if (it.amount <= 0.001) {
        const spot = it.pos.clone();
        const leftover = rng.chance(0.3);
        this.destroy(it);
        if (leftover) this.addToChamber(new Item('waste'), store, spot);
      }
    }
    this.refreshFoodStock();
    return left < amount ? kind : null;
  }

  /** 觅食蚁把携带的固体食物放进储食室 */
  storeFood(ant: Ant): void {
    const it = ant.carrying;
    if (!it || it.type !== 'food') return;
    this.release(ant);
    this.addToChamber(it, this.foodChamber(), ant.pos);
    this.refreshFoodStock();
  }

  /** 交哺：donor 把嗉囊中的液体反刍给 recipient，返回传递量 */
  share(donor: Ant, recipient: Ant, max = CONFIG.social.shareAmount): number {
    const amt = Math.min(donor.crop, max, 1 - recipient.crop);
    if (amt <= 0.01) return 0;
    donor.crop -= amt;
    recipient.crop += amt;
    donor.shares++;
    recipient.shares++;
    this.stats.trophallaxis++;
    return amt;
  }

  /** 在同一房间内寻找满足条件、空闲的同伴，取最近的一只 */
  findRoommate(a: Ant, pred: (b: Ant) => boolean): Ant | null {
    if (a.domain !== 'nest' || a.room < 0) return null;
    let best: Ant | null = null;
    let bd = Infinity;
    for (const b of this.ants) {
      if (b === a || b.room !== a.room || b.domain !== 'nest' || b.holdT > 0 || b.role === 'queen' || b.carrying?.isBrood) continue;
      if (!pred(b)) continue;
      const d = b.pos.distanceToSquared(a.pos);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---------------- 生命周期 ----------------

  layEgg(queen: Ant): void {
    const it = new Item('egg');
    const c = this.w.nest.chambers[queen.room >= 0 ? queen.room : this.w.nest.chamberOfType('queen')[0].id];
    this.addToChamber(it, c, queen.pos);
    this.eggCredit -= 1;
    this.stats.eggsLaid++;
  }

  canLay(): boolean {
    let brood = 0;
    for (const it of this.items) if (it.isBrood) brood++;
    return this.eggCredit >= 1 && this.ants.length + brood < CONFIG.colony.maxPopulation;
  }

  eclose(pupa: Item, helper: Ant | null): Ant | null {
    if (pupa.place !== 'chamber' || pupa.type !== 'pupa') return null;
    const c = this.w.nest.chambers[pupa.chamber];
    const ant = new Ant('nurse', 0);
    ant.placeInRoom(this.w, c.id);
    ant.pos.copy(pupa.pos).setY(c.floor.y);
    ant.hunger = 0.3;
    ant.note(this.w, helper ? `在保育蚁 #${helper.id} 的帮助下破茧羽化` : '自行破茧羽化');
    this.ants.push(ant);
    const shell = pupa;
    shell.type = 'waste';
    shell.ready = false;
    shell.claimedBy = -1;
    shell.wantsMove = false;
    this.stats.emerged++;
    this.pushEvent(`新工蚁 #${ant.id} 羽化`);
    return ant;
  }

  /** leaveCorpse 为 false 时尸体由调用方处理（被天敌吃掉，之后才留下空壳） */
  kill(ant: Ant, cause: string, leaveCorpse = true): void {
    if (!ant.alive || ant.role === 'queen') return;
    ant.alive = false;
    ant.activity = `已死亡（${cause}）`;
    ant.note(this.w, `死亡：${cause}`);
    for (const it of this.items) if (it.claimedBy === ant.id && it.carriedBy !== ant.id) it.claimedBy = -1;
    const carried = this.release(ant);
    if (leaveCorpse) {
      const corpse = new Item('corpse');
      corpse.yaw = Math.atan2(ant.fwd.z, ant.fwd.x);
      this.placeAtAnt(ant, corpse);
    }
    if (carried) {
      if (carried.place === 'carried' && carried.type !== 'food') this.placeAtAnt(ant, carried);
      else this.destroy(carried);
    }
    if (this.queenTender === ant.id) this.queenTender = -1;
    const i = this.ants.indexOf(ant);
    if (i >= 0) this.ants.splice(i, 1);
    this.stats.deaths++;
  }

  private placeAtAnt(ant: Ant, it: Item): void {
    if (ant.domain === 'surface') this.dropOnSurface(it, ant.pos.x, ant.pos.z);
    else if (ant.room >= 0) this.addToChamber(it, this.w.nest.chambers[ant.room], ant.pos);
    else this.dropAtNode(it, ant.currentNode(this.w), ant.pos);
  }

  pushEvent(msg: string): void {
    this.events.unshift({ t: this.w.clock.stamp(), msg });
    if (this.events.length > 8) this.events.pop();
  }

  update(dt: number): void {
    const days = dt / CONFIG.time.dayLength;
    const w = this.w;
    this.tickN++;
    const queenFed = this.queen.hunger < 0.8 ? 1 : 0.3;
    this.eggCredit = Math.min(4, this.eggCredit + days * CONFIG.colony.eggsPerDay * queenFed);
    this.spatial.rebuild(this.ants);

    let liquid = 0;
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const a = this.ants[i];
      a.ageDays += days;
      const rate = a.role === 'queen' ? 1.4 : a.role === 'forager' ? 1.15 : 0.85;
      a.hunger += days * CONFIG.ant.hungerPerDay * rate;
      if (a.hunger > 1) {
        a.hunger = 1;
        a.health -= days * 0.35;
      } else a.health = Math.min(1, a.health + days * 0.4);
      if (a.role !== 'queen') {
        if (a.ageDays > a.lifespan) {
          this.kill(a, '衰老');
          continue;
        }
        if (a.health <= 0) {
          this.kill(a, '饥饿');
          continue;
        }
        // 错开检查，每只蚂蚁约每 8 步检查一次接触
        if (((this.tickN + a.id) & 7) === 0) this.tryContact(a);
      }
      a.update(dt, w);
      liquid += a.crop;
    }
    this.liquidStock = liquid;
    this.separate(dt);
    this.updateBrood(days);
    this.updateStores(days);
    this.updateSurfaceItems(days);

    this.reviewAcc += days;
    if (this.reviewAcc >= CONFIG.polyethism.reviewDays) {
      this.reviewAcc = 0;
      this.reviewRoles();
    }
    this.climateAcc += days;
    if (this.climateAcc >= 0.01) {
      this.climateAcc = 0;
      this.updateClimate();
    }
    this.sampleAcc += days;
    if (this.sampleAcc >= 1 / 24) {
      this.sampleAcc = 0;
      this.sample();
    }
    this.expansion.update(days);
  }

  /**
   * 让工蚁和身边的同伴保持间距。隧道里按所在的边分组、按沿边位置排序，只比较前后 tunnelGap 以内的同伴，
   * 挨得太近就各自横向让开（每 3 步一次）；地表和房间里每步轮换检查六分之一的工蚁，用空间哈希找邻居互相推开。
   */
  private separate(dt: number): void {
    const t = this.tickN;
    if (t % 3 === 0) {
      for (const g of this.edgeGroups.values()) g.length = 0;
      for (const a of this.ants) {
        if (!a.edge || a.domain !== 'nest') continue;
        a.measureTunnel();
        let g = this.edgeGroups.get(a.edge.id);
        if (!g) this.edgeGroups.set(a.edge.id, (g = []));
        g.push(a);
      }
      const gap = CONFIG.ant.tunnelGap;
      for (const g of this.edgeGroups.values()) {
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
        for (const a of g) a.shiftSide(dt * 3);
      }
    }
    const phase = t % 6;
    for (const a of this.ants) {
      if (a.edge || a.role === 'queen' || (a.id + phase) % 6 !== 0 || a.climbing) continue;
      if (a.domain === 'nest' && a.room < 0) continue;
      a.avoid(this.w, this.spatial.near(a.pos.x, a.pos.y, a.pos.z, 0.7, this.near, a), dt * 6);
    }
  }
  // ---------------- 触角接触 ----------------

  /** 相遇的两只工蚁停下来用触角互相碰触，交换气味信息 */
  private tryContact(a: Ant): void {
    const now = this.w.clock.seconds;
    if (a.holdT > 0 || now < a.nextContactAt || !a.moving || a.climbing) return;
    const p = a.pos;
    const near = this.spatial.near(p.x, p.y, p.z, CONFIG.social.contactRadius, this.near, a);
    for (const b of near) {
      if (b.role === 'queen' || b.holdT > 0 || now < b.nextContactAt || b.domain !== a.domain || b.climbing) continue;
      if (!rng.chance(0.5)) continue;
      const t = rng.range(0.6, 1.3);
      a.hold(t, b.pos);
      b.hold(t, a.pos);
      const [c0, c1] = CONFIG.social.contactCooldown;
      a.nextContactAt = now + rng.range(c0, c1);
      b.nextContactAt = now + rng.range(c0, c1);
      a.contacts++;
      b.contacts++;
      this.stats.contacts++;
      this.exchange(a, b, now);
      this.exchange(b, a, now);
      return;
    }
  }

  /** 满载归来的觅食蚁通过接触激发巢内的觅食蚁出巢 */
  private exchange(from: Ant, to: Ant, now: number): void {
    if (from.layTrail <= 0 || to.role !== 'forager' || to.excitedUntil > now) return;
    to.excitedUntil = now + 90;
    to.note(this.w, `与满载归来的 #${from.id} 触角接触，被激发准备出巢`);
  }

  // ---------------- 分工调整 ----------------

  /**
   * 年龄多型性 + 按需调整：按幼体数量和食物储备计算各职别的需求，
   * 再按“行为年龄”从小到大依次分配保育、内务、觅食。正向转换（年轻 → 年长的工作）随需发生，
   * 逆向转换只在缺口明显时发生，且每次评估只转换一小部分工蚁。
   */
  reviewRoles(): void {
    const P = CONFIG.polyethism;
    const workers = this.ants.filter((a) => a.role !== 'queen');
    const W = workers.length;
    if (W === 0) return;
    const bc = this.broodCounts();
    const B = bc.egg + bc.larva + bc.pupa;
    const nurseT = Math.round(clamp(P.nurseBase + B * P.nursePerBrood, 0.12 * W, 0.45 * W));
    const need = W * 0.12 + bc.larva * 1.3;
    const daysOfFood = this.reserve / Math.max(1, need);
    const share = lerp(0.58, 0.4, smoothstep(0.5, 3, daysOfFood));
    const forT = Math.round(Math.max(0, Math.min(W * share, W * 0.86 - nurseT)));
    const maintT = W - nurseT - forT;
    this.targets = { nurse: nurseT, maintenance: maintT, forager: forT };

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
    const day = Math.floor(this.w.clock.totalDays);
    if (early >= 5 && day !== this.lastShortageDay) {
      this.lastShortageDay = day;
      this.pushEvent('觅食蚁不足，较年轻的工蚁提前转为觅食蚁');
    }
  }

  // ---------------- 幼体温度调节 ----------------

  /** 蛹偏好 24–30°C：比较深层蛹室与石块下的向阳育幼室，温差明显时更换蛹的目标房间 */
  updateClimate(): void {
    const nest = this.w.nest;
    const dry = (c: Chamber) => c.wet < CONFIG.weather.floodedAt;
    const cands = [...nest.chamberOfType('pupa'), ...nest.chamberOfType('solar')].filter(dry);
    if (!cands.length) return;
    const score = (c: Chamber) => {
      const t = this.w.chamberTemperature(c);
      return t <= 30 ? t : 60 - t;
    };
    const cur = nest.chambers[this.pupaChamber];
    const flooded = !dry(cur);
    let best = flooded ? cands[0] : cur;
    let bs = flooded ? -Infinity : score(cur);
    for (const c of cands) {
      const s = score(c);
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    if (best === cur || (!flooded && bs < score(cur) + 1.2)) return;
    this.pupaChamber = best.id;
    for (const arr of this.byChamber) for (const it of arr) if (it.type === 'pupa') it.wantsMove = it.chamber !== best.id;
    const t = this.w.chamberTemperature(best).toFixed(1);
    if (flooded) this.pushEvent(`${cur.name}进水，保育蚁把蛹搬到${best.name}`);
    else this.pushEvent(best.type === 'solar' ? `${best.name}升温到 ${t}°C，保育蚁开始把蛹搬上来` : `浅层降温，保育蚁把蛹搬回${best.name}（${t}°C）`);
  }

  // ---------------- 储食与幼体 ----------------

  /** 猎物碎块放久了会变质；种子的油质体吃完后，种子被当作垃圾丢弃 */
  private updateStores(days: number): void {
    let changed = false;
    for (const c of this.w.nest.chamberOfType('food')) {
      const arr = this.byChamber[c.id];
      const rot = c.wet >= CONFIG.weather.floodedAt ? CONFIG.weather.floodSpoil : 1;
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        if (it.type !== 'food') continue;
        it.age += days * rot;
        const limit = it.foodKind === 'prey' ? 2.5 : 1.5;
        if (it.age <= limit || !it.free) continue;
        it.type = 'waste';
        changed = true;
      }
    }
    if (changed) this.refreshFoodStock();
  }

  private updateBrood(days: number): void {
    const B = CONFIG.brood;
    for (const arr of this.byChamber)
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        if (!it.isBrood) continue;
        this.developBrood(it, days, B);
      }
    for (const a of this.ants) if (a.carrying?.isBrood) this.developBrood(a.carrying, days, B);
  }

  private developBrood(it: Item, days: number, B: typeof CONFIG.brood): void {
    if (it.type === 'egg') {
      it.stageAge += days;
      if (it.stageAge >= B.eggDays) {
        it.type = 'larva';
        it.stageAge = 0;
        it.hunger = 0.3;
        it.feeds = 0;
        if (it.place === 'chamber') it.wantsMove = !this.isHome(it, this.w.nest.chambers[it.chamber]);
      }
    } else if (it.type === 'larva') {
      it.hunger += days * 1.3;
      if (it.hunger < 1) it.stageAge += days;
      if (it.stageAge >= B.larvaDays && it.feeds >= B.larvaFeedsNeeded) {
        it.type = 'pupa';
        it.stageAge = 0;
        if (it.place === 'chamber') it.wantsMove = !this.isHome(it, this.w.nest.chambers[it.chamber]);
      } else if (it.hunger > 3.5 && it.place === 'chamber') {
        it.type = 'waste';
        it.wantsMove = false;
        this.pushEvent('一只幼虫因缺乏喂养死亡');
      }
    } else if (it.type === 'pupa') {
      // 温暖处发育更快
      const t = it.place === 'chamber' ? this.w.chamberTemperature(this.w.nest.chambers[it.chamber]) : 20;
      it.stageAge += days * clamp(0.6 + (t - 16) * 0.05, 0.6, 1.3);
      if (it.stageAge >= B.pupaDays) {
        if (!it.ready) it.ready = true;
        it.readyTime += days;
        if (it.readyTime > 0.5 && it.free && this.ants.length < CONFIG.colony.maxPopulation) this.eclose(it, null);
      }
    }
  }

  private updateSurfaceItems(days: number): void {
    for (let i = this.surfaceItems.length - 1; i >= 0; i--) {
      const it = this.surfaceItems[i];
      it.age += days;
      // 地表尸体与垃圾会被分解者逐渐分解
      if (it.place === 'midden' && it.age > 6 && rng.chance(days * 0.5)) this.destroy(it);
      else if (it.place === 'surface' && it.age > 2 && it.free) this.destroy(it);
    }
  }

  // ---------------- 统计 ----------------

  private sample(): void {
    const r = this.roleCounts();
    const b = this.broodCounts();
    this.history.push({
      day: this.w.clock.totalDays,
      nurse: r.nurse,
      maintenance: r.maintenance,
      forager: r.forager,
      brood: b.egg + b.larva + b.pupa,
      food: this.foodStock,
      liquid: this.liquidStock,
      outside: this.outsideCount(),
    });
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  roleCounts(): Record<Role, number> {
    const r: Record<Role, number> = { queen: 0, nurse: 0, maintenance: 0, forager: 0 };
    for (const a of this.ants) r[a.role]++;
    return r;
  }

  broodCounts(): { egg: number; larva: number; pupa: number } {
    const r = { egg: 0, larva: 0, pupa: 0 };
    for (const it of this.items) if (it.isBrood) r[it.type as 'egg']++;
    return r;
  }

  outsideCount(): number {
    let n = 0;
    for (const a of this.ants) if (a.domain === 'surface') n++;
    return n;
  }

  antById(id: number): Ant | undefined {
    return this.ants.find((a) => a.id === id);
  }
}

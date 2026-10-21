import * as THREE from 'three';
import { CONFIG, type Role } from '../config';
import { rng } from '../util/random';
import type { Chamber, ChamberType } from '../nest/nest';
import type { World } from '../world/world';
import type { FoodKind } from '../world/food';
import { Ant, type Routine } from './ant';
import { Item, type ItemType } from './items';
import { routineFor } from './routines';

export interface ColonyStats {
  eggsLaid: number;
  emerged: number;
  deaths: number;
  foodCollected: number;
  wasteRemoved: number;
  soilExcavated: number;
}

const _v = new THREE.Vector3();

export class Colony {
  ants: Ant[] = [];
  queen!: Ant;
  items = new Set<Item>();
  byChamber: Item[][] = [];
  surfaceItems: Item[] = [];
  nodeItems: Item[] = [];
  foodStock = 0;
  eggCredit = 0;
  queenTender = -1;
  midden = { x: 5, z: 12 };
  stats: ColonyStats = { eggsLaid: 0, emerged: 0, deaths: 0, foodCollected: 0, wasteRemoved: 0, soilExcavated: 0 };
  /** 新出生/死亡事件，供 UI 做提示 */
  events: { t: string; msg: string }[] = [];

  constructor(private w: World) {}

  // ---------------- 初始化 ----------------

  init(): void {
    const nest = this.w.nest;
    this.byChamber = nest.chambers.map(() => []);
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
    const store = this.foodChamber();
    for (let i = 0; i < CONFIG.colony.initialFood; i++) {
      const it = new Item('food');
      it.foodKind = rng.pick(['prey', 'seed', 'sugar'] as FoodKind[]);
      it.age = rng.range(0, 1.2);
      this.addToChamber(it, store);
    }
    for (let i = 0; i < 12; i++) this.addToChamber(new Item('waste'), ch('waste')[0]);
    for (let i = 0; i < 6; i++) this.addToChamber(new Item('waste'), rng.pick(ch('larva')));
    for (let i = 0; i < 45; i++) this.dropAtMidden(new Item(rng.chance(0.2) ? 'corpse' : 'waste'));
    for (let i = 0; i < 320; i++) this.dropOnMound(new Item('soil'), rng.pick(this.w.nest.entrances));
    this.refreshFoodStock();
  }

  newRoutine(ant: Ant): Routine {
    return routineFor(ant, this.w);
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
    for (let i = 0; i < 6; i++) {
      const x = p.x + rng.gauss(0, c.rx * spread);
      const z = p.z + rng.gauss(0, c.rz * spread);
      _v.set(x, c.floor.y, z);
      if (this.w.nest.chamberAt(_v.setY(c.floor.y + 0.1)) === c) {
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
    if (it.isBrood) it.wantsMove = c.type !== this.homeTypeFor(it.type);
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

  /** 幼体应去往的房间：幼虫分散到幼虫最少的幼虫室 */
  targetChamberFor(it: Item): Chamber {
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

  /** 从储食室消耗食物；吃完的猎物碎块可能留下残渣 */
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
        const leftover = it.foodKind !== 'sugar' && rng.chance(0.3);
        this.destroy(it);
        if (leftover) this.addToChamber(new Item('waste'), store, spot);
      }
    }
    this.refreshFoodStock();
    return left < amount ? kind : null;
  }

  storeFood(ant: Ant, kind: FoodKind): void {
    const store = this.foodChamber();
    let it = ant.carrying;
    if (it && it.type === 'food') {
      this.release(ant);
    } else {
      it = new Item('food');
      it.foodKind = kind;
    }
    ant.crop = 0;
    this.addToChamber(it, store, ant.pos);
    this.stats.foodCollected++;
    this.refreshFoodStock();
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

  kill(ant: Ant, cause: string): void {
    if (!ant.alive || ant.role === 'queen') return;
    ant.alive = false;
    ant.activity = `已死亡（${cause}）`;
    ant.note(this.w, `死亡：${cause}`);
    for (const it of this.items) if (it.claimedBy === ant.id && it.carriedBy !== ant.id) it.claimedBy = -1;
    const carried = this.release(ant);
    const corpse = new Item('corpse');
    corpse.yaw = Math.atan2(ant.fwd.z, ant.fwd.x);
    this.placeAtAnt(ant, corpse);
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
    const queenFed = this.queen.hunger < 0.8 ? 1 : 0.3;
    this.eggCredit = Math.min(4, this.eggCredit + days * CONFIG.colony.eggsPerDay * queenFed);

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
        if (a.domain === 'surface' && rng.chance(days * 0.03)) {
          this.kill(a, '在野外意外死亡');
          continue;
        }
      }
      a.update(dt, w);
    }
    this.updateBrood(days);
    this.updateStores(days);
    this.updateSurfaceItems(days);
  }

  /** 猎物碎块放久了会变质；种子的油质体吃完后，种子被当作垃圾丢弃 */
  private updateStores(days: number): void {
    let changed = false;
    for (const c of this.w.nest.chamberOfType('food')) {
      const arr = this.byChamber[c.id];
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        if (it.type !== 'food') continue;
        it.age += days;
        const limit = it.foodKind === 'prey' ? 2.5 : it.foodKind === 'seed' ? 1.5 : 4;
        if (it.age <= limit || !it.free) continue;
        // 甜液存放久了会干涸，不留残渣
        if (it.foodKind === 'sugar') this.destroy(it);
        else it.type = 'waste';
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
        if (it.place === 'chamber') it.wantsMove = this.chamberType(it.chamber) !== 'larva';
      }
    } else if (it.type === 'larva') {
      it.hunger += days * 1.3;
      if (it.hunger < 1) it.stageAge += days;
      if (it.stageAge >= B.larvaDays && it.feeds >= B.larvaFeedsNeeded) {
        it.type = 'pupa';
        it.stageAge = 0;
        if (it.place === 'chamber') it.wantsMove = this.chamberType(it.chamber) !== 'pupa';
      } else if (it.hunger > 3.5 && it.place === 'chamber') {
        it.type = 'waste';
        it.wantsMove = false;
        this.pushEvent('一只幼虫因缺乏喂养死亡');
      }
    } else if (it.type === 'pupa') {
      it.stageAge += days;
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

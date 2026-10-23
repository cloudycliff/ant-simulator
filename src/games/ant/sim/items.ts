import * as THREE from 'three';
import { L, type Text } from '../../../core/i18n';
import type { FoodKind } from '../world/food';
import type { IdPool } from '../../../core/sim/ids';

export type ItemType = 'egg' | 'larva' | 'pupa' | 'food' | 'waste' | 'soil' | 'corpse';

/** chamber=房间内，node=隧道节点，surface=地表散落，midden=巢外垃圾堆，mound=蚁丘土粒 */
export type ItemPlace = 'none' | 'chamber' | 'node' | 'surface' | 'midden' | 'mound' | 'carried' | 'gone';

export const ITEM_NAMES: Record<ItemType, Text> = {
  egg: L('item.egg'),
  larva: L('item.larva'),
  pupa: L('item.pupa'),
  food: L('item.food'),
  waste: L('item.waste'),
  soil: L('item.soil'),
  corpse: L('item.corpse'),
};


export interface ItemSave {
  id: number;
  t: ItemType;
  pl: ItemPlace;
  ch: number;
  nd: number;
  p: number[];
  yaw: number;
  fk: FoodKind;
  am: number;
  sa: number;
  hu: number;
  fe: number;
  wm: boolean;
  rd: boolean;
  rt: number;
  age: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Item {
  place: ItemPlace = 'none';
  chamber = -1;
  node = -1;
  carriedBy = -1;
  claimedBy = -1;
  pos = new THREE.Vector3();
  yaw = Math.random() * Math.PI * 2;

  foodKind: FoodKind = 'prey';
  amount = 1;

  stageAge = 0;
  hunger = 0;
  feeds = 0;
  wantsMove = false;
  ready = false;
  readyTime = 0;

  /** 存在时长（天），地表物品用于腐烂消失 */
  age = 0;

  constructor(
    public type: ItemType,
    public id: number,
  ) {}

  get isBrood(): boolean {
    return this.type === 'egg' || this.type === 'larva' || this.type === 'pupa';
  }

  get free(): boolean {
    return this.claimedBy < 0 && this.carriedBy < 0 && this.place !== 'gone';
  }

  toSave(): ItemSave {
    return {
      id: this.id,
      t: this.type,
      pl: this.place,
      ch: this.chamber,
      nd: this.node,
      p: [r3(this.pos.x), r3(this.pos.y), r3(this.pos.z)],
      yaw: r3(this.yaw),
      fk: this.foodKind,
      am: r3(this.amount),
      sa: r3(this.stageAge),
      hu: r3(this.hunger),
      fe: this.feeds,
      wm: this.wantsMove,
      rd: this.ready,
      rt: r3(this.readyTime),
      age: r3(this.age),
    };
  }

  /** 读档：认领与携带关系不恢复（蚂蚁的任务会重新开始） */
  static fromSave(s: ItemSave, ids: IdPool): Item {
    const it = new Item(s.t, s.id);
    ids.seen('item', s.id);
    it.place = s.pl;
    it.chamber = s.ch;
    it.node = s.nd;
    it.pos.set(s.p[0], s.p[1], s.p[2]);
    it.yaw = s.yaw;
    it.foodKind = s.fk;
    it.amount = s.am;
    it.stageAge = s.sa;
    it.hunger = s.hu;
    it.feeds = s.fe;
    it.wantsMove = s.wm;
    it.ready = s.rd;
    it.readyTime = s.rt;
    it.age = s.age;
    return it;
  }
}

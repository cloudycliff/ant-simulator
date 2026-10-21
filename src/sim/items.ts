import * as THREE from 'three';
import type { FoodKind } from '../world/food';

export type ItemType = 'egg' | 'larva' | 'pupa' | 'food' | 'waste' | 'soil' | 'corpse';

/** chamber=房间内，node=隧道节点，surface=地表散落，midden=巢外垃圾堆，mound=蚁丘土粒 */
export type ItemPlace = 'none' | 'chamber' | 'node' | 'surface' | 'midden' | 'mound' | 'carried' | 'gone';

export const ITEM_NAMES: Record<ItemType, string> = {
  egg: '卵',
  larva: '幼虫',
  pupa: '蛹',
  food: '食物',
  waste: '垃圾',
  soil: '土粒',
  corpse: '同伴尸体',
};

let nextItemId = 1;

export class Item {
  id = nextItemId++;
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

  constructor(public type: ItemType) {}

  get isBrood(): boolean {
    return this.type === 'egg' || this.type === 'larva' || this.type === 'pupa';
  }

  get free(): boolean {
    return this.claimedBy < 0 && this.carriedBy < 0 && this.place !== 'gone';
  }
}

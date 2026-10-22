import * as THREE from 'three';
import { HeightfieldSpace } from '../../core/space/heightfield';
import type { Space } from '../../core/space/space';
import { CONFIG } from './config';
import type { World } from './world/world';

/** 蚂蚁游戏的空间：地面是地形的高度场，可放置范围是整张地图 */
export function createSpace(w: World): Space {
  const W = CONFIG.world;
  const box = new THREE.Box3(new THREE.Vector3(-W.cameraRange, W.cameraMinY, -W.cameraRange), new THREE.Vector3(W.cameraRange, W.cameraMaxY, W.cameraRange));
  return new HeightfieldSpace((x, z) => w.terrain.heightAt(x, z), W.size, box);
}

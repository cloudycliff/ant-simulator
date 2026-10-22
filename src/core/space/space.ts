import type * as THREE from 'three';

/**
 * 世界的空间形状。相机、点选和工具通过它知道参考面在哪里、世界有多大，不直接读游戏的地形。
 * 高度场（地表加地下，见 heightfield.ts）和体积（鱼缸）各有一种实现
 */
export interface Space {
  /** 相机位置的范围 */
  readonly cameraBox: THREE.Box3;
  /** (x, z) 处参考面的高度：高度场是地面，体积是底面。相机按离它多远决定移动快慢 */
  surfaceAt(x: number, z: number): number;
  /** 射线与可放置表面的第一个交点（点地面、放工具），没有交点或在世界范围外返回 null */
  raycast(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 | null;
}

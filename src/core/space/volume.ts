import * as THREE from 'three';
import type { Space } from './space';

const _v = new THREE.Vector3();
const _box = new THREE.Vector3();

/**
 * 体积空间：一个盒子（鱼缸、饲养箱），里面的东西在三维里活动。底面是 floorAt 给的高度场，盒子外的表面是 volume.min.y。
 * 点选的表面：从顶面上方看是顶面（往里投放东西的开口），从侧面或里面看是底面，侧壁当作透明；看向水中没碰到底面时是视线在盒中那段的中点
 */
export class VolumeSpace implements Space {
  constructor(
    readonly volume: THREE.Box3,
    private readonly floorAt: (x: number, z: number) => number,
    readonly cameraBox: THREE.Box3,
  ) {}

  private inside(x: number, z: number): boolean {
    const b = this.volume;
    return x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z;
  }

  surfaceAt(x: number, z: number): number {
    return this.inside(x, z) ? this.floorAt(x, z) : this.volume.min.y;
  }

  raycast(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.volume;
    const o = ray.origin;
    const d = ray.direction;
    if (o.y >= b.max.y) {
      if (d.y >= 0) return null;
      out.copy(o).addScaledVector(d, (b.max.y - o.y) / d.y);
      return this.inside(out.x, out.z) ? out : null;
    }
    // 在盒子里沿视线找底面；从外面看先走到盒子的入口。穿过盒子没碰到底面（隔着前壁看水里）就取视线在盒中那段的中点
    let t = 0;
    if (!b.containsPoint(o)) {
      if (!ray.intersectBox(b, _box)) return null;
      t = _box.distanceTo(o);
    }
    const enter = t;
    const h = (s: number) => {
      _v.copy(o).addScaledVector(d, s);
      return _v.y - this.floorAt(_v.x, _v.z);
    };
    const step = 0.5;
    for (let i = 0; i < 2000; i++) {
      const nt = t + step;
      _v.copy(o).addScaledVector(d, nt);
      if (!b.containsPoint(_v)) return out.copy(o).addScaledVector(d, (enter + t) / 2);
      if (h(nt) <= 0) {
        let a = t;
        let c = nt;
        for (let k = 0; k < 12; k++) {
          const m = (a + c) / 2;
          if (h(m) > 0) a = m;
          else c = m;
        }
        return out.copy(o).addScaledVector(d, c);
      }
      t = nt;
    }
    return null;
  }
}

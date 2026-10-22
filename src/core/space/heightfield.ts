import * as THREE from 'three';
import type { Space } from './space';

const _v = new THREE.Vector3();

/** 高度场空间：地面是 heightAt 给出的曲面，可放置的范围是边长 size 的正方形 */
export class HeightfieldSpace implements Space {
  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    private readonly size: number,
    readonly cameraBox: THREE.Box3,
  ) {}

  surfaceAt(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  /** 沿射线步进，与高度场求交后二分细化（比对地形网格做射线检测快得多）；射线起点在地下时返回 null */
  raycast(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 | null {
    const o = ray.origin;
    const d = ray.direction;
    const h = (p: THREE.Vector3) => p.y - this.heightAt(p.x, p.z);
    let t = 0;
    let prev = h(o);
    if (prev < 0) return null;
    for (let i = 0; i < 400; i++) {
      const step = Math.max(0.3, prev * 0.5);
      const nt = t + step;
      _v.copy(o).addScaledVector(d, nt);
      const cur = h(_v);
      if (cur <= 0) {
        let a = t;
        let b = nt;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          _v.copy(o).addScaledVector(d, m);
          if (h(_v) > 0) a = m;
          else b = m;
        }
        out.copy(o).addScaledVector(d, b);
        const half = this.size / 2;
        return Math.abs(out.x) < half && Math.abs(out.z) < half ? out : null;
      }
      t = nt;
      prev = cur;
      if (t > 1500) break;
    }
    return null;
  }
}

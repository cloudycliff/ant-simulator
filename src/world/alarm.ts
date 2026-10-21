import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Terrain } from './terrain';

export interface AlarmSource {
  x: number;
  z: number;
  s: number;
}

const MAX_SOURCES = 32;

/**
 * 警报信息素：黑毛蚁受到攻击时从下颚腺释放的挥发性物质，几秒内就会散去。
 * 只在少数地点出现，所以用点源列表而不是网格；浓度 = 强度 × 距离线性衰减。
 */
export class AlarmField {
  sources: AlarmSource[] = [];
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });

  constructor(private terrain: Terrain) {
    const geo = new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SOURCES; i++) {
      const m = new THREE.Mesh(geo, this.mat.clone());
      m.renderOrder = 6;
      m.visible = false;
      this.rings.push(m);
      this.group.add(m);
    }
  }

  /** 在 (x,z) 释放 amount；2 cm 内已有的点源直接加强 */
  emit(x: number, z: number, amount: number): void {
    const max = CONFIG.defense.alarmMax;
    for (const p of this.sources) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 > 4) continue;
      p.s = Math.min(max, p.s + amount);
      p.x += (x - p.x) * 0.2;
      p.z += (z - p.z) * 0.2;
      return;
    }
    if (this.sources.length < MAX_SOURCES) this.sources.push({ x, z, s: Math.min(max, amount) });
  }

  update(dt: number): void {
    if (!this.sources.length) return;
    const k = Math.pow(0.5, dt / CONFIG.defense.alarmHalfLife);
    for (const p of this.sources) p.s *= k;
    this.sources = this.sources.filter((p) => p.s > 0.03);
  }

  /** (x,z) 处闻到的最强一处警报 */
  strongest(x: number, z: number): { x: number; z: number; level: number } | null {
    const R = CONFIG.defense.alarmRadius;
    let best: AlarmSource | null = null;
    let bl = 0;
    for (const p of this.sources) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d >= R) continue;
      const l = p.s * (1 - d / R);
      if (l > bl) {
        bl = l;
        best = p;
      }
    }
    return best ? { x: best.x, z: best.z, level: bl } : null;
  }

  /** 信息素视图打开时用红圈标出警报范围，圈的大小和透明度随强度变化 */
  sync(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    const R = CONFIG.defense.alarmRadius;
    this.rings.forEach((m, i) => {
      const p = this.sources[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, this.terrain.heightAt(p.x, p.z) + 0.3, p.z);
      m.scale.setScalar(R * Math.min(1, 0.35 + p.s * 0.5));
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, 0.2 + p.s * 0.4);
    });
  }
}

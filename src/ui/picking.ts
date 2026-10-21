import * as THREE from 'three';
import { CONFIG } from '../config';
import type { AntView } from '../render/antView';
import type { World } from '../world/world';

export type Selection =
  | { kind: 'ant'; id: number }
  | { kind: 'chamber'; id: number }
  | { kind: 'food'; id: number }
  | { kind: 'entrance'; id: number }
  | { kind: 'midden' }
  | { kind: 'stone' }
  | { kind: 'plant'; id: number }
  | { kind: 'placed'; id: number }
  | { kind: 'puddle'; id: number };

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Picker {
  private ray = new THREE.Raycaster();
  middenTarget: THREE.Mesh;

  constructor(
    private world: World,
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private antView: AntView,
    private targets: { chambers: THREE.Object3D[]; surface: THREE.Object3D[]; terrain: THREE.Object3D },
  ) {
    const m = world.colony.midden;
    this.middenTarget = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.2, 16), new THREE.MeshBasicMaterial());
    this.middenTarget.position.set(m.x, world.terrain.heightAt(m.x, m.z), m.z);
    this.middenTarget.userData.pick = { kind: 'midden' };
    this.middenTarget.visible = false;
    this.middenTarget.updateMatrixWorld();
  }

  /** 鼠标下的地面点：沿视线步进，与解析高度场求交（比对地形网格做射线检测快得多） */
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    _o.copy(this.ray.ray.origin);
    _d.copy(this.ray.ray.direction);
    const h = (p: THREE.Vector3) => p.y - this.world.terrain.heightAt(p.x, p.z);
    let t = 0;
    let prev = h(_o);
    if (prev < 0) return null;
    for (let i = 0; i < 400; i++) {
      const step = Math.max(0.3, prev * 0.5);
      const nt = t + step;
      _v.copy(_o).addScaledVector(_d, nt);
      const cur = h(_v);
      if (cur <= 0) {
        let a = t;
        let b = nt;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          _v.copy(_o).addScaledVector(_d, m);
          if (h(_v) > 0) a = m;
          else b = m;
        }
        out.copy(_o).addScaledVector(_d, b);
        return Math.abs(out.x) < CONFIG.world.size / 2 && Math.abs(out.z) < CONFIG.world.size / 2 ? out : null;
      }
      t = nt;
      prev = cur;
      if (t > 1500) break;
    }
    return null;
  }

  pick(clientX: number, clientY: number, xray: boolean): Selection | null {
    const rect = this.dom.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    // 蚂蚁：屏幕空间最近，容差随距离放大以便点中远处的小个体
    let bestAnt = -1;
    let bestScore = Infinity;
    for (const a of this.world.colony.ants) {
      if (!this.antView.isVisible(a)) continue;
      _v.copy(a.pos).project(this.camera);
      if (_v.z > 1 || _v.z < -1) continue;
      const px = (_v.x * 0.5 + 0.5) * rect.width;
      const py = (-_v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(px - sx, py - sy);
      if (d > 16) continue;
      const camD = a.pos.distanceTo(this.camera.position);
      const score = d + camD * 0.02;
      if (score < bestScore) {
        bestScore = score;
        bestAnt = a.id;
      }
    }

    this.ray.setFromCamera(
      new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1),
      this.camera,
    );
    const objects: THREE.Object3D[] = [...this.targets.surface, this.middenTarget];
    if (xray) objects.push(...this.targets.chambers);
    else objects.push(this.targets.terrain);
    const hits = this.ray.intersectObjects(objects, true);
    let hitSel: Selection | null = null;
    let hitDist = Infinity;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick && o.name !== 'terrain') o = o.parent;
      if (!o || o.name === 'terrain') break;
      hitSel = o.userData.pick as Selection;
      hitDist = h.distance;
      break;
    }

    if (bestAnt >= 0) {
      const a = this.world.colony.antById(bestAnt)!;
      const antDist = a.pos.distanceTo(this.camera.position);
      // 点在房间内部时优先选中蚂蚁；地表物体比蚂蚁更近时选物体
      if (!hitSel || hitSel.kind === 'chamber' || antDist < hitDist + 2) return { kind: 'ant', id: bestAnt };
    }
    return hitSel;
  }
}

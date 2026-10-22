import * as THREE from 'three';
import type { Space } from '../../../core/space/space';
import type { AntView } from '../render/antView';
import type { GameRef } from '../world/entities';
import type { World } from '../world/world';

const _v = new THREE.Vector3();

export class Picker {
  private ray = new THREE.Raycaster();
  middenTarget: THREE.Mesh;

  constructor(
    private world: World,
    private space: Space,
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

  /** 鼠标下的地面点 */
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    return this.space.raycast(this.ray.ray, out);
  }

  /** tolerance：蚂蚁的点选容差（像素），手指点选时放宽 */
  pick(clientX: number, clientY: number, xray: boolean, tolerance = 16): GameRef | null {
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
      if (d > tolerance) continue;
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
    let hitSel: GameRef | null = null;
    let hitDist = Infinity;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick && o.name !== 'terrain') o = o.parent;
      if (!o || o.name === 'terrain') break;
      hitSel = o.userData.pick as GameRef;
      hitDist = h.distance;
      break;
    }

    if (bestAnt >= 0) {
      const a = this.world.colony.antById(bestAnt)!;
      const antDist = a.pos.distanceTo(this.camera.position);
      // 点在房间内部或垃圾堆上时优先选中蚂蚁（这两种范围大，很少需要专门点）；其他地表物体比蚂蚁更近时选物体
      if (!hitSel || hitSel.kind === 'chamber' || hitSel.kind === 'midden' || antDist < hitDist + 2) return { kind: 'ant', id: bestAnt };
    }
    return hitSel;
  }
}

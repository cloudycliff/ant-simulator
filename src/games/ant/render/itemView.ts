import * as THREE from 'three';
import type { Item, ItemType } from '../sim/items';
import type { World } from '../world/world';
import { buildAntGeometry } from './antView';

interface Layer {
  mesh: THREE.InstancedMesh;
  scale: THREE.Vector3;
  n: number;
}

const FOOD_COLORS = { prey: 0x8c3a26, seed: 0x7a5530, sugar: 0xe0a030 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class ItemView {
  group = new THREE.Group();
  private layers: Record<ItemType, Layer>;
  xray = false;

  constructor(private world: World) {
    const mk = (geo: THREE.BufferGeometry, color: number, cap: number, scale: [number, number, number], rough = 0.7): Layer => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: rough });
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      return { mesh, scale: new THREE.Vector3(...scale), n: 0 };
    };
    const sphere = new THREE.SphereGeometry(1, 10, 7);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    // 幼虫：略弯的 C 形
    const larva = new THREE.SphereGeometry(1, 10, 7);
    const lp = larva.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) + lp.getX(i) * lp.getX(i) * 0.35);
    larva.computeVertexNormals();

    const corpseMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x6b5a4a, roughness: 0.8 });
    const corpse = new THREE.InstancedMesh(buildAntGeometry(false), corpseMat, 500);
    corpse.frustumCulled = false;
    this.group.add(corpse);

    this.layers = {
      egg: mk(sphere, 0xf6f1e2, 2500, [0.11, 0.085, 0.085], 0.3),
      larva: mk(larva, 0xf0e2c0, 2500, [0.24, 0.13, 0.14], 0.5),
      pupa: mk(sphere, 0xd9b98a, 2500, [0.34, 0.15, 0.15], 0.8),
      food: mk(rock, 0xffffff, 1800, [0.15, 0.13, 0.15], 0.6),
      waste: mk(rock, 0x4b4139, 1800, [0.13, 0.1, 0.13], 1),
      soil: mk(rock, 0x7a5636, 1800, [0.12, 0.1, 0.12], 1),
      corpse: { mesh: corpse, scale: new THREE.Vector3(1, 1, 1), n: 0 },
    };
  }

  private put(it: Item, pos: THREE.Vector3, carried: boolean): void {
    const L = this.layers[it.type];
    if (L.n >= L.mesh.instanceMatrix.count) return;
    if (it.type === 'corpse') {
      // 仰面或侧卧的尸体
      _e.set(carried ? 0.3 : 2.6, it.yaw, 0.2);
      _s.setScalar(0.95);
    } else {
      _e.set(0, it.yaw, it.type === 'pupa' || it.type === 'larva' ? 0.15 : 0);
      _s.copy(L.scale);
      if (it.type === 'food' && it.amount < 1) _s.multiplyScalar(0.6 + 0.4 * it.amount);
    }
    _q.setFromEuler(_e);
    _m.compose(pos, _q, _s);
    L.mesh.setMatrixAt(L.n, _m);
    if (it.type === 'food') {
      _c.setHex(FOOD_COLORS[it.foodKind]);
      L.mesh.setColorAt(L.n, _c);
    }
    L.n++;
  }

  update(): void {
    for (const k in this.layers) this.layers[k as ItemType].n = 0;
    const xr = this.xray;
    for (const it of this.world.colony.items) {
      if (it.place === 'carried' || it.place === 'gone') continue;
      const under = it.place === 'chamber' || it.place === 'node';
      if (under && !xr) continue;
      this.put(it, it.pos, false);
    }
    for (const a of this.world.colony.ants) {
      if (!a.carrying) continue;
      if (a.domain === 'nest' && !xr) continue;
      a.mouthPosition(_p);
      this.put(a.carrying, _p, true);
    }
    for (const k in this.layers) {
      const L = this.layers[k as ItemType];
      L.mesh.count = L.n;
      L.mesh.instanceMatrix.needsUpdate = true;
      if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
    }
  }
}

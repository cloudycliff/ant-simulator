import * as THREE from 'three';
import { CONFIG } from '../config';
import { L, type Text } from '../../../core/i18n';
import { Noise2D, Rng } from '../../../core/util/random';
import type { Terrain } from './terrain';

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: 'stone' | 'twig' | 'plant' | 'water';
}

export type PlaceableObstacle = 'pebble' | 'rock' | 'twig';

export const OBSTACLE_INFO: Record<PlaceableObstacle, { name: Text; r: number; len?: number }> = {
  pebble: { name: L('obstacle.pebble'), r: 1.6 },
  rock: { name: L('obstacle.rock'), r: 4 },
  twig: { name: L('obstacle.twig'), r: 0.5, len: 18 },
};

/** 玩家放置的障碍物；树枝路障由一串避障圆组成 */
export interface PlacedObstacle {
  id: number;
  kind: PlaceableObstacle;
  x: number;
  z: number;
  yaw: number;
  /** 石块网格的形状参数，存档后按它还原同样的形状 */
  shape: number;
  parts: Obstacle[];
  mesh: THREE.Object3D;
}

export interface Plant {
  index: number;
  x: number;
  z: number;
  /** 茎基部高度 */
  baseY: number;
  height: number;
  /** 蚜虫的寄主植物 */
  host: boolean;
}

/** 草、石块、落叶、枯枝和小型植物。石块和植物茎同时登记为蚂蚁的避障圆。 */
export class Vegetation {
  group = new THREE.Group();
  /** 玩家放置的障碍物，单独成组便于拾取 */
  placedGroup = new THREE.Group();
  grass!: THREE.InstancedMesh;
  private leaves!: THREE.InstancedMesh;
  private leafSpots: { x: number; z: number; len: number }[] = [];
  obstacles: Obstacle[] = [];
  plants: Plant[] = [];
  placed: PlacedObstacle[] = [];
  private nextPlacedId = 1;
  private grid = new Map<number, number[]>();
  private readonly gcell = 8;
  private grassMat!: THREE.MeshStandardMaterial;
  private windUniform = { value: 0 };
  /** 草叶摆幅倍数，下雨时变大 */
  private gustUniform = { value: 1 };
  /** 植物叶片的挂点：下雨时被雨压低，雨滴打中时上下颤动 */
  private leafPivots: { pivot: THREE.Object3D; rest: number; off: number; v: number }[] = [];
  private stoneMat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.92, flatShading: true });
  private twigMat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
  private rockNoise!: Noise2D;

  constructor(private terrain: Terrain, private rng: Rng) {}

  build(): void {
    this.group.add(this.placedGroup);
    this.buildGrass();
    this.buildStones();
    this.buildLeaves();
    this.buildTwigs();
    this.buildPlants();
  }

  private key(i: number, j: number): number {
    return (i + 1000) * 4000 + (j + 1000);
  }

  addObstacle(o: Obstacle): void {
    this.obstacles.push(o);
    this.index(o, this.obstacles.length - 1);
  }

  /** 移除若干避障圆并重建网格（索引随之变化） */
  removeObstacles(list: Obstacle[]): void {
    const drop = new Set(list);
    this.obstacles = this.obstacles.filter((o) => !drop.has(o));
    this.grid.clear();
    this.obstacles.forEach((o, i) => this.index(o, i));
  }

  private index(o: Obstacle, idx: number): void {
    const i0 = Math.floor((o.x - o.r) / this.gcell);
    const i1 = Math.floor((o.x + o.r) / this.gcell);
    const j0 = Math.floor((o.z - o.r) / this.gcell);
    const j1 = Math.floor((o.z + o.r) / this.gcell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(idx);
      }
  }

  /** 返回包含点 (x,z) 的障碍物（考虑额外半径）；solid 为 true 时忽略水洼 */
  obstacleAt(x: number, z: number, pad = 0, solid = false): Obstacle | null {
    const arr = this.grid.get(this.key(Math.floor(x / this.gcell), Math.floor(z / this.gcell)));
    if (!arr) return null;
    for (const i of arr) {
      const o = this.obstacles[i];
      if (solid && o.kind === 'water') continue;
      const rr = o.r + pad;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < rr * rr) return o;
    }
    return null;
  }

  private placeable(x: number, z: number, minR: number): boolean {
    if (Math.hypot(x, z) < minR) return false;
    return !this.obstacleAt(x, z, 1.5);
  }

  private buildGrass(): void {
    const blade = new THREE.BufferGeometry();
    // 一片草叶：底宽顶尖的弯曲三角带
    const segs = 4;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.32 * (1 - t);
      const bend = t * t * 0.6;
      verts.push(-w, t, bend, w, t, bend);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setIndex(idx);
    blade.computeVertexNormals();

    const count = 26000;
    this.grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const wind = this.windUniform;
    const gust = this.gustUniform;
    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.uniforms.uGust = gust;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;\nuniform float uGust;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
           float sway = sin(uWind * 1.7 + wp.x * 0.11 + wp.z * 0.07) * 0.18 + sin(uWind * 3.1 + wp.x * 0.3) * 0.05;
           transformed.x += sway * uGust * position.y * position.y;`,
        );
    };
    this.grass = new THREE.InstancedMesh(blade, this.grassMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const half = CONFIG.world.size / 2 - 2;
    let placed = 0;
    let tries = 0;
    while (placed < count && tries < count * 8) {
      tries++;
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      const d = this.terrain.grassDensity(x, z);
      if (this.rng.next() > d) continue;
      const h = this.rng.range(3.5, 10) * (0.5 + d * 0.7);
      p.set(x, this.terrain.heightAt(x, z) - 0.1, z);
      e.set(this.rng.range(-0.2, 0.2), this.rng.range(0, Math.PI * 2), this.rng.range(-0.2, 0.2));
      q.setFromEuler(e);
      s.set(this.rng.range(0.7, 1.4), h, 1);
      m.compose(p, q, s);
      this.grass.setMatrixAt(placed, m);
      c.setHSL(this.rng.range(0.2, 0.28), this.rng.range(0.35, 0.6), this.rng.range(0.22, 0.38));
      this.grass.setColorAt(placed, c);
      placed++;
    }
    this.grass.count = placed;
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.group.add(this.grass);
  }

  private stoneMesh(x: number, z: number, r: number, yaw: number, off = this.rng.range(0, 100)): THREE.Mesh {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // 位移只取决于顶点方向，非索引几何中重复的顶点得到相同位移，避免面片裂开
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const k = 0.82 + this.rockNoise.fbm(px * 1.3 + pz * 0.7 + off, py * 1.3 - pz * 0.5, 3) * 0.6;
      pos.setXYZ(i, px * k, Math.max(py * k * 0.55, -0.15), pz * k);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.stoneMat);
    mesh.scale.setScalar(r);
    mesh.rotation.y = yaw;
    mesh.position.set(x, this.terrain.heightAt(x, z) + r * 0.12, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = { kind: 'stone' };
    return mesh;
  }

  /** 放置玩家障碍物。调用方负责检查位置是否可用 */
  place(kind: PlaceableObstacle, x: number, z: number, yaw: number, shape?: number): PlacedObstacle {
    const info = OBSTACLE_INFO[kind];
    if (shape === undefined) shape = kind === 'twig' ? 0 : this.rng.range(0, 100);
    const parts: Obstacle[] = [];
    let mesh: THREE.Object3D;
    if (kind === 'twig') {
      const len = info.len!;
      const geo = new THREE.CylinderGeometry(0.42, 0.55, len, 7);
      geo.rotateZ(Math.PI / 2);
      mesh = new THREE.Mesh(geo, this.twigMat);
      mesh.position.set(x, this.terrain.heightAt(x, z) + 0.45, z);
      mesh.rotation.y = -yaw;
      mesh.castShadow = true;
      const n = Math.ceil(len / 0.9);
      for (let i = 0; i <= n; i++) {
        const t = (i / n - 0.5) * len;
        parts.push({ x: x + Math.cos(yaw) * t, z: z + Math.sin(yaw) * t, r: info.r, kind: 'twig' });
      }
    } else {
      mesh = this.stoneMesh(x, z, info.r, yaw, shape);
      parts.push({ x, z, r: info.r * 0.85, kind: 'stone' });
    }
    const p: PlacedObstacle = { id: this.nextPlacedId++, kind, x, z, yaw, shape, parts, mesh };
    mesh.traverse((o) => (o.userData.pick = { kind: 'placed', id: p.id }));
    for (const o of parts) this.addObstacle(o);
    this.placedGroup.add(mesh);
    this.placed.push(p);
    return p;
  }

  /** (x,z) 附近 r 范围内最近的玩家障碍物 */
  placedNear(x: number, z: number, r: number): PlacedObstacle | null {
    let best: PlacedObstacle | null = null;
    let bd = Infinity;
    for (const p of this.placed)
      for (const o of p.parts) {
        const d = Math.hypot(o.x - x, o.z - z) - o.r;
        if (d < r && d < bd) {
          bd = d;
          best = p;
        }
      }
    return best;
  }

  removePlaced(p: PlacedObstacle): void {
    this.removeObstacles(p.parts);
    this.placedGroup.remove(p.mesh);
    this.placed.splice(this.placed.indexOf(p), 1);
  }

  placedById(id: number): PlacedObstacle | undefined {
    return this.placed.find((p) => p.id === id);
  }

  private buildStones(): void {
    this.rockNoise = new Noise2D(this.rng.int(1, 1e6));
    const list: { x: number; z: number; r: number }[] = [
      // 蚁穴旁的一块大石头：黑毛蚁常在石块下筑巢
      { x: -11, z: 7, r: 5.5 },
    ];
    for (let i = 0; i < 55; i++) {
      const x = this.rng.range(-110, 110);
      const z = this.rng.range(-110, 110);
      const r = this.rng.chance(0.15) ? this.rng.range(3, 7) : this.rng.range(0.6, 2.4);
      if (!this.placeable(x, z, 16 + r)) continue;
      list.push({ x, z, r });
    }
    for (const st of list) {
      // 朝向必须在形状之后取随机数，调换顺序会改变整个世界布局
      const mesh = this.stoneMesh(st.x, st.z, st.r, 0);
      mesh.rotation.y = this.rng.range(0, Math.PI * 2);
      this.group.add(mesh);
      this.addObstacle({ x: st.x, z: st.z, r: st.r * 0.85, kind: 'stone' });
    }
  }

  /** 去掉会横在坑上的落叶（落叶贴着原地面摆放） */
  clearLitter(x: number, z: number, r: number): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.leafSpots.forEach((l, i) => {
      if (Math.hypot(l.x - x, l.z - z) < r + l.len) this.leaves.setMatrixAt(i, zero);
    });
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  private buildLeaves(): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, -1);
    shape.quadraticCurveTo(0.65, -0.2, 0, 1);
    shape.quadraticCurveTo(-0.65, -0.2, 0, -1);
    const geo = new THREE.ShapeGeometry(shape, 6);
    geo.rotateX(-Math.PI / 2);
    const count = 420;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    const leaves = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-115, 115);
      const z = this.rng.range(-115, 115);
      const sc = this.rng.range(1.8, 4.5);
      e.set(this.rng.range(-0.15, 0.15), this.rng.range(0, Math.PI * 2), this.rng.range(-0.15, 0.15));
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.08, z), q, new THREE.Vector3(sc * 0.6, 1, sc));
      leaves.setMatrixAt(i, m);
      this.leafSpots.push({ x, z, len: sc });
      c.setHSL(this.rng.range(0.05, 0.12), this.rng.range(0.4, 0.7), this.rng.range(0.22, 0.4));
      leaves.setColorAt(i, c);
    }
    leaves.receiveShadow = true;
    this.leaves = leaves;
    this.group.add(leaves);
  }

  private buildTwigs(): void {
    const mat = this.twigMat;
    for (let i = 0; i < 40; i++) {
      const x = this.rng.range(-110, 110);
      const z = this.rng.range(-110, 110);
      if (!this.placeable(x, z, 12)) continue;
      const len = this.rng.range(6, 18);
      const geo = new THREE.CylinderGeometry(0.22, 0.32, len, 6);
      geo.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, this.terrain.heightAt(x, z) + 0.25, z);
      mesh.rotation.y = this.rng.range(0, Math.PI);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  private buildPlants(): void {
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d7a2e, roughness: 0.8 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x5f9a35, roughness: 0.7, side: THREE.DoubleSide });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xf2e26a, roughness: 0.6 });
    const spots: { x: number; z: number; host: boolean }[] = [];
    // 蚁穴附近的蚜虫寄主植物，避开默认视角所在的东南方向
    for (const [ang, dist] of [
      [2.1, 30],
      [3.3, 42],
      [4.4, 27],
      [5.5, 48],
    ]) {
      for (let k = 0; k < 12; k++) {
        const a = ang + this.rng.range(-0.25, 0.25);
        const d = dist + this.rng.range(-4, 4);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (!this.placeable(x, z, 20)) continue;
        spots.push({ x, z, host: true });
        break;
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = this.rng.range(-105, 105);
      const z = this.rng.range(-105, 105);
      if (!this.placeable(x, z, 22)) continue;
      // 不挡住默认视角（相机在蚁穴东南方向）
      if (x > 0 && z > 0 && Math.hypot(x, z) < 70) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 8)) continue;
      spots.push({ x, z, host: false });
    }
    for (const { x, z, host } of spots) {
      const g = new THREE.Group();
      const h = this.rng.range(18, 34);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, h, 6), stemMat);
      stem.position.y = h / 2;
      stem.castShadow = true;
      g.add(stem);
      const nLeaves = this.rng.int(3, 6);
      for (let k = 0; k < nLeaves; k++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), leafMat);
        leaf.scale.set(4.5, 0.15, 1.6);
        leaf.position.x = 4;
        leaf.castShadow = true;
        const pivot = new THREE.Group();
        pivot.position.set(0, h * (0.25 + 0.6 * (k / nLeaves)), 0);
        pivot.rotation.set(0, (k * 2.4) % (Math.PI * 2), -0.35);
        pivot.add(leaf);
        g.add(pivot);
        this.leafPivots.push({ pivot, rest: -0.35, off: 0, v: 0 });
      }
      if (this.rng.chance(0.6)) {
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), flowerMat);
        fl.position.y = h + 0.8;
        g.add(fl);
      }
      const baseY = this.terrain.heightAt(x, z) - 0.2;
      g.position.set(x, baseY, z);
      const index = this.plants.length;
      g.userData.pick = { kind: 'plant', id: index };
      this.group.add(g);
      this.plants.push({ index, x, z, baseY, height: h, host });
      this.addObstacle({ x, z, r: 0.9, kind: 'plant' });
    }
  }

  /** 只影响画面，用 Math.random 而不是世界随机数 */
  update(dt: number, rain: number): void {
    this.windUniform.value += dt * (1 + rain * 0.8);
    this.gustUniform.value = 1 + rain * 1.2;
    const droop = -0.22 * rain;
    for (const l of this.leafPivots) {
      if (rain > 0.02 && Math.random() < rain * dt * 3) l.v -= 0.6 + Math.random() * 0.8;
      l.v += ((droop - l.off) * 40 - l.v * 4) * dt;
      l.off += l.v * dt;
      l.pivot.rotation.z = l.rest + l.off;
    }
  }

  setGrassVisible(v: boolean): void {
    this.grass.visible = v;
  }

  setLeavesVisible(v: boolean): void {
    this.leaves.visible = v;
  }
}

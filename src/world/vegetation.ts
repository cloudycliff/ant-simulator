import * as THREE from 'three';
import { CONFIG } from '../config';
import { Noise2D, Rng } from '../util/random';
import type { Terrain } from './terrain';

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: 'stone' | 'twig' | 'plant';
}

/** 草、石块、落叶、枯枝和小型植物。石块和植物茎同时登记为蚂蚁的避障圆。 */
export class Vegetation {
  group = new THREE.Group();
  grass!: THREE.InstancedMesh;
  private leaves!: THREE.InstancedMesh;
  obstacles: Obstacle[] = [];
  private grid = new Map<number, number[]>();
  private readonly gcell = 8;
  private grassMat!: THREE.MeshStandardMaterial;
  private windUniform = { value: 0 };

  constructor(private terrain: Terrain, private rng: Rng) {}

  build(): void {
    this.buildGrass();
    this.buildStones();
    this.buildLeaves();
    this.buildTwigs();
    this.buildPlants();
  }

  private key(i: number, j: number): number {
    return (i + 1000) * 4000 + (j + 1000);
  }

  private addObstacle(o: Obstacle): void {
    const idx = this.obstacles.length;
    this.obstacles.push(o);
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

  /** 返回包含点 (x,z) 的障碍物（考虑额外半径） */
  obstacleAt(x: number, z: number, pad = 0): Obstacle | null {
    const arr = this.grid.get(this.key(Math.floor(x / this.gcell), Math.floor(z / this.gcell)));
    if (!arr) return null;
    for (const i of arr) {
      const o = this.obstacles[i];
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
    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
           float sway = sin(uWind * 1.7 + wp.x * 0.11 + wp.z * 0.07) * 0.18 + sin(uWind * 3.1 + wp.x * 0.3) * 0.05;
           transformed.x += sway * position.y * position.y;`,
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

  private buildStones(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.92, flatShading: true });
    const rockNoise = new Noise2D(this.rng.int(1, 1e6));
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
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const off = this.rng.range(0, 100);
      for (let i = 0; i < pos.count; i++) {
        // 位移只取决于顶点方向，非索引几何中重复的顶点得到相同位移，避免面片裂开
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const k = 0.82 + rockNoise.fbm(x * 1.3 + z * 0.7 + off, y * 1.3 - z * 0.5, 3) * 0.6;
        pos.setXYZ(i, x * k, Math.max(y * k * 0.55, -0.15), z * k);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(st.r);
      mesh.rotation.y = this.rng.range(0, Math.PI * 2);
      mesh.position.set(st.x, this.terrain.heightAt(st.x, st.z) + st.r * 0.12, st.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { kind: 'stone' };
      this.group.add(mesh);
      this.addObstacle({ x: st.x, z: st.z, r: st.r * 0.85, kind: 'stone' });
    }
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
      c.setHSL(this.rng.range(0.05, 0.12), this.rng.range(0.4, 0.7), this.rng.range(0.22, 0.4));
      leaves.setColorAt(i, c);
    }
    leaves.receiveShadow = true;
    this.leaves = leaves;
    this.group.add(leaves);
  }

  private buildTwigs(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
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
    for (let i = 0; i < 26; i++) {
      const x = this.rng.range(-105, 105);
      const z = this.rng.range(-105, 105);
      if (!this.placeable(x, z, 22)) continue;
      // 不挡住默认视角（相机在蚁穴东南方向）
      if (x > 0 && z > 0 && Math.hypot(x, z) < 70) continue;
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
        leaf.position.set(0, h * (0.25 + 0.6 * (k / nLeaves)), 0);
        leaf.rotation.set(0, (k * 2.4) % (Math.PI * 2), -0.35);
        leaf.translateX(4);
        leaf.castShadow = true;
        g.add(leaf);
      }
      if (this.rng.chance(0.6)) {
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), flowerMat);
        fl.position.y = h + 0.8;
        g.add(fl);
      }
      g.position.set(x, this.terrain.heightAt(x, z) - 0.2, z);
      g.userData.pick = { kind: 'plant' };
      this.group.add(g);
      this.addObstacle({ x, z, r: 0.9, kind: 'plant' });
    }
  }

  update(time: number): void {
    this.windUniform.value = time;
  }

  setGrassVisible(v: boolean): void {
    this.grass.visible = v;
  }

  setLeavesVisible(v: boolean): void {
    this.leaves.visible = v;
  }
}

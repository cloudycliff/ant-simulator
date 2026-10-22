import * as THREE from 'three';
import { CONFIG } from '../config';
import type { SimClock } from '../../../core/sim/clock';
import type { PheromoneField } from './pheromone';
import type { Terrain } from './terrain';
import type { Obstacle, Vegetation } from './vegetation';

let nextPuddleId = 1;

/** 地表水洼：蚂蚁会绕开，水下的信息素被冲掉；随温度蒸发、渗入土壤后缩小消失 */
export class Puddle {
  id = nextPuddleId++;
  /** 剩余水量，1 为刚浇下 */
  water = 1;
  readonly obstacle: Obstacle;
  meshR = 0;
  constructor(
    public x: number,
    public z: number,
    public r0: number,
    public mesh: THREE.Mesh,
  ) {
    this.obstacle = { x, z, r: r0, kind: 'water' };
  }
  get r(): number {
    return this.r0 * Math.sqrt(this.water);
  }
}

export class WaterManager {
  group = new THREE.Group();
  puddles: Puddle[] = [];
  private mat = new THREE.MeshStandardMaterial({
    color: 0x5f9ccc,
    roughness: 0.05,
    metalness: 0.15,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  private washTimer = 0;

  constructor(
    private terrain: Terrain,
    private veg: Vegetation,
    private pheromone: PheromoneField,
  ) {}

  /** 在 (x,z) 浇水；落在已有水洼里时合并成更大的水洼 */
  pour(x: number, z: number, r: number): Puddle {
    const I = CONFIG.intervention;
    this.pheromone.wash(x, z, r + 1, I.washTrail, I.washHome);
    const hit = this.puddles.find((p) => Math.hypot(p.x - x, p.z - z) < p.r + r * 0.5);
    if (hit) {
      hit.r0 = Math.min(14, Math.hypot(hit.r, r));
      hit.water = 1;
      hit.obstacle.r = hit.r0;
      this.veg.removeObstacles([hit.obstacle]);
      this.veg.addObstacle(hit.obstacle);
      this.reshape(hit);
      return hit;
    }
    return this.create(x, z, r, 1);
  }

  private create(x: number, z: number, r0: number, water: number): Puddle {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    const p = new Puddle(x, z, r0, mesh);
    p.water = water;
    p.obstacle.r = p.r;
    mesh.userData.pick = { kind: 'puddle', id: p.id };
    this.reshape(p);
    this.group.add(mesh);
    this.veg.addObstacle(p.obstacle);
    this.puddles.push(p);
    return p;
  }

  toSave(): { x: number; z: number; r0: number; water: number }[] {
    return this.puddles.map((p) => ({ x: p.x, z: p.z, r0: p.r0, water: p.water }));
  }

  /** 读档：直接重建水洼，不再冲刷信息素（信息素网格单独恢复） */
  restore(list: { x: number; z: number; r0: number; water: number }[]): void {
    for (const s of list) this.create(s.x, s.z, s.r0, s.water);
  }

  at(x: number, z: number): Puddle | null {
    for (const p of this.puddles) {
      const r = p.obstacle.r;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return p;
    }
    return null;
  }

  byId(id: number): Puddle | undefined {
    return this.puddles.find((p) => p.id === id);
  }

  update(dt: number, clock: SimClock): void {
    const t = clock.temperatureAt(0);
    const rate = (dt / (CONFIG.intervention.waterDays * CONFIG.time.dayLength)) * Math.max(0.3, 0.4 + t / 33) * (1 - 0.9 * clock.groundWet);
    this.washTimer += dt;
    const wash = this.washTimer > 0.5;
    if (wash) this.washTimer = 0;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.water -= rate;
      if (p.water <= 0.04) {
        this.veg.removeObstacles([p.obstacle]);
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.puddles.splice(i, 1);
        continue;
      }
      p.obstacle.r = p.r;
      if (wash) this.pheromone.wash(p.x, p.z, p.r, 0, 0.6);
      if (p.meshR - p.r > 0.15) this.reshape(p);
    }
  }

  /** 按当前半径重建贴合地形的水面网格 */
  private reshape(p: Puddle): void {
    const r = p.r;
    p.meshR = r;
    const rings = 6;
    const segs = 28;
    const pos: number[] = [p.x, this.terrain.heightAt(p.x, p.z) + 0.12, p.z];
    const idx: number[] = [];
    for (let k = 1; k <= rings; k++) {
      const rr = (r * k) / rings;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        // 边缘略带起伏，避免水洼是正圆
        const wob = k === rings ? 1 + 0.08 * Math.sin(a * 3 + p.id) + 0.05 * Math.sin(a * 5 + p.id * 2) : 1;
        const x = p.x + Math.cos(a) * rr * wob;
        const z = p.z + Math.sin(a) * rr * wob;
        pos.push(x, this.terrain.heightAt(x, z) + 0.12, z);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * segs;
      const a1 = 1 + k * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    p.mesh.geometry.dispose();
    p.mesh.geometry = geo;
  }
}

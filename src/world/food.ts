import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Rng } from '../util/random';
import type { Terrain } from './terrain';
import type { Vegetation } from './vegetation';

export type FoodKind = 'prey' | 'seed' | 'sugar';

export const FOOD_KIND_NAMES: Record<FoodKind, string> = {
  prey: '猎物碎块',
  seed: '种子',
  sugar: '甜液',
};

export type FoodSourceType = 'beetle' | 'caterpillar' | 'seeds' | 'fruit' | 'syrup';

export const PLACEABLE_FOOD: FoodSourceType[] = ['syrup', 'beetle', 'caterpillar', 'seeds', 'fruit'];

export const SOURCE_INFO: Record<FoodSourceType, { name: string; kind: FoodKind; amount: [number, number]; radius: number; desc: string }> = {
  beetle: {
    name: '甲虫尸体',
    kind: 'prey',
    amount: [30, 50],
    radius: 2.2,
    desc: '富含蛋白质的猎物。觅食蚁把它肢解成小块搬回巢，主要用于喂养幼虫。',
  },
  caterpillar: {
    name: '毛虫尸体',
    kind: 'prey',
    amount: [40, 70],
    radius: 2.8,
    desc: '较大的软体猎物，往往需要很多觅食蚁轮流切割搬运，会形成明显的信息素路径。',
  },
  seeds: {
    name: '带油质体的种子',
    kind: 'seed',
    amount: [14, 26],
    radius: 1.6,
    desc: '堇菜等植物的种子附有富含脂肪的油质体，专门“雇佣”蚂蚁传播种子。蚂蚁吃掉油质体后会把种子丢弃到巢外。',
  },
  fruit: {
    name: '落果甜汁',
    kind: 'sugar',
    amount: [40, 60],
    radius: 2.0,
    desc: '富含糖分的液体食物。觅食蚁把甜汁吸入嗉囊带回巢，再通过交哺分给同伴。',
  },
  syrup: {
    name: '糖水',
    kind: 'sugar',
    amount: [50, 70],
    radius: 1.8,
    desc: '玩家滴下的一滴糖水。和蜜露、花蜜一样被吸进嗉囊带回巢，是饲养蚂蚁最常用的“零食”。',
  },
};

let nextFoodId = 1;

export class FoodSource {
  id = nextFoodId++;
  amount: number;
  readonly initial: number;
  mesh: THREE.Object3D;
  /** 已被觅食蚁发现 */
  discovered = false;
  takenTotal = 0;
  /** 由玩家投放 */
  placed = false;
  constructor(
    public type: FoodSourceType,
    public x: number,
    public z: number,
    public y: number,
    amount: number,
    mesh: THREE.Object3D,
  ) {
    this.amount = amount;
    this.initial = amount;
    this.mesh = mesh;
    mesh.userData.pick = { kind: 'food', id: this.id };
    mesh.traverse((o) => (o.userData.pick = { kind: 'food', id: this.id }));
  }
  get info() {
    return SOURCE_INFO[this.type];
  }
  get kind(): FoodKind {
    return SOURCE_INFO[this.type].kind;
  }
  get radius(): number {
    return SOURCE_INFO[this.type].radius;
  }
  get fraction(): number {
    return this.amount / this.initial;
  }
  take(): boolean {
    if (this.amount < 1) return false;
    this.amount -= 1;
    this.takenTotal++;
    this.discovered = true;
    const s = 0.35 + 0.65 * Math.sqrt(this.fraction);
    this.mesh.scale.setScalar(s);
    return true;
  }
}

export class FoodManager {
  group = new THREE.Group();
  sources: FoodSource[] = [];
  private spawnTimer = 0;
  private mats = {
    beetle: new THREE.MeshStandardMaterial({ color: 0x1d2a3a, roughness: 0.35, metalness: 0.4 }),
    beetleLeg: new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.6 }),
    caterpillar: new THREE.MeshStandardMaterial({ color: 0x7aa33a, roughness: 0.7 }),
    seed: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6 }),
    elaiosome: new THREE.MeshStandardMaterial({ color: 0xf3ead0, roughness: 0.5 }),
    fruit: new THREE.MeshStandardMaterial({ color: 0x9b1d2a, roughness: 0.4 }),
    juice: new THREE.MeshStandardMaterial({ color: 0xd9761c, roughness: 0.1, transparent: true, opacity: 0.75 }),
    syrup: new THREE.MeshStandardMaterial({ color: 0xe8a640, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.7 }),
  };

  constructor(private terrain: Terrain, private veg: Vegetation, private rng: Rng) {}

  init(): void {
    for (let i = 0; i < CONFIG.food.initialSources; i++) this.spawn(i < 3 ? 30 : 45);
  }

  spawn(minDist = 35, type?: FoodSourceType, at?: { x: number; z: number }): FoodSource | null {
    const t: FoodSourceType = type ?? this.rng.pick(['beetle', 'caterpillar', 'seeds', 'seeds', 'fruit'] as const);
    let x = 0;
    let z = 0;
    let ok = false;
    if (at) {
      x = at.x;
      z = at.z;
      ok = true;
    } else {
      for (let k = 0; k < 40 && !ok; k++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(minDist, CONFIG.world.forageRadius - 8);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        ok = !this.veg.obstacleAt(x, z, 3) && !this.sources.some((s) => Math.hypot(s.x - x, s.z - z) < 15);
      }
    }
    if (!ok) return null;
    const info = SOURCE_INFO[t];
    const y = this.terrain.heightAt(x, z);
    const mesh = this.buildMesh(t);
    mesh.position.set(x, y, z);
    mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    this.group.add(mesh);
    const src = new FoodSource(t, x, z, y, Math.round(this.rng.range(info.amount[0], info.amount[1])), mesh);
    this.sources.push(src);
    return src;
  }

  private buildMesh(t: FoodSourceType): THREE.Object3D {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    if (t === 'beetle') {
      // 仰面朝天的甲虫
      add(sphere, this.mats.beetle, 0, 0.7, 0, 1.6, 0.75, 1.05);
      add(sphere, this.mats.beetle, 1.7, 0.55, 0, 0.55, 0.45, 0.6);
      const leg = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 4);
      for (let i = 0; i < 6; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const m = add(leg, this.mats.beetleLeg, -0.5 + Math.floor(i / 2) * 0.6, 1.4, side * 0.6);
        m.rotation.x = side * 0.7;
      }
    } else if (t === 'caterpillar') {
      for (let i = 0; i < 9; i++) {
        const s = 0.55 + 0.1 * Math.sin((i / 8) * Math.PI);
        add(sphere, this.mats.caterpillar, i * 0.8 - 3.2, s * 0.9, Math.sin(i * 0.7) * 0.5, s, s * 0.9, s);
      }
    } else if (t === 'seeds') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + this.rng.next();
        const r = this.rng.range(0.2, 1.1);
        const sx = Math.cos(a) * r;
        const sz = Math.sin(a) * r;
        const m = add(sphere, this.mats.seed, sx, 0.3, sz, 0.5, 0.3, 0.32);
        m.rotation.y = a;
        add(sphere, this.mats.elaiosome, sx + Math.cos(a) * 0.45, 0.32, sz - Math.sin(a) * 0.45, 0.2, 0.18, 0.2);
      }
    } else if (t === 'fruit') {
      add(sphere, this.mats.fruit, 0, 1.1, 0, 1.5, 1.3, 1.5);
      add(new THREE.CircleGeometry(2.4, 16).rotateX(-Math.PI / 2), this.mats.juice, 0.3, 0.06, 0.2);
    } else {
      add(sphere, this.mats.syrup, 0, 0.05, 0, 1.7, 0.35, 1.5);
      add(sphere, this.mats.syrup, 0.6, 0.05, 0.5, 0.9, 0.25, 0.8);
    }
    return g;
  }

  placedCount(): number {
    let n = 0;
    for (const s of this.sources) if (s.placed) n++;
    return n;
  }

  nearest(x: number, z: number, radius: number): FoodSource | null {
    let best: FoodSource | null = null;
    let bd = radius * radius;
    for (const s of this.sources) {
      if (s.amount < 1) continue;
      const rr = radius + s.radius;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < rr * rr && d < bd + s.radius * s.radius * 4) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  byId(id: number): FoodSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  update(dt: number): void {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i];
      if (s.amount < 1) {
        this.group.remove(s.mesh);
        this.sources.splice(i, 1);
      }
    }
    this.spawnTimer += dt;
    if (this.spawnTimer > CONFIG.food.spawnIntervalSec) {
      this.spawnTimer = 0;
      if (this.sources.length < CONFIG.food.maxSources) this.spawn();
    }
  }
}

import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Rng } from '../../../core/util/random';
import type { Plant, Vegetation } from './vegetation';

const MAX_VISIBLE = 80;
/** 被照料的判定时长（秒）：这段时间内有工蚁来过 */
const TENDED_WINDOW = 90;

let nextAphidId = 1;

/** 寄主植物嫩茎上的一群蚜虫。蚜虫吸食韧皮部汁液，把多余的糖分以蜜露形式排出。 */
export class AphidColony {
  id = nextAphidId++;
  honeydew = 0;
  discovered = false;
  lastTended = -1e9;
  collected = 0;
  private slots: { a: number; y: number; tone: number }[] = [];

  constructor(
    public plant: Plant,
    public count: number,
    /** 蚜虫聚集的茎段（世界坐标高度） */
    public bandLo: number,
    public bandHi: number,
    rng: Rng,
  ) {
    for (let i = 0; i < MAX_VISIBLE; i++) {
      this.slots.push({ a: i * 2.39996 + rng.range(-0.3, 0.3), y: rng.next(), tone: rng.range(0.8, 1.15) });
    }
  }

  get x(): number {
    return this.plant.x;
  }
  get z(): number {
    return this.plant.z;
  }
  /** 蚜虫所在茎段的半径（茎从基部 0.45 收窄到顶端 0.28） */
  get stemRadius(): number {
    return 0.34;
  }
  tended(now: number): boolean {
    return now - this.lastTended < TENDED_WINDOW;
  }
  slot(i: number): { a: number; y: number; tone: number } {
    return this.slots[i];
  }
}

export class AphidManager {
  group = new THREE.Group();
  colonies: AphidColony[] = [];
  private bodies: THREE.InstancedMesh;
  private drops: THREE.InstancedMesh;
  private shown: number[] = [];
  private dropShown: number[] = [];

  constructor(veg: Vegetation, rng: Rng) {
    const C = CONFIG.aphid;
    const hosts = veg.plants
      .filter((p) => p.host || Math.hypot(p.x, p.z) < 80)
      .sort((a, b) => Number(b.host) - Number(a.host) || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
      .slice(0, C.colonies);
    for (const p of hosts) {
      const lo = p.baseY + p.height * rng.range(0.5, 0.6);
      const hi = p.baseY + p.height * rng.range(0.78, 0.9);
      this.colonies.push(new AphidColony(p, Math.round(rng.range(C.initialCount[0], C.initialCount[1])), lo, hi, rng));
    }

    // 梨形的蚜虫身体：一端略尖
    const body = new THREE.SphereGeometry(1, 8, 6);
    const bp = body.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const k = 1 - Math.max(0, x) * 0.35;
      bp.setXYZ(i, x, bp.getY(i) * k, bp.getZ(i) * k);
    }
    body.computeVertexNormals();
    const cap = this.colonies.length * MAX_VISIBLE;
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), Math.max(1, cap));
    this.bodies.count = 0;
    this.bodies.castShadow = true;
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xf2c25a, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 }),
      Math.max(1, this.colonies.length),
    );
    this.drops.count = this.colonies.length;
    this.group.add(this.bodies, this.drops);
    this.shown = this.colonies.map(() => -1);
    this.dropShown = this.colonies.map(() => -1);
    this.sync();
  }

  update(dt: number, now: number): void {
    const C = CONFIG.aphid;
    const days = dt / CONFIG.time.dayLength;
    for (const c of this.colonies) {
      // 被蚂蚁照料的蚜虫群天敌少、增殖快；无人照料时会被瓢虫等捕食或迁飞
      const tended = c.tended(now);
      const growth = (tended ? 0.35 : 0.1) * c.count * (1 - c.count / C.maxCount);
      const loss = tended ? 0 : c.count * 0.08;
      c.count = Math.max(4, c.count + (growth - loss) * days);
      c.honeydew = Math.min(C.maxHoneydew, c.honeydew + c.count * C.honeydewPerAphidDay * days);
    }
  }

  /** 能闻到蜜露气味的最近蚜虫群 */
  nearest(x: number, z: number, radius: number): AphidColony | null {
    let best: AphidColony | null = null;
    let bd = (radius + 1) ** 2;
    for (const c of this.colonies) {
      if (c.honeydew < 0.5) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  byId(id: number): AphidColony | undefined {
    return this.colonies.find((c) => c.id === id);
  }

  /** 蚜虫群的位置由世界种子决定，存档只记录各群的状态（按顺序） */
  toSave(): { count: number; honeydew: number; discovered: boolean; lastTended: number; collected: number }[] {
    return this.colonies.map((c) => ({ count: c.count, honeydew: c.honeydew, discovered: c.discovered, lastTended: Math.max(-1e6, c.lastTended), collected: c.collected }));
  }

  restore(s: ReturnType<AphidManager['toSave']>): void {
    s.forEach((x, i) => {
      const c = this.colonies[i];
      if (!c) return;
      c.count = x.count;
      c.honeydew = x.honeydew;
      c.discovered = x.discovered;
      c.lastTended = x.lastTended;
      c.collected = x.collected;
    });
  }

  byPlant(index: number): AphidColony | undefined {
    return this.colonies.find((c) => c.plant.index === index);
  }

  /** 蚜虫数量或蜜露变化时更新实例矩阵 */
  sync(): void {
    const m = new THREE.Matrix4();
    const bx = new THREE.Vector3();
    const by = new THREE.Vector3();
    const bz = new THREE.Vector3();
    const col = new THREE.Color();
    const base = new THREE.Color(0x86b83a);
    let changed = false;
    this.colonies.forEach((c, ci) => {
      const n = Math.min(MAX_VISIBLE, Math.round(c.count));
      if (n === this.shown[ci]) return;
      this.shown[ci] = n;
      changed = true;
      const r = c.stemRadius + 0.07;
      for (let i = 0; i < MAX_VISIBLE; i++) {
        const k = ci * MAX_VISIBLE + i;
        const s = c.slot(i);
        if (i >= n) {
          m.makeScale(0, 0, 0);
          this.bodies.setMatrixAt(k, m);
          continue;
        }
        const ca = Math.cos(s.a);
        const sa = Math.sin(s.a);
        // 蚜虫头朝下趴在茎上：身体长轴沿茎向下，背面朝外
        bx.set(0, -0.17 * s.tone, 0);
        by.set(ca, 0, sa).multiplyScalar(0.1 * s.tone);
        bz.set(-sa, 0, ca).multiplyScalar(0.11 * s.tone);
        m.makeBasis(bx, by, bz);
        m.setPosition(c.x + ca * r, c.bandLo + (c.bandHi - c.bandLo) * s.y, c.z + sa * r);
        this.bodies.setMatrixAt(k, m);
        col.copy(base).multiplyScalar(s.tone);
        this.bodies.setColorAt(k, col);
      }
    });
    if (changed) {
      this.bodies.count = this.colonies.length * MAX_VISIBLE;
      this.bodies.instanceMatrix.needsUpdate = true;
      if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    }
    let dropChanged = false;
    this.colonies.forEach((c, ci) => {
      const q = Math.round((c.honeydew / CONFIG.aphid.maxHoneydew) * 20);
      if (q === this.dropShown[ci]) return;
      this.dropShown[ci] = q;
      dropChanged = true;
      const s = q === 0 ? 0 : 0.06 + 0.16 * Math.sqrt(q / 20);
      m.makeScale(s, s * 1.15, s);
      m.setPosition(c.x + c.stemRadius + s * 0.8, c.bandLo - 0.3, c.z);
      this.drops.setMatrixAt(ci, m);
    });
    if (dropChanged) this.drops.instanceMatrix.needsUpdate = true;
  }
}

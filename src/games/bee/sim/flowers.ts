import { smoothstep } from '../../../core/util/math';
import { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';

const F = CONFIG.flowers;
export type FlowerSpecies = (typeof F.species)[number];
export const SPECIES_KEYS = F.species.map((s) => s.key);

/** 一片花丛。株的位置由 seed 生成（plantsOf），不进存档 */
export interface FlowerPatch {
  id: number;
  species: number;
  x: number;
  z: number;
  r: number;
  seed: number;
  /** 现在还有几份花蜜、花粉（满是 plants × 每株的量） */
  nectar: number;
  pollen: number;
}

/** 这种花此刻开了多少：0 没开，1 全开；开前、合后各 ramp 小时渐变 */
export function openness(sp: FlowerSpecies, hour: number): number {
  const [a, b] = sp.hours;
  return smoothstep(a - sp.ramp, a, hour) * (1 - smoothstep(b, b + sp.ramp, hour));
}

const plantCache = new Map<number, Float32Array>();

/**
 * 花丛里每株的位置和个头，每株 3 个数：x、z（世界坐标）和 0..1 的随机数（画面用来定高矮、朝向）。
 * 按株距排成错开的行，再整体转一个角度；边缘起伏不是正圆
 */
export function plantsOf(p: FlowerPatch): Float32Array {
  const cached = plantCache.get(p.seed);
  if (cached) return cached;
  const sp = F.species[p.species];
  const r = new Rng(p.seed);
  const a = r.range(0, Math.PI);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const lobes = [r.range(0, 6.3), r.range(0, 6.3), r.range(0.08, 0.18)];
  const d = sp.spacing;
  const rowH = d * 0.87;
  const jitter = d * 0.3;
  const out: number[] = [];
  for (let j = -Math.ceil(p.r / rowH); j <= p.r / rowH; j++) {
    for (let i = -Math.ceil(p.r / d) - 1; i <= p.r / d + 1; i++) {
      const lx = (i + (j & 1 ? 0.5 : 0)) * d + r.range(-jitter, jitter);
      const lz = j * rowH + r.range(-jitter, jitter);
      const ang = Math.atan2(lz, lx);
      const edge = p.r * (1 + lobes[2] * Math.sin(2 * ang + lobes[0]) + lobes[2] * 0.6 * Math.sin(3 * ang + lobes[1]));
      if (Math.hypot(lx, lz) > edge) continue;
      out.push(p.x + lx * ca - lz * sa, p.z + lx * sa + lz * ca, r.next());
    }
  }
  const arr = new Float32Array(out);
  plantCache.set(p.seed, arr);
  return arr;
}

export const plantCount = (p: FlowerPatch) => plantsOf(p).length / 3;
export const nectarCap = (p: FlowerPatch) => plantCount(p) * F.species[p.species].nectar;
export const pollenCap = (p: FlowerPatch) => plantCount(p) * F.species[p.species].pollen;

export interface FlowerSave {
  patches: FlowerPatch[];
}

/** 花园里的花丛：按时刻开合，开着时花蜜和花粉慢慢长回来 */
export class Flowers {
  readonly patches: FlowerPatch[] = [];

  /** 开局的花丛：每种花至少一片，散在蜂箱周围，互不重叠 */
  generate(rng: Rng, nextId: () => number): void {
    const kinds = F.species.map((_, i) => i);
    while (kinds.length < F.patches) kinds.push(rng.int(0, F.species.length - 1));
    const lim = CONFIG.garden.size / 2 - F.margin;
    for (const species of kinds) {
      const sp = F.species[species];
      for (let tries = 0; tries < 200; tries++) {
        const r = rng.range(sp.r[0], sp.r[1]);
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(F.near, F.far);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
        if (this.patches.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 1.2 + r * 1.2 + F.gap)) continue;
        const p: FlowerPatch = { id: nextId(), species, x, z, r, seed: Math.floor(rng.next() * 2 ** 31), nectar: 0, pollen: 0 };
        p.nectar = nectarCap(p) * rng.range(0.5, 1);
        p.pollen = pollenCap(p) * rng.range(0.5, 1);
        this.patches.push(p);
        break;
      }
    }
  }

  get(id: number): FlowerPatch | undefined {
    return this.patches.find((p) => p.id === id);
  }

  update(dt: number, hour: number): void {
    for (const p of this.patches) {
      const sp = F.species[p.species];
      const k = openness(sp, hour);
      if (k <= 0) continue;
      p.nectar = Math.min(nectarCap(p), p.nectar + (nectarCap(p) * k * dt) / sp.refill);
      p.pollen = Math.min(pollenCap(p), p.pollen + (pollenCap(p) * k * dt) / sp.refill);
    }
  }

  /** 采走最多 want 份花蜜或花粉，返回实际采到的；没开的花采不到，半开时只采得到相应的一部分 */
  take(p: FlowerPatch, what: 'nectar' | 'pollen', want: number, hour: number): number {
    const k = openness(F.species[p.species], hour);
    const got = Math.max(0, Math.min(want, p[what] * k));
    p[what] -= got;
    return got;
  }

  toSave(): FlowerSave {
    return { patches: this.patches.map((p) => ({ ...p })) };
  }

  restore(d: FlowerSave): void {
    this.patches.length = 0;
    for (const p of d.patches) this.patches.push({ ...p });
  }
}

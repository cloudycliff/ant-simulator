import type { Point3 } from '../../../core/sim/events';
import { smoothstep } from '../../../core/util/math';
import { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';

const F = CONFIG.flowers;
const T = CONFIG.tools;
export type FlowerSpecies = (typeof F.species)[number];
export const SPECIES_KEYS = F.species.map((s) => s.key);
/** 糖水碟在 species 里的编号 */
export const SUGAR = SPECIES_KEYS.indexOf('sugar');

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
  /** 长成了多少：开局的花和糖水碟是 1，玩家种下的从 0 长起，长成前不开花 */
  grown: number;
  /** 玩家种的、放的 */
  planted: boolean;
}

/** 这种花此刻开了多少：0 没开，1 全开；开前、合后各 ramp 小时渐变 */
export function openness(sp: FlowerSpecies, hour: number): number {
  const [a, b] = sp.hours;
  return smoothstep(a - sp.ramp, a, hour) * (1 - smoothstep(b, b + sp.ramp, hour));
}

/** 这片花丛此刻开了多少：还没长成的不开 */
export function patchOpenness(p: FlowerPatch, hour: number): number {
  return p.grown < 1 ? 0 : openness(F.species[p.species], hour);
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
  if (p.r < sp.spacing / 2) {
    const one = new Float32Array([p.x, p.z, new Rng(p.seed).next()]);
    plantCache.set(p.seed, one);
    return one;
  }
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

/** 株的个头和转角，k 是 plantsOf 给的随机数；画面照这个摆 */
export const plantScale = (k: number) => 0.8 + 0.4 * ((k * 7.31) % 1);
export const plantYaw = (k: number) => k * Math.PI * 2;
/** 花朵的转角：向日葵的花盘都朝东（+x），只差一点 */
export const bloomYaw = (sp: FlowerSpecies, k: number) => (sp.key === 'sunflower' ? (plantYaw(k) - Math.PI) * 0.12 : plantYaw(k));

/** 第 i 株的第 j 个落脚点（见 CONFIG.flowers 的 land）在世界里的位置；ground 是地面高度 */
export function landingPoint(p: FlowerPatch, i: number, j: number, ground: (x: number, z: number) => number, out: Point3): Point3 {
  const pl = plantsOf(p);
  const x = pl[i * 3];
  const z = pl[i * 3 + 1];
  const k = pl[i * 3 + 2];
  const sp = F.species[p.species];
  const L = sp.land[j % sp.land.length];
  const s = plantScale(k);
  const a = bloomYaw(sp, k);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  out.x = x + (L[0] * c + L[2] * sn) * s;
  out.y = ground(x, z) + L[1] * s;
  out.z = z + (-L[0] * sn + L[2] * c) * s;
  return out;
}
export const nectarCap = (p: FlowerPatch) => plantCount(p) * F.species[p.species].nectar;
export const pollenCap = (p: FlowerPatch) => plantCount(p) * F.species[p.species].pollen;

export interface FlowerSave {
  patches: FlowerPatch[];
}

/** 花园里的花丛：按时刻开合，开着时花蜜和花粉慢慢长回来 */
export class Flowers {
  readonly patches: FlowerPatch[] = [];
  /** 花丛加了或者读了档就加一，画面看它重建 */
  version = 0;

  /** 开局的花丛：每种花至少一片，散在蜂箱周围，互不重叠 */
  generate(rng: Rng, nextId: () => number): void {
    const wild = F.species.map((_, i) => i).filter((i) => F.species[i].wild);
    const kinds = [...wild];
    while (kinds.length < F.patches) kinds.push(wild[rng.int(0, wild.length - 1)]);
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
        const p: FlowerPatch = { id: nextId(), species, x, z, r, seed: Math.floor(rng.next() * 2 ** 31), nectar: 0, pollen: 0, grown: 1, planted: false };
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

  /** rain 是雨势 0..1：雨把花里的花蜜、花粉冲掉，下雨时也不长（糖水碟不受影响） */
  update(dt: number, hour: number, rain = 0): void {
    const wash = Math.exp((-rain * dt) / CONFIG.weather.wash);
    for (const p of this.patches) {
      if (p.grown < 1) {
        p.grown = Math.min(1, p.grown + dt / T.grow);
        continue;
      }
      const sp = F.species[p.species];
      if (sp.refill <= 0) continue;
      p.nectar *= wash;
      p.pollen *= wash;
      const k = openness(sp, hour) * (1 - rain);
      if (k <= 0) continue;
      p.nectar = Math.min(nectarCap(p), p.nectar + (nectarCap(p) * k * dt) / sp.refill);
      p.pollen = Math.min(pollenCap(p), p.pollen + (pollenCap(p) * k * dt) / sp.refill);
    }
  }

  /** 采走最多 want 份花蜜或花粉，返回实际采到的；没开的花采不到，半开时只采得到相应的一部分 */
  take(p: FlowerPatch, what: 'nectar' | 'pollen', want: number, hour: number): number {
    const k = patchOpenness(p, hour);
    const got = Math.max(0, Math.min(want, p[what] * k));
    p[what] -= got;
    return got;
  }

  /** 玩家种花、放糖水的地方行不行：返回不行的原因（词典的键），行就是 null */
  checkSpot(x: number, z: number, r: number): 'tool.outside' | 'tool.nearHive' | 'tool.overlap' | null {
    const lim = CONFIG.garden.size / 2 - F.margin;
    if (Math.abs(x) + r > lim || Math.abs(z) + r > lim) return 'tool.outside';
    if (Math.hypot(x, z) < T.hiveClear + r) return 'tool.nearHive';
    if (this.patches.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r + T.gap)) return 'tool.overlap';
    return null;
  }

  /** 加一片花丛：种下的花从 0 长起，糖水碟放下就是满的 */
  add(id: number, species: number, x: number, z: number, seed: number): FlowerPatch {
    const sp = F.species[species];
    const p: FlowerPatch = { id, species, x, z, r: sp.plantR, seed, nectar: 0, pollen: 0, grown: species === SUGAR ? 1 : 0, planted: true };
    if (species === SUGAR) p.nectar = nectarCap(p);
    this.patches.push(p);
    this.version++;
    return p;
  }

  toSave(): FlowerSave {
    return { patches: this.patches.map((p) => ({ ...p })) };
  }

  restore(d: FlowerSave): void {
    this.patches.length = 0;
    for (const p of d.patches) this.patches.push({ ...p });
    this.version++;
  }
}

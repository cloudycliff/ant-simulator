export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** 近似正态分布 */
  gauss(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const rng = new Rng(Date.now() & 0xffffffff);

/** 2D 值噪声 + 分形叠加，用于地形与植被分布。 */
export class Noise2D {
  private perm: Uint8Array;
  private grad: Float32Array;
  constructor(seed: number) {
    const r = new Rng(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = r.next() * Math.PI * 2;
      this.grad[i * 2] = Math.cos(a);
      this.grad[i * 2 + 1] = Math.sin(a);
    }
  }

  private dot(ix: number, iy: number, x: number, y: number): number {
    const h = this.perm[(ix & 255) + this.perm[iy & 255]];
    return this.grad[h * 2] * (x - ix) + this.grad[h * 2 + 1] * (y - iy);
  }

  /** 梯度噪声，范围约 [-0.7, 0.7] */
  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = x - x0;
    const sy = y - y0;
    const fx = sx * sx * sx * (sx * (sx * 6 - 15) + 10);
    const fy = sy * sy * sy * (sy * (sy * 6 - 15) + 10);
    const n00 = this.dot(x0, y0, x, y);
    const n10 = this.dot(x0 + 1, y0, x, y);
    const n01 = this.dot(x0, y0 + 1, x, y);
    const n11 = this.dot(x0 + 1, y0 + 1, x, y);
    const a = n00 + fx * (n10 - n00);
    const b = n01 + fx * (n11 - n01);
    return a + fy * (b - a);
  }

  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}

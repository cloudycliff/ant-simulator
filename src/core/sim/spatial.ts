/** 能放进空间哈希的对象 */
export interface Located {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly alive: boolean;
}

/** 三维均匀网格空间哈希（数组链表），每个模拟步重建，用于查找邻近的个体。 */
export class SpatialHash<T extends Located> {
  private readonly mask: number;
  private head: Int32Array;
  private next = new Int32Array(0);
  private seen = new Int32Array(0);
  private stamp = 0;
  private list: T[] = [];

  constructor(private readonly cell = 2, bits = 13) {
    this.mask = (1 << bits) - 1;
    this.head = new Int32Array(1 << bits);
  }

  private key(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & this.mask;
  }

  rebuild(ants: readonly T[]): void {
    const n = ants.length;
    this.list.length = 0;
    for (let i = 0; i < n; i++) this.list.push(ants[i]);
    if (this.next.length < n) {
      this.next = new Int32Array(n * 2);
      this.seen = new Int32Array(n * 2);
    }
    this.head.fill(-1);
    const c = this.cell;
    for (let i = 0; i < n; i++) {
      const p = this.list[i].pos;
      const k = this.key(Math.floor(p.x / c), Math.floor(p.y / c), Math.floor(p.z / c));
      this.next[i] = this.head[k];
      this.head[k] = i;
    }
  }

  /** 把半径 r 内的个体写入 out（不含 self），按插入顺序 */
  near(x: number, y: number, z: number, r: number, out: T[], self?: T): T[] {
    out.length = 0;
    const c = this.cell;
    const st = ++this.stamp;
    const rr = r * r;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          // 不同网格可能哈希到同一个桶，用 seen 去重
          for (let i = this.head[this.key(ix, iy, iz)]; i >= 0; i = this.next[i]) {
            if (this.seen[i] === st) continue;
            this.seen[i] = st;
            const a = this.list[i];
            if (a === self || !a.alive) continue;
            const dx = a.pos.x - x;
            const dy = a.pos.y - y;
            const dz = a.pos.z - z;
            if (dx * dx + dy * dy + dz * dz < rr) out.push(a);
          }
        }
    return out;
  }
}

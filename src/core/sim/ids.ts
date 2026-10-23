/**
 * 每类对象各自从 1 开始的编号。归世界所有并进存档：编号会影响行为（比如按编号轮换），
 * 放在模块变量里的话，同一进程里的两个世界会互相抢号
 */
export class IdPool {
  private counters = new Map<string, number>();

  next(kind: string): number {
    const n = this.counters.get(kind) ?? 1;
    this.counters.set(kind, n + 1);
    return n;
  }

  /** 读档时登记已有的编号，之后发的号都比它大 */
  seen(kind: string, id: number): void {
    if (id >= (this.counters.get(kind) ?? 1)) this.counters.set(kind, id + 1);
  }

  toSave(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  restore(d: Record<string, number>): void {
    this.counters = new Map(Object.entries(d));
  }
}

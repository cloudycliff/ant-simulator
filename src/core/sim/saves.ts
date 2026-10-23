interface Section {
  key: string;
  save: () => unknown;
  restore: (d: never) => void;
  optional: boolean;
  last?: boolean;
}

/**
 * 存档由各部分组成，每部分是存档对象里的一个字段。读档按登记顺序恢复，
 * 所以被别人引用的部分（比如蚂蚁引用的蚁穴房间）要先登记
 */
export class SaveRegistry {
  private sections: Section[] = [];

  /** optional：后来才加的部分，旧存档里没有时保留新世界的初始状态 */
  add<T>(key: string, save: () => T, restore: (d: T) => void, optional = false): void {
    if (this.sections.some((s) => s.key === key)) throw new Error(`save: duplicate section ${key}`);
    this.sections.push({ key, save, restore, optional });
  }

  /** 在其他部分全部恢复之后才恢复（比如随机数：别的部分恢复时可能还会抽随机数）。旧存档里没有时保留初始状态 */
  addLast<T>(key: string, save: () => T, restore: (d: T) => void): void {
    this.add(key, save, restore, true);
    this.sections[this.sections.length - 1].last = true;
  }

  save(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const s of this.sections) out[s.key] = s.save();
    return out;
  }

  restore(d: Record<string, unknown>): void {
    for (const s of [...this.sections.filter((s) => !s.last), ...this.sections.filter((s) => s.last)]) {
      const v = d[s.key];
      if (v === undefined) {
        if (s.optional) continue;
        throw new Error(`save: missing section ${s.key}`);
      }
      (s.restore as (d: unknown) => void)(v);
    }
  }
}

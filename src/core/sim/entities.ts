import type { Point3 } from './events';

/** 指向一个对象：类型加上游戏自己定的编号等字段 */
export interface EntityRef {
  kind: string;
}

/** 一类对象在框架里的公共行为 */
export interface EntityKind<R> {
  /** 现在的位置，不在了返回 null。可跟随的类型要返回对象自己的位置（跟随时每帧读一次） */
  pos?: (ref: R) => Point3 | null;
  /** 相机飞过去时离它多远 */
  viewDistance?: number;
  /**
   * 相机飞过去时从哪个方向看：从对象指向相机的方向，不必是单位向量；from 是相机现在的位置。
   * 不给或返回 null 时沿相机现在的方向，并抬高到俯看
   */
  viewDir?: (ref: R, from: Point3) => Point3 | null;
  follow?: boolean;
  /** 读档后编号会重新分配：存档里的事件只留位置，不留对象 */
  unstable?: boolean;
}

/**
 * 实体注册表：游戏为每一类可选中、可出现在事件里的对象登记位置、观察距离、能否跟随。
 * 选中、飞过去、跟随、事件定位和事件存档都查这里，不再各写一遍按类型分支
 */
export class EntityRegistry<R extends EntityRef> {
  private kinds = new Map<string, EntityKind<R>>();

  constructor(readonly defaultViewDistance = 14) {}

  define<K extends R['kind']>(kind: K, spec: EntityKind<Extract<R, { kind: K }>>): void {
    if (this.kinds.has(kind)) throw new Error(`实体类型重复登记：${kind}`);
    this.kinds.set(kind, spec as EntityKind<R>);
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  pos(ref: R): Point3 | null {
    return this.kinds.get(ref.kind)?.pos?.(ref) ?? null;
  }

  viewDistance(ref: R): number {
    return this.kinds.get(ref.kind)?.viewDistance ?? this.defaultViewDistance;
  }

  viewDir(ref: R, from: Point3): Point3 | null {
    return this.kinds.get(ref.kind)?.viewDir?.(ref, from) ?? null;
  }

  canFollow(ref: R): boolean {
    return !!this.kinds.get(ref.kind)?.follow;
  }

  stable(ref: R): boolean {
    return !this.kinds.get(ref.kind)?.unstable;
  }
}

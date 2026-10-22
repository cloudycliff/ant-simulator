import { asText, type Text } from '../i18n';
import type { SimClock } from './clock';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 一条事件。t 是模拟秒数，ref 是事件涉及的对象（界面上点击事件时选中它并飞过去）；较早的存档里 t 和 msg 是拼好的文字 */
export interface SimEvent<R> {
  t: number | string;
  msg: Text;
  ref?: R;
  /** 事件发生的位置；对象已经不在时跳到这里 */
  at?: [number, number, number];
}

export type SimEventSave<R> = Omit<SimEvent<R>, 'msg'> & { msg: Text | string };

/** 最近事件，新的在前 */
export class EventLog<R> {
  entries: SimEvent<R>[] = [];
  /** 事件对象现在的位置，不在了返回 null；由游戏提供 */
  locate: (ref: R) => Point3 | null = () => null;

  constructor(
    private readonly clock: SimClock,
    private readonly max = 8,
  ) {}

  /** at 省略时取 ref 现在的位置 */
  push(msg: Text, ref?: R, at?: Point3): void {
    const p = at ?? (ref ? this.locate(ref) : null);
    this.entries.unshift({ t: Math.round(this.clock.seconds), msg, ref, at: p ? [p.x, p.y, p.z] : undefined });
    if (this.entries.length > this.max) this.entries.pop();
  }

  /** keepRef 返回假的对象（读档后编号会重新分配）只存位置 */
  toSave(keepRef: (ref: R) => boolean = () => true): SimEventSave<R>[] {
    return this.entries.map((e) => (e.ref && !keepRef(e.ref) ? { t: e.t, msg: e.msg, at: e.at } : e));
  }

  restore(s: SimEventSave<R>[]): void {
    this.entries = s.map((e) => ({ ...e, msg: asText(e.msg) }));
  }
}

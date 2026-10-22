import { L, type Text } from '../i18n';
import { TAU } from '../util/math';

/** 模拟时钟：游戏日、时刻、昼夜。 */
export class SimClock {
  /** 自模拟开始以来的模拟秒数 */
  seconds = 0;
  speed = 1;
  paused = false;
  private readonly startOffset: number;

  /** dayLength：一个游戏日的模拟秒数；startHour：第 0 秒是第一天的几点 */
  constructor(
    readonly dayLength: number,
    startHour: number,
  ) {
    this.startOffset = (startHour / 24) * dayLength;
  }

  get totalDays(): number {
    return this.daysAt(this.seconds);
  }

  private daysAt(seconds: number): number {
    return (seconds + this.startOffset) / this.dayLength;
  }

  get day(): number {
    return Math.floor(this.totalDays) + 1;
  }

  /** 当日时刻 0..24 */
  get hour(): number {
    return (this.totalDays % 1) * 24;
  }

  /** 太阳高度系数 -1..1，正午为 1 */
  get sunElevation(): number {
    return Math.sin(((this.hour - 6) / 24) * TAU);
  }

  /** 0 = 深夜，1 = 白天 */
  get daylight(): number {
    const e = this.sunElevation;
    return Math.min(1, Math.max(0, (e + 0.12) / 0.4));
  }

  get isNight(): boolean {
    return this.daylight < 0.15;
  }

  stamp(): Text {
    return this.stampAt(this.seconds);
  }

  /** 模拟秒数对应的游戏时刻，如“第3天 14:20” */
  stampAt(seconds: number): Text {
    const days = this.daysAt(seconds);
    const h = (days % 1) * 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return L('time.stamp', { day: Math.floor(days) + 1, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
  }
}

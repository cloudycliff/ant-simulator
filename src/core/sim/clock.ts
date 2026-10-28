import { L, type Text } from '../i18n';
import { TAU } from '../util/math';
import type { Point3 } from './events';

/** 某时刻太阳的方向（单位向量，朝着太阳）：6 点从 +x 升起，正午偏 +z，18 点落在 -x。画面的太阳和模拟用的是同一个 */
export function sunDirection(hour: number, out: Point3 = { x: 0, y: 0, z: 0 }): Point3 {
  const ang = ((hour - 6) / 24) * TAU;
  const x = Math.cos(ang) * 0.85;
  const y = Math.sin(ang);
  const len = Math.hypot(x, y, 0.35);
  out.x = x / len;
  out.y = y / len;
  out.z = 0.35 / len;
  return out;
}

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/**
 * 季节的日历（T-076），由游戏传进来。lengths 是春、夏、秋、冬各几个游戏日；start 是第一天 0 点在一年里的第几天
 * （春天第一天的 0 点是 0）；frozen 给了就一直是那一季
 */
export interface Calendar {
  lengths: readonly [number, number, number, number];
  start: number;
  frozen?: Season;
}

/** 没给日历的时钟一直是夏天 */
const SUMMER: Calendar = { lengths: [1, 1, 1, 1], start: 1, frozen: 'summer' };

/** 模拟时钟：游戏日、时刻、昼夜、季节。 */
export class SimClock {
  /** 自模拟开始以来的模拟秒数 */
  seconds = 0;
  speed = 1;
  paused = false;
  /**
   * 第一天 0 点在一年里的第几天：季节都按它和 seconds 算出来。开局是日历的 start，
   * 跳到某一季（setSeason）时改它而不是改 seconds，蜂的日龄、事件的时刻都不变；进存档
   */
  yearStart: number;
  readonly calendar: Calendar;
  readonly yearLength: number;
  private readonly startOffset: number;

  /** dayLength：一个游戏日的模拟秒数；startHour：第 0 秒是第一天的几点；calendar：季节，不给就冻在夏天 */
  constructor(
    readonly dayLength: number,
    startHour: number,
    calendar: Calendar = SUMMER,
  ) {
    this.startOffset = (startHour / 24) * dayLength;
    this.calendar = calendar;
    this.yearStart = calendar.start;
    this.yearLength = calendar.lengths.reduce((a, b) => a + b, 0);
  }

  /** 季节在变（有日历、没冻住） */
  get seasonal(): boolean {
    return !this.calendar.frozen;
  }

  /** 从第一年春天第一天 0 点起过了几天（可带小数） */
  private get calendarDays(): number {
    return this.yearStart + this.totalDays;
  }

  /** 第几年，从 1 起 */
  get year(): number {
    return Math.floor(this.calendarDays / this.yearLength) + 1;
  }

  /** 这一年过了几天，0..yearLength */
  get yearDays(): number {
    const d = this.calendarDays % this.yearLength;
    return d < 0 ? d + this.yearLength : d;
  }

  /** 现在是第几季（0 春 1 夏 2 秋 3 冬）和这一季过了几天 */
  private where(): [number, number] {
    if (this.calendar.frozen) return [SEASONS.indexOf(this.calendar.frozen), 0];
    let d = this.yearDays;
    const L = this.calendar.lengths;
    for (let i = 0; i < 3; i++) {
      if (d < L[i]) return [i, d];
      d -= L[i];
    }
    return [3, Math.min(d, L[3])];
  }

  get seasonIndex(): number {
    return this.where()[0];
  }

  get season(): Season {
    return SEASONS[this.seasonIndex];
  }

  /** 这一季过了几天（可带小数）；冻住的日历是 0 */
  get seasonDays(): number {
    return this.where()[1];
  }

  /** 这一季的第几天，从 1 起 */
  get seasonDay(): number {
    return Math.floor(this.seasonDays) + 1;
  }

  /** 这一季有几天 */
  get seasonLength(): number {
    return this.calendar.lengths[this.seasonIndex];
  }

  /**
   * 按季节取值：values 是春夏秋冬各一个。一季的最后 blend 天里从这一季的值慢慢变到下一季的，
   * 一季的头一天已经全是这一季的值（开局在一季的第一天时和那一季的值一样）
   */
  seasonalValue(values: readonly number[], blend = 1): number {
    const [i, d] = this.where();
    const v = values[i];
    if (this.calendar.frozen || blend <= 0) return v;
    const k = (d - (this.calendar.lengths[i] - blend)) / blend;
    return k <= 0 ? v : v + (values[(i + 1) % 4] - v) * Math.min(1, k);
  }

  /** 跳到某一季的第 day 天（从 0 起的整天数），时刻不变：改 yearStart，不改 seconds；冻住的日历不动 */
  setSeason(season: Season, day = 0): void {
    if (this.calendar.frozen) return;
    let at = Math.floor(day);
    for (let i = 0; i < SEASONS.indexOf(season); i++) at += this.calendar.lengths[i];
    const now = this.yearDays;
    this.yearStart += at + (now % 1) - now;
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

  /** 太阳的水平方位：atan2(z, x)，从上往下看顺时针增大 */
  get sunAzimuth(): number {
    const d = sunDirection(this.hour);
    return Math.atan2(d.z, d.x);
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

  /** 这一季的名字和第几天，如“夏天第 3 天”；冻住的日历只有季节的名字 */
  seasonStamp(): Text {
    const name = L(`season.${this.season}`);
    return this.seasonal ? L('time.seasonDay', { season: name, day: this.seasonDay }) : name;
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

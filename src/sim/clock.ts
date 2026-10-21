import { CONFIG } from '../config';
import { TAU } from '../util/math';

/** 模拟时钟：游戏日、昼夜与土壤温湿度模型。 */
export class SimClock {
  /** 自模拟开始以来的模拟秒数 */
  seconds = 0;
  speed = 1;
  paused = false;
  /** 阴雨使地表降温的幅度（°C），由天气系统设置，随深度衰减 */
  weatherCool = 0;
  /** 地面湿润程度 0..1，由天气系统设置 */
  groundWet = 0;

  private readonly startOffset = (CONFIG.time.startHour / 24) * CONFIG.time.dayLength;

  get totalDays(): number {
    return (this.seconds + this.startOffset) / CONFIG.time.dayLength;
  }

  get day(): number {
    return Math.floor(this.totalDays) + 1;
  }

  /** 当日时刻 0..24 */
  get hour(): number {
    return (this.totalDays % 1) * 24;
  }

  get timeLabel(): string {
    const h = this.hour;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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

  stamp(): string {
    return `第${this.day}天 ${this.timeLabel}`;
  }

  /**
   * 土壤温度：地表日较差随深度指数衰减并产生相位滞后（阻尼深度约 12 cm）。
   * 地表最高温出现在 14:00 左右。
   */
  temperatureAt(depth: number): number {
    const mean = 19;
    const amplitude = 9;
    const damping = 12;
    const d = Math.max(0, depth);
    const phase = ((this.hour - 8) / 24) * TAU - d / damping;
    return mean + (amplitude * Math.sin(phase) - this.weatherCool) * Math.exp(-d / damping) - d * 0.03;
  }

  /** 相对湿度：地表夜间高、白天低；越深越潮湿。 */
  humidityAt(depth: number): number {
    const d = Math.max(0, depth);
    const surface = Math.min(98, 62 - 18 * this.sunElevation + 34 * this.groundWet);
    const deep = 93;
    const k = 1 - Math.exp(-d / 18);
    return surface + (deep - surface) * k;
  }
}

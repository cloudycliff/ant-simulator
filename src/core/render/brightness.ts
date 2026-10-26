import { ENGINE } from '../config';
import { clamp } from '../util/math';

const KEY = 'cyber-brightness';
export const BRIGHTNESS_KEYS = ['day', 'night'] as const;
export type BrightnessKey = (typeof BRIGHTNESS_KEYS)[number];

/**
 * 玩家的亮度设置：白天和夜里各一个曝光倍数（1 是默认），记在本地。
 * 不同屏幕的亮度和伽马差得多，夜景尤其容易在一台设备上看不清、在另一台上发灰，所以分开调
 */
export class Brightness {
  day = 1;
  night = 1;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<BrightnessKey, unknown>>;
      for (const k of BRIGHTNESS_KEYS) if (typeof s[k] === 'number') this[k] = this.clamp(s[k]);
    } catch {
      // 本地存储不可用或内容坏了，用默认值
    }
  }

  set(k: BrightnessKey, v: number): void {
    this[k] = this.clamp(v);
    this.save();
  }

  reset(): void {
    this.day = this.night = 1;
    this.save();
  }

  get isDefault(): boolean {
    return this.day === 1 && this.night === 1;
  }

  /** daylight（0 深夜，1 白天）时的曝光倍数，黄昏和清晨在两档之间过渡 */
  factor(daylight: number): number {
    return this.night + (this.day - this.night) * clamp(daylight, 0, 1);
  }

  private clamp(v: number): number {
    const B = ENGINE.render.brightness;
    return clamp(+(Math.round(v / B.step) * B.step).toFixed(3), B.min, B.max);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: this.day, night: this.night }));
    } catch {
      // 记不住也不影响这次
    }
  }
}

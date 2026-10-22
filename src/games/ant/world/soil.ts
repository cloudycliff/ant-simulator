import type { SimClock } from '../../../core/sim/clock';
import { TAU } from '../../../core/util/math';

/** 土壤温湿度模型；阴雨降温和地面湿润由天气系统每步设置 */
export class Soil {
  /** 阴雨使地表降温的幅度（°C），随深度衰减 */
  weatherCool = 0;
  /** 地面湿润程度 0..1 */
  groundWet = 0;

  constructor(private readonly clock: SimClock) {}

  /**
   * 土壤温度：地表日较差随深度指数衰减并产生相位滞后（阻尼深度约 12 cm）。
   * 地表最高温出现在 14:00 左右。
   */
  temperatureAt(depth: number): number {
    const mean = 19;
    const amplitude = 9;
    const damping = 12;
    const d = Math.max(0, depth);
    const phase = ((this.clock.hour - 8) / 24) * TAU - d / damping;
    return mean + (amplitude * Math.sin(phase) - this.weatherCool) * Math.exp(-d / damping) - d * 0.03;
  }

  /** 相对湿度：地表夜间高、白天低；越深越潮湿。 */
  humidityAt(depth: number): number {
    const d = Math.max(0, depth);
    const surface = Math.min(98, 62 - 18 * this.clock.sunElevation + 34 * this.groundWet);
    const deep = 93;
    const k = 1 - Math.exp(-d / 18);
    return surface + (deep - surface) * k;
  }
}

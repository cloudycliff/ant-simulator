import { L, type Text } from '../../../core/i18n';
import { TAU } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import { CONFIG } from '../config';

const W = CONFIG.weather;

export type WeatherPhase = 'clear' | 'overcast' | 'rain';

export interface WeatherSave {
  phase: WeatherPhase;
  phaseT: number;
  strength: number;
  rain: number;
  cloud: number;
  hourAcc: number;
}

/**
 * 天气：晴 → 转阴 → 阵雨 → 放晴，平均 rainPerDay 天一场。转阴就不再出巢，下雨时在外面的蜂都飞回来，
 * 雨把花里的花蜜冲淡（T-020）。气温按时刻走一条日变化的曲线，阴雨时低几度
 */
export class Weather {
  phase: WeatherPhase = 'clear';
  private phaseT = 0;
  /** 这场雨的雨势 0..1 */
  strength = 0;
  /** 当前雨势、云量，平滑过渡（画面和花蜜被冲淡都看它） */
  rain = 0;
  cloud = 0;
  private hourAcc = 0;

  constructor(
    private readonly rng: Rng,
    private readonly dayLength: number,
    private readonly clock: { totalDays: number; hour: number },
    private readonly log: (msg: Text) => void,
  ) {}

  /** 能不能出巢：转阴、下雨都不出去 */
  get flyable(): boolean {
    return this.phase === 'clear';
  }

  get label(): Text {
    if (this.phase === 'rain') return L(this.strength > 0.75 ? 'weather.heavyRain' : 'weather.lightRain');
    if (this.phase === 'overcast') return L('weather.overcast');
    return L('weather.clear');
  }

  /** 气温（°C）：清早最低、下午两点最高，阴雨按云量降温 */
  air(hour: number): number {
    const k = (Math.cos(((hour - W.warmest) / 24) * TAU) + 1) / 2;
    return W.air[0] + (W.air[1] - W.air[0]) * k - W.rainCool * this.cloud;
  }

  /** 马上转阴、接着下雨；now 为真时直接下起来（测试、截图用） */
  startRain(now = false): void {
    if (this.phase === 'clear') this.setPhase('overcast');
    this.phaseT = Math.min(this.phaseT, W.overcast);
    if (!now) return;
    if (this.phase === 'overcast') this.setPhase('rain');
    this.rain = this.strength;
    this.cloud = 0.6 + 0.4 * this.strength;
  }

  update(dt: number): void {
    this.phaseT -= dt;
    if (this.phase === 'clear') {
      this.hourAcc += dt;
      if (this.hourAcc >= this.dayLength / 24) {
        this.hourAcc = 0;
        // 夏天的阵雨多在午后
        const h = this.clock.hour;
        const k = h >= W.showers[0] && h < W.showers[1] ? W.showerPeak : W.showerOff;
        if (this.clock.totalDays >= W.firstRainDay && this.rng.chance((W.rainPerDay / 24) * k)) this.setPhase('overcast');
      }
    } else if (this.phaseT <= 0) this.setPhase(this.phase === 'overcast' ? 'rain' : 'clear');
    const wantRain = this.phase === 'rain' ? this.strength : 0;
    const wantCloud = this.phase === 'clear' ? 0 : 0.6 + 0.4 * this.strength;
    this.rain += (wantRain - this.rain) * Math.min(1, dt / 6);
    this.cloud += (wantCloud - this.cloud) * Math.min(1, dt / 12);
  }

  private setPhase(p: WeatherPhase): void {
    this.phase = p;
    if (p === 'overcast') {
      this.phaseT = W.overcast;
      this.strength = this.rng.range(W.strength[0], W.strength[1]);
      this.log(L('ev.overcast'));
    } else if (p === 'rain') {
      this.phaseT = (this.rng.range(W.hours[0], W.hours[1]) / 24) * this.dayLength;
      this.log(L(this.strength > 0.75 ? 'ev.rainHeavy' : 'ev.rainLight'));
    } else {
      this.phaseT = 0;
      this.log(L('ev.rainStop'));
    }
  }

  toSave(): WeatherSave {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return { phase: this.phase, phaseT: r(this.phaseT), strength: r(this.strength), rain: r(this.rain), cloud: r(this.cloud), hourAcc: r(this.hourAcc) };
  }

  restore(s: WeatherSave): void {
    Object.assign(this, s);
  }
}

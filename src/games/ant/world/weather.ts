import { CONFIG } from '../config';
import { L, type Text } from '../../../core/i18n';
import { clamp, smoothstep } from '../../../core/util/math';
import type { Rng } from '../../../core/util/random';
import type { World } from './world';

export type WeatherPhase = 'clear' | 'overcast' | 'rain';


export interface WeatherSave {
  phase: WeatherPhase;
  phaseT: number;
  strength: number;
  rain: number;
  cloud: number;
  wetness: number;
  plugs: number[];
  wet: number[];
}

/** 一处入口的封堵 / 清开工作 */
export interface PlugJob {
  entrance: number;
  open: boolean;
}

/**
 * 天气：晴 → 转阴 → 下雨 → 放晴。下雨冲淡信息素、地面积水、浅层房间从未堵住的入口进水；
 * 觅食蚁在阴雨和地面湿透时留在巢内，内务蚁在下雨前用土粒封住入口，雨后地面晾干再清开。
 */
export class WeatherSystem {
  phase: WeatherPhase = 'clear';
  private phaseT = 0;
  /** 这场雨的雨势 0..1 */
  strength = 0;
  /** 当前雨势、云量，平滑过渡 */
  rain = 0;
  cloud = 0;
  /** 地面湿润程度 0..1 */
  wetness = 0;
  private hourAcc = 0;
  /** 本次运行以来下过的雨（不存档，测试用） */
  rains = 0;

  constructor(private rng: Rng) {}

  /** 觅食蚁不出巢、内务蚁不做出巢的工作 */
  get keepIn(): boolean {
    return this.phase !== 'clear' || this.wetness > CONFIG.weather.reopenWet;
  }

  /** 雨后地面还湿的程度 0..1：入口已重开、但非侦察的觅食蚁按这个比例留巢 */
  get damp(): number {
    const W = CONFIG.weather;
    if (this.phase !== 'clear') return 1;
    return clamp((this.wetness - W.dryWet) / (W.reopenWet - W.dryWet), 0, 1);
  }

  get label(): Text {
    if (this.phase === 'rain') return L(this.strength > 0.75 ? 'weather.heavyRain' : 'weather.lightRain');
    if (this.phase === 'overcast') return L('weather.overcast');
    return L(this.wetness > 0.2 ? 'weather.afterRain' : 'weather.clear');
  }

  startRain(w: World): void {
    if (this.phase === 'clear') this.setPhase('overcast', w);
    this.phaseT = Math.min(this.phaseT, CONFIG.weather.calledOvercastSec);
  }

  update(dt: number, w: World): void {
    const W = CONFIG.weather;
    const dayLen = CONFIG.time.dayLength;
    this.phaseT -= dt;
    if (this.phase === 'clear') {
      this.hourAcc += dt;
      if (this.hourAcc >= dayLen / 24) {
        this.hourAcc = 0;
        if (w.clock.totalDays >= W.firstRainDay && this.rng.chance(W.rainPerDay / 24)) this.setPhase('overcast', w);
      }
    } else if (this.phaseT <= 0) this.setPhase(this.phase === 'overcast' ? 'rain' : 'clear', w);

    const wantRain = this.phase === 'rain' ? this.strength : 0;
    const wantCloud = this.phase === 'clear' ? 0 : 0.6 + 0.4 * this.strength;
    this.rain += (wantRain - this.rain) * Math.min(1, dt / 6);
    this.cloud += (wantCloud - this.cloud) * Math.min(1, dt / 12);

    if (this.rain > 0.05) this.wetness = Math.min(1, this.wetness + (this.rain * dt) / W.soakSec);
    else {
      const t = w.clock.temperatureAt(0);
      this.wetness = Math.max(0, this.wetness - (dt / W.drySec) * clamp(0.4 + t / 33, 0.3, 1.5) * (1 - 0.7 * this.cloud));
    }
    w.clock.weatherCool = W.rainCool * this.cloud;
    w.clock.groundWet = this.wetness;
    w.pheromone.rain = this.rain;

    if (this.rain > 0.3 && this.rng.chance(dt * W.puddlePerSec * this.rain)) this.rainPuddle(w);
    this.updateFlooding(dt, w);
  }

  private setPhase(p: WeatherPhase, w: World): void {
    const W = CONFIG.weather;
    this.phase = p;
    const col = w.colony;
    if (p === 'overcast') {
      this.phaseT = W.overcastSec;
      this.strength = this.rng.range(W.rainStrength[0], W.rainStrength[1]);
      col.pushEvent(L('ev.overcast'));
      col.seekShelter(0.6);
    } else if (p === 'rain') {
      this.rains++;
      this.phaseT = this.rng.range(W.rainDays[0], W.rainDays[1]) * CONFIG.time.dayLength;
      col.pushEvent(L(this.strength > 0.75 ? 'ev.rainHeavy' : 'ev.rainLight'));
      col.seekShelter(1);
    } else {
      this.phaseT = 0;
      col.pushEvent(L('ev.rainStop'));
    }
  }

  /** 雨水在低洼处积成水洼，避开入口和已有的东西 */
  private rainPuddle(w: World): void {
    const W = CONFIG.weather;
    const R = CONFIG.world.forageRadius;
    for (let tries = 0; tries < 6; tries++) {
      const d = Math.sqrt(this.rng.next()) * (R - 8);
      const ang = this.rng.range(0, Math.PI * 2);
      const x = Math.cos(ang) * d;
      const z = Math.sin(ang) * d;
      const r = this.rng.range(W.puddleRadius[0], W.puddleRadius[1]);
      if (w.nest.entrances.some((e) => Math.hypot(e.x - x, e.z - z) < r + 5)) continue;
      if (w.veg.obstacleAt(x, z, r * 0.6, true)) continue;
      if (w.food.sources.some((s) => Math.hypot(s.x - x, s.z - z) < r + s.radius)) continue;
      if (w.predators.antlions.some((p) => Math.hypot(p.x - x, p.z - z) < r + CONFIG.predators.pitRadius)) continue;
      w.water.pour(x, z, r);
      return;
    }
  }

  /** 雨水从没堵住的入口灌进浅层房间，越浅进水越快；不下雨时慢慢渗干 */
  private updateFlooding(dt: number, w: World): void {
    const W = CONFIG.weather;
    const ents = w.nest.entrances;
    const open = ents.reduce((s, e) => s + (1 - e.plug), 0) / Math.max(1, ents.length);
    const runoff = smoothstep(W.runoffWet[0], W.runoffWet[1], this.wetness);
    for (const c of w.nest.chambers) {
      if (!c.ready) continue;
      const before = c.wet;
      const depthK = Math.max(0, 1 - c.depth / W.floodDepth);
      c.wet = clamp(c.wet + (this.rain * runoff * open * W.floodRate * depthK - W.drainRate) * dt, 0, 1);
      if (before < W.floodedAt && c.wet >= W.floodedAt) {
        w.colony.pushEvent(L('ev.flooded', { room: c.label }), { kind: 'chamber', id: c.id });
        w.colony.updateClimate();
      } else if (before >= W.floodedAt && c.wet < W.floodedAt) w.colony.pushEvent(L('ev.drained', { room: c.label }), { kind: 'chamber', id: c.id });
    }
  }

  /** 内务蚁可以去做的封堵 / 清开工作；已在路上的工蚁按每次的工作量预先扣除 */
  plugJob(w: World): PlugJob | null {
    const W = CONFIG.weather;
    const closing = this.phase !== 'clear';
    const opening = !closing && this.wetness < W.reopenWet;
    if (!closing && !opening) return null;
    const ents = w.nest.entrances;
    const busy = ents.map(() => 0);
    for (const a of w.colony.ants) if (a.plugging >= 0) busy[a.plugging]++;
    let best = -1;
    let need = 0.01;
    for (let i = 0; i < ents.length; i++) {
      if (busy[i] >= W.maxPluggers) continue;
      const left = (closing ? 1 - ents[i].plug : ents[i].plug) - busy[i] * W.plugPerLoad;
      if (left > need) {
        need = left;
        best = i;
      }
    }
    return best < 0 ? null : { entrance: best, open: opening };
  }

  workPlug(job: PlugJob, w: World): void {
    const e = w.nest.entrances[job.entrance];
    const before = e.plug;
    e.plug = clamp(e.plug + (job.open ? -1 : 1) * CONFIG.weather.plugPerLoad, 0, 1);
    if (e.plug > 0.999) e.plug = 1;
    if (e.plug < 0.001) e.plug = 0;
    if (before < 1 && e.plug === 1) w.colony.pushEvent(L('ev.sealed', { ent: e.label }), { kind: 'entrance', id: job.entrance });
    if (before > 0 && e.plug === 0) w.colony.pushEvent(L('ev.reopened', { ent: e.label }), { kind: 'entrance', id: job.entrance });
  }

  toSave(w: World): WeatherSave {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      phase: this.phase,
      phaseT: r(this.phaseT),
      strength: r(this.strength),
      rain: r(this.rain),
      cloud: r(this.cloud),
      wetness: r(this.wetness),
      plugs: w.nest.entrances.map((e) => r(e.plug)),
      wet: w.nest.chambers.map((c) => r(c.wet)),
    };
  }

  restore(s: WeatherSave, w: World): void {
    this.phase = s.phase;
    this.phaseT = s.phaseT;
    this.strength = s.strength;
    this.rain = s.rain;
    this.cloud = s.cloud;
    this.wetness = s.wetness;
    w.nest.entrances.forEach((e, i) => (e.plug = s.plugs[i] ?? 0));
    w.nest.chambers.forEach((c, i) => (c.wet = s.wet[i] ?? 0));
  }
}

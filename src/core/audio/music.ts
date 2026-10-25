import { ENGINE } from '../config';
import { Rng } from '../util/random';
import { Composer, type MusicNote } from './composer';

const KEY = 'cyber-music';
/** 每隔多久往前排一次音、排到多远（秒）；页面在后台时计时器会变慢，所以多排一些 */
const TICK_MS = 250;
const AHEAD = 1.5;

/** 一次播放：开关一次换一组，关掉时旧的淡出后整组断开，已经排好的音不会在重新打开时冒出来 */
interface Take {
  out: GainNode;
  input: GainNode;
  composer: Composer;
  t0: number;
}

/**
 * 程序生成的背景音乐（Web Audio）：铃声似的旋律、柔和的和弦铺底、低音，加混响。
 * 开关记在本地；浏览器不让自动出声，开着的话第一次点击或按键时才开始。页面隐藏时暂停
 */
export class Music {
  enabled: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private impulse: AudioBuffer | null = null;
  private take: Take | null = null;
  private timer = 0;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // 本地存储不可用时用默认值
    }
    this.enabled = saved === null ? ENGINE.music.defaultOn : saved === '1';
    // 点音乐开关本身不算：开关紧接着会处理，先在这里打开就会响一下又被关掉
    const wake = (e: Event) => {
      if (!this.enabled || this.playing || document.hidden) return;
      if ((e as KeyboardEvent).code === 'KeyM' || (e.target as Element | null)?.closest?.('[data-a="music"]')) return;
      this.start();
    };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.take) void this.ctx.resume();
    });
  }

  /** 正在出声（开着、浏览器允许、页面可见） */
  get playing(): boolean {
    return !!this.take && this.ctx?.state === 'running';
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // 记不住也不影响这次
    }
    if (on) this.start();
    else this.stop();
  }

  private start(): void {
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume();
    if (this.take) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + ENGINE.music.fadeSec);
    out.connect(this.master!);
    const input = ctx.createGain();
    input.connect(out);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    input.connect(reverb).connect(wet).connect(out);
    this.take = { out, input, composer: new Composer(new Rng((Math.random() * 2 ** 32) >>> 0)), t0: now + 0.1 };
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  private stop(): void {
    const take = this.take;
    const ctx = this.ctx;
    if (!take || !ctx) return;
    this.take = null;
    clearInterval(this.timer);
    const g = take.out.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + ENGINE.music.fadeSec);
    setTimeout(() => take.out.disconnect(), ENGINE.music.fadeSec * 1000 + 200);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = ENGINE.music.volume;
    this.master.connect(comp);
    // 混响：两声道各一段按指数衰减的白噪声
    const len = Math.round(ENGINE.music.reverbSec * ctx.sampleRate);
    this.impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return ctx;
  }

  private schedule(): void {
    const take = this.take;
    const ctx = this.ctx;
    if (!take || !ctx || ctx.state !== 'running') return;
    for (const n of take.composer.until(ctx.currentTime - take.t0 + AHEAD)) this.play(ctx, take, n);
  }

  private play(ctx: AudioContext, take: Take, n: MusicNote): void {
    const at = Math.max(ctx.currentTime, take.t0 + n.t);
    const f = 440 * 2 ** ((n.midi - 69) / 12);
    const env = ctx.createGain();
    env.connect(take.input);
    const g = env.gain;
    g.setValueAtTime(0, at);
    const osc = (type: OscillatorType, freq: number, level: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const lv = ctx.createGain();
      lv.gain.value = level;
      o.connect(lv);
      return { o, lv };
    };
    let end: number;
    let parts: { o: OscillatorNode; lv: GainNode }[];
    if (n.voice === 'bell') {
      // 八音盒似的：基音加一点高八度的泛音，敲一下就慢慢衰减
      end = at + n.dur + 0.5;
      g.linearRampToValueAtTime(0.16 * n.vel, at + 0.008);
      g.exponentialRampToValueAtTime(0.0005, end);
      parts = [osc('sine', f, 1), osc('sine', f * 2, 0.18), osc('triangle', f * 3, 0.04)];
      for (const p of parts) p.lv.connect(env);
    } else if (n.voice === 'pad') {
      // 两个略微走音的三角波，过低通滤波，慢起慢收
      end = at + n.dur + 2.5;
      g.linearRampToValueAtTime(0.045 * n.vel, at + 2);
      g.setValueAtTime(0.045 * n.vel, at + n.dur);
      g.linearRampToValueAtTime(0, end);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      lp.connect(env);
      parts = [osc('triangle', f, 1, -7), osc('triangle', f, 1, 7)];
      for (const p of parts) p.lv.connect(lp);
    } else {
      end = at + n.dur + 0.8;
      g.linearRampToValueAtTime(0.13 * n.vel, at + 0.03);
      g.exponentialRampToValueAtTime(0.02 * n.vel, at + n.dur);
      g.linearRampToValueAtTime(0, end);
      parts = [osc('sine', f, 1)];
      for (const p of parts) p.lv.connect(env);
    }
    for (const p of parts) {
      p.o.start(at);
      p.o.stop(end);
    }
    parts[0].o.onended = () => env.disconnect();
  }
}

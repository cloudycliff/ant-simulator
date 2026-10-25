import { ENGINE } from '../config';
import { clamp } from '../util/math';
import type { Rng } from '../util/random';

export type Voice = 'pad' | 'bell' | 'bass';

/** 一个音：t 是从开始播放算起的秒数，dur 是按住的时长（秒），vel 是 0..1 的力度 */
export interface MusicNote {
  voice: Voice;
  t: number;
  dur: number;
  midi: number;
  vel: number;
}

/** 相对主音的和弦音：大调里的 I、ii、iii、IV、V、vi，都带七度或六度，听起来柔和 */
const CHORDS: Record<string, number[]> = {
  I: [0, 4, 7, 11],
  ii: [2, 5, 9, 12],
  iii: [4, 7, 11, 14],
  IV: [5, 9, 12, 16],
  V: [7, 11, 14, 16],
  vi: [9, 12, 16, 19],
};
const PROGRESSIONS = [
  ['I', 'vi', 'IV', 'V'],
  ['I', 'V', 'vi', 'IV'],
  ['vi', 'IV', 'I', 'V'],
  ['IV', 'V', 'iii', 'vi'],
  ['I', 'IV', 'vi', 'V'],
  ['IV', 'I', 'ii', 'V'],
];
/** 旋律只用大调五声音阶，和哪个和弦放在一起都不刺耳 */
const PENTA = [0, 2, 4, 7, 9];
const BARS_PER_CHORD = 2;

/**
 * 轻音乐的作曲：4/4 拍，每个和弦两小节，四个和弦一段。每段随机换一个和弦进行和一档旋律疏密，
 * 旋律在五声音阶上随机游走、强拍落在和弦音上。只产生音符，怎么发声由 Music 决定
 */
export class Composer {
  readonly key: number;
  private readonly beat: number;
  private readonly melody: number[] = [];
  private bar = 0;
  private barStart = 0;
  private prog = PROGRESSIONS[0];
  private density = 0;
  private note: number;

  constructor(
    private readonly rng: Rng,
    private readonly style = ENGINE.music,
  ) {
    this.key = rng.pick(style.keys);
    this.beat = 60 / style.bpm;
    for (let i = style.melodyRange[0]; i <= style.melodyRange[1]; i++) if (PENTA.includes(i % 12)) this.melody.push(this.key + i);
    this.note = Math.floor(this.melody.length / 2);
  }

  /** 生成开始时间早于 until 秒的各小节，返回这些小节里的音，按时间排好 */
  until(until: number): MusicNote[] {
    const out: MusicNote[] = [];
    while (this.barStart < until) {
      this.composeBar(out);
      this.bar++;
      this.barStart += this.beat * 4;
    }
    return out;
  }

  private composeBar(out: MusicNote[]): void {
    const r = this.rng;
    const b = this.beat;
    const inProg = this.bar % (BARS_PER_CHORD * 4);
    if (inProg === 0) {
      this.prog = r.pick(PROGRESSIONS);
      this.density = r.pick(this.style.density);
    }
    const chord = CHORDS[this.prog[Math.floor(inProg / BARS_PER_CHORD)]];
    const t0 = this.barStart;
    const root = this.key - 24 + chord[0];
    const notes: MusicNote[] = [];
    if (inProg % BARS_PER_CHORD === 0) {
      // 和弦按住整个和弦的长度再多半拍，和下一个和弦接上
      for (const iv of chord) notes.push({ voice: 'pad', t: t0, dur: b * (4 * BARS_PER_CHORD + 0.5), midi: this.key - 12 + iv, vel: 0.6 });
      notes.push({ voice: 'bass', t: t0, dur: b * 4, midi: root, vel: 0.8 });
    } else if (r.chance(0.5)) notes.push({ voice: 'bass', t: t0, dur: b * 3, midi: root, vel: 0.55 });
    const pcs = chord.map((iv) => iv % 12);
    for (let s = 0; s < 8; s++) {
      if (!r.chance(this.density * (s % 2 === 0 ? 1 : 0.35))) continue;
      const step = r.chance(0.12) ? r.pick([-4, -3, 3, 4]) : r.pick([-2, -1, -1, 0, 1, 1, 2]);
      this.note = clamp(this.note + step, 0, this.melody.length - 1);
      if (s % 4 === 0) this.note = this.nearestChordTone(this.note, pcs);
      notes.push({ voice: 'bell', t: t0 + (s * b) / 2, dur: b * 2.5, midi: this.melody[this.note], vel: (s === 0 ? 0.75 : 0.55) + r.next() * 0.25 });
    }
    out.push(...notes.sort((x, y) => x.t - y.t));
  }

  /** 旋律里离第 i 个音最近的和弦音（下标） */
  private nearestChordTone(i: number, pcs: number[]): number {
    for (let d = 0; d < this.melody.length; d++)
      for (const j of [i - d, i + d]) if (j >= 0 && j < this.melody.length && pcs.includes((this.melody[j] - this.key) % 12)) return j;
    return i;
  }
}

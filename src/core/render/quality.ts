import type * as THREE from 'three';
import { CONFIG } from '../../games/ant/config';

export const QUALITY_MODES = ['auto', 'high', 'medium', 'low', 'saver'] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];
export const QUALITY_LEVELS = ['high', 'medium', 'low'] as const;

const KEY = 'cyber-ant-quality';

/**
 * 画质档位与帧率上限。档位只改像素比和阴影贴图大小（抗锯齿、阴影类型改了要重建上下文或重编着色器）。
 * “自动”从设备对应的档位开始，持续卡顿时降一档，不会自己升回去：升档后又卡，就会来回跳
 */
export class Quality {
  mode: QualityMode = 'auto';
  /** 当前档位，下标对应 CONFIG.render.levels，0 最高 */
  level = 0;
  /** 上一帧是否因为暂停没操作而降了帧率 */
  idle = false;
  /** 自动降档后调用 */
  onDrop?: () => void;
  private readonly startLevel: number;
  private lastFrame = -Infinity;
  private lastInput = 0;
  private winStart = 0;
  private winFrames = 0;
  private slowWindows = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private sun: THREE.DirectionalLight,
    mobile: boolean,
  ) {
    this.startLevel = mobile ? CONFIG.render.mobileLevel : 0;
    try {
      const m = localStorage.getItem(KEY) as QualityMode | null;
      if (m && QUALITY_MODES.includes(m)) this.mode = m;
    } catch {
      // 本地存储不可用时用“自动”
    }
    this.level = this.levelOf(this.mode);
    this.apply();
    const wake = () => (this.lastInput = performance.now());
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(type, wake, { capture: true, passive: true });
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // 记不住也不影响本次设置
    }
    this.level = this.levelOf(mode);
    this.apply();
    this.resetWindow(performance.now());
  }

  /** 每次 requestAnimationFrame 调用；返回 false 时这一帧什么都不做 */
  frame(now: number, paused: boolean): boolean {
    const R = CONFIG.render;
    const idle = paused && now - this.lastInput > R.idleAfterSec * 1000;
    this.idle = idle;
    const cap = idle ? R.idleFps : this.mode === 'saver' ? R.saverFps : R.maxFps;
    // 刷新间隔有抖动，留 2 ms 余量，否则 60 Hz 屏幕上会隔一帧才画
    if (now - this.lastFrame < 1000 / cap - 2) return false;
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    // 限了帧率、刚切回页面或卡了一大下（编译着色器、读档）的时段不算
    if (this.mode !== 'auto' || cap !== R.maxFps || gap > 250 || this.level >= R.levels.length - 1) {
      this.resetWindow(now);
      return true;
    }
    this.winFrames++;
    const span = now - this.winStart;
    if (span >= R.adaptWindowSec * 1000) {
      this.slowWindows = (this.winFrames / span) * 1000 < R.lowFps ? this.slowWindows + 1 : 0;
      this.winStart = now;
      this.winFrames = 0;
      if (this.slowWindows >= R.adaptWindows) {
        this.slowWindows = 0;
        this.level++;
        this.apply();
        this.onDrop?.();
      }
    }
    return true;
  }

  private resetWindow(now: number): void {
    this.winStart = now;
    this.winFrames = 0;
    this.slowWindows = 0;
  }

  private levelOf(mode: QualityMode): number {
    if (mode === 'auto') return this.startLevel;
    return mode === 'saver' ? CONFIG.render.levels.length - 1 : QUALITY_LEVELS.indexOf(mode);
  }

  private apply(): void {
    const L = CONFIG.render.levels[this.level];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, L.pixelRatio));
    const s = this.sun.shadow;
    if (s.mapSize.x === L.shadowMap) return;
    s.mapSize.set(L.shadowMap, L.shadowMap);
    s.map?.dispose();
    s.map = null;
  }
}

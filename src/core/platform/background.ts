import { ENGINE } from '../config';
import { MOBILE } from './device';

const KEY = 'cyber-ant-background';

/** 手机和平板的浏览器切到后台会冻结整个页面（Worker 也停），后台运行在这些设备上不起作用 */
export const BACKGROUND_LIMITED = MOBILE;

/**
 * 页面隐藏（最小化、切到其他标签页）时浏览器不再调用 requestAnimationFrame，由这里接手推进模拟。
 * 节拍来自 Worker：后台页面里的 setInterval 会被浏览器降到每秒一次、几分钟后每分钟一次，
 * Worker 发来的消息不受这个限制。Worker 建不起来时退回 setInterval
 */
export class BackgroundRunner {
  enabled = true;
  private running = false;
  private worker: Worker | null = null;
  private workerUrl = '';
  private timer = 0;
  private last = 0;

  constructor(private onTick: (realDt: number) => void) {
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      // 本地存储不可用时按默认开启
    }
    document.addEventListener('visibilitychange', () => this.update());
    this.update();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // 记不住也不影响本次设置
    }
    this.update();
  }

  private update(): void {
    const run = this.enabled && document.hidden;
    if (run === this.running) return;
    this.running = run;
    if (run) this.start();
    else this.stop();
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.onTick(dt);
  };

  private start(): void {
    this.last = performance.now();
    const ms = ENGINE.background.tickMs;
    try {
      this.workerUrl = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
      this.worker = new Worker(this.workerUrl);
      this.worker.onmessage = this.tick;
      this.worker.onerror = () => this.fallback();
    } catch {
      this.fallback();
    }
  }

  private fallback(): void {
    this.stopWorker();
    if (this.running && !this.timer) this.timer = window.setInterval(this.tick, ENGINE.background.tickMs);
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = '';
  }

  private stop(): void {
    this.stopWorker();
    clearInterval(this.timer);
    this.timer = 0;
  }
}

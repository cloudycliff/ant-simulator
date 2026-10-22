import { IOS, MOBILE } from './device';

/** Chromium 系浏览器在可以安装时发出的事件（标准库里没有它的类型） */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 添加到主屏幕。安卓和电脑上的 Chrome、Edge 会给出 beforeinstallprompt，可以直接弹出安装框；
 * iOS 没有这个事件，只能提示玩家从分享菜单里添加
 */
export class Installer {
  private prompt: InstallPromptEvent | null = null;
  /** 能否安装有变化时调用 */
  onChange?: () => void;

  constructor() {
    addEventListener('beforeinstallprompt', (e) => {
      this.prompt = e as InstallPromptEvent;
      this.onChange?.();
    });
    addEventListener('appinstalled', () => {
      this.prompt = null;
      this.onChange?.();
    });
  }

  /** 已经是从主屏幕打开的 */
  get standalone(): boolean {
    return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  }

  /** prompt：可以弹出安装框；ios：只能手动添加；null：不显示入口（电脑上浏览器地址栏自己有安装按钮） */
  get kind(): 'prompt' | 'ios' | null {
    if (this.standalone || !MOBILE) return null;
    if (this.prompt) return 'prompt';
    return IOS ? 'ios' : null;
  }

  /** 弹出安装框，返回玩家是否同意 */
  async install(): Promise<boolean> {
    const p = this.prompt;
    if (!p) return false;
    this.prompt = null;
    await p.prompt();
    const { outcome } = await p.userChoice;
    this.onChange?.();
    return outcome === 'accepted';
  }
}

/** 离线缓存只在正式构建、https（或本机）下注册；开发时注册会缓存 Vite 的页面 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 注册失败只是没有离线缓存，不影响游戏
  });
}

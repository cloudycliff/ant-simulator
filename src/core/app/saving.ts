import * as THREE from 'three';
import { ENGINE } from '../config';
import { t, tr } from '../i18n';
import type { EntityRef } from '../sim/entities';
import type { App } from './app';

/** 手动保存；定时、切到后台、关闭页面时自动保存。读档和重新开始都通过重新载入页面完成 */
export class SaveControl<R extends EntityRef> {
  /** 要重新载入了，之后不再保存，以免覆盖 */
  private blocked = false;
  private warned = false;
  private timer = 0;
  private readonly dir = new THREE.Vector3();

  constructor(private readonly app: App<R>) {
    window.addEventListener('pagehide', () => this.save(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save(false);
    });
  }

  save(manual: boolean): void {
    if (this.blocked) return;
    const { world, camera, shell } = this.app;
    const S = this.app.game.save;
    const d = S.write(world, Date.now());
    camera.getWorldDirection(this.dir);
    const target = camera.position.clone().addScaledVector(this.dir, 10);
    d.camera = [...camera.position.toArray(), ...target.toArray()].map((n) => Math.round(n * 100) / 100);
    const err = S.slot.write(d, S.meta(d));
    shell.saveMeta = S.slot.readMeta();
    if (manual) shell.toast(err ? t('toast.saveFailed', { err }) : t('toast.saved', { stamp: tr(world.clock.stamp()) }));
    else if (err && !this.warned) {
      this.warned = true;
      shell.toast(t('toast.autosaveFailed', { err }));
    }
  }

  /** 每帧和后台运行的每一拍调用，到了间隔就自动保存 */
  tick(dt: number): void {
    this.timer += dt;
    if (this.timer > ENGINE.save.autosaveSec) {
      this.timer = 0;
      this.save(false);
    }
  }

  /** 去掉网址参数重新载入，页面启动时从存档位读档 */
  reload(): void {
    this.blocked = true;
    location.replace(location.href.split(/[?#]/)[0]);
  }
}

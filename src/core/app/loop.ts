import * as THREE from 'three';
import { ENGINE } from '../config';
import { t } from '../i18n';
import { BACKGROUND_LIMITED, BackgroundRunner } from '../platform/background';
import type { EntityRef } from '../sim/entities';
import type { App } from './app';

/** 页面隐藏时由 BackgroundRunner 推进模拟；回到页面时提示离开期间过了多久 */
export function startBackground<R extends EntityRef>(app: App<R>): BackgroundRunner {
  const { world, shell } = app;
  /** 后台接手时的模拟秒数 */
  let awayFrom = -1;
  const background = new BackgroundRunner((dt) => {
    if (awayFrom < 0) awayFrom = world.clock.seconds;
    const B = ENGINE.background;
    world.advance(dt, Math.min(B.maxBudgetMs, dt * 1000 * B.cpuShare), Infinity);
    app.saving.tick(dt);
  });
  shell.state.background = background.enabled;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const awayMin = (Date.now() - hiddenAt) / 60000;
    if (awayFrom >= 0 && world.clock.seconds - awayFrom > 30) shell.toast(t('toast.bgResumed', { from: world.clock.stampAt(awayFrom), to: world.clock.stamp() }));
    else if (BACKGROUND_LIMITED && !world.clock.paused && awayMin >= 1) shell.toast(t('toast.bgFrozen', { n: Math.round(awayMin) }));
    awayFrom = -1;
    app.refresh();
  });
  return background;
}

/** 每帧：推进模拟、更新相机、同步视图、刷新面板、自动保存、渲染 */
export function startLoop<R extends EntityRef>(app: App<R>): void {
  const { world, renderer, scene, camera, controller, space, shell, tools, session, quality } = app;
  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const hoverPt = new THREE.Vector3();
  let last = performance.now();
  /** 每帧主线程耗时（ms，指数平均）：模拟推进、视图同步、提交渲染 */
  const perf = { sim: 0, views: 0, render: 0 };
  let hudTimer = 0;
  let time = 0;

  const frame = (now: number) => {
    if (!quality.frame(now, world.clock.paused)) {
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    app.fps += (1 / Math.max(dt, 1e-4) - app.fps) * 0.05;

    const t0 = performance.now();
    world.advance(dt, ENGINE.loop.frameBudgetMs);
    const t1 = performance.now();
    controller.update(dt);
    shell.state.following = controller.mode === 'follow';

    const cp = camera.position;
    const followed = controller.mode === 'follow' && app.selection ? world.entities.pos(app.selection) : null;
    if (followed) focus.copy(followed);
    else {
      camera.getWorldDirection(fwd);
      const h = Math.max(4, cp.y - space.surfaceAt(cp.x, cp.z));
      focus.copy(cp).addScaledVector(fwd, Math.min(60, h * 1.6));
      focus.y = space.surfaceAt(focus.x, focus.z);
    }

    const mouse = app.mouse;
    if (tools && tools.active >= 0) tools.hover(tools.pending ?? (mouse ? app.groundPoint(mouse.x, mouse.y, hoverPt) : null));
    session.update(dt, { time, focus, selection: app.selection, following: shell.state.following });

    shell.tick(dt);
    app.saving.tick(dt);
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      shell.refresh(app.selection, app.fps, perf);
    }

    const t2 = performance.now();
    renderer.render(scene, camera);
    const t3 = performance.now();
    perf.sim += (t1 - t0 - perf.sim) * 0.05;
    perf.views += (t2 - t1 - perf.views) * 0.05;
    perf.render += (t3 - t2 - perf.render) * 0.05;
    requestAnimationFrame(frame);
  };
  app.refresh();
  requestAnimationFrame(frame);
}

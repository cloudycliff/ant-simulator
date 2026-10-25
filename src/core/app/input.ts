import * as THREE from 'three';
import { t } from '../i18n';
import type { EntityRef } from '../sim/entities';
import { runAction } from './actions';
import type { App } from './app';

const SPEED_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 5, Digit4: 10, Digit5: 20 };
const TOUCH_PICK_PX = 32;

/** 画面上的点击、双击、触屏拖动预览圈，键盘快捷键，窗口尺寸变化 */
export function bindInput<R extends EntityRef>(app: App<R>): void {
  const { renderer, camera, controller, shell, tools, session } = app;
  const dom = renderer.domElement;
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') app.mouse = { x: e.clientX, y: e.clientY };
  });
  dom.addEventListener('pointerleave', () => (app.mouse = null));
  // iOS Safari 不认 touch-action 时仍会整页缩放
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const pt = new THREE.Vector3();
  controller.onClick = (x, y, touch) => {
    // 手机布局里点画面先收起打开的抽屉，和地图应用一样
    if (shell.sheet) {
      shell.setSheet(null);
      return;
    }
    if (tools && tools.active >= 0) {
      if (!touch) return void app.applyTool(app.groundPoint(x, y, pt));
      tools.pending = app.groundPoint(x, y)?.clone() ?? null;
      if (!tools.pending) shell.toast(t('tool.clickGround'));
      shell.renderTool();
      return;
    }
    app.select(session.pick(x, y, touch ? TOUCH_PICK_PX : undefined));
  };
  controller.onDoubleClick = (x, y, touch) => {
    if (tools && tools.active >= 0) return;
    const s = session.pick(x, y, touch ? TOUCH_PICK_PX : undefined);
    if (s) {
      app.select(s);
      app.flyToSelection();
    }
  };

  // 触屏没有悬停：选好位置后，按在预览圈上拖动就让它跟着手指走
  const screenPt = new THREE.Vector3();
  const toScreen = (p: THREE.Vector3): [number, number] => {
    const rect = dom.getBoundingClientRect();
    screenPt.copy(p).project(camera);
    return [rect.left + ((screenPt.x + 1) / 2) * rect.width, rect.top + ((1 - screenPt.y) / 2) * rect.height];
  };
  controller.onTouchDragStart = (x, y) => {
    const p = tools && tools.active >= 0 ? tools.pending : null;
    const opt = tools?.current;
    if (!p || !opt) return false;
    const [cx, cy] = toScreen(p);
    const [ex, ey] = toScreen(new THREE.Vector3(p.x + Math.max(opt.radius, (opt.len ?? 0) / 2), p.y, p.z));
    return Math.hypot(x - cx, y - cy) < Math.max(TOUCH_PICK_PX * 1.5, Math.hypot(ex - cx, ey - cy));
  };
  controller.onTouchDrag = (x, y) => {
    const p = app.groundPoint(x, y, pt);
    if (p && tools?.pending) tools.pending.copy(p);
  };

  const action = (a: string, v?: number) => runAction(app, a, v);
  const viewKeys = new Map(shell.views.filter((v) => v.key).map((v) => [`Key${v.key}`, v.id]));
  const toolKeys = new Map((tools?.defs ?? []).map((d, i) => [`Digit${d.key}`, i]));
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      return action('saveNow');
    }
    if (e.code in SPEED_KEYS) return action('speed', SPEED_KEYS[e.code]);
    const view = viewKeys.get(e.code);
    if (view) return action(view);
    const tool = toolKeys.get(e.code);
    if (tool !== undefined) return action('tool', tool);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        return action('pause');
      case 'KeyF':
        return action('follow');
      case 'KeyH':
        return action('help');
      case 'KeyM':
        return action('music');
      case 'KeyR':
        tools?.rotate();
        return;
      case 'Escape':
        return action(tools && tools.active >= 0 ? 'toolexit' : 'deselect');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    shell.updateMode();
    app.refresh();
  });
}

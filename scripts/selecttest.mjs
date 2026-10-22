// 页面里的选中、跟随、飞过去、点击事件：这些都查实体注册表（DECISIONS T-053）
// 用法：node scripts/selecttest.mjs [网址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const ROOT = process.argv[2] ?? BASE;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};
const camDist = (posExpr) => `(() => { const p = ${posExpr}; return p ? camera.position.distanceTo(p) : -1; })()`;

const browser = await launch(9347);
try {
  const g = await browser.page();
  await g.viewport(1280, 800, false);

  await g.open(`${ROOT}?new=1&seed=4242&skip=200&lang=zh&select=ant:1&follow=1`);
  const f = await g.ev(`({ mode: controller.mode, following: hud.state.following, d: ${camDist("world.entities.pos({ kind: 'ant', id: 1 })")} })`);
  check('网址参数选中 1 号工蚁并跟随', f.mode === 'follow' && f.following && f.d > 0 && f.d < 16, f);
  for (const type of ['keyDown', 'keyUp']) await g.send('Input.dispatchKeyEvent', { type, code: 'KeyF', key: 'f', windowsVirtualKeyCode: 70 });
  await sleep(300);
  check('按 F 取消跟随', (await g.ev('controller.mode')) === 'free');

  await g.open(`${ROOT}?new=1&seed=4242&skip=200&lang=zh&select=chamber:0&fly=1`);
  await sleep(2000);
  const d = await g.ev(camDist("world.entities.pos({ kind: 'chamber', id: 0 })"));
  check('飞到 0 号房间，按房间的观察距离 26', Math.abs(d - 26) < 1, d);

  await g.open(`${ROOT}?new=1&seed=4242&skip=600&lang=zh`);
  const target = await g.ev(`(() => {
    const row = document.querySelector('#events [data-ev]');
    if (!row) return null;
    const e = world.events.entries[Number(row.dataset.ev)];
    const p = e.ref ? world.entities.pos(e.ref) : null;
    const r = row.getBoundingClientRect();
    return { ref: e.ref ?? null, at: p ? [p.x, p.y, p.z] : e.at, dist: p ? world.entities.viewDistance(e.ref) : world.entities.defaultViewDistance, x: r.left + 20, y: r.top + r.height / 2 };
  })()`);
  check('有可点击的事件', !!target, target);
  if (target) {
    await g.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await g.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await g.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await sleep(2500);
    const [x, y, z] = target.at;
    const after = await g.ev(`camera.position.distanceTo({ x: ${x}, y: ${y}, z: ${z} })`);
    const moving = target.ref?.kind === 'ant';
    check(`点击事件后飞到对象旁边（${target.ref?.kind ?? '只有位置'}）`, moving ? after < target.dist + 8 : Math.abs(after - target.dist) < 1.5, { after, want: target.dist });
  }
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

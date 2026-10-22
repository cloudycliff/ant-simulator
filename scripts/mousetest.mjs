// 桌面鼠标回归：拖拽、滚轮、点选、工具直接放置保持原样；窗口变窄时切到手机布局，再变宽时切回
import { BASE, launch, sleep } from './cdp.mjs';

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const br = await launch(9342);
try {
  const g = await br.page();
  await g.viewport(1280, 800, false);
  await g.open(`${BASE}?new=1&seed=20261021&hour=12&lang=zh`);
  check('鼠标环境不是 pointer: coarse', !(await g.ev(`matchMedia('(pointer: coarse)').matches`)));
  check('1280 宽使用桌面布局', !(await g.ev(`document.body.classList.contains('compact')`)));

  const mouse = (type, x, y, button = 'none', extra = {}) => g.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, ...extra });
  const drag = async (button, from, to) => {
    await mouse('mousePressed', ...from, button);
    for (let s = 1; s <= 10; s++) {
      await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * s) / 10, from[1] + ((to[1] - from[1]) * s) / 10, button, { buttons: button === 'left' ? 1 : 2 });
      await sleep(16);
    }
    await mouse('mouseReleased', ...to, button);
    await sleep(200);
  };
  const click = async (x, y) => {
    await mouse('mousePressed', x, y, 'left');
    await mouse('mouseReleased', x, y, 'left');
  };
  const cam = () => g.ev(`({ p: camera.position.toArray(), pitch: camera.rotation.x, yaw: camera.rotation.y })`);
  const moved = (a, b) => Math.hypot(...a.p.map((v, i) => v - b.p[i]));

  let a = await cam();
  await drag('left', [640, 450], [760, 450]);
  let b = await cam();
  check('左键拖拽：原地转向', moved(a, b) < 1e-6 && Math.abs(b.yaw - a.yaw) > 0.3, { dYaw: (b.yaw - a.yaw).toFixed(3) });

  a = b;
  await drag('right', [640, 450], [700, 450]);
  b = await cam();
  check('右键拖拽：平移，视角不变', moved(a, b) > 0.05 && Math.abs(b.yaw - a.yaw) < 1e-6, { move: moved(a, b).toFixed(2) });

  a = b;
  await mouse('mouseWheel', 640, 450, 'none', { deltaX: 0, deltaY: -300 });
  await sleep(400);
  b = await cam();
  check('滚轮：推近', moved(a, b) > 0.5, { move: moved(a, b).toFixed(2) });

  await g.ev(`['colony','info','events','help','stats'].forEach(id => document.getElementById(id).style.visibility = 'hidden')`);
  await g.ev(`document.querySelector('[data-a="tool"][data-v="0"]').click()`);
  await sleep(300);
  const n0 = await g.ev(`world.food.sources.length`);
  const hasPlace = await g.ev(`!!document.querySelector('#tool [data-a="toolPlace"]')`);
  await click(640, 560);
  await sleep(400);
  const n1 = await g.ev(`world.food.sources.length`);
  check('工具：鼠标点地面直接放下，没有“放在这里”按钮', n1 === n0 + 1 && !hasPlace, { n0, n1, toast: await g.ev(`document.getElementById('toast').textContent`) });
  await g.ev(`document.querySelector('#tool [data-a="toolexit"]').click()`);

  // 窗口缩窄到手机宽度：切到手机布局，按钮状态和打开的统计不丢
  await g.ev(`document.querySelector('[data-a="pheromone"]').click()`);
  await g.viewport(600, 800, false);
  await sleep(800);
  const narrow = await g.ev(`({ compact: document.body.classList.contains('compact'), dock: !!document.querySelector('#dock [data-a="sheet"]'), pher: document.getElementById('btn-pheromone').classList.contains('on') })`);
  check('窗口变窄后切到手机布局，信息素开关保持', narrow.compact && narrow.dock && narrow.pher, narrow);
  await g.viewport(1280, 800, false);
  await sleep(800);
  const wide = await g.ev(`({ compact: document.body.classList.contains('compact'), dock: !!document.querySelector('#dock [data-a="sheet"]'), top: !!document.querySelector('#topbar .controls') })`);
  check('再变宽后切回桌面布局', !wide.compact && !wide.dock && wide.top, wide);
  g.close();
} finally {
  br.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

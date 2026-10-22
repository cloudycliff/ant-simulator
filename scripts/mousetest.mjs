// 桌面鼠标回归：触屏适配后，鼠标的拖拽、滚轮、点选、工具直接放置保持原样
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9342;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mousetest-'))}`,
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (path, method = 'GET') => {
  for (let i = 0; i < 50; i++) {
    try {
      const txt = await (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).text();
      try {
        return JSON.parse(txt);
      } catch {
        return txt;
      }
    } catch {
      await sleep(200);
    }
  }
  throw new Error('no devtools');
};
const connect = (wsUrl) =>
  new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waits = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) waits.get(d.id)(d.result ?? d.error);
    };
    const send = (method, params = {}) =>
      new Promise((r) => {
        waits.set(++id, r);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
      return r.result.value;
    };
    ws.onopen = () => resolve({ send, ev, close: () => ws.close() });
  });

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

try {
  await http('/json/version');
  const tab = await http('/json/new?about:blank', 'PUT');
  const g = await connect(tab.webSocketDebuggerUrl);
  await g.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await g.send('Page.navigate', { url: 'http://localhost:5173/?new=1&seed=20261021&hour=12&lang=zh' });
  await sleep(1000);
  for (let i = 0; i < 120 && !(await g.ev(`!!window.world && !document.getElementById('loading')`).catch(() => false)); i++) await sleep(500);
  await sleep(1500);
  check('鼠标环境不是 pointer: coarse', !(await g.ev(`matchMedia('(pointer: coarse)').matches`)));

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
  g.close();
} finally {
  chrome.kill();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

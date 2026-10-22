// 触屏操作测试：无头 Chrome 开启触屏模拟，用 DevTools 协议派发触摸事件
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9341;
const W = 390;
const H = 844;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'touchtest-'))}`,
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
  await g.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await g.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await g.send('Page.navigate', { url: 'http://localhost:5173/?new=1&seed=20261021&hour=12&lang=zh' });
  await sleep(1000);
  for (let i = 0; i < 120 && !(await g.ev(`!!window.world && !document.getElementById('loading')`).catch(() => false)); i++) await sleep(500);
  await sleep(1500);
  // 面板适配是下一步的工作，这里先藏起来，让触摸落在画布上
  await g.ev(`['colony','info','events','help','stats'].forEach(id => document.getElementById(id).style.visibility = 'hidden')`);
  check('触屏环境被识别为 pointer: coarse', await g.ev(`matchMedia('(pointer: coarse)').matches`));

  const touch = (type, pts) => g.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const lerp = (a, b, k) => a + (b - a) * k;
  const gesture = async (from, to, steps = 12) => {
    await touch('touchStart', from);
    for (let s = 1; s <= steps; s++) {
      await touch('touchMove', from.map((p, i) => [lerp(p[0], to[i][0], s / steps), lerp(p[1], to[i][1], s / steps)]));
      await sleep(16);
    }
    await touch('touchEnd', []);
    await sleep(200);
  };
  const tap = async (x, y) => {
    await touch('touchStart', [[x, y]]);
    await sleep(40);
    await touch('touchEnd', []);
  };
  const cam = () => g.ev(`({ p: camera.position.toArray(), pitch: camera.rotation.x, yaw: camera.rotation.y })`);
  const moved = (a, b) => Math.hypot(...a.p.map((v, i) => v - b.p[i]));

  let a = await cam();
  await gesture([[195, 560]], [[195, 380]]);
  let b = await cam();
  check('单指上滑：镜头沿地面前进，视角不变', moved(a, b) > 1 && Math.abs(a.yaw - b.yaw) < 1e-6 && Math.abs(a.pitch - b.pitch) < 1e-6 && Math.abs(a.p[1] - b.p[1]) < 1e-6, { move: moved(a, b).toFixed(2) });

  a = b;
  await gesture([[145, 500], [245, 500]], [[85, 500], [305, 500]]);
  b = await cam();
  const fwd = await g.ev(`(() => { const v = camera.getWorldDirection(camera.position.clone()); return v.toArray(); })()`);
  const along = b.p.reduce((s, v, i) => s + (v - a.p[i]) * fwd[i], 0);
  check('双指张开：沿视线推近', along > 0.5 && Math.abs(a.yaw - b.yaw) < 0.05, { along: along.toFixed(2) });

  a = b;
  await gesture([[195, 560]], [[195, 380]]);
  a = await cam();
  const c = [195, 500];
  const rot = (deg) => {
    const r = (deg * Math.PI) / 180;
    return [
      [c[0] - 60 * Math.cos(r), c[1] - 60 * Math.sin(r)],
      [c[0] + 60 * Math.cos(r), c[1] + 60 * Math.sin(r)],
    ];
  };
  await gesture(rot(0), rot(35), 16);
  b = await cam();
  check('双指旋转：转向约 35°', Math.abs(Math.abs(b.yaw - a.yaw) - (35 * Math.PI) / 180) < 0.1, { dYaw: (((b.yaw - a.yaw) * 180) / Math.PI).toFixed(1) });

  a = b;
  await gesture([[145, 560], [245, 560]], [[145, 440], [245, 440]], 14);
  b = await cam();
  check('双指同时上滑：俯仰变平，不转向', b.pitch > a.pitch + 0.2 && Math.abs(b.yaw - a.yaw) < 0.02, { dPitch: (b.pitch - a.pitch).toFixed(3) });

  // 点选：找一只画面中间的地表蚂蚁，故意点偏 12 像素
  // 暂停后蚂蚁不动，屏幕坐标才可靠
  await g.ev(`world.clock.paused = true`);
  await sleep(200);
  const ant = await g.ev(`(() => {
    const all = [];
    for (const a of world.colony.ants) {
      if (a.domain !== 'surface') continue;
      const v = a.pos.clone().project(camera);
      if (v.z > 1) continue;
      all.push({ id: a.id, x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight });
    }
    // 点偏 12 像素后，屏幕上离手指最近的仍须是这只，否则选中邻居也是对的
    const ok = (a) => all.every((b) => b === a || Math.hypot(a.x + 12 - b.x, a.y - b.y) > 16);
    return all.filter((a) => a.x > 60 && a.x < innerWidth - 60 && a.y > 320 && a.y < innerHeight - 120 && ok(a)).slice(0, 4);
  })()`);
  check('画面中有可点的地表蚂蚁', ant.length > 0, ant.length);
  let picked = null;
  await g.ev(`document.getElementById('info').style.visibility = ''`);
  for (const c of ant) {
    const p = await g.ev(`(() => { const v = world.colony.antById(${c.id}).pos.clone().project(camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; })()`);
    await tap(p[0] + 12, p[1]);
    await sleep(600);
    const info = await g.ev(`document.querySelector('#info h2')?.textContent ?? ''`);
    console.log('  点按', c.id, '→', info);
    if (info.includes(`#${c.id}`)) {
      picked = c;
      break;
    }
    await sleep(400);
  }
  check('点按（偏 12 像素）选中蚂蚁', !!picked);
  await g.ev(`document.getElementById('info').style.visibility = 'hidden'`);
  if (picked) {
    const ant = picked;

    await sleep(500);
    const p2 = await g.ev(`(() => { const a = world.colony.antById(${ant.id}); const v = a.pos.clone().project(camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; })()`);
    a = await cam();
    await tap(p2[0], p2[1]);
    await sleep(120);
    await tap(p2[0], p2[1]);
    await sleep(1800);
    b = await cam();
    const dist = await g.ev(`world.colony.antById(${ant.id}).pos.distanceTo(camera.position)`);
    check('双击飞到蚂蚁旁边', moved(a, b) > 1 && dist < 9, { move: moved(a, b).toFixed(1), dist: dist.toFixed(1) });
  }
  await g.ev(`world.clock.paused = false`);

  // 工具：投食，点地面出现“放在这里”，确认后才放下
  await g.ev(`document.querySelector('[data-a="tool"][data-v="0"]').click()`);
  await sleep(300);
  const n0 = await g.ev(`world.food.sources.length`);
  await tap(195, 560);
  await sleep(400);
  const place = await g.ev(`!!document.querySelector('#tool [data-a="toolPlace"]')`);
  const n1 = await g.ev(`world.food.sources.length`);
  check('工具：点地面只选位置，出现“放在这里”', place && n1 === n0, { place, n0, n1 });
  const shot = await g.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/touch-tool.png', Buffer.from(shot.data, 'base64'));
  await g.ev(`document.querySelector('#tool [data-a="toolPlace"]').click()`);
  await sleep(300);
  const n2 = await g.ev(`world.food.sources.length`);
  const gone = await g.ev(`!document.querySelector('#tool [data-a="toolPlace"]')`);
  check('工具：点“放在这里”后放下食物', n2 === n0 + 1 && gone, { n2, toast: await g.ev(`document.getElementById('toast').textContent`) });
  g.close();
} finally {
  chrome.kill();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

// 触屏操作测试：无头 Chrome 开启触屏模拟，用 DevTools 协议派发触摸事件
// 用法：node scripts/ui/touchtest.mjs [网址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const W = 390;
const H = 844;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const browser = await launch(9341);
try {
  const g = await browser.page();
  await g.viewport(W, H, true);
  await g.open(`${process.argv[2] ?? BASE}?new=1&seed=20261021&hour=12&lang=zh`);
  // 收起开局的帮助抽屉，再藏起会挡住手指的面板和浮动事件，让触摸落在画布上
  await g.ev(`hud.setSheet(null); ['colony','info','events','help','stats'].forEach(id => document.getElementById(id).style.visibility = 'hidden')`);
  check('触屏环境被识别为 pointer: coarse', await g.ev(`matchMedia('(pointer: coarse)').matches`));
  check('手机竖屏使用手机布局', await g.ev(`document.body.classList.contains('compact') && !document.body.classList.contains('land')`));

  const touch = g.touch;
  const tap = g.tap;
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

  // 点选：找一只画面中间的地表蚂蚁，故意点偏 12 像素。手势后镜头落在哪里看运气，先换到一只身边 2 cm 内没有同伴的地表蚂蚁斜上方
  await g.ev(`(() => {
    const surf = world.colony.ants.filter((a) => a.domain === 'surface' && !a.climbing);
    const a = surf.find((a) => Math.hypot(a.pos.x, a.pos.z) > 8 && surf.every((b) => b === a || a.pos.distanceTo(b.pos) > 2)) ?? surf[0];
    controller.setPose(a.pos.clone().add({ x: 4, y: 8, z: 8 }), a.pos.clone());
  })()`);
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
  // 工具测试按固定的视角点屏幕：从斜上方看主入口一带的空地
  await g.ev(`(() => {
    if (controller.mode === 'follow') controller.stopFollow();
    const e = world.nest.entrances[0];
    const h = world.terrain.heightAt(e.x, e.z);
    controller.setPose(camera.position.clone().set(e.x + 5, h + 9, e.z + 9), camera.position.clone().set(e.x, h, e.z + 2));
  })()`);
  await sleep(300);

  // 工具：投食，点地面出现“放在这里”，确认后才放下
  await g.ev(`document.querySelector('[data-a="tool"][data-v="0"]').click()`);
  await sleep(300);
  const n0 = await g.ev(`world.food.sources.length`);
  // 换几个点，直到预览圈变绿（能放），镜头落在哪里每次略有不同
  for (const [x, y] of [[195, 500], [140, 460], [250, 460], [140, 560], [250, 560], [195, 420]]) {
    await tap(x, y);
    await sleep(400);
    if (await g.ev(`hud.tools.ringMat.color.getHex() === 0x8be07a`)) break;
  }
  const place = await g.ev(`!!document.querySelector('#tool [data-a="toolPlace"]')`);
  const n1 = await g.ev(`world.food.sources.length`);
  check('工具：点地面只选位置，出现“放在这里”', place && n1 === n0, { place, n0, n1 });
  await g.shot('shots/touch-tool.png');
  await g.ev(`document.querySelector('#tool [data-a="toolPlace"]').click()`);
  await sleep(300);
  const n2 = await g.ev(`world.food.sources.length`);
  const gone = await g.ev(`!document.querySelector('#tool [data-a="toolPlace"]')`);
  check('工具：点“放在这里”后放下食物', n2 === n0 + 1 && gone, { n2, toast: await g.ev(`document.getElementById('toast').textContent`) });
  // 再选一个位置，拖动预览圈（不放下）
  await tap(195, 500);
  await sleep(400);
  const pend = () => g.ev(`hud.tools.pending?.toArray() ?? null`);
  const ring = () => g.ev(`(() => { const v = hud.tools.pending.clone().project(camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; })()`);
  const q0 = await pend();
  a = await cam();
  await gesture([[195, 500]], [[255, 420]]);
  await sleep(100);
  const q1 = await pend();
  const r1 = await ring();
  b = await cam();
  const follows = q0 && q1 && Math.hypot(q1[0] - q0[0], q1[2] - q0[2]) > 0.5 && Math.hypot(r1[0] - 255, r1[1] - 420) < 20;
  check('工具：按住预览圈拖动，预览跟着手指，镜头不动', follows && moved(a, b) < 1e-6, { q0, q1, ring: r1.map((v) => v.toFixed(0)), cam: moved(a, b) });
  a = await cam();
  await gesture([[100, 330]], [[100, 250]]);
  b = await cam();
  const q2 = await pend();
  check('工具：在预览圈外拖动仍是平移镜头', moved(a, b) > 0.5 && q2 && Math.hypot(q2[0] - q1[0], q2[2] - q1[2]) < 1e-6, { cam: moved(a, b).toFixed(2) });
  await g.ev(`document.querySelector('#tool [data-a="toolexit"]').click()`);

  // 手机布局：用触摸点底栏和菜单
  await g.ev(`['colony','info','events','help','stats'].forEach(id => document.getElementById(id).style.visibility = '')`);
  const tapEl = async (sel) => {
    const r = await g.ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await tap(r[0], r[1]);
    await sleep(350);
  };
  const shown = (id) => g.ev(`document.getElementById('${id}').offsetHeight > 0`);
  await tapEl('#dock [data-v="0"]');
  check('点底栏“蚁群”打开蚁群抽屉', (await shown('colony')) && (await g.ev(`hud.sheet`)) === 'colony');
  await tapEl('#dock [data-v="1"]');
  check('再点“视图”换成视图抽屉', (await shown('views')) && !(await shown('colony')));
  a = await cam();
  await tap(195, 300);
  await sleep(400);
  b = await cam();
  check('点画面收起抽屉，不选中、不移动镜头', !(await shown('views')) && (await g.ev(`hud.sheet`)) === null && moved(a, b) < 1e-6);
  await tapEl('[data-a="menu"][data-v="1"]');
  const menuOpen = await g.ev(`!document.querySelectorAll('#topbar .pop')[1].classList.contains('hidden')`);
  await tap(100, 520);
  await sleep(300);
  const menuClosed = await g.ev(`document.querySelectorAll('#topbar .pop')[1].classList.contains('hidden')`);
  check('“更多”菜单点开，点外面关上', menuOpen && menuClosed, { menuOpen, menuClosed });
  await tapEl('[data-a="menu"][data-v="0"]');
  await tapEl('#topbar .pop [data-a="speed"][data-v="5"]');
  check('倍速菜单选 5×，菜单关上，按钮显示 5×', (await g.ev(`world.clock.speed`)) === 5 && (await g.ev(`document.getElementById('btn-speedmenu').textContent`)) === '5×' && (await g.ev(`document.querySelectorAll('#topbar .pop')[0].classList.contains('hidden')`)));
  await g.viewport(H, W, true);
  await sleep(800);
  const land = await g.ev(`(() => { const r = document.getElementById('dock').getBoundingClientRect(); return { land: document.body.classList.contains('land'), w: r.width, h: r.height }; })()`);
  check('转成横屏：底栏改到左侧竖排', land.land && land.h > land.w * 3, land);
  await g.viewport(W, H, true);
  await sleep(800);
  check('转回竖屏', !(await g.ev(`document.body.classList.contains('land')`)));
  g.close();

  // 手机浏览器：后台运行开关只给说明，回来时提示页面被冻结了多久
  const m = await browser.page();
  await m.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await m.viewport(W, H, true);
  await m.open(`${process.argv[2] ?? BASE}?new=1&seed=20261021&hour=12&lang=zh`);
  await m.ev(`hud.setSheet(null)`);
  const bg = () => m.ev(`(() => { const b = document.getElementById('btn-background'); return { limited: b.classList.contains('limited'), on: b.classList.contains('on'), enabled: hud.state.background }; })()`);
  const bg0 = await bg();
  await m.ev(`document.querySelector('[data-a="menu"][data-v="0"]').click()`);
  await sleep(200);
  await m.ev(`document.getElementById('btn-background').click()`);
  await sleep(200);
  const bg1 = await bg();
  const toast = await m.ev(`document.getElementById('toast').textContent`);
  check('手机浏览器：后台运行按钮标为受限，点按只弹说明、不切换', bg0.limited && !bg0.on && !bg1.on && bg1.enabled === bg0.enabled && toast.includes('冻结'), { bg0, bg1, toast });
  const frozen = await m.ev(`(() => {
    const now = Date.now;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = () => now() + 3 * 60000;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = now;
    return document.getElementById('toast').textContent;
  })()`);
  check('手机浏览器：离开 3 分钟回来，提示页面被冻结', frozen.includes('3 分钟'), frozen);
  m.close();
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

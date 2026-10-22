// 画质与帧率测试：默认档位、暂停后降帧、省电、持续卡顿自动降档、手动选择记住
// 用法：node scripts/qualitytest.mjs [网址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const URL = `${process.argv[2] ?? BASE}?new=1&seed=20261021&hour=12&lang=zh`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const browser = await launch(9343);
try {
  const g = await browser.page();
  await g.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 3, mobile: false });
  await g.open(URL);
  const state = () => g.ev(`({ mode: quality.mode, level: quality.level, pr: renderer.getPixelRatio(), shadow: world && quality['sun'].shadow.mapSize.x })`);
  /** 两秒内实际画了多少帧 */
  const rate = async () => {
    const f0 = await g.ev(`renderer.info.render.frame`);
    await sleep(2000);
    return ((await g.ev(`renderer.info.render.frame`)) - f0) / 2;
  };
  let s = await state();
  check('桌面默认“自动”，从高档开始：像素比 2、阴影 2048', s.mode === 'auto' && s.level === 0 && s.pr === 2 && s.shadow === 2048, s);
  const run = await rate();
  check('运行中按满帧画', run > 45, { fps: run });

  await g.ev(`world.clock.paused = true`);
  await sleep(2500);
  const idle = await rate();
  const perfText = await g.ev(`document.getElementById('perf').textContent`);
  check('暂停 2 秒没有操作，帧率降到约 15，性能数字后注明', idle > 10 && idle < 20 && perfText.includes('省电'), { fps: idle, perfText });
  const wiggle = (async () => {
    for (let i = 0; i < 40; i++) {
      await g.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600 + (i % 2) * 20, y: 400 });
      await sleep(50);
    }
  })();
  const awake = await rate();
  await wiggle;
  check('暂停时有操作，恢复满帧', awake > 45, { fps: awake });
  await g.ev(`world.clock.paused = false`);

  await g.ev(`document.getElementById('btn-quality').click()`);
  s = await state();
  check('点画质按钮：自动 → 高，并记住', s.mode === 'high' && (await g.ev(`localStorage.getItem('cyber-ant-quality')`)) === 'high', { ...s, label: await g.ev(`document.getElementById('btn-quality').textContent`) });
  for (let i = 0; i < 3; i++) await g.ev(`document.getElementById('btn-quality').click()`);
  s = await state();
  const saver = await rate();
  check('再点三下到“省电”：低档、每秒约 30 帧', s.mode === 'saver' && s.pr === 1 && s.shadow === 1024 && saver > 25 && saver < 35, { ...s, fps: saver });
  await g.open(URL);
  s = await state();
  check('刷新后仍是“省电”', s.mode === 'saver' && s.level === 2, s);

  await g.ev(`quality.setMode('auto')`);
  // 每帧在主线程上空转 30 ms，帧率掉到 30 以下
  await g.ev(`(() => { const slow = () => { const t = performance.now(); while (performance.now() - t < 30); requestAnimationFrame(slow); }; requestAnimationFrame(slow); })()`);
  let dropped = null;
  for (let i = 0; i < 30 && !dropped; i++) {
    await sleep(500);
    const lv = await g.ev(`quality.level`);
    if (lv > 0) dropped = { level: lv, after: (i + 1) / 2, toast: await g.ev(`document.getElementById('toast').textContent`) };
  }
  check('“自动”下持续卡顿约 6 秒后降一档，并提示', dropped?.level === 1 && dropped.after >= 5 && dropped.toast.includes('降到'), dropped);
  await sleep(8000);
  s = await state();
  check('继续卡就降到低档，不再往下', s.level === 2 && s.pr === 1, s);
  g.close();

  const m = await browser.page();
  await m.send('Emulation.setUserAgentOverride', { userAgent: IPHONE });
  await m.viewport(390, 844, true);
  await m.open(URL);
  await m.ev(`localStorage.removeItem('cyber-ant-quality')`);
  await m.open(URL);
  const ms = await m.ev(`({ mode: quality.mode, level: quality.level, pr: renderer.getPixelRatio(), label: document.getElementById('quality-label').textContent })`);
  check('手机默认“自动”，从中档开始：像素比 1.5，菜单里显示“自动（中）”', ms.mode === 'auto' && ms.level === 1 && ms.pr === 1.5 && ms.label.includes('自动（中）'), ms);
  await m.ev(`hud.setSheet(null); document.querySelector('[data-a="menu"][data-v="1"]').click()`);
  await sleep(300);
  await m.shot('shots/quality-menu.png');
  await m.ev(`document.querySelector('#quality-opts [data-v="4"]').click()`);
  const ms2 = await m.ev(`({ mode: quality.mode, closed: document.querySelectorAll('#topbar .pop')[1].classList.contains('hidden') })`);
  check('手机“更多”菜单里选“省电”，菜单关上', ms2.mode === 'saver' && ms2.closed, ms2);
  m.close();
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

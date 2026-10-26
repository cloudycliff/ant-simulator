// 亮度设置测试：桌面下拉菜单里拖动滑块、白天和夜里分开起作用、画面真的变亮、记在本地、恢复默认、手机“更多”菜单
// 用法：node scripts/ui/brighttest.mjs [地址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const url = (hour) => `${process.argv[2] ?? BASE}?new=1&seed=20261021&hour=${hour}&lang=zh`;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

const browser = await launch(9349);
try {
  const g = await browser.page();
  await g.viewport(1280, 800, false);
  const mouse = (type, x, y) => g.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  const center = (sel) => g.ev(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2, b.width]; })()`);
  const click = async (sel) => {
    const [x, y] = await center(sel);
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
    await sleep(200);
  };
  const state = () =>
    g.ev(`({ day: brightness.day, night: brightness.night, exposure: +renderer.toneMappingExposure.toFixed(3), saved: localStorage.getItem('cyber-brightness'),
      open: !document.getElementById('bright-menu')?.classList.contains('hidden'),
      out: [...document.querySelectorAll('.bright output')].map((o) => o.textContent).join(' / '),
      now: document.querySelector('.bright .slider.now')?.id ?? null })`);
  /** 下一帧画完后读回像素，返回平均亮度 0..255 */
  const luma = () =>
    g.ev(`new Promise((done) => {
      const orig = renderer.render;
      renderer.render = function (s, c) {
        orig.call(this, s, c);
        renderer.render = orig;
        const gl = renderer.getContext();
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sum = 0, n = 0;
        for (let i = 0; i < px.length; i += 4 * 97) { sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++; }
        done(+(sum / n).toFixed(1));
      };
    })`);

  await g.open(url(12));
  await g.ev(`world.clock.paused = true`);
  let s = await state();
  check('默认两档都是 100%，曝光不变', s.day === 1 && s.night === 1 && near(s.exposure, 1.05) && s.saved === null, s);
  const noon = await luma();

  await click('#btn-bright');
  s = await state();
  check('点“亮度”打开下拉菜单，正午时圆点在白天', s.open && s.out === '100% / 100%' && s.now === 'bright-day', s);
  await g.shot('shots/bright-menu.png');
  const [x, y, w] = await center('#bright-day input');
  await mouse('mousePressed', x, y);
  for (let i = 1; i <= 10; i++) {
    await mouse('mouseMoved', x + (w / 2 + 20) * (i / 10), y);
    await sleep(20);
  }
  await mouse('mouseReleased', x + w / 2 + 20, y);
  await sleep(300);
  s = await state();
  check('把白天拖到最右：250%，曝光跟着变，记住', s.day === 2.5 && s.night === 1 && near(s.exposure, 1.05 * 2.5) && s.open && s.out.startsWith('250%') && JSON.parse(s.saved).day === 2.5, s);
  const bright = await luma();
  check('画面明显变亮', bright > noon * 1.3, { noon, bright });
  await mouse('mousePressed', 640, 500);
  await mouse('mouseReleased', 640, 500);
  await sleep(200);
  check('点画面收起菜单', !(await state()).open);

  await g.open(url(0));
  await g.ev(`world.clock.paused = true`);
  s = await state();
  check('刷新后记得；深夜只用夜里那档', s.day === 2.5 && s.night === 1 && near(s.exposure, 1.05) && s.now === 'bright-night', s);
  const night = await luma();
  await g.ev(`(() => { const el = document.querySelector('#bright-night input'); el.value = 2; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const nightBright = await luma();
  s = await state();
  check('夜里调到 200%：曝光翻倍，画面变亮', s.night === 2 && near(s.exposure, 2.1) && nightBright > night * 1.4, { ...s, luma: [night, nightBright] });
  await g.ev(`world.clock.seconds += world.clock.dayLength * 0.25`);
  await sleep(300);
  s = await state();
  check('到了早上 6 点：在两档之间', s.exposure > 1.05 * 2 && s.exposure < 1.05 * 2.5, { ...s, daylight: await g.ev(`world.clock.daylight`) });

  await click('#btn-bright');
  await click('#bright-menu [data-a="brightReset"]');
  s = await state();
  check('恢复默认', s.day === 1 && s.night === 1 && s.out === '100% / 100%' && s.open, s);
  g.close();

  const m = await browser.page();
  await m.viewport(390, 844, true);
  await m.open(url(12));
  await m.ev(`hud.setSheet(null); document.querySelector('[data-a="menu"][data-v="1"]').click()`);
  await sleep(300);
  await m.ev(`(() => { const el = document.querySelector('#bright-day input'); el.value = 1.5; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await m.shot('shots/bright-phone.png');
  const ms = await m.ev(`({ day: brightness.day, out: document.querySelector('#bright-day output').textContent, open: !document.querySelectorAll('#topbar .pop')[1].classList.contains('hidden') })`);
  check('手机“更多”菜单里也能调，菜单不收起', ms.day === 1.5 && ms.out === '150%' && ms.open, ms);
  await m.ev(`document.querySelector('.pop [data-a="brightReset"]').click()`);
  await sleep(200);
  const ms2 = await m.ev(`({ day: brightness.day, open: !document.querySelectorAll('#topbar .pop')[1].classList.contains('hidden') })`);
  check('手机上点恢复默认，菜单也不收起', ms2.day === 1 && ms2.open, ms2);
  m.close();
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

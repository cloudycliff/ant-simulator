// 背景音乐测试：第一次点击后才出声、按 M 和点按钮开关、关掉后淡出静音、开关记在本地
// 用法：node scripts/ui/musictest.mjs [地址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const URL = `${process.argv[2] ?? BASE}?new=1&seed=20261021&hour=12&lang=zh`;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const browser = await launch(9347);
try {
  const g = await browser.page();
  await g.viewport(1280, 800, false);
  const click = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await g.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  const clickButton = async () => {
    const r = await g.ev(`(() => { const b = document.getElementById('btn-music').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    await click(r[0], r[1]);
  };
  const pressM = async () => {
    for (const type of ['keyDown', 'keyUp']) await g.send('Input.dispatchKeyEvent', { type, code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 });
    await sleep(100);
  };
  const state = () =>
    g.ev(`({ enabled: music.enabled, ctx: music.ctx?.state ?? null, playing: music.playing, on: document.getElementById('btn-music').classList.contains('on'), saved: localStorage.getItem('cyber-music'), toast: document.getElementById('toast').textContent })`);
  /** 接一个分析器在总音量后面，听 ms 毫秒，返回峰值和均方根 */
  const listen = (ms) =>
    g.ev(`new Promise((done) => {
      const an = music.ctx.createAnalyser();
      an.fftSize = 2048;
      music.master.connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0, sum = 0, n = 0;
      const id = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; }
      }, 40);
      setTimeout(() => { clearInterval(id); music.master.disconnect(an); done({ peak: +peak.toFixed(4), rms: +Math.sqrt(sum / n).toFixed(4) }); }, ${ms});
    })`);

  await g.open(URL);
  let s = await state();
  check('默认开着，但点击之前不出声', s.enabled && s.on && s.ctx === null && s.saved === null, s);
  await click(640, 500);
  await sleep(2500);
  s = await state();
  check('第一次点击后开始播放', s.playing && s.ctx === 'running', s);
  const loud = await listen(6000);
  check('听得到，也不过载', loud.rms > 0.003 && loud.peak < 0.9, loud);

  await pressM();
  s = await state();
  check('按 M 关掉：按钮熄灭、提示、记住', !s.enabled && !s.on && !s.playing && s.saved === '0' && s.toast.includes('背景音乐：关'), s);
  await sleep(2500);
  const quiet = await listen(1500);
  check('淡出后静音', quiet.peak < 1e-4, quiet);

  await g.open(URL);
  await click(640, 500);
  await sleep(500);
  s = await state();
  check('刷新后仍是关的，点击也不出声', !s.enabled && !s.on && s.ctx === null, s);
  await clickButton();
  await sleep(2500);
  s = await state();
  check('点音乐按钮打开并开始播放', s.enabled && s.on && s.playing && s.saved === '1' && s.toast.includes('背景音乐：开'), s);
  const again = await listen(3000);
  check('重新打开后有声音', again.rms > 0.003, again);

  await g.ev(`localStorage.removeItem('cyber-music')`);
  await g.open(URL);
  await clickButton();
  await sleep(500);
  s = await state();
  check('默认开着时第一下就点音乐按钮是关掉，不会先响一下', !s.enabled && !s.on && s.ctx === null, s);
  g.close();
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

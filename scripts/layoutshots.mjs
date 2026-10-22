// 各种屏幕下的界面截图：手机 / 平板 / 桌面，横屏竖屏，几个典型场景
// 用法：node scripts/layoutshots.mjs [视口名或场景名的子串，可多个] [--en]；图片在 shots/layout/
import { mkdirSync } from 'node:fs';
import { BASE, launch, sleep } from './cdp.mjs';

const VIEWPORTS = [
  ['phone', 390, 844, true],
  ['phone-land', 844, 390, true],
  ['phone-small', 360, 640, true],
  ['pad', 820, 1180, true],
  ['pad-land', 1180, 820, true],
  ['pad-mini', 768, 1024, true],
  ['desktop', 1280, 800, false],
];
const EN = process.argv.includes('--en');
const Q = `?new=1&seed=20261021&hour=12&lang=${EN ? 'en' : 'zh'}`;
const click = (sel) => async (p) => {
  await p.ev(`document.querySelector('${sel}')?.click()`);
  await sleep(400);
};
const SCENES = {
  home: { q: '' },
  ant: { q: '&select=ant:1&fly=1' },
  colony: { q: '', run: click('#dock [data-v="0"]') },
  views: { q: '', run: click('#dock [data-v="1"]') },
  events: { q: '&skip=300', run: click('#dock [data-v="3"]') },
  more: { q: '', run: click('[data-a="menu"][data-v="1"]') },
  speed: { q: '', run: click('[data-a="menu"][data-v="0"]') },
  stats: { q: '&view=stats' },
  tool: {
    q: '',
    run: async (p, w, h) => {
      await p.ev(`document.querySelector('[data-a="tool"][data-v="0"]').click()`);
      await sleep(300);
      await p.tap(w / 2, h * 0.45);
      await sleep(400);
    },
  },
};

const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const want = (name) => !filters.length || filters.some((f) => name.includes(f));
mkdirSync('shots/layout', { recursive: true });
const b = await launch(9343);
try {
  for (const [vp, w, h, touch] of VIEWPORTS) {
    for (const [scene, s] of Object.entries(SCENES)) {
      const name = `${vp}-${scene}${EN ? '-en' : ''}`;
      if (!want(name)) continue;
      const p = await b.page();
      await p.viewport(w, h, touch);
      await p.open(BASE + Q + s.q);
      await s.run?.(p, w, h);
      await sleep(600);
      await p.shot(`shots/layout/${name}.png`);
      const over = await p.ev(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('body > *:not(#app):not(#loading)')) {
          const r = el.getBoundingClientRect();
          if (!r.width || getComputedStyle(el).display === 'none' || getComputedStyle(el).opacity === '0') continue;
          if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(el.id + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
        }
        // 顶栏里被挤出去的按钮（顶栏本身不会超出屏幕，里面的东西会）
        const bar = document.getElementById('topbar').getBoundingClientRect();
        for (const el of document.querySelectorAll('#topbar .tb-row > * button, #topbar .tb-row > button, #topbar .tb-row > * > a')) {
          const r = el.getBoundingClientRect();
          if (r.width && !el.closest('.pop') && r.right > bar.right + 1) out.push('顶栏 ' + (el.id || el.textContent.trim().slice(0, 12)));
        }
        return out;
      })()`);
      console.log(name, over.length ? '超出屏幕：' + over.join(' | ') : '');
      p.close();
    }
  }
} finally {
  b.close();
}

// 鱼缸示例的界面截图和几项浏览器里的检查：点选、喂食工具、手机抽屉
// 用法：node scripts/games/aquarium/aquashots.mjs [场景名的子串，可多个]；图片在 shots/aquarium/
import { mkdirSync } from 'node:fs';
import { BASE, launch, sleep } from '../../ui/cdp.mjs';

const VIEWPORTS = [
  ['desktop', 1280, 800, false],
  ['phone', 390, 844, true],
];
const Q = 'aquarium.html?new=1&seed=7';
const click = async (p, x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const SCENES = {
  home: { q: '&hour=12' },
  night: { q: '&hour=22.5' },
  fish: { q: '&hour=12&select=fish:3&fly=1', check: `document.querySelector('#info h2')?.textContent ?? ''` },
  hunger: { q: '&hour=12&view=hunger' },
  stats: { q: '&hour=12&skip=1200&view=stats' },
  en: { q: '&hour=12&lang=en' },
  feed: {
    q: '&hour=12',
    run: async (p, w, h, touch) => {
      await p.ev(`document.querySelector('[data-a="tool"][data-v="0"]').click()`);
      await sleep(300);
      if (touch) {
        await p.tap(w / 2, h * 0.5);
        await sleep(300);
        await p.ev(`document.querySelector('#tool [data-a="toolPlace"]')?.click()`);
      } else await click(p, w / 2, h * 0.4);
      await sleep(1500);
    },
    check: `'喂了 ' + window.world.stats.feeds + ' 次，水里 ' + window.world.food.length + ' 片，吃掉 ' + window.world.stats.eaten + ' 片'`,
  },
  panel: { q: '&hour=12', touchOnly: true, run: (p) => p.ev(`document.querySelector('#dock [data-v="0"]')?.click()`) },
};

const filters = process.argv.slice(2);
const want = (name) => !filters.length || filters.some((f) => name.includes(f));
mkdirSync('shots/aquarium', { recursive: true });
const b = await launch(9344);
try {
  for (const [vp, w, h, touch] of VIEWPORTS) {
    for (const [scene, s] of Object.entries(SCENES)) {
      const name = `${vp}-${scene}`;
      if (!want(name) || (s.touchOnly && !touch)) continue;
      const p = await b.page();
      await p.viewport(w, h, touch);
      await p.open(BASE + Q + s.q);
      await s.run?.(p, w, h, touch);
      await sleep(800);
      await p.shot(`shots/aquarium/${name}.png`);
      console.log(name, s.check ? await p.ev(s.check) : '');
      p.close();
    }
  }
} finally {
  b.close();
}

// 蜜蜂的界面截图：node scripts/games/bee/beeshots.mjs [场景名的子串，可多个]；图片在 shots/bee/
import { mkdirSync } from 'node:fs';
import { BASE, launch, sleep } from '../../ui/cdp.mjs';

const VIEWPORTS = [
  ['desktop', 1280, 800, false],
  ['phone', 390, 844, true],
];
const Q = 'bee.html?new=1&seed=7';
const PERF = `document.getElementById('perf')?.textContent ?? ''`;
const SCENES = {
  home: { q: '&hour=11' },
  night: { q: '&hour=22.5' },
  dusk: { q: '&hour=18.6' },
  hive: { q: '&hour=11&select=hive:0&fly=1', check: `document.querySelector('#info h2')?.textContent ?? ''` },
  close: { q: '&hour=11&cam=6,100,12,2,98,0' },
  garden: { q: '&hour=12&cam=0,400,900,0,40,-200' },
  comb: { q: '&hour=11&cam=0,103,58,0,103,0' },
  back: { q: '&hour=11&cam=0,103,-58,0,103,0' },
  near: { q: '&hour=11&cam=0,107,9,0,107,0' },
  side: { q: '&hour=11&cam=-7,106,3.5,5,106,0' },
  cell: { q: '&hour=11&select=cell:4542&fly=1', check: `document.querySelector('#info')?.innerText.replace(/\\s+/g, ' ') ?? ''` },
  honey: { q: '&hour=11&cam=-1,119,10,-1,119,0' },
  en: { q: '&hour=11&lang=en' },
};

const filters = process.argv.slice(2);
const want = (name) => !filters.length || filters.some((f) => name.includes(f));
mkdirSync('shots/bee', { recursive: true });
const b = await launch(9346);
try {
  for (const [vp, w, h, touch] of VIEWPORTS) {
    for (const [scene, s] of Object.entries(SCENES)) {
      const name = `${vp}-${scene}`;
      if (!want(name)) continue;
      const p = await b.page();
      await p.viewport(w, h, touch);
      await p.open(BASE + Q + s.q);
      await sleep(1200);
      await p.shot(`shots/bee/${name}.png`);
      console.log(name, await p.ev(PERF), s.check ? await p.ev(s.check) : '');
      p.close();
    }
  }
} finally {
  b.close();
}

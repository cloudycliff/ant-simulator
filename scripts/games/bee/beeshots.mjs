// 蜜蜂的界面截图：node scripts/games/bee/beeshots.mjs [场景名的子串，可多个]；图片在 shots/bee/
import { mkdirSync } from 'node:fs';
import { BASE, launch, sleep } from '../../ui/cdp.mjs';

const VIEWPORTS = [
  ['desktop', 1280, 800, false],
  ['phone', 390, 844, true],
];
const Q = 'bee.html?new=1&seed=7';
const PERF = `document.getElementById('perf')?.textContent ?? ''`;
const INFO = `document.querySelector('#info')?.innerText.replace(/\\s+/g, ' ') ?? ''`;
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
  flowers: { q: '&hour=8&cam=-300,250,-300,400,20,350' },
  sunflower: { q: '&hour=11&select=flower:2&fly=1', check: INFO },
  pumpkin: { q: '&hour=8&select=flower:7&fly=1', check: INFO },
  pumpkinpm: { q: '&hour=14&select=flower:7&fly=1' },
  lavender: { q: '&hour=11&select=flower:4&fly=1' },
  corn: { q: '&hour=9&select=flower:5&fly=1' },
  clover: { q: '&hour=11&cam=845,60,1700,845,0,1941' },
  bees: { q: '&hour=11&cam=0,103,40,0,100,0' },
  beesnear: { q: '&hour=11&cam=-2,96,6,-2,95,0' },
  fade: { q: '&hour=11&cam=0,103,40,0,100,0&view=fade' },
  queen: { q: '&hour=11&select=bee:1&fly=1', check: INFO },
  follow: { q: '&hour=11&select=bee:200&follow=1', check: INFO },
  edge: { q: '&hour=11&cam=-35,100,8,-15,96,0' },
  entrance: { q: '&hour=11&run=30&cam=-48,92,22,-28,84,0' },
  flying: { q: '&hour=11&run=30&select=bee:164&follow=1', check: INFO },
  onflower: { q: '&hour=11&run=30&select=bee:924&follow=1', check: INFO },
  outside: { q: '&hour=11&run=30&cam=-150,160,120,-30,100,0' },
  farbees: { q: '&hour=11&run=30&cam=0,400,900,0,40,-200' },
  dance: { q: '&hour=11&run=120&cam=-15,101,9,-15,101,0&view=dance' },
  danceback: { q: '&hour=11&run=120&cam=-15,101,-9,-15,101,0&view=dance' },
  dancer: { q: '&hour=11&run=120&select=bee:262&fly=1&view=dance', check: INFO },
  dancegarden: { q: '&hour=11&run=120&cam=0,2800,400,0,0,0&view=dance' },
  en: { q: '&hour=11&lang=en' },
  endancer: { q: '&hour=11&run=120&select=bee:262&fly=1&lang=en', check: INFO },
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

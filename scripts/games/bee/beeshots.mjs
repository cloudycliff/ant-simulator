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
const PLANT = `world.plant(3, 400, 0); world.feed(0, 400)`;
const RUN = (s) => `for (let i = 0; i < ${s}; i++) world.advance(1, Infinity, Infinity)`;
const SCENES = {
  home: { q: '&hour=11' },
  night: { q: '&hour=22.5' },
  dusk: { q: '&hour=18.6' },
  rain: { q: '&hour=14&rain=1&run=20', check: `document.getElementById('temp')?.textContent ?? ''` },
  raingarden: { q: '&hour=14&rain=1&run=20&cam=0,400,900,0,40,-200' },
  rainnear: { q: '&hour=14&rain=1&run=20&cam=10,100,40,0,100,0' },
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
  // 工具：在蜂箱东边 4 m 种一片薰衣草、南边 4 m 放一碟糖水（七号世界那里是空地），js 在页面打开后执行
  planting: { q: '&hour=11&cam=150,260,-250,300,0,150', js: `${PLANT}; ${RUN(150)}` },
  planted: { q: '&hour=11&cam=150,260,-250,300,0,150', js: `${PLANT}; ${RUN(330 + 345)}` },
  sugar: { q: '&hour=11&cam=-30,90,330,0,45,400', js: `${PLANT}; ${RUN(60)}` },
  tool: { q: '&hour=11&cam=450,280,-750,700,0,-300', keys: ['Digit6', 'Digit6', 'Digit6', 'Digit6'], mouse: [640, 400] },
  // 视图：分工着色、巢房着色（加淡化蜂看整框的内容）、贴近时的实例网格
  roles: { q: '&hour=11&run=30&cam=0,103,40,0,100,0&view=roles' },
  rolesout: { q: '&hour=11&run=30&cam=-150,160,120,-30,100,0&view=roles' },
  cells: { q: '&hour=11&cam=0,103,58,0,103,0&view=cells,fade' },
  cellsnear: { q: '&hour=11&cam=0,107,9,0,107,0&view=cells' },
  both: { q: '&hour=11&cam=0,103,40,0,100,0&view=cells,roles' },
  heat: { q: '&hour=4&run=30&cam=0,103,58,0,103,0&view=heat' },
  heatback: { q: '&hour=15&run=30&cam=0,103,-58,0,103,0&view=heat,fade' },
  heatcell: { q: '&hour=4&run=60&select=cell:3900', check: INFO },
  hornet: { q: '&hour=14&hornet=2&run=20&cam=-75,100,55,-45,88,0' },
  hornetnear: { q: '&hour=14&hornet=1&run=20&select=hornet:1&follow=1', check: INFO },
  // 电蚊拍：暂停，选工具，点胡蜂在画面上的位置
  swat: {
    q: '&hour=14&hornet=1&run=20&cam=-75,100,55,-45,88,0',
    js: `world.clock.paused = true; const h = world.hornets.list[0]; h.left = 1e9; const v = new camera.position.constructor(h.pos.x, h.pos.y, h.pos.z).project(camera); window.__swat = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]`,
    keys: ['Digit8'],
    clickAt: '__swat',
    check: `world.hornets.list.map((h) => h.state).join(' ') + ' 拍死 ' + world.hornets.swatted`,
  },
  ball: { q: '&hour=14&hornet=1&run=15&cam=-40,89,12,-31.5,82.4,0', js: `world.hornets.list[0].left = 1e9; world.hornets.list[0].state = 'land'; ${RUN(20)}` },
  ballinfo: { q: '&hour=14&hornet=1&run=15&select=hornet:1', js: `world.hornets.list[0].left = 1e9; world.hornets.list[0].state = 'land'; ${RUN(20)}`, check: INFO },
  plate: { q: '&hour=14&hornet=1&plate=1&run=20&cam=-42,88,10,-30,82,0' },
  hiveplate: { q: '&hour=11&plate=1&select=hive:0', check: INFO },
  // 割蜜、换框（T-023）：选中一个封盖蜜的巢房点“割下这一块”；蜂箱面板里换上框先问一句
  harvestinfo: { q: '&hour=11&select=cell:7539&fly=1', check: INFO },
  harvest: { q: '&hour=11&select=cell:7539&cam=-2,121,22,-2,121,0', click: ['#info [data-a="harvest"]'], check: `world.keeper.harvests + ' 次 ' + Math.round(world.keeper.harvested) + ' 房'` },
  harvested: { q: '&hour=11&cam=-2,121,22,-2,121,0', js: `world.harvest(7539); ${RUN(240)}` },
  swapask: { q: '&hour=11&select=hive:0', click: ['#info [data-a="swapAsk"][data-v="1"]'], check: INFO },
  swapped: { q: '&hour=11&cam=0,103,58,0,103,0', js: `world.swapFrame(1); ${RUN(5)}`, check: `world.keeper.swaps + ' 次，拿走子 ' + world.keeper.lostBrood` },
  swapgrow: { q: '&hour=11&cam=0,103,58,0,103,0', js: `world.swapFrame(1); ${RUN(600)}` },
  // 手机的抽屉：点底栏的按钮打开（只拍手机）
  sheetcolony: { q: '&hour=11&run=120', phone: true, click: ['#dock [data-v="0"]'] },
  sheetviews: { q: '&hour=11', phone: true, click: ['#dock [data-v="1"]'] },
  sheettools: { q: '&hour=11', phone: true, click: ['#dock [data-v="2"]'] },
  sheetevents: { q: '&hour=11', phone: true, js: `${PLANT}; ${RUN(60)}`, click: ['#dock [data-v="3"]'] },
  ensheet: { q: '&hour=11&run=120&lang=en', phone: true, click: ['#dock [data-v="0"]'] },
  en: { q: '&hour=11&lang=en' },
  encolony: { q: '&hour=11&run=120&lang=en' },
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
      if (!want(name) || (s.phone && !touch)) continue;
      const p = await b.page();
      await p.viewport(w, h, touch);
      await p.open(BASE + Q + s.q);
      if (s.js) await p.ev(s.js);
      for (const sel of s.click ?? []) await p.ev(`document.querySelector('${sel}').click()`);
      for (const code of s.keys ?? []) {
        await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.slice(-1) });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.slice(-1) });
      }
      if (s.clickAt) {
        const [x, y] = await p.ev(`window.${s.clickAt}`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
      if (s.mouse) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.mouse[0], y: s.mouse[1] });
      await sleep(1200);
      await p.shot(`shots/bee/${name}.png`);
      console.log(name, await p.ev(PERF), s.check ? await p.ev(s.check) : '');
      p.close();
    }
  }
} finally {
  b.close();
}

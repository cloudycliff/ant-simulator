// 添加到主屏幕与离线测试：先 npm run build，再 node scripts/ui/pwatest.mjs
// 自带一个静态服务器提供 dist/，测完安装条件和离线缓存后关掉服务器再刷新，看断网时能否打开
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const PORT = 4180;
const ROOT = resolve('dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? TYPES['.html'] });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const browser = await launch(9347);
try {
  const g = await browser.page();
  await g.viewport(1280, 800, false);
  await g.open(`${BASE}?seed=20261021&lang=zh`);
  const manifest = await g.ev(`fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json())`);
  const icons = await g.ev(`Promise.all(${JSON.stringify(manifest.icons.map((i) => i.src))}.map((s) => fetch(s).then((r) => r.status + ' ' + r.headers.get('content-type'))))`);
  check('清单和图标都能取到', manifest.display === 'standalone' && icons.every((s) => s.startsWith('200 image/png')), { icons });
  check('网页小图标内联在 HTML 里', (await g.ev(`document.querySelector('link[rel=icon]').href`)).startsWith('data:image/svg+xml'));
  const sw = await g.ev(`navigator.serviceWorker.ready.then((r) => r.active?.scriptURL ?? '')`);
  check('离线缓存脚本已注册并启用', sw.endsWith('/sw.js'), sw);
  const errs = await g.send('Page.getInstallabilityErrors');
  check('Chrome 认为可以安装（没有安装条件错误）', Array.isArray(errs.installabilityErrors) && errs.installabilityErrors.length === 0, errs.installabilityErrors);
  check('电脑上不显示“添加到主屏幕”', await g.ev(`document.getElementById('btn-install').classList.contains('hidden')`));
  await g.ev(`hud.toast('x'); localStorage.setItem('pwatest', '1')`);
  await sleep(1500);
  const cached = await g.ev(`caches.open('cyber-ant-v2').then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname))`);
  check('页面和图标已存进缓存', cached.includes('/') && cached.includes('/icon-512.png'), cached);

  const aq = await browser.page();
  await aq.viewport(1280, 800, false);
  await aq.open(`${BASE}aquarium.html?new=1&lang=zh`);
  const aqState = await aq.ev(`({ fish: window.world?.fish?.length ?? 0, controlled: !!navigator.serviceWorker.controller })`);
  await sleep(500);
  const rootIsAnt = await aq.ev(`caches.open('cyber-ant-v2').then((c) => c.match('/')).then((r) => r.text()).then((t) => t.includes('manifest.webmanifest'))`);
  check('同一网址下的鱼缸页照常打开，不会顶掉蚂蚁游戏的离线缓存', aqState.fish > 0 && rootIsAnt, { ...aqState, rootIsAnt });
  aq.close();

  const m = await browser.page();
  await m.send('Emulation.setUserAgentOverride', { userAgent: IPHONE });
  await m.viewport(390, 844, true);
  await m.open(`${BASE}?new=1&seed=20261021&lang=zh`);
  await m.ev(`hud.setSheet(null); document.querySelector('[data-a="menu"][data-v="1"]').click()`);
  await sleep(300);
  const shown = await m.ev(`!document.getElementById('btn-install').classList.contains('hidden')`);
  await m.shot('shots/pwa-menu.png');
  await m.ev(`document.getElementById('btn-install').click()`);
  await sleep(200);
  const toast = await m.ev(`document.getElementById('toast').textContent`);
  check('iPhone：“更多”菜单里有“添加到主屏幕”，点了提示从分享菜单添加', shown && toast.includes('分享'), toast);
  m.close();

  const closed = new Promise((r) => server.close(r));
  server.closeAllConnections();
  await closed;
  // 开局要等 requestAnimationFrame，被手机页面盖住的标签页不会触发
  await g.send('Page.bringToFront');
  await g.open(`${BASE}?new=1&seed=20261021&lang=zh`);
  const offline = await g.ev(`!!window.world && world.colony.ants.length`);
  check('服务器关掉后刷新（带不同的网址参数），从缓存打开，游戏照常运行', offline > 0, offline > 0 ? { ants: offline } : await g.ev(`location.href + ' | hidden ' + document.hidden + ' | ' + document.body?.innerText.slice(0, 200)`));
  g.close();

  const f = await browser.page();
  await f.viewport(1280, 800, false);
  await f.open(`${pathToFileURL(resolve('cyber-ant-farm.html')).href}?new=1&lang=zh`);
  const local = await f.ev(`({ ants: world.colony.ants.length, sw: !!navigator.serviceWorker?.controller })`);
  check('双击打开的单文件照常运行，不注册离线缓存', local.ants > 0 && !local.sw, local);
  f.close();
} finally {
  browser.close();
  server.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);

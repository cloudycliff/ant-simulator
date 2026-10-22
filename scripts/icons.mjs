// 从 src/assets/icon.svg 生成主屏幕图标到 public/。改了图标后运行：node scripts/icons.mjs
import { readFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const svg = readFileSync('src/assets/icon.svg', 'utf8');
const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
// round：普通图标自带圆角；maskable 和 iOS 的图标由系统裁切，要铺满
const ICONS = [
  { file: 'public/icon-192.png', size: 192, round: true },
  { file: 'public/icon-512.png', size: 512, round: true },
  { file: 'public/icon-maskable-512.png', size: 512, round: false },
  { file: 'public/apple-touch-icon.png', size: 180, round: false },
];

const browser = await launch(9345);
try {
  const p = await browser.page();
  await p.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const { file, size, round } of ICONS) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<body style="margin:0"><img src="${url}" width="${size}" height="${size}" style="display:block;border-radius:${round ? '22%' : '0'}"></body>`;
    await p.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    await sleep(500);
    await p.shot(file);
    console.log(file);
  }
  p.close();
} finally {
  browser.close();
}

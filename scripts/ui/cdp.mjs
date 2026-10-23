// 无头 Chrome + DevTools 协议的小工具，供 touchtest / mousetest / layoutshots 共用
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const BASE = 'http://localhost:5173/';

/** 环境变量 CHROME 可以指定浏览器的路径 */
const CHROME =
  process.env.CHROME ??
  { win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] ??
  'google-chrome';

export async function launch(port) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
    'about:blank',
  ]);
  const http = async (path, method = 'GET') => {
    for (let i = 0; i < 50; i++) {
      try {
        const txt = await (await fetch(`http://127.0.0.1:${port}${path}`, { method })).text();
        try {
          return JSON.parse(txt);
        } catch {
          return txt;
        }
      } catch {
        await sleep(200);
      }
    }
    throw new Error('no devtools');
  };
  await http('/json/version');
  return {
    /** 新开一个标签页并连接 */
    async page() {
      const tab = await http('/json/new?about:blank', 'PUT');
      return connect(tab.webSocketDebuggerUrl);
    },
    close: () => chrome.kill(),
  };
}

function connect(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waits = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) waits.get(d.id)(d.result ?? d.error);
    };
    const send = (method, params = {}) =>
      new Promise((r) => {
        waits.set(++id, r);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
      return r.result.value;
    };
    const page = {
      send,
      ev,
      close: () => ws.close(),
      /** 设定视口；touch 为真时模拟手机：触屏、pointer: coarse */
      async viewport(width, height, touch) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: touch });
        await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
      },
      /** 打开页面并等到世界生成完 */
      async open(url) {
        await send('Page.navigate', { url });
        await sleep(1000);
        for (let i = 0; i < 120 && !(await ev(`!!window.world && !document.getElementById('loading')`).catch(() => false)); i++) await sleep(500);
        await sleep(1500);
      },
      async shot(file) {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      touch: (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) }),
      async tap(x, y) {
        await page.touch('touchStart', [[x, y]]);
        await sleep(40);
        await page.touch('touchEnd', []);
      },
    };
    ws.onopen = () => resolve(page);
  });
}

// 离线缓存。整个游戏是一个 HTML 文件：联网时总是取最新的并顺手存一份，断网或网络太慢时用存下的
const CACHE = 'cyber-ant-v2';
const FILES = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const SLOW_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // 页面带着 ?new=1 之类的参数打开也用同一份缓存。同一网址下的其他页面（鱼缸示例）不经过这里
  const root = new URL('./', location.href);
  const page = url.pathname === root.pathname || url.pathname === `${root.pathname}index.html`;
  const key = req.mode === 'navigate' ? (page ? root.href : null) : FILES.map((f) => new URL(f, location.href).href).find((f) => f === url.href);
  if (!key) return;
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy));
    }
    return res;
  });
  const cached = () => caches.match(key);
  const slow = new Promise((r) => setTimeout(r, SLOW_MS)).then(() => cached().then((c) => c || net));
  e.respondWith(Promise.race([net, slow]).catch(() => cached().then((c) => c || Response.error())));
});

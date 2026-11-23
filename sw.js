// 离线缓存：先用缓存里的文件马上打开，同时在后台取最新版本，下次打开时生效
const VERSION = '1.16.5'; // 和 app.js 的 APP_VERSION 保持一致；改了它，手机才会去下载新版
const CACHE = 'study-bank-' + VERSION;
const SHELL = ['./', './index.html', './app.js', './logic.js', './voices.js', './voices-en.js', './i18n.js', './i18n-en.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ...Array.from({ length: 11 }, (_, i) => './sprites/c' + (i + 1) + '.png')];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    return res || (req.mode === 'navigate' ? cache.match('./index.html') : new Response('', { status: 504 }));
  }));
});

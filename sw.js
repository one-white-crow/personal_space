/* WorkBuddy 咕嘎管家 — Service Worker
   提供应用外壳离线缓存，使网页在鸿蒙/手机上以 APP 形式离线可用 */

const CACHE = 'wla-cache-v21';
const APP_SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png'
];

// 安装：预缓存应用外壳
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求策略：
//  - 页面导航：网络优先，失败才回退缓存 —— 保证用户总能拿到最新页面（修复"缓存旧坏页一直显示"）
//  - 其它静态资源：缓存优先，回退网络；网络成功则更新缓存
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 跨域请求（CDN、字体等）直接走网络
  if (url.origin !== self.location.origin) return;
  // 后端数据接口（认证 / 数据 / 文件上传）必须实时走网络，绝不缓存
  if (url.pathname.indexOf('/api/') === 0) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* ===== 番茄钟「绝对结束时间戳」到点提醒 =====
   页面在 start / 阶段切换时把 endAt(绝对时间戳) 传给 SW，
   SW 用 setTimeout 在到点时弹出系统通知。即便页面被手机息屏/后台挂起，
   浏览器也会为通知保活 SW，从而能在息屏期间真实发声提醒。 */
// 支持同时预约多个时间点（番茄钟 + 今日时间安排的多条任务），以 tag 区分
const swSchedules = new Map(); // tag -> { timer, endAt, title, body }

function clearSwSchedule(tag) {
  if (tag) {
    const s = swSchedules.get(tag);
    if (s) { clearTimeout(s.timer); swSchedules.delete(tag); }
  } else {
    for (const s of swSchedules.values()) clearTimeout(s.timer);
    swSchedules.clear();
  }
}

function notifyClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((cs) => {
    cs.forEach((c) => { try { c.postMessage(msg); } catch (e) {} });
  });
}

function armSwSchedule(endAt, title, body, tag) {
  tag = tag || 'pomo';
  const existing = swSchedules.get(tag);
  if (existing) clearTimeout(existing.timer);
  const delay = Math.max(0, endAt - Date.now());
  const timer = setTimeout(() => {
    try {
      if ('Notification' in self && Notification.permission === 'granted') {
        self.registration.showNotification(title, {
          body,
          tag: 'wla-' + tag,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png'
        });
      }
    } catch (e) { /* 通知被系统限制则忽略 */ }
    notifyClients({ type: 'fired', endAt, tag });
    swSchedules.delete(tag);
  }, delay);
  swSchedules.set(tag, { timer, endAt, title, body });
}

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'schedule') armSwSchedule(d.endAt, d.title, d.body, d.tag);
  else if (d.type === 'cancel') clearSwSchedule(d.tag);
});

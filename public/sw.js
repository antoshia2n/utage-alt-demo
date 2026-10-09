// 画面の骨組みだけを控える。/api と /mcp は控えない（いつも最新を取る）
const CACHE = "shell-v7";
const SHELL = ["/app", "/css/style.css", "/js/common.js", "/js/correction.js", "/js/app.js", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;
  // まず通信、だめなら控え（オフラインでも画面だけは出る）
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match("/app"))));
});

// 便 8f-3：スマホへの通知（Web Push）。中身は Worker が暗号にして送る { title, body, url, tag }
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Lab OS", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/admin" },
  }));
});
// 押したら、開いている画面があればそれを前に出して移り、無ければ新しく開く
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => new URL(c.url).pathname === new URL(url, self.location.origin).pathname);
    if (same) return same.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : c));
    return self.clients.openWindow(url);
  }));
});

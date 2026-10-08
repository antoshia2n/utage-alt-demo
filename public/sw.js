// 画面の骨組みだけを控える。/api と /mcp は控えない（いつも最新を取る）
const CACHE = "shell-v6";
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

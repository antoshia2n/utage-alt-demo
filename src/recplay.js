// 便B（2026-11-06 開発部・デモに Naoki OK 18:23）：会員サイトの中で、録画の棚の録画を流す
// 生徒が開くたびに、ログインとそのコンテンツを見られる権利をマーケくんが確かめ、
// 短い合言葉（6 時間）を付けた住所を渡す。見る画面と映像は録画の保管（env.ZOOM）からマーケくんを通して流す。
// 録画の保管の住所や共有リンクは外へ出さない。

const TTL_SEC = 6 * 3600;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));

async function sign(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode("recplay:" + String(secret || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

export async function makeRecToken(secret, { lesson, rec, title }, now = Date.now()) {
  const body = b64u(enc.encode(JSON.stringify({ l: lesson, r: rec, t: String(title || "").slice(0, 200), e: Math.floor(now / 1000) + TTL_SEC })));
  return body + "." + (await sign(secret, body));
}

export async function readRecToken(secret, token, now = Date.now()) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !secret) return null;
  if ((await sign(secret, body)) !== sig) return null;
  let p;
  try { p = JSON.parse(decodeURIComponent(escape(fromB64u(body)))); } catch { return null; }
  if (!p || !p.r || !(p.e > Math.floor(now / 1000))) return null;
  return p;
}

const NO_STORE = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const closed = (msg, status) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#333"><p>${msg}</p></body>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE, "cache-control": "no-store" } });

// 生徒の画面の枠の中身（/learn/rec?t=…）と映像（/learn/rec/video?t=…）
export async function handleRecPlay(request, env, url) {
  const video = url.pathname === "/learn/rec/video";
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("", { status: 405 });
  const t = url.searchParams.get("t") || "";
  const p = await readRecToken(env.MCP_SECRET, t);
  if (!p) return video ? new Response("", { status: 403, headers: NO_STORE }) : closed("読み込み直してください（開いてから時間がたちました）。", 403);
  if (!env.ZOOM) return video ? new Response("", { status: 503 }) : closed("いまは再生できません。", 503);
  if (video) {
    const res = await env.ZOOM.member_video(p.r, request.headers.get("range"), request.method);
    return new Response(res.body, { status: res.status, headers: res.headers });
  }
  const r = await env.ZOOM.member_page(p.r, "/learn/rec/video?t=" + encodeURIComponent(t), p.t);
  if (!r || !r.ok) return closed("録画が見つかりません。", 404);
  return new Response(r.html, { headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE, "cache-control": "private, no-store" } });
}

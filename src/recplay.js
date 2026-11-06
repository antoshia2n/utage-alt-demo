// 便B（2026-11-06 開発部・デモに Naoki OK 18:23）／便 B2（19:05 OK）：会員サイトの中で、録画の棚の録画を流す
// 生徒が開くたびに、ログインとそのコンテンツを見られる権利をマーケくんが確かめ（/api/me/rec/<id>）、
// 映像の置き場を入れた短い合言葉（6 時間）を渡す。映像は録画の保管（env.ZOOM）からマーケくんを通して流す。
// 便 B2：見る画面はマーケくんの画面で組む（前の「枠の中の別ページ」はやめた）。合言葉に置き場を入れ、
//        映像の 1 回ごとに棚の一覧を読まない（コードレビュー 2026-11-06）。
// 録画の保管の住所や共有リンクは外へ出さない。

const TTL_SEC = 6 * 3600;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode("recplay:" + String(secret || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function makeRecToken(secret, { lesson, key }, now = Date.now()) {
  const body = b64u(enc.encode(JSON.stringify({ l: lesson, k: key, e: Math.floor(now / 1000) + TTL_SEC })));
  return body + "." + b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
}

export async function readRecToken(secret, token, now = Date.now()) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !secret) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64u(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(fromB64u(body))); } catch { return null; }
  if (!p || !p.k || !(p.e > Math.floor(now / 1000))) return null;
  return p;
}

const NO_INDEX = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

// 映像（/learn/rec/video?t=…）。Range のまま録画の保管へ渡す
export async function handleRecPlay(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("", { status: 405 });
  const p = await readRecToken(env.MCP_SECRET, url.searchParams.get("t") || "");
  if (!p) return new Response("", { status: 403, headers: NO_INDEX });
  if (!env.ZOOM) return new Response("", { status: 503, headers: NO_INDEX });
  const res = await env.ZOOM.member_stream(p.k, request.headers.get("range"), request.method);
  const h = new Headers(res.headers);
  Object.entries(NO_INDEX).forEach(([k, v]) => h.set(k, v));
  return new Response(res.body, { status: res.status, headers: h });
}

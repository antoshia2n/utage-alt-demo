// マイページ（2026-10-29 11:42 Naoki「OK」・会員サイトとマイページの 3 回目）。
//  ・仕組みはページ（src/pages.js）と同じ：b_pages の 1 枚（目的 mypage）＋ b_page_versions の版。HTML で自由に直し、版を選んで公開する。
//    作る画面は会員サイト › マイページに分ける（パーツ › ページの一覧には出さない）。公開の住所（lp.shia2n.jp）でも出さない。
//  ・HTML の中に印を書くと、生徒ごとの中身が入る（中身はこちらで作り、印の要素の中身を置き換える）：
//      data-lab-part="mypage:name"  … 呼び名
//      data-lab-part="mypage:next"  … 次にやること（前回の続きのコンテンツ・まだ何も見ていない人には最初の 1 本）
//      data-lab-part="mypage:apps"  … 使えるアプリの札（権利 × アプリの表 member_access で、関門を通ったアプリだけ）
//      data-lab-part="mypage:news"  … 新しいお知らせ 1 件
//  ・生徒の画面では、区切った枠（sandbox の iframe・srcdoc）に出す。HTML に何を書いても、ログイン中の鍵（lab.shia2n.jp の保存領域）に届かない。
//    枠の中のリンクは target="_top" で生徒の画面を動かす（/app#lesson/<番号>・/app#news）。

import { PUBLISH_APPS } from "./bridge.js";

export const MYPAGE_PURPOSE = "mypage";
export const MYPAGE_SLUG = "mypage-shiarabo";
export const MARKS = ["name", "next", "apps", "news"];
const HTML_MAX = 400000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 印の要素の中身を置き換える。中身は同じ名前の閉じタグまで（印の要素の中には同じ名前の要素を入れない約束）
export function fillMarks(html, parts) {
  let out = String(html || "");
  for (const k of MARKS) {
    if (parts[k] == null) continue;
    const re = new RegExp(`(<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\bdata-lab-part\\s*=\\s*["']mypage:${k}["'][^>]*>)([\\s\\S]*?)(</\\2\\s*>)`, "g");
    out = out.replace(re, (_, open, _tag, _inner, close) => open + parts[k] + close);
  }
  return out;
}

// HTML の中の印（どれが入っているか）。注意書きの中は数えない
export function marksIn(html) {
  const s = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  return MARKS.filter((k) => new RegExp(`data-lab-part\\s*=\\s*["']mypage:${k}["']`).test(s));
}

// 次にやること：最後に開いたコンテンツの次の、まだ開いていないもの。無ければ最初のまだ開いていないもの。全部開いていれば null
export function pickNext(programs, viewedNewestFirst) {
  const flat = [];
  for (const p of programs || []) for (const c of p.courses || []) for (const l of c.lessons || []) flat.push({ l, p, c });
  if (!flat.length) return { item: null, started: false, done: false };
  const seen = new Set(viewedNewestFirst || []);
  const started = flat.some((x) => seen.has(x.l.id));
  const last = (viewedNewestFirst || []).find((id) => flat.some((x) => x.l.id === id));
  let i = last ? flat.findIndex((x) => x.l.id === last) : -1;
  const after = flat.slice(i + 1).find((x) => !seen.has(x.l.id));
  const item = after || flat.find((x) => !seen.has(x.l.id)) || null;
  return { item, started, done: !item };
}

// 印に入れる中身（HTML の断片）。見た目はマイページの HTML の側で .lab-* に当てる
export function partsHtml({ name, next, apps, news }) {
  const nx = next.item
    ? `<a class="lab-next" href="/app#lesson/${encodeURIComponent(next.item.l.id)}" target="_top"><span class="lab-next-where">${esc(next.item.p.title)} › ${esc(next.item.c.title)}</span><b class="lab-next-title">${esc(next.item.l.title)}</b><span class="lab-next-go">${next.started ? "続きを見る" : "最初の 1 本を見る"} →</span></a>`
    : `<div class="lab-next lab-empty">${next.done ? "公開中のコンテンツは全部開きました。新しいコンテンツが出たらここに出ます" : "まだ見られるコンテンツがありません"}</div>`;
  const ap = apps.length
    ? `<div class="lab-apps">${apps.map((a) => `<a class="lab-app" href="${esc(a.url)}" target="_blank" rel="noopener"><span class="lab-app-ico" aria-hidden="true">${esc(a.name.slice(0, 1))}</span><span class="lab-app-name">${esc(a.name)}</span></a>`).join("")}</div>`
    : `<div class="lab-apps lab-empty">使えるアプリはまだありません</div>`;
  const nw = news
    ? `<a class="lab-news" href="/app#news" target="_top"><time class="lab-news-at">${esc(String(news.published_at || "").slice(0, 10))}</time><b class="lab-news-title">${esc(news.title)}</b><span class="lab-news-body">${esc(String(news.body || "").replace(/\s+/g, " ").slice(0, 120))}</span></a>`
    : `<div class="lab-news lab-empty">新しいお知らせはありません</div>`;
  return { name: esc(name || ""), next: nx, apps: ap, news: nw };
}

// 枠の高さを生徒の画面へ知らせる小さな仕掛け（保存する HTML には入れない。出すときだけ足す）
const HEIGHT_SCRIPT = `<script>(function(){var s=function(){parent.postMessage({labMypageHeight:document.documentElement.scrollHeight},"*")};new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s);s()})();</script>`;
export function withHeight(html) {
  const s = String(html || "");
  return /<\/body\s*>/i.test(s) ? s.replace(/<\/body\s*>/i, HEIGHT_SCRIPT + "</body>") : s + HEIGHT_SCRIPT;
}

export const APP_URLS = {
  "x-koryaku": "https://x-koryaku.shia2n.jp/", "note-koryaku": "https://note-koryaku.shia2n.jp/", "swipe-file": "https://swipe.shia2n.jp/",
  mindmap: "https://mindmap.shia2n.jp/", "content-os": "https://content-os.shia2n.jp/",
};

export const STARTER_HTML = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f5f0eb;--panel:#fff;--line:#e6dfd6;--fg:#1a1a1a;--muted:#6b6259;--ink:#b45309;--abg:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--panel:#24211d;--line:#38332c;--fg:#f1ece6;--muted:#b0a69b;--ink:#fbbf24;--abg:rgba(251,191,36,.14)}}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--fg);font:15px/1.7 "Noto Sans JP",system-ui,sans-serif}
.wrap{display:flex;flex-direction:column;gap:16px;padding:2px}
h1{font-size:22px;margin:0}h2{font-size:14px;color:var(--muted);margin:0 0 8px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.lab-next{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:inherit;background:var(--abg);border-radius:12px;padding:16px}
.lab-next-where{font-size:12px;color:var(--muted)}.lab-next-title{font-size:18px}.lab-next-go{color:var(--ink);font-weight:700;margin-top:4px}
.lab-apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.lab-app{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:12px;padding:12px;min-height:56px}
.lab-app-ico{width:32px;height:32px;border-radius:9px;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:800;flex:none}
.lab-news{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:inherit}.lab-news-at{font-size:12px;color:var(--muted)}.lab-news-body{font-size:13px;color:var(--muted)}
.lab-empty{color:var(--muted);font-size:14px;background:none;padding:0;border:0}
a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
</style></head><body><div class="wrap">
<h1><span data-lab-part="mypage:name"></span> さん、おかえりなさい</h1>
<section class="card"><h2>次にやること</h2><div data-lab-part="mypage:next"></div></section>
<section class="card"><h2>使えるアプリ</h2><div data-lab-part="mypage:apps"></div></section>
<section class="card"><h2>お知らせ</h2><div data-lab-part="mypage:news"></div></section>
</div></body></html>`;

export function makeMypage({ db, pages, learn, names }) {
  async function page(env) {
    const [p] = await db(env, "GET", `b_pages?select=*&purpose=eq.${MYPAGE_PURPOSE}&order=created_at.asc&limit=1`);
    return p || null;
  }
  // 無ければ作る（はじめの版はひな形。公開はしない＝Naoki が作成画面で公開する）
  async function ensure(env, by = "admin") {
    let p = await page(env);
    if (p) return p;
    [p] = await db(env, "POST", "b_pages", [{ slug: MYPAGE_SLUG, title: "マイページ", purpose: MYPAGE_PURPOSE, status: "draft", latest_version: 0, updated_by: String(by).slice(0, 200) }], "return=representation");
    await pages.saveDraft(env, { page_id: p.id, html: STARTER_HTML, note: "はじめのひな形" }, by);
    return await page(env);
  }

  // 生徒ごとの中身
  async function dataFor(env, customer, email) {
    const lib = await learn.lessonsFor(env, customer, email);
    const viewed = await db(env, "GET", `events?select=payload,occurred_at&customer_id=eq.${customer.id}&type=eq.lesson_viewed&order=occurred_at.desc&limit=2000`);
    const order = [...new Set(viewed.map((e) => e.payload && e.payload.lesson_id).filter(Boolean))];
    const [news] = await db(env, "GET", "announcements?select=id,title,body,published_at&order=published_at.desc&limit=1");
    const t = Date.now();
    const keys = (await db(env, "GET", `member_entitlement?select=key,expires_at&member_id=eq.${customer.id}`)).filter((e) => !e.expires_at || Date.parse(e.expires_at) > t).map((e) => e.key);
    let apps = [];
    if (keys.length) {
      const rows = await db(env, "GET", `member_access?select=target&entitlement_key=in.(${keys.map(encodeURIComponent).join(",")})&limit=1000`);
      const open = new Set(rows.map((r) => r.target));
      apps = PUBLISH_APPS.filter((a) => open.has(a.target) && APP_URLS[a.target]).map((a) => ({ name: a.name, url: APP_URLS[a.target] }));
    }
    let name = customer.name || "";
    try { const idx = await names(env); name = idx.byEmail.get(String(email || "").toLowerCase()) || name; } catch { /* 呼び名が読めなければ台帳の名前 */ }
    return { name, next: pickNext(lib.programs || [], order), apps, news: news || null };
  }

  // 生徒の画面：公開中の版に、その人の中身を入れて返す。公開中の版が無ければ html は null（生徒の画面はマイページを出さない）
  async function forStudent(env, customer, email) {
    if (!env.B_STORE) return { ok: true, html: null };
    const p = await page(env);
    if (!p || p.status !== "published" || !p.published_version) return { ok: true, html: null };
    const [row] = await db(env, "GET", `b_page_versions?select=html&page_id=eq.${p.id}&version=eq.${p.published_version}`);
    if (!row) return { ok: true, html: null };
    return { ok: true, html: withHeight(fillMarks(row.html, partsHtml(await dataFor(env, customer, email)))) };
  }

  // 作成画面：ページ・版の一覧・選んだ版の HTML
  async function adminGet(env, { version } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const p = await ensure(env, by);
    const versions = await db(env, "GET", `b_page_versions?select=version,note,made_by,created_at&page_id=eq.${p.id}&order=version.desc&limit=100`);
    const want = Number(version) || p.latest_version;
    const [row] = want ? await db(env, "GET", `b_page_versions?select=html&page_id=eq.${p.id}&version=eq.${want}`) : [];
    return { ok: true, page: { id: p.id, status: p.status, latest_version: p.latest_version, published_version: p.published_version, published_at: p.published_at }, versions, version: want || null, html: row ? row.html : "", marks: MARKS };
  }

  async function save(env, { html, note } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const h = String(html || "");
    if (!h.trim()) return { ok: false, error: "need_html" };
    if (h.length > HTML_MAX) return { ok: false, error: "too_long" };
    const p = await ensure(env, by);
    const r = await pages.saveDraft(env, { page_id: p.id, html: h, note: String(note || "").slice(0, 500) }, by);
    if (!r.ok) return r;
    return { ok: true, version: r.version, marks: marksIn(h) };
  }

  async function publish(env, { version, stop } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const p = await ensure(env, by);
    return await pages.publish(env, { page_id: p.id, version, stop }, by);
  }

  // 作成画面の見え方：選んだ版に、見本の中身を入れる。html を渡すと保存前の書きかけで見る（本物の教材の最初の 1 本・アプリは関門を通ったもの全部・本物のお知らせ）
  async function preview(env, { version, html } = {}, by, adminEmail) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const g = html != null ? { html: String(html) } : await adminGet(env, { version }, by);
    const lib = await learn.lessonsFor(env, { id: "00000000-0000-0000-0000-000000000000" }, adminEmail);
    const [news] = await db(env, "GET", "announcements?select=id,title,body,published_at&order=published_at.desc&limit=1");
    const parts = partsHtml({ name: "受講生", next: pickNext(lib.programs || [], []), apps: PUBLISH_APPS.filter((a) => APP_URLS[a.target]).map((a) => ({ name: a.name, url: APP_URLS[a.target] })), news: news || null });
    return { ok: true, html: withHeight(fillMarks(g.html, parts)) };
  }

  return { ensure, forStudent, adminGet, save, publish, preview, dataFor };
}

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
export const MARKS = ["name", "next", "apps", "news", "shelf", "fresh", "progress"];
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
    const views = viewed.map((e) => ({ id: e.payload && e.payload.lesson_id, at: e.occurred_at })).filter((v) => v.id);
    const order = [...new Set(views.map((v) => v.id))];
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
    return { name, next: pickNext(lib.programs || [], order), apps, news: news || null, programs: lib.programs || [], views, fresh: await freshIds(env) };
  }
  // 新しく入った順のコンテンツの番号（見られるかは呼ぶ側で絞る）
  async function freshIds(env) {
    try { return (await db(env, "GET", "b_site_contents?select=id&active=eq.true&status=eq.published&order=created_at.desc&limit=100")).map((r) => r.id); }
    catch { return []; }
  }
  const allParts = (d) => ({ ...partsHtml(d), ...learnParts(d.programs, d.views, d.fresh) });
  async function siteRow(env) {
    const [r] = await db(env, "GET", "b_site_sites?select=id,mypage,mypage_mode,landing,login&order=sort.asc&limit=1");
    return r || null;
  }

  // 生徒の画面：公開中の版に、その人の中身を入れて返す。公開中の版が無ければ html は null（生徒の画面はマイページを出さない）
  async function forStudent(env, customer, email) {
    if (!env.B_STORE) return { ok: true, html: null };
    const site = await siteRow(env);
    const landing = site && site.landing === "lessons" ? "lessons" : "mypage";
    let tpl = null;
    if (site && site.mypage_mode === "html") {
      const p = await page(env);
      if (p && p.status === "published" && p.published_version) {
        const [row] = await db(env, "GET", `b_page_versions?select=html&page_id=eq.${p.id}&version=eq.${p.published_version}`);
        tpl = row ? row.html : null;
      }
    } else if (site && site.mypage) tpl = blocksHtml(site.mypage);
    if (!tpl) return { ok: true, html: null, landing };
    return { ok: true, html: withHeight(fillMarks(tpl, allParts(await dataFor(env, customer, email)))), landing };
  }

  // 作成画面：ページ・版の一覧・選んだ版の HTML
  async function adminGet(env, { version } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const p = await ensure(env, by);
    const versions = await db(env, "GET", `b_page_versions?select=version,note,made_by,created_at&page_id=eq.${p.id}&order=version.desc&limit=100`);
    const want = Number(version) || p.latest_version;
    const [row] = want ? await db(env, "GET", `b_page_versions?select=html&page_id=eq.${p.id}&version=eq.${want}`) : [];
    const site = await siteRow(env);
    return { ok: true, page: { id: p.id, status: p.status, latest_version: p.latest_version, published_version: p.published_version, published_at: p.published_at }, versions, version: want || null, html: row ? row.html : "", marks: MARKS,
      mode: site && site.mypage_mode === "html" ? "html" : "blocks", config: site && site.mypage ? checkConfig(site.mypage).config : null, default_config: DEFAULT_CONFIG };
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
    const r = await pages.publish(env, { page_id: p.id, version, stop }, by);
    // HTML の版を公開したら、生徒には HTML の形を出す（テンプレと部品の形を公開し直すと戻る）
    if (r.ok && !(stop === true || stop === "true")) { const site = await siteRow(env); if (site) await db(env, "PATCH", `b_site_sites?id=eq.${encodeURIComponent(site.id)}`, { mypage_mode: "html", updated_at: new Date().toISOString(), updated_by: String(by).slice(0, 200) }, "return=minimal"); }
    return r;
  }

  // テンプレと部品の形を公開する（公開すると、生徒にはこの形が出る）
  async function publishConfig(env, { config } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const c = checkConfig(config);
    if (!c.ok) return c;
    const site = await siteRow(env);
    if (!site) return { ok: false, error: "no_site" };
    await db(env, "PATCH", `b_site_sites?id=eq.${encodeURIComponent(site.id)}`, { mypage: c.config, mypage_mode: "blocks", updated_at: new Date().toISOString(), updated_by: String(by).slice(0, 200) }, "return=minimal");
    return { ok: true, config: c.config };
  }

  // 上級：今の部品の形を HTML の版に写す（公開はしない）
  async function toHtml(env, { config } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const c = checkConfig(config);
    if (!c.ok) return c;
    return await save(env, { html: blocksHtml(c.config), note: "テンプレと部品から写した" }, by);
  }

  // ログイン後に最初に出す画面と、ログイン画面の見た目
  async function saveSiteLook(env, { landing, login } = {}, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const site = await siteRow(env);
    if (!site) return { ok: false, error: "no_site" };
    const patch = { updated_at: new Date().toISOString(), updated_by: String(by).slice(0, 200) };
    if (landing !== undefined) { if (!["mypage", "lessons"].includes(landing)) return { ok: false, error: "bad_landing" }; patch.landing = landing; }
    if (login !== undefined) {
      const color = String((login && login.color) || "");
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { ok: false, error: "bad_color" };
      patch.login = { logo: str(login && login.logo, 40), color, msg: str(login && login.msg, 200) };
    }
    await db(env, "PATCH", `b_site_sites?id=eq.${encodeURIComponent(site.id)}`, patch, "return=minimal");
    return { ok: true };
  }
  async function publicLook(env) {
    if (!env.B_STORE) return { ok: true, login: {} };
    const site = await siteRow(env).catch(() => null);
    return { ok: true, login: (site && site.login) || {}, landing: (site && site.landing) || "mypage" };
  }

  // 作成画面の見え方：選んだ版に、見本の中身を入れる。html を渡すと保存前の書きかけで見る（本物の教材の最初の 1 本・アプリは関門を通ったもの全部・本物のお知らせ）
  async function preview(env, { version, html, config } = {}, by, adminEmail) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const g = html != null ? { html: String(html) } : config ? { html: blocksHtml(config) } : await adminGet(env, { version }, by);
    const lib = await learn.lessonsFor(env, { id: "00000000-0000-0000-0000-000000000000" }, adminEmail);
    const [news] = await db(env, "GET", "announcements?select=id,title,body,published_at&order=published_at.desc&limit=1");
    const d = { name: "受講生", next: pickNext(lib.programs || [], []), apps: PUBLISH_APPS.filter((a) => APP_URLS[a.target]).map((a) => ({ name: a.name, url: APP_URLS[a.target] })), news: news || null, programs: lib.programs || [], views: [], fresh: await freshIds(env) };
    const parts = allParts(d);
    return { ok: true, html: withHeight(fillMarks(g.html, parts)) };
  }

  return { ensure, forStudent, adminGet, save, publish, preview, dataFor, publishConfig, toHtml, saveSiteLook, publicLook };
}

// ---------- 2026-10-29 12:53 Naoki「OK」（デモ 8 版）：テンプレと部品で作る形（HTML は上級へ下げる） ----------
//  ・設定は会員サイトのサイトの行（b_site_sites.mypage）に公開中の形として持つ。mypage_mode が html のときだけ、上の HTML の版を使う。
//  ・部品の形から、印つきの HTML を組み立てる（blocksHtml）。生徒に出すときは、HTML の形と同じく印に中身を入れる。
//    なので「上級：HTML で書く」は、組み立てた HTML を版として写すだけで始められる。
export const TEMPLATES = ["simple", "dash", "magazine"];
export const BLOCK_KINDS = ["hero", "next", "shelf", "fresh", "progress", "news", "cards"];
export const MARKS2 = ["name", "next", "shelf", "fresh", "progress", "news", "apps"];
const LIST_MAX = 12;
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const httpUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || "").trim());

export const DEFAULT_CONFIG = {
  tpl: "simple",
  blocks: [
    { k: "hero", on: true, title: "{{呼び名}} さん、おかえりなさい", text: "今日も 1 本だけ進めましょう。", img: "" },
    { k: "next", on: true, label: "続きから見る" },
    { k: "shelf", on: true, label: "教材の棚" },
    { k: "fresh", on: true, label: "新しく入った教材" },
    { k: "progress", on: false, label: "学びの記録" },
    { k: "news", on: true, label: "お知らせ" },
    { k: "cards", on: false, label: "よく使うリンク", src: "hand", items: [] },
  ],
};

// 画面から来た形を確かめて整える。知らない部品は捨て、足りない部品は既定の形で後ろに足す
export function checkConfig(c = {}) {
  const tpl = TEMPLATES.includes(c.tpl) ? c.tpl : "simple";
  const seen = new Set(), blocks = [];
  for (const b of Array.isArray(c.blocks) ? c.blocks : []) {
    if (!b || !BLOCK_KINDS.includes(b.k) || seen.has(b.k)) continue;
    seen.add(b.k);
    const d = DEFAULT_CONFIG.blocks.find((x) => x.k === b.k);
    const o = { k: b.k, on: b.on !== false };
    if (b.k === "hero") {
      o.title = str(b.title, 120); o.text = str(b.text, 300);
      o.img = str(b.img, 1000);
      if (o.img && !httpUrl(o.img)) return { ok: false, error: "bad_image_url" };
    } else o.label = str(b.label, 60) || d.label;
    if (b.k === "cards") {
      o.src = b.src === "apps" ? "apps" : "hand";
      o.items = [];
      for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, LIST_MAX)) {
        const title = str(it && it.title, 60), desc = str(it && it.desc, 120), url = str(it && it.url, 1000);
        if (!title && !desc && !url) continue;
        if (!title) return { ok: false, error: "card_title_required" };
        if (!httpUrl(url)) return { ok: false, error: "bad_card_url" };
        o.items.push({ title, desc, url });
      }
    }
    blocks.push(o);
  }
  for (const d of DEFAULT_CONFIG.blocks) if (!seen.has(d.k)) blocks.push({ ...d, on: false });
  return { ok: true, config: { tpl, blocks } };
}

const BASE_CSS = `:root{--bg:#f5f0eb;--panel:#fff;--line:#e6dfd6;--fg:#1a1a1a;--muted:#6b6259;--ink:#b45309;--abg:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#1b1916;--panel:#24211d;--line:#38332c;--fg:#f1ece6;--muted:#b0a69b;--ink:#fbbf24;--abg:rgba(251,191,36,.14)}}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--fg);font:15px/1.7 "Noto Sans JP",system-ui,sans-serif}
a{color:inherit}a:focus-visible{outline:3px solid var(--ink);outline-offset:2px;border-radius:6px}
.lab-wrap{display:flex;flex-direction:column;gap:14px;padding:2px}
.lab-hero{padding:20px;border-radius:16px;background:linear-gradient(135deg,var(--abg),var(--panel));border:1px solid var(--line)}.lab-hero h1{margin:0;font-size:22px;line-height:1.4}.lab-hero p{margin:6px 0 0;color:var(--muted)}
.lab-hero.img{color:#fff;border:0;min-height:140px;display:flex;flex-direction:column;justify-content:flex-end;background-size:cover;background-position:center}.lab-hero.img p{color:#ffffffcc}
.lab-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.lab-h{display:flex;align-items:center;font-size:13px;color:var(--muted);font-weight:700;margin:0 0 10px}.lab-h a{margin-left:auto;color:var(--ink);text-decoration:none;font-weight:700}
.lab-next{display:flex;flex-direction:column;gap:3px;text-decoration:none;background:var(--abg);border-radius:12px;padding:14px}.lab-next-where,.lab-next-sub{font-size:12px;color:var(--muted)}.lab-next-title{font-size:18px}.lab-next-go{color:var(--ink);font-weight:700}
.lab-bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:4px}.lab-bar i{display:block;height:100%;background:var(--ink)}
.lab-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.lab-pg{display:flex;flex-direction:column;gap:4px;text-decoration:none;font-size:14px}.lab-pg-th{height:84px;border-radius:12px;color:#fff;font-weight:800;font-size:13px;padding:10px;display:flex;align-items:flex-end}.lab-pg-meta{font-size:12px;color:var(--muted)}
.lab-fresh{display:flex;flex-direction:column;gap:10px}.lab-fresh a{display:flex;flex-direction:column;text-decoration:none;border-left:3px solid var(--ink);padding-left:10px}.lab-fresh small{font-size:12px;color:var(--muted)}.lab-new{font-size:10px;font-weight:800;color:var(--ink)}
.lab-prog{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}.lab-prog b{display:block;font-size:24px}.lab-prog span{font-size:12px;color:var(--muted)}
.lab-news{display:flex;flex-direction:column;gap:2px;text-decoration:none}.lab-news-at,.lab-news-body{font-size:12px;color:var(--muted)}
.lab-apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.lab-app{display:flex;align-items:center;gap:10px;text-decoration:none;border:1px solid var(--line);border-radius:12px;padding:10px;min-height:56px}.lab-app-ico{width:32px;height:32px;border-radius:9px;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:800;flex:none}
.lab-app small{display:block;font-size:12px;color:var(--muted)}
.lab-empty{color:var(--muted);font-size:14px;background:none;padding:0;border:0}
.lab-card:has(.lab-apps.lab-empty){display:none}
.lab-dash{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px;align-items:start}.lab-dash>div{display:flex;flex-direction:column;gap:14px}
.tpl-magazine .lab-hero{min-height:170px}.tpl-magazine .lab-shelf{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}.tpl-magazine .lab-pg{flex:0 0 170px;scroll-snap-align:start}
@media (max-width:640px){.lab-dash{grid-template-columns:minmax(0,1fr)}.lab-shelf{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}.lab-pg{flex:0 0 150px;scroll-snap-align:start}}`;

const MARK_OF = { next: "next", shelf: "shelf", fresh: "fresh", progress: "progress", news: "news" };
// 部品の形 → 印つきの HTML（生徒ごとの中身は印の中に後から入る）
export function blocksHtml(cfg) {
  const c = checkConfig(cfg).config || DEFAULT_CONFIG;
  const one = (b) => {
    if (b.k === "hero") {
      const t = esc(b.title).replace("{{呼び名}}", '<span data-lab-part="mypage:name"></span>');
      const st = b.img ? ` style="background-image:linear-gradient(180deg,#0000 20%,#000a),url('${esc(b.img)}')"` : "";
      return `<section class="lab-hero${b.img ? " img" : ""}"${st}><h1>${t}</h1>${b.text ? `<p>${esc(b.text)}</p>` : ""}</section>`;
    }
    if (b.k === "cards") {
      if (b.src === "apps") return `<section class="lab-card"><h2 class="lab-h">${esc(b.label)}</h2><div data-lab-part="mypage:apps"></div></section>`;
      if (!b.items.length) return "";
      return `<section class="lab-card"><h2 class="lab-h">${esc(b.label)}</h2><div class="lab-apps">${b.items.map((it) => `<a class="lab-app" href="${esc(it.url)}" target="_blank" rel="noopener"><span class="lab-app-ico" aria-hidden="true">${esc(it.title.slice(0, 1))}</span><span><b>${esc(it.title)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ""}</span></a>`).join("")}</div></section>`;
    }
    const more = b.k === "shelf" ? '<a href="/app#lessons" target="_top">すべての教材 →</a>' : "";
    return `<section class="lab-card"><h2 class="lab-h">${esc(b.label)}${more}</h2><div data-lab-part="mypage:${MARK_OF[b.k]}"></div></section>`;
  };
  const on = c.blocks.filter((b) => b.on);
  let body;
  if (c.tpl === "dash") {
    const L = ["hero", "next", "shelf", "fresh"];
    body = `<div class="lab-dash"><div>${on.filter((b) => L.includes(b.k)).map(one).join("")}</div><div>${on.filter((b) => !L.includes(b.k)).map(one).join("")}</div></div>`;
  } else body = on.map(one).join("");
  return `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>\n${BASE_CSS}\n</style></head>\n<body class="tpl-${c.tpl}"><div class="lab-wrap">\n${body}\n</div></body></html>`;
}

const SHELF_COLORS = ["#b45309", "#7c3aed", "#0f766e", "#be123c", "#1d4ed8", "#4d7c0f", "#c2410c", "#0369a1", "#a21caf", "#15803d", "#9f1239", "#334155"];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const jstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

// 学びの中身（続き・棚・新しく入った・記録）。programs は learn.lessonsFor の形、views は { id, at } の新しい順、fresh は新しく入った順の番号
export function learnParts(programs, views, freshIds = [], now = Date.now()) {
  const seen = new Set(views.map((v) => v.id));
  const next = pickNext(programs, views.map((v) => v.id));
  const all = new Set();
  const info = new Map();
  for (const p of programs || []) for (const c of p.courses || []) c.lessons.forEach((l, i) => { all.add(l.id); if (!info.has(l.id)) info.set(l.id, { l, p, c, i, n: c.lessons.length }); });
  let nx;
  if (next.item) {
    const it = info.get(next.item.l.id) || { i: 0, n: 1 };
    const doneInCourse = next.item.c.lessons.filter((l) => seen.has(l.id)).length;
    nx = `<a class="lab-next" href="/app#lesson/${encodeURIComponent(next.item.l.id)}" target="_top"><span class="lab-next-where">${esc(next.item.p.title)} › ${esc(next.item.c.title)}</span><b class="lab-next-title">${esc(next.item.l.title)}</b><span class="lab-next-go">${next.started ? "続きを見る" : "最初の 1 本を見る"} →</span><div class="lab-bar"><i style="width:${pct(doneInCourse, it.n)}%"></i></div><span class="lab-next-sub">このコースの ${it.i + 1} / ${it.n} 本目</span></a>`;
  } else nx = `<div class="lab-next lab-empty">${next.done ? "公開中のコンテンツは全部開きました。新しいコンテンツが出たらここに出ます" : "まだ見られるコンテンツがありません"}</div>`;
  const shelf = (programs || []).length
    ? `<div class="lab-shelf">${programs.map((p, i) => { const ids = new Set(p.courses.flatMap((c) => c.lessons.map((l) => l.id))); const done = [...ids].filter((x) => seen.has(x)).length; const r = pct(done, ids.size);
      return `<a class="lab-pg" href="/app#program/${encodeURIComponent(p.id)}" target="_top"><span class="lab-pg-th" style="background:${SHELF_COLORS[i % SHELF_COLORS.length]}">${esc(p.title.slice(0, 14))}</span><b>${esc(p.title)}</b><span class="lab-pg-meta">${ids.size} 本・${r === 100 ? "見終わった" : r ? "進み " + r + "%" : "まだ"}</span><span class="lab-bar"><i style="width:${r}%"></i></span></a>`; }).join("")}</div>`
    : '<div class="lab-shelf lab-empty">まだ見られる教材がありません</div>';
  const fr = freshIds.filter((id) => info.has(id)).slice(0, 3).map((id) => info.get(id));
  const fresh = fr.length
    ? `<div class="lab-fresh">${fr.map((x) => `<a href="/app#lesson/${encodeURIComponent(x.l.id)}" target="_top"><span class="lab-new">NEW</span><b>${esc(x.l.title)}</b><small>${esc(x.p.title)} › ${esc(x.c.title)}</small></a>`).join("")}</div>`
    : '<div class="lab-fresh lab-empty">新しく入った教材はまだありません</div>';
  const week = new Set(views.filter((v) => Date.parse(v.at) > now - 7 * 864e5).map((v) => v.id)).size;
  const days = new Set(views.map((v) => jstDay(v.at)));
  let streak = 0;
  const today = jstDay(new Date(now).toISOString());
  let d = days.has(today) ? today : jstDay(new Date(now - 864e5).toISOString());
  while (days.has(d) && streak < 3650) { streak++; d = new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10); }
  const progress = `<div class="lab-prog"><div><b>${week}</b><span>今週見た本数</span></div><div><b>${streak}</b><span>続けた日数</span></div><div><b>${pct([...all].filter((x) => seen.has(x)).length, all.size)}%</b><span>全体の進み</span></div></div>`;
  return { next: nx, shelf, fresh, progress };
}

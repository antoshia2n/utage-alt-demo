// 公開サイトのブログ（2026-11-07 便 S3。作る前の 1 枚に Naoki OK 16:15）
//
// 形：コンテンツくんの記事（表 posts）を選んで「写す」と、ブログの下書き（表 b_blog_posts）になる。
//   1 本ずつ住所の名前・説明・特典（便 S2 の部品）を決めて公開する。公開するまで外には出ない。
//   本文はブログでは直さない（コンテンツくんで直して「写し直す」）。写したあとの直しは写し直すまで出ない。
// 捨てた案：コンテンツくんの記事をそのまま読んで出す（下書き・予約が手違いで外に出るため）。
// 住所：lp の住所の /blog（一覧）・/blog/名前（記事）・/sitemap.xml。見た目は便 S1（/_lab/look.css）。
// 部品は場所で自動で入れる：本文の途中（2 つ目の見出しの前）＝記事の特典、無ければ place=mid の部品／記事の下＝end／
//   サイドバー＝side／スマホの下の帯＝bar。どれも読者の段階で中身が変わる（部品の出し分けは web.js）。
// 見た人は b_blog_hits（記事ごと・端末の印 vid）。部品の見た・押した・登録は b_web_part_hits（page_id に記事の id）。

export const BLOG_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const VID_RE = /^[a-z0-9]{8,40}$/;
const SOURCE_TYPES = ["x_article", "note"];
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 本文の掃除（入れてよい形だけ残す） ----------
const KEEP = new Set(["p", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "br", "hr", "ul", "ol", "li", "blockquote", "a", "img", "figure", "figcaption", "code", "pre", "span", "div", "table", "thead", "tbody", "tr", "th", "td"]);
const DROP_WITH_BODY = /<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button)\b[\s\S]*?<\/\1\s*>/gi;
const okUrl = (u) => /^https:[/][/][^\s<>"'`]+$/i.test(String(u || ""));
function attrsOf(s) {
  const out = {};
  String(s || "").replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, (_, k, __, a, b, c) => { out[k.toLowerCase()] = a ?? b ?? c ?? ""; return ""; });
  return out;
}
const unent = (s) => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function cleanHtml(html) {
  let s = String(html || "").replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_BODY, "");
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (all, close, tag, rest) => {
    const t = tag.toLowerCase();
    if (!KEEP.has(t)) return "";
    if (close) return t === "br" || t === "hr" || t === "img" ? "" : `</${t}>`;
    const a = attrsOf(rest);
    if (t === "a") {
      const href = unent(a.href || "");
      return okUrl(href) ? `<a href="${esc(href)}" rel="noopener nofollow" target="_blank">` : "<a>";
    }
    if (t === "img") {
      const src = unent(a.src || "");
      return okUrl(src) ? `<img src="${esc(src)}" alt="${esc(a.alt || "")}" loading="lazy">` : "";
    }
    if (t === "td" || t === "th") {
      const cs = /^\d{1,2}$/.test(a.colspan || "") ? ` colspan="${a.colspan}"` : "";
      return `<${t}${cs}>`;
    }
    return `<${t}>`;
  });
  // < と > が残っていれば字として出す（タグの形をしていない残り）
  s = s.replace(/<(?![/]?(?:[a-z0-9]+)(?:\s[^<>]*)?>)/gi, "&lt;");
  return s.replace(/<\/?span>/g, "").replace(/<p>\s*<\/p>/g, "").trim();
}
export function plainText(html) {
  return unent(String(html || "").replace(/<br\s*[/]?>/gi, " ").replace(/<\/(p|h[1-6]|li|blockquote)>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}
export function firstImage(html) {
  const m = String(html || "").match(/<img[^>]+src="(https:[/][/][^"]+)"/i);
  return m ? unent(m[1]) : "";
}
// 見出し（h2）に印を付けて、目次を作る
export function withToc(html) {
  const toc = [];
  let n = 0;
  const body = String(html || "").replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
    n += 1; const id = `s${n}`;
    toc.push({ id, text: plainText(inner) });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { body, toc };
}
// 本文の途中（2 つ目の見出しの前）に差し込む。見出しが 2 つ無いときは 3 つ目の段落の後、それも無ければ最後
export function insertMid(html, snippet) {
  if (!snippet) return html;
  const s = String(html || "");
  const hs = [...s.matchAll(/<h2[\s>]/g)];
  if (hs.length >= 2) return s.slice(0, hs[1].index) + snippet + s.slice(hs[1].index);
  const ps = [...s.matchAll(/<\/p>/g)];
  if (ps.length >= 3) { const i = ps[2].index + 4; return s.slice(0, i) + snippet + s.slice(i); }
  return s + snippet;
}
const partTag = (id, cls = "") => id ? `<div${cls ? ` class="${cls}"` : ""} data-lab-part="part:${esc(id)}"></div>` : "";
const jpDate = (iso) => { const d = new Date(iso || 0); if (!iso || isNaN(d)) return ""; const j = new Date(d.getTime() + 9 * 3600e3); return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`; };

// ---------- 画面の外枠（一覧と記事で共通） ----------
const SHELL_CSS = `*{box-sizing:border-box}body{margin:0;background:var(--lab-bg,#fafaf9);color:var(--lab-fg,#1c1917);font-family:var(--lab-font,system-ui,sans-serif)}
a{color:inherit}.bh{background:var(--lab-card,#fff);border-bottom:1px solid var(--lab-line,#e7e5e4)}.bh>div{max-width:1120px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:12px}
.bh a{font-family:var(--lab-head,inherit);font-weight:800;font-size:18px;text-decoration:none}.bh small{color:var(--lab-mut,#57534e)}
.bw{max-width:1120px;margin:0 auto;padding:28px 20px 80px;display:grid;grid-template-columns:minmax(0,1fr);gap:32px}
@media(min-width:1000px){.bw.has-side{grid-template-columns:minmax(0,var(--lab-w,720px)) 300px;justify-content:center}}
.lab-article{margin:0 auto;width:100%}.ba-h1{font-family:var(--lab-head,inherit);font-size:clamp(24px,4vw,32px);line-height:1.45;margin:0 0 10px}
.ba-meta{color:var(--lab-mut,#57534e);font-size:13px;margin:0 0 20px}.ba-thumb{width:100%;aspect-ratio:1200/630;object-fit:cover;border-radius:var(--lab-r,14px);margin:0 0 22px;display:block}
.lab-toc ul{margin:4px 0 0;padding:0;list-style:none}.lab-toc a{text-decoration:none}.lab-toc li{margin:2px 0}
.lab-article blockquote{margin:0 0 1.3em;padding:.6em 1em;border-left:4px solid var(--lab-line,#e7e5e4);color:var(--lab-mut,#57534e)}
.lab-article table{border-collapse:collapse;width:100%;margin:0 0 1.3em;font-size:14px}.lab-article th,.lab-article td{border:1px solid var(--lab-line,#e7e5e4);padding:6px 8px;text-align:left}
.bs{position:relative}.bs .lab-side{position:sticky;top:20px}
.lab-barpart{display:none}@media(max-width:760px){.lab-barpart.lab-part{display:block;position:fixed;left:8px;right:8px;bottom:8px;margin:0;z-index:20;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.18)}.lab-barpart .lab-part-p{display:none}body{padding-bottom:120px}}
.bmore{max-width:var(--lab-w,720px);margin:40px auto 0}.bmore h2{font-size:16px;margin:0 0 10px;font-family:var(--lab-head,inherit)}
.bl{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}.bc{display:flex;flex-direction:column;background:var(--lab-card,#fff);border:1px solid var(--lab-line,#e7e5e4);border-radius:var(--lab-r,14px);overflow:hidden;text-decoration:none}
.bc i{display:block;aspect-ratio:1200/630;background:color-mix(in srgb,var(--lab-c,#1c1917) 10%,var(--lab-card,#fff)) center/cover no-repeat}.bc div{padding:12px 14px 14px}.bc.nt{border-top:4px solid var(--lab-c2,#f59e0b)}.bc.nt div{padding:16px}.bc b{display:block;font-family:var(--lab-head,inherit);line-height:1.5;margin:0 0 6px}.bc p{margin:0;font-size:13px;color:var(--lab-mut,#57534e);line-height:1.6}.bc small{display:block;margin-top:6px;color:var(--lab-mut,#57534e);font-size:12px}
.bf{color:var(--lab-mut,#57534e);font-size:12px;text-align:center;padding:24px}`;
function shell({ title, description, canonical, image, siteName, body, embed, jsonld, noindex }) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ""}${noindex ? '<meta name="robots" content="noindex">' : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">` : ""}<meta property="og:title" content="${esc(title)}"><meta property="og:site_name" content="${esc(siteName)}">${description ? `<meta property="og:description" content="${esc(description)}">` : ""}
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="stylesheet" href="/_lab/look.css"><style>${SHELL_CSS}</style>${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><header class="bh"><div><a href="/blog">${esc(siteName)}</a></div></header>${body}<footer class="bf">© ${esc(siteName)}</footer>${embed || ""}</body></html>`;
}
// サムネの無い記事は画像の枠を出さない（灰色の箱が並ぶのを避ける）
const card = (p) => `<a class="bc${p.thumb_url ? "" : " nt"}" href="/blog/${esc(p.slug)}">${p.thumb_url ? `<i style="background-image:url('${esc(p.thumb_url)}')"></i>` : ""}<div><b>${esc(p.title)}</b>${p.description ? `<p>${esc(p.description.slice(0, 80))}${p.description.length > 80 ? "…" : ""}</p>` : ""}<small>${esc(jpDate(p.published_at))}</small></div></a>`;

export function makeBlog({ db, logInbound, web, pagesOrigin, previewToken, readPreviewToken }) {
  const origin = (env) => pagesOrigin(env);
  async function siteName(env) {
    const l = (await web.getLook(env)).look;
    return l.name || "ブログ";
  }
  async function byId(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    return (await db(env, "GET", `b_blog_posts?select=*&id=eq.${id}`))[0] || null;
  }
  async function bySlug(env, slug) {
    if (!BLOG_SLUG_RE.test(String(slug || ""))) return null;
    return (await db(env, "GET", `b_blog_posts?select=*&slug=eq.${slug}`))[0] || null;
  }
  async function views(env, days = 7) {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const rows = await db(env, "GET", `b_blog_hits?select=post_id,vid&at=gte.${encodeURIComponent(since)}&limit=50000`).catch(() => []);
    const m = {};
    for (const h of rows) (m[h.post_id] = m[h.post_id] || new Set()).add(h.vid);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.size]));
  }
  const shape = async (env, p, v) => ({
    id: p.id, slug: p.slug, title: p.title, description: p.description, thumb_url: p.thumb_url, gift_part: p.gift_part || "",
    status: p.status, published_at: p.published_at, source_post_id: p.source_post_id, source_updated_at: p.source_updated_at,
    copied_at: p.copied_at, updated_at: p.updated_at, url: `${origin(env)}/blog/${p.slug}`,
    preview_url: `${origin(env)}/blog/${p.slug}?preview=${await previewToken(env, `blog:${p.id}`, 1)}`,
    week_viewers: v || 0,
  });

  // 画面と AI が読む 1 枚：ブログの記事（先週 7 日の見た人つき）・特典に使える部品・写せるアカウント
  async function get(env) {
    const [rows, v, parts, accs] = await Promise.all([
      db(env, "GET", "b_blog_posts?select=*&order=created_at.desc&limit=500").catch(() => []),
      views(env), web.listParts(env).catch(() => []),
      db(env, "GET", "accounts?select=id,name&order=id.asc").catch(() => []),
    ]);
    const posts = [];
    for (const p of rows || []) posts.push(await shape(env, p, v[p.id]));
    return {
      ok: true, origin: origin(env), index_url: `${origin(env)}/blog`, site_name: await siteName(env), posts,
      parts: parts.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, place: p.place })),
      accounts: (accs || []).map((a) => ({ id: a.id, name: a.name })),
    };
  }

  // コンテンツくんの記事（公開済みの X記事・note）。写したものには blog_id が付く
  async function sources(env, { account = "acc_1", q = "", limit = 40 } = {}) {
    if (!/^[a-z0-9_]{1,40}$/i.test(String(account))) return { ok: false, error: "bad_account" };
    const n = Math.min(Math.max(Number(limit) || 40, 1), 100);
    let path = `posts?select=id,title,post_type,datetime,updated_at,thumb_url&account_id=eq.${account}&status=eq.published&post_type=in.(${SOURCE_TYPES.join(",")})&order=datetime.desc&limit=${n}`;
    const qq = String(q || "").trim().replace(/[*,()]/g, " ").slice(0, 60);
    if (qq) path += `&title=ilike.*${encodeURIComponent(qq)}*`;
    const rows = await db(env, "GET", path);
    const ids = rows.map((r) => r.id);
    const made = ids.length ? await db(env, "GET", `b_blog_posts?select=id,slug,source_post_id,status&source_post_id=in.(${ids.join(",")})`).catch(() => []) : [];
    return {
      ok: true,
      posts: rows.map((r) => {
        const b = made.find((x) => String(x.source_post_id) === String(r.id));
        return { id: String(r.id), title: r.title || "（題なし）", type: r.post_type, date: r.datetime, thumb: !!r.thumb_url, blog_id: b ? b.id : null, blog_slug: b ? b.slug : null, blog_status: b ? b.status : null };
      }),
    };
  }
  async function readSource(env, id) {
    if (!/^\d{1,20}$/.test(String(id || ""))) return null;
    return (await db(env, "GET", `posts?select=id,account_id,title,body,status,post_type,thumb_url,updated_at&id=eq.${id}`))[0] || null;
  }
  const fromSource = (src) => {
    const body = cleanHtml(src.body);
    return { body_html: body, thumb_url: okUrl(src.thumb_url) ? src.thumb_url : firstImage(body) || null, source_updated_at: src.updated_at || null };
  };

  // 写す（コンテンツくんの記事 → ブログの下書き）
  async function copy(env, { post_id, slug } = {}, actor = "admin") {
    const src = await readSource(env, post_id);
    if (!src) return { ok: false, error: "source_not_found" };
    if (src.status !== "published" || !SOURCE_TYPES.includes(src.post_type)) return { ok: false, error: "source_not_published" };
    if (!String(src.body || "").trim()) return { ok: false, error: "source_empty" };
    const dup = (await db(env, "GET", `b_blog_posts?select=id,slug&source_post_id=eq.${src.id}`))[0];
    if (dup) return { ok: false, error: "already_copied", id: dup.id, slug: dup.slug };
    const s = String(slug || "").trim().toLowerCase();
    if (!BLOG_SLUG_RE.test(s)) return { ok: false, error: "bad_slug" };
    if (await bySlug(env, s)) return { ok: false, error: "slug_taken" };
    const f = fromSource(src);
    const row = {
      id: crypto.randomUUID(), slug: s, title: String(src.title || "").slice(0, 120) || "（題なし）", description: plainText(f.body_html).slice(0, 120),
      ...f, source_post_id: src.id, status: "draft", copied_at: now(), updated_at: now(), updated_by: String(actor).slice(0, 200),
    };
    const [made] = await db(env, "POST", "b_blog_posts", [row], "return=representation");
    await logInbound(env, "blog", { action: "copy", source: src.id, slug: s, actor }, { ok: true }, 200);
    return { ok: true, post: await shape(env, made || row, 0) };
  }

  // 直す・公開・止める・写し直す・消す
  async function save(env, args = {}, actor = "admin") {
    const p = await byId(env, args.id);
    if (!p) return { ok: false, error: "not_found" };
    const action = String(args.action || "");
    if (action === "remove") {
      if (p.status === "published") return { ok: false, error: "unpublish_first" };
      await db(env, "DELETE", `b_blog_posts?id=eq.${p.id}`, null, "return=minimal");
      await logInbound(env, "blog", { action: "remove", id: p.id, actor }, { ok: true }, 200);
      return { ok: true, removed: p.id };
    }
    const patch = {};
    if (args.slug !== undefined && String(args.slug) !== p.slug) {
      const s = String(args.slug).trim().toLowerCase();
      if (!BLOG_SLUG_RE.test(s)) return { ok: false, error: "bad_slug" };
      if (p.status === "published") return { ok: false, error: "slug_locked" }; // 公開中に住所を変えるとリンクが切れる
      if (await bySlug(env, s)) return { ok: false, error: "slug_taken" };
      patch.slug = s;
    }
    if (args.title !== undefined) { const t = String(args.title).trim(); if (!t || t.length > 120) return { ok: false, error: "bad_title" }; patch.title = t; }
    if (args.description !== undefined) { const d = String(args.description).trim(); if (d.length > 200) return { ok: false, error: "too_long", field: "description", max: 200 }; patch.description = d; }
    if (args.thumb_url !== undefined) { const u = String(args.thumb_url || "").trim(); if (u && !okUrl(u)) return { ok: false, error: "bad_thumb" }; patch.thumb_url = u || null; }
    if (args.gift_part !== undefined) {
      const g = String(args.gift_part || "").trim();
      if (g) {
        const part = (await web.listParts(env)).find((x) => x.id === g);
        if (!part || !part.active) return { ok: false, error: "part_not_found" };
      }
      patch.gift_part = g || null;
    }
    if (action === "refresh") {
      const src = await readSource(env, p.source_post_id);
      if (!src) return { ok: false, error: "source_not_found" };
      Object.assign(patch, fromSource(src), { copied_at: now() });
      if (p.thumb_url && args.thumb_url === undefined && !src.thumb_url) delete patch.thumb_url; // 手で入れたサムネは残す
    }
    if (action === "publish") { patch.status = "published"; if (!p.published_at) patch.published_at = now(); }
    if (action === "unpublish") patch.status = "draft";
    if (action && !["publish", "unpublish", "refresh"].includes(action)) return { ok: false, error: "bad_action" };
    if (!Object.keys(patch).length) return { ok: false, error: "nothing_to_change" };
    patch.updated_at = now(); patch.updated_by = String(actor).slice(0, 200);
    await db(env, "PATCH", `b_blog_posts?id=eq.${p.id}`, patch, "return=minimal");
    await logInbound(env, "blog", { action: action || "edit", id: p.id, fields: Object.keys(patch), actor }, { ok: true }, 200);
    const v = await views(env);
    return { ok: true, post: await shape(env, { ...p, ...patch }, v[p.id]) };
  }

  // ---------- lp の住所 ----------
  async function placed(env) {
    const parts = await web.listParts(env).catch(() => []);
    const first = (pl) => (parts.find((x) => x.active && x.place === pl) || {}).id || "";
    return { ids: new Set(parts.filter((x) => x.active).map((x) => x.id)), mid: first("mid"), end: first("end"), side: first("side"), bar: first("bar") };
  }
  async function publicIndex(env) {
    const [rows, name] = await Promise.all([
      db(env, "GET", "b_blog_posts?select=slug,title,description,thumb_url,published_at&status=eq.published&order=published_at.desc&limit=100").catch(() => []),
      siteName(env),
    ]);
    const body = `<main class="bw"><div><h1 class="ba-h1" style="max-width:none">${esc(name)}</h1><p class="ba-meta">記事 ${rows.length} 本</p>${rows.length ? `<div class="bl">${rows.map(card).join("")}</div>` : "<p>まだ記事がありません。</p>"}</div></main>`;
    return shell({ title: name, description: `${name}の記事一覧`, canonical: `${origin(env)}/blog`, siteName: name, body });
  }
  async function publicArticle(env, slug, previewTok) {
    const p = await bySlug(env, slug);
    if (!p) return null;
    let preview = false;
    if (previewTok) {
      if ((await readPreviewToken(env, `blog:${p.id}`, previewTok)) == null) return null;
      preview = true;
    } else if (p.status !== "published") return null;
    const [name, pl, more] = await Promise.all([
      siteName(env), placed(env),
      db(env, "GET", `b_blog_posts?select=slug,title,description,thumb_url,published_at&status=eq.published&id=neq.${p.id}&order=published_at.desc&limit=3`).catch(() => []),
    ]);
    const gift = p.gift_part && pl.ids.has(p.gift_part) ? p.gift_part : pl.mid;
    const { body, toc } = withToc(p.body_html);
    const tocHtml = toc.length >= 3 ? `<nav class="lab-toc" aria-label="目次"><b>目次</b><ul>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join("")}</ul></nav>` : "";
    const art = `<article class="lab-article"><h1 class="ba-h1">${esc(p.title)}</h1><p class="ba-meta">${esc(jpDate(p.published_at || p.updated_at))}${preview ? "（下書きの見え方）" : ""}</p>
${p.thumb_url ? `<img class="ba-thumb" src="${esc(p.thumb_url)}" alt="">` : ""}${tocHtml}${insertMid(body, partTag(gift))}${partTag(pl.end)}</article>
${more.length ? `<section class="bmore"><h2>ほかの記事</h2><div class="bl">${more.map(card).join("")}</div></section>` : ""}`;
    const side = pl.side ? `<aside class="bs">${partTag(pl.side, "lab-side")}</aside>` : "";
    const html = `<main class="bw${side ? " has-side" : ""}"><div>${art}</div>${side}</main>${partTag(pl.bar, "lab-barpart")}`;
    const canonical = `${origin(env)}/blog/${p.slug}`;
    const embed = `<script src="/_lab/embed.js" defer data-page="${esc(p.id)}" data-preview="${preview ? "1" : "0"}" data-kind="blog"></script>`;
    return {
      preview,
      html: shell({
        title: `${p.title}｜${name}`, description: p.description, canonical, image: p.thumb_url, siteName: name, body: html, embed, noindex: preview,
        jsonld: { "@context": "https://schema.org", "@type": "Article", headline: p.title, datePublished: p.published_at || undefined, dateModified: p.updated_at || undefined, image: p.thumb_url || undefined, mainEntityOfPage: canonical, author: { "@type": "Person", name }, publisher: { "@type": "Organization", name } },
      }),
    };
  }
  async function sitemap(env) {
    const rows = await db(env, "GET", "b_blog_posts?select=slug,updated_at&status=eq.published&order=published_at.desc&limit=5000").catch(() => []);
    const o = origin(env);
    const urls = [`<url><loc>${esc(o)}/blog</loc></url>`, ...rows.map((r) => `<url><loc>${esc(o)}/blog/${esc(r.slug)}</loc>${r.updated_at ? `<lastmod>${esc(String(r.updated_at).slice(0, 10))}</lastmod>` : ""}</url>`)];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
  }
  // 見た（embed.js の send("view") がページの口へ来て、ページで無かったときにここへ回る）
  async function hit(env, body = {}, cid = null) {
    if (body.kind !== "view") return { ok: false, error: "bad_kind" };
    const p = await byId(env, body.page);
    if (!p || p.status !== "published") return { ok: false, error: "not_found" };
    const vid = String(body.vid || "");
    if (!VID_RE.test(vid)) return { ok: false, error: "bad_vid" };
    await db(env, "POST", "b_blog_hits", [{ post_id: p.id, vid, customer_id: cid, at: now() }], "return=minimal");
    return { ok: true };
  }

  return { get, sources, copy, save, publicIndex, publicArticle, sitemap, hit, views };
}

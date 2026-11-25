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
// 便 C（2026-11-24）：メンシプ記事（membership）も選べる。本文は写さず、題名・説明・note へのボタンだけ（有料の部分を外に出さないため）
const SOURCE_TYPES = ["x_article", "note", "membership"];
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
// 便 C（2026-11-24）：YouTube の埋め込み。iframe と、1 段落に YouTube の住所だけがあるものを、決まった形の埋め込みに替える（ほかの iframe は今までどおり消す）
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export function ytId(u) {
  try {
    const x = new URL(unent(String(u || "")).trim());
    if (x.protocol !== "https:") return "";
    const h = x.hostname.replace(/^(www|m)[.]/, "");
    let id = "";
    if (h === "youtu.be") id = x.pathname.slice(1).split("/")[0];
    else if (h === "youtube.com" || h === "youtube-nocookie.com") {
      if (x.pathname === "/watch") id = x.searchParams.get("v") || "";
      else { const m = x.pathname.match(/^[/](?:embed|shorts|live)[/]([^/?#]+)/); if (m) id = m[1]; }
    }
    return YT_ID.test(id) ? id : "";
  } catch { return ""; }
}
const YT_MARK = (id) => `@@labyt:${id}@@`;
export const ytEmbed = (id) => `<div class="lab-yt"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube の動画" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
function markYoutube(html) {
  return String(html || "")
    .replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>/gi, (all, attrs) => { const id = ytId(attrsOf(attrs).src); return id ? YT_MARK(id) : all; })
    .replace(/<p>\s*(?:<a\b([^>]*)>[^<]*<\/a>|(https:[/][/][^\s<]+))\s*<\/p>/gi, (all, attrs, bare) => { const id = ytId(bare || attrsOf(attrs).href); return id ? YT_MARK(id) : all; });
}
export function cleanHtml(html) {
  let s = markYoutube(String(html || "").replace(/<!--[\s\S]*?-->/g, "")).replace(DROP_WITH_BODY, "");
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
  s = s.replace(/@@labyt:([A-Za-z0-9_-]{11})@@/g, (_, id) => ytEmbed(id));
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
// メンシプ記事の本文の欄：説明と note へのボタンだけ（住所が無い間はボタンを出さない）
export function membershipBody(link) {
  const ok = okUrl(link);
  return `<div class="lab-mship"><p>この記事の続きは note のメンバーシップで読めます。</p>${ok ? `<a href="${esc(link)}" rel="noopener" target="_blank">note で続きを読む</a>` : ""}</div>`;
}
export const isMembershipBody = (html) => /^<div class="lab-mship">/.test(String(html || ""));
export function membershipLink(html) {
  if (!isMembershipBody(html)) return "";
  const m = String(html).match(/<a href="(https:[/][/][^"]+)"/);
  return m ? unent(m[1]) : "";
}
// 公式サイトの作り直し 便 3：記事の途中から会員限定。members_from 番目の見出し（h2）から後ろを外して、登録した人にだけ返す
export const MEMBERS_MAX = 50;
export function headingsOf(html) { return withToc(html).toc.map((t) => t.text); }
export function splitMembers(body, from) {
  const k = Number(from) || 0;
  if (!k) return { free: body, rest: "" };
  const i = String(body || "").indexOf(`<h2 id="s${k}">`);
  if (i < 0) return { free: body, rest: "" };
  return { free: body.slice(0, i), rest: body.slice(i) };
}
// 便 3：YouTube を外から動かせる形にする（続きから再生・速さ）。動画の印 data-yt を付ける
export function ytPlayable(html) {
  return String(html || "").replace(/<div class="lab-yt"><iframe src="https:[/][/]www[.]youtube-nocookie[.]com[/]embed[/]([A-Za-z0-9_-]{11})"/g,
    (_, id) => `<div class="lab-yt" data-yt="${id}"><iframe src="https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&amp;rel=0&amp;playsinline=1"`);
}
const partTag = (id, cls = "") => id ? `<div${cls ? ` class="${cls}"` : ""} data-lab-part="part:${esc(id)}"></div>` : "";
const jpDate = (iso) => { const d = new Date(iso || 0); if (!iso || isNaN(d)) return ""; const j = new Date(d.getTime() + 9 * 3600e3); return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`; };

// ---------- 画面の外枠（一覧と記事で共通） ----------
// 公式サイトの作り直し 便 3（2026-11-25 Naoki OK）：草案 v0.7 の見た目（紙の白・墨・赤ペン 1 色）にそろえる。
//   頭（ロゴ・案内・ログイン・無料会員登録）と足（規約など）はホームと同じ。押す所は 44px 以上
const SHELL_CSS = `*{box-sizing:border-box}body{margin:0;background:#fcfbf8;color:#1a1a1a;font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8;font-size:16px}
a{color:#1a1a1a}:focus-visible{outline:3px solid #1a1a1a;outline-offset:3px}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
.skip{position:absolute;left:8px;top:-60px;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;z-index:30}.skip:focus{top:8px}
.sh{border-bottom:1px solid #d9d6cf;background:#fcfbf8}.sh>div{max-width:1280px;margin:0 auto;padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:16px 32px}
.sh .logo{font-weight:700;font-size:24px;letter-spacing:.04em;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.sh nav{display:flex;flex-wrap:wrap;gap:8px 24px;flex:1 1 auto}.sh nav a{padding:8px 0;text-decoration:none}
.sh .join{background:#c8102e;color:#fff;font-weight:700;padding:0 24px;border-radius:8px;min-height:44px;display:inline-flex;align-items:center;text-decoration:none}
.bw{max-width:1280px;margin:0 auto;padding:32px 24px 96px;display:flex;flex-wrap:wrap;gap:48px;align-items:flex-start}.bw>div{flex:999 1 640px;min-width:0}
.bs{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:32px}
.crumb{display:block;margin:0 0 16px;font-size:14px;color:#555}.crumb a{color:#555}
.lab-article{width:100%;max-width:760px;color:#1a1a1a;font-family:inherit}.lab-article h1,.lab-article h2,.lab-article h3{font-family:inherit;font-weight:700}.lab-article h2{border-left:0;padding:0;background:none}.lab-article p{font-size:inherit;line-height:inherit}.ba-h1{font-size:32px;line-height:1.45;margin:0 0 8px;font-weight:700}
.ba-meta{color:#555;font-size:14px;margin:0 0 24px}.ba-meta a{color:#555}.ba-thumb{width:100%;aspect-ratio:1200/630;object-fit:cover;border:1px solid #d9d6cf;border-radius:8px;margin:0 0 24px;display:block}
.ba-body{font-size:18px;line-height:2}.ba-body h2{font-size:24px;line-height:1.5;margin:48px 0 12px}.ba-body h3{font-size:20px;margin:32px 0 8px}.ba-body p{margin:0 0 20px}.ba-body img{max-width:100%;height:auto;border:1px solid #d9d6cf;border-radius:8px}
.lab-toc{background:#f3f1eb;border-radius:8px;padding:20px 24px;margin:0 0 32px}.lab-toc b{font-size:16px}.lab-toc ul{margin:8px 0 0;padding:0 0 0 20px}.lab-toc li{margin:4px 0}.lab-toc small{color:#555;font-size:14px}
.lab-article blockquote{margin:0 0 20px;padding:8px 16px;border-left:4px solid #d9d6cf;color:#555}
.lab-article table{border-collapse:collapse;width:100%;margin:0 0 20px;font-size:16px}.lab-article th,.lab-article td{border:1px solid #d9d6cf;padding:8px;text-align:left}
.lab-yt{position:relative;aspect-ratio:16/9;margin:0 0 8px;background:#1a1a1a;border-radius:8px}.lab-yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px}
.lab-ytc{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 24px;font-size:16px}
.lab-ytc button{min-height:44px;min-width:44px;padding:0 16px;border-radius:8px;border:1px solid #8a867d;background:#fff;color:#1a1a1a;font:inherit;font-size:16px;font-weight:700;cursor:pointer}.lab-ytc button[aria-pressed=true]{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
.lab-ytc .lab-resume{background:#f3f1eb;border-color:#f3f1eb}.lab-ytc span{color:#555;font-size:14px}
.lab-mship{border:1px solid #d9d6cf;border-radius:8px;background:#fff;padding:24px;margin:0 0 20px}.lab-mship p{margin:0 0 16px;color:#555}
.lab-mship a{display:inline-flex;align-items:center;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:700;padding:0 24px;border-radius:8px;min-height:48px}
.lab-free-end{position:relative}html:not(.lab-in) .lab-has-wall .lab-free-end>:last-child{-webkit-mask-image:linear-gradient(#000 20%,transparent);mask-image:linear-gradient(#000 20%,transparent)}
.lab-wall{border:1px solid #8a867d;border-radius:8px;padding:32px;display:flex;flex-direction:column;gap:16px;margin:8px 0 32px;background:#fff}
.lab-wall .k{margin:0;font-size:14px;font-weight:700;color:#c8102e}.lab-wall h2{margin:0;font-size:24px;line-height:1.5}.lab-wall p{margin:0}
.lab-wall .go{display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;min-height:52px;padding:0 32px;background:#c8102e;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}
.lab-wall small{font-size:14px;color:#555}.lab-wall small a{color:#c8102e}
.w-next{max-width:760px;margin:40px 0 0;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:#f3f1eb;border-radius:8px;padding:24px}
.w-next p{margin:0;font-size:14px;color:#555}.w-next b{display:block;font-size:18px;margin-top:4px}.w-next a{display:inline-flex;align-items:center;min-height:48px;background:#1a1a1a;color:#fff;padding:0 24px;border-radius:8px;font-weight:700;text-decoration:none}
.w-box{border:1px solid #d9d6cf;border-radius:8px;padding:24px;background:#fff}.w-box h2{margin:0 0 4px;font-size:18px}.w-box .c{margin:0 0 12px;font-size:14px;color:#555}
.w-bar{height:6px;background:#d9d6cf;border-radius:8px;margin:0 0 16px;overflow:hidden}.w-bar i{display:block;height:6px;width:0;background:#c8102e}
.w-ord{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}.w-ord a{display:flex;gap:12px;align-items:center;min-height:44px;padding:8px;border-radius:8px;text-decoration:none;font-size:16px}
.w-ord a[aria-current=page]{background:#f3f1eb}.w-ord .no{flex:none;width:28px;height:28px;border-radius:8px;background:#d9d6cf;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
.w-ord a[aria-current=page] .no{background:#c8102e;color:#fff}.w-ord .done .no{background:#1a1a1a;color:#fff}.w-ord .t{flex:1 1 auto}.w-ord .tag{font-size:14px;color:#555;white-space:nowrap}
.w-consult{border:2px solid #1a1a1a;border-radius:8px;padding:24px;background:#fff}.w-consult .k{margin:0 0 8px;font-size:14px;font-weight:700}.w-consult h2{margin:0 0 8px;font-size:24px;line-height:1.5}.w-consult p{margin:0 0 16px}
.w-consult a{display:flex;align-items:center;justify-content:center;min-height:48px;background:#c8102e;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}
.w-rel h2{margin:0 0 16px;font-size:18px}.w-rel ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px}.w-rel a{display:flex;gap:12px;text-decoration:none}
.w-rel i{flex:none;width:144px;aspect-ratio:16/9;border:1px solid #d9d6cf;border-radius:8px;background:#fff center/cover no-repeat;display:flex;align-items:flex-end;padding:8px}.w-rel i.np::after{content:"";display:block;width:32px;height:4px;background:#c8102e;border-radius:2px}
.w-rel b{display:block;font-size:16px;line-height:1.5}.w-rel small{display:block;font-size:14px;color:#555;margin-top:4px}
.bs .lab-side{position:static}
.lab-barpart{display:none}@media(max-width:760px){.lab-barpart.lab-part{display:block;position:fixed;left:8px;right:8px;bottom:8px;margin:0;z-index:20;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.18)}.lab-barpart .lab-part-p{display:none}body{padding-bottom:120px}}
.bl{display:grid;gap:32px 24px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.bc{display:flex;flex-direction:column;gap:8px;text-decoration:none}.bc i{display:block;aspect-ratio:1200/630;border:1px solid #d9d6cf;border-radius:8px;background:#fff center/cover no-repeat}.bc.nt i{display:flex;align-items:flex-end;padding:12px}.bc.nt i::after{content:"";display:block;width:48px;height:4px;background:#c8102e;border-radius:2px}
.bc b{display:block;font-size:18px;line-height:1.5}.bc p{margin:0;font-size:14px;color:#555;line-height:1.7}.bc small{display:block;color:#555;font-size:14px}
.bf{border-top:1px solid #d9d6cf}.bf>div{max-width:1280px;margin:0 auto;padding:24px;display:flex;flex-wrap:wrap;align-items:center;gap:0 24px;font-size:14px;color:#555}.bf a{color:#555;padding:12px 0}.bf span:last-child{margin-left:auto}
@media (max-width:600px){.bw{padding-top:24px}.lab-wall{padding:24px}.w-rel i{width:112px}.ba-h1{font-size:24px}}
/* 公式サイトの作り直し 便 6：埋め込みのフォーム（会員限定の続きの登録の枠）を v0.7 の見た目に */
.lab-form{display:flex;flex-direction:column;gap:16px;font-size:16px;max-width:none;margin:0}.lab-form label{display:block;font-size:16px;font-weight:700;margin:0 0 8px}.lab-form .lab-note{font-weight:400;color:#555;font-size:14px;opacity:1}.lab-form .lab-input{width:100%;font:inherit;font-size:16px;padding:14px 16px;min-height:52px;border:1px solid #8a867d;border-radius:8px;background:#fff;color:#1a1a1a}.lab-form .lab-input[aria-invalid=true]{border:2px solid #c8102e}.lab-form .lab-check{display:flex;gap:12px;align-items:flex-start;font-weight:400;font-size:14px;line-height:1.7}.lab-form .lab-check input{width:24px;height:24px;flex:none;margin:0}.lab-form .lab-btn{min-height:56px;line-height:1.4;border:0;border-radius:8px;background:#c8102e;color:#fff;font:inherit;font-size:18px;font-weight:700;cursor:pointer}.lab-form .lab-btn:disabled{background:#8a867d;opacity:1;cursor:default}.lab-form .lab-err{color:#c8102e;font-weight:700;font-size:14px}.lab-form .lab-err:empty{display:none}`;
const LEGAL = "https://lab.shia2n.jp/legal";
function shell({ title, description, canonical, image, siteName, body, embed, jsonld, noindex, join = "/xmas-gift" }) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ""}${noindex ? '<meta name="robots" content="noindex">' : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">` : ""}<meta property="og:title" content="${esc(title)}"><meta property="og:site_name" content="${esc(siteName)}">${description ? `<meta property="og:description" content="${esc(description)}">` : ""}
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kurenaido&display=swap">
<link rel="stylesheet" href="/_lab/look.css"><style>${SHELL_CSS}</style>${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><a class="skip" href="#main">本文へ移動</a>
<header class="sh"><div><a class="logo" href="/">${esc(siteName)}</a><nav aria-label="サイトの案内"><a href="/#start">はじめての方へ</a><a href="/gift">会員限定コンテンツ</a><a href="/chat">チャット</a><a href="/#consult">個別相談</a><a href="/blog">記事一覧</a></nav>
<div data-lab-part="account"></div><a class="join" href="${esc(join)}" data-lab-button="head-join">無料会員登録</a></div></header>
${body}
<footer class="bf"><div><span style="font-weight:700;color:#1a1a1a">${esc(siteName)}</span><a href="${LEGAL}/terms">利用規約</a><a href="${LEGAL}/privacy">プライバシーポリシー</a><a href="${LEGAL}/tokushoho">特定商取引法に基づく表記</a><span>© 株式会社Best Life Consulting</span></div></footer>${embed || `<script src="/_lab/embed.js" defer data-kind="site"></script>`}</body></html>`;
}
// サムネの無い記事は画像の枠を出さない（灰色の箱が並ぶのを避ける）
const card = (p) => `<a class="bc${p.thumb_url ? "" : " nt"}" href="/blog/${esc(p.slug)}"><i${p.thumb_url ? ` style="background-image:url('${esc(p.thumb_url)}')"` : ""} aria-hidden="true"></i><b>${esc(p.title)}</b>${p.description ? `<p>${esc(p.description.slice(0, 80))}${p.description.length > 80 ? "…" : ""}</p>` : ""}<small>${esc(jpDate(p.published_at))}</small></a>`;

// home(env)：公式サイトのホームの中身（本棚・サイドバー。sitehome.js の publicHome）。canOpen(env, {u,g,site})：登録した人か
export function makeBlog({ db, logInbound, web, pagesOrigin, previewToken, readPreviewToken, home = null, canOpen = null }) {
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
    category: p.category || "", members_from: p.members_from || 0, headings: isMembershipBody(p.body_html) ? [] : headingsOf(p.body_html),
    ...(isMembershipBody(p.body_html) ? { kind: "membership", link_url: membershipLink(p.body_html) } : {}),
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
  const fromSource = (src, link) => {
    const body = cleanHtml(src.body);
    if (src.post_type === "membership") {
      // メンシプ記事は本文を写さない。説明の元にする書き出しだけ読み、本文の欄には note へのボタンだけを置く
      return { body_html: membershipBody(link), thumb_url: okUrl(src.thumb_url) ? src.thumb_url : null, source_updated_at: src.updated_at || null, _lead: plainText(body).slice(0, 120) };
    }
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
    const f = fromSource(src, "");
    const lead = f._lead; delete f._lead;
    const row = {
      id: crypto.randomUUID(), slug: s, title: String(src.title || "").slice(0, 120) || "（題なし）", description: lead != null ? lead : plainText(f.body_html).slice(0, 120),
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
    // 公式サイトの作り直し 便 1：カテゴリ（20 字まで・空で外す）
    if (args.category !== undefined) { const c = String(args.category || "").trim(); if (c.length > 20) return { ok: false, error: "too_long", field: "category", max: 20 }; patch.category = c || null; }
    // 便 3：会員限定にする所（N 番目の見出しから後ろ）。0 か空で外す。メンシプ記事には付けない（本文が無いため）
    if (args.members_from !== undefined) {
      const k = args.members_from === "" || args.members_from === null ? 0 : Number(args.members_from);
      if (!Number.isInteger(k) || k < 0 || k > MEMBERS_MAX) return { ok: false, error: "bad_members_from" };
      if (k && isMembershipBody(p.body_html)) return { ok: false, error: "not_for_membership" };
      if (k && k > headingsOf(p.body_html).length) return { ok: false, error: "no_such_heading", headings: headingsOf(p.body_html).length };
      patch.members_from = k || null;
    }
    if (args.gift_part !== undefined) {
      const g = String(args.gift_part || "").trim();
      if (g) {
        const part = (await web.listParts(env)).find((x) => x.id === g);
        if (!part || !part.active) return { ok: false, error: "part_not_found" };
      }
      patch.gift_part = g || null;
    }
    // メンシプ記事：note の記事の住所（link_url）でボタンを作る。住所は本文の欄のボタンにだけ持つ
    const src0 = p.source_post_id ? await readSource(env, p.source_post_id) : null;
    const isMship = !!(src0 && src0.post_type === "membership");
    let link = isMship ? membershipLink(p.body_html) : "";
    if (args.link_url !== undefined) {
      if (!isMship) return { ok: false, error: "not_membership" };
      const u = String(args.link_url || "").trim();
      if (u && !okUrl(u)) return { ok: false, error: "bad_link_url" };
      link = u; patch.body_html = membershipBody(u);
    }
    if (action === "refresh") {
      const src = src0;
      if (!src) return { ok: false, error: "source_not_found" };
      const f = fromSource(src, link); delete f._lead;
      Object.assign(patch, f, { copied_at: now() });
      if (p.thumb_url && args.thumb_url === undefined && !src.thumb_url) delete patch.thumb_url; // 手で入れたサムネは残す
    }
    if (action === "publish") {
      if (isMship && !link) return { ok: false, error: "need_link_url", note: "メンシプ記事は note の記事の住所（link_url）を入れてから公開する" };
      patch.status = "published"; if (!p.published_at) patch.published_at = now();
    }
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
  // 公式サイトの作り直し 便 2：?cat= でカテゴリに絞る（ホームのサイドバーのカテゴリから来る）
  async function publicIndex(env, { cat = "" } = {}) {
    const c = String(cat || "").trim().slice(0, 20);
    const [rows, name] = await Promise.all([
      db(env, "GET", `b_blog_posts?select=slug,title,description,thumb_url,published_at&status=eq.published${c ? `&category=eq.${encodeURIComponent(c)}` : ""}&order=published_at.desc&limit=100`).catch(() => []),
      siteName(env),
    ]);
    const body = `<main class="bw" id="main" tabindex="-1"><div><nav class="crumb" aria-label="現在地"><a href="/">ホーム</a> ／ 記事一覧${c ? ` ／ ${esc(c)}` : ""}</nav><h1 class="ba-h1">${esc(c || "記事一覧")}</h1><p class="ba-meta">${c ? `カテゴリ ・ ` : ""}記事 ${rows.length} 本${c ? ` ・ <a href="/blog">すべての記事</a>` : ""}</p>${rows.length ? `<div class="bl">${rows.map(card).join("")}</div>` : "<p>まだ記事がありません。</p>"}</div></main>`;
    return shell({ join: await joinHref(env), title: c ? `${c}｜${name}` : name, description: c ? `${name}の「${c}」の記事一覧` : `${name}の記事一覧`, canonical: `${origin(env)}/blog${c ? `?cat=${encodeURIComponent(c)}` : ""}`, siteName: name, body });
  }
  const joinHref = async (env) => {
    if (!home) return "/xmas-gift";
    const h = await home(env).catch(() => null);
    const j = (h && h.sidebar && h.sidebar.join) || {};
    return /^[/](?![/])/.test(j.href || "") || /^https:[/][/]/.test(j.href || "") ? j.href : "/xmas-gift";
  };
  // 本文を出す形にする（見出しの印・YouTube を動かせる形・会員限定で分ける）。gate と記事の画面で同じものを使う
  function render(p) {
    const { body, toc } = withToc(p.body_html);
    const { free, rest } = splitMembers(ytPlayable(body), isMembershipBody(p.body_html) ? 0 : p.members_from);
    return { free, rest, toc, video: /data-yt=/.test(free + rest) };
  }
  // 本棚のどの棚の何本目か。?s=（1 から）で棚を選ぶ。無ければこの記事が入っている最初の棚
  function shelfOf(h, slug, s) {
    const shelves = (h && h.shelves) || [];
    const pickI = Number(s) - 1;
    const order = Number.isInteger(pickI) && shelves[pickI] && shelves[pickI].books.some((b) => b.slug === slug) ? [pickI] : shelves.map((_, i) => i);
    for (const i of order) { const k = shelves[i].books.findIndex((b) => b.slug === slug); if (k >= 0) return { i, k, shelf: shelves[i] }; }
    return null;
  }
  const relHref = (h) => (/^#[A-Za-z0-9_-]+$/.test(h || "") ? "/" + h : /^[/](?![/])/.test(h || "") || /^https:[/][/]/.test(h || "") ? h : "/#consult");
  async function publicArticle(env, slug, previewTok, { s: shelfParam = "" } = {}) {
    const p = await bySlug(env, slug);
    if (!p) return null;
    let preview = false;
    if (previewTok) {
      if ((await readPreviewToken(env, `blog:${p.id}`, previewTok)) == null) return null;
      preview = true;
    } else if (p.status !== "published") return null;
    const relQ = (cols) => db(env, "GET", `b_blog_posts?select=${cols}&status=eq.published&id=neq.${p.id}&order=published_at.desc&limit=40`);
    const [name, pl, others, h] = await Promise.all([
      siteName(env), placed(env),
      relQ("slug,title,thumb_url,published_at,category,members_from").catch(() => relQ("slug,title,thumb_url,published_at")).catch(() => []),
      home ? home(env).catch(() => null) : null,
    ]);
    const { free, rest, toc, video } = render(p);
    const gated = !!rest;
    const at = shelfOf(h, p.slug, shelfParam);
    const books = at ? at.shelf.books : [];
    const next = at && books[at.k + 1] ? books[at.k + 1] : null;
    const memberSlugs = new Set(others.filter((o) => o.members_from).map((o) => o.slug).concat(gated ? [p.slug] : []));
    const join = (h && h.sidebar && h.sidebar.join) || {};
    const joinTo = await joinHref(env);
    // 本文の途中の特典は、会員限定の枠が無い記事だけ（枠があるときは登録の枠がその役をする）
    const gift = p.gift_part && pl.ids.has(p.gift_part) ? p.gift_part : pl.mid;
    const lockedFrom = gated ? Number(p.members_from) - 1 : -1;
    const tocHtml = toc.length >= 3 ? `<nav class="lab-toc" aria-label="目次"><b>目次</b><ul>${toc.map((t, i) => `<li><a href="#${t.id}">${esc(t.text)}</a>${lockedFrom >= 0 && i >= lockedFrom ? " <small>（会員限定）</small>" : ""}</li>`).join("")}</ul></nav>` : "";
    const wall = gated ? `<section class="lab-wall" data-lab-guest aria-labelledby="wall-h"><p class="k">この続きは会員限定です</p><h2 id="wall-h">無料会員登録で、続きをお読みいただけます</h2>
<p>メールアドレスだけで登録でき、このページのまま続きが表示されます。会員限定コンテンツもご利用いただけます。</p>
${join.form ? `<div data-lab-part="form:${esc(join.form)}" data-lab-cta="登録して続きを読む"></div>` : `<a class="go" href="${esc(joinTo)}" data-lab-button="wall-join">無料会員登録</a>`}
<small>登録済みの方は <a href="/login?next=${encodeURIComponent("/blog/" + p.slug)}">ログイン</a></small></section><div data-lab-gated="0" hidden></div>` : "";
    const bodyHtml = gated ? `<div class="lab-has-wall"><div class="lab-free-end">${free}</div>${wall}</div>` : insertMid(free, partTag(gift));
    const where = at ? `<a href="/">ホーム</a> ／ ${esc(at.shelf.name)} ／ ${at.k + 1}本目` : `<a href="/">ホーム</a> ／ <a href="/blog">記事一覧</a>${p.category ? ` ／ <a href="/blog?cat=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ""}`;
    const meta = [jpDate(p.published_at || p.updated_at) + (preview ? "（下書きの見え方）" : ""), video ? "動画" : "", p.category ? `<a href="/blog?cat=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : "", at ? `${at.k + 1}本目 ／ 全${books.length}本` : "", gated ? "途中から会員限定" : ""].filter(Boolean);
    const art = `<nav class="crumb" aria-label="現在地">${where}</nav>
<article class="lab-article" data-slug="${esc(p.slug)}" data-video="${video ? "1" : "0"}"><h1 class="ba-h1">${esc(p.title)}</h1><p class="ba-meta">${meta.map((m) => (m.startsWith("<a") ? m : esc(m))).join(" ・ ")}</p>
${p.thumb_url && !video ? `<img class="ba-thumb" src="${esc(p.thumb_url)}" alt="">` : ""}${tocHtml}<div class="ba-body">${bodyHtml}</div>${partTag(pl.end)}<div data-lab-end></div></article>
${next ? `<section class="w-next" aria-label="次の記事"><div><p>次の記事（${esc(at.shelf.name)} ${at.k + 2}本目）</p><b>${esc(next.title)}</b></div><a href="/blog/${esc(next.slug)}?s=${at.i + 1}">次の記事へ</a></section>` : ""}`;
    // 横：個別相談（残り枠）・おすすめの順番（進み具合）・関連記事・横の部品
    const c = (h && h.sidebar && h.sidebar.consult) || {};
    const consult = c.title ? `<section class="w-consult" aria-labelledby="wc-h"><p class="k">人数限定</p><h2 id="wc-h">${esc(c.title)}</h2>${c.body ? `<p>${esc(c.body)}</p>` : ""}${typeof c.left === "number" ? (c.left > 0 ? `<p>今月の募集枠：<b>残り ${c.left} 名</b></p>` : "<p><b>今月の募集枠は埋まりました。</b>次回はメールでお知らせします。</p>") : ""}${c.left === 0 ? "" : `<a href="${esc(relHref(c.href))}" data-lab-button="side-consult">${esc(c.cta || "予約する")}</a>`}</section>` : "";
    const order = at ? `<section class="w-box" aria-labelledby="wo-h" data-lab-order="${esc(books.map((b) => b.slug).join(","))}"><h2 id="wo-h">おすすめの順番</h2><p class="c" data-lab-count>${esc(at.shelf.name)} ・ 全${books.length}本</p><div class="w-bar" aria-hidden="true"><i></i></div>
<ol class="w-ord">${books.map((b, i) => `<li><a href="/blog/${esc(b.slug)}?s=${at.i + 1}" data-slug="${esc(b.slug)}"${i === at.k ? ' aria-current="page"' : ""}><span class="no">${i + 1}</span><span class="t">${esc(b.title)}</span><span class="tag">${i === at.k ? "今の記事" : memberSlugs.has(b.slug) ? "会員限定" : esc(b.kind || "")}</span></a></li>`).join("")}</ol></section>` : "";
    const nextSlug = next ? next.slug : "";
    const same = p.category ? others.filter((o) => o.category === p.category && o.slug !== nextSlug) : [];
    const rel = [...same, ...others.filter((o) => !same.includes(o) && o.slug !== nextSlug)].slice(0, 4);
    const related = rel.length ? `<section class="w-rel" aria-labelledby="wr-h"><h2 id="wr-h">関連記事</h2><ul>${rel.map((o) => `<li><a href="/blog/${esc(o.slug)}"><i${o.thumb_url ? ` style="background-image:url('${esc(o.thumb_url)}')"` : ' class="np"'} aria-hidden="true"></i><span><b>${esc(o.title)}</b><small>${[o.category, jpDate(o.published_at), o.members_from ? "途中から会員限定" : ""].filter(Boolean).map(esc).join(" ・ ")}</small></span></a></li>`).join("")}</ul></section>` : "";
    const side = consult + order + related + (pl.side ? partTag(pl.side, "lab-side") : "");
    const html = `<main class="bw" id="main" tabindex="-1"><div>${art}</div>${side ? `<aside class="bs" aria-label="ご案内とおすすめ">${side}</aside>` : ""}</main>${partTag(pl.bar, "lab-barpart")}`;
    const canonical = `${origin(env)}/blog/${p.slug}`;
    const embed = `<script src="/_lab/embed.js" defer data-page="${esc(p.id)}" data-preview="${preview ? "1" : "0"}" data-kind="blog"></script>`;
    // 写したときに本文から自動で作った説明は、会員限定の所を含みうるので、だれでも読める所から作り直して出す
    const description = gated && p.description === plainText(p.body_html).slice(0, 120) ? plainText(free).slice(0, 120) : p.description;
    return {
      preview,
      html: shell({
        join: joinTo,
        title: `${p.title}｜${name}`, description, canonical, image: p.thumb_url, siteName: name, body: html, embed, noindex: preview,
        jsonld: { "@context": "https://schema.org", "@type": "Article", headline: p.title, datePublished: p.published_at || undefined, dateModified: p.updated_at || undefined, image: p.thumb_url || undefined, mainEntityOfPage: canonical, author: { "@type": "Person", name }, publisher: { "@type": "Organization", name }, ...(gated ? { isAccessibleForFree: false, hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".lab-wall" } } : {}) },
      }),
    };
  }
  // 便 3：会員限定の続き。登録した人（登録の印・公式サイトのログイン）にだけ返す。見本の印なら確かめのため印なしで返す
  async function gate(env, { page, u, g, site, preview: pv } = {}) {
    const p = await byId(env, page);
    if (!p) return { ok: false, error: "not_found" };
    if (pv) { if ((await readPreviewToken(env, `blog:${p.id}`, pv)) == null) return { ok: false, error: "not_found" }; }
    else if (p.status !== "published") return { ok: false, error: "not_found" };
    const { rest } = render(p);
    if (!rest) return { ok: true, locked: false, blocks: [] };
    if (!pv && !(canOpen && (await canOpen(env, { u, g, site }).catch(() => false)))) return { ok: true, locked: true, count: 1 };
    return { ok: true, locked: false, blocks: [rest] };
  }
  // 便 X1：公開中の新しい記事 n 本（ページの印 blog:latest-n が読む）。下書き・止めた記事は出さない
  async function latest(env, n = 8) {
    const k = Math.min(24, Math.max(1, Number(n) || 8));
    // カテゴリの欄（b_blog_category.sql）がまだ無いときは、欄なしで読み直す
    const q = (cols) => db(env, "GET", `b_blog_posts?select=${cols}&status=eq.published&order=published_at.desc&limit=${k}`);
    const rows = await q("slug,title,thumb_url,published_at,category").catch(() => q("slug,title,thumb_url,published_at")).catch(() => []);
    return { ok: true, posts: rows.map((r) => ({ slug: r.slug, title: r.title, thumb_url: r.thumb_url || "", date: jpDate(r.published_at), category: r.category || "" })) };
  }
  // 公式サイトの作り直し 便 1：カテゴリと本数（公開中の記事だけ・本数の多い順）。欄がまだ無ければ空
  async function categories(env) {
    const rows = await db(env, "GET", "b_blog_posts?select=category&status=eq.published&category=not.is.null&limit=5000").catch(() => []);
    const n = new Map();
    for (const r of rows) { const c = String(r.category || "").trim(); if (c) n.set(c, (n.get(c) || 0) + 1); }
    return { ok: true, categories: [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(([name, count]) => ({ name, count })) };
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

  return { get, sources, copy, save, publicIndex, publicArticle, gate, latest, categories, sitemap, hit, views };
}

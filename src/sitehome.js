// 公式サイトの作り直し 便 2（2026-11-25 Naoki OK）：公式サイトのホームの中身（スライダー・本棚・サイドバー）
// - 置き場は R2（IMAGES）の site/home.json 1 つ（b_settings は 1 行 500 字までで入らないため）。Naoki が /admin の「ブログ・公開ページ › ホーム」で差し替える
// - ページ（slug home）の HTML に印を置くと、embed.js が /api/p/home を読んで描く：
//     data-lab-part="slider:home" … スライダー（一時停止・前へ／次へ・番号・「2 / 4」。動きを減らす設定の人には止めて出す）
//     data-lab-part="shelf:home"  … 本棚（棚の切り替え・1 本目に「ここから」）
//     data-lab-part="sidebar:home"… サイドバー（無料会員登録・個別相談の残り枠・メンバーシップ）
//     data-lab-part="categories"  … 記事のカテゴリと本数
//     data-lab-part="account"     … ログイン／ログイン中の名前とログアウト
// - 残り枠は予約のメニューの「先着の数」から引く。本棚の記事は公開中のものだけ出す（下書きや止めた記事は黙って抜く）
export const HOME_KEY = "site/home.json";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const FORM_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const LIM = { slides: 8, shelves: 3, books: 12, chips: 6 };

export const HOME_DEFAULT = {
  slides: [
    { label: "クリスマス特別コンテンツ ・ 無料 ・ ［12/25 公開］", title: "マネタイズロードマップ動画を、登録した人全員に。", body: "［仮のコピー］ブランディング設計の解説とシートもお付けします。ご登録後すぐにご覧いただけます。", cta: "無料で受け取る", href: "/xmas-gift", img: "", alt: "", note: "登録だけで全部ひらく" },
    { label: "人数限定 ・ 今月の募集枠", title: "AI活用コンサルモニターを募集しています。", body: "［仮のコピー：対象・やること・人数を Naoki の言葉で］", cta: "予約する", href: "#consult", img: "", alt: "", note: "埋まったら次回はメールで" },
  ],
  shelves: [
    { name: "これから始める方", who: "発信の基本から", posts: [] },
    { name: "発信中の方", who: "伸ばす・書けるようになる", posts: [] },
    { name: "収益化したい方", who: "発信を収入につなげる", posts: [] },
  ],
  sidebar: {
    join: { title: "無料会員登録", body: "会員限定コンテンツ・チャット・新着のお知らせをご利用いただけます", form: "", cta: "無料会員登録", href: "/xmas-gift" },
    consult: { title: "個別相談（AI活用コンサルモニター）", body: "［仮のコピー］", booking: "", cta: "予約する", href: "#consult" },
    membership: { title: "メンバーシップ", body: "毎週の記事は note のメンバーシップでお読みいただけます。", cta: "詳しく見る", href: "" },
  },
  // 便 5：公式サイトのチャット（登録した人がはじめて開いたときの自動メッセージ・返信の目安・選ぶだけで送れる文）
  chat: {
    welcome: "ご登録ありがとうございます。シアニンです。会員限定コンテンツから、すぐにご覧いただけます。\n最初に1つだけ教えてください。いま一番困っていることは何ですか？［文面は仮］",
    eta: "24時間以内",
    chips: ["何を発信すればいいかわからない", "書いても伸びない", "発信を収入につなげたい", "先に会員限定コンテンツを見ます"],
  },
};

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
function okHref(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^#[A-Za-z0-9_-]{1,40}$/.test(s)) return s;
  if (/^[/](?![/\\])[^\s<>"']{0,200}$/.test(s)) return s;
  if (/^https:[/][/][^\s<>"']{3,400}$/.test(s)) return s;
  return null;
}
function okImg(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:[/][/][^\s<>"']{3,400}$/.test(s) || /^[/]m[/][0-9a-f]{24}$/.test(s)) return s;
  return null;
}

// 渡された中身を確かめて、決まった形にそろえる。おかしな欄があれば、どの欄かを返す
export function normalizeHome(input = {}) {
  const out = { slides: [], shelves: [], sidebar: {} };
  const slides = Array.isArray(input.slides) ? input.slides : [];
  if (slides.length > LIM.slides) return { ok: false, error: "too_many", field: "slides", max: LIM.slides };
  for (const [i, s] of slides.entries()) {
    const title = str(s && s.title, 80);
    if (!title) return { ok: false, error: "need_title", field: `slides.${i}.title` };
    const href = okHref(s.href), img = okImg(s.img);
    if (href === null) return { ok: false, error: "bad_href", field: `slides.${i}.href` };
    if (img === null) return { ok: false, error: "bad_img", field: `slides.${i}.img` };
    const alt = str(s.alt, 200);
    if (img && !alt) return { ok: false, error: "need_alt", field: `slides.${i}.alt` };
    out.slides.push({ label: str(s.label, 60), title, body: str(s.body, 200), cta: str(s.cta, 20), href, img, alt, note: str(s.note, 30) });
  }
  const shelves = Array.isArray(input.shelves) ? input.shelves : [];
  if (shelves.length > LIM.shelves) return { ok: false, error: "too_many", field: "shelves", max: LIM.shelves };
  for (const [i, sh] of shelves.entries()) {
    const name = str(sh && sh.name, 20);
    if (!name) return { ok: false, error: "need_name", field: `shelves.${i}.name` };
    const posts = (Array.isArray(sh.posts) ? sh.posts : []).map((p) => String(p || "").trim().toLowerCase()).filter(Boolean);
    if (posts.length > LIM.books) return { ok: false, error: "too_many", field: `shelves.${i}.posts`, max: LIM.books };
    if (posts.some((p) => !SLUG_RE.test(p))) return { ok: false, error: "bad_post", field: `shelves.${i}.posts` };
    out.shelves.push({ name, who: str(sh.who, 30), posts: [...new Set(posts)] });
  }
  const sb = input.sidebar || {};
  for (const k of ["join", "consult", "membership"]) {
    const c = sb[k] || {};
    const href = okHref(c.href);
    if (href === null) return { ok: false, error: "bad_href", field: `sidebar.${k}.href` };
    const card = { title: str(c.title, 40), body: str(c.body, 120), cta: str(c.cta, 20), href };
    if (k === "join") { const f = String(c.form || "").trim(); if (f && !FORM_RE.test(f)) return { ok: false, error: "bad_form", field: "sidebar.join.form" }; card.form = f; }
    if (k === "consult") { const b = String(c.booking || "").trim(); if (b && !FORM_RE.test(b)) return { ok: false, error: "bad_booking", field: "sidebar.consult.booking" }; card.booking = b; }
    out.sidebar[k] = card;
  }
  // 便 5：チャット（無ければ決まった中身）
  const ch = input.chat && typeof input.chat === "object" ? input.chat : HOME_DEFAULT.chat;
  const welcome = String(ch.welcome == null ? "" : ch.welcome).replace(/\r/g, "").trim();
  if (welcome.length > 600) return { ok: false, error: "too_long", field: "chat.welcome", max: 600 };
  const chips = (Array.isArray(ch.chips) ? ch.chips : []).map((c) => str(c, 40)).filter(Boolean);
  if (chips.length > LIM.chips) return { ok: false, error: "too_many", field: "chat.chips", max: LIM.chips };
  out.chat = { welcome, eta: str(ch.eta, 30), chips: [...new Set(chips)] };
  return { ok: true, home: out };
}

// h：{ db, logInbound, seatsLeft(env, slug) → { left, max } | null }
export function makeSiteHome(h) {
  const { db, logInbound } = h;

  async function read(env) {
    try {
      const o = env.IMAGES && (await env.IMAGES.get(HOME_KEY));
      if (!o) return { ...HOME_DEFAULT, is_default: true };
      const r = normalizeHome(JSON.parse(await o.text()));
      return r.ok ? r.home : { ...HOME_DEFAULT, is_default: true };
    } catch { return { ...HOME_DEFAULT, is_default: true }; }
  }

  async function get(env) {
    const home = await read(env);
    const posts = await db(env, "GET", "b_blog_posts?select=slug,title,status&order=created_at.desc&limit=500").catch(() => []);
    return { ok: true, home, posts: posts.map((p) => ({ slug: p.slug, title: p.title, published: p.status === "published" })) };
  }

  async function save(env, input = {}, by = "admin") {
    if (!env.IMAGES) return { ok: false, error: "no_storage" };
    const r = normalizeHome(input);
    if (!r.ok) return r;
    const before = await read(env);
    await env.IMAGES.put(HOME_KEY, JSON.stringify(r.home), { httpMetadata: { contentType: "application/json" } });
    await logInbound(env, "change", { kind: "site_home", before, after: r.home, by }, { ok: true }, 200);
    return { ok: true, home: r.home };
  }

  // 公開の面（/api/p/home）：本棚の記事を公開中のものだけに引き当て、残り枠を数える
  async function publicHome(env) {
    const home = await read(env);
    const slugs = [...new Set(home.shelves.flatMap((s) => s.posts))];
    const rows = slugs.length
      ? await db(env, "GET", `b_blog_posts?select=slug,title,thumb_url,body_html&status=eq.published&slug=in.(${slugs.join(",")})`).catch(() => [])
      : [];
    const by = new Map(rows.map((r) => [r.slug, { slug: r.slug, title: r.title, thumb_url: r.thumb_url || "", kind: /lab-yt/.test(String(r.body_html || "")) ? "動画" : "記事" }]));
    const c = home.sidebar.consult || {};
    const seats = c.booking && h.seatsLeft ? await h.seatsLeft(env, c.booking).catch(() => null) : null;
    return {
      ok: true,
      slides: home.slides,
      shelves: home.shelves.map((s) => ({ name: s.name, who: s.who, books: s.posts.map((p) => by.get(p)).filter(Boolean) })),
      sidebar: { ...home.sidebar, consult: { ...c, ...(seats ? { left: seats.left, max: seats.max } : {}) } },
    };
  }

  return { read, get, save, publicHome };
}

// 公開サイトの見た目と部品（2026-11-07 便 S1・S2。作る前の 1 枚とデモに Naoki OK 15:51・15:54）
// デモ：https://claude.ai/artifact/HSGxvQW97nKwPJMohREXM4
//
// 見た目（S1）：表 b_settings の 1 行（key=web_look）。テーマ（シンプル・マガジン・ノート風）と 2 色・本文の幅。
//   公開のページ（lp の住所）は /_lab/look.css を読む（embed.js が自分で足す）。ページの HTML は var(--lab-c) などで色を当てる。
//   記事の装飾（目次 .lab-toc・ボックス .lab-box・ふきだし .lab-fuki）も同じ look.css に入れる。
// 部品（S2）：表 b_web_parts。1 か所で作り、ページに <div data-lab-part="part:名前"></div> で差し込む。直すと差し込んだ所が全部変わる。
//   中身は読者の段階で出し分ける（WordPress の同期パターン＋HubSpot のスマートコンテンツの形）：
//     new（まだ台帳にいない人）／list（登録済み：集客〜アプローチ）／consult（個別相談・オファー）／member（受講・紹介）／_default（当たらないとき）
//   段階は設計図のレーンと同じ決め方（today.js の stageOf）。読者はページの印（u・lab_u）で見分ける。印の無い人は new。
//   見た・押した・登録は b_web_part_hits に積む（ページの数え方 b_page_hits とは別：部品は 1 枚のページの外でも数えるため）。
//   place（本文の途中・記事の下・サイドバー・スマホの下の帯）は便 S3（ブログ）が自動で差し込むときに使う。ファネルページは印の場所に出る。
import { SLUG_RE } from "./forms.js";

export const LOOK_KEY = "web_look";
export const THEMES = {
  simple:   { label: "シンプル", c: "#1c1917", c2: "#f59e0b", bg: "#fafaf9", card: "#ffffff", line: "#e7e5e4", fg: "#1c1917", mut: "#57534e", r: 14, font: "'Noto Sans JP'", head: "'Noto Sans JP'", h2: "bar" },
  magazine: { label: "マガジン", c: "#0f172a", c2: "#2563eb", bg: "#f1f5f9", card: "#ffffff", line: "#e2e8f0", fg: "#0f172a", mut: "#475569", r: 6, font: "'Noto Sans JP'", head: "'Noto Sans JP'", h2: "under" },
  note:     { label: "ノート風", c: "#292524", c2: "#16a34a", bg: "#fffdf8", card: "#fffdf8", line: "#ece7dd", fg: "#292524", mut: "#78716c", r: 18, font: "'Noto Sans JP'", head: "'Noto Serif JP'", h2: "center" },
};
export const WIDTHS = [660, 720, 820];
export const VARIANTS = ["new", "list", "consult", "member", "_default"];
export const VARIANT_LABEL = { new: "まだ登録していない", list: "登録済み", consult: "個別相談まで", member: "会員", _default: "既定（当たらない人）" };
export const PLACES = { mid: "本文の途中（2 つ目の見出しの前）", end: "記事の下", side: "サイドバーの上（付いてくる）", bar: "スマホの下の帯", free: "印を置いた所だけ" };
export const PART_ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const VID_RE = /^[a-z0-9]{8,40}$/;
const LIMITS = { title: 80, text: 400, btn: 30, href: 500 };
const now = () => new Date().toISOString();

// 設計図のレーン（today.js の stageOf）→ 部品の出し分けの 4 段。台帳にいない人は new
export function bucketOf(lane) {
  if (!lane) return "new";
  if (lane === "signup" || lane === "warm") return "list";
  if (lane === "consult" || lane === "buy") return "consult";
  if (lane === "learn" || lane === "refer") return "member";
  return "list";
}

// 見た目の値をそろえる（知らない値は既定に戻す）
export function normLook(v) {
  let o = {};
  try { o = typeof v === "string" ? JSON.parse(v || "{}") : (v || {}); } catch (_) { o = {}; }
  const theme = THEMES[o.theme] ? o.theme : "simple";
  const t = THEMES[theme];
  return {
    theme,
    c: COLOR_RE.test(String(o.c || "")) ? String(o.c).toLowerCase() : t.c,
    c2: COLOR_RE.test(String(o.c2 || "")) ? String(o.c2).toLowerCase() : t.c2,
    width: WIDTHS.includes(Number(o.width)) ? Number(o.width) : 720,
  };
}

// 公開のページが読む CSS。変数（--lab-*）と記事の装飾と部品の見た目
export function lookCss(look) {
  const l = normLook(look), t = THEMES[l.theme];
  const h2 = t.h2 === "under"
    ? ".lab-article h2{border-bottom:3px solid var(--lab-c);padding:.2em 0}"
    : t.h2 === "center"
      ? ".lab-article h2{text-align:center}.lab-article h2::after{content:\"\";display:block;width:36px;height:3px;background:var(--lab-c2);margin:.5em auto 0;border-radius:2px}"
      : ".lab-article h2{border-left:5px solid var(--lab-c2);padding:.4em 0 .4em .8em;background:linear-gradient(90deg,color-mix(in srgb,var(--lab-c2) 8%,transparent),transparent)}";
  return `/* マーケくん：公開サイトの見た目（テーマ：${t.label}） */
:root{--lab-c:${l.c};--lab-c2:${l.c2};--lab-bg:${t.bg};--lab-card:${t.card};--lab-line:${t.line};--lab-fg:${t.fg};--lab-mut:${t.mut};--lab-r:${t.r}px;--lab-w:${l.width}px;--lab-font:${t.font},system-ui,sans-serif;--lab-head:${t.head},${t.font},serif}
.lab-article{max-width:var(--lab-w);color:var(--lab-fg);font-family:var(--lab-font)}
.lab-article p{font-size:16px;line-height:2;margin:0 0 1.3em}
.lab-article h1,.lab-article h2,.lab-article h3{font-family:var(--lab-head);font-weight:800}
.lab-article h2{font-size:21px;margin:2em 0 .8em}
${h2}
.lab-article img{max-width:100%;height:auto;border-radius:var(--lab-r)}
.lab-toc{border:1px solid var(--lab-line);background:var(--lab-card);border-radius:var(--lab-r);padding:12px 16px;margin:0 0 1.6em;font-size:14px}
.lab-toc b{display:block;margin-bottom:4px}
.lab-box{border:2px solid var(--lab-c2);border-radius:var(--lab-r);padding:14px 16px;margin:0 0 1.4em;background:var(--lab-card)}
.lab-box>b:first-child{display:block;color:var(--lab-c2);margin-bottom:4px;font-size:13px}
.lab-fuki{display:flex;gap:12px;align-items:flex-start;margin:0 0 1.4em}
.lab-fuki>img,.lab-fuki>.lab-fuki-ic{width:52px;height:52px;border-radius:50%;flex-shrink:0;object-fit:cover;background:var(--lab-c);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:800}
.lab-fuki>div:last-child{background:var(--lab-card);border:1px solid var(--lab-line);border-radius:var(--lab-r);padding:10px 14px;font-size:15px}
.lab-part{box-sizing:border-box;border:2px solid var(--lab-c);border-radius:var(--lab-r);background:var(--lab-card);color:var(--lab-fg);padding:18px;margin:0 0 1.6em;font-family:var(--lab-font);text-align:left}
.lab-part-t{display:block;font-family:var(--lab-head);font-size:18px;font-weight:800;margin:0 0 4px}
.lab-part-p{font-size:14px;line-height:1.7;color:var(--lab-mut);margin:0 0 12px;white-space:pre-wrap}
.lab-part .lab-btn{background:var(--lab-c)}
.lab-part .lab-part-go{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:10px;background:var(--lab-c);color:#fff;font-weight:800;text-decoration:none}
.lab-part .lab-form{max-width:none}
`;
}

// 部品 1 段の中身をそろえる。どれかが変なら null と理由
export function normRule(r, formSlugs) {
  if (!r || typeof r !== "object") return { error: "bad_rule" };
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = String(r[k] ?? "").trim();
    if (v.length > max) return { error: "too_long", field: k, max };
    out[k] = v;
  }
  if (!out.title) return { error: "need_title" };
  if (out.href && !/^https:[/][/][^\s<>"']+$/.test(out.href)) return { error: "bad_href" };
  const form = String(r.form ?? "").trim();
  if (form) {
    if (!SLUG_RE.test(form)) return { error: "bad_form" };
    if (formSlugs && !formSlugs.includes(form)) return { error: "form_not_found", form };
    out.form = form;
  } else out.form = "";
  if (!out.form && !out.href) return { error: "need_action" }; // 押す先（住所）か申込の枠のどちらか
  if (!out.form && !out.btn) out.btn = "詳しく見る";
  return { rule: out };
}

// 読者の段階に当てる中身（無い段は既定。既定も無ければ出さない）
export function pickRule(rules, bucket) {
  const r = rules || {};
  if (r[bucket]) return { variant: bucket, rule: r[bucket] };
  if (r._default) return { variant: "default", rule: r._default };
  return null;
}

export function makeWeb({ db, logInbound, readPersonToken, laneOf }) {
  // ---------- 見た目 ----------
  async function getLook(env) {
    const rows = await db(env, "GET", `settings?select=value,updated_at,updated_by&key=eq.${LOOK_KEY}`).catch(() => []);
    return { look: normLook(rows[0] && rows[0].value), updated_at: rows[0] ? rows[0].updated_at : null, updated_by: rows[0] ? rows[0].updated_by : null };
  }
  async function setLook(env, args = {}, actor = "admin") {
    const cur = (await getLook(env)).look;
    const want = { ...cur };
    if (args.theme !== undefined) {
      if (!THEMES[args.theme]) return { ok: false, error: "bad_theme", themes: Object.keys(THEMES) };
      // テーマを替えたら、色は新しいテーマのものに戻す（色だけ前のまま残ると、テーマを替えた気がしないため）
      if (args.theme !== cur.theme) { want.c = THEMES[args.theme].c; want.c2 = THEMES[args.theme].c2; }
      want.theme = args.theme;
    }
    for (const k of ["c", "c2"]) if (args[k] !== undefined) { if (!COLOR_RE.test(String(args[k]))) return { ok: false, error: "bad_color", field: k }; want[k] = String(args[k]).toLowerCase(); }
    if (args.width !== undefined) { if (!WIDTHS.includes(Number(args.width))) return { ok: false, error: "bad_width", widths: WIDTHS }; want.width = Number(args.width); }
    const look = normLook(want);
    await db(env, "POST", "settings?on_conflict=key", [{ key: LOOK_KEY, value: JSON.stringify(look), updated_at: now(), updated_by: String(actor).slice(0, 200) }], "resolution=merge-duplicates,return=minimal");
    await logInbound(env, "web_look", { look, actor }, { ok: true }, 200);
    return { ok: true, look };
  }

  // ---------- 部品 ----------
  async function formSlugs(env) {
    return (await db(env, "GET", "b_forms?select=slug,title,active&order=created_at.desc").catch(() => [])) || [];
  }
  async function counts(env, days = 7) {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const rows = await db(env, "GET", `b_web_part_hits?select=part_id,kind,variant,vid&at=gte.${encodeURIComponent(since)}&limit=50000`).catch(() => []);
    const out = {};
    for (const h of rows) {
      const o = out[h.part_id] = out[h.part_id] || { view: new Set(), click: 0, signup: 0, by: {} };
      const b = o.by[h.variant] = o.by[h.variant] || { view: new Set(), click: 0, signup: 0 };
      if (h.kind === "view") { o.view.add(h.vid); b.view.add(h.vid); } else { o[h.kind]++; b[h.kind]++; }
    }
    const flat = (x) => ({ view: x.view.size, click: x.click, signup: x.signup });
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...flat(v), by: Object.fromEntries(Object.entries(v.by).map(([kk, vv]) => [kk, flat(vv)])) }]));
  }
  const shape = (p, c) => ({
    id: p.id, name: p.name, place: p.place, place_label: PLACES[p.place] || "", active: p.active !== false,
    rules: p.rules || {}, variants: VARIANTS.filter((v) => (p.rules || {})[v]),
    snippet: `<div data-lab-part="part:${p.id}"></div>`,
    week: c || { view: 0, click: 0, signup: 0, by: {} }, updated_at: p.updated_at, updated_by: p.updated_by,
  });
  async function listParts(env) {
    const [rows, c] = await Promise.all([db(env, "GET", "b_web_parts?select=*&order=sort.asc,created_at.asc").catch(() => []), counts(env)]);
    return (rows || []).map((p) => shape(p, c[p.id]));
  }
  // 画面と AI が読む 1 枚：見た目・テーマの一覧・部品（先週 7 日の数つき）・使えるフォーム
  async function get(env) {
    const [l, parts, fl] = await Promise.all([getLook(env), listParts(env), formSlugs(env)]);
    return {
      ok: true, ...l,
      themes: Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, c: t.c, c2: t.c2 })), widths: WIDTHS,
      places: Object.entries(PLACES).map(([id, label]) => ({ id, label })),
      variants: VARIANTS.map((id) => ({ id, label: VARIANT_LABEL[id] })),
      parts, forms: fl.filter((f) => f.active).map((f) => ({ slug: f.slug, title: f.title })),
    };
  }
  // 作る（id なし）・編集（id）・削除（id・remove）。rules は段ごとの中身（どれか 1 段は要る）
  async function savePart(env, args = {}, actor = "admin") {
    const exists = args.id ? (await db(env, "GET", `b_web_parts?select=*&id=eq.${encodeURIComponent(String(args.id))}`))[0] : null;
    if (args.remove === true || args.remove === "true") {
      if (!exists) return { ok: false, error: "not_found" };
      await db(env, "DELETE", `b_web_parts?id=eq.${exists.id}`, null, "return=minimal");
      await logInbound(env, "web_part", { action: "remove", id: exists.id, actor }, { ok: true }, 200);
      return { ok: true, removed: exists.id };
    }
    let id = String(args.id || "").trim().toLowerCase();
    const isNew = !exists;
    if (isNew) {
      if (!id) id = String(args.slug || "").trim().toLowerCase();
      if (!PART_ID_RE.test(id)) return { ok: false, error: "bad_id", note: "英小文字・数字・ハイフンの 2〜31 字（ページに書く印の名前になる）" };
    }
    const name = args.name !== undefined ? String(args.name).trim() : exists ? exists.name : "";
    if (!name || name.length > 60) return { ok: false, error: "bad_name" };
    const place = args.place !== undefined ? String(args.place) : exists ? exists.place : "free";
    if (!PLACES[place]) return { ok: false, error: "bad_place", places: Object.keys(PLACES) };
    let rules = exists ? (exists.rules || {}) : {};
    if (args.rules !== undefined) {
      if (!args.rules || typeof args.rules !== "object") return { ok: false, error: "bad_rules" };
      const slugs = (await formSlugs(env)).filter((f) => f.active).map((f) => f.slug); // 公開中のフォームだけ（閉じたフォームは枠が「開いていません」になる）
      rules = {};
      for (const [k, v] of Object.entries(args.rules)) {
        if (!VARIANTS.includes(k)) return { ok: false, error: "bad_variant", variants: VARIANTS };
        if (v == null || v === "") continue; // 空の段は「出さない」（既定へ回る）
        const n = normRule(v, slugs);
        if (n.error) return { ok: false, ...n, variant: k };
        rules[k] = n.rule;
      }
    }
    if (!Object.keys(rules).length) return { ok: false, error: "need_rule", note: "どれか 1 つの段（既定でもよい）に中身を入れる" };
    const row = { name, place, rules, active: args.active === undefined ? (exists ? exists.active !== false : true) : !!args.active, updated_at: now(), updated_by: String(actor).slice(0, 200) };
    if (isNew) {
      const [made] = await db(env, "POST", "b_web_parts", [{ id, ...row }], "return=representation");
      await logInbound(env, "web_part", { action: "create", id, actor }, { ok: true }, 200);
      return { ok: true, created: true, part: shape(made || { id, ...row }) };
    }
    await db(env, "PATCH", `b_web_parts?id=eq.${exists.id}`, row, "return=minimal");
    await logInbound(env, "web_part", { action: "update", id: exists.id, actor }, { ok: true }, 200);
    return { ok: true, created: false, part: shape({ ...exists, ...row }) };
  }

  // ---------- lp の住所で動くもの ----------
  async function bucketFor(env, u) {
    const cid = await readPersonToken(env, u).catch(() => null);
    if (!cid) return { cid: null, bucket: "new" };
    const lane = await laneOf(env, cid).catch(() => null);
    return { cid, bucket: bucketOf(lane) };
  }
  // 部品の中身（読者の段階で選ぶ）。見たのはここで 1 回数える（vid が無ければ数えない）
  async function publicPart(env, id, { u, vid, page } = {}) {
    if (!PART_ID_RE.test(String(id || ""))) return { ok: false, error: "not_found" };
    const [p] = await db(env, "GET", `b_web_parts?select=*&id=eq.${id}`);
    if (!p || p.active === false) return { ok: false, error: "not_found" };
    const { cid, bucket } = await bucketFor(env, u);
    const hit = pickRule(p.rules, bucket);
    if (!hit) return { ok: true, hidden: true };
    if (VID_RE.test(String(vid || ""))) {
      await db(env, "POST", "b_web_part_hits", [{ part_id: p.id, kind: "view", variant: hit.variant, page_id: UUID_RE.test(String(page || "")) ? page : null, vid, customer_id: cid, at: now() }], "return=minimal").catch(() => {});
    }
    const r = hit.rule;
    return { ok: true, part: { id: p.id, variant: hit.variant, title: r.title, text: r.text, btn: r.btn, href: r.href, form: r.form || "" } };
  }
  // 押した・登録した
  async function partHit(env, body = {}) {
    const id = String(body.part || "");
    if (!PART_ID_RE.test(id)) return { ok: false, error: "bad_part" };
    const kind = body.kind === "click" ? "click" : body.kind === "signup" ? "signup" : null;
    if (!kind) return { ok: false, error: "bad_kind" };
    const vid = String(body.vid || "");
    if (!VID_RE.test(vid)) return { ok: false, error: "bad_vid" };
    const variant = ["new", "list", "consult", "member", "default"].includes(body.variant) ? body.variant : "default";
    const [p] = await db(env, "GET", `b_web_parts?select=id&id=eq.${id}`);
    if (!p) return { ok: false, error: "not_found" };
    const cid = await readPersonToken(env, body.u).catch(() => null);
    await db(env, "POST", "b_web_part_hits", [{ part_id: id, kind, variant, page_id: UUID_RE.test(String(body.page || "")) ? body.page : null, vid, customer_id: cid, at: now() }], "return=minimal");
    return { ok: true };
  }
  async function css(env) {
    return lookCss((await getLook(env)).look);
  }

  return { getLook, setLook, get, listParts, savePart, publicPart, partHit, css, counts };
}

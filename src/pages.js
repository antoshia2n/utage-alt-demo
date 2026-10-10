// B の便 12a：ページ作成（2026-10-09 Naoki「進めて」）。
// ページの中身（HTML）は Claude が書く。B は「置き場・依頼文・公開の承認・計測」だけを持つ。
//   b_pages          … ページ 1 枚（住所の名前 slug・外の名前・目的・公開中の版）
//   b_page_versions  … 版ごとの HTML。Claude が下書きを置くたびに 1 つ増える。公開するのはどれか 1 つの版
//   b_page_requests  … Lab OS で書いた依頼（新しく作る／直す）と、そこから作った依頼文。どの依頼でどの版ができたかを残す
//   b_page_hits      … ページを見た・ボタンを押した（まだ台帳にいない人も数えるので出来事の記録とは別）
// 公開のページは会員の画面と別の住所（PAGES_ORIGIN・lp.shia2n.jp）で出す。Claude が書いた HTML の中の仕掛けが、
// ログイン中の人の鍵（lab.shia2n.jp の保存領域）に届かないようにするため。
// ページの中には印を書く。B が公開のときに中身を差し込む：
//   data-lab-part="form:slug"        … 申込の枠（便 11a のフォーム）
//   data-lab-part="checkout:商品の id" … 決済の枠（商品の名前と価格と申し込むボタン。押すと lab の /register?product= へ）
//   data-lab-button="名前"             … ボタン。押したら出来事に積み、コネクタのきっかけ「ページのボタンを押した」になる
//   data-lab-part="booking:slug"     … 便 13b：個別相談の予約の枠（空き時間を選び、名前とメールで予約する）
// 経路：ページの住所の後ろの ?r=名前。初めて登録したときの経路をその人の経路にする（registered の payload.route）。

import { SLUG_RE } from "./forms.js";
import { isTestPurchase } from "./purchase.js";

export const PURPOSES = { signup: "無料登録", seminar: "セミナーの申込", sale: "販売", news: "お知らせ", thanks: "サンクス" };
export const PAGE_SLUG_RE = SLUG_RE;
const RESERVED = new Set(["api", "lab", "admin", "app", "login", "register", "form", "legal", "auth", "mcp", "r"]);
export const BUTTON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// 経路の名前：日本語も使える。空白・記号の一部を除く 1〜40 字
export const ROUTE_RE = /^[\p{L}\p{N}][\p{L}\p{N}_\-ー・]{0,39}$/u;
export const VID_RE = /^[a-z0-9]{8,40}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const PRODUCT_ID_RE = /^[a-z0-9-]{2,40}$/;
export const HTML_MAX = 400000;
const TEXT_MAX = 2000;
const now = () => new Date().toISOString();

// HTML の中の印を拾う（フォーム・決済の枠・ボタン）
export function parseParts(html) {
  // 便 13：HTML の注意書き（<!-- -->）の中の印は読まない（便 12a の版 1 で、説明の文の印を印として拾った件）
  const s = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const forms = new Set(), checkouts = new Set(), buttons = new Set(), bookings = new Set(), bad = [];
  for (const m of s.matchAll(/data-lab-part\s*=\s*["']([^"']*)["']/g)) {
    const v = m[1].trim();
    const f = v.match(/^form:(.+)$/), c = v.match(/^checkout:(.+)$/), bk = v.match(/^booking:(.+)$/);
    if (f && SLUG_RE.test(f[1])) forms.add(f[1]);
    else if (bk && SLUG_RE.test(bk[1])) bookings.add(bk[1]);
    else if (c && PRODUCT_ID_RE.test(c[1])) checkouts.add(c[1]);
    else bad.push(v.slice(0, 60));
  }
  for (const m of s.matchAll(/data-lab-button\s*=\s*["']([^"']*)["']/g)) {
    const v = m[1].trim();
    if (BUTTON_RE.test(v)) buttons.add(v); else bad.push("button:" + v.slice(0, 40));
  }
  return { forms: [...forms], checkouts: [...checkouts], buttons: [...buttons], bookings: [...bookings], bad };
}

// 公開のときに B の差し込みの仕掛けを足す（Claude が書いた同じ行は外してから 1 回だけ）
export function injectEmbed(html, attrs) {
  const tag = `<script src="/_lab/embed.js" defer ${Object.entries(attrs).map(([k, v]) => `data-${k}="${String(v).replace(/[&"<>]/g, "")}"`).join(" ")}></script>`;
  const s = String(html || "").replace(/<script[^>]+src=["'][^"']*_lab[/]embed[.]js["'][^>]*>\s*<\/script>/gi, "");
  const i = s.search(/<\/body>/i);
  return i < 0 ? s + tag : s.slice(0, i) + tag + s.slice(i);
}

// 署名（lp の住所で「誰か」を名乗るための印・下書きを見るための印）。鍵は MCP_SECRET から作る
async function hmacHex(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("b12a-pages:" + String(env.MCP_SECRET || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// 便 R1：人の印に期限を付けた（既定 30 日）。形は「人の番号.期限（秒）.署名」。期限切れと、期限の無い前の形（人の番号.署名）は「知らない人」
export const PERSON_TOKEN_TTL_MS = 30 * 864e5;
export async function personToken(env, cid, ttlMs = PERSON_TOKEN_TTL_MS) {
  const exp = Math.floor((Date.now() + ttlMs) / 1000);
  return `${cid}.${exp}.${await hmacHex(env, `person:${cid}:${exp}`)}`;
}
export async function readPersonToken(env, tok) {
  const m = String(tok || "").match(/^([0-9a-f-]{36})[.]([0-9]{9,11})[.]([0-9a-f]{32})$/i);
  if (!m) return null;
  if (Number(m[2]) * 1000 < Date.now()) return null;
  return sameHex(m[3], await hmacHex(env, `person:${m[1]}:${m[2]}`)) ? m[1] : null;
}
export async function previewToken(env, pageId, version, ttlMs = 6 * 3600e3) {
  const exp = Math.floor((Date.now() + ttlMs) / 1000);
  return `${version}.${exp}.${await hmacHex(env, `preview:${pageId}:${version}:${exp}`)}`;
}
export async function readPreviewToken(env, pageId, tok) {
  const m = String(tok || "").match(/^(\d{1,6})[.](\d{9,11})[.]([0-9a-f]{32})$/);
  if (!m) return null;
  if (Number(m[2]) * 1000 < Date.now()) return null;
  return sameHex(m[3], await hmacHex(env, `preview:${pageId}:${m[1]}:${m[2]}`)) ? Number(m[1]) : null;
}

// 依頼文（Claude にそのまま貼る）。決まりの全文は道具 get_page_request が返すので、ここは中身と最初の一手だけ
export function buildPrompt(req, { origin = "", pageSlug = "", baseVersion = null } = {}) {
  const lines = [];
  if (req.kind === "fix") {
    lines.push(`シアラボの Lab OS のページ「${req.title}」を直してください（依頼番号 ${req.id}）。`);
    lines.push("");
    lines.push(`直すもと：版 ${baseVersion ?? req.base_version ?? "（最新）"}${pageSlug ? `（住所 ${origin}/${pageSlug}）` : ""}`);
    lines.push("直してほしいところ：");
    lines.push(req.comment || "（なし）");
  } else {
    lines.push(`シアラボの Lab OS で、新しいページを作ってください（依頼番号 ${req.id}）。`);
    lines.push("");
    lines.push(`目的：${PURPOSES[req.purpose] || req.purpose}`);
    lines.push(`ページの名前：${req.title}`);
    if (req.reference) lines.push(`参考にする構成：${req.reference}`);
    if (req.materials) lines.push(`材料：${req.materials}`);
    if (req.comment) { lines.push("ほかに伝えたいこと："); lines.push(req.comment); }
  }
  lines.push("");
  lines.push("進め方：");
  lines.push(`1. B の道具（shia2n-mcp の b__call）で get_page_request（request_id: ${req.id}）を呼び、依頼の中身と書き方の決まり（使えるフォーム・商品・印の書き方）を読む`);
  if (req.kind === "fix") lines.push("2. get_page で直すもとの版の HTML を読む");
  else lines.push("2. 参考と材料を読む（UTAGE のページなら UTAGE の道具 funnel_page_get、Google ドライブなら Drive の道具）");
  lines.push(`3. HTML を 1 枚書き、save_page_draft で下書きとして置く（request_id: ${req.id} を必ず渡す）`);
  lines.push("4. 公開はしない（Naoki が Lab OS で見てから公開する）。置いたら、版の番号と、どう作ったかを 3 行で返す");
  return lines.join("\n");
}

export function makePages(h) {
  const { db, addEvent, logInbound, forms, sell } = h;
  const pagesOrigin = (env) => String(env.PAGES_ORIGIN || "https://lp.shia2n.jp").replace(/[/]$/, "");
  const labOrigin = (env) => String(env.PUBLIC_ORIGIN || "https://lab.shia2n.jp").replace(/[/]$/, "");

  async function pageById(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [p] = await db(env, "GET", `b_pages?select=*&id=eq.${id}`);
    return p || null;
  }
  async function pageBySlug(env, slug) {
    const s = String(slug || "").toLowerCase();
    if (!PAGE_SLUG_RE.test(s)) return null;
    const [p] = await db(env, "GET", `b_pages?select=*&slug=eq.${s}`);
    return p || null;
  }
  async function findPage(env, { page_id, slug }) {
    return page_id ? await pageById(env, page_id) : await pageBySlug(env, slug);
  }
  async function version(env, pageId, v) {
    const [row] = await db(env, "GET", `b_page_versions?select=*&page_id=eq.${pageId}&version=eq.${Number(v)}`);
    return row || null;
  }

  // ---------- 依頼 ----------
  async function createRequest(env, args = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const kind = args.page_id ? "fix" : "new";
    const row = { kind, created_by: String(by).slice(0, 200) };
    let page = null;
    if (kind === "fix") {
      page = await pageById(env, args.page_id);
      if (!page) return { ok: false, error: "page_not_found" };
      const c = String(args.comment || "").trim();
      if (!c) return { ok: false, error: "need_comment" };
      row.page_id = page.id;
      row.title = page.title;
      row.purpose = page.purpose;
      row.base_version = Number.isInteger(Number(args.base_version)) && Number(args.base_version) > 0 ? Number(args.base_version) : page.latest_version || null;
    } else {
      if (!PURPOSES[args.purpose]) return { ok: false, error: "bad_purpose", purposes: Object.keys(PURPOSES) };
      const t = String(args.title || "").trim();
      if (!t || t.length > 80) return { ok: false, error: "bad_title" };
      row.purpose = args.purpose;
      row.title = t;
      if (args.campaign_id) { if (!UUID_RE.test(String(args.campaign_id))) return { ok: false, error: "bad_campaign_id" }; row.campaign_id = args.campaign_id; }
    }
    for (const k of ["reference", "materials", "comment"]) {
      const v = String(args[k] || "").trim();
      if (v.length > TEXT_MAX) return { ok: false, error: "too_long", field: k };
      row[k] = v;
    }
    const [req] = await db(env, "POST", "b_page_requests", [row], "return=representation");
    const prompt = buildPrompt(req, { origin: pagesOrigin(env), pageSlug: page ? page.slug : "", baseVersion: req.base_version });
    await db(env, "PATCH", `b_page_requests?id=eq.${req.id}`, { prompt }, "return=minimal");
    await logInbound(env, "page", { action: "request", id: req.id, kind, by }, { ok: true }, 200);
    return { ok: true, request: { ...req, prompt }, prompt };
  }

  // 書き方の決まり（Claude が読む）。使えるフォームと商品はいまの表から
  async function rules(env) {
    const [fl, pl] = await Promise.all([
      db(env, "GET", "b_forms?select=slug,title,active&order=created_at.desc").catch(() => []),
      sell ? sell.listProducts(env, { include_inactive: false }).catch(() => ({ products: [] })) : { products: [] },
    ]);
    return {
      html: `HTML は 1 枚（<!doctype html> から </html> まで）。${HTML_MAX.toLocaleString()} 字まで。https の外の CSS・フォント・画像・スクリプトは使ってよい。スマホの幅（390px）で横にはみ出さないこと`,
      embed: "B が公開のときに /_lab/embed.js を自分で足す。HTML に書かない",
      form: `申込の枠：<div data-lab-part="form:住所の名前"></div>。メールアドレス・名前・同意の欄と、フォームの項目が中に入る。答えた人は台帳に入る。公開中のフォームだけ使える`,
      checkout: `決済の枠：<div data-lab-part="checkout:商品の id"></div>。商品の名前・価格と「申し込む」ボタンが入り、押すと ${labOrigin(env)}/register?product= へ移る（決済はそこで行う）`,
      button: `ボタン：押したことを数えたい a や button に data-lab-button="名前" を付ける（英小文字・数字・ハイフン。例 cta-1）。押した数は Lab OS に出て、コネクタで「押したら〜する」をつなげる`,
      style: "差し込む枠は class lab-form・lab-checkout・lab-btn・lab-input・lab-note を持つ。ページの CSS で上書きして見た目をそろえる",
      legal: `特商法 ${labOrigin(env)}/legal/tokushoho・プライバシーポリシー ${labOrigin(env)}/legal/privacy。ページの下に置く`,
      dont: "鍵・会員の個人情報・実在しない実績や数字を書かない。公開はしない（publish_page は Naoki が承認する）",
      booking: "予約の枠：<div data-lab-part=\"booking:予約の種類の住所の名前\"></div>。空き時間の一覧と、名前・メール・相談したいこと・同意の欄が入る。予約した人は台帳に入り、受付のメールが届く",
      thanks: "サンクスページ（目的 thanks）：申込の枠もボタンも要らない。申込を受け付けたこと・日時・参加の URL はメールで届くこと・迷惑メールの確かめ方を書く。セミナーの回に結ぶのは set_seminar の thanks_page_slug",
      forms: fl.filter((f) => f.active).map((f) => ({ slug: f.slug, title: f.title })),
      forms_not_open: fl.filter((f) => !f.active).map((f) => ({ slug: f.slug, title: f.title })),
      products: (pl.products || []).filter((p) => p.active && p.kind !== "installment").map((p) => ({ id: p.id, name: p.name, amount: p.amount, kind: p.kind, period: p.period || null })),
    };
  }

  async function getRequest(env, { request_id } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!/^\d{1,12}$/.test(String(request_id || ""))) return { ok: false, error: "bad_request_id" };
    const [r] = await db(env, "GET", `b_page_requests?select=*&id=eq.${request_id}`);
    if (!r) return { ok: true, found: false };
    const page = r.page_id ? await pageById(env, r.page_id) : null;
    return {
      ok: true, found: true,
      request: { id: r.id, kind: r.kind, purpose: r.purpose, purpose_label: PURPOSES[r.purpose] || r.purpose, title: r.title, reference: r.reference, materials: r.materials, comment: r.comment, base_version: r.base_version, campaign_id: r.campaign_id, done_version: r.done_version, created_at: r.created_at },
      page: page ? { id: page.id, slug: page.slug, title: page.title, latest_version: page.latest_version, published_version: page.published_version, url: `${pagesOrigin(env)}/${page.slug}` } : null,
      rules: await rules(env),
      next: r.kind === "fix" ? "get_page で base_version の HTML を読み、直して save_page_draft（page_id・request_id・html・note）" : "HTML を書いて save_page_draft（request_id・slug・html・note）。slug は英小文字・数字・ハイフンで、中身が分かる短い名前",
    };
  }

  async function listRequests(env, { page_id, open } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, requests: [] };
    let q = "b_page_requests?select=id,kind,page_id,purpose,title,comment,base_version,done_version,done_page_id,created_at,created_by&order=id.desc&limit=100";
    if (page_id) { if (!UUID_RE.test(String(page_id))) return { ok: false, error: "bad_page_id" }; q += `&or=(page_id.eq.${page_id},done_page_id.eq.${page_id})`; }
    if (open === true || open === "true") q += "&done_version=is.null";
    const rows = await db(env, "GET", q);
    return { ok: true, count: rows.length, requests: rows };
  }

  // ---------- 下書き ----------
  async function saveDraft(env, args = {}, by = "mcp") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const html = String(args.html || "");
    if (!html.trim()) return { ok: false, error: "need_html" };
    if (html.length > HTML_MAX) return { ok: false, error: "too_long", max: HTML_MAX };
    let req = null;
    if (args.request_id != null && args.request_id !== "") {
      if (!/^\d{1,12}$/.test(String(args.request_id))) return { ok: false, error: "bad_request_id" };
      [req] = await db(env, "GET", `b_page_requests?select=*&id=eq.${args.request_id}`);
      if (!req) return { ok: false, error: "request_not_found" };
    }
    let page = args.page_id ? await pageById(env, args.page_id) : null;
    if (args.page_id && !page) return { ok: false, error: "page_not_found" };
    if (!page && req && req.page_id) page = await pageById(env, req.page_id);
    if (req && req.kind === "fix" && page && req.page_id !== page.id) return { ok: false, error: "request_is_for_another_page" };
    const note = String(args.note || "").trim().slice(0, 500);
    if (!page) {
      // 新しいページ。slug・外の名前・目的は引数か依頼から
      const slug = String(args.slug || "").trim().toLowerCase();
      if (!PAGE_SLUG_RE.test(slug) || RESERVED.has(slug)) return { ok: false, error: "bad_slug", note: "英小文字・数字・ハイフンの 2〜41 字（api・admin などは使えない）" };
      if (await pageBySlug(env, slug)) return { ok: false, error: "slug_taken" };
      const title = String(args.title || (req && req.title) || "").trim();
      if (!title || title.length > 80) return { ok: false, error: "bad_title" };
      const purpose = PURPOSES[args.purpose] ? args.purpose : (req && req.purpose) || "signup";
      [page] = await db(env, "POST", "b_pages", [{ slug, title, purpose, status: "draft", latest_version: 0, updated_by: String(by).slice(0, 200) }], "return=representation");
      if (req && req.campaign_id) {
        try { await db(env, "POST", "b_campaign_parts?on_conflict=part_type,part_id", [{ part_type: "page", part_id: page.id, campaign_id: req.campaign_id, role: PURPOSES[purpose], updated_at: now(), updated_by: String(by).slice(0, 200) }], "resolution=ignore-duplicates,return=minimal"); }
        catch (_) { /* 企画が無くても下書きは置く */ }
      }
    } else if (args.title) {
      const t = String(args.title).trim();
      if (!t || t.length > 80) return { ok: false, error: "bad_title" };
      if (t !== page.title) await db(env, "PATCH", `b_pages?id=eq.${page.id}`, { title: t }, "return=minimal");
    }
    const parts = parseParts(html);
    const next = (page.latest_version || 0) + 1;
    await db(env, "POST", "b_page_versions", [{ page_id: page.id, version: next, html, parts, note, request_id: req ? req.id : null, made_by: String(by).slice(0, 200) }], "return=minimal");
    await db(env, "PATCH", `b_pages?id=eq.${page.id}`, { latest_version: next, updated_at: now(), updated_by: String(by).slice(0, 200) }, "return=minimal");
    if (req && req.done_version == null) await db(env, "PATCH", `b_page_requests?id=eq.${req.id}`, { done_version: next, done_page_id: page.id }, "return=minimal");
    await logInbound(env, "page", { action: "draft", page_id: page.id, version: next, request_id: req ? req.id : null, by }, { ok: true }, 200);
    // 使えない印は止めずに知らせる（直すのは Claude）
    const r = await rules(env);
    const warnings = [];
    const openForms = new Set(r.forms.map((f) => f.slug)), ids = new Set(r.products.map((p) => p.id));
    for (const f of parts.forms) if (!openForms.has(f)) warnings.push(`フォーム ${f} は公開中ではない（枠は「開いていません」と出る）`);
    for (const c of parts.checkouts) if (!ids.has(c)) warnings.push(`商品 ${c} は売っていない（枠は出ない）`);
    for (const b of parts.bad) warnings.push(`読めない印：${b}`);
    if (/<script[^>]+_lab[/]embed[.]js/i.test(html)) warnings.push("/_lab/embed.js は B が足すので書かなくてよい（公開のときに外す）");
    return { ok: true, page_id: page.id, slug: page.slug, version: next, parts, warnings, preview_in_lab_os: `${labOrigin(env)}/admin#page/${page.id}`, note: "下書きとして置いた。公開は Naoki が Lab OS で行う" };
  }

  // ---------- 一覧・1 枚 ----------
  async function hitsSince(env, sinceIso, pageId) {
    let q = `b_page_hits?select=page_id,kind,button,vid,customer_id,route,at&at=gte.${encodeURIComponent(sinceIso)}&order=id.asc&limit=50000`;
    if (pageId) q += `&page_id=eq.${pageId}`;
    return await db(env, "GET", q);
  }

  async function listPages(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, pages: [] };
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [pages, hits, open] = await Promise.all([
      db(env, "GET", "b_pages?select=*&order=updated_at.desc"),
      hitsSince(env, since),
      db(env, "GET", "b_page_requests?select=id,page_id&done_version=is.null"),
    ]);
    for (const p of pages) {
      const mine = hits.filter((x) => x.page_id === p.id);
      p.week_viewers = new Set(mine.filter((x) => x.kind === "view").map((x) => x.vid)).size;
      p.week_clicks = mine.filter((x) => x.kind === "click").length;
      p.open_requests = open.filter((r) => r.page_id === p.id).length;
      p.url = `${pagesOrigin(env)}/${p.slug}`;
      p.purpose_label = PURPOSES[p.purpose] || p.purpose;
    }
    return { ok: true, count: pages.length, pages, open_new_requests: open.filter((r) => !r.page_id).length, pages_origin: pagesOrigin(env) };
  }

  // 1 枚の数（先週 7 日）：見た人・押した数（ボタンごと）・フォームに答えた人・経路ごと
  async function pageStats(env, page) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [hits, subs] = await Promise.all([
      hitsSince(env, since, page.id),
      db(env, "GET", `events?select=customer_id,payload,occurred_at&type=eq.form_submitted&payload->>page_id=eq.${page.id}&occurred_at=gte.${encodeURIComponent(since)}&limit=10000`),
    ]);
    const views = hits.filter((x) => x.kind === "view");
    const buttons = {};
    for (const x of hits.filter((h) => h.kind === "click")) buttons[x.button || "?"] = (buttons[x.button || "?"] || 0) + 1;
    const routes = {};
    for (const x of views) { const r = x.route || "（経路なし）"; routes[r] = routes[r] || new Set(); routes[r].add(x.vid); }
    return {
      since,
      viewers: new Set(views.map((x) => x.vid)).size,
      views: views.length,
      clicks: Object.entries(buttons).map(([button, n]) => ({ button, n })).sort((a, b) => b.n - a.n),
      form_people: new Set(subs.map((e) => e.customer_id)).size,
      routes: Object.entries(routes).map(([route, s]) => ({ route, viewers: s.size })).sort((a, b) => b.viewers - a.viewers),
    };
  }

  async function getPage(env, { page_id, slug, version: v, include_html = true } = {}, { forAdmin = false } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const page = await findPage(env, { page_id, slug });
    if (!page) return { ok: true, found: false };
    const versions = await db(env, "GET", `b_page_versions?select=version,note,request_id,made_by,created_at,parts&page_id=eq.${page.id}&order=version.desc&limit=100`);
    const want = v ? Number(v) : page.latest_version;
    let html = null;
    if (include_html !== false && include_html !== "false" && want) { const row = await version(env, page.id, want); html = row ? row.html : null; }
    const out = {
      ok: true, found: true,
      page: { ...page, purpose_label: PURPOSES[page.purpose] || page.purpose, url: `${pagesOrigin(env)}/${page.slug}` },
      versions, version: want || null, html,
      stats: await pageStats(env, page),
      requests: (await listRequests(env, { page_id: page.id })).requests,
    };
    if (forAdmin) {
      out.previews = {};
      for (const x of versions.slice(0, 20)) out.previews[x.version] = `${pagesOrigin(env)}/${page.slug}?preview=${await previewToken(env, page.id, x.version)}`;
    }
    return out;
  }

  // ---------- 公開 ----------
  async function publish(env, { page_id, version: v, stop = false } = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const page = await pageById(env, page_id);
    if (!page) return { ok: false, error: "page_not_found" };
    const before = { status: page.status, published_version: page.published_version };
    if (stop === true || stop === "true") {
      await db(env, "PATCH", `b_pages?id=eq.${page.id}`, { status: "stopped", updated_at: now(), updated_by: String(by).slice(0, 200) }, "return=minimal");
      await logInbound(env, "change", { kind: "page", id: page.id, before, after: { status: "stopped", published_version: page.published_version }, by }, { ok: true }, 200);
      return { ok: true, page_id: page.id, status: "stopped" };
    }
    const want = v ? Number(v) : page.latest_version;
    if (!want || !(await version(env, page.id, want))) return { ok: false, error: "version_not_found" };
    await db(env, "PATCH", `b_pages?id=eq.${page.id}`, { status: "published", published_version: want, published_at: now(), updated_at: now(), updated_by: String(by).slice(0, 200) }, "return=minimal");
    await logInbound(env, "change", { kind: "page", id: page.id, before, after: { status: "published", published_version: want }, by }, { ok: true }, 200);
    return { ok: true, page_id: page.id, status: "published", version: want, url: `${pagesOrigin(env)}/${page.slug}` };
  }

  // ---------- 経路（全体） ----------
  // 経路ごとの見た人（ページ全体）・その経路で初めて登録した人・その人のうち買った人
  async function routeStats(env, { days = 30 } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", routes: [] };
    const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - d * 864e5).toISOString();
    const [hits, regs, buys] = await Promise.all([
      hitsSince(env, since),
      db(env, "GET", "events?select=customer_id,payload,occurred_at&type=eq.registered&payload->>route=not.is.null&limit=50000"),
      db(env, "GET", "events?select=customer_id,payload&type=eq.purchase_completed&limit=50000"),
    ]);
    const routeOf = new Map();
    for (const e of regs) if (e.payload && e.payload.route && !routeOf.has(e.customer_id)) routeOf.set(e.customer_id, { route: e.payload.route, at: e.occurred_at });
    const bought = new Set(buys.filter((e) => !isTestPurchase(e.payload)).map((e) => e.customer_id)); // 便 12e：試しの決済は数えない
    const out = {};
    const row = (r) => (out[r] = out[r] || { route: r, viewers: new Set(), registered: 0, bought: 0 });
    for (const x of hits) if (x.kind === "view" && x.route) row(x.route).viewers.add(x.vid);
    for (const [cid, v] of routeOf) {
      if (v.at < since) continue;
      const o = row(v.route);
      o.registered++;
      if (bought.has(cid)) o.bought++;
    }
    const routes = Object.values(out).map((o) => ({ route: o.route, viewers: o.viewers.size, registered: o.registered, bought: o.bought })).sort((a, b) => b.viewers - a.viewers || b.registered - a.registered);
    return { ok: true, days: d, count: routes.length, routes };
  }

  // ---------- lp の住所で動くもの ----------
  // 見た・押した。知っている人（メールのリンクから来た・この端末でフォームに答えた）は出来事にも積む（コネクタのきっかけ）
  async function hit(env, body = {}) {
    const page = await pageById(env, body.page);
    if (!page || page.status !== "published") return { ok: false, error: "not_found" };
    const kind = body.kind === "click" ? "click" : body.kind === "view" ? "view" : null;
    if (!kind) return { ok: false, error: "bad_kind" };
    const vid = String(body.vid || "");
    if (!VID_RE.test(vid)) return { ok: false, error: "bad_vid" };
    const button = kind === "click" ? String(body.button || "") : "";
    if (kind === "click" && !BUTTON_RE.test(button) && !/^checkout:[a-z0-9-]{2,40}$/.test(button)) return { ok: false, error: "bad_button" };
    const route = ROUTE_RE.test(String(body.r || "")) ? String(body.r) : null;
    const cid = await readPersonToken(env, body.u);
    await db(env, "POST", "b_page_hits", [{ page_id: page.id, version: page.published_version, kind, button: button || null, vid, customer_id: cid, route }], "return=minimal");
    if (cid) {
      const type = kind === "view" ? "page_viewed" : "page_clicked";
      // 見たのは 1 人 1 ページ 1 日 1 回だけ積む（開き直すたびにコネクタが動かないため）
      let skip = false;
      if (kind === "view") {
        const since = new Date(Date.now() - 864e5).toISOString();
        const seen = await db(env, "GET", `events?select=id&customer_id=eq.${cid}&type=eq.page_viewed&payload->>page_id=eq.${page.id}&occurred_at=gte.${encodeURIComponent(since)}&limit=1`);
        skip = seen.length > 0;
      }
      if (!skip) await addEvent(env, cid, type, { page_id: page.id, slug: page.slug, title: page.title, ...(button ? { button } : {}), ...(route ? { route } : {}) }, "site");
    }
    return { ok: true };
  }

  async function publicProduct(env, id) {
    if (!sell || !PRODUCT_ID_RE.test(String(id || ""))) return { ok: false, error: "not_found" };
    const r = await sell.listForSite(env, String(id));
    if (!r.products || !r.products.length) return { ok: false, error: "not_found" };
    return { ok: true, product: r.products[0], register_url: `${labOrigin(env)}/register` };
  }

  // フォームに答える（lp の住所から）。経路とページを一緒に送る。初めて台帳に入った人にだけ「この端末の人」の印を返す
  async function submitForm(env, slug, body = {}) {
    const page = body.page ? await pageById(env, body.page) : null;
    const route = ROUTE_RE.test(String(body.r || "")) ? String(body.r) : undefined;
    const r = await forms.submit(env, slug, { ...body, route, page_id: page && page.status === "published" ? page.id : undefined });
    if (!r.ok) return r;
    const out = { ok: true, thanks: r.thanks, is_new: r.is_new };
    // 便 13：セミナーの回にサンクスページがあれば、答えたあとそこへ移る（公開中のときだけ）
    if (r.thanks_url) out.thanks_url = r.thanks_url + (route ? `?r=${encodeURIComponent(route)}` : "");
    if (r.is_new && r.id) out.u = await personToken(env, r.id);
    return out;
  }

  // 便 13b：予約する（lp の住所から）。フォームと同じく経路とページを送る。初めて台帳に入った人にだけ「この端末の人」の印を返す
  async function submitBooking(env, booking, slug, body = {}) {
    const page = body.page ? await pageById(env, body.page) : null;
    const route = ROUTE_RE.test(String(body.r || "")) ? String(body.r) : undefined;
    const r = await booking.book(env, slug, { ...body, route, page_id: page && page.status === "published" ? page.id : undefined });
    if (!r.ok) return r;
    const out = { ok: true, slot: r.slot, label: r.label, is_new: r.is_new };
    if (r.thanks_url) out.thanks_url = r.thanks_url + (route ? `?r=${encodeURIComponent(route)}` : "");
    if (r.is_new && r.id) out.u = await personToken(env, r.id);
    return out;
  }

  // ページを返す。下書きは印（preview）があるときだけ
  async function serve(env, slug, previewTok) {
    const page = await pageBySlug(env, slug);
    if (!page) return null;
    let v = null, preview = false;
    if (previewTok) {
      v = await readPreviewToken(env, page.id, previewTok);
      if (v == null) return null;
      preview = true;
    } else {
      if (page.status !== "published" || !page.published_version) return null;
      v = page.published_version;
    }
    const row = await version(env, page.id, v);
    if (!row) return null;
    return { html: injectEmbed(row.html, { page: page.id, preview: preview ? "1" : "0", lab: labOrigin(env) }), preview, page };
  }

  // 設計図に使う：ページと、公開中（無ければ最新）の版の印
  async function forPlan(env) {
    const pages = await db(env, "GET", "b_pages?select=id,slug,title,status,purpose,latest_version,published_version").catch(() => []);
    if (!pages.length) return { pages: [], partsOf: {} };
    for (const p of pages) p.url = `${pagesOrigin(env)}/${p.slug}`;
    const vers = await db(env, "GET", `b_page_versions?select=page_id,version,parts&page_id=in.(${pages.map((p) => p.id).join(",")})&limit=5000`).catch(() => []);
    const partsOf = {};
    for (const p of pages) {
      const want = p.published_version || p.latest_version;
      const row = vers.find((x) => x.page_id === p.id && x.version === want);
      partsOf[p.id] = row ? row.parts || {} : {};
    }
    return { pages, partsOf };
  }

  return { createRequest, getRequest, listRequests, saveDraft, listPages, getPage, publish, routeStats, hit, publicProduct, submitForm, submitBooking, serve, forPlan, hitsSince, pagesOrigin, rules };
}

// 公開のページに差し込む仕掛け（lp の住所の /_lab/embed.js）。ページの中の印を本物の枠に変え、見た・押したを送る
export const EMBED_JS = `(() => {
  const me = document.currentScript || document.querySelector('script[src*="/_lab/embed.js"]');
  const PAGE = me && me.dataset.page, PREVIEW = me && me.dataset.preview === "1", LAB = (me && me.dataset.lab) || "";
  if (!PAGE) return;
  const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
  const qs = new URLSearchParams(location.search);
  let vid = store.get("lab_vid");
  if (!/^[a-z0-9]{8,40}$/.test(vid)) { vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join(""); store.set("lab_vid", vid); }
  if (qs.get("r") && !store.get("lab_r")) store.set("lab_r", qs.get("r").slice(0, 40));
  if (qs.get("src") && !store.get("lab_src")) store.set("lab_src", qs.get("src").slice(0, 20));
  if (qs.get("u")) { store.set("lab_u", qs.get("u")); qs.delete("u"); const q = qs.toString(); history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash); }
  const route = qs.get("r") || store.get("lab_r");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const send = (kind, button) => {
    if (PREVIEW) return;
    const body = JSON.stringify({ page: PAGE, kind, button, vid, r: route, u: store.get("lab_u") });
    if (kind === "click" && navigator.sendBeacon) { navigator.sendBeacon("/api/p/hit", new Blob([body], { type: "application/json" })); return; }
    fetch("/api/p/hit", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  };
  send("view");
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-lab-button]");
    if (b) send("click", b.getAttribute("data-lab-button"));
  }, true);
  // 便 R1：ロボット判定（Cloudflare Turnstile）。フォームと予約の GET が表示用の鍵を返したときだけ、送るボタンの上に判定の欄を出す
  let tsLoad = null;
  const loadTs = () => tsLoad || (tsLoad = new Promise((res) => {
    if (window.turnstile) { res(window.turnstile); return; }
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true;
    sc.onload = () => res(window.turnstile || null); sc.onerror = () => res(null);
    document.head.appendChild(sc);
  }));
  async function mountBot(el, key, before) {
    if (!key || PREVIEW) return null;
    const box = document.createElement("div"); box.className = "lab-bot";
    el.insertBefore(box, before);
    const ts = await loadTs();
    if (!ts) return { get: () => "", reset() {}, broken: true };
    let token = "";
    const id = ts.render(box, { sitekey: key, callback: (t) => { token = t; }, "expired-callback": () => { token = ""; }, "error-callback": () => { token = ""; } });
    return { get: () => token, reset() { token = ""; try { ts.reset(id); } catch (_) {} } };
  }
  const BOT_MSG = { bot_check_failed: "確認のチェックが通りませんでした。チェックをやり直してから、もう一度送ってください", too_many: "短い時間に何度も送られています。時間をおいてもう一度お試しください" };
  const WHY = { required: "答えてください", not_number: "数で入れてください", not_date: "日付を選んでください", not_option: "選択肢から選んでください", too_long: "長すぎます" };
  function input(it) {
    const id = "lab-a-" + it.key, req = it.required ? " required" : "";
    if (it.type === "textarea") return '<textarea class="lab-input" id="' + id + '" rows="4"' + req + '></textarea>';
    if (it.type === "date") return '<input class="lab-input" id="' + id + '" type="date"' + req + '>';
    if (it.type === "select") return '<select class="lab-input" id="' + id + '"' + req + '><option value="">選んでください</option>' + (it.options || []).map((o) => "<option>" + esc(o) + "</option>").join("") + "</select>";
    return '<input class="lab-input" id="' + id + '" type="text"' + (it.type === "number" ? ' inputmode="numeric"' : ' maxlength="200"') + req + '>';
  }
  const css = document.createElement("style");
  css.textContent = ".lab-form,.lab-checkout{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px;text-align:left;box-sizing:border-box}.lab-form label{display:block;font-size:14px;margin:0 0 4px}.lab-input{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;font-size:16px;border:1px solid #c9c9c9;border-radius:8px;background:#fff;color:#111}.lab-btn{display:inline-block;box-sizing:border-box;width:100%;min-height:52px;border:0;border-radius:10px;background:#1f6f5c;color:#fff;font-size:17px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;line-height:52px;padding:0 16px}.lab-btn[disabled]{opacity:.6}.lab-note{font-size:13px;opacity:.8}.lab-err{color:#b3261e;font-size:13px}.lab-check{display:flex;gap:8px;align-items:flex-start;font-size:14px}.lab-days{display:flex;flex-direction:column;gap:10px}.lab-day-h{font-size:13px;font-weight:700;margin-bottom:4px}.lab-slots{display:flex;flex-wrap:wrap;gap:6px}.lab-slot{min-height:40px;padding:0 12px;border:1px solid #c9c9c9;border-radius:8px;background:#fff;color:#111;font-size:15px;cursor:pointer}.lab-slot.on{background:#1f6f5c;border-color:#1f6f5c;color:#fff}";
  // ページの CSS で上書きできるよう、差し込む見た目は head のいちばん前に置く
  document.head.insertBefore(css, document.head.firstChild);
  async function mountForm(el, slug) {
    el.classList.add("lab-form");
    const r = await fetch("/api/p/form/" + encodeURIComponent(slug)).then((x) => x.json()).catch(() => ({}));
    if (!r.ok) { el.innerHTML = '<p class="lab-note">このフォームはいま開いていません</p>'; return; }
    const f = r.form;
    el.innerHTML = (f.ask_name ? '<div><label>お名前</label><input class="lab-input" data-k="name" type="text" maxlength="60" autocomplete="name"></div>' : "")
      + '<div><label>メールアドレス<span class="lab-note">（必須）</span></label><input class="lab-input" data-k="email" type="email" required autocomplete="email"></div>'
      + f.items.map((it) => '<div><label for="lab-a-' + esc(it.key) + '">' + esc(it.label) + (it.required ? '<span class="lab-note">（必須）</span>' : "") + "</label>" + input(it) + '<div class="lab-err" data-e="' + esc(it.key) + '"></div></div>').join("")
      + '<label class="lab-check"><input type="checkbox" data-k="consent"><span><a href="' + LAB + '/legal/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>と<a href="' + LAB + '/legal/tokushoho" target="_blank" rel="noopener">特定商取引法に基づく表記</a>を確かめました</span></label>'
      + '<button type="button" class="lab-btn">' + (PREVIEW ? "（見本なので送れません）" : "送る") + '</button><div class="lab-err" data-msg></div>';
    const q = (s) => el.querySelector(s), go = q(".lab-btn"), msg = q("[data-msg]");
    if (PREVIEW) { go.disabled = true; return; }
    const bot = await mountBot(el, r.bot_site_key, go);
    go.addEventListener("click", async () => {
      el.querySelectorAll("[data-e]").forEach((x) => (x.textContent = ""));
      if (bot && !bot.get()) { msg.textContent = bot.broken ? "確認のチェックを読み込めませんでした。ページを開き直してください" : "確認のチェックが終わるまでお待ちください"; return; }
      const email = q('[data-k="email"]').value.trim();
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { msg.textContent = "メールアドレスを確かめてください"; return; }
      if (!q('[data-k="consent"]').checked) { msg.textContent = "プライバシーポリシーと表記を確かめて、チェックを入れてください"; return; }
      const answers = {};
      for (const it of f.items) answers[it.key] = q("#lab-a-" + CSS.escape(it.key)).value;
      go.disabled = true; msg.textContent = "送っています…";
      const res = await fetch("/api/p/form/" + encodeURIComponent(slug), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: q('[data-k="name"]') ? q('[data-k="name"]').value.trim() : "", consent: true, answers, page: PAGE, r: route, vid, source: store.get("lab_src") || "direct", turnstile: bot ? bot.get() : "" }) })
        .then((x) => x.json()).catch(() => ({ ok: false, error: "network" }));
      go.disabled = false;
      if (!res.ok && bot) bot.reset();
      if (BOT_MSG[res.error]) { msg.textContent = BOT_MSG[res.error]; return; }
      if (res.ok && res.thanks_url && /^https:[/][/]/.test(res.thanks_url)) { if (res.u) store.set("lab_u", res.u); location.href = res.thanks_url; return; }
      if (res.ok) { if (res.u) store.set("lab_u", res.u); el.innerHTML = '<p class="lab-note" style="white-space:pre-wrap">' + esc(res.thanks || "受け取りました。ありがとうございます。") + "</p>"; return; }
      if (res.error === "bad_answers") { for (const b of res.fields || []) { const e = q('[data-e="' + b.key + '"]'); if (e) e.textContent = WHY[b.error] || "確かめてください"; } msg.textContent = "赤い字の欄を直してください"; return; }
      msg.textContent = res.error === "bad_email" ? "メールアドレスを確かめてください" : "送れませんでした。時間をおいてもう一度お試しください";
    });
  }
  async function mountCheckout(el, id) {
    el.classList.add("lab-checkout");
    const r = await fetch("/api/p/product/" + encodeURIComponent(id)).then((x) => x.json()).catch(() => ({}));
    if (!r.ok) { el.innerHTML = ""; return; }
    const p = r.product;
    const price = p.price_label || (Number(p.amount).toLocaleString("ja-JP") + "円" + (p.period === "monthly" ? "／月" : p.period === "annually" ? "／年" : ""));
    const href = r.register_url + "?product=" + encodeURIComponent(p.id) + (route ? "&r=" + encodeURIComponent(route) : "");
    el.innerHTML = '<div style="font-weight:700">' + esc(p.name) + '</div><div style="font-size:22px;font-weight:700">' + esc(price) + "</div>"
      + '<a class="lab-btn" href="' + (PREVIEW ? "#" : esc(href)) + '" data-lab-button="checkout:' + esc(p.id) + '">申し込む</a>';
  }
  // 便 13b：予約の枠。空き時間を日ごとに並べ、押した枠で予約する
  async function mountBooking(el, slug) {
    el.classList.add("lab-form");
    const r = await fetch("/api/p/booking/" + encodeURIComponent(slug)).then((x) => x.json()).catch(() => ({}));
    if (!r.ok) { el.innerHTML = '<p class="lab-note">この予約はいま受け付けていません</p>'; return; }
    if (!r.slots.length) { el.innerHTML = '<p class="lab-note">いま予約できる空き時間がありません。少し時間をおいてもう一度ご覧ください</p>'; return; }
    const days = [];
    for (const s of r.slots) { let d = days.find((x) => x.day === s.day); if (!d) days.push(d = { day: s.day, items: [] }); d.items.push(s); }
    let picked = "";
    el.innerHTML = '<div style="font-weight:700">' + esc(r.type.title) + (/分/.test(r.type.title) ? '' : '（' + esc(r.type.minutes) + ' 分）') + '</div><div class="lab-note">ご都合のよい時間を 1 つ選んでください</div>'
      + '<div class="lab-days">' + days.map((d) => '<div class="lab-day"><div class="lab-day-h">' + esc(d.day) + '</div><div class="lab-slots">' + d.items.map((s) => '<button type="button" class="lab-slot" data-slot="' + esc(s.slot) + '">' + esc(s.label.split("）")[1] || s.label) + "</button>").join("") + "</div></div>").join("") + "</div>"
      + '<div class="lab-picked lab-note" data-picked>まだ選んでいません</div>'
      + '<div><label>お名前</label><input class="lab-input" data-k="name" type="text" maxlength="60" autocomplete="name"></div>'
      + '<div><label>メールアドレス<span class="lab-note">（必須）</span></label><input class="lab-input" data-k="email" type="email" required autocomplete="email"></div>'
      + '<div><label>相談したいこと</label><textarea class="lab-input" data-k="topic" rows="3" maxlength="1000"></textarea></div>'
      + '<label class="lab-check"><input type="checkbox" data-k="consent"><span><a href="' + LAB + '/legal/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>と<a href="' + LAB + '/legal/tokushoho" target="_blank" rel="noopener">特定商取引法に基づく表記</a>を確かめました</span></label>'
      + '<button type="button" class="lab-btn" data-go>' + (PREVIEW ? "（見本なので予約できません）" : "この時間で予約する") + '</button><div class="lab-err" data-msg></div>';
    const q = (s) => el.querySelector(s), msg = q("[data-msg]"), go = q("[data-go]");
    el.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => {
      el.querySelectorAll("[data-slot]").forEach((x) => x.classList.toggle("on", x === b));
      picked = b.dataset.slot;
      const s = r.slots.find((x) => x.slot === picked);
      q("[data-picked]").textContent = "選んだ時間：" + (s ? s.label : "");
    }));
    if (PREVIEW) { go.disabled = true; return; }
    const bot = await mountBot(el, r.bot_site_key, go);
    go.addEventListener("click", async () => {
      const email = q('[data-k="email"]').value.trim();
      if (!picked) { msg.textContent = "時間を 1 つ選んでください"; return; }
      if (bot && !bot.get()) { msg.textContent = bot.broken ? "確認のチェックを読み込めませんでした。ページを開き直してください" : "確認のチェックが終わるまでお待ちください"; return; }
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { msg.textContent = "メールアドレスを確かめてください"; return; }
      if (!q('[data-k="consent"]').checked) { msg.textContent = "プライバシーポリシーと表記を確かめて、チェックを入れてください"; return; }
      go.disabled = true; msg.textContent = "予約しています…";
      const res = await fetch("/api/p/booking/" + encodeURIComponent(slug), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: q('[data-k="name"]').value.trim(), topic: q('[data-k="topic"]').value, consent: true, slot: picked, page: PAGE, r: route, vid, source: store.get("lab_src") || "direct", turnstile: bot ? bot.get() : "" }) })
        .then((x) => x.json()).catch(() => ({ ok: false, error: "network" }));
      go.disabled = false;
      if (!res.ok && bot) bot.reset();
      if (BOT_MSG[res.error]) { msg.textContent = BOT_MSG[res.error]; return; }
      if (res.ok && res.u) store.set("lab_u", res.u);
      if (res.ok && res.thanks_url && /^https:[/][/]/.test(res.thanks_url)) { location.href = res.thanks_url; return; }
      if (res.ok) { el.innerHTML = '<p class="lab-note" style="white-space:pre-wrap">' + esc(res.label + " で予約を受け付けました。確認のメールをお送りしました。") + "</p>"; return; }
      msg.textContent = res.error === "slot_taken" ? "その時間はちょうど埋まりました。ほかの時間を選んでください" : res.error === "already_booked" ? "すでに " + (res.label || "") + " で予約があります" : res.error === "bad_email" ? "メールアドレスを確かめてください" : "予約できませんでした。時間をおいてもう一度お試しください";
    });
  }
  document.querySelectorAll("[data-lab-part]").forEach((el) => {
    const v = el.getAttribute("data-lab-part") || "";
    if (v.startsWith("booking:")) mountBooking(el, v.slice(8));
    else if (v.startsWith("form:")) mountForm(el, v.slice(5));
    else if (v.startsWith("checkout:")) mountCheckout(el, v.slice(9));
  });
})();
`;

// B の便 8c：企画と設計図。
// 設計図は別の表に描かない。部品（ページ・ステップ・一斉配信・セミナー・予約・商品・教材・添削・オプチャ）と、
// 部品どうしのつながり（ステップのきっかけ・商品の権利・一斉配信の宛先の条件）から毎回組み立てる。
// 企画は b_campaigns、部品の持ち主は b_campaign_parts（部品 1 つに持ち主は 1 つ）。「常設」は 1 つだけ。
// 名前は 2 つ：外の名前（生徒に見える・各部品の名前や件名そのまま）と、中の名前（シアニン用・「企画名｜種類｜役目」で自動）。
// 企画をしまえるのは、持ち主の部品が 1 つも動いていないときだけ。部品を消す道は作らない。

import { SEMINARS } from "./bin4.js";
import { MEMBER_KEYS } from "./bridge.js";

// 便 8d：レーンはお客さんの段階で 7 つ（版 6・Naoki 確定）
export const LANES = [
  { id: "meet", label: "出会う" },
  { id: "signup", label: "登録" },
  { id: "warm", label: "温める" },
  { id: "consult", label: "相談" },
  { id: "buy", label: "購入" },
  { id: "learn", label: "受講" },
  { id: "refer", label: "紹介" },
];

// 便 8d：片付け案で常設へ入れるときの役目（商品はまとまりの名前を使う）
const TIDY_ROLE = { page: "入口のページ", step: "ステップ", broadcast: "一斉配信", seminar: "セミナー", booking: "個別相談の枠", course: "教材", room: "添削", community: "オプチャ" };

// 便 8d：商品のまとまりの名前。同じ UTAGE の商品から写した売り方の名前の、頭の共通部分（2 文字に満たなければ最初の名前）
export function groupName(names) {
  const list = names.map((x) => String(x || "")).filter(Boolean);
  if (!list.length) return "";
  let pre = list[0];
  for (const n of list.slice(1)) { let i = 0; while (i < pre.length && i < n.length && pre[i] === n[i]) i++; pre = pre.slice(0, i); }
  pre = pre.replace(/[\s（(【\[｜|・:：\-－]+$/u, "").trim();
  return pre.length >= 2 ? pre : list[0];
}

export const PART_TYPES = {
  page: "ページ", step: "ステップ", broadcast: "一斉配信", seminar: "セミナー", booking: "予約",
  product: "商品", course: "教材", room: "添削", community: "オプチャ",
  // 便 19：フォームも企画に入れられる（一覧を企画で絞るため）
  form: "フォーム",
};

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PREFIX_RE = /^\d{4}-\d{2}\s/;
const WEEK_TYPES = ["registered", "purchase_completed", "email_sent", "consult_booked", "lesson_viewed", "correction_submitted", "seminar_registered", "form_submitted", "page_viewed"];

// 中の名前（シアニン用）。役目が空なら外の名前を使う
export function innerName(campaignName, partType, role, outerName) {
  const r = String(role || "").trim() || String(outerName || "").trim();
  return `${campaignName || "未整理"}｜${PART_TYPES[partType] || partType}｜${r}`;
}

// 企画名の頭に年月を付ける（開催日があればその月、無ければ日本時間の今月）。もう付いていれば付けない
export function campaignName(title, startsOn, now = new Date()) {
  const t = String(title || "").trim().replace(/\s+/g, " ");
  if (MONTH_PREFIX_RE.test(t)) return t;
  const ym = startsOn && DATE_RE.test(startsOn) ? startsOn.slice(0, 7)
    : new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 7);
  return `${ym} ${t}`;
}

// 部品の一覧（外の名前・レーン・状態）を、いまの表から作る
export function buildParts({ products = [], steps = [], broadcasts = [], seminars = [], courseCount = 0, community = "", forms = [], pages = [], pageParts = {} }, now = new Date()) {
  const parts = [];
  const add = (type, id, lane, name, state, extra = {}) => parts.push({ key: `${type}:${id}`, type, id: String(id), lane, name, state, ...extra });
  add("page", "front", "meet", "トップの LP（/）", "running", { url: "/" });
  add("page", "register", "signup", "無料登録（/register）", "running", { url: "/register" });
  // 便 12a：Claude が作ったページ（出会うのレーン）。lp_parts は公開中（無ければ最新）の版の印
  for (const pg of pages) add("page", pg.id, "meet", pg.title, pg.status === "published" ? "running" : pg.status === "stopped" ? "stopped" : "draft", { slug: pg.slug, url: pg.url, lp: true, lp_parts: pageParts[pg.id] || {} });
  // 便 19：フォーム（答えた人は台帳に入るので、登録のレーンに置く）
  for (const f of forms) add("form", f.id, "signup", f.title, f.active ? "running" : "draft", { slug: f.slug, url: "/form?f=" + f.slug });
  // 便 8e：ステップの表はコネクタ（トリガー → セレクタ → アクション）。メールを送らないコネクタは名前で出す
  for (const s of steps) {
    const mail = !s.action || s.action === "send_email";
    add("step", s.id, "warm", (mail ? s.subject || s.name : s.name || s.subject) || `コネクタ ${s.id}`, s.active ? "running" : "draft",
      { trigger: s.trigger, product_id: s.product_id || null, trigger_args: s.trigger_args || {}, action: s.action || "send_email", note: s.name || "" });
  }
  for (const b of broadcasts) {
    const st = b.status === "draft" ? "draft" : (b.status === "queued" || b.status === "sending") ? "running" : "stopped";
    add("broadcast", b.id, "warm", b.subject || "（件名なし）", st, { filter: b.filter || {} });
  }
  for (const s of seminars) add("seminar", s.id, "warm", s.title, new Date(s.starts_at) < now ? "stopped" : "running", { starts_at: s.starts_at });
  add("booking", "consult", "consult", "個別相談（30 分）", "running");
  const groups = {};
  for (const p of products) { const g = p.utage_product_id || p.id; (groups[g] = groups[g] || []).push(p.name); }
  for (const p of products) {
    const g = p.utage_product_id || p.id;
    add("product", p.id, "buy", p.name, p.active ? "running" : "stopped", { grants: p.grants || [], group: `pg:${g}`, group_name: groupName(groups[g]), group_size: groups[g].length });
  }
  add("course", "mn", "learn", `しあらぼの教材（${courseCount} 本）`, courseCount ? "running" : "stopped");
  add("room", "correction", "learn", "添削ルーム", "running");
  add("community", "openchat", "learn", "オプチャ", community ? "running" : "stopped");
  return parts;
}

// つながり（線）。実際の設定にあるものだけを引く
export function buildEdges(parts) {
  const edges = [];
  const has = new Set(parts.map((p) => p.key));
  const add = (from, to, label = "") => { if (has.has(from) && has.has(to)) edges.push({ from, to, label }); };
  const products = parts.filter((p) => p.type === "product");
  add("page:front", "page:register", "登録");
  // 便 12a：ページの中の申込の枠 → そのフォーム、決済の枠 → その商品
  for (const pg of parts.filter((p) => p.type === "page" && p.lp)) {
    for (const slug of (pg.lp_parts && pg.lp_parts.forms) || []) for (const f of parts.filter((x) => x.type === "form" && x.slug === slug)) add(pg.key, f.key, "申込");
    for (const id of (pg.lp_parts && pg.lp_parts.checkouts) || []) add(pg.key, `product:${id}`, "申し込む");
  }
  for (const s of parts.filter((p) => p.type === "step")) {
    if (s.trigger === "registered") add("page:register", s.key, "登録した人");
    if (s.trigger === "purchase") {
      if (s.product_id) add(`product:${s.product_id}`, s.key, "買った人");
      else for (const p of products.filter((x) => x.state === "running")) add(p.key, s.key, "買った人");
    }
    if (s.trigger === "lesson_viewed") add("course:mn", s.key, "教材を見た人");
    if (s.trigger === "correction_submitted") add("room:correction", s.key, "添削を出した人");
    if (s.trigger === "form_submitted") {
      const slug = s.trigger_args && s.trigger_args.form;
      for (const f of parts.filter((x) => x.type === "form" && (!slug || x.slug === slug))) add(f.key, s.key, "答えた人");
    }
  }
  for (const p of products) {
    if ((p.grants || []).some((g) => MEMBER_KEYS.includes(g))) {
      add(p.key, "course:mn", "権利");
      add(p.key, "community:openchat", "権利");
    }
  }
  for (const b of parts.filter((p) => p.type === "broadcast")) {
    for (const id of (b.filter && Array.isArray(b.filter.bought) ? b.filter.bought : [])) add(`product:${id}`, b.key, "買った人へ");
  }
  return edges;
}

// 出来事 1 つが、どの部品に当たるか（当たらなければ null）
export function partKeyOf(e) {
  const p = e.payload || {};
  if (e.type === "registered") return "page:register";
  if (e.type === "purchase_completed" && p.product_id) return `product:${p.product_id}`;
  if (e.type === "email_sent" && p.kind === "step" && p.step_id != null) return `step:${p.step_id}`;
  if (e.type === "email_sent" && p.kind === "broadcast" && p.broadcast_id) return `broadcast:${p.broadcast_id}`;
  if (e.type === "consult_booked") return "booking:consult";
  if (e.type === "lesson_viewed") return "course:mn";
  if (e.type === "correction_submitted") return "room:correction";
  if (e.type === "seminar_registered" && p.seminar_id) return `seminar:${p.seminar_id}`;
  if (e.type === "form_submitted" && p.form_id) return `form:${p.form_id}`;
  // 便 12a：ページを見た（台帳にいる人だけ。見た人の数そのものは b_page_hits から数える）
  if (e.type === "page_viewed" && p.page_id) return `page:${p.page_id}`;
  return null;
}

// 先週（7 日）の数を部品ごとに数える
export function weekCounts(events) {
  const c = {};
  for (const e of events) { const k = partKeyOf(e); if (k) c[k] = (c[k] || 0) + 1; }
  return c;
}

// 便 8g-3：線ごとの人数。先週 7 日に行き先の部品に当たった人のうち、その前に出元の部品に当たっていた人の数（1 人 1 回）。
// 人ごとの足どりで数えるので、行き先に入る線が 2 本以上あっても線ごとに分けられる。
// 出元に出来事が無い部品（トップの LP など）は数えられないので、返す表に入れない（呼ぶ側で行き先の数に戻す）
export function edgeCounts(edges, events, since) {
  const t0 = new Date(since).getTime();
  const first = new Map(); // 人 → 部品 → 最初に当たった時刻
  const hits = []; // 先週の行き先の候補 { cid, key, at }
  for (const e of events) {
    const k = partKeyOf(e);
    if (!k || !e.customer_id) continue;
    const at = new Date(e.occurred_at).getTime();
    if (!first.has(e.customer_id)) first.set(e.customer_id, new Map());
    const m = first.get(e.customer_id);
    if (!m.has(k) || at < m.get(k)) m.set(k, at);
    if (at >= t0) hits.push({ cid: e.customer_id, key: k, at });
  }
  const out = {};
  for (const ed of edges) {
    if (ed.from === "page:front" || ed.from.startsWith("community:")) continue; // 出来事の無い部品
    const people = new Set();
    for (const h of hits) {
      if (h.key !== ed.to) continue;
      const fromAt = first.get(h.cid) && first.get(h.cid).get(ed.from);
      if (fromAt != null && fromAt <= h.at) people.add(h.cid);
    }
    out[`${ed.from}>${ed.to}`] = people.size;
  }
  return out;
}

// 便 12a：ページの先週の数は「見た人」（端末ごと 1 回・まだ登録していない人も含む）
export function pageWeek(pages, hits) {
  const out = {};
  for (const pg of pages) out[`page:${pg.id}`] = new Set(hits.filter((x) => x.page_id === pg.id && x.kind === "view").map((x) => x.vid)).size;
  return out;
}
// 便 12a：ページ → フォームの線は、そのページから答えた人（form_submitted の payload.page_id）。登録前の人も数えられる
export function pageEdgeWeek(edges, recent) {
  const out = {};
  for (const ed of edges) {
    if (!ed.from.startsWith("page:") || !ed.to.startsWith("form:")) continue;
    const pageId = ed.from.slice(5), formId = ed.to.slice(5);
    out[`${ed.from}>${ed.to}`] = new Set(recent.filter((e) => e.type === "form_submitted" && e.payload && e.payload.page_id === pageId && e.payload.form_id === formId).map((e) => e.customer_id)).size;
  }
  return out;
}

// 部品・線・企画・持ち主を合わせて、設計図 1 枚の形にする。view は all／unassigned／企画の番号
export function assemble({ parts, edges, campaigns, owners, week, edgeWeek = {} }, view = "all") {
  const cmap = Object.fromEntries(campaigns.map((c) => [c.id, c]));
  const omap = Object.fromEntries(owners.map((o) => [`${o.part_type}:${o.part_id}`, o]));
  const archived = new Set(campaigns.filter((c) => c.archived_at).map((c) => c.id));
  const linked = new Map(parts.map((p) => [p.key, new Set()]));
  for (const e of edges) { linked.get(e.from).add(e.to); linked.get(e.to).add(e.from); }
  const full = parts.map((p) => {
    const o = omap[p.key];
    const c = o ? cmap[o.campaign_id] : null;
    return {
      ...p,
      campaign_id: c ? c.id : null,
      campaign_name: c ? c.name : null,
      role: o ? o.role : "",
      // 便 8g-4：企画の中のブロック（空ならブロックに入っていない）と、作った元のテンプレ
      block_name: o ? (o.block_name || "") : "",
      template_id: o ? (o.template_id || null) : null,
      template_version: o ? (o.template_version || null) : null,
      inner_name: innerName(c ? c.name : null, p.type, o ? o.role : "", p.name),
      week: week[p.key] || 0,
      isolated: linked.get(p.key).size === 0,
    };
  });
  const byKey = Object.fromEntries(full.map((p) => [p.key, p]));
  for (const p of full) {
    const used = new Set();
    for (const k of linked.get(p.key)) { const q = byKey[k]; if (q.campaign_id && q.campaign_id !== p.campaign_id) used.add(q.campaign_id); }
    p.used_by = [...used].map((id) => ({ id, name: cmap[id].name }));
  }
  let shown;
  if (view === "all") shown = full.filter((p) => !(p.campaign_id && archived.has(p.campaign_id)));
  else {
    const own = view === "unassigned" ? full.filter((p) => !p.campaign_id) : full.filter((p) => p.campaign_id === view);
    const keys = new Set(own.map((p) => p.key));
    const near = new Set();
    for (const k of keys) for (const n of linked.get(k)) if (!keys.has(n)) near.add(n);
    shown = [...own, ...[...near].map((k) => ({ ...byKey[k], outside: true }))];
  }
  const shownKeys = new Set(shown.map((p) => p.key));
  // 便 8g-3：線の数は人ごとの足どりで数えた先週の人数（edgeCounts）。出元に出来事が無い線（トップの LP → 登録など）だけは、
  // 行き先に入る線が 1 本のときに限り行き先の先週の数を使う（2 本以上なら分けられないので 0・counted none）
  const incoming = {};
  for (const e of edges) incoming[e.to] = (incoming[e.to] || 0) + 1;
  const sEdges = edges.filter((e) => shownKeys.has(e.from) && shownKeys.has(e.to)).map((e) => {
    const k = `${e.from}>${e.to}`;
    if (k in edgeWeek) return { ...e, week: edgeWeek[k], counted: "path" };
    if (incoming[e.to] === 1) return { ...e, week: (byKey[e.to] && byKey[e.to].week) || 0, counted: "target" };
    return { ...e, week: 0, counted: "none" };
  });
  const counts = {};
  for (const p of full) { const k = p.campaign_id || "unassigned"; counts[k] = (counts[k] || 0) + 1; }
  return {
    lanes: LANES,
    view,
    parts: shown,
    edges: sEdges,
    unassigned_count: counts.unassigned || 0,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, starts_on: c.starts_on, archived_at: c.archived_at, parts: counts[c.id] || 0 })),
  };
}

export function makePlan(h) {
  const { db, logInbound, communityLink, changes, pages: pagesMod } = h;

  async function loadAll(env) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [products, steps, broadcasts, lessons, community, campaigns, owners, events, forms] = await Promise.all([
      db(env, "GET", "b_products?select=id,name,active,grants,sort,utage_product_id&order=sort.asc"),
      db(env, "GET", "b_steps?select=id,name,trigger,trigger_args,product_id,subject,active,action&order=sort.asc,id.asc"),
      db(env, "GET", "b_broadcasts?select=id,subject,status,filter,created_at&order=created_at.desc&limit=50"),
      db(env, "GET", "mn_lessons?select=lesson_id&limit=5000"),
      communityLink(env),
      db(env, "GET", "b_campaigns?select=*&order=kind.desc,created_at.asc"),
      db(env, "GET", "b_campaign_parts?select=*"),
      // 便 8g-3：線の人数を人ごとの足どりで数えるので、期間で切らずに人と時刻つきで読む（先週の数はこの中から数える）
      db(env, "GET", `events?select=customer_id,type,payload,occurred_at&type=in.(${WEEK_TYPES.join(",")})&order=id.asc&limit=50000`),
      // 便 19：フォーム（表がまだ無い置き場でも設計図は出す）
      db(env, "GET", "b_forms?select=id,title,slug,active&order=created_at.asc").catch(() => []),
    ]);
    // 便 12a：ページ（表がまだ無い置き場でも設計図は出す）と、先週の見た人（まだ登録していない人も含む）
    const lp = pagesMod ? await pagesMod.forPlan(env).catch(() => ({ pages: [], partsOf: {} })) : { pages: [], partsOf: {} };
    const lpHits = lp.pages.length && pagesMod ? await pagesMod.hitsSince(env, since).catch(() => []) : [];
    const owned = new Set(owners.filter((o) => o.part_type === "product").map((o) => o.part_id));
    const shownProducts = products.filter((p) => p.active || owned.has(p.id));
    const parts = buildParts({
      products: shownProducts, steps, broadcasts, seminars: SEMINARS,
      courseCount: new Set(lessons.map((l) => l.lesson_id)).size, community: community.url, forms, pages: lp.pages, pageParts: lp.partsOf,
    });
    const edges = buildEdges(parts);
    const t0 = new Date(since).getTime();
    const recent = events.filter((e) => new Date(e.occurred_at).getTime() >= t0);
    const week = weekCounts(recent);
    const edgeWeek = edgeCounts(edges, events, since);
    Object.assign(week, pageWeek(lp.pages, lpHits));
    Object.assign(edgeWeek, pageEdgeWeek(edges, recent));
    return { parts, edges, campaigns, owners, week, edgeWeek, hiddenProducts: products.length - shownProducts.length };
  }

  async function blueprint(env, { campaign_id = "all" } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const view = campaign_id === "unassigned" || campaign_id === "all" || !campaign_id ? (campaign_id || "all") : String(campaign_id);
    if (view !== "all" && view !== "unassigned" && !UUID_RE.test(view)) return { ok: false, error: "bad_campaign_id" };
    const all = await loadAll(env);
    if (UUID_RE.test(view) && !all.campaigns.some((c) => c.id === view)) return { ok: false, error: "campaign_not_found" };
    return { ok: true, ...assemble(all, view), stopped_products_hidden: all.hiddenProducts };
  }

  // 便 19：一覧の「企画」の列と絞り込みに使う軽い一覧（部品ごとの持ち主の企画）。出来事は読まない
  async function owners(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", campaigns: [], owners: [] };
    const [campaigns, rows] = await Promise.all([
      db(env, "GET", "b_campaigns?select=id,name,kind,archived_at&order=kind.desc,created_at.asc"),
      db(env, "GET", "b_campaign_parts?select=part_type,part_id,campaign_id,block_name"),
    ]);
    return { ok: true, campaigns, owners: rows };
  }

  async function listCampaigns(env, { include_archived = false } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const all = await loadAll(env);
    const a = assemble(all, "all");
    const list = a.campaigns.filter((c) => include_archived === true || include_archived === "true" || !c.archived_at);
    return { ok: true, count: list.length, campaigns: list, unassigned_count: a.unassigned_count };
  }

  async function createCampaign(env, { title, starts_on = null }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const t = String(title || "").trim();
    if (!t || t.length > 60) return { ok: false, error: "bad_title", note: "1〜60 文字" };
    if (starts_on && !DATE_RE.test(String(starts_on))) return { ok: false, error: "bad_starts_on", note: "YYYY-MM-DD" };
    const name = campaignName(t, starts_on);
    const dup = await db(env, "GET", `b_campaigns?select=id&name=eq.${encodeURIComponent(name)}&archived_at=is.null`);
    if (dup.length) return { ok: false, error: "name_taken", name };
    const now = new Date().toISOString();
    const [row] = await db(env, "POST", "b_campaigns",
      [{ name, kind: "campaign", starts_on: starts_on || null, created_by: String(actor).slice(0, 200), updated_by: String(actor).slice(0, 200), updated_at: now }],
      "return=representation");
    await logInbound(env, "campaign", { action: "create", id: row.id, name, by: actor }, { ok: true }, 200);
    return { ok: true, campaign: row };
  }

  // 部品の持ち主と役目を変える。campaign_id を空にすると「企画に入っていない」に戻す
  async function setPartCampaign(env, { part_type, part_id, campaign_id = null, role = "", block_name }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!PART_TYPES[part_type]) return { ok: false, error: "bad_part_type", types: Object.keys(PART_TYPES) };
    const r = String(role || "").trim();
    if (r.length > 60) return { ok: false, error: "role_too_long", max: 60 };
    const all = await loadAll(env);
    const key = `${part_type}:${String(part_id)}`;
    if (!all.parts.some((p) => p.key === key)) return { ok: false, error: "part_not_found", key };
    const prev = all.owners.find((o) => o.part_type === part_type && String(o.part_id) === String(part_id));
    const before = prev ? { campaign_id: prev.campaign_id, role: prev.role || "" } : null;
    const outerName = (all.parts.find((p) => p.key === key) || {}).name || key;
    if (!campaign_id) {
      await db(env, "DELETE", `b_campaign_parts?part_type=eq.${part_type}&part_id=eq.${encodeURIComponent(String(part_id))}`, undefined, "return=minimal");
      await logInbound(env, "campaign", { action: "unassign", key, by: actor }, { ok: true }, 200);
      if (changes) await changes.record(env, { kind: "part", target: key, before, after: null, summary: `${outerName} を企画から外した`, actor });
      return { ok: true, key, campaign_id: null };
    }
    if (!UUID_RE.test(String(campaign_id))) return { ok: false, error: "bad_campaign_id" };
    const c = all.campaigns.find((x) => x.id === campaign_id);
    if (!c) return { ok: false, error: "campaign_not_found" };
    if (c.archived_at) return { ok: false, error: "campaign_archived" };
    // 便 8g-4：ブロック名。渡されたらその名前、企画が変わるときは空に戻す（前の企画のブロックを引きずらないため）
    const row = { part_type, part_id: String(part_id), campaign_id, role: r, updated_at: new Date().toISOString(), updated_by: String(actor).slice(0, 200) };
    if (block_name !== undefined) {
      const bn = String(block_name || "").trim();
      if (bn.length > 60) return { ok: false, error: "block_name_too_long", max: 60 };
      row.block_name = bn;
    } else if (prev && prev.campaign_id !== campaign_id) row.block_name = "";
    await db(env, "POST", "b_campaign_parts?on_conflict=part_type,part_id", [row], "resolution=merge-duplicates,return=minimal");
    await logInbound(env, "campaign", { action: "assign", key, campaign_id, role: r, by: actor }, { ok: true }, 200);
    if (changes) await changes.record(env, { kind: "part", target: key, before, after: { campaign_id, role: r }, summary: `${outerName} を企画「${c.name}」へ`, actor });
    const outer = (all.parts.find((p) => p.key === key) || {}).name;
    return { ok: true, key, campaign_id, campaign_name: c.name, role: r, block_name: row.block_name ?? (prev ? prev.block_name || "" : ""), inner_name: innerName(c.name, part_type, r, outer) };
  }

  // しまう（restore が真なら戻す）。常設はしまえない。持ち主の部品が 1 つでも動いていたらしまわずに並べて返す
  async function archiveCampaign(env, { campaign_id, restore = false }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!UUID_RE.test(String(campaign_id || ""))) return { ok: false, error: "bad_campaign_id" };
    const all = await loadAll(env);
    const c = all.campaigns.find((x) => x.id === campaign_id);
    if (!c) return { ok: false, error: "campaign_not_found" };
    if (c.kind === "standing") return { ok: false, error: "standing_cannot_archive" };
    const back = restore === true || restore === "true";
    if (back) {
      const dup = all.campaigns.find((x) => x.id !== c.id && !x.archived_at && x.name === c.name);
      if (dup) return { ok: false, error: "name_taken", name: c.name };
    } else {
      const mine = new Set(all.owners.filter((o) => o.campaign_id === c.id).map((o) => `${o.part_type}:${o.part_id}`));
      const running = all.parts.filter((p) => mine.has(p.key) && p.state === "running").map((p) => ({ key: p.key, name: p.name }));
      if (running.length) return { ok: false, error: "running_parts", running, note: "動いている部品がある間はしまえない。止めるか、別の企画へ移してから" };
    }
    const now = new Date().toISOString();
    await db(env, "PATCH", `b_campaigns?id=eq.${c.id}`, { archived_at: back ? null : now, updated_at: now, updated_by: String(actor).slice(0, 200) }, "return=minimal");
    await logInbound(env, "campaign", { action: back ? "restore" : "archive", id: c.id, by: actor }, { ok: true }, 200);
    return { ok: true, campaign_id: c.id, archived: !back };
  }

  // 便 8d：片付け案。企画に入っていない部品を、常設へ入れる案にする（下書き・何も変えない）。
  // AI が別の振り分けを考えたときは apply_tidy に assignments を渡して当てる
  async function tidyPlan(env) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const all = await loadAll(env);
    const a = assemble(all, "all");
    const standing = all.campaigns.find((c) => c.kind === "standing");
    const loose = a.parts.filter((p) => !p.campaign_id);
    const assignments = loose.map((p) => ({
      part_type: p.type, part_id: p.id, name: p.name,
      campaign_id: standing ? standing.id : null, campaign_name: standing ? standing.name : null,
      role: p.type === "product" ? (p.group_name || p.name) : p.type === "broadcast" && p.state === "stopped" ? "過去の一斉配信" : (TIDY_ROLE[p.type] || ""),
    }));
    // 便 8e：部品が 1 つも無い企画（常設としまったものを除く）は、しまう案にする
    const used = new Set(all.owners.map((o) => o.campaign_id));
    const archives = all.campaigns.filter((c) => c.kind !== "standing" && !c.archived_at && !used.has(c.id)).map((c) => ({ campaign_id: c.id, name: c.name }));
    return { ok: true, count: assignments.length, assignments, archives, note: standing ? "案のまま当てると、部品はすべて常設に入り、空の企画はしまわれる。企画へ入れたいものは assignments の campaign_id を変えて渡す" : "常設の企画が無い（b8c_plan.sql を流すと作られる）" };
  }

  async function applyTidy(env, { assignments, archives } = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    let list = Array.isArray(assignments) ? assignments : null;
    let arch = Array.isArray(archives) ? archives.map((x) => (typeof x === "string" ? x : x && x.campaign_id)).filter(Boolean) : null;
    if (!list && !arch) { const p = await tidyPlan(env); if (!p.ok) return p; list = p.assignments; arch = p.archives.map((x) => x.campaign_id); }
    list = list || []; arch = arch || [];
    if (list.length > 200 || arch.length > 50) return { ok: false, error: "too_many", max: { assignments: 200, archives: 50 } };
    const applied = [], failed = [], archived = [];
    for (const x of list) {
      const r = await setPartCampaign(env, { part_type: x.part_type, part_id: x.part_id, campaign_id: x.campaign_id, role: x.role || "" }, actor);
      if (r.ok) applied.push(r.key); else failed.push({ part_type: x.part_type, part_id: x.part_id, error: r.error });
    }
    for (const id of arch) {
      const r = await archiveCampaign(env, { campaign_id: id }, actor);
      if (r.ok) archived.push(id); else failed.push({ campaign_id: id, error: r.error });
    }
    return { ok: failed.length === 0, applied: applied.length, archived: archived.length, failed, note: "部品は list_changes の番号で undo_change、しまった企画は archive_campaign（restore true）で戻す" };
  }

  return { blueprint, owners, listCampaigns, createCampaign, setPartCampaign, archiveCampaign, tidyPlan, applyTidy };
}

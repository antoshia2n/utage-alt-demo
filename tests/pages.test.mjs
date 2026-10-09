// 便 12a：ページ作成の試験。表は手元の入れ物で真似る（PostgREST の eq・is.null・not.is.null・in・gte・lte・payload->>・or だけ）。
// Worker の入口（src/index.js）は、Supabase の住所への fetch を同じ入れ物に向けて呼ぶ。
// 走らせ方：node --test tests/pages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePages, parseParts, injectEmbed, personToken, readPersonToken, previewToken, readPreviewToken, buildPrompt, ROUTE_RE, EMBED_JS } from "../src/pages.js";
import { makeForms } from "../src/forms.js";
import { autoLabels, TRIGGERS } from "../src/connect.js";
import { buildParts, buildEdges, pageWeek, pageEdgeWeek } from "../src/plan.js";
import { makeDeliver } from "../src/deliver.js";
import { fakeStore } from "./fake-store.mjs";

function setup() {
  const s = fakeStore();
  const env = { B_STORE: true, MCP_SECRET: "test-secret", PAGES_ORIGIN: "https://lp.shia2n.jp", PUBLIC_ORIGIN: "https://lab.shia2n.jp" };
  const regs = [];
  const addEvent = async (e, id, type, payload, actor = "site") => { const [row] = await s.db(e, "POST", "events", [{ customer_id: id, type, payload, actor }], "return=representation"); return row; };
  const registerPerson = async (e, b) => {
    regs.push(b);
    const email = String(b.email || "").toLowerCase();
    if (!/@/.test(email)) return { ok: false, error: "bad_email" };
    const ex = s.table("customers").find((c) => c.email === email);
    if (ex) { await addEvent(e, ex.id, "register_again", { route: b.route, page_id: b.page_id }); return { ok: true, id: ex.id, is_new: false }; }
    const id = crypto.randomUUID();
    s.table("customers").push({ id, email, name: b.name || "" });
    await addEvent(e, id, "registered", { source: b.source || "direct", via: b.via, route: b.route, page_id: b.page_id });
    return { ok: true, id, is_new: true };
  };
  const forms = makeForms({ db: s.db, addEvent, logInbound: async () => {}, registerPerson });
  const products = [{ id: "next-monthly", name: "シアラボNEXT 月払い", kind: "subscription", amount: 3000, period: "monthly", active: true }];
  const sell = {
    listProducts: async () => ({ products }),
    listForSite: async (e, id) => ({ products: products.filter((p) => p.id === id && p.active) }),
  };
  const pages = makePages({ db: s.db, addEvent, logInbound: async () => {}, forms, sell });
  // 公開中のフォーム 1 本（項目は 0 で足りるように直接置く）
  s.table("b_fields").push({ key: "x_account", label: "X のアカウント", type: "text", options: [] });
  s.table("b_forms").push({ id: "00000000-0000-4000-8000-0000000000f1", slug: "seminar-2611", title: "図解セミナー 11 月", intro: "", thanks: "受け取りました", items: [{ key: "x_account", required: false }], ask_name: true, active: true });
  return { ...s, env, pages, regs };
}

const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>図解セミナー</h1>
<a href="#apply" data-lab-button="cta-1">申し込む</a>
<div data-lab-part="form:seminar-2611"></div>
<div data-lab-part="checkout:next-monthly"></div></body></html>`;

test("印を拾う：フォーム・決済の枠・ボタン。読めない印は bad に入る", () => {
  const p = parseParts(HTML + '<div data-lab-part="video:x"></div><b data-lab-button="Bad Name">x</b>');
  assert.deepEqual(p.forms, ["seminar-2611"]);
  assert.deepEqual(p.checkouts, ["next-monthly"]);
  assert.deepEqual(p.buttons, ["cta-1"]);
  assert.equal(p.bad.length, 2);
});

test("差し込みの仕掛けは </body> の前に 1 回だけ（Claude が書いた同じ行は外す）", () => {
  const out = injectEmbed(HTML.replace("</body>", '<script src="/_lab/embed.js"></script></body>'), { page: "p1", preview: "0", lab: "https://lab.shia2n.jp" });
  assert.equal(out.match(/_lab[/]embed[.]js/g).length, 1);
  assert.ok(out.indexOf("_lab/embed.js") < out.indexOf("</body>"));
  assert.match(out, /data-page="p1"/);
  assert.match(injectEmbed("<p>本文だけ</p>", { page: "p2" }), /<p>本文だけ<\/p><script/);
});

test("経路の名前：日本語とハイフンは通し、空白・記号・長すぎは弾く", () => {
  for (const ok of ["x-固定ポスト", "note", "メルマガ10月", "yt_概要欄"]) assert.ok(ROUTE_RE.test(ok), ok);
  for (const ng of ["", " x", "a b", "a,b", "<x>", "-x", "あ".repeat(41)]) assert.ok(!ROUTE_RE.test(ng), ng);
});

test("その人の印・下書きを見る印：書き換えると通らない・期限が切れると通らない", async () => {
  const env = { MCP_SECRET: "k" };
  const cid = "11111111-1111-4111-8111-111111111111";
  const tok = await personToken(env, cid);
  assert.equal(await readPersonToken(env, tok), cid);
  assert.equal(await readPersonToken(env, tok.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), null);
  assert.equal(await readPersonToken({ MCP_SECRET: "other" }, tok), null);
  const pv = await previewToken(env, "page-1", 3);
  assert.equal(await readPreviewToken(env, "page-1", pv), 3);
  assert.equal(await readPreviewToken(env, "page-2", pv), null);
  assert.equal(await readPreviewToken(env, "page-1", await previewToken(env, "page-1", 3, -1000)), null);
});

test("依頼文：新しく作る依頼には目的・参考・材料と最初の一手、直す依頼にはもとの版とコメントが入る", async () => {
  const { pages, env, t } = setup();
  const r = await pages.createRequest(env, { purpose: "seminar", title: "図解セミナー 11 月の申込", reference: "UTAGE のシアラボ4~2ヶ月LPファネル", materials: "ドライブの構成メモ", comment: "ボタンを押したら知らせて" }, "naoki@example.com");
  assert.equal(r.ok, true);
  assert.match(r.prompt, new RegExp(`依頼番号 ${r.request.id}`));
  for (const w of ["セミナーの申込", "UTAGE のシアラボ4~2ヶ月LPファネル", "ドライブの構成メモ", "b__call", "get_page_request", "save_page_draft", "公開はしない"]) assert.ok(r.prompt.includes(w), w);
  assert.equal(t.b_page_requests[0].prompt, r.prompt, "依頼文は依頼の行に残る");
  assert.equal((await pages.createRequest(env, { purpose: "x", title: "a" })).error, "bad_purpose");
  assert.equal((await pages.createRequest(env, { purpose: "signup", title: "" })).error, "bad_title");
  assert.equal((await pages.createRequest(env, { page_id: "22222222-2222-4222-8222-222222222222", comment: "a" })).error, "page_not_found");
});

test("下書き → 公開 → 直しの依頼 → 版 2 → 版 2 を公開。住所の名前の決まりと、使えない印の知らせ", async () => {
  const { pages, env, t } = setup();
  const req = (await pages.createRequest(env, { purpose: "seminar", title: "図解セミナー 11 月の申込" })).request;
  assert.equal((await pages.saveDraft(env, { request_id: req.id, slug: "api", html: HTML })).error, "bad_slug");
  assert.equal((await pages.saveDraft(env, { request_id: req.id, slug: "zukai-1111", html: "" })).error, "need_html");
  const d1 = await pages.saveDraft(env, { request_id: req.id, slug: "zukai-1111", html: HTML.replace("checkout:next-monthly", "checkout:no-such"), note: "最初の版" });
  assert.equal(d1.ok, true);
  assert.equal(d1.version, 1);
  assert.ok(d1.warnings.some((w) => w.includes("no-such")), "売っていない商品は知らせる");
  assert.equal(t.b_pages[0].title, "図解セミナー 11 月の申込", "外の名前は依頼から");
  assert.equal(t.b_page_requests[0].done_version, 1);
  assert.equal(t.b_page_requests[0].done_page_id, d1.page_id);
  assert.equal((await pages.saveDraft(env, { slug: "zukai-1111", title: "x", html: HTML })).error, "slug_taken");
  // 下書きのままは出ない。見本の印があれば出る
  assert.equal(await pages.serve(env, "zukai-1111", null), null);
  const pv = await previewToken(env, d1.page_id, 1);
  const seen = await pages.serve(env, "zukai-1111", pv);
  assert.equal(seen.preview, true);
  assert.match(seen.html, /data-preview="1"/);
  // 公開
  assert.equal((await pages.publish(env, { page_id: d1.page_id, version: 9 })).error, "version_not_found");
  const pub = await pages.publish(env, { page_id: d1.page_id }, "naoki@example.com");
  assert.equal(pub.status, "published");
  assert.equal(pub.url, "https://lp.shia2n.jp/zukai-1111");
  assert.match((await pages.serve(env, "zukai-1111", null)).html, /data-preview="0"/);
  // 直す
  const fix = await pages.createRequest(env, { page_id: d1.page_id, comment: "ボタンの文を変える", base_version: 1 });
  assert.equal(fix.request.kind, "fix");
  assert.match(fix.prompt, /直すもと：版 1/);
  assert.equal((await pages.saveDraft(env, { request_id: fix.request.id, page_id: "33333333-3333-4333-8333-333333333333", html: HTML })).error, "page_not_found");
  const d2 = await pages.saveDraft(env, { request_id: fix.request.id, html: HTML, note: "ボタンの文" });
  assert.equal(d2.page_id, d1.page_id, "直す依頼はそのページの新しい版になる");
  assert.equal(d2.version, 2);
  assert.equal(d2.warnings.length, 0);
  // 公開中は版 1 のまま
  assert.match((await pages.serve(env, "zukai-1111", null)).html, /checkout:no-such/);
  await pages.publish(env, { page_id: d1.page_id, version: 2 });
  assert.match((await pages.serve(env, "zukai-1111", null)).html, /checkout:next-monthly/);
  // 1 枚の中身
  const g = await pages.getPage(env, { page_id: d1.page_id, include_html: false }, { forAdmin: true });
  assert.equal(g.versions.length, 2);
  assert.equal(g.html, null);
  assert.ok(g.previews[1].startsWith("https://lp.shia2n.jp/zukai-1111?preview="));
  assert.equal(g.requests.length, 2);
  // 止める
  await pages.publish(env, { page_id: d1.page_id, stop: true });
  assert.equal(await pages.serve(env, "zukai-1111", null), null);
});

async function published(s) {
  const req = (await s.pages.createRequest(s.env, { purpose: "seminar", title: "申込" })).request;
  const d = await s.pages.saveDraft(s.env, { request_id: req.id, slug: "zukai-1111", html: HTML });
  await s.pages.publish(s.env, { page_id: d.page_id });
  return d.page_id;
}

test("見た・押した：まだ登録していない人は数えるだけ。その人の印があれば出来事にも積む（見たのは 1 日 1 回）", async () => {
  const s = setup();
  const pageId = await published(s);
  const vid = "abcd1234efgh";
  assert.equal((await s.pages.hit(s.env, { page: pageId, kind: "view", vid: "x" })).error, "bad_vid");
  assert.equal((await s.pages.hit(s.env, { page: pageId, kind: "click", vid, button: "Bad Name" })).error, "bad_button");
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid, r: "x-固定ポスト" });
  assert.equal(s.t.b_page_hits.length, 1);
  assert.equal(s.t.b_page_hits[0].route, "x-固定ポスト");
  assert.equal((s.t.events || []).length, 0, "知らない人は出来事に積まない");
  const cid = "44444444-4444-4444-8444-444444444444";
  const u = await personToken(s.env, cid);
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid, u });
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid, u });
  await s.pages.hit(s.env, { page: pageId, kind: "click", vid, u, button: "cta-1" });
  await s.pages.hit(s.env, { page: pageId, kind: "click", vid, u: u.replace(/.$/, "x"), button: "cta-1" });
  const ev = s.t.events.filter((e) => e.customer_id === cid);
  assert.deepEqual(ev.map((e) => e.type), ["page_viewed", "page_clicked"]);
  assert.equal(ev[1].payload.button, "cta-1");
  assert.equal(ev[1].payload.slug, "zukai-1111");
  assert.equal(s.t.b_page_hits.length, 5, "押した記録は印が壊れていても数える");
  // 止めたページは数えない
  await s.pages.publish(s.env, { page_id: pageId, stop: true });
  assert.equal((await s.pages.hit(s.env, { page: pageId, kind: "view", vid })).error, "not_found");
});

test("ページの申込の枠から答える：経路とページが登録に残り、初めての人にだけその人の印を返す", async () => {
  const s = setup();
  const pageId = await published(s);
  const r1 = await s.pages.submitForm(s.env, "seminar-2611", { email: "new@example.com", name: "新", consent: true, answers: { x_account: "@new" }, page: pageId, r: "x-固定ポスト" });
  assert.equal(r1.ok, true);
  assert.equal(r1.is_new, true);
  const cid = s.t.customers[0].id;
  assert.equal(await readPersonToken(s.env, r1.u), cid);
  assert.equal(s.regs[0].route, "x-固定ポスト");
  assert.equal(s.regs[0].page_id, pageId);
  const fe = s.t.events.find((e) => e.type === "form_submitted");
  assert.equal(fe.payload.page_id, pageId);
  assert.equal(fe.payload.route, "x-固定ポスト");
  // 2 回目（もう台帳にいる人）は印を返さない（人のメールを入れて印を取るのを防ぐ）
  const r2 = await s.pages.submitForm(s.env, "seminar-2611", { email: "new@example.com", consent: true, answers: {}, page: pageId, r: "<bad>" });
  assert.equal(r2.ok, true);
  assert.equal(r2.u, undefined);
  assert.equal(s.regs[1].route, undefined, "読めない経路は捨てる");
});

test("経路の数：見た人・その経路で初めて登録した人・そのうち買った人", async () => {
  const s = setup();
  const pageId = await published(s);
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid: "aaaa1111bbbb", r: "x-固定ポスト" });
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid: "cccc2222dddd", r: "x-固定ポスト" });
  await s.pages.hit(s.env, { page: pageId, kind: "view", vid: "cccc2222dddd", r: "x-固定ポスト" });
  await s.pages.submitForm(s.env, "seminar-2611", { email: "a@example.com", consent: true, answers: {}, page: pageId, r: "x-固定ポスト" });
  await s.pages.submitForm(s.env, "seminar-2611", { email: "b@example.com", consent: true, answers: {}, page: pageId, r: "x-固定ポスト" });
  s.t.events.push({ id: 999, customer_id: s.t.customers[0].id, type: "purchase_completed", payload: { product_id: "next-monthly" }, occurred_at: new Date().toISOString() });
  const r = await s.pages.routeStats(s.env, { days: 30 });
  assert.deepEqual(r.routes, [{ route: "x-固定ポスト", viewers: 2, registered: 2, bought: 1 }]);
  const one = await s.pages.getPage(s.env, { page_id: pageId, include_html: false });
  assert.equal(one.stats.viewers, 2);
  assert.equal(one.stats.views, 3);
  assert.equal(one.stats.form_people, 2);
});

test("自動ラベル「経路:名前」は初めて登録したときの経路", () => {
  const person = { id: "p", source: "x", created_at: new Date().toISOString() };
  const ev = [
    { id: 1, type: "registered", payload: { route: "x-固定ポスト" }, occurred_at: "2026-10-01T00:00:00Z" },
    { id: 2, type: "register_again", payload: { route: "note" }, occurred_at: "2026-10-02T00:00:00Z" },
  ];
  const labels = autoLabels({ person, events: ev });
  assert.ok(labels.includes("経路:x-固定ポスト"));
  assert.ok(!labels.some((l) => l === "経路:note"));
  assert.ok(!autoLabels({ person, events: [{ id: 1, type: "registered", payload: {}, occurred_at: "2026-10-01T00:00:00Z" }] }).some((l) => l.startsWith("経路:")));
});

test("コネクタ：きっかけ「ページを見た」「ページのボタンを押した」をページとボタンで絞れる", async () => {
  assert.equal(TRIGGERS.page_viewed.type, "page_viewed");
  assert.equal(TRIGGERS.page_clicked.label, "ページのボタンを押した");
  const s = setup();
  const deliver = makeDeliver({ db: s.db, addEvent: async () => {}, logInbound: async () => {}, bin3: {}, sell: {}, mailcfg: {}, connect: {}, forms: {} });
  const q = deliver.triggerQuery({ trigger: "page_clicked", trigger_args: { page: "zukai-1111", button: "cta-1" }, active_since: "2026-10-09T00:00:00Z" }, "2026-10-10T00:00:00Z");
  assert.match(q, /type=eq\.page_clicked/);
  assert.match(q, /payload->>slug=eq\.zukai-1111/);
  assert.match(q, /payload->>button=eq\.cta-1/);
  const v = deliver.triggerQuery({ trigger: "page_viewed", trigger_args: { page: "zukai-1111", button: "cta-1" }, active_since: "2026-10-09T00:00:00Z" }, "2026-10-10T00:00:00Z");
  assert.ok(!v.includes("button"), "見たときはボタンで絞らない");
});

test("設計図：ページは出会うのレーンに出て、申込の枠 → フォーム・決済の枠 → 商品の線が引かれる。数は見た人", () => {
  const pages = [{ id: "pg1", slug: "zukai-1111", title: "申込", status: "published" }];
  const parts = buildParts({ pages, pageParts: { pg1: { forms: ["seminar-2611"], checkouts: ["next-monthly"], buttons: ["cta-1"] } }, forms: [{ id: "f1", slug: "seminar-2611", title: "図解セミナー", active: true }], products: [{ id: "next-monthly", name: "NEXT", active: true, grants: [] }] });
  const pg = parts.find((p) => p.key === "page:pg1");
  assert.equal(pg.lane, "meet");
  assert.equal(pg.state, "running");
  const edges = buildEdges(parts);
  assert.ok(edges.some((e) => e.from === "page:pg1" && e.to === "form:f1"));
  assert.ok(edges.some((e) => e.from === "page:pg1" && e.to === "product:next-monthly"));
  const hits = [{ page_id: "pg1", kind: "view", vid: "a" }, { page_id: "pg1", kind: "view", vid: "a" }, { page_id: "pg1", kind: "view", vid: "b" }, { page_id: "pg1", kind: "click", vid: "c" }];
  assert.equal(pageWeek(pages, hits)["page:pg1"], 2);
  const recent = [{ customer_id: "x", type: "form_submitted", payload: { page_id: "pg1", form_id: "f1" } }, { customer_id: "x", type: "form_submitted", payload: { page_id: "pg1", form_id: "f1" } }, { customer_id: "y", type: "form_submitted", payload: { form_id: "f1" } }];
  assert.equal(pageEdgeWeek(edges, recent)["page:pg1>form:f1"], 1);
});

test("依頼文の作りは 1 か所（buildPrompt）。番号が無い直しの版は（最新）と書く", () => {
  const p = buildPrompt({ id: 7, kind: "fix", title: "申込", comment: "c" }, { origin: "https://lp.shia2n.jp", pageSlug: "z" });
  assert.match(p, /依頼番号 7/);
  assert.match(p, /（最新）/);
  assert.match(p, /https:\/\/lp\.shia2n\.jp\/z/);
});

test("差し込みの仕掛けは JavaScript として読める", () => {
  assert.doesNotThrow(() => new Function(EMBED_JS));
});

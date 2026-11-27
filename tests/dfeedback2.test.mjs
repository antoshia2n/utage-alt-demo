// デザインフィードバック 便 2（2026-11-27 Naoki OK 10:31）：自分の画像を見立てる・直した画像と比べる
// 走らせ方：node --test tests/dfeedback2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { siteToken } from "../src/pages.js";
import { shapeLook, shapeCompare, lookPrompt, DF_DAILY } from "../src/dfeedback.js";
import { kotobaClient } from "../src/kotoba.js";
import { AI_MODEL } from "../src/chatai.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
const r2 = new Map();
let aiReply = null, aiCalls = [];
const env = {
  AI: { run: async (model, input) => { aiCalls.push({ model, input }); if (aiReply instanceof Error) throw aiReply; return { response: typeof aiReply === "string" ? aiReply : JSON.stringify(aiReply) }; } },
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
  IMAGES: { get: async (k) => (r2.has(k) ? { text: async () => r2.get(k) } : null), put: async (k, v) => { r2.set(k, v); } },
};
const lp = (path, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request("https://lp.shia2n.jp" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const A = "cccccccc-2222-4333-8444-555555555555";
s.table("b_customers").push({ id: A, email: "a@example.com", name: "Aさん" });
s.table("b_events"); s.table("b_settings"); s.table("b_pages"); s.table("b_inbound_log");
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const OWN = { scene: "zukai", good: "1枚にまとめようとしている", picks: [{ id: 6, where: "全体", reason: "行が多い" }, { id: 999, where: "x", reason: "無い番号" }, { id: 15, where: "上の帯", reason: "色が多い" }, { id: 6, where: "重なり", reason: "同じ番号" }], wish: "", changes: [{ title: "白地に差し色1色", why: "絞ると浮く", steps: ["背景を白に"], words: ["白地に差し色1色", "存在しない言葉"] }, { title: "", steps: ["題が無い"] }] };
const post = (path, body, headers = {}) => lp(path, { method: "POST", body, headers });
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];

test("形をそろえる：一覧に無い番号・重なる番号・一覧に無い言葉・題の無い案は捨てる", () => {
  const r = shapeLook("own", OWN);
  assert.deepEqual(r.picks.map((p) => p.id), [6, 15]);
  assert.equal(r.changes.length, 1); assert.deepEqual(r.changes[0].words, ["白地に差し色1色"]);
  assert.equal(shapeLook("own", { picks: [{ id: 999 }] }), null);
  const ref = shapeLook("ref", { scene: "post", good: ["a", "b", "c", "d"], borrow: ["x"], avoid: ["y"] });
  assert.equal(ref.good.length, 3); assert.equal(ref.kind, "ref");
  assert.equal(shapeCompare([{ key: "p6", label: "多い" }], { items: [{ key: "p6", ok: true, note: "減った" }, { key: "p9", ok: true }] }).items.length, 1);
});

test("頼み方：自分の作品は一覧から選ばせ、他人の作品は直す指示を出させない。人名・作品名を書かせない", () => {
  const own = lookPrompt({ kind: "own", scene: "thumb", wish: "スタイリッシュに" });
  assert.match(own, /場面：サムネ/); assert.match(own, /^40[|]/m); assert.match(own, /人名・作品名・ブランド名は書かない/);
  const ref = lookPrompt({ kind: "ref" });
  assert.match(ref, /直す指示は出さず/); assert.doesNotMatch(ref, /直す指示の一覧/);
});

test("登録していない人：見立ては 1 回だけ。2 回目と比べるは無料会員の案内", async () => {
  aiReply = OWN; aiCalls = [];
  let r = await post("/api/p/design-feedback/look", { image: IMG, kind: "own" });
  assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.guest, true); assert.deepEqual(j.result.picks.map((p) => p.id), [6, 15]);
  const ck = cookieOf(r); assert.equal(ck, "lab_df=1");
  assert.equal(aiCalls[0].model, AI_MODEL); assert.equal(aiCalls[0].input.messages[0].content[1].image_url.url, IMG);
  r = await post("/api/p/design-feedback/look", { image: IMG }, { cookie: ck });
  assert.equal(r.status, 401); assert.equal((await r.json()).error, "need_member");
  assert.equal(aiCalls.length, 1);
  assert.equal((await (await lp("/api/p/kotoba/me", { headers: { cookie: ck } })).json()).guest_used, true);
  r = await post("/api/p/design-feedback/compare", { before: IMG, after: IMG, picks: [6] });
  assert.equal(r.status, 401);
});

test("無料会員：見立てと比べるができ、出来事に残る（画像は残さない）。1 日の上限で止まる", async () => {
  const cookie = "lab_site=" + encodeURIComponent(await siteToken(env, A)) + "; lab_df=1";
  aiReply = OWN;
  let j = await (await post("/api/p/design-feedback/look", { image: IMG, scene: "zukai", wish: "読みやすく" }, { cookie })).json();
  assert.equal(j.ok, true); assert.equal(j.guest, false); assert.equal(j.left, DF_DAILY - 1);
  aiReply = { items: [{ key: "p6", ok: true, note: "行が減った" }, { key: "c0", ok: false, note: "まだ色が多い" }], summary: "すっきりした" };
  j = await (await post("/api/p/design-feedback/compare", { before: IMG, after: IMG, picks: [6], changes: [{ title: "白地に差し色1色", steps: ["背景を白に"] }] }, { cookie })).json();
  assert.equal(j.ok, true); assert.deepEqual(j.result.items.map((x) => [x.key, x.ok]), [["p6", true], ["c0", false]]);
  const evs = s.table("b_events").filter((e) => e.customer_id === A);
  assert.deepEqual(evs.map((e) => e.type), ["df_look", "df_compare"]);
  assert.doesNotMatch(JSON.stringify(evs), /base64/);
  for (let i = evs.length; i < DF_DAILY; i++) s.table("b_events").push({ id: 1000 + i, customer_id: A, type: "df_look", payload: {}, actor: "site", occurred_at: new Date().toISOString() });
  const r = await post("/api/p/design-feedback/look", { image: IMG }, { cookie });
  assert.equal(r.status, 429); assert.equal((await r.json()).error, "daily_limit");
});

test("守り：画像で無いもの・大きすぎるものは AI に回さない。AI の答えが読めなければ 502", async () => {
  aiCalls = [];
  assert.equal((await post("/api/p/design-feedback/look", { image: "https://example.com/a.png" })).status, 400);
  assert.equal((await post("/api/p/design-feedback/look", { image: "data:image/jpeg;base64," + "A".repeat(1_700_000) })).status, 400);
  assert.equal(aiCalls.length, 0);
  aiReply = "ごめんなさい、読めません";
  const r = await post("/api/p/design-feedback/look", { image: IMG });
  assert.equal(r.status, 502); assert.equal((await r.json()).error, "ai_unreadable");
});

test("画面：?ai=1 のときだけ見立ての欄を出す（Naoki が中身を確かめるまで）", async () => {
  assert.doesNotMatch(await (await lp("/design-feedback")).text(), /id="lk-go"/);
  const r = await lp("/design-feedback?ai=1");
  const page = await r.text();
  assert.match(page, /id="lk-go"/); assert.match(page, /見本の画像で試す/);
  assert.equal(r.headers.get("x-robots-tag"), "noindex");
  assert.doesNotThrow(() => new Function("(" + kotobaClient.toString() + ")"));
});

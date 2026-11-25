// 公式サイトの作り直し 便 5（2026-11-25 Naoki OK）：公式サイトのチャット（1 対 1・グループ・登録時の自動メッセージ・選ぶだけで送れる文）
// 走らせ方：node --test tests/site-chat5.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { siteToken, personToken } from "../src/pages.js";
import { normalizeHome, HOME_DEFAULT } from "../src/sitehome.js";
import { chatClient } from "../src/sitechat.js";

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
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
  IMAGES: { get: async (k) => (r2.has(k) ? { text: async () => r2.get(k) } : null), put: async (k, v) => { r2.set(k, v); } },
};
const lp = (path, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request("https://lp.shia2n.jp" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const A = "cccccccc-2222-4333-8444-555555555555", B = "dddddddd-2222-4333-8444-555555555555", G = "eeeeeeee-2222-4333-8444-555555555555";
s.table("b_customers").push({ id: A, email: "a@example.com", name: "Aさん" }, { id: B, email: "b@example.com", name: "Bさん" });
s.table("b_chat_groups").push({ id: G, name: "質問", sort: 0, closed_at: null, admin_read_upto: 0 });
s.table("b_chat_group_members").push({ group_id: G, customer_id: A, left_at: null, read_upto: 0 });
s.table("b_chat_group_messages"); s.table("b_events"); s.table("b_person_values"); s.table("b_fields");

test("チャットの設定：自動メッセージ・返信の目安・選ぶだけで送れる文（6 つまで・600 字まで）", () => {
  assert.equal(normalizeHome(HOME_DEFAULT).home.chat.chips.length, 4);
  assert.equal(normalizeHome({ chat: { welcome: "x".repeat(601) } }).error, "too_long");
  assert.equal(normalizeHome({ chat: { chips: ["1", "2", "3", "4", "5", "6", "7"] } }).error, "too_many");
  assert.deepEqual(normalizeHome({ chat: { welcome: "やあ", eta: "1日", chips: ["a", "a", "b"] } }).home.chat, { welcome: "やあ", eta: "1日", chips: ["a", "b"] });
});

test("見分け：ログインも登録の印も無い人には、登録とログインの案内を出す", async () => {
  const r = await lp("/api/p/chat");
  assert.equal(r.status, 401); assert.equal((await r.json()).error, "need_login");
  const page = await (await lp("/chat")).text();
  assert.match(page, /チャットは無料会員の方がご利用いただけます/); assert.match(page, /[/]login[?]next=%2Fchat/);
  assert.doesNotThrow(() => new Function("(" + chatClient.toString() + ")"));
});

test("1 対 1：はじめて開くと自動メッセージが 1 回だけ届き、送るまで選ぶだけで送れる文が出る。送ると Naoki の部屋に入る", async () => {
  const cookie = "lab_site=" + encodeURIComponent(await siteToken(env, A));
  let r = await (await lp("/api/p/chat", { headers: { cookie } })).json();
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 1); assert.equal(r.messages[0].from, "cyanin"); assert.equal(r.messages[0].auto, true);
  assert.equal(r.chips.length, 4); assert.equal(r.eta, "24時間以内");
  assert.deepEqual(r.groups.map((g) => g.name), ["質問"]);
  r = await (await lp("/api/p/chat", { headers: { cookie } })).json();
  assert.equal(r.messages.length, 1, "自動メッセージは 1 回だけ");
  const sent = await (await lp("/api/p/chat", { method: "POST", headers: { cookie }, body: { text: "書いても伸びない" } })).json();
  assert.equal(sent.ok, true);
  r = await (await lp("/api/p/chat", { headers: { cookie } })).json();
  assert.equal(r.messages.length, 2); assert.equal(r.messages[1].from, "student"); assert.deepEqual(r.chips, []);
  const ev = s.table("b_events").find((e) => e.id === sent.id);
  assert.equal(ev.type, "room_chat"); assert.equal(ev.payload.from, "student"); assert.equal(ev.payload.via, "site");
  assert.equal((await (await lp("/api/p/chat", { method: "POST", headers: { cookie }, body: { text: " " } })).json()).error, "empty");
  assert.equal((await (await lp("/api/p/chat/read", { method: "POST", headers: { cookie }, body: {} })).json()).ok, true);
});

test("登録したその端末の印（x-lab-u）でも使える。グループは入っていない人には見えない", async () => {
  const u = await personToken(env, B);
  const r = await (await lp("/api/p/chat", { headers: { "x-lab-u": u } })).json();
  assert.equal(r.ok, true); assert.deepEqual(r.groups, []);
  const g = await lp("/api/p/chat/groups/" + G, { headers: { "x-lab-u": u } });
  assert.equal(g.status, 404);
});

test("グループ：入っている人は読めて、ニックネームを決めてから送れる", async () => {
  const cookie = "lab_site=" + encodeURIComponent(await siteToken(env, A));
  const v = await (await lp("/api/p/chat/groups/" + G, { headers: { cookie } })).json();
  assert.equal(v.ok, true); assert.equal(v.group.name, "質問");
  assert.equal((await (await lp("/api/p/chat/groups/" + G, { method: "POST", headers: { cookie }, body: { text: "よろしく" } })).json()).error, "need_nickname");
  assert.equal((await (await lp("/api/p/chat/nickname", { method: "POST", headers: { cookie }, body: { nickname: "えー" } })).json()).ok, true);
  assert.equal((await (await lp("/api/p/chat/groups/" + G, { method: "POST", headers: { cookie }, body: { text: "よろしく" } })).json()).ok, true);
  const v2 = await (await lp("/api/p/chat/groups/" + G, { headers: { cookie } })).json();
  assert.equal(v2.messages.at(-1).text, "よろしく"); assert.equal(v2.messages.at(-1).mine, true);
});

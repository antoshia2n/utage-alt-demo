// 便 15b：部屋の 2 つの枠（やり取りの枠の 1 行の知らせ）の試験。Worker の入口（src/index.js）を、Supabase への fetch を手元の入れ物に向けて呼ぶ。
// 見ること：生徒の部屋と Lab OS の部屋に、その人の予約・申込・申し込み・フォームの回答が 1 行の知らせで出る／ほかの人の分は出ない／試しの申し込みには印
// 走らせ方：node --test tests/roomview.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { toNotice, NOTICE_TYPES } from "../src/roomview.js";

const s = fakeStore();
const TOKENS = { stu: "stu@example.com", other: "other@example.com", adm: "admin@example.com" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  if (u.pathname === "/auth/v1/user") {
    const tok = String((init.headers && (init.headers.authorization || init.headers.Authorization)) || "").replace(/^Bearer /, "");
    return TOKENS[tok] ? new Response(JSON.stringify({ email: TOKENS[tok] }), { status: 200 }) : new Response("{}", { status: 401 });
  }
  // 名前の側（payload->>lesson_id など）は fetch で % に変わるので戻す。値の側は入れ物が戻す
  const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
};
const call = (path, tok, init = {}) => worker.fetch(new Request("https://lab.shia2n.jp" + path, {
  ...init, headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...(init.headers || {}) },
  body: init.body ? JSON.stringify(init.body) : undefined,
}), env, { waitUntil() {} });

const STU = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
s.table("b_customers").push({ id: STU, email: TOKENS.stu, name: "生徒" }, { id: OTHER, email: TOKENS.other, name: "別の人" });
s.table("b_admins").push({ email: TOKENS.adm });
const ev = (customer_id, type, payload) => s.table("b_events").push({ id: s.table("b_events").length + 1000, customer_id, type, payload, actor: "site", occurred_at: new Date().toISOString() });
ev(STU, "consult_booked", { slot: "2026-10-12T11:00:00.000Z", type_id: "t1", type_title: "個別相談 30 分", minutes: 30, topic: "" });
ev(STU, "purchase_completed", { product_id: "p1", product_name: "言語化ラボ", amount: 1000, mode: "test" });
ev(STU, "form_submitted", { form_id: "f1", slug: "q", title: "事前アンケート" });
ev(STU, "email_opened", { broadcast_id: "b1" });
ev(OTHER, "seminar_registered", { seminar_id: "s1", title: "別の人のセミナー" });

test("生徒の部屋に、自分の予約・申し込み・フォームの回答だけが知らせで出る（メールを開いたなどは出ない）", async () => {
  const r = await call("/api/room", "stu");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.notices.map((n) => n.type), ["consult_booked", "purchase_completed", "form_submitted"]);
  assert.equal(j.notices[0].detail, "個別相談 30 分");
  assert.equal(j.notices[0].slot, "2026-10-12T11:00:00.000Z");
  assert.equal(j.notices[1].test, true, "試しの申し込みには印");
  assert.ok(j.notices.every((n) => n.kind === "notice"));
});

test("Lab OS の部屋にも同じ知らせが出る。ほかの人の分は混ざらない", async () => {
  let r = await call(`/api/admin/rooms/${STU}`, "adm");
  assert.equal(r.status, 200, await r.clone().text());
  let j = await r.json();
  assert.equal(j.notices.length, 3);
  r = await call(`/api/admin/rooms/${OTHER}`, "adm");
  j = await r.json();
  assert.deepEqual(j.notices.map((n) => n.detail), ["別の人のセミナー"]);
});

test("知らせの形（種類ごと）", () => {
  const at = "2026-10-10T00:00:00Z";
  assert.deepEqual(toNotice({ id: 1, type: "consult_canceled", payload: { slot: "x" }, occurred_at: at }), { id: 1, kind: "notice", type: "consult_canceled", at, title: "予約の取り消し", detail: "個別相談", slot: "x" });
  assert.equal(toNotice({ id: 2, type: "seminar_registered", payload: {}, occurred_at: at }).title, "セミナーの申込");
  assert.equal(toNotice({ id: 3, type: "purchase_completed", payload: { product_name: "A", mode: "live" }, occurred_at: at }).test, undefined);
  assert.equal(toNotice({ id: 4, type: "email_opened", payload: {}, occurred_at: at }), null);
  assert.ok(!NOTICE_TYPES.includes("subscription_started"), "申し込みと 2 重に出さない");
});

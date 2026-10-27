// マーケくん便 6：顧客管理に、しあらぼの生徒をしあらぼ管理の呼び名で出す（src/students.js と core.findPeople・getTimeline）
// 走らせ方：node --test tests/marke6.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { emailsIn, indexStudents, applyNames } from "../src/students.js";
import worker from "../src/index.js";

test("連絡先の自由な書き方からメールを小文字で取り出す", () => {
  assert.deepEqual(emailsIn("山田太郎\n〒100-0001\n東京都…\nTaro.Y@Example.com"), ["taro.y@example.com"]);
  assert.deepEqual(emailsIn("・a@x.jp・b@y.co.jp a@x.jp"), ["a@x.jp", "b@y.co.jp"]);
  assert.deepEqual(emailsIn(""), []);
  assert.deepEqual(emailsIn(null), []);
});

test("呼び名の索引：空の呼び名は飛ばし、同じメールは先の生徒が勝つ", () => {
  const idx = indexStudents([
    { name: "ヒロセ", contact: "hirose@example.com" },
    { name: "", contact: "x@example.com" },
    { name: "まや", contact: "住所だけ" },
    { name: "別の人", contact: "HIROSE@example.com" },
  ]);
  assert.equal(idx.byEmail.get("hirose@example.com"), "ヒロセ");
  assert.equal(idx.byEmail.has("x@example.com"), false);
  assert.deepEqual(idx.students.map((s) => s.name), ["ヒロセ", "まや", "別の人"]);
});

test("呼び名を先に出し、マーケくんの中の名前は profile_name に残す", () => {
  const people = [{ email: "Hirose@example.com", name: "廣瀬" }, { email: "other@example.com", name: "" }];
  applyNames(people, new Map([["hirose@example.com", "ヒロセ"]]));
  assert.deepEqual(people[0], { email: "Hirose@example.com", name: "ヒロセ", profile_name: "廣瀬", student_name: "ヒロセ" });
  assert.equal(people[1].name, "");
  assert.equal("student_name" in people[1], false);
});

// ---- Worker の入口から（AI の道具 find_person と、画面と同じ core.findPeople） ----
const s = fakeStore();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + u.search;
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, (init.headers && init.headers.prefer) || "");
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
};
const H = "11111111-1111-4111-8111-11111111111";
const people = [
  { id: H + "1", email: "hirose@example.com", name: "", last_event_at: null },
  { id: H + "2", email: "hiro@example.com", name: "", last_event_at: "2026-10-25T12:00:00Z" },
  { id: H + "3", email: "harry@example.com", name: "宮下", last_event_at: "2026-10-10T00:00:00Z" },
  { id: H + "4", email: "reader@example.com", name: "", last_event_at: "2026-10-26T00:00:00Z" },
];
for (const p of people) {
  s.table("b_customer_summary").push({ ...p, source: "other", note_member: false, event_count: 0, login_count: 0, lesson_view_count: 0, stage: "登録のみ" });
  s.table("b_customers").push({ id: p.id, email: p.email, name: p.name, source: "other" });
}
s.table("shr_students").push(
  { id: 36, name: "ヒロセ", contact: "廣瀬\n〒…\nHIROSE@example.com", archived: false, deleted: false },
  { id: 44, name: "ひろ", contact: "・田中\n・hiro@example.com", archived: false, deleted: false },
  { id: 17, name: "ハリー", contact: "宮下\nharry@example.com", archived: false, deleted: false },
  { id: 48, name: "まや", contact: "住所だけ", archived: false, deleted: false },
  { id: 50, name: "いない人", contact: "nobody@example.com", archived: false, deleted: false },
  { id: 51, name: "アーカイブ", contact: "arch@example.com", archived: true, deleted: false },
);

async function findPerson(args) {
  const r = await worker.fetch(new Request("https://lab.shia2n.jp/mcp", {
    method: "POST", headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_person", arguments: args } }),
  }), env, { waitUntil() {} });
  const j = await r.json();
  assert.ok(j.result, JSON.stringify(j));
  return JSON.parse(j.result.content[0].text);
}

test("一覧：生徒は呼び名で出て、生徒でない人はそのまま。結べなかった生徒の呼び名が返る（アーカイブは数えない）", async () => {
  const r = await findPerson({ limit: 50 });
  const byEmail = Object.fromEntries(r.people.map((p) => [p.email, p.name]));
  assert.equal(byEmail["hirose@example.com"], "ヒロセ");
  assert.equal(byEmail["hiro@example.com"], "ひろ");
  assert.equal(byEmail["harry@example.com"], "ハリー");
  assert.equal(byEmail["reader@example.com"], "");
  assert.deepEqual(r.students_unmatched, [
    { name: "まや", why: "連絡先にメールが無い" },
    { name: "いない人", why: "マーケくんに同じメールの人がいない" },
  ]);
  assert.equal(JSON.stringify(r).includes("〒"), false, "連絡先そのものは返さない");
});

test("探す：ヒロセ・ひろ・ハリーの呼び名で出る。マーケくんの中の名前（宮下）でも出る", async () => {
  const names = async (q) => (await findPerson({ query: q })).people.map((p) => p.name);
  assert.deepEqual(await names("ヒロセ"), ["ヒロセ"]);
  assert.deepEqual((await names("ひろ")).sort(), ["ひろ"]);
  assert.deepEqual(await names("ハリー"), ["ハリー"]);
  assert.deepEqual(await names("宮下"), ["ハリー"]);
  assert.deepEqual(await names("reader"), [""]);
  const hit = await findPerson({ query: "ヒロセ" });
  assert.equal("students_unmatched" in hit, false, "探しているときは添えない");
});

test("1 人の詳細の見出しも呼び名", async () => {
  const r = await worker.fetch(new Request("https://lab.shia2n.jp/mcp", {
    method: "POST", headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_timeline", arguments: { person_id: H + "1" } } }),
  }), env, { waitUntil() {} });
  const j = JSON.parse((await r.json()).result.content[0].text);
  assert.equal(j.person.name, "ヒロセ");
});

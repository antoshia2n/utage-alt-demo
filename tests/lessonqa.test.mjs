// 便 15：教材の質問とメモの試験。Worker の入口（src/index.js）を、Supabase への fetch を手元の入れ物に向けて呼ぶ。
// 見ること：見られる教材にだけ質問とメモを書ける／質問は部屋に入り教材の印が付く／答えは部屋と教材の下の両方に出る／メモは本人だけ
// 走らせ方：node --test tests/lessonqa.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { lessonThreads, openLessonQuestions } from "../src/lessonqa.js";

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
s.table("b_mn_access").push({ member_id: STU, curriculum_id: "college" });
s.table("b_mn_lessons").push(
  { curriculum_id: "college", lesson_id: "lsn-a", title: "言語化の土台" },
  { curriculum_id: "writing", lesson_id: "lsn-b", title: "書く型" },
);

test("見られない教材には質問もメモも書けない", async () => {
  let r = await call("/api/room", "stu", { method: "POST", body: { kind: "chat", lesson_id: "lsn-b", text: "質問" } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "lesson_not_found");
  r = await call("/api/lesson/memo", "stu", { method: "POST", body: { lesson_id: "lsn-b", text: "メモ" } });
  assert.equal(r.status, 400);
  r = await call("/api/lesson/notes?lesson_id=lsn-b", "stu");
  assert.equal(r.status, 404);
  r = await call("/api/lesson/notes?lesson_id=lsn-a", "other");
  assert.equal(r.status, 404, "受講の結びが無い人は見られない");
});

test("質問 → 部屋に教材の印つきで入る → シアニンが答える → 教材の下と部屋の両方に出る", async () => {
  let r = await call("/api/room", "stu", { method: "POST", body: { kind: "chat", lesson_id: "lsn-a", text: "2 章の例がわかりません" } });
  assert.equal(r.status, 200);
  const qid = (await r.json()).id;
  const q = s.table("b_events").find((e) => e.id === qid);
  assert.equal(q.type, "room_chat");
  assert.deepEqual(q.payload.lesson, { id: "lsn-a", title: "言語化の土台" });

  r = await call("/api/admin/rooms", "adm");
  const room = (await r.json()).rooms.find((x) => x.person_id === STU);
  assert.equal(room.lesson_open, 1);

  r = await call(`/api/admin/rooms/${STU}/message`, "adm", { method: "POST", body: { text: "例はこう読みます", reply_to: qid } });
  assert.equal(r.status, 200, await r.clone().text());
  const a = s.table("b_events").filter((e) => e.type === "room_chat" && e.payload.from === "cyanin").pop();
  assert.equal(a.payload.reply_to, qid);
  assert.equal(a.payload.lesson.id, "lsn-a");

  r = await call("/api/lesson/notes?lesson_id=lsn-a", "stu");
  const n = await r.json();
  assert.equal(n.questions.length, 1);
  assert.equal(n.questions[0].answers[0].text, "例はこう読みます");

  r = await call("/api/room", "stu");
  const msgs = (await r.json()).messages;
  assert.ok(msgs.some((m) => m.from === "cyanin" && m.reply_to === qid && m.lesson.title === "言語化の土台"));

  r = await call("/api/admin/rooms", "adm");
  assert.equal((await r.json()).rooms.find((x) => x.person_id === STU).lesson_open, 0, "答えたら印が消える");
});

test("答える先は、その人の教材の質問だけ（ふつうのメッセージや別の人の質問には付けられない）", async () => {
  let r = await call("/api/room", "stu", { method: "POST", body: { kind: "chat", text: "ふつうのメッセージ" } });
  const plain = (await r.json()).id;
  r = await call(`/api/admin/rooms/${STU}/message`, "adm", { method: "POST", body: { text: "x", reply_to: plain } });
  assert.equal((await r.json()).error, "bad_reply_to");
  const q = s.table("b_events").find((e) => e.type === "room_chat" && e.payload.lesson);
  r = await call(`/api/admin/rooms/${OTHER}/message`, "adm", { method: "POST", body: { text: "x", reply_to: q.id } });
  assert.equal((await r.json()).error, "bad_reply_to");
});

test("メモ：本人だけ。同じ文なら積まない。空にすると消える", async () => {
  let r = await call("/api/lesson/memo", "stu", { method: "POST", body: { lesson_id: "lsn-a", text: "2 章は例から読む" } });
  assert.equal((await r.json()).changed, true);
  r = await call("/api/lesson/memo", "stu", { method: "POST", body: { lesson_id: "lsn-a", text: "2 章は例から読む" } });
  assert.equal((await r.json()).changed, false);
  r = await call("/api/lesson/notes?lesson_id=lsn-a", "stu");
  assert.equal((await r.json()).memo.text, "2 章は例から読む");
  r = await call("/api/lesson/memo", "stu", { method: "POST", body: { lesson_id: "lsn-a", text: "" } });
  r = await call("/api/lesson/notes?lesson_id=lsn-a", "stu");
  assert.equal((await r.json()).memo, null);
  assert.ok(s.table("b_events").filter((e) => e.type === "lesson_memo").every((e) => e.customer_id === STU));
});

test("シアニン（b_admins）はどの教材にも質問を書ける（試しのため）", async () => {
  s.table("b_customers").push({ id: "33333333-3333-4333-8333-333333333333", email: TOKENS.adm, name: "シアニン" });
  const r = await call("/api/lesson/notes?lesson_id=lsn-b", "adm");
  assert.equal(r.status, 200);
});

test("質問と答えのまとめ方（部屋の出来事から）", () => {
  const evs = [
    { id: 1, type: "room_chat", payload: { from: "student", text: "q1", lesson: { id: "x", title: "X" } }, occurred_at: "t1" },
    { id: 2, type: "room_chat", payload: { from: "student", text: "q2", lesson: { id: "y", title: "Y" } }, occurred_at: "t2" },
    { id: 3, type: "room_chat", payload: { from: "cyanin", text: "a1", reply_to: 1, lesson: { id: "x", title: "X" } }, occurred_at: "t3" },
    { id: 4, type: "room_chat", payload: { from: "student", text: "ふつう" }, occurred_at: "t4" },
  ];
  assert.deepEqual(lessonThreads(evs, "x"), [{ id: 1, at: "t1", text: "q1", answers: [{ id: 3, at: "t3", text: "a1" }] }]);
  assert.deepEqual(openLessonQuestions(evs).map((e) => e.id), [2]);
});

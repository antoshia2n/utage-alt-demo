// チャットの便 C1：メモ（生徒に見えない）・後で・要返信・履歴の種類・カード・メモとして転送・タスクへ・言葉で探す
// 走らせ方：node --test tests/chat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeChat, categoryOf, laterOf, needsReply, nextBooking, cardOf, historyOf } from "../src/chat.js";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
function setup() {
  const s = fakeStore();
  s.table("customers").push({ id: A, name: "佐藤", email: "a@example.com" }, { id: B, name: "森", email: "b@example.com" });
  s.table("customer_summary").push({ id: A, name: "佐藤", email: "a@example.com" }, { id: B, name: "森", email: "b@example.com" });
  let n = 100;
  const addEvent = async (env, cid, type, payload, actor) => { const e = { id: ++n, customer_id: cid, type, payload, actor, occurred_at: new Date(Date.now() + n).toISOString() }; s.table("events").push(e); return e; };
  const rooms = [{ person_id: A, last_from: "student", unreplied: 0, lesson_open: 0 }, { person_id: B, last_from: "cyanin", unreplied: 0, lesson_open: 0 }];
  const core = {
    listRooms: async () => ({ ok: true, rooms }),
    getRoom: async (env, { person_id }) => ({ ok: true, found: true, person: { id: person_id, name: "", email: "" }, messages: [], notices: [], unreplied: [] }),
    getTimeline: async (env, { person_id }) => ({ person: { name: person_id === A ? "佐藤" : "森", email: "" }, stage: { label: "受講中" }, entitlements: [], purchases: [], events: s.table("events").filter((e) => e.customer_id === person_id) }),
    findPeople: async () => ({ people: [{ id: B, name: "森", email: "b@example.com", extra: 1 }] }),
  };
  const logs = [];
  const chat = makeChat({ db: s.db, addEvent, core, logInbound: async (...a) => logs.push(a) });
  return { s, chat, addEvent, logs };
}

test("履歴の種類：部屋の出来事・読んだ印・通知の購読・チャットの印は出さない。知らないものは「そのほか」", () => {
  assert.equal(categoryOf("purchase_completed"), "購入");
  assert.equal(categoryOf("subscription_payment"), "購入");
  assert.equal(categoryOf("consult_booked"), "予約");
  assert.equal(categoryOf("lesson_viewed"), "学習");
  assert.equal(categoryOf("email_opened"), "メール");
  assert.equal(categoryOf("correction_submitted"), "添削");
  assert.equal(categoryOf("room_chat"), null);
  assert.equal(categoryOf("room_read"), null);
  assert.equal(categoryOf("push_subscribed"), null);
  assert.equal(categoryOf("chat_note"), null);
  assert.equal(categoryOf("something_new"), "そのほか");
  assert.deepEqual(historyOf([{ id: 1, type: "room_chat" }, { id: 2, type: "login", occurred_at: "x" }]).map((x) => x.cat), ["登録とログイン"]);
});

test("後で：いちばん新しい印の日時が先なら後で。取り消しや過ぎた日時なら後でではない。後での間は要返信から外す", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  const ev = [{ id: 1, type: "chat_later", payload: { until: "2026-11-08T00:00:00Z" } }];
  assert.equal(laterOf(ev, now), "2026-11-08T00:00:00Z");
  assert.equal(laterOf([...ev, { id: 2, type: "chat_later", payload: { until: null } }], now), null);
  assert.equal(laterOf([{ id: 1, type: "chat_later", payload: { until: "2026-11-06T00:00:00Z" } }], now), null);
  assert.equal(needsReply({ last_from: "student" }, null), true);
  assert.equal(needsReply({ last_from: "cyanin", unreplied: 1 }, null), true);
  assert.equal(needsReply({ last_from: "cyanin", lesson_open: 1 }, null), true);
  assert.equal(needsReply({ last_from: "cyanin" }, null), false);
  assert.equal(needsReply({ last_from: "student" }, "2026-11-08T00:00:00Z"), false);
});

test("カード：次の予約は先の枠で取り消していないものの最も近いもの。権利は期限切れを除く。購入は試しを除く", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  const ev = [
    { type: "consult_booked", payload: { slot: "2026-11-12T11:00:00Z", type_title: "個別相談" } },
    { type: "consult_booked", payload: { slot: "2026-11-10T11:00:00Z" } },
    { type: "consult_canceled", payload: { slot: "2026-11-10T11:00:00Z" } },
    { type: "consult_booked", payload: { slot: "2026-11-01T11:00:00Z" } },
    { type: "consult_done", payload: {}, occurred_at: "2026-10-29T10:00:00Z" },
  ];
  assert.deepEqual(nextBooking(ev, now), { slot: "2026-11-12T11:00:00Z", title: "個別相談" });
  const c = cardOf({ person: { name: "佐藤", email: "a@x" }, stage: { label: "受講中" }, events: ev,
    entitlements: [{ key: "shiarabo_basic" }, { key: "guest", expires_at: "2026-11-01T00:00:00Z" }],
    purchases: [{ name: "試し", mode: "test", at: "1" }, { name: "NEXT", at: "2" }] }, now);
  assert.deepEqual(c.entitlements, [{ key: "shiarabo_basic", expires_at: null }]);
  assert.deepEqual(c.last_purchase, { name: "NEXT", at: "2" });
  assert.equal(c.last_meeting, "2026-10-29T10:00:00Z");
  assert.equal(c.stage, "受講中");
});

test("一覧：要返信と後でを数える。後でにした人は要返信から外れる", async () => {
  const { chat, addEvent } = setup();
  let r = await chat.list({});
  assert.equal(r.need_count, 1); assert.equal(r.later_count, 0);
  await addEvent({}, A, "chat_later", { until: new Date(Date.now() + 3600e3).toISOString() }, "admin");
  r = await chat.list({});
  assert.equal(r.need_count, 0); assert.equal(r.later_count, 1);
  assert.ok(r.chats.find((x) => x.person_id === A).later_until);
});

test("メモ：生徒の部屋の種類ではない chat_note に積み、1 人分を読むと notes に出る。空・長すぎは断る", async () => {
  const { chat, s } = setup();
  assert.equal((await chat.addNote({}, { person_id: A, text: "  " }, "admin")).error, "empty");
  assert.equal((await chat.addNote({}, { person_id: A, text: "x".repeat(8001) }, "admin")).error, "too_long");
  const r = await chat.addNote({}, { person_id: A, text: "面談で目標を 2 つに絞る" }, "admin");
  assert.equal(r.ok, true);
  assert.equal(s.table("events").find((e) => e.id === r.id).type, "chat_note");
  const g = await chat.get({}, { person_id: A });
  assert.deepEqual(g.notes.map((x) => x.text), ["面談で目標を 2 つに絞る"]);
  assert.equal(g.card.name, "佐藤");
});

test("後で：先の日時だけ・90 日まで。空で外す", async () => {
  const { chat } = setup();
  assert.equal((await chat.setLater({}, { person_id: A, until: "2020-01-01T00:00:00Z" }, "admin")).error, "bad_until");
  assert.equal((await chat.setLater({}, { person_id: A, until: new Date(Date.now() + 100 * 864e5).toISOString() }, "admin")).error, "bad_until");
  const u = new Date(Date.now() + 864e5).toISOString();
  assert.equal((await chat.setLater({}, { person_id: A, until: u }, "admin")).later_until, u);
  assert.equal((await chat.get({}, { person_id: A })).later_until, u);
  assert.equal((await chat.setLater({}, { person_id: A, until: "" }, "admin")).later_until, null);
  assert.equal((await chat.get({}, { person_id: A })).later_until, null);
});

test("メモとして転送：元のメッセージの文を、転送先のメモに写す（転送先の生徒の部屋には何も積まない）", async () => {
  const { chat, addEvent, s } = setup();
  const m = await addEvent({}, A, "room_chat", { from: "student", text: "目標は多すぎますか？" }, "site");
  const r = await chat.forward({}, { person_id: A, event_id: m.id, to_person_id: B }, "admin");
  assert.equal(r.ok, true);
  const note = s.table("events").find((e) => e.id === r.id);
  assert.equal(note.customer_id, B); assert.equal(note.type, "chat_note");
  assert.equal(note.payload.text, "目標は多すぎますか？");
  assert.deepEqual(note.payload.forwarded_from, { person_id: A, name: "佐藤", event_id: m.id });
  assert.equal(s.table("events").filter((e) => e.customer_id === B && e.type === "room_chat").length, 0);
  assert.equal((await chat.forward({}, { person_id: A, event_id: m.id, to_person_id: A }, "admin")).error, "same_chat");
  assert.equal((await chat.forward({}, { person_id: B, event_id: m.id, to_person_id: A }, "admin")).error, "message_not_found");
});

test("タスクへ：TaskMaster の口が無ければ断る。あれば元のメッセージへ戻る住所を付けて足し、印を積む。失敗は記録に残す", async () => {
  const { chat, s, logs } = setup();
  assert.equal((await chat.addTask({}, { person_id: A, title: "返す" }, "admin")).error, "no_taskmaster");
  const calls = [];
  const env = { TASKS: { add: async (a) => { calls.push(a); return { ok: true, id: "t1", title: a.title, url: "https://taskmaster.shia2n.jp/?task=t1" }; } } };
  const r = await chat.addTask(env, { person_id: A, event_id: 105, title: "佐藤さんに返す", deadline: "2026-11-08" }, "admin", "https://lab.shia2n.jp");
  assert.equal(r.ok, true); assert.equal(r.task_id, "t1");
  assert.deepEqual(calls[0], { title: "佐藤さんに返す", deadline: "2026-11-08", link_url: `https://lab.shia2n.jp/admin#chat/${A}/105`, link_title: "マーケくんのチャット" });
  const mark = s.table("events").find((e) => e.type === "chat_task");
  assert.deepEqual(mark.payload, { event_id: 105, task_id: "t1", title: "佐藤さんに返す", url: "https://taskmaster.shia2n.jp/?task=t1" });
  assert.deepEqual((await chat.get({}, { person_id: A })).tasks.map((x) => x.event_id), [105]);
  const bad = await chat.addTask({ TASKS: { add: async () => ({ ok: false, error: "bad_deadline" }) } }, { person_id: A, title: "x" }, "admin");
  assert.equal(bad.error, "bad_deadline"); assert.equal(logs.length, 1);
});

test("言葉で探す：やり取りとメモから。1 人に絞れる", async () => {
  const { chat, addEvent } = setup();
  await addEvent({}, A, "room_chat", { from: "student", text: "今月の目標は 300 人" }, "site");
  await addEvent({}, B, "chat_note", { text: "目標の型を見せる" }, "admin");
  await addEvent({}, B, "room_chat", { from: "cyanin", text: "関係ない" }, "admin");
  const all = await chat.search({}, { q: "目標" });
  assert.equal(all.count, 2);
  assert.deepEqual(all.hits.map((h) => h.kind).sort(), ["メッセージ", "メモ"]);
  assert.equal((await chat.search({}, { q: "目標", person_id: B })).hits[0].from, "シアニン（メモ）");
  assert.equal((await chat.search({}, { q: "" })).error, "need_q");
});

test("⌘K の人探し：名前とメールと番号だけを返す", async () => {
  const { chat } = setup();
  assert.deepEqual((await chat.people({}, { q: "森" })).people, [{ id: B, name: "森", email: "b@example.com" }]);
  assert.deepEqual((await chat.people({}, { q: "" })).people, []);
});

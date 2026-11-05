// 2026-11-05：個別相談の予約を、生徒にも生徒以外にも使える形にした試験（相手・質問・予約のあとに書く先）。booking.test.mjs の setup を写した。
// 元：便 13b の試験。表は tests/fake-store.mjs の真似で、決まりは supabase/b13b_booking.sql と b_events の actor の決まりを写した。
// 走らせ方：node --test tests/booking.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeBooking, parseTimes, candidates, freeSlots, render, cleanQuestions, cleanAnswers, canBook, answersText, endLabel } from "../src/booking.js";
import { jstDate } from "../src/index.js";
import { parseParts } from "../src/pages.js";
import { buildParts, buildEdges, partKeyOf, LANES } from "../src/plan.js";

const ACTORS = ["site", "admin", "mcp", "webhook", "seed"];
const env = { B_STORE: true };
const JST = 9 * 3600e3;
// 日本時間の「YYYY-MM-DD HH:MM」→ UTC の時刻
const jst = (s) => Date.parse(s.replace(" ", "T") + ":00Z") - JST;

function setup({ busy = [], calState = "ok" } = {}) {
  const st = fakeStore();
  const mails = [], after = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    assert.ok(ACTORS.includes(actor), "actor の決まりに外れる：" + actor);
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation");
    return row;
  };
  let seq = 0;
  const registerPerson = async (e, b) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ""))) return { ok: false, error: "bad_email" };
    if (b.consent !== true) return { ok: false, error: "need_consent" };
    let p = st.table("customers").find((x) => x.email === b.email);
    const isNew = !p;
    if (!p) { p = { id: `0000000${++seq}-0000-4000-8000-000000000000`.slice(-36), email: b.email, name: b.name || "" }; st.table("customers").push(p); }
    return { ok: true, id: p.id, is_new: isNew };
  };
  const bin3 = { async sendMail(e, person, m) { mails.push({ to: person.email, ...m }); return { result: "sent" }; } };
  const bk = makeBooking({ db: st.db, addEvent, logInbound: async () => {}, bin3, registerPerson, busyBetween: async () => ({ state: calState, busy }), pagesOrigin: () => "https://lp.shia2n.jp", afterBooked: async (e, id, acts, ev) => { after.push({ id, acts, ev }); return { ok: true }; } });
  return { st, bk, mails, after };
}
const type = (o = {}) => ({ id: "t1", slug: "consult-30", title: "個別相談", minutes: 30, weekdays: [1, 2, 3, 4, 5], times: "10:00-11:00,20:00-21:00", days_ahead: 7, min_notice_hours: 12, ...o });


const Q = [
  { label: "X アカウント名", kind: "text", required: true },
  { label: "先月の売上", kind: "textarea", required: true, hint: "【売上】 ¥" },
  { label: "相談したいこと", kind: "textarea" },
];
const member = (o = {}) => ({ title: "しあらぼの個別相談", slug: "shiarabo-consult", weekdays: [0, 1, 2, 3, 4, 5, 6], times: "10:00-22:00", min_notice_hours: 0,
  audience: "member", entitlements: ["shiarabo_basic", "shiarabo_monitor"], questions: Q, after_actions: ["shr_next_mtg"], ...o });
const stu = { id: "11111111-1111-4111-8111-111111111111", name: "生徒", email: "s@example.com" };
const basic = { grants: ["shiarabo_basic"] };

test("質問：12 問まで・問いの文は必須・key は並び順で振る・欄の種類は 2 つ", () => {
  const r = cleanQuestions(Q);
  assert.deepEqual(r.questions.map((q) => q.key), ["q1", "q2", "q3"]);
  assert.equal(r.questions[2].kind, "textarea");
  assert.equal(cleanQuestions([{ label: "" }]).error, "bad_question_label");
  assert.equal(cleanQuestions(Array.from({ length: 13 }, (_, i) => ({ label: "q" + i }))).error, "bad_questions");
  assert.deepEqual(cleanQuestions(null).questions, []);
});

test("答え：必須が空なら止まり、問いの文ごと残す", () => {
  const qs = cleanQuestions(Q).questions;
  assert.equal(cleanAnswers(qs, { q1: "  " }).error, "answer_required");
  assert.equal(cleanAnswers(qs, { q1: "@a" }).key, "q2");
  const ok = cleanAnswers(qs, { q1: "@a", q2: "10 万" });
  assert.deepEqual(ok.answers.map((a) => [a.label, a.value]), [["X アカウント名", "@a"], ["先月の売上", "10 万"], ["相談したいこと", ""]]);
  assert.equal(answersText(ok.answers), "■ X アカウント名\n@a\n\n■ 先月の売上\n10 万");
});

test("会員の予約：権利のどれかを持つ人と管理者だけ。だれでもの種類・止めた種類は会員の窓口に出ない", () => {
  const t = { audience: "member", active: true, entitlements: ["shiarabo_basic"] };
  assert.equal(canBook(t, basic, false), true);
  assert.equal(canBook(t, { grants: ["guest"] }, false), false);
  assert.equal(canBook(t, { grants: [] }, true), true);
  assert.equal(canBook({ ...t, audience: "public" }, basic, true), false);
  assert.equal(canBook({ ...t, active: false }, basic, false), false);
  assert.equal(canBook({ ...t, active: false }, basic, true), true); // 管理者は止めている種類も見られる（受け付ける前の確かめ）
  assert.equal(canBook({ ...t, archived_at: "2026-11-05" }, basic, true), false);
});

test("会員だけの種類は、公開の窓口（ページ）では予約できない・埋め込みの印も出さない", async () => {
  const { bk } = setup();
  const r = await bk.set(env, member(), "mcp");
  assert.equal(r.ok, true);
  assert.equal(r.type.embed, "");
  assert.equal((await bk.publicSlots(env, "shiarabo-consult")).error, "not_found");
  assert.equal((await bk.book(env, "shiarabo-consult", { email: "a@example.com", consent: true, slot: new Date().toISOString() })).error, "not_found");
});

test("種類の設定：相手・権利・質問・書く先の決まりに外れた値は弾く", async () => {
  const { bk } = setup();
  assert.equal((await bk.set(env, member({ audience: "all" }))).error, "bad_audience");
  assert.equal((await bk.set(env, member({ entitlements: ["Bad Key"] }))).error, "bad_entitlements");
  assert.equal((await bk.set(env, member({ questions: [{ label: "" }] }))).error, "bad_question_label");
  assert.equal((await bk.set(env, member({ after_actions: ["notion"] }))).error, "bad_after_actions");
});

test("会員が予約する：空きを選び、必須の答えを書き、受付のメールに答えが入る。書く先が呼ばれ、取り消すと空にする", async () => {
  const { st, bk, mails, after } = setup();
  const { type: t } = await bk.set(env, member({ confirm_body: "{{name}} さん\n{{date}}\n{{answers}}" }), "mcp");
  const v = await bk.forMember(env, stu, basic, false);
  assert.equal(v.ready, true);
  assert.equal(v.types[0].questions.length, 3);
  const slot = v.types[0].slots[0].slot;
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot, answers: { q1: "@a" } })).error, "answer_required");
  assert.equal((await bk.memberBook(env, stu, { grants: ["guest"] }, false, { slug: "shiarabo-consult", slot, answers: { q1: "@a", q2: "1" } })).error, "not_found");
  const r = await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot, answers: { q1: "@a", q2: "10 万" } });
  assert.equal(r.ok, true);
  assert.match(mails[0].text, /■ 先月の売上\n10 万/);
  const ev = st.table("events").find((e) => e.type === "consult_booked");
  assert.equal(ev.payload.answers.length, 3);
  assert.equal(ev.payload.type_id, t.id);
  assert.deepEqual(after[0], { id: stu.id, acts: ["shr_next_mtg"], ev: { booked: slot } });
  const v2 = await bk.forMember(env, stu, basic, false);
  assert.equal(v2.mine.length, 1);
  assert.equal(v2.types[0].booked, true);
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot: v.types[0].slots[3].slot, answers: { q1: "@a", q2: "1" } })).error, "already_booked");
  // ほかの人は同じ枠を取れない（どの種類でも重なりは避ける）
  const other = { ...stu, id: "22222222-2222-4222-8222-222222222222" };
  assert.equal((await bk.memberBook(env, other, basic, false, { slug: "shiarabo-consult", slot, answers: { q1: "@b", q2: "1" } })).error, "slot_taken");
  assert.equal((await bk.memberCancel(env, other, { slot })).error, "not_found");
  assert.equal((await bk.memberCancel(env, stu, { slot })).ok, true);
  assert.deepEqual(after[1].ev, { canceled: slot });
  assert.equal((await bk.forMember(env, stu, basic, false)).mine.length, 0);
});

test("予約できる種類が無い人は ready が false（左のメニューに出ない）", async () => {
  const { bk } = setup();
  await bk.set(env, member(), "mcp");
  assert.equal((await bk.forMember(env, stu, { grants: ["note_membership"] }, false)).ready, false);
});

test("公開の種類にも質問を持たせられる。答えは出来事に残る", async () => {
  const { st, bk } = setup();
  await bk.set(env, { title: "モニター相談", slug: "monitor", weekdays: [0, 1, 2, 3, 4, 5, 6], times: "10:00-22:00", min_notice_hours: 0, questions: [{ label: "いまの悩み", required: true }] }, "mcp");
  const s = await bk.publicSlots(env, "monitor");
  assert.equal(s.questions[0].label, "いまの悩み");
  assert.equal((await bk.book(env, "monitor", { email: "m@example.com", consent: true, slot: s.slots[0].slot })).error, "answer_required");
  assert.equal((await bk.book(env, "monitor", { email: "m@example.com", consent: true, slot: s.slots[0].slot, answers: { q1: "集客" } })).ok, true);
  assert.equal(st.table("events").find((e) => e.type === "consult_booked").payload.answers[0].value, "集客");
});

test("次の面談の日付は日本時間", () => {
  assert.equal(jstDate("2026-11-10T15:30:00.000Z"), "2026-11-11");
  assert.equal(jstDate("2026-11-10T14:59:00.000Z"), "2026-11-10");
});

test("個別に許可したユーザーは、会員プランが無くても予約できる", () => {
  const t = { audience: "member", active: true, entitlements: ["shiarabo_basic"], allowed_members: [stu.id] };
  assert.equal(canBook(t, { grants: [] }, false, stu.id), true);
  assert.equal(canBook(t, { grants: [] }, false, "22222222-2222-4222-8222-222222222222"), false);
});

test("終わりの時刻は日本時間（所要時間ぶん先）", () => {
  assert.equal(endLabel("2026-11-12T11:00:00.000Z", 30), "20:30");
  assert.equal(endLabel("2026-11-12T14:30:00.000Z", 120), "01:30");
});

test("説明・色・個別ユーザーの値の決まり", async () => {
  const { bk } = setup();
  assert.equal((await bk.set(env, member({ color: "red" }))).error, "bad_color");
  assert.equal((await bk.set(env, member({ description: "x".repeat(1001) }))).error, "bad_description");
  assert.equal((await bk.set(env, member({ allowed_members: ["x"] }))).error, "bad_allowed_members");
  const r = await bk.set(env, member({ color: "#5E5CE6", description: "月 1 回の面談", allowed_members: [stu.id] }), "mcp");
  assert.equal(r.type.color, "#5e5ce6");
  assert.equal(r.type.description, "月 1 回の面談");
});

test("日時を変更：いまの予約を新しい時刻に入れ替え、終わりの時刻を返す。書く先は新しい日で呼ばれる", async () => {
  const { st, bk, after } = setup();
  await bk.set(env, member(), "mcp");
  const v = await bk.forMember(env, stu, basic, false);
  const a = v.types[0].slots[0].slot, b2 = v.types[0].slots[5].slot;
  assert.equal(v.types[0].slots[0].end.length, 5);
  await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot: a, answers: { q1: "@a", q2: "1" } });
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot: b2, answers: { q1: "@a", q2: "1" }, from: "2030-01-01T00:00:00.000Z" })).error, "not_found");
  const r = await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot: b2, answers: { q1: "@a", q2: "1" }, from: a });
  assert.equal(r.ok, true); assert.equal(r.moved, true);
  const mine = (await bk.forMember(env, stu, basic, false)).mine;
  assert.deepEqual(mine.map((x) => x.slot), [b2]);
  assert.equal(mine[0].slug, "shiarabo-consult");
  assert.deepEqual(after.at(-1).ev, { booked: b2 });
  assert.ok(st.table("events").some((e) => e.type === "consult_canceled" && e.payload.moved_to === b2));
});

test("キャンセルは「元に戻す」用に中身を返す", async () => {
  const { bk } = setup();
  await bk.set(env, member(), "mcp");
  const v = await bk.forMember(env, stu, basic, false), slot = v.types[0].slots[0].slot;
  await bk.memberBook(env, stu, basic, false, { slug: "shiarabo-consult", slot, answers: { q1: "@a", q2: "10 万" } });
  const c = await bk.memberCancel(env, stu, { slot });
  assert.deepEqual([c.slug, c.slot, c.answers.q2], ["shiarabo-consult", slot, "10 万"]);
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: c.slug, slot: c.slot, answers: c.answers })).ok, true);
});

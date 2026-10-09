// 便 13b：個別相談の予約の試験。表は tests/fake-store.mjs の真似で、決まりは supabase/b13b_booking.sql と b_events の actor の決まりを写した。
// 走らせ方：node --test tests/booking.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeBooking, parseTimes, candidates, freeSlots, render } from "../src/booking.js";
import { parseParts } from "../src/pages.js";
import { buildParts, buildEdges, partKeyOf, LANES } from "../src/plan.js";

const ACTORS = ["site", "admin", "mcp", "webhook", "seed"];
const env = { B_STORE: true };
const JST = 9 * 3600e3;
// 日本時間の「YYYY-MM-DD HH:MM」→ UTC の時刻
const jst = (s) => Date.parse(s.replace(" ", "T") + ":00Z") - JST;

function setup({ busy = [], calState = "ok" } = {}) {
  const st = fakeStore();
  const mails = [];
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
  const bk = makeBooking({ db: st.db, addEvent, logInbound: async () => {}, bin3, registerPerson, busyBetween: async () => ({ state: calState, busy }), pagesOrigin: () => "https://lp.shia2n.jp" });
  return { st, bk, mails };
}
const type = (o = {}) => ({ id: "t1", slug: "consult-30", title: "個別相談", minutes: 30, weekdays: [1, 2, 3, 4, 5], times: "10:00-11:00,20:00-21:00", days_ahead: 7, min_notice_hours: 12, ...o });

test("時間帯は「10:00-12:00,20:00-22:00」の形だけ読む", () => {
  assert.deepEqual(parseTimes("10:00-12:00,20:00-22:00"), [[600, 720], [1200, 1320]]);
  assert.equal(parseTimes("12:00-10:00"), null);
  assert.equal(parseTimes("10時から"), null);
  assert.equal(parseTimes(""), null);
});

test("候補は受け付ける曜日と時間帯を長さで刻み、何時間前より近いものは出さない（日本時間）", () => {
  const now = jst("2026-10-12 09:00"); // 月曜
  const c = candidates(type(), now).map((s) => new Date(s + JST).toISOString().slice(0, 16));
  assert.ok(!c.includes("2026-10-12T10:00"), "12 時間前より近い"); // 月曜 10:00 は 1 時間後なので出ない
  assert.ok(!c.includes("2026-10-12T20:30"), "12 時間前より近い（21:00 より前）");
  assert.ok(!c.includes("2026-10-13T21:00"), "21:00-21:30 は時間帯の外");
  assert.ok(c.includes("2026-10-13T20:30"));
  assert.ok(c.includes("2026-10-13T10:00") && c.includes("2026-10-13T10:30"));
  assert.ok(!c.some((x) => x.startsWith("2026-10-17") || x.startsWith("2026-10-18")), "土日は出さない");
});

test("空き時間：ほかの予約と Naoki の予定に重なる枠を外す", () => {
  const now = jst("2026-10-12 09:00");
  const booked = [{ start: jst("2026-10-13 10:00"), end: jst("2026-10-13 10:30") }];
  const busy = [{ start: jst("2026-10-13 20:15"), end: jst("2026-10-13 21:00") }];
  const f = freeSlots(type(), { booked, busy }, now).map((s) => new Date(Date.parse(s) + JST).toISOString().slice(0, 16));
  assert.ok(!f.includes("2026-10-13T10:00"));
  assert.ok(f.includes("2026-10-13T10:30"));
  assert.ok(!f.includes("2026-10-13T20:00") && !f.includes("2026-10-13T20:30"));
});

test("作ると受付と前日の知らせの文が入る。決まりに外れた値は弾く", async () => {
  const { st, bk } = setup();
  assert.equal((await bk.set(env, { title: "x", slug: "Bad Slug" })).error, "bad_slug");
  assert.equal((await bk.set(env, { title: "x", slug: "c1", times: "夜" })).error, "bad_times");
  assert.equal((await bk.set(env, { title: "x", slug: "c1", weekdays: [9] })).error, "bad_weekdays");
  const r = await bk.set(env, { title: "個別相談", slug: "consult-30", zoom_url: "https://zoom.us/j/1" }, "mcp");
  assert.equal(r.ok, true);
  assert.equal(r.type.embed, '<div data-lab-part="booking:consult-30"></div>');
  const row = st.table("b_booking_types")[0];
  assert.match(row.confirm_subject, /受け付けました/);
  assert.equal(row.remind_minutes, 1440);
  assert.equal((await bk.set(env, { title: "y", slug: "consult-30" })).error, "slug_taken");
});

test("予約する：空き時間だけ取れて、受付のメールが届き、同じ枠は 2 人が取れない", async () => {
  const { st, bk, mails } = setup();
  const { type: t } = await bk.set(env, { title: "個別相談", slug: "consult-30", weekdays: [0, 1, 2, 3, 4, 5, 6], times: "10:00-22:00", min_notice_hours: 0, zoom_url: "https://zoom.us/j/1" }, "mcp");
  const s = await bk.publicSlots(env, "consult-30");
  assert.ok(s.ok && s.slots.length > 0);
  const slot = s.slots[0].slot;
  const r = await bk.book(env, "consult-30", { email: "a@example.com", name: "A", consent: true, slot, topic: "X の伸ばし方" });
  assert.equal(r.ok, true);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].kind, "booking_notice"); // 手続きのメール
  assert.match(mails[0].text, /X の伸ばし方/);
  assert.match(mails[0].text, /zoom\.us/);
  const ev = st.table("events").find((e) => e.type === "consult_booked");
  assert.equal(ev.payload.type_id, t.id);
  assert.equal((await bk.book(env, "consult-30", { email: "b@example.com", consent: true, slot })).error, "slot_taken");
  const again = await bk.book(env, "consult-30", { email: "a@example.com", consent: true, slot: s.slots[3].slot });
  assert.equal(again.error, "already_booked");
  assert.equal((await bk.book(env, "consult-30", { email: "c@example.com", consent: false, slot: s.slots[5].slot })).error, "need_consent");
  assert.equal((await bk.get(env, { type_id: t.id })).bookings.length, 1);
});

test("止めた種類は窓口に出ない", async () => {
  const { bk } = setup();
  const { type: t } = await bk.set(env, { title: "個別相談", slug: "consult-30", active: false }, "mcp");
  assert.equal((await bk.publicSlots(env, "consult-30")).error, "not_found");
  assert.equal((await bk.book(env, "consult-30", { email: "a@example.com", consent: true, slot: new Date().toISOString() })).error, "not_found");
  assert.ok(t.id);
});

test("前日の知らせは送る時刻から 3 時間のうちに 1 回だけ。送る時刻より後に予約した人には送らない", async () => {
  const { st, bk, mails } = setup();
  const { type: t } = await bk.set(env, { title: "個別相談", slug: "consult-30" }, "mcp");
  const slot = new Date(jst("2026-10-20 10:00")).toISOString();
  st.table("customers").push({ id: "11111111-1111-4111-8111-111111111111", email: "a@example.com", name: "A" }, { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com", name: "B" });
  st.table("events").push(
    { id: 1, customer_id: "11111111-1111-4111-8111-111111111111", type: "consult_booked", payload: { slot, type_id: t.id, minutes: 30 }, actor: "site", occurred_at: new Date(jst("2026-10-15 10:00")).toISOString() },
    { id: 2, customer_id: "22222222-2222-4222-8222-222222222222", type: "consult_booked", payload: { slot: new Date(jst("2026-10-20 11:00")).toISOString(), type_id: t.id, minutes: 30 }, actor: "site", occurred_at: new Date(jst("2026-10-19 12:00")).toISOString() });
  assert.equal((await bk.run(env, jst("2026-10-19 08:00"))).sent, 0);
  const r = await bk.run(env, jst("2026-10-19 10:07"));
  assert.equal(r.sent, 1);
  assert.equal(mails[0].to, "a@example.com");
  assert.match(mails[0].subject, /明日です/);
  assert.equal((await bk.run(env, jst("2026-10-19 11:07"))).sent, 0); // 2 回目は送らない・B は送る時刻より後に予約した
  assert.ok(st.table("events").filter((e) => e.type === "consult_reminded").every((e) => ACTORS.includes(e.actor)));
});

test("差し込み", () => {
  const out = render("{{name}}｜{{title}}｜{{date}}｜{{zoom}}｜{{topic}}", { title: "個別相談", minutes: 30, zoom_url: "" }, { slot: "2026-10-20T01:00:00Z", topic: "" }, { name: "なおき" });
  assert.equal(out, "なおき｜個別相談｜2026/10/20（火）10:00｜（追ってお知らせします）｜（未記入）");
});

test("ページの印 booking:slug を拾う。注意書きの中は拾わない", () => {
  const p = parseParts('<!-- <div data-lab-part="booking:nai"></div> --><div data-lab-part="booking:consult-30"></div>');
  assert.deepEqual(p.bookings, ["consult-30"]);
  assert.deepEqual(p.bad, []);
});

test("設計図：予約の種類ごとに箱ができ、ページ → 予約 → サンクスの線。予約の数は種類の箱に当たる", () => {
  const parts = buildParts({
    bookingTypes: [{ id: "t1", slug: "consult-30", title: "個別相談", active: true, thanks_page_slug: "ty" }],
    pages: [{ id: "p1", title: "案内", slug: "lp1", status: "published", purpose: "seminar", url: "x" }, { id: "p2", title: "ありがとう", slug: "ty", status: "published", purpose: "thanks", url: "y" }],
    pageParts: { p1: { forms: [], checkouts: [], buttons: [], bookings: ["consult-30"] } },
  });
  assert.ok(parts.some((p) => p.key === "booking:t1" && p.lane === "consult"));
  assert.ok(!parts.some((p) => p.key === "booking:consult"), "本番の置き場では架空の箱を出さない");
  const edges = buildEdges(parts).map((e) => `${e.from}>${e.to}:${e.label}`);
  assert.ok(edges.includes("page:p1>booking:t1:予約"));
  assert.ok(edges.includes("booking:t1>page:p2:サンクス"));
  assert.equal(partKeyOf({ type: "consult_booked", payload: { slot: "x", type_id: "t1" } }), "booking:t1");
  assert.equal(partKeyOf({ type: "consult_booked", payload: { slot: "x" } }), "booking:consult");
  assert.ok(buildParts({}).some((p) => p.key === "booking:consult"), "デモの置き場は今までどおり");
});

test("段の名前（Naoki 確定 2026-10-10）", () => {
  assert.deepEqual(LANES.map((l) => l.label), ["集客", "リストイン", "アプローチ", "個別相談", "オファー", "受講", "紹介"]);
});

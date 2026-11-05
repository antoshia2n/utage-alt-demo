// 2026-11-05 予約の便②：受付時間（曜日ごと・特定日）・予約ルール（バッファ・上限・間隔・期限）・複数の所要時間
// 走らせ方：node --test tests/booking-rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeBooking, candidates, freeSlots, weekHours, cleanRanges, cleanOverrides, lengthsOf, tooLate } from "../src/booking.js";

const JST = 9 * 3600e3;
const jst = (s) => Date.parse(s.replace(" ", "T") + ":00Z") - JST;
const iso = (s) => new Date(jst(s)).toISOString();
// 2026-11-09 は月曜
const NOW = jst("2026-11-08 09:00");
const base = (o = {}) => ({ id: "t1", minutes: 30, days_ahead: 7, min_notice_hours: 0, weekdays: [1], times: "10:00-11:00", ...o });

test("week_hours が無ければ今までの weekdays＋times から作る", () => {
  const w = weekHours(base());
  assert.deepEqual(w[1], [[600, 660]]); assert.deepEqual(w[2], []);
});

test("曜日ごとの受付時間：曜日で時間が違う", () => {
  const t = base({ week_hours: { 1: [[600, 660]], 2: [[1200, 1260]] } });
  const c = candidates(t, NOW).map((s) => new Date(s).toISOString());
  assert.ok(c.includes(iso("2026-11-09 10:00")) && c.includes(iso("2026-11-10 20:30")));
  assert.ok(!c.includes(iso("2026-11-10 10:00")));
});

test("特定日：休業日は出さない。その日だけの時間はそちらを使う", () => {
  const t = base({ week_hours: { 1: [[600, 660]], 3: [[600, 660]] }, date_overrides: { "2026-11-09": [], "2026-11-12": [[900, 960]] } });
  const c = candidates(t, NOW).map((s) => new Date(s).toISOString());
  assert.ok(!c.some((s) => s.startsWith("2026-11-09")));
  assert.ok(c.includes(iso("2026-11-11 10:00")));
  assert.ok(c.includes(iso("2026-11-12 15:00")));
});

test("開始時刻の間隔：60 分の相談を 30 分ごとに出す", () => {
  const t = base({ minutes: 60, slot_step: 30, times: "10:00-12:00" });
  const c = candidates(t, NOW).filter((s) => s < jst("2026-11-10 00:00")).map((s) => new Date(s).toISOString());
  assert.deepEqual(c, [iso("2026-11-09 10:00"), iso("2026-11-09 10:30"), iso("2026-11-09 11:00")]);
});

test("前後のバッファ：予約の前後に空ける", () => {
  const t = base({ times: "10:00-12:00", buffer_before: 0, buffer_after: 30 });
  const booked = [{ start: jst("2026-11-09 10:00"), end: jst("2026-11-09 10:30"), type_id: "x" }];
  const f = freeSlots(t, { booked }, NOW);
  assert.ok(!f.includes(iso("2026-11-09 10:30")));
  assert.ok(f.includes(iso("2026-11-09 11:00")));
});

test("1 日の上限件数：同じメニューで上限に達した日は出さない（ほかのメニューは数えない）", () => {
  const t = base({ times: "10:00-12:00", max_per_day: 1 });
  const f1 = freeSlots(t, { booked: [{ start: jst("2026-11-09 11:30"), end: jst("2026-11-09 12:00"), type_id: "other" }] }, NOW);
  assert.ok(f1.includes(iso("2026-11-09 10:00")));
  const f2 = freeSlots(t, { booked: [{ start: jst("2026-11-09 11:30"), end: jst("2026-11-09 12:00"), type_id: "t1" }] }, NOW);
  assert.ok(!f2.some((s) => s.startsWith("2026-11-09")));
});

test("受付時間の検査：5 分刻み・重ならない・8 つまで", () => {
  assert.deepEqual(cleanRanges([[720, 780], [600, 660]]), [[600, 660], [720, 780]]);
  assert.equal(cleanRanges([[600, 700], [690, 720]]), null);
  assert.equal(cleanRanges([[601, 660]]), null);
  assert.equal(cleanRanges([[660, 600]]), null);
  assert.equal(cleanOverrides({ "2026-13-40": [] }), null);
  assert.deepEqual(cleanOverrides({ "2026-11-20": [] }), { "2026-11-20": [] });
});

test("所要時間の一覧と、変更・キャンセルの期限", () => {
  assert.deepEqual(lengthsOf({ minutes: 30, durations: [] }), [30]);
  assert.deepEqual(lengthsOf({ minutes: 30, durations: [30, 60] }), [30, 60]);
  assert.equal(tooLate({ cancel_hours: 24 }, iso("2026-11-09 10:00"), NOW), false);
  assert.equal(tooLate({ cancel_hours: 24 }, iso("2026-11-09 08:00"), NOW), true);
  assert.equal(tooLate({ cancel_hours: null }, iso("2026-11-08 09:10"), NOW), false);
});

// ---- 保存と会員の予約 ----
function setup() {
  const st = fakeStore();
  const addEvent = async (e, cid, type, payload, actor = "site") => { const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"); return row; };
  const bin3 = { async sendMail() { return { result: "sent" }; } };
  const bk = makeBooking({ db: st.db, addEvent, logInbound: async () => {}, bin3, registerPerson: async () => ({ ok: false }), busyBetween: async () => ({ state: "ok", busy: [] }), pagesOrigin: () => "", afterBooked: async () => ({ ok: true }) });
  return { st, bk };
}
const env = { B_STORE: true };
const stu = { id: "11111111-1111-4111-8111-111111111111", name: "生徒", email: "s@example.com" };
const basic = { grants: ["shiarabo_basic"] };
const all = { 0: [[0, 1440]], 1: [[0, 1440]], 2: [[0, 1440]], 3: [[0, 1440]], 4: [[0, 1440]], 5: [[0, 1440]], 6: [[0, 1440]] };
const member = (o = {}) => ({ title: "相談", slug: "consult", audience: "member", entitlements: ["shiarabo_basic"], min_notice_hours: 0, week_hours: all, ...o });

test("保存：week_hours を入れると weekdays と times も合わせる。決まりに外れた値は弾く", async () => {
  const { bk } = setup();
  const r = await bk.set(env, member({ week_hours: { 2: [[600, 720]], 4: [[1200, 1260]] } }), "mcp");
  assert.equal(r.ok, true);
  assert.deepEqual(r.type.weekdays, [2, 4]); assert.equal(r.type.times, "10:00-12:00");
  assert.equal((await bk.set(env, { id: r.type.id, week_hours: {} })).error, "bad_week_hours");
  assert.equal((await bk.set(env, { id: r.type.id, durations: [30, 7] })).error, "bad_durations");
  assert.equal((await bk.set(env, { id: r.type.id, buffer_after: 500 })).error, "bad_buffer_after");
  assert.equal((await bk.set(env, { id: r.type.id, max_per_person: 0 })).error, "bad_max_per_person");
  const d = await bk.set(env, { id: r.type.id, durations: [60, 30] });
  assert.equal(d.type.minutes, 60); assert.deepEqual(d.type.durations, [60, 30]);
});

test("複数の所要時間：選んだ長さで予約し、空きも長さごとに出す", async () => {
  const { bk } = setup();
  await bk.set(env, member({ durations: [30, 60], days_ahead: 3 }), "mcp");
  const v = await bk.forMember(env, stu, basic, false);
  const ty = v.types[0];
  assert.deepEqual(ty.options.map((o) => o.minutes), [30, 60]);
  const slot = ty.options[1].slots[2].slot;
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "consult", slot, minutes: 45 })).error, "bad_minutes");
  const r = await bk.memberBook(env, stu, basic, false, { slug: "consult", slot, minutes: 60 });
  assert.equal(r.ok, true); assert.equal(r.minutes, 60);
  assert.equal((await bk.forMember(env, stu, basic, false)).mine[0].minutes, 60);
});

test("1 人あたりの予約上限：2 件までなら 2 件目も取れて 3 件目は弾く", async () => {
  const { bk } = setup();
  await bk.set(env, member({ max_per_person: 2, days_ahead: 3 }), "mcp");
  const s = (await bk.forMember(env, stu, basic, false)).types[0].slots;
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[2].slot })).ok, true);
  assert.equal((await bk.forMember(env, stu, basic, false)).types[0].booked, false);
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[6].slot })).ok, true);
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[10].slot })).error, "already_booked");
});

test("変更・キャンセルの期限を過ぎた予約は、本人が変更もキャンセルもできない", async () => {
  const { bk } = setup();
  await bk.set(env, member({ cancel_hours: 168, days_ahead: 3 }), "mcp");
  const s = (await bk.forMember(env, stu, basic, false)).types[0].slots;
  await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[3].slot });
  const v = await bk.forMember(env, stu, basic, false);
  assert.equal(v.mine[0].locked, true);
  assert.equal((await bk.memberCancel(env, stu, { slot: s[3].slot })).error, "too_late");
  assert.equal((await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[8].slot, from: s[3].slot })).error, "too_late");
});

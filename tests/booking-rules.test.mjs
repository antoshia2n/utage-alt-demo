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

// ---- 便③：予約フォームの回答形式 ----
import { cleanQuestions, cleanAnswers } from "../src/booking.js";
test("回答形式：単一選択・複数選択は選択肢が 2 つ以上要る。数値は数だけ", () => {
  assert.equal(cleanQuestions([{ label: "形式", kind: "radio", options: ["A"] }]).error, "bad_question_options");
  const { questions: qs } = cleanQuestions([{ label: "形式", kind: "radio", options: ["Zoom", "対面", "Zoom"], required: true }, { label: "テーマ", kind: "check", options: ["X", "note", "LP"] }, { label: "売上", kind: "number", hint: "ignored?" }]);
  assert.deepEqual(qs[0].options, ["Zoom", "対面"]); assert.equal(qs[0].hint, "");
  assert.equal(cleanAnswers(qs, { q1: "電話" }).error, "bad_answer");
  assert.equal(cleanAnswers(qs, { q1: "" }).error, "answer_required");
  assert.equal(cleanAnswers(qs, { q1: "Zoom", q2: ["X", "その他"] }).error, "bad_answer");
  assert.equal(cleanAnswers(qs, { q1: "Zoom", q3: "十万" }).error, "bad_number");
  const r = cleanAnswers(qs, { q1: "対面", q2: ["X", "LP"], q3: "１２０,０００" });
  assert.deepEqual(r.answers.map((a) => a.value), ["対面", "X、LP", "120000"]);
  assert.deepEqual(r.answers[1].values, ["X", "LP"]);
});

// ---- 便④：リマインドのシナリオとテンプレート ----
import { cleanReminders, remindAt } from "../src/booking.js";
const TID = "22222222-2222-4222-8222-222222222222";
test("通知の並びの決まり：タイミング・分・テンプレート", () => {
  assert.equal(cleanReminders([{ when: "soon", template_id: TID }]).error, "bad_reminders");
  assert.equal(cleanReminders([{ when: "before", minutes: 5, template_id: TID }]).error, "bad_reminders");
  assert.equal(cleanReminders([{ when: "booked", template_id: "x" }]).error, "bad_reminders");
  const r = cleanReminders([{ key: "a", when: "before", minutes: 60, template_id: TID }, { key: "a", when: "canceled", template_id: TID, on: false }]).reminders;
  assert.deepEqual(r.map((x) => [x.key, x.minutes, x.on]), [["a", 60, true], ["s2", 0, false]]);
  const b = { slot: iso("2026-11-09 20:00"), minutes: 30 };
  assert.equal(remindAt({ when: "before", minutes: 60 }, b), jst("2026-11-09 19:00"));
  assert.equal(remindAt({ when: "after", minutes: 60 }, b), jst("2026-11-09 21:30"));
});

function setup4() {
  const st = fakeStore(), mails = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => { const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"); return row; };
  const bin3 = { async sendMail(e, person, m) { mails.push({ to: person.email, ...m }); return { result: "sent" }; } };
  const bk = makeBooking({ db: st.db, addEvent, logInbound: async () => {}, bin3, registerPerson: async () => ({ ok: false }), busyBetween: async () => ({ state: "ok", busy: [] }), pagesOrigin: () => "", afterBooked: async () => ({ ok: true }) });
  st.table("customers").push({ id: stu.id, name: "生徒", email: "s@example.com" }, { id: "33333333-3333-4333-8333-333333333333", name: "管理", email: "admin@example.com" });
  // 試験の表は番号を数で振るので、テンプレートは UUID の行を直に入れる
  let n = 0;
  const T = (name, subject, body = "{{name}} さん {{booking_url}}") => { const id = `4444444${++n}-4444-4444-8444-444444444444`.slice(-36); st.table("b_booking_templates").push({ id, name, subject, body, created_at: new Date(n * 1000).toISOString(), archived_at: null }); return id; };
  return { st, bk, mails, T };
}

test("テンプレート：作る・直す。使っているメニューがあると消せない", async () => {
  const { bk, T } = setup4();
  assert.equal((await bk.setTemplate(env, { name: "", subject: "a", body: "b" })).error, "bad_template_name");
  assert.equal((await bk.setTemplate(env, { name: "x", subject: "a", body: "b" })).ok, true);
  const t1 = { id: T("受付", "【受付】{{title}}") };
  assert.equal((await bk.setTemplate(env, { id: t1.id, name: "受付（標準）" })).template.name, "受付（標準）");
  await bk.set(env, member({ reminders: [{ when: "booked", template_id: t1.id }] }), "mcp");
  const l = await bk.listTemplates(env);
  assert.deepEqual(l.templates.find((x) => x.id === t1.id).used, ["相談"]);
  assert.equal((await bk.setTemplate(env, { id: t1.id, archived: true })).error, "template_in_use");
  assert.equal((await bk.set(env, { ...member({ slug: "other" }), reminders: [{ when: "booked", template_id: TID }] })).error, "template_not_found");
});

test("通知：予約した直後・キャンセルされたとき・開始の前・終わったあと（1 回だけ）", async () => {
  const { bk, mails, T } = setup4();
  const [a, b, c, d] = [T("受付", "受付 {{title}}"), T("前", "1 時間前"), T("後", "お礼"), T("取消", "キャンセル")];
  await bk.set(env, member({ days_ahead: 3, reminders: [{ when: "booked", template_id: a }, { when: "before", minutes: 60, template_id: b }, { when: "after", minutes: 60, template_id: c }, { when: "canceled", template_id: d }, { when: "before", minutes: 1440, template_id: b, on: false }] }), "mcp");
  const slot = (await bk.forMember(env, stu, basic, false)).types[0].slots[30].slot;
  await bk.memberBook(env, stu, basic, false, { slug: "consult", slot });
  assert.deepEqual(mails.map((m) => m.subject), ["受付 相談"]);
  assert.ok(mails[0].text.includes("https://lab.shia2n.jp/app#booking"));
  const s0 = Date.parse(slot);
  await bk.run(env, s0 - 50 * 60e3); await bk.run(env, s0 - 40 * 60e3);
  await bk.run(env, s0 + 100 * 60e3);
  assert.deepEqual(mails.map((m) => m.subject), ["受付 相談", "1 時間前", "お礼"]);
  await bk.memberCancel(env, stu, { slot });
  assert.equal(mails.at(-1).subject, "キャンセル"); assert.equal(mails.length, 4);
});

test("テスト送信：見本で差し込み、管理者に【テスト】で送る", async () => {
  const { bk, mails } = setup4();
  assert.equal((await bk.testTemplate(env, { subject: "x", body: "y" }, "nobody@example.com")).error, "no_admin_person");
  const r = await bk.testTemplate(env, { subject: "{{title}}", body: "{{name}} さん {{sign}}" }, "admin@example.com");
  assert.equal(r.ok, true);
  assert.equal(mails[0].subject, "【テスト】個別相談"); assert.ok(mails[0].text.startsWith("管理 さん"));
});

// ---- 便⑤＋担当者：担当者ごとに Google カレンダーをつなぐ（Apps Script のウェブアプリ） ----
import { makeGcal, scriptCode } from "../src/gcal.js";
function setupStaff() {
  const st = fakeStore(), calls = [], secrets = {};
  const busyOf = {};
  const fetchImpl = async (url, o) => { const j = JSON.parse(o.body); calls.push({ url, ...j }); if (secrets[url] !== j.secret) return new Response(JSON.stringify({ ok: false, error: "bad_secret" }));
    if (j.action === "create") return new Response(JSON.stringify({ ok: true, id: "ev" + calls.length + "@google.com" }));
    if (j.action === "busy") return new Response(JSON.stringify(busyOf[url] ? { ok: true, busy: busyOf[url] } : { ok: false, error: "bad_action" }));
    return new Response(JSON.stringify({ ok: true, calendar: url.slice(-10) })); };
  const gcal = makeGcal({ db: st.db, logInbound: async () => {}, fetchImpl });
  const addEvent = async (e, cid, type, payload, actor = "site") => { const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"); return row; };
  const icalBusy = [];
  const bk = makeBooking({ gcal, db: st.db, addEvent, logInbound: async () => {}, bin3: { async sendMail() { return { result: "sent" }; } }, registerPerson: async () => ({ ok: false }), busyBetween: async () => ({ state: "ok", busy: icalBusy }), pagesOrigin: () => "", afterBooked: async () => ({ ok: true }) });
  // 試験の表は番号を数で振るので、担当者は UUID の行を直に入れる
  let n = 0;
  const staff = async (name, url, o = {}) => { const id = `5555555${++n}-5555-4555-8555-555555555555`.slice(-36); st.table("b_staff").push({ id, name, email: "", script_url: "", script_secret: "", ical_fallback: false, created_at: new Date(n * 1000).toISOString(), archived_at: null, ...o });
    const secret = (await gcal.makeCode(env, id, "admin")).code.match(/const SECRET = "([0-9a-f]+)"/)[1]; secrets[url] = secret; return id; };
  return { st, calls, gcal, bk, staff, busyOf, icalBusy };
}
const URLA = "https://script.google.com/macros/s/AKfycbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaa/exec", URLB = "https://script.google.com/macros/s/AKfycbx_bbbbbbbbbbbbbbbbbbbbbbbbbbbb/exec";

test("担当者：つなぐ・予約で担当者のカレンダーに予定を作る・日時の変更とキャンセルで消す", async () => {
  const { calls, gcal, bk, staff } = setupStaff();
  assert.ok(scriptCode("x").includes("CalendarApp.getDefaultCalendar()") && scriptCode("x").includes('req.action === "busy"'));
  const a = await staff("シアニン", URLA);
  assert.equal((await gcal.connect(env, a, "https://example.com/x", "admin")).error, "bad_url");
  assert.equal((await gcal.connect(env, a, URLA, "admin")).ok, true);
  assert.equal((await gcal.list(env)).staff[0].set, true);
  await bk.set(env, member({ days_ahead: 3, zoom_url: "https://zoom.us/j/1", staff_id: a }), "mcp");
  const s = (await bk.forMember(env, stu, basic, false)).types[0].slots;
  await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[5].slot });
  const ci = calls.findIndex((x) => x.action === "create"), cr = calls[ci];
  assert.equal(cr.url, URLA); assert.deepEqual(cr.guests, ["s@example.com"]); assert.equal(cr.location, "https://zoom.us/j/1");
  await bk.memberBook(env, stu, basic, false, { slug: "consult", slot: s[9].slot, from: s[5].slot });
  assert.equal(calls.at(-1).action, "delete"); assert.equal(calls.at(-1).id, `ev${ci + 1}@google.com`);
  await bk.memberCancel(env, stu, { slot: s[9].slot });
  assert.equal(calls.at(-1).action, "delete");
  assert.equal((await gcal.set(env, { id: a, archived: true })).error, "staff_in_use");
  assert.equal((await bk.set(env, member({ slug: "x2", staff_id: "66666666-6666-4666-8666-666666666666" }), "mcp")).error, "staff_not_found");
});

test("担当者：空き時間はその人の予定とその人の予約だけ避ける。読めないときは Naoki だけ iCal", async () => {
  const { gcal, bk, staff, busyOf, icalBusy, st } = setupStaff();
  const a = await staff("A", URLA), b = await staff("B", URLB, { ical_fallback: true });
  await gcal.connect(env, a, URLA, "admin"); await gcal.connect(env, b, URLB, "admin");
  await bk.set(env, member({ slug: "ma", days_ahead: 3, staff_id: a }), "mcp");
  await bk.set(env, member({ slug: "mb", days_ahead: 3, staff_id: b }), "mcp");
  const first = (slug) => bk.forMember(env, stu, basic, false).then((v) => v.types.find((x) => x.slug === slug).slots);
  const s0 = (await first("ma"))[3].slot, t0 = Date.parse(s0);
  busyOf[URLA] = [{ start: t0, end: t0 + 30 * 60e3 }];
  st.table("b_staff").forEach(() => {}); // キャッシュは 30 秒。違う範囲で読む
  const sa = await bk.forMember(env, stu, basic, false, Date.now() + 1000);
  const listA = sa.types.find((x) => x.slug === "ma").slots.map((x) => x.slot), listB = sa.types.find((x) => x.slug === "mb").slots.map((x) => x.slot);
  assert.ok(!listA.includes(s0)); assert.ok(listB.includes(s0));
  // B は busy が読めない（古いコード）→ iCal で読む
  icalBusy.push({ start: t0, end: t0 + 30 * 60e3 });
  const sb = await bk.forMember(env, stu, basic, false, Date.now() + 2000);
  assert.ok(!sb.types.find((x) => x.slug === "mb").slots.map((x) => x.slot).includes(s0));
  // A の予約は B の空きをふさがない
  const other = { ...stu, id: "77777777-7777-4777-8777-777777777777", email: "o@example.com" };
  const s1 = listA[10];
  await bk.memberBook(env, other, basic, false, { slug: "ma", slot: s1 });
  const after = await bk.forMember(env, stu, basic, false, Date.now() + 3000);
  assert.ok(!after.types.find((x) => x.slug === "ma").slots.map((x) => x.slot).includes(s1));
  assert.ok(after.types.find((x) => x.slug === "mb").slots.map((x) => x.slot).includes(s1));
});

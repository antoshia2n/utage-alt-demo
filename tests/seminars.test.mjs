// 便 13：セミナーの回と知らせの試験。表は tests/fake-store.mjs の PostgREST の真似で、
// 決まりは supabase/b13_seminars.sql（key の形・offset の範囲・1 つのフォームは 1 つの回）と b_events の actor の決まりを写した。
// 走らせ方：node --test tests/seminars.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSeminars, parseStart, render, whenLabel, dueFor, DEFAULT_NOTICES, fmtJst } from "../src/seminars.js";
import { makeForms } from "../src/forms.js";
import { autoLabels } from "../src/connect.js";
import { parseParts } from "../src/pages.js";
import { buildParts, buildEdges } from "../src/plan.js";

const ACTORS = ["site", "admin", "mcp", "webhook", "seed"];
const env = { B_STORE: true, PAGES_ORIGIN: "https://lp.shia2n.jp" };

function setup() {
  const st = fakeStore();
  const mails = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    assert.ok(ACTORS.includes(actor), "b_events の actor の決まりに外れる：" + actor);
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation");
    return row;
  };
  const bin3 = { async sendMail(e, person, m) { mails.push({ to: person.email, ...m }); await addEvent(e, person.id, "email_sent", { kind: m.kind, ...m.extra }, m.actor || "site"); return { result: "sent" }; } };
  const sem = makeSeminars({ db: st.db, addEvent, logInbound: async () => {}, bin3, pagesOrigin: () => "https://lp.shia2n.jp" });
  const person = (id, email, name) => st.table("customers").push({ id, email, name });
  return { st, sem, mails, addEvent, person };
}
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";

test("日時は時差なしなら日本時間として読む", () => {
  assert.equal(parseStart("2026-11-01 21:00"), "2026-11-01T12:00:00.000Z");
  assert.equal(parseStart("2026-11-01T21:00"), "2026-11-01T12:00:00.000Z");
  assert.equal(parseStart("2026-11-01T12:00:00Z"), "2026-11-01T12:00:00.000Z");
  assert.equal(parseStart("あした"), null);
  assert.equal(fmtJst("2026-11-01T12:00:00Z"), "2026/11/1（日）21:00");
});

test("いつ送るかの言葉と差し込み", () => {
  assert.equal(whenLabel(null), "申込の直後");
  assert.equal(whenLabel(1440), "開催の 1 日前");
  assert.equal(whenLabel(60), "開催の 1 時間前");
  assert.equal(whenLabel(-120), "開催の 2 時間あと");
  const s = { title: "図解セミナー", starts_at: "2026-11-01T12:00:00Z", minutes: 60, zoom_url: "", archive_url: "" };
  assert.equal(render("{{name}}さん {{title}} {{date}} {{zoom}} {{x}}", s, { name: "なおき" }), "なおきさん 図解セミナー 2026/11/1（日）21:00 （追ってお知らせします） {{x}}");
});

test("回を作ると知らせ 3 本が入り、フォームは 1 つの回にしか結べない", async () => {
  const { st, sem } = setup();
  st.table("b_forms").push({ id: "f1", slug: "zukai-seminar-2611", title: "申込" });
  const r = await sem.set(env, { title: "図解セミナー", starts_at: "2026-11-01 21:00", form_slug: "zukai-seminar-2611" }, "mcp");
  assert.equal(r.ok, true);
  assert.equal(st.table("b_seminar_notices").length, DEFAULT_NOTICES.length);
  assert.deepEqual(st.table("b_seminar_notices").map((n) => n.offset_minutes), [null, 1440, 60]);
  const dup = await sem.set(env, { title: "別の回", starts_at: "2026-11-02 21:00", form_slug: "zukai-seminar-2611" }, "mcp");
  assert.equal(dup.error, "form_used_by_another_seminar");
  assert.equal((await sem.set(env, { title: "x", starts_at: "2026-11-02 21:00", form_slug: "nai" })).error, "form_not_found");
  assert.equal((await sem.set(env, { title: "x", starts_at: "2026-11-02 21:00", zoom_url: "http://zoom" })).error, "bad_zoom_url");
});

test("フォームに答えた人が申込者になり、受付のメールが 1 回だけ届く。定員を超えたら申込にしない", async () => {
  const { st, sem, mails, person } = setup();
  person(A, "a@example.com", "A"); person(B, "b@example.com", "B");
  st.table("b_forms").push({ id: "f1", slug: "sem-form", title: "申込" });
  const start = new Date(Date.now() + 3 * 864e5).toISOString();
  const { seminar } = await sem.set(env, { title: "図解セミナー", starts_at: start, form_slug: "sem-form", capacity: 1 }, "admin@example.com");
  const r1 = await sem.onForm(env, A, "sem-form");
  assert.equal(r1.registered, true);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /お申し込み完了/);
  assert.equal(mails[0].kind, "seminar_notice"); // 手続きのメール（送る範囲 login で届く）
  const again = await sem.onForm(env, A, "sem-form");
  assert.equal(again.already, true);
  assert.equal(mails.length, 1);
  const full = await sem.onForm(env, B, "sem-form");
  assert.equal(full.reason, "full");
  assert.equal(st.table("events").filter((e) => e.type === "seminar_registered").length, 1);
  assert.equal((await sem.get(env, { seminar_id: seminar.id })).registrants.length, 1);
  assert.equal(await sem.onForm(env, A, "other-form"), null); // 回に結んでいないフォームは何もしない
});

test("定時の処理：送る時刻が来た知らせだけを、送る時刻より前に申し込んだ人へ 1 回だけ", async () => {
  const { st, sem, mails, person } = setup();
  person(A, "a@example.com", "A"); person(B, "b@example.com", "B");
  st.table("b_forms").push({ id: "f1", slug: "sem-form", title: "申込" });
  const startMs = Date.now() + 3 * 864e5;
  const { seminar } = await sem.set(env, { title: "図解セミナー", starts_at: new Date(startMs).toISOString(), form_slug: "sem-form" }, "mcp");
  await sem.onForm(env, A, "sem-form");
  mails.length = 0;
  const dayBefore = startMs - 864e5 + 10 * 60e3;
  // 送る時刻より後に申し込んだ人（B）は前日の知らせを受け取らない
  st.table("events").push({ id: 9999, customer_id: B, type: "seminar_registered", payload: { seminar_id: seminar.id, title: "図解セミナー" }, actor: "site", occurred_at: new Date(dayBefore - 60e3).toISOString() });
  const early = await sem.run(env, startMs - 2 * 864e5);
  assert.equal(early.sent, 0);
  const r = await sem.run(env, dayBefore);
  assert.equal(r.sent, 1);
  assert.deepEqual(mails.map((m) => [m.to, m.extra.notice_key]), [["a@example.com", "day-before"]]);
  assert.equal((await sem.run(env, dayBefore + 60e3)).sent, 0); // 2 回目は送らない
  const hour = await sem.run(env, startMs - 50 * 60e3);
  assert.equal(hour.sent, 2); // 1 時間前の知らせは A と B の両方（B は 1 時間前より前に申し込んでいる）
  assert.equal((await sem.run(env, startMs + 5 * 3600e3)).sent, 0); // 3 時間を過ぎた知らせは遅れて出さない
});

test("知らせはあとから足せる（名前で見分ける）。いま送るはまだ受け取っていない人へだけ", async () => {
  const { st, sem, mails, person } = setup();
  person(A, "a@example.com", "A"); person(B, "b@example.com", "B");
  st.table("b_forms").push({ id: "f1", slug: "sem-form", title: "申込" });
  const { seminar } = await sem.set(env, { title: "図解セミナー", starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), form_slug: "sem-form" }, "mcp");
  await sem.onForm(env, A, "sem-form"); await sem.onForm(env, B, "sem-form");
  const add = await sem.setNotice(env, { seminar_id: seminar.id, key: "three-days-before", offset_minutes: 4320, subject: "あと 3 日：{{title}}", body: "{{name}} さん" }, "mcp");
  assert.equal(add.ok, true); assert.equal(add.created, true);
  assert.equal((await sem.setNotice(env, { seminar_id: seminar.id, key: "Bad Key", subject: "x", body: "y" })).error, "bad_key");
  assert.equal((await sem.setNotice(env, { seminar_id: seminar.id, key: "far", offset_minutes: 99999, subject: "x", body: "y" })).error, "bad_offset_minutes");
  const fix = await sem.setNotice(env, { seminar_id: seminar.id, key: "three-days-before", subject: "直した件名" }, "mcp");
  assert.equal(fix.created, false);
  assert.equal(st.table("b_seminar_notices").filter((n) => n.key === "three-days-before").length, 1);
  mails.length = 0;
  const s1 = await sem.sendNotice(env, { seminar_id: seminar.id, key: "three-days-before" }, "admin@example.com");
  assert.deepEqual([s1.sent, s1.skipped], [2, 0]);
  assert.equal(mails[0].subject, "直した件名");
  const s2 = await sem.sendNotice(env, { seminar_id: seminar.id, key: "three-days-before" }, "mcp");
  assert.deepEqual([s2.sent, s2.skipped], [0, 2]);
  assert.ok(st.table("events").filter((e) => e.type === "seminar_notice_sent").every((e) => ACTORS.includes(e.actor)));
});

test("申込者には回ごとのラベル「セミナー:題名」が付く（あとから配信の宛先にできる）", () => {
  const labels = autoLabels({ person: { source: "x" }, events: [{ type: "seminar_registered", payload: { seminar_id: "s", title: "2026-11 図解セミナー" }, occurred_at: new Date().toISOString() }] });
  assert.ok(labels.includes("セミナーに申し込んだ"));
  assert.ok(labels.includes("セミナー:2026-11図解セミナー"));
});

test("フォームの答えのあと、セミナーの回のサンクスページの住所が返る（公開中のときだけ）", async () => {
  const { st, sem, person } = setup();
  person(A, "a@example.com", "A");
  st.table("b_forms").push({ id: "f1", slug: "sem-form", title: "申込" });
  st.table("b_pages").push({ id: "p1", slug: "zukai-thanks", status: "draft" });
  const { seminar } = await sem.set(env, { title: "図解セミナー", starts_at: new Date(Date.now() + 864e5 * 3).toISOString(), form_slug: "sem-form", thanks_page_slug: "zukai-thanks" }, "mcp");
  assert.equal((await sem.onForm(env, A, "sem-form")).thanks_url, null); // 下書きのページへは移さない
  st.table("b_pages")[0].status = "published";
  assert.equal((await sem.onForm(env, A, "sem-form")).thanks_url, "https://lp.shia2n.jp/zukai-thanks");
  assert.equal((await sem.set(env, { id: seminar.id, thanks_page_slug: "nai" })).error, "thanks_page_not_found");
});

test("forms.submit が回の申込を呼び、サンクスの住所を返す", async () => {
  const st = fakeStore();
  st.table("b_fields").push({ key: "q1", label: "質問", type: "text" });
  st.table("b_forms").push({ id: "f1", slug: "sem-form", title: "申込", intro: "", thanks: "ありがとう", items: [{ key: "q1", required: false }], ask_name: true, active: true });
  const forms = makeForms({ db: st.db, addEvent: async () => ({}), logInbound: async () => {}, registerPerson: async () => ({ ok: true, id: A, is_new: true }) });
  forms.hooks.onSubmitted = async () => ({ registered: true, thanks_url: "https://lp.shia2n.jp/zukai-thanks" });
  const r = await forms.submit(env, "sem-form", { email: "a@example.com", consent: true, answers: {} });
  assert.equal(r.thanks_url, "https://lp.shia2n.jp/zukai-thanks");
  forms.hooks.onSubmitted = async () => ({ registered: false, reason: "full", thanks_url: "https://lp.shia2n.jp/zukai-thanks" });
  const full = await forms.submit(env, "sem-form", { email: "a@example.com", consent: true, answers: {} });
  assert.equal(full.thanks_url, undefined);
  assert.match(full.thanks, /定員/);
});

test("HTML の注意書きの中の印は読まない（便 12a の残り）", () => {
  const p = parseParts('<!-- 例 <div data-lab-part="form:フォームの住所の名前"></div> --><div data-lab-part="form:sem-form"></div>');
  assert.deepEqual(p.forms, ["sem-form"]);
  assert.deepEqual(p.bad, []);
});

test("設計図：申込のフォーム → 回 → サンクスページの線", () => {
  const parts = buildParts({
    seminars: [{ id: "s1", title: "図解セミナー", starts_at: new Date(Date.now() + 864e5).toISOString(), form_slug: "sem-form", thanks_page_slug: "zukai-thanks" }],
    forms: [{ id: "f1", title: "申込", slug: "sem-form", active: true }],
    pages: [{ id: "p1", title: "ありがとう", slug: "zukai-thanks", status: "published", purpose: "thanks", url: "x" }],
  });
  const edges = buildEdges(parts).map((e) => `${e.from}>${e.to}:${e.label}`);
  assert.ok(edges.includes("form:f1>seminar:s1:申込"));
  assert.ok(edges.includes("seminar:s1>page:p1:サンクス"));
  assert.equal(parts.find((p) => p.key === "page:p1").lane, "signup");
});

// 便 16a：UTAGE の読者と予約者の取り込みの試験。UTAGE の REST の返事は 10/10 に UTAGE の道具で読んだ本物の形
// （data の各行に common_reader_id・scenario_fields.mail・is_blocked・is_mail_error・scenario_title・created_at、meta.total）で作る。
// 走らせ方：node --test tests/utageimport16a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeUtageImport, readerEmail, utageTime, PAGES_PER_RUN, CURSOR_KEY } from "../src/utageimport.js";
import { autoLabels } from "../src/connect.js";
import { DEFAULT_MODES } from "../src/guard.js";

const reader = (i, mail, extra = {}) => ({ id: "r" + i, common_reader_id: "c" + i, scenario_id: "s1", scenario_fields: { mail }, common_fields: {},
  line_display_name: null, is_blocked: false, is_line_blocked: false, is_mail_error: false, created_at: "2026-05-05 11:19:44", scenario_title: "長く愛される商品設計ロードマップリマインダ", ...extra });

function setup({ accounts, readers, ic = [] }) {
  const s = fakeStore();
  const logs = [];
  const logInbound = async (env, channel, request, response, status) => { logs.push({ channel, response, status }); s.table("inbound_log").push({ id: logs.length, channel, request, response, status, at: new Date().toISOString() }); };
  const addEvent = async (env, cid, type, payload, actor) => (await s.db(env, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"))[0];
  const register = async (env, email, name) => {
    const ex = s.table("customers").find((c) => c.email.toLowerCase() === email);
    if (ex) return { id: ex.id, is_new: false };
    const id = crypto.randomUUID();
    s.table("customers").push({ id, email, name, source: "other", created_at: new Date().toISOString() });
    return { id, is_new: true };
  };
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    if (u.pathname.endsWith("/accounts")) return Response.json({ data: accounts });
    const m = u.pathname.match(/accounts\/([^/]+)\/readers$/);
    const all = readers[m[1]] || [];
    const per = Number(u.searchParams.get("per_page")), page = Number(u.searchParams.get("page"));
    return Response.json({ data: all.slice((page - 1) * per, page * per), meta: { current_page: page, per_page: per, total: all.length } });
  };
  for (const r of ic) s.table("ic_persons").push(r);
  const imp = makeUtageImport({ db: s.db, addEvent, logInbound, register, fetch });
  const env = { B_STORE: true, UTAGE_API_KEY: "k" };
  return { s, imp, env, calls, logs };
}

test("メールの読み方と UTAGE の日時（日本時間）", () => {
  assert.equal(readerEmail(reader(1, " A@Example.COM ")), "a@example.com");
  assert.equal(readerEmail(reader(1, null)), null);
  assert.equal(utageTime("2026-08-28 04:53:01"), "2026-08-27T19:53:01.000Z");
});

test("全ページを読み、メールでまとめて 1 人 1 回入れる。出来事は utage_imported で、registered は積まない", async () => {
  const rs = [];
  for (let i = 0; i < 250; i++) rs.push(reader(i, `p${i % 120}@example.com`)); // 同じ人が別シナリオで重なる
  rs.push(reader(999, null, { line_display_name: "LINE だけ" }));
  const { s, imp, env } = setup({ accounts: [{ id: "A1", name: "シアニン" }], readers: { A1: rs } });
  const out = await imp.run(env);
  assert.equal(out.ok, true);
  assert.equal(out.pages, 0, "1 ページ目で新しい人が上限を超えたので、そのページは次の回にやり直す");
  assert.equal(out.created, 80, "1 回に新しく入れるのは 80 人まで");
  assert.equal(out.stopped, "new_limit");
  const out2 = await imp.run(env);
  assert.equal(out2.created, 40);
  assert.equal(out2.sweep_done, true);
  assert.equal(s.table("customers").length, 120);
  const ev = s.table("events");
  assert.equal(ev.filter((e) => e.type === "utage_imported").length, 120, "1 人 1 回");
  assert.equal(ev.filter((e) => e.type === "registered").length, 0, "登録のきっかけは動かさない");
  assert.equal(out.no_email + out2.no_email >= 1, true);
  // 3 回目は何も増えない（流し直しても同じ）
  const out3 = await imp.run(env);
  assert.equal(out3.created, 0);
  assert.equal(s.table("events").filter((e) => e.type === "utage_imported").length, 120);
});

test("しおり：1 回に読むのは決まったページ数まで。次の回は続きから読み、最後まで読んだら頭に戻る", async () => {
  const rs = []; for (let i = 0; i < (PAGES_PER_RUN + 2) * 100; i++) rs.push(reader(i, `x${i % 50}@example.com`));
  const { s, imp, env } = setup({ accounts: [{ id: "A1", name: "シアニン" }, { id: "B2", name: "しあらぼ公式LINE" }], readers: { A1: rs, B2: [reader(1, "y@example.com")] } });
  const o1 = await imp.run(env);
  assert.equal(o1.pages, PAGES_PER_RUN);
  assert.deepEqual([o1.cursor.a, o1.cursor.p], [0, PAGES_PER_RUN + 1]);
  const o2 = await imp.run(env);
  assert.equal(o2.sweep_done, true);
  assert.equal(o2.cursor.sweep, 1);
  assert.deepEqual([o2.cursor.a, o2.cursor.p], [0, 1]);
  assert.ok(s.table("settings").find((r) => r.key === CURSOR_KEY));
});

test("UTAGE で配信停止・メールエラーの人は、B でも配信停止（via utage）になる。すでに止めている人には積まない", async () => {
  const { s, imp, env } = setup({ accounts: [{ id: "A1", name: "シアニン" }], readers: { A1: [reader(1, "stop@example.com", { is_blocked: true }), reader(2, "err@example.com", { is_mail_error: true }), reader(3, "ok@example.com")] } });
  await imp.run(env);
  const un = s.table("events").filter((e) => e.type === "email_unsubscribed");
  assert.equal(un.length, 2);
  assert.ok(un.every((e) => e.payload.via === "utage"));
  await imp.run(env);
  assert.equal(s.table("events").filter((e) => e.type === "email_unsubscribed").length, 2);
});

test("台帳にもういる人（大文字まじりのメール）は新しく作らず、取り込みの出来事だけ積む", async () => {
  const { s, imp, env } = setup({ accounts: [{ id: "A1", name: "シアニン" }], readers: { A1: [reader(1, "student@example.com")] } });
  s.table("customers").push({ id: "11111111-1111-4111-8111-111111111111", email: "Student@Example.com", name: "生徒" });
  const o = await imp.run(env);
  assert.equal(o.created, 0);
  assert.equal(s.table("customers").length, 1);
  assert.equal(s.table("events").filter((e) => e.type === "utage_imported")[0].customer_id, "11111111-1111-4111-8111-111111111111");
});

test("予約者：ic_persons の source=UTAGE を 1 人 1 回 consult_booked（via utage・日時の枠なし）で積む", async () => {
  const { s, imp, env } = setup({ accounts: [], readers: {}, ic: [
    { id: "ic1", name: "一丸 直樹", email: "i@example.com", first_date: "2026-03-22", source: "UTAGE" },
    { id: "ic2", name: "手入力", email: "m@example.com", first_date: "2026-04-01", source: "manual" },
    { id: "ic3", name: "メールなし", email: null, first_date: "2026-04-02", source: "UTAGE" },
  ] });
  const o = await imp.run(env);
  assert.equal(o.consults, 1);
  assert.equal(o.consult_no_email, 1);
  const cb = s.table("events").filter((e) => e.type === "consult_booked");
  assert.equal(cb.length, 1);
  assert.equal(cb[0].payload.via, "utage");
  assert.equal(cb[0].payload.slot, undefined, "空き時間をふさがない・前日の知らせを出さない");
  await imp.run(env);
  assert.equal(s.table("events").filter((e) => e.type === "consult_booked").length, 1);
});

test("鍵が無ければ何もしない。UTAGE が誤りを返したら失敗として記録に残る", async () => {
  const a = setup({ accounts: [], readers: {} });
  assert.equal((await a.imp.run({ B_STORE: true })).skipped, "no_key");
  const b = setup({ accounts: [{ id: "A1", name: "x" }], readers: {} });
  const bad = makeUtageImport({ db: b.s.db, addEvent: async () => {}, logInbound: async (e, c, q, r, st) => b.logs.push({ c, r, st }), register: async () => ({}), fetch: async () => new Response("no", { status: 401 }) });
  const o = await bad.run({ B_STORE: true, UTAGE_API_KEY: "k" });
  assert.equal(o.ok, false);
  assert.match(o.error, /UTAGE 401/);
  assert.equal(b.logs.at(-1).st, 500);
});

test("ラベル：UTAGE のアカウント名が付き、最後に動いた日は取り込んだ日ではなく UTAGE で登録した日", () => {
  const now = Date.parse("2026-10-10T05:00:00Z");
  const person = { id: "p", source: "other", created_at: "2026-10-10T04:00:00Z" };
  const ev = [{ type: "utage_imported", occurred_at: "2026-10-10T04:00:00Z", payload: { via: "utage", account_name: "シアニン", utage_at: "2026-05-05T02:19:44Z" } }];
  const l = autoLabels({ person, events: ev, now });
  assert.ok(l.includes("UTAGE:シアニン"));
  assert.ok(l.includes("最後に動いた:30日より前"));
  const cb = autoLabels({ person, events: [...ev, { type: "consult_booked", occurred_at: "2026-10-10T04:00:00Z", payload: { via: "utage", utage_at: "2026-03-21T15:00:00Z" } }], now });
  assert.ok(cb.includes("個別相談を予約した"));
  assert.ok(cb.includes("最後に動いた:30日より前"));
});

test("権限：取り込みの様子を見る道具は自動", () => {
  assert.equal(DEFAULT_MODES.get_utage_import, "auto");
});

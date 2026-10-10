// 便 17：永久の除外の試験。ラベル「除外」の人は条件に書かなくても、一斉配信・ステップのメール・LINE の送信から外れる。
// ラベルは何人分でも 1 回で付け外しでき（番号の並び・メールの並び）、LINE と結ばれた人には自動のラベル「LINE:アカウント」が付く。
// 走らせ方：node --test tests/exclude17.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeDeliver } from "../src/deliver.js";
import { makeConnect, autoLabels, EXCLUDE_LABEL } from "../src/connect.js";
import { makeLine, tokenName } from "../src/line.js";
import { readFileSync } from "node:fs";

const env = { B_STORE: true, MCP_SECRET: "test-secret", PUBLIC_ORIGIN: "https://lab.shia2n.jp" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function setup() {
  const s = fakeStore();
  const addEvent = async (e, id, type, payload, actor = "site") => {
    const [row] = await s.db(e, "POST", "events", [{ customer_id: id, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const sent = [];
  const bin3 = {
    async sendMail(e, person, m) {
      sent.push({ to: person.email, ...m });
      await addEvent(e, person.id, "email_sent", { kind: m.kind, ...(m.extra || {}) });
      return { result: "sent" };
    },
  };
  const sell = { entitlementMap: async () => ({}) };
  const mailcfg = { get: async () => ({ scope: "all" }) };
  const connect = makeConnect({ db: s.db, addEvent, logInbound: async () => {}, sell, mailcfg });
  const deliver = makeDeliver({ db: s.db, addEvent, logInbound: async () => {}, bin3, sell, mailcfg, connect, forms: null });
  for (const [id, email, name] of [[A, "a@example.com", "A"], [B, "b@example.com", "B"], [C, "c@example.com", "C"]]) {
    s.table("customers").push({ id, email, name });
    s.table("customer_summary").push({ id, email, name, source: "direct", note_member: false, created_at: "2026-10-01T00:00:00Z" });
  }
  return { ...s, s, deliver, connect, sent, addEvent };
}
const wake = (st) => st.table("b_steps").forEach((r) => { r.active_since = "2000-01-01T00:00:00.000Z"; });

test("メールの並びで何人でも 1 回で「除外」を付ける。台帳に無いメール・大文字まじり・同じメールの重なりを扱う。2 回目は何も変えない", async () => {
  const st = setup();
  const r = await st.connect.addLabel(env, { emails: ["A@Example.com", "a@example.com", "b@example.com", "nobody@example.com"], label: EXCLUDE_LABEL }, "mcp");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.targets, r.changed, r.unchanged, r.not_found], [2, 2, 0, 1]);
  assert.deepEqual(r.not_found_emails, ["nobody@example.com"]);
  const again = await st.connect.addLabel(env, { emails: ["a@example.com"], label: EXCLUDE_LABEL }, "mcp");
  assert.deepEqual([again.changed, again.unchanged], [0, 1]);
  assert.deepEqual([...(await st.connect.excludedIds(env))].sort(), [A, B]);
  const off = await st.connect.removeLabel(env, { person_ids: [B], label: EXCLUDE_LABEL }, "mcp");
  assert.equal(off.changed, 1);
  assert.deepEqual([...(await st.connect.excludedIds(env))], [A]);
  assert.equal((await st.connect.addLabel(env, { emails: [], label: EXCLUDE_LABEL }, "mcp")).error, "need_person_ids_or_emails");
  assert.equal((await st.connect.addLabel(env, { emails: Array.from({ length: 501 }, (_, i) => `x${i}@example.com`), label: EXCLUDE_LABEL }, "mcp")).error, "too_many");
  // 1 人ずつの形はこれまでどおり
  const one = await st.connect.addLabel(env, { person_id: C, label: "ほかの印" }, "mcp");
  assert.deepEqual([one.ok, one.changed], [true, true]);
});

test("宛先：条件を何も書かなくても「除外」の人は外れ、外れた人数が出る。ほかの手のラベルでは外れない", async () => {
  const st = setup();
  await st.connect.addLabel(env, { person_ids: [A], label: EXCLUDE_LABEL }, "mcp");
  await st.connect.addLabel(env, { person_ids: [B], label: "ほかの印" }, "mcp");
  const pv = await st.deliver.previewAudience(env, {});
  assert.deepEqual([pv.count, pv.excluded, pv.will_send], [2, 1, 2]);
  const named = await st.deliver.audience(env, { emails: ["a@example.com"] });
  assert.equal(named.people.length, 0, "メールで名指ししても外れる");
  assert.equal(named.excluded, 1);
  const kept = await st.deliver.audience(env, {}, { keepExcluded: true });
  assert.equal(kept.people.length, 3);
});

test("一斉配信：「除外」の人には送らず、列に入れたときの人数にも入らない", async () => {
  const st = setup();
  await st.connect.addLabel(env, { emails: ["a@example.com"], label: EXCLUDE_LABEL }, "mcp");
  const d = await st.deliver.draftBroadcast(env, { subject: "お知らせ", body: "本文" }, "test");
  assert.equal(d.audience.excluded, 1);
  d.broadcast.id = st.table("b_broadcasts")[0].id = "44444444-4444-4444-8444-444444444444"; // 試しの置き場は番号を UUID で振らないため、本物の形に直す
  const q = await st.deliver.queueBroadcast(env, { id: d.broadcast.id }, "test");
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.broadcast.target_count, 2);
  await st.deliver.run(env);
  assert.deepEqual(st.sent.map((m) => m.to).sort(), ["b@example.com", "c@example.com"]);
});

test("ステップ：メールを送る動きは「除外」の人を飛ばして記録に残す。ラベルを付ける動きは除外の人にも動く", async () => {
  const st = setup();
  await st.connect.addLabel(env, { person_ids: [A], label: EXCLUDE_LABEL }, "mcp");
  await st.deliver.setStep(env, { name: "受付のメール", trigger: "registered", action: "send_email", subject: "受付", body: "b", active: true }, "test");
  await st.deliver.setStep(env, { name: "登録の印", trigger: "registered", action: "add_label", action_args: { label: "登録した" }, active: true }, "test");
  wake(st);
  await st.addEvent(env, A, "registered", {});
  await st.addEvent(env, B, "registered", {});
  await st.deliver.run(env);
  assert.deepEqual(st.sent.map((m) => m.to), ["b@example.com"]);
  const skip = st.table("events").filter((e) => e.type === "connector_skipped");
  assert.equal(skip.length, 1);
  assert.deepEqual([skip[0].customer_id, skip[0].payload.reason], [A, "excluded"]);
  const labeled = st.table("events").filter((e) => e.type === "label_added" && e.payload.label === "登録した").map((e) => e.customer_id).sort();
  assert.deepEqual(labeled, [A, B]);
  // 次の回も、飛ばした人へは送らない（同じきっかけで回り続けない）
  await st.deliver.run(env);
  assert.equal(st.sent.length, 1);
  assert.equal(st.table("events").filter((e) => e.type === "connector_skipped").length, 1);
});

test("LINE：1 人を名指ししても、絞って送っても「除外」の人には送らない", async () => {
  const st = setup();
  await st.connect.addLabel(env, { person_ids: [A], label: EXCLUDE_LABEL }, "mcp");
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return Response.json({}); };
  const line = makeLine({ db: st.s.db, logInbound: async () => {}, changes: null, addEvent: st.addEvent, registerPerson: async () => ({ ok: false }),
    audience: (e, f) => st.deliver.audience(e, f), excluded: (e) => st.connect.excludedIds(e), fetch });
  for (const [id, u] of [[A, "U" + "a".repeat(32)], [B, "U" + "b".repeat(32)]]) await st.addEvent(env, id, "line_linked", { account: "college_ops", user: u });
  const lenv = { ...env, [tokenName("college_ops")]: "tok" };
  const one = await line.send(lenv, { account: "college_ops", person_id: A, text: "こんにちは" }, "mcp");
  assert.deepEqual([one.sent, one.excluded, one.targets], [0, 1, 0]);
  const many = await line.send(lenv, { account: "college_ops", filter: {}, text: "こんにちは" }, "mcp");
  assert.deepEqual([many.sent, many.excluded, many.not_linked], [1, 1, 1]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.to, "U" + "b".repeat(32));
});

test("LINE と結ばれた人には自動のラベル「LINE:アカウント」。ラベルを読む出来事に line_linked が入っている", () => {
  const person = { id: A, source: "direct", created_at: "2026-10-01T00:00:00Z" };
  const l = autoLabels({ person, events: [{ type: "line_linked", occurred_at: "2026-10-10T00:00:00Z", payload: { account: "college_ops", user: "U1" } }] });
  assert.ok(l.includes("LINE:college_ops"));
  const src = readFileSync(new URL("../src/connect.js", import.meta.url), "utf8");
  assert.match(src, /"utage_imported", "line_linked"\]/);
});

test("道具：add_label・remove_label は person_ids・emails を受け、label だけが必須。版の名前", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  for (const name of ["add_label", "remove_label"]) {
    const i = src.indexOf(`name: "${name}"`);
    const part = src.slice(i, src.indexOf("\n  },", i));
    assert.match(part, /person_ids: \{ type: "array"/);
    assert.match(part, /emails: \{ type: "array"/);
    assert.match(part, /required: \["label"\]/);
  }
  assert.match(src, /const VERSION = "0\.41\.0-b17";/);
});

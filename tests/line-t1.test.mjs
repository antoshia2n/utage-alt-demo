// 便 T1（2026-11-07 Naoki OK 23:05）：X収益化ロードマップ動画企画のための LINE のステップ配信。
//   きっかけ「LINE と結ばれた」（line_linked・アカウントで絞れる）→ 動き「LINE を送る」（send_line・アカウントと本文）。
//   結ばれていない人・ブロックした人・「除外」の人には送らない。LINE の今月の残りが少ないときは送らずに待たせ、Naoki に 1 日 1 回知らせる。
//   友だち追加の案内の文はアカウントごとに変えられる（{{url}} の所にその人専用の登録のリンク）。
// 走らせ方：node --test tests/line-t1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fakeStore } from "./fake-store.mjs";
import { makeDeliver } from "../src/deliver.js";
import { makeConnect, EXCLUDE_LABEL, LINE_QUOTA_HOLD } from "../src/connect.js";
import { makeLine, secretName, tokenName, inviteOnFollow } from "../src/line.js";
import { DEFAULT_MODES } from "../src/guard.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const UA = "U" + "a".repeat(32), UB = "U" + "b".repeat(32), UC = "U" + "c".repeat(32);
const env = { B_STORE: true, MCP_SECRET: "test-secret", PUBLIC_ORIGIN: "https://lab.shia2n.jp", [secretName("shianin")]: SECRET, [tokenName("shianin")]: "tok", LINE_INVITE_ACCOUNTS: "college_ops,shianin" };

function setup({ used = 0, limit = 200 } = {}) {
  const s = fakeStore();
  const addEvent = async (e, id, type, payload, actor = "site") => {
    const [row] = await s.db(e, "POST", "events", [{ customer_id: id, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const pushes = [], notices = [];
  const q = { used, limit };
  const fetch = async (url, init = {}) => {
    if (url.endsWith("/message/quota")) return Response.json(q.limit == null ? { type: "none" } : { type: "limited", value: q.limit });
    if (url.endsWith("/message/quota/consumption")) return Response.json({ totalUsage: q.used });
    if (url.endsWith("/message/push")) { const b = JSON.parse(init.body); pushes.push(b); q.used++; return Response.json({}); }
    if (url.startsWith("https://utage")) return new Response("ok");
    return Response.json({});
  };
  const sell = { entitlementMap: async () => ({}) };
  const mailcfg = { get: async () => ({ scope: "all", from: "x@mail.shia2n.jp" }), fromField: () => "x@mail.shia2n.jp" };
  const connect = makeConnect({ db: s.db, addEvent, logInbound: async () => {}, sell, mailcfg });
  connect.notifyAdmins = async (e, m) => { notices.push(m); return { sent: 1 }; };
  let line;
  const deliver = makeDeliver({ db: s.db, addEvent, logInbound: async () => {}, bin3: { sendMail: async () => ({ result: "sent" }) }, sell, mailcfg, connect, forms: null, line: () => line });
  line = makeLine({ db: s.db, logInbound: async () => {}, changes: null, addEvent, registerPerson: async () => ({ ok: false }), audience: (e, f) => deliver.audience(e, f), excluded: (e) => connect.excludedIds(e), fetch });
  for (const [id, email, name] of [[A, "a@example.com", "A"], [B, "b@example.com", "B"], [C, "c@example.com", "C"]]) {
    s.table("customers").push({ id, email, name });
    s.table("customer_summary").push({ id, email, name, source: "x", note_member: false, created_at: "2026-11-01T00:00:00Z" });
  }
  return { ...s, deliver, connect, line, addEvent, pushes, notices, q };
}
const wake = (st) => st.table("b_steps").forEach((r) => { r.active_since = "2000-01-01T00:00:00.000Z"; });
const link = (st, id, user, account = "shianin") => st.addEvent(env, id, "line_linked", { account, user });

test("LINE と結ばれたら、その人へ LINE を送る。ほかのアカウントで結ばれた人には動かない。2 回目の定時では送り直さない", async () => {
  const st = setup();
  const r = await st.deliver.setStep(env, { name: "登録直後", trigger: "line_linked", trigger_args: { account: "shianin" }, action: "send_line", action_args: { account: "shianin" }, body: "{{name}}さん、特典はこちら", active: true }, "test");
  assert.equal(r.ok, true, JSON.stringify(r));
  wake(st);
  await link(st, A, UA);
  await link(st, B, UB, "college_ops");
  const out = await st.deliver.run(env);
  assert.equal(out.steps.line_sent, 1);
  assert.equal(st.pushes.length, 1);
  assert.deepEqual([st.pushes[0].to, st.pushes[0].messages[0].text], [UA, "Aさん、特典はこちら"]);
  const sent = st.table("events").filter((e) => e.type === "line_sent");
  assert.deepEqual([sent.length, sent[0].customer_id, sent[0].payload.kind, sent[0].payload.step_id], [1, A, "step", r.step.id]);
  await st.deliver.run(env);
  assert.equal(st.pushes.length, 1, "同じきっかけで 2 回送らない");
  const list = await st.deliver.listSteps(env);
  assert.equal(list.steps[0].line_sent, 1);
  assert.equal(list.triggers.line_linked, "LINE 連携");
  assert.equal(list.actions.send_line, "LINE 送信");
});

test("1 日後などの待ちは delay_hours で数える（時刻が来るまで送らない）", async () => {
  const st = setup();
  await st.deliver.setStep(env, { name: "1日後", trigger: "line_linked", action: "send_line", action_args: { account: "shianin" }, body: "1日後の話", delay_hours: 24, active: true }, "test");
  wake(st);
  await link(st, A, UA);
  await st.deliver.run(env);
  assert.equal(st.pushes.length, 0);
  st.table("events").find((e) => e.type === "line_linked").occurred_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  await st.deliver.run(env);
  assert.equal(st.pushes.length, 1);
});

test("結ばれていない人・ブロックした人・「除外」の人には送らず、飛ばした理由を残す", async () => {
  const st = setup();
  await st.deliver.setStep(env, { name: "登録で送る", trigger: "registered", action: "send_line", action_args: { account: "shianin" }, body: "こんにちは", active: true }, "test");
  wake(st);
  await link(st, B, UB);
  await link(st, C, UC);
  st.table("inbound_log").push({ id: 1, channel: "line", request: { account: "shianin", events: [{ type: "unfollow", source: { user: UB } }] }, at: new Date().toISOString() });
  await st.connect.addLabel(env, { person_id: C, label: EXCLUDE_LABEL }, "mcp");
  for (const id of [A, B, C]) await st.addEvent(env, id, "registered", {});
  await st.deliver.run(env);
  const reasons = Object.fromEntries(st.table("events").filter((e) => e.type === "connector_skipped").map((e) => [e.customer_id, e.payload.reason]));
  assert.equal(reasons[A], "line_not_linked");
  assert.equal(reasons[C], "excluded");
  assert.equal(reasons[B], "line_blocked");
  assert.equal(st.pushes.length, 0);
  assert.ok(!st.pushes.some((p) => p.to === UC), "除外の人には送らない");
});

test("LINE の今月の残りが少ないときは送らずに待たせ、Naoki に 1 日 1 回だけ知らせる。残りが増えたら次の定時で送る", async () => {
  const st = setup({ used: 200 - LINE_QUOTA_HOLD, limit: 200 });
  await st.deliver.setStep(env, { name: "登録直後", trigger: "line_linked", action: "send_line", action_args: { account: "shianin" }, body: "特典", active: true }, "test");
  wake(st);
  await link(st, A, UA);
  const out = await st.deliver.run(env);
  assert.equal(st.pushes.length, 0);
  assert.equal(out.steps.line_waiting, 1);
  assert.equal(st.notices.length, 1);
  assert.match(st.notices[0].subject, /残りが 20 通/);
  await st.deliver.run(env);
  assert.equal(st.notices.length, 1, "同じ日に 2 回知らせない");
  st.q.limit = 5000; // プランを上げた
  await st.deliver.run(env);
  assert.equal(st.pushes.length, 1);
});

test("残りが送っている途中で少なくなったら、そこで止めて待たせる", async () => {
  const st = setup({ used: 200 - LINE_QUOTA_HOLD - 1, limit: 200 });
  await st.deliver.setStep(env, { name: "登録直後", trigger: "line_linked", action: "send_line", action_args: { account: "shianin" }, body: "特典", active: true }, "test");
  wake(st);
  await link(st, A, UA); await link(st, B, UB); await link(st, C, UC);
  const out = await st.deliver.run(env);
  assert.equal(st.pushes.length, 1);
  assert.equal(out.steps.line_waiting, 2);
  assert.equal(st.notices.length, 1);
});

test("LINE を送る動きは、本文とアカウントが無いと作れない。本文は 2000 字まで。アカウントの名前の形も確かめる", async () => {
  const st = setup();
  const base = { name: "x", trigger: "line_linked", action: "send_line" };
  assert.equal((await st.deliver.setStep(env, { ...base, action_args: { account: "shianin" } }, "t")).error, "need_body");
  assert.equal((await st.deliver.setStep(env, { ...base, body: "b" }, "t")).error, "need_action_account");
  assert.equal((await st.deliver.setStep(env, { ...base, body: "b", action_args: { account: "Bad-Name" } }, "t")).error, "bad_action_account");
  assert.equal((await st.deliver.setStep(env, { ...base, body: "あ".repeat(2001), action_args: { account: "shianin" } }, "t")).error, "too_long");
  assert.equal((await st.deliver.setStep(env, { ...base, trigger_args: { account: "x-y" }, body: "b", action_args: { account: "shianin" } }, "t")).error, "bad_trigger_account");
});

test("友だち追加の案内：文を変えると、その文に登録のリンクが入る。空に戻すと今までの文。シアニンも送るアカウントに入っている", async () => {
  const st = setup();
  assert.equal(inviteOnFollow(env, "shianin"), true);
  const set = await st.line.setInviteText(env, { account: "shianin", text: "登録ありがとう！\nメールを入れると特典が開きます👇\n{{url}}" }, "mcp");
  assert.equal(set.ok, true, JSON.stringify(set));
  await st.line.sendLinkInvite(env, "shianin", UA, SECRET);
  const t = st.pushes[0].messages[0].text;
  assert.match(t, /^登録ありがとう！\nメールを入れると特典が開きます👇\nhttps:\/\/lab\.shia2n\.jp\/line-link\?t=/);
  await st.line.setInviteText(env, { account: "shianin", text: "" }, "mcp");
  await st.line.sendLinkInvite(env, "shianin", UB, SECRET);
  assert.match(st.pushes[1].messages[0].text, /^友だち追加ありがとうございます。/);
  assert.equal((await st.line.setInviteText(env, { account: "shianin", text: "あ".repeat(1001) }, "mcp")).error, "too_long");
});

test("本番の設定：シアニンのアカウントで案内を送る。案内の文を変える道具は承認が要る", () => {
  const w = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(w, /"LINE_INVITE_ACCOUNTS": "college_ops,shianin"/);
  assert.equal(DEFAULT_MODES.set_line_invite, "approve");
  assert.equal(DEFAULT_MODES.get_line_invite, "auto");
});

test("表の決まり：きっかけ line_linked と動き send_line を足す SQL がある", () => {
  const sql = readFileSync(new URL("../supabase/bt1_line_steps.sql", import.meta.url), "utf8");
  assert.match(sql, /'line_linked'/);
  assert.match(sql, /'send_line'/);
});

test("便 T3：結ばれた直後に、待ち 0 時間の LINE だけをその人の分だけ送る（1 日後のものとほかの人は動かさない）", async () => {
  const st = setup();
  await st.deliver.setStep(env, { name: "登録直後", trigger: "line_linked", action: "send_line", action_args: { account: "shianin" }, body: "特典", active: true }, "test");
  await st.deliver.setStep(env, { name: "1日後", trigger: "line_linked", action: "send_line", action_args: { account: "shianin" }, body: "1日後", delay_hours: 24, active: true }, "test");
  wake(st);
  await link(st, A, UA);
  await link(st, B, UB);
  st.table("events").filter((e) => e.type === "line_linked").forEach((e) => { e.occurred_at = new Date(Date.now() - 25 * 3600e3).toISOString(); });
  const r = await st.deliver.runNow(env, { trigger: "line_linked", customer_id: A });
  assert.equal(r.ok, true);
  assert.deepEqual(st.pushes.map((p) => [p.to, p.messages[0].text]), [[UA, "特典"]]);
  await st.deliver.runNow(env, { trigger: "line_linked", customer_id: A });
  assert.equal(st.pushes.length, 1, "同じ人へ 2 回送らない");
  assert.equal((await st.deliver.runNow(env, { trigger: "nai", customer_id: A })).error, "bad_args");
});

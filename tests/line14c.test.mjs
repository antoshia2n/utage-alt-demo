// 便 14c：LINE の画面の試験。友だちの一覧（受けた知らせ・結び・LINE の名前）・1 人とのやりとり・返す・絞って送る。
// LINE の返事の形は公式の説明（profile は { displayName }、followers/ids は認証済みでないと 403、push／multicast は 200 と {}）で作る。
// 走らせ方：node --test tests/line14c.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeStore } from "./fake-store.mjs";
import { makeLine, secretName, tokenName } from "../src/line.js";
import { SCREENS } from "../src/guide.js";

const U1 = "U" + "1".repeat(32), U2 = "U" + "2".repeat(32), U3 = "U" + "3".repeat(32);
const P1 = "11111111-1111-4111-8111-111111111111", P3 = "33333333-3333-4333-8333-333333333333";

function setup({ followers = null, excluded = [] } = {}) {
  const s = fakeStore();
  let n = 0;
  const logInbound = async (env, channel, request, response, status) => { n++; s.table("inbound_log").push({ id: n, channel, request, response, status, at: new Date(Date.UTC(2026, 9, 10, 8, 0, n)).toISOString() }); };
  const addEvent = async (env, cid, type, payload, actor) => (await s.db(env, "POST", "events", [{ customer_id: cid, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation"))[0];
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = url.replace("https://api.line.me/v2/bot", "");
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (path.startsWith("/profile/")) { const u = path.slice(9); return u === U1 ? Response.json({ displayName: "なおき" }) : u === U2 ? Response.json({ displayName: "かなやま" }) : Response.json({ message: "Not found" }, { status: 404 }); }
    if (path.startsWith("/followers/ids")) return followers ? Response.json({ userIds: followers }) : Response.json({ message: "Access to this API is not available for your account" }, { status: 403 });
    if (path === "/message/quota") return Response.json({ type: "limited", value: 200 });
    if (path === "/message/quota/consumption") return Response.json({ totalUsage: 3 });
    return Response.json({});
  };
  s.table("customers").push({ id: P1, email: "naoki@example.com", name: "直樹" }, { id: P3, email: "ex@example.com", name: "除外の人" });
  const audience = async (env, f) => ({ people: s.table("customers").filter((c) => !f.emails || f.emails.includes(c.email)).filter((c) => !excluded.includes(c.id)), excluded: excluded.length });
  const line = makeLine({ db: s.db, logInbound, changes: null, addEvent, registerPerson: async () => ({ ok: false }), audience, excluded: async () => new Set(excluded), fetch });
  const env = { B_STORE: true, [secretName("college_ops")]: "x".repeat(32), [tokenName("college_ops")]: "tok" };
  return { s, line, env, calls, logInbound, addEvent };
}
const ev = (type, user, extra = {}) => ({ type, at: "2026-10-10T04:44:0" + (extra.sec || 0) + ".000Z", source: { type: "user", user }, ...extra });
async function seed(t) {
  await t.logInbound(t.env, "line", { account: "college_ops", events: [ev("follow", U1)] }, { forward: { ok: true } }, 200);
  await t.logInbound(t.env, "line", { account: "college_ops", events: [ev("message", U1, { sec: 1, message: { type: "text", text: "こんにちは" } })] }, { forward: { ok: true } }, 200);
  await t.logInbound(t.env, "line_forward_failed", { account: "college_ops", events: [ev("message", U2, { sec: 2, message: { type: "sticker" } })] }, { forward: { ok: false, status: 500 } }, 500);
  await t.addEvent(t.env, P1, "line_linked", { account: "college_ops", user: U1 }, "site");
}

test("一覧：受けた知らせの人が LINE の名前つきで並び、結ばれた人はメールも出る。認証済みでないと全員は取れない旨が分かる", async () => {
  const t = setup(); await seed(t);
  const r = await t.line.board(t.env, { account: "college_ops" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.all_followers, false);
  assert.deepEqual([r.count, r.linked], [2, 1]);
  assert.deepEqual(r.quota, { limit: 200, used: 3 });
  assert.equal(r.forward_failed_7d, 1);
  const a = r.friends.find((x) => x.user === U1), b = r.friends.find((x) => x.user === U2);
  assert.deepEqual([a.name, a.linked, a.email, a.last_text], ["なおき", true, "naoki@example.com", "こんにちは"]);
  assert.deepEqual([b.name, b.linked, b.last_text], ["かなやま", false, "（スタンプ）"]);
});

test("一覧：認証済みのアカウントなら、まだ何も送ってこない友だちも出る", async () => {
  const t = setup({ followers: [U1, U2, U3] }); await seed(t);
  const r = await t.line.board(t.env, { account: "college_ops" });
  assert.equal(r.all_followers, true);
  assert.equal(r.count, 3);
  assert.equal(r.friends.find((x) => x.user === U3).name, "", "名前が読めない人は空");
});

test("返す：1 人へ push し、line_out に 1 行、結ばれた人には出来事 line_sent（画面から）も。やりとりに 1 回だけ並ぶ", async () => {
  const t = setup(); await seed(t);
  const r = await t.line.reply(t.env, { account: "college_ops", user: U1, text: "ありがとうございます" }, "naoki@example.com");
  assert.deepEqual([r.ok, r.sent], [true, 1]);
  const push = t.calls.find((c) => c.path === "/message/push");
  assert.deepEqual(push.body, { to: U1, messages: [{ type: "text", text: "ありがとうございます" }] });
  assert.equal(t.s.table("inbound_log").filter((x) => x.channel === "line_out").length, 1);
  assert.equal(t.s.table("events").filter((e) => e.type === "line_sent" && e.payload.screen).length, 1);
  const th = await t.line.thread(t.env, { account: "college_ops", user: U1 });
  assert.deepEqual(th.messages.map((m) => [m.from, m.text]), [["them", "（友だちに追加した）"], ["them", "こんにちは"], ["me", "ありがとうございます"]]);
  assert.equal(th.person.email, "naoki@example.com");
  // AI の道具で送ったもの（line_sent・画面の印なし）もやりとりに出る
  await t.addEvent(t.env, P1, "line_sent", { account: "college_ops", text: "AI から", ok: true }, "mcp");
  const th2 = await t.line.thread(t.env, { account: "college_ops", user: U1 });
  const ai = th2.messages.find((m) => m.text === "AI から");
  assert.deepEqual([ai.from, ai.ok, ai.by], ["me", true, "AI"]);
  assert.equal(th2.messages.filter((m) => m.text === "ありがとうございます").length, 1, "画面から送ったものは 2 回並ばない");
});

test("返す：ブロックした人・変な番号・空の文・長すぎる文は送らない", async () => {
  const t = setup(); await seed(t);
  await t.logInbound(t.env, "line", { account: "college_ops", events: [ev("unfollow", U2, { sec: 5 })] }, { forward: { ok: true } }, 200);
  assert.equal((await t.line.reply(t.env, { account: "college_ops", user: U2, text: "x" }, "n")).error, "blocked");
  assert.equal((await t.line.reply(t.env, { account: "college_ops", user: "Uabc", text: "x" }, "n")).error, "bad_user");
  assert.equal((await t.line.reply(t.env, { account: "college_ops", user: U1, text: " " }, "n")).error, "need_text");
  assert.equal((await t.line.reply(t.env, { account: "college_ops", user: U1, text: "あ".repeat(2001) }, "n")).error, "too_long");
  assert.equal(t.calls.filter((c) => c.path.startsWith("/message/push")).length, 0);
});

test("絞って送る：友だち全員はブロックと「除外」の人を外す。数えるだけ（dry）では送らない。2 人以上は multicast", async () => {
  const t = setup({ excluded: [P3] }); await seed(t);
  await t.logInbound(t.env, "line", { account: "college_ops", events: [ev("follow", U3, { sec: 6 })] }, { forward: { ok: true } }, 200);
  await t.addEvent(t.env, P3, "line_linked", { account: "college_ops", user: U3 }, "site");
  const dry = await t.line.broadcast(t.env, { account: "college_ops", mode: "all", dry: true }, "n");
  assert.deepEqual([dry.targets, dry.excluded, dry.blocked], [2, 1, 0]);
  assert.equal(t.calls.filter((c) => c.path.startsWith("/message/")).length, 0);
  const r = await t.line.broadcast(t.env, { account: "college_ops", mode: "all", text: "お知らせです" }, "n");
  assert.deepEqual([r.ok, r.sent], [true, 2]);
  const mc = t.calls.find((c) => c.path === "/message/multicast");
  assert.deepEqual(mc.body.to.sort(), [U1, U2]);
  assert.equal(t.s.table("inbound_log").filter((x) => x.channel === "line_out").length, 2);
});

test("絞って送る：条件で絞ると、結ばれた人だけに送り、メール未登録で送れない人を数える", async () => {
  const t = setup(); await seed(t);
  const r = await t.line.broadcast(t.env, { account: "college_ops", mode: "filter", filter: {}, text: "会員の方へ" }, "n");
  assert.deepEqual([r.targets, r.not_linked, r.sent], [1, 1, 1]);
  assert.equal(t.calls.find((c) => c.path === "/message/push").body.to, U1);
  assert.equal((await t.line.broadcast(t.env, { account: "college_ops", mode: "x", text: "a" }, "n")).error, "bad_mode");
});

test("画面：左のメニューに LINE があり、LINE の道具は LINE の画面に並ぶ", () => {
  assert.ok(SCREENS.includes("line"));
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  assert.match(html, /data-view="line"[^>]*>LINE</);
  assert.match(html, /id="view-line"/);
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  for (const name of ["list_line_friends", "send_line", "get_line_quota", "list_line_inbound"]) assert.match(src, new RegExp(`name: "${name}",\\n    screen: "line",`));
  assert.match(src, /const VERSION = "0\.42\.0-b14c";/);
});

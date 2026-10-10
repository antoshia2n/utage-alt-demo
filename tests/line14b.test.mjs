// 便 14b：LINE で送る試験。リンクの印・友だち追加で「メールを登録」のリンクを送る・リンクの頁で結ぶ・結ばれた人へ送る・ブロックの人には送らない。
// LINE の返事の形は公式の説明（push／multicast は 200 と {}、quota は { type, value }、consumption は { totalUsage }）で作る。
// 走らせ方：node --test tests/line14b.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeStore } from "./fake-store.mjs";
import { makeLine, linkToken, parseLinkToken, secretName, tokenName } from "../src/line.js";
import { DEFAULT_MODES } from "../src/guard.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const U1 = "U" + "a".repeat(32), U2 = "U" + "b".repeat(32);
const sig = (b) => createHmac("sha256", SECRET).update(b).digest("base64");

function setup({ token = true, lineStatus = 200 } = {}) {
  const s = fakeStore();
  const logInbound = async (env, channel, request, response, status) => { s.table("inbound_log").push({ id: s.table("inbound_log").length + 1, channel, request, response, status, at: new Date().toISOString() }); };
  const addEvent = async (env, cid, type, payload, actor) => (await s.db(env, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"))[0];
  const registerPerson = async (env, b) => {
    if (b.consent !== true) return { ok: false, error: "need_consent" };
    const email = String(b.email || "").toLowerCase();
    if (!/@/.test(email)) return { ok: false, error: "bad_email" };
    const ex = s.table("customers").find((c) => c.email === email);
    if (ex) return { ok: true, id: ex.id, is_new: false };
    const id = crypto.randomUUID(); s.table("customers").push({ id, email, name: b.name || "" });
    await addEvent(env, id, "registered", { via: b.via }, "site");
    return { ok: true, id, is_new: true };
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers && init.headers.Authorization });
    if (url.startsWith("https://utage")) return new Response("ok");
    if (url.endsWith("/message/quota")) return Response.json({ type: "limited", value: 200 });
    if (url.endsWith("/message/quota/consumption")) return Response.json({ totalUsage: 12 });
    return lineStatus === 200 ? Response.json({}) : Response.json({ message: "The request body has 1 error(s)" }, { status: lineStatus });
  };
  const audience = async (env, f) => ({ people: s.table("customers").filter((c) => !f.emails || f.emails.includes(c.email)) });
  const line = makeLine({ db: s.db, logInbound, changes: null, addEvent, registerPerson, audience, fetch });
  const env = { B_STORE: true, PUBLIC_ORIGIN: "https://lab.shia2n.jp", [secretName("college_ops")]: SECRET, ...(token ? { [tokenName("college_ops")]: "tok" } : {}) };
  return { s, line, env, calls };
}
const hook = (body) => new Request("https://lab.shia2n.jp/api/line/webhook/college_ops", { method: "POST", body, headers: { "x-line-signature": sig(body) } });
const follow = (u) => JSON.stringify({ destination: "Ux", events: [{ type: "follow", timestamp: Date.now(), source: { type: "user", userId: u }, replyToken: "r" }] });
const unfollow = (u) => JSON.stringify({ destination: "Ux", events: [{ type: "unfollow", timestamp: Date.now(), source: { type: "user", userId: u } }] });

test("リンクの印：作った印は読める。ほかの人の番号に差し替えると署名が合わず結ばない", async () => {
  const t = await linkToken(SECRET, "college_ops", U1);
  const p = parseLinkToken(t);
  assert.deepEqual([p.account, p.user], ["college_ops", U1]);
  const forged = (await linkToken(SECRET, "college_ops", U2)).split(".")[0] + "." + t.split(".")[1];
  const { line, env } = setup();
  assert.equal((await line.link(env, { t: forged, email: "x@example.com", consent: true })).error, "bad_link", "署名が合わないので結ばない");
});

test("友だち追加：UTAGE へ転送し、その人専用の「メールを登録」のリンクを push で 1 通送る（返事の番号は使わない）", async () => {
  const { line, env, calls } = setup();
  const r = await line.handleWebhook(hook(follow(U1)), env, null, "college_ops");
  assert.equal(r.status, 200);
  const push = calls.find((c) => c.url.endsWith("/message/push"));
  assert.ok(push);
  assert.equal(push.body.to, U1);
  assert.equal(push.auth, "Bearer tok");
  assert.match(push.body.messages[0].text, /https:\/\/lab\.shia2n\.jp\/line-link\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}/);
  assert.ok(!calls.some((c) => c.url.endsWith("/message/reply")));
});

test("送る鍵が無いときは、リンクを送らない（受け口と転送はいつもどおり）", async () => {
  const { line, env, calls } = setup({ token: false });
  await line.handleWebhook(hook(follow(U1)), env, null, "college_ops");
  assert.equal(calls.filter((c) => c.url.includes("api.line.me")).length, 0);
});

test("リンクの頁でメールを入れると結ばれる。同じ人がもう一度入れても 1 回だけ。結ばれた人にはリンクを送り直さない", async () => {
  const { s, line, env, calls } = setup();
  const t = await linkToken(SECRET, "college_ops", U1);
  assert.equal((await line.link(env, { t, email: "a@example.com", consent: false })).error, "need_consent");
  const r = await line.link(env, { t, email: "A@example.com", name: "Aさん", consent: true });
  assert.equal(r.ok, true);
  assert.equal((await line.link(env, { t, email: "a@example.com", consent: true })).already, true);
  assert.equal(s.table("events").filter((e) => e.type === "line_linked").length, 1);
  await line.handleWebhook(hook(follow(U1)), env, null, "college_ops");
  assert.equal(calls.filter((c) => c.url.endsWith("/message/push")).length, 0, "結ばれた人には送らない");
  const f = await line.friends(env, { account: "college_ops" });
  assert.equal(f.linked, 1);
  assert.equal(f.friends[0].email, "a@example.com");
  assert.equal(f.friends[0].user, U1.slice(0, 6) + "…", "LINE の番号そのものは返さない");
});

test("送る：1 人へは push、何人かへは multicast。結ばれていない人とブロックした人には送らず数える。送った人ごとに line_sent", async () => {
  const { s, line, env, calls } = setup();
  for (const [u, e] of [[U1, "a@example.com"], [U2, "b@example.com"]]) await line.link(env, { t: await linkToken(SECRET, "college_ops", u), email: e, consent: true });
  s.table("customers").push({ id: crypto.randomUUID(), email: "c@example.com", name: "LINE なし" });
  await line.handleWebhook(hook(unfollow(U2)), env, null, "college_ops");
  const all = await line.send(env, { account: "college_ops", filter: {}, text: "お知らせです" }, "mcp");
  assert.deepEqual([all.targets, all.sent, all.not_linked, all.blocked, all.failed], [3, 1, 1, 1, 0]);
  assert.equal(calls.filter((c) => c.url.endsWith("/message/push")).at(-1).body.to, U1);
  await line.handleWebhook(hook(follow(U2)), env, null, "college_ops");
  const two = await line.send(env, { account: "college_ops", filter: { emails: ["a@example.com", "b@example.com"] }, text: "2 人へ" }, "mcp");
  assert.equal(two.sent, 2);
  assert.deepEqual(calls.find((c) => c.url.endsWith("/message/multicast")).body.to.sort(), [U1, U2].sort());
  assert.equal(s.table("events").filter((e) => e.type === "line_sent").length, 3);
});

test("LINE が誤りを返したら失敗として数え、出来事にも ok:false で残る。文が空・長すぎは送らない", async () => {
  const { s, line, env } = setup({ lineStatus: 400 });
  const id = (await line.link(env, { t: await linkToken(SECRET, "college_ops", U1), email: "a@example.com", consent: true })) && s.table("customers")[0].id;
  const r = await line.send(env, { account: "college_ops", person_id: id, text: "x" }, "mcp");
  assert.deepEqual([r.ok, r.sent, r.failed], [false, 0, 1]);
  assert.equal(s.table("events").find((e) => e.type === "line_sent").payload.ok, false);
  assert.equal((await line.send(env, { account: "college_ops", person_id: id, text: " " }, "mcp")).error, "need_text");
  assert.equal((await line.send(env, { account: "college_ops", person_id: id, text: "あ".repeat(2001) }, "mcp")).error, "too_long");
});

test("今月の送れる数と使った数", async () => {
  const { line, env } = setup();
  const q = await line.quota(env, { account: "college_ops" });
  assert.deepEqual([q.limit, q.used], [200, 12]);
  const { line: l2, env: e2 } = setup({ token: false });
  assert.equal((await l2.quota(e2, { account: "college_ops" })).error, "no_token");
});

test("権限：見る・数えるは自動、送るは承認", () => {
  assert.equal(DEFAULT_MODES.list_line_friends, "auto");
  assert.equal(DEFAULT_MODES.get_line_quota, "auto");
  assert.equal(DEFAULT_MODES.send_line, "approve");
});

// 便 14a：LINE の受け口の試験。署名を確かめる・同じ中身と署名で UTAGE へ転送・転送の失敗を数える・転送先の設定と戻し。
// 署名は LINE の公式の決まり（チャネルシークレットを鍵にした本文の HMAC-SHA256 を base64）で作り、node の crypto で答え合わせする。
// 走らせ方：node --test tests/line14a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeStore } from "./fake-store.mjs";
import { makeLine, lineSignature, secretName } from "../src/line.js";
import { DEFAULT_MODES } from "../src/guard.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const UTAGE = "https://utage-system.com/line/webhook/abcdef123";
const nodeSig = (body) => createHmac("sha256", SECRET).update(body).digest("base64");

function setup({ upstream = 200, throws = false } = {}) {
  const s = fakeStore();
  const logInbound = async (env, channel, request, response, status) => { s.table("inbound_log").push({ id: s.table("inbound_log").length + 1, channel, request, response, status, at: new Date().toISOString() }); };
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, ...init }); if (throws) throw new Error("connect refused"); return new Response("ok", { status: upstream }); };
  const changesLog = [];
  const changes = { record: async (env, c) => { changesLog.push(c); } };
  const line = makeLine({ db: s.db, logInbound, changes, fetch });
  const env = { B_STORE: true, PUBLIC_ORIGIN: "https://lab.shia2n.jp", [secretName("college_ops")]: SECRET };
  return { s, line, env, calls, changesLog };
}

function lineRequest(body, sig) {
  return new Request("https://lab.shia2n.jp/api/line/webhook/college_ops", { method: "POST", body, headers: { "content-type": "application/json", "x-line-signature": sig } });
}
const BODY = JSON.stringify({ destination: "Uabc", events: [
  { type: "follow", timestamp: 1760000000000, webhookEventId: "01H1", source: { type: "user", userId: "U111" }, replyToken: "r1", mode: "active" },
  { type: "message", timestamp: 1760000001000, webhookEventId: "01H2", source: { type: "user", userId: "U111" }, replyToken: "r2", message: { type: "text", id: "m1", text: "こんにちは" } },
] });

test("署名の作り方は LINE の決まり（node の HMAC と一致）", async () => {
  assert.equal(await lineSignature(SECRET, BODY), nodeSig(BODY));
});

test("正しい署名：すぐ 200 を返し、同じ中身と同じ署名で UTAGE へ転送し、line として 1 行残る", async () => {
  const { s, line, env, calls } = setup();
  await line.setForward(env, { account: "college_ops", url: UTAGE }, "mcp");
  const waits = [];
  const r = await line.handleWebhook(lineRequest(BODY, nodeSig(BODY)), env, { waitUntil: (p) => waits.push(p) }, "college_ops");
  assert.equal(r.status, 200);
  await Promise.all(waits);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, UTAGE);
  assert.equal(calls[0].body, BODY, "中身は 1 字も変えない");
  assert.equal(calls[0].headers["x-line-signature"], nodeSig(BODY), "署名もそのまま");
  const logs = s.table("inbound_log").filter((x) => x.channel === "line");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].request.account, "college_ops");
  assert.equal(logs[0].request.events[1].message.text, "こんにちは");
  assert.equal(logs[0].request.events[0].source.user, "U111");
});

test("署名が違う：401 で転送しない。line_bad_signature に残る", async () => {
  const { s, line, env, calls } = setup();
  await line.setForward(env, { account: "college_ops", url: UTAGE }, "mcp");
  const r = await line.handleWebhook(lineRequest(BODY, nodeSig(BODY + "x")), env, null, "college_ops");
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
  assert.equal(s.table("inbound_log").filter((x) => x.channel === "line_bad_signature").length, 1);
});

test("秘密の値が無いアカウント：503 で止まる（署名を確かめられないので転送しない）", async () => {
  const { line, env, calls } = setup();
  const r = await line.handleWebhook(lineRequest(BODY, nodeSig(BODY)), env, null, "shianin");
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test("転送の失敗（UTAGE が 500・つながらない・転送先なし）は line_forward_failed に残り、list_line_inbound で数えられる", async () => {
  for (const [opt, setUrl, want] of [[{ upstream: 500 }, true, 500], [{ throws: true }, true, 0], [{}, false, 0]]) {
    const { s, line, env } = setup(opt);
    if (setUrl) await line.setForward(env, { account: "college_ops", url: UTAGE }, "mcp");
    const r = await line.handleWebhook(lineRequest(BODY, nodeSig(BODY)), env, null, "college_ops");
    assert.equal(r.status, 200, "LINE には 200（転送の失敗で LINE を待たせない）");
    const f = s.table("inbound_log").filter((x) => x.channel === "line_forward_failed");
    assert.equal(f.length, 1);
    assert.equal(f[0].response.forward.status, want);
    const c = await line.inbound(env, {});
    assert.equal(c.forward_failed, 1);
    assert.equal(c.accounts[0].forward_failed, 1);
    assert.equal(c.accounts[0].failures.length, 1);
  }
});

test("数え：受けた回数・転送できた数・友だち追加・メッセージ・人の数", async () => {
  const { line, env } = setup();
  await line.setForward(env, { account: "college_ops", url: UTAGE }, "mcp");
  await line.handleWebhook(lineRequest(BODY, nodeSig(BODY)), env, null, "college_ops");
  await line.handleWebhook(lineRequest(BODY, nodeSig(BODY)), env, null, "college_ops");
  const c = await line.inbound(env, { account: "college_ops" });
  const a = c.accounts[0];
  assert.deepEqual([a.received, a.forwarded, a.forward_failed, a.events, a.follows, a.messages, a.people], [2, 2, 0, 4, 2, 2, 1]);
});

test("転送先の設定：B 自身の住所・http・変な名前は弾く。入れた・外したは変えた記録に残り、設定に B の受け口の住所が出る", async () => {
  const { line, env, changesLog } = setup();
  assert.equal((await line.setForward(env, { account: "college_ops", url: "https://lab.shia2n.jp/api/line/webhook/college_ops" }, "mcp")).error, "loop");
  assert.equal((await line.setForward(env, { account: "college_ops", url: "http://utage-system.com/x" }, "mcp")).error, "bad_url");
  assert.equal((await line.setForward(env, { account: "College", url: UTAGE }, "mcp")).error, "bad_account");
  const r = await line.setForward(env, { account: "college_ops", url: UTAGE }, "mcp");
  assert.equal(r.ok, true);
  assert.equal(r.forward_host, "utage-system.com");
  assert.equal(r.webhook_url, "https://lab.shia2n.jp/api/line/webhook/college_ops");
  assert.equal(r.secret_set, true);
  const s2 = await line.settings(env, { account: "shianin" });
  assert.equal(s2.accounts.length, 2);
  assert.equal(s2.accounts.find((x) => x.account === "shianin").secret_set, false);
  assert.ok(!JSON.stringify(s2).includes("abcdef123"), "転送先の住所そのものは返さない");
  await line.setForward(env, { account: "college_ops", url: "" }, "mcp");
  assert.deepEqual(changesLog.map((c) => [c.target, c.after]), [["line_forward_college_ops", UTAGE], ["line_forward_college_ops", ""]]);
});

test("権限の最初の値：見る・数えるは自動、転送先を変えるのは承認", () => {
  assert.equal(DEFAULT_MODES.get_line_settings, "auto");
  assert.equal(DEFAULT_MODES.list_line_inbound, "auto");
  assert.equal(DEFAULT_MODES.set_line_forward, "approve");
});

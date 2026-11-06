// 便 L2（2026-11-06 Naoki OK 23:40）：LINE のキーワードの自動応答とテンプレートの試験。
// 下書きは返さない・有効なものを並び順に見て最初に合った 1 件だけ返す・返事の番号で返す（使えなければ push）・テンプレートを読む・UTAGE への転送は今までどおり。
// 走らせ方：node --test tests/line-l2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeStore } from "./fake-store.mjs";
import { makeLine, secretName, tokenName, matchReply, checkMessages, toLineMessages } from "../src/line.js";
import { DEFAULT_MODES } from "../src/guard.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const U1 = "U" + "a".repeat(32);
const sig = (b) => createHmac("sha256", SECRET).update(b).digest("base64");

function setup({ token = true, replyStatus = 200 } = {}) {
  const s = fakeStore();
  const logInbound = async (env, channel, request, response, status) => { s.table("inbound_log").push({ id: s.table("inbound_log").length + 1, channel, request, response, status, at: new Date().toISOString() }); };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith("https://utage")) return new Response("ok");
    if (url.endsWith("/message/reply") && replyStatus !== 200) return Response.json({ message: "Invalid reply token" }, { status: replyStatus });
    return Response.json({});
  };
  const line = makeLine({ db: s.db, logInbound, changes: null, addEvent: async () => {}, registerPerson: async () => ({ ok: false }), audience: async () => ({ people: [] }), fetch });
  const env = { [secretName("shianin")]: SECRET, ...(token ? { [tokenName("shianin")]: "tok" } : {}) };
  return { s, line, env, calls };
}
const hook = (text, replyToken = "rt1") => {
  const body = JSON.stringify({ destination: "Ux", events: [{ type: "message", replyToken, timestamp: Date.now(), source: { type: "user", userId: U1 }, message: { type: "text", id: "1", text } }] });
  return new Request("https://lab.shia2n.jp/api/line/webhook/shianin", { method: "POST", body, headers: { "x-line-signature": sig(body) } });
};

test("決まり：all は同じ文、part は文に入っている。前後の空白は見ない。並び順で最初の 1 件。無効は見ない", () => {
  const rows = [
    { id: 1, active: false, match: "all", keywords: ["おみくじ"] },
    { id: 2, active: true, match: "part", keywords: ["言語化"] },
    { id: 3, active: true, match: "all", keywords: ["おみくじ", "大吉"] },
  ];
  assert.equal(matchReply(rows, " おみくじ ").id, 3);
  assert.equal(matchReply(rows, "おみくじください"), null, "all は文がちがえば返さない");
  assert.equal(matchReply(rows, "言語化動画ください").id, 2);
  assert.equal(matchReply(rows, ""), null);
});

test("吹き出しの確かめ：1〜5 つ・文か https の画像だけ。LINE の形に直す", () => {
  assert.equal(checkMessages([]).error, "need_messages");
  assert.equal(checkMessages(Array(6).fill({ type: "text", text: "a" })).error, "too_many_messages");
  assert.equal(checkMessages([{ type: "image", url: "http://x.jp/a.png" }]).error, "bad_image_url");
  assert.equal(checkMessages([{ type: "video", url: "https://x.jp/a.mp4" }]).error, "bad_message_type");
  const ok = checkMessages([{ type: "text", text: " こんにちは\r\nどうぞ " }, { type: "image", url: "https://x.jp/a.png" }]);
  assert.deepEqual(ok.messages[0], { type: "text", text: "こんにちは\nどうぞ" });
  assert.deepEqual(toLineMessages(ok.messages)[1], { type: "image", originalContentUrl: "https://x.jp/a.png", previewImageUrl: "https://x.jp/a.png" });
});

test("作ったものは下書き：キーワードを送っても返さない。UTAGE への転送は今までどおり", async () => {
  const { s, line, env, calls } = setup();
  s.table("settings").push({ key: "line_forward_shianin", value: "https://utage-system.com/line/webhook/x" });
  const r = await line.saveReply(env, { account: "shianin", name: "おみくじ", keywords: ["おみくじ"], messages: [{ type: "text", text: "大吉！" }], source: "utage:saLq" }, "mcp");
  assert.equal(r.ok, true); assert.equal(r.created, true); assert.equal(r.active, false);
  await line.handleWebhook(hook("おみくじ"), env, null, "shianin");
  assert.equal(calls.filter((c) => c.url.includes("api.line.me")).length, 0, "下書きは返さない");
  assert.ok(calls.some((c) => c.url.startsWith("https://utage")), "UTAGE へは転送する");
});

test("有効にすると返事の番号で返す（送信数を使わない）。返した回数と記録が残る", async () => {
  const { s, line, env, calls } = setup();
  const { id } = await line.saveReply(env, { account: "shianin", keywords: ["おみくじ"], messages: [{ type: "text", text: "大吉！" }] }, "mcp");
  assert.equal((await line.setReplyActive(env, { account: "shianin", ids: [id], active: true }, "mcp")).changed, 1);
  await line.handleWebhook(hook("おみくじ"), env, null, "shianin");
  const rep = calls.find((c) => c.url.endsWith("/message/reply"));
  assert.ok(rep); assert.equal(rep.body.replyToken, "rt1"); assert.equal(rep.body.messages[0].text, "大吉！");
  assert.ok(!calls.some((c) => c.url.endsWith("/message/push")));
  assert.equal(s.table("b_line_replies")[0].hits, 1);
  assert.equal(s.table("inbound_log").filter((x) => x.channel === "line_autoreply").length, 1);
  const l = await line.listReplies(env, { account: "shianin" });
  assert.equal(l.active, 1); assert.equal(l.replies[0].hits, 1);
});

test("返事の番号がもう使われていたら push で返す", async () => {
  const { line, env, calls } = setup({ replyStatus: 400 });
  const { id } = await line.saveReply(env, { account: "shianin", keywords: ["添削希望"], messages: [{ type: "text", text: "こちらから" }] }, "mcp");
  await line.setReplyActive(env, { account: "shianin", ids: [id], active: true }, "mcp");
  await line.handleWebhook(hook("添削希望"), env, null, "shianin");
  const p = calls.find((c) => c.url.endsWith("/message/push"));
  assert.ok(p); assert.equal(p.body.to, U1);
});

test("テンプレート：応答がテンプレートを読む。使われているテンプレートは消せない。有効な応答は消せない", async () => {
  const { line, env, calls } = setup();
  const t = await line.saveTemplate(env, { account: "shianin", name: "特典", messages: [{ type: "text", text: "特典です" }, { type: "image", url: "https://x.jp/a.png" }] }, "mcp");
  assert.equal(t.ok, true);
  const { id } = await line.saveReply(env, { account: "shianin", keywords: ["特典"], template_id: t.id }, "mcp");
  await line.setReplyActive(env, { account: "shianin", ids: [id], active: true }, "mcp");
  await line.handleWebhook(hook("特典"), env, null, "shianin");
  const rep = calls.find((c) => c.url.endsWith("/message/reply"));
  assert.equal(rep.body.messages.length, 2); assert.equal(rep.body.messages[1].type, "image");
  assert.equal((await line.saveTemplate(env, { account: "shianin", id: t.id, remove: true }, "mcp")).error, "in_use");
  assert.equal((await line.saveReply(env, { account: "shianin", id, remove: true }, "mcp")).error, "active");
  assert.deepEqual((await line.listTemplates(env, { account: "shianin" })).templates[0].used_by, ["特典"]);
});

test("重なり：ほかの有効な応答と同じキーワードを持つと overlap で知らせる。鍵が無いと有効にできない", async () => {
  const { line, env } = setup();
  const a = await line.saveReply(env, { account: "shianin", name: "A", keywords: ["壁打ち"], messages: [{ type: "text", text: "a" }] }, "mcp");
  await line.setReplyActive(env, { account: "shianin", ids: [a.id], active: true }, "mcp");
  const b = await line.saveReply(env, { account: "shianin", name: "B", keywords: ["壁打ち", "壁うち"], messages: [{ type: "text", text: "b" }] }, "mcp");
  assert.deepEqual(b.overlap, ["A"]);
  const n = setup({ token: false });
  const c = await n.line.saveReply(n.env, { account: "shianin", keywords: ["x"], messages: [{ type: "text", text: "x" }] }, "mcp");
  assert.equal((await n.line.setReplyActive(n.env, { account: "shianin", ids: [c.id], active: true }, "mcp")).error, "no_token");
});

test("権限の最初の値：読む・下書きは自動、有効にする・テンプレートを直すは承認", () => {
  assert.equal(DEFAULT_MODES.list_line_replies, "auto");
  assert.equal(DEFAULT_MODES.save_line_reply, "auto");
  assert.equal(DEFAULT_MODES.set_line_reply_active, "approve");
  assert.equal(DEFAULT_MODES.list_line_templates, "auto");
  assert.equal(DEFAULT_MODES.save_line_template, "approve");
});

test("リッチメニューを読む：いつも出るもの・UTAGE の住所・postback を数える", async () => {
  const s = fakeStore();
  const fetch = async (url) => {
    if (url.endsWith("/richmenu/list")) return Response.json({ richmenus: [
      { richMenuId: "richmenu-a", name: "A", chatBarText: "メニュー", size: { width: 2500, height: 1686 }, selected: true, areas: [
        { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: "uri", uri: "https://utage-system.com/p/xx" } },
        { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: "postback", data: "a=1" } },
        { bounds: { x: 0, y: 843, width: 2500, height: 843 }, action: { type: "uri", uri: "https://lab.shia2n.jp/" } } ] },
      { richMenuId: "richmenu-b", name: "B", chatBarText: "B", size: { width: 2500, height: 843 }, selected: false, areas: [] } ] });
    if (url.endsWith("/user/all/richmenu")) return Response.json({ richMenuId: "richmenu-a" });
    return Response.json({});
  };
  const line = makeLine({ db: s.db, logInbound: async () => {}, changes: null, addEvent: async () => {}, registerPerson: async () => ({}), audience: async () => ({ people: [] }), fetch });
  const r = await line.richMenus({ [tokenName("shianin")]: "tok" }, { account: "shianin" });
  assert.equal(r.count, 2); assert.equal(r.default_id, "richmenu-a");
  const a = r.menus.find((m) => m.id === "richmenu-a");
  assert.equal(a.is_default, true); assert.equal(a.utage_links, 1); assert.equal(a.postbacks, 1);
  assert.equal((await line.richMenus({}, { account: "shianin" })).error, "no_token");
  assert.equal(DEFAULT_MODES.list_line_richmenus, "auto");
});

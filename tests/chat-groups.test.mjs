// チャットの便 C2b：グループ（作る・送る・スレッド・スタンプ・既読・見える範囲・画像・通知）
// 走らせ方：node --test tests/chat-groups.test.mjs（見本 https://claude.ai/artifact/Rpu6FQZSs76gixu6VDeQ2w・Naoki OK 12:48）
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeGroups, buildView, groupName, REACTIONS } from "../src/groups.js";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
function setup() {
  const s = fakeStore();
  s.table("customer_summary").push({ id: A, name: "佐藤", email: "a@x" }, { id: B, name: "", email: "mori@x" }, { id: C, name: "伊藤", email: "c@x" });
  const pushed = [];
  const push = { sendTo: async (env, c, m) => pushed.push(["student", c, m]), send: async (env, m) => pushed.push(["admin", null, m]) };
  const g = makeGroups({ db: s.db, push, logInbound: async () => {}, names: async () => ({ byEmail: new Map([["mori@x", "森（呼び名）"]]) }) });
  return { s, g, pushed };
}

test("名前：1〜40 字（空白はそろえる）・スタンプは 6 つ", () => {
  assert.equal(groupName("  NEXT   12月 "), "NEXT 12月");
  assert.equal(groupName(""), null);
  assert.equal(groupName("あ".repeat(41)), null);
  assert.equal(REACTIONS.length, 6);
});

test("作る・送る：入っていない人は送れない。シアニンが送ると入っている全員に通知。生徒が送るとシアニンにも通知", async () => {
  const { g, pushed } = setup();
  const c = await g.create({}, { name: "NEXT", member_ids: [A, B] }, "n@x");
  assert.ok(c.ok);
  const id = c.group.id;
  assert.equal((await g.post({}, { group_id: id, text: "お題です" }, g.CYANIN, "admin")).notified, 2);
  assert.equal((await g.post({}, { group_id: id, text: "入っていない" }, C, "site")).error, "not_member");
  pushed.length = 0;
  assert.equal((await g.post({}, { group_id: id, text: "答えます" }, A, "site")).notified, 1); // B だけ
  assert.deepEqual(pushed.map((p) => p[0]), ["student", "admin"]);
  assert.equal(pushed[0][1], B);
  assert.match(pushed[1][2].body, /^佐藤：/);
});

test("スレッド：返信は元のメッセージの中に入る。通知は元の発言者とそのスレッドで話した人だけ。本流にも流せる", async () => {
  const { g, pushed } = setup();
  const id = (await g.create({}, { name: "NEXT", member_ids: [A, B, C] })).group.id;
  const root = (await g.post({}, { group_id: id, text: "1 行で言うと" }, A, "site")).id;
  pushed.length = 0;
  await g.post({}, { group_id: id, text: "いいですね", thread_of: root }, B, "site");
  assert.deepEqual(pushed.filter((p) => p[0] === "student").map((p) => p[1]), [A]); // C には届かない
  const r2 = await g.post({}, { group_id: id, text: "全体にも", thread_of: root, also_main: true }, g.CYANIN, "admin");
  assert.ok(r2.ok);
  const v = await g.get({}, { group_id: id });
  assert.equal(v.messages.length, 2); // 元のメッセージと、本流に流した 1 通
  assert.equal(v.messages[0].reply_count, 2);
  assert.deepEqual(v.messages[0].repliers.map((x) => x.name), ["森（呼び名）", "シアニン"]);
  assert.equal((await g.post({}, { group_id: id, text: "孫", thread_of: v.messages[0].replies[0].id }, A, "site")).error, "bad_thread");
});

test("スタンプ：同じ人の同じスタンプは押すと外れる。知らないスタンプは断る", async () => {
  const { g } = setup();
  const id = (await g.create({}, { name: "NEXT", member_ids: [A, B] })).group.id;
  const m = (await g.post({}, { group_id: id, text: "お題" }, g.CYANIN, "admin")).id;
  assert.equal((await g.react({}, { group_id: id, message_id: m, emoji: "👍" }, A)).on, true);
  assert.equal((await g.react({}, { group_id: id, message_id: m, emoji: "👍" }, B)).on, true);
  assert.equal((await g.react({}, { group_id: id, message_id: m, emoji: "👍" }, A)).on, false);
  assert.equal((await g.react({}, { group_id: id, message_id: m, emoji: "💩" }, A)).error, "bad_emoji");
  const v = await g.view({}, { group_id: id }, B);
  assert.deepEqual(v.messages[0].reactions.map((r) => [r.emoji, r.count, r.mine]), [["👍", 1, true]]);
});

test("見える範囲：入っていないグループは読めない。抜けた人も読めない。メールは返さない。読んだ数と一覧の未読", async () => {
  const { g } = setup();
  const id = (await g.create({}, { name: "NEXT", member_ids: [A, B] })).group.id;
  await g.post({}, { group_id: id, text: "お題" }, g.CYANIN, "admin");
  assert.equal((await g.view({}, { group_id: id }, C)).error, "not_found");
  let mine = await g.mine({}, B);
  assert.equal(mine.unread, 1);
  await g.markRead({}, { group_id: id }, B);
  mine = await g.mine({}, B);
  assert.equal(mine.unread, 0);
  const v = await g.view({}, { group_id: id }, A);
  assert.equal(v.messages[0].read, 1); // B が読んだ
  assert.ok(!JSON.stringify(v).includes("@x"));
  await g.update({}, { group_id: id, remove_ids: [B] }, "n@x");
  assert.equal((await g.view({}, { group_id: id }, B)).error, "not_found");
  assert.equal((await g.mine({}, B)).groups.length, 0);
  // シアニンの一覧：生徒の発言だけを未読に数える
  await g.post({}, { group_id: id, text: "質問" }, A, "site");
  const l = await g.list({});
  assert.equal(l.groups[0].unread_for_admin, 1);
  assert.equal(l.groups[0].members, 1);
  await g.get({}, { group_id: id, mark_read: true });
  assert.equal((await g.list({})).groups[0].unread_for_admin, 0);
});

test("画像：そのグループのメッセージに載っていて、見る人が入っているときだけ見せる。閉じたグループには送れない", async () => {
  const { g } = setup();
  const id = (await g.create({}, { name: "NEXT", member_ids: [A, B] })).group.id;
  const key = `room/${A}/${"9".repeat(8)}-0000-4000-8000-000000000000.jpg`;
  await g.post({}, { group_id: id, text: "", images: [key] }, A, "site");
  assert.equal(await g.imageAllowed({}, { group_id: id, key }, B), true);
  assert.equal(await g.imageAllowed({}, { group_id: id, key }, C), false);
  assert.equal(await g.imageAllowed({}, { group_id: id, key: key.replace("jpg", "png") }, B), false);
  await g.update({}, { group_id: id, close: true }, "n@x");
  assert.equal((await g.post({}, { group_id: id, text: "x" }, A, "site")).error, "not_found");
  assert.equal((await g.list({})).groups.length, 0);
});

test("表がまだ無い置き場：一覧は空で返し、作るは need_sql", async () => {
  const db = async () => { throw new Error("PGRST205 Could not find the table"); };
  const g = makeGroups({ db, push: null, logInbound: async () => {} });
  assert.deepEqual((await g.list({})).groups, []);
  assert.equal((await g.list({})).note, "need_sql");
  assert.equal((await g.create({}, { name: "x" })).error, "need_sql");
  assert.equal((await g.mine({}, A)).groups.length, 0);
});

// チャットの便 C2b-2：名前の 3 種類（本名・ニックネーム・LINE 名）。グループではほかの生徒にニックネームだけ
// 走らせ方：node --test tests/chat-names.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeNames, nickOk, NICK_KEY } from "../src/names.js";
import { makeGroups } from "../src/groups.js";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
function setup() {
  const s = fakeStore();
  s.table("customer_summary").push({ id: A, name: "佐藤 美咲", email: "a@x" }, { id: B, name: "森 拓也", email: "b@x" });
  const nicks = makeNames({ db: s.db });
  const pushed = [];
  const g = makeGroups({ db: s.db, push: { sendTo: async (e, c, m) => pushed.push(["s", c, m]), send: async (e, m) => pushed.push(["a", m]) }, logInbound: async () => {}, nicks });
  return { s, nicks, g, pushed };
}

test("ニックネームの形：20 字まで・メールと < > は断る・空は消す", () => {
  assert.equal(nickOk("  みさき  "), "みさき");
  assert.equal(nickOk(""), "");
  assert.equal(nickOk("あ".repeat(21)), null);
  assert.equal(nickOk("a@b.jp"), null);
  assert.equal(nickOk("<b>"), null);
});

test("決める・直す・消す。項目 nickname が無ければ作る", async () => {
  const { s, nicks } = setup();
  assert.ok((await nicks.setNickname({}, A, "みさき")).ok);
  assert.ok(s.table("b_fields").some((f) => f.key === NICK_KEY));
  assert.equal(await nicks.nickname({}, A), "みさき");
  await nicks.setNickname({}, A, "みーちゃん");
  assert.equal(await nicks.nickname({}, A), "みーちゃん");
  assert.equal(s.table("b_person_values").filter((r) => r.customer_id === A).length, 1);
  await nicks.setNickname({}, A, "");
  assert.equal(await nicks.nickname({}, A), "");
  assert.equal((await nicks.setNickname({}, A, "x@y.jp")).error, "bad_nickname");
});

test("グループ：ニックネームを決めるまで送れない。生徒の画面ではほかの人はニックネームだけ・シアニンの画面では「ニックネーム（本名）」", async () => {
  const { g, nicks, pushed } = setup();
  const id = (await g.create({}, { name: "NEXT", member_ids: [A, B] })).group.id;
  assert.equal((await g.post({}, { group_id: id, text: "こんにちは" }, A, "site")).error, "need_nickname");
  await nicks.setNickname({}, A, "みさき");
  pushed.length = 0;
  assert.ok((await g.post({}, { group_id: id, text: "こんにちは" }, A, "site")).ok);
  assert.match(pushed.find((p) => p[0] === "s")[2].body, /^みさき：/); // 生徒への通知もニックネーム
  assert.match(pushed.find((p) => p[0] === "a")[1].body, /^みさき（佐藤 美咲）：/);
  const v = await g.view({}, { group_id: id }, B);
  assert.equal(v.messages[0].name, "みさき");
  assert.ok(!JSON.stringify(v).includes("佐藤"));
  assert.equal(v.members, 2);
  assert.equal(v.me.nickname, "");
  const mine = await g.mine({}, B);
  assert.equal(mine.groups[0].last_name, "みさき");
  const adm = await g.get({}, { group_id: id });
  assert.equal(adm.messages[0].name, "みさき（佐藤 美咲）");
  assert.deepEqual(adm.members.map((m) => m.name), ["みさき（佐藤 美咲）", "森 拓也"]);
});

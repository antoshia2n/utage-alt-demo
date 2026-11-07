// チャットの便 C3：AI タブ（材料の作り方・頼み方・言い換え・AI が無いとき）
// 走らせ方：node --test tests/chat-ai.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChatAi, contextOfChat, contextOfGroup, promptFor, parseWords, jst, AI_MODEL } from "../src/chatai.js";

const P = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const chatGet = { ok: true, found: true, names: { real: "佐藤 美咲", nickname: "みさき" }, card: { name: "佐藤 美咲", stage: "受講中", entitlements: [{ key: "shiarabo_basic" }] },
  messages: [{ id: 5, kind: "chat", from: "student", at: "2026-11-07T00:00:00Z", text: "目標が多すぎますか？", images: [] }, { id: 7, kind: "correction", from: "student", at: "2026-11-07T01:00:00Z", text: "プロフィール", replied: false }],
  notes: [{ id: 6, at: "2026-11-07T00:30:00Z", text: "面談で絞る" }], history: [{ at: "2026-11-06T00:00:00Z", cat: "学習", type: "lesson_viewed" }] };
const grpGet = { ok: true, found: true, group: { name: "NEXT" }, members: [{ name: "みさき（佐藤 美咲）" }], messages: [{ id: 1, at: "2026-11-07T00:00:00Z", name: "シアニン", text: "お題", images: [], replies: [{ id: 2, at: "2026-11-07T00:10:00Z", name: "みさき（佐藤 美咲）", text: "答え" }] }] };

test("材料：日本時間・#番号・古い順・メモは生徒に見えないと書く・未返信の添削・スレッドは字下げ", () => {
  assert.equal(jst("2026-11-07T00:00:00Z"), "11/7 09:00");
  const c = contextOfChat(chatGet);
  assert.match(c.title, /みさきさん/);
  assert.match(c.head, /本名 佐藤 美咲/);
  const lines = c.body.split("\n");
  assert.deepEqual(lines.map((l) => l.match(/#(\d+)/)[1]), ["5", "6", "7"]);
  assert.match(lines[1], /生徒には見えない/);
  assert.match(lines[2], /未返信/);
  const g = contextOfGroup(grpGet);
  assert.match(g.body, /\n    ↳ .*#2 みさき/);
});

test("頼み方：モードごとのお願いが入る。分析は元のメッセージを入れる", () => {
  const ctx = contextOfChat(chatGet);
  assert.match(promptFor("draft", ctx)[1].content, /下書き/);
  assert.match(promptFor("gaps", ctx)[1].content, /まだ答えていない/);
  assert.match(promptFor("free", ctx, { question: "止まっている理由" })[1].content, /止まっている理由/);
  assert.match(promptFor("message", ctx, { message: { id: 5, text: "目標が多すぎますか？" } })[1].content, /#5[\s\S]*目標が多すぎますか/);
  assert.equal(promptFor("summary", ctx)[0].role, "system");
});

test("言い換え：JSON でも「・」の並びでも読む。元の言葉が先頭・6 つまで・同じものは 1 つ", () => {
  assert.deepEqual(parseWords('はい ["目標","ゴール","目標"]', "目標"), ["目標", "ゴール"]);
  assert.deepEqual(parseWords("・ゴール\n・数字\n・KPI", "目標"), ["目標", "ゴール", "数字", "KPI"]);
  assert.equal(parseWords('["a","b","c","d","e","f","g"]', "q").length, 6);
});

test("頼む：AI に材料を渡して答えを返す。記号を落とす。AI が無ければ no_ai。知らないモード・空の質問は断る", async () => {
  let seen = null;
  const env = { AI: { run: async (model, input) => { seen = { model, input }; return { response: "**要約**\n# 見出し\n・目標を絞る" }; } } };
  const logs = [];
  const ai = makeChatAi({ chat: { get: async () => chatGet }, groups: { get: async () => grpGet }, logInbound: async (...a) => logs.push(a) });
  const r = await ai.ask(env, { person_id: P, mode: "summary" });
  assert.ok(r.ok);
  assert.equal(seen.model, AI_MODEL);
  assert.equal(r.text, "要約\n見出し\n・目標を絞る");
  assert.ok(!JSON.stringify(logs).includes("目標が多すぎますか")); // 記録に中身を残さない
  assert.equal((await ai.ask({}, { person_id: P, mode: "summary" })).error, "no_ai");
  assert.equal((await ai.ask(env, { person_id: P, mode: "x" })).error, "bad_mode");
  assert.equal((await ai.ask(env, { person_id: P, mode: "free", question: " " })).error, "need_question");
  assert.equal((await ai.ask(env, { person_id: P, mode: "message", message_id: 99 })).error, "message_not_found");
  assert.ok((await ai.ask(env, { group_id: G, mode: "message", message_id: 2 })).ok);
});

test("言い換えて探す：広げた言葉ごとに探し、同じものは 1 つ・新しい順。AI が使えなければ元の言葉だけ", async () => {
  const calls = [];
  const chat = { search: async (env, { q }) => { calls.push(q); return { hits: q === "目標" ? [{ person_id: P, event_id: 1, at: "2026-11-01", text: "目標" }] : [{ person_id: P, event_id: 1, at: "2026-11-01", text: "目標" }, { group_id: G, event_id: 3, at: "2026-11-05", text: "ゴール" }] }; } };
  const ai = makeChatAi({ chat, groups: {}, logInbound: async () => {} });
  const r = await ai.search({ AI: { run: async () => ({ response: '["ゴール"]' }) } }, { q: "目標" });
  assert.deepEqual(r.words, ["目標", "ゴール"]);
  assert.deepEqual(r.hits.map((h) => h.event_id), [3, 1]);
  const r2 = await ai.search({}, { q: "目標" });
  assert.deepEqual(r2.words, ["目標"]);
  assert.equal(r2.note, "no_ai");
});

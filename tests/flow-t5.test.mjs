// 便 T5（2026-11-08 Naoki OK 09:23）：シナリオの「流れ」と AI と作るの試験。
// 走らせ方：node --test tests/flow-t5.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeStore } from "./fake-store.mjs";
import { makeFlow, todosOf, delayText } from "../src/flow.js";
import { DEFAULT_MODES } from "../src/guard.js";

const CAMP = "7c7133b4-68ca-4bb1-bea8-4032e0a5e240";
const PAGE = "5de23937-79e8-4dd4-9499-84da3d80f167";
const env = { B_STORE: true };

function setup({ approvals = [] } = {}) {
  const s = fakeStore();
  s.table("b_steps").push(
    { id: 13, name: "LINE 1日後", trigger: "line_linked", trigger_args: { account: "shianin" }, delay_hours: 24, action: "send_line", action_args: { account: "shianin" }, body: "【下書き・1日後】\n（価値提供の本文）\nhttps://lp.shia2n.jp/blog", subject: "", selector: { emails: ["t@example.com"] }, active: true },
    { id: 12, name: "LINE 登録直後", trigger: "line_linked", trigger_args: { account: "shianin" }, delay_hours: 0, action: "send_line", action_args: { account: "shianin" }, body: "ようこそ\n（特典の中身と受け取り方は Naoki が決めて入れる）", subject: "", selector: { emails: ["t@example.com"] }, active: true },
  );
  s.table("b_forms").push({ id: "f1", slug: "x-roadmap", title: "メール登録", intro: "お知らせを受け取れます", thanks: "ありがとう", active: true });
  s.table("b_campaigns").push({ id: CAMP, name: "2026-11 X収益化ロードマップ動画企画" });
  const plan = { blueprint: async () => ({ ok: true, lanes: [{ id: "meet", label: "集客" }, { id: "signup", label: "リストイン" }, { id: "warm", label: "アプローチ" }],
    campaigns: [{ id: CAMP, name: "2026-11 X収益化ロードマップ動画企画", starts_on: null }],
    parts: [
      { key: "step:13", type: "step", id: "13", lane: "warm", name: "LINE 1日後", state: "running", campaigns: [{ id: CAMP }] },
      { key: "step:12", type: "step", id: "12", lane: "warm", name: "LINE 登録直後", state: "running", campaigns: [{ id: CAMP }] },
      { key: "form:f1", type: "form", id: "f1", lane: "signup", name: "メール登録", state: "running", outside: true, campaigns: [] },
      { key: `page:${PAGE}`, type: "page", id: PAGE, lane: "meet", name: "動画のページ", state: "draft", url: "https://lp.shia2n.jp/x-roadmap", campaigns: [{ id: CAMP }] },
    ] }) };
  const guard = { listApprovals: async () => ({ ok: true, approvals }) };
  let invite = "";
  const line = { inviteText: async () => ({ text: invite }), setInviteText: async (e, { text }) => { invite = text; return { ok: true }; } };
  const pages = { getPage: async () => ({ ok: true, found: true, page: { id: PAGE, status: "draft", closes_at: null }, html: "<h1>動画</h1><p class=\"lead\">（リード文：誰が・何を見ると・どうなれるか。Naoki が入れる）</p><div>（ここに動画を入れる：YouTube の限定公開の住所。Naoki が入れる）</div>" }) };
  const saved = [];
  const fl = makeFlow({ db: s.db, plan, guard, line, pages, setStepBody: async (e, id, body) => { saved.push([id, body]); const r = s.table("b_steps").find((x) => x.id === id); r.body = body; return { ok: true }; } });
  return { ...s, fl, saved, getInvite: () => invite };
}

test("配信タイミングの言い方：直後・◯日後・◯日 ◯時間後・◯時間後", () => {
  assert.equal(delayText(0), "直後");
  assert.equal(delayText(48), "2日後");
  assert.equal(delayText(30), "1日 6時間後");
  assert.equal(delayText(5), "5時間後");
});

test("「Naoki が作るもの」：文と HTML の中の「Naoki が〜」と空欄の行を拾う", () => {
  assert.deepEqual(todosOf("本文\n（価値提供の本文）\nhttps://x"), ["価値提供の本文"]);
  assert.deepEqual(todosOf("（特典の中身と受け取り方は Naoki が決めて入れる）"), ["特典の中身と受け取り方"]);
  const t = todosOf("<p>（リード文：誰が・何を見ると・どうなれるか。Naoki が入れる）</p><style>.a{}</style>");
  assert.equal(t.length, 1);
  assert.match(t[0], /^リード文/);
  assert.deepEqual(todosOf("ふつうの文（かっこつき）です"), []);
});

test("流れ：相手が通る順（ページ → フォーム → 友だち追加の案内 → 配信タイミングの順の LINE）に並ぶ", async () => {
  const st = setup();
  const r = await st.fl.flow(env, { campaign_id: CAMP });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.cards.map((c) => c.key), [`page:${PAGE}`, "form:f1", "line_invite:shianin", "step:12", "step:13"]);
  const s13 = r.cards.find((c) => c.key === "step:13");
  assert.equal(s13.when, "LINE 連携（シアニン）から 1日後");
  assert.equal(s13.state, "test");
  assert.equal(s13.audience, "テスト配信（1 人）");
  assert.equal(r.cards[0].todos.length, 2, "ページの空欄 2 つ");
  assert.equal(r.cards.find((c) => c.key === "form:f1").note, "シナリオに未追加（設計図から追加できます）");
  assert.equal(r.cards.find((c) => c.key === "line_invite:shianin").uses_default, true);
  assert.equal(r.counts.todo, 4);
  assert.equal(r.cards.find((c) => c.key === "step:12").ai_ok, true);
  assert.equal(r.cards[0].ai_ok, false, "ページは AI と作るの対象外（ページの依頼から作る）");
});

test("承認待ちは、そのカードに付く（ステップの変更・ブロックの配信開始・案内の文）。関係ないものは件数だけ", async () => {
  const st = setup({ approvals: [
    { id: "a1", tool: "set_step", args: { id: 13, body: "新しい本文" }, created_at: "2026-11-08T00:00:00Z" },
    { id: "a2", tool: "publish_block", args: { step_ids: [12, 13] } },
    { id: "a3", tool: "set_line_invite", args: { account: "shianin", text: "x" } },
    { id: "a4", tool: "send_email", args: { person_id: "p" } },
  ] });
  const r = await st.fl.flow(env, { campaign_id: CAMP });
  const by = Object.fromEntries(r.cards.map((c) => [c.key, c.approvals.map((a) => a.id)]));
  assert.deepEqual(by["step:13"], ["a1", "a2"]);
  assert.deepEqual(by["step:12"], ["a2"]);
  assert.deepEqual(by["line_invite:shianin"], ["a3"]);
  assert.equal(r.cards.find((c) => c.key === "step:13").approvals[0].body, "新しい本文");
  assert.equal(r.other_pending, 1);
  assert.equal(r.counts.pending, 4);
});

test("AI と作る：依頼 → AI が読む（前後の配信つき）→ 案を置く → カードに出る → 直して採用で本文が替わる", async () => {
  const st = setup();
  const q = await st.fl.createRequest(env, { part_type: "step", part_id: "13", note: "失敗談から", campaign_id: CAMP }, "naoki@example.com");
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.match(q.prompt, /get_ai_draft/);
  assert.match(q.prompt, new RegExp(q.request.id));
  assert.match(q.prompt, /失敗談から/);
  const g = await st.fl.getRequest(env, { id: q.request.id });
  assert.equal(g.ok, true);
  assert.equal(g.target.when, "LINE 連携から 1日後");
  assert.equal(g.flow.length, 5);
  assert.equal(g.flow.find((x) => x.this_one).key, "step:13");
  const before = st.table("b_steps").find((x) => x.id === 13).body;
  assert.equal((await st.fl.putDraft(env, { id: q.request.id, body: "AI の案の本文" })).ok, true);
  assert.equal(st.table("b_steps").find((x) => x.id === 13).body, before, "案を置いても配信中の本文は変わらない");
  const f = await st.fl.flow(env, { campaign_id: CAMP });
  const c = f.cards.find((x) => x.key === "step:13");
  assert.deepEqual([c.ai.status, c.ai.draft], ["ready", "AI の案の本文"]);
  const d = await st.fl.decide(env, { id: q.request.id, action: "adopt", body: "Naoki が直した本文" }, "naoki@example.com");
  assert.equal(d.ok, true);
  assert.deepEqual(st.saved, [[13, "Naoki が直した本文"]]);
  assert.equal(st.table("b_ai_drafts")[0].status, "adopted");
  assert.equal((await st.fl.decide(env, { id: q.request.id, action: "adopt" })).error, "closed", "閉じた依頼はもう採用できない");
});

test("AI と作る：採用しない・新しい依頼で前の依頼が閉じる・友だち追加の案内も同じ形・LINE は 2000 字まで", async () => {
  const st = setup();
  const q1 = await st.fl.createRequest(env, { part_type: "step", part_id: "12", note: "" }, "n");
  const q2 = await st.fl.createRequest(env, { part_type: "step", part_id: "12", note: "もう一度" }, "n");
  assert.equal(st.table("b_ai_drafts").find((x) => x.id === q1.request.id).status, "dropped");
  assert.equal((await st.fl.putDraft(env, { id: q2.request.id, body: "あ".repeat(2001) })).error, "too_long");
  assert.equal((await st.fl.decide(env, { id: q2.request.id, action: "drop" })).status, "dropped");
  const qi = await st.fl.createRequest(env, { part_type: "line_invite", part_id: "shianin", note: "特典を強く" }, "n");
  await st.fl.putDraft(env, { id: qi.request.id, body: "案内の案 {{url}}" });
  await st.fl.decide(env, { id: qi.request.id, action: "adopt" }, "n");
  assert.equal(st.getInvite(), "案内の案 {{url}}");
  assert.equal((await st.fl.createRequest(env, { part_type: "page", part_id: PAGE })).error, "bad_part_type");
  assert.equal((await st.fl.createRequest(env, { part_type: "step", part_id: "999" })).error, "part_not_found");
  assert.equal((await st.fl.decide(env, { id: q2.request.id, action: "x" })).error, "closed");
});

test("道具：AI は依頼を読む・案を置くだけ（自動）。表の SQL と画面の部品がある", () => {
  assert.equal(DEFAULT_MODES.get_ai_draft, "auto");
  assert.equal(DEFAULT_MODES.put_ai_draft, "auto");
  const sql = readFileSync(new URL("../supabase/bt5_ai_drafts.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.b_ai_drafts/);
  assert.match(sql, /enable row level security/);
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  assert.match(html, /data-mode="seq"[^>]*>流れ</);
  const js = readFileSync(new URL("../public/js/flowview.js", import.meta.url), "utf8");
  assert.match(js, /AI と作る/);
  assert.match(js, /承認して実行/);
});

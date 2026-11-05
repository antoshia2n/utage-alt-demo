// 目標達成くん 6 便目（2026-11-05）：面談の議事録から作った設計の下書き
import test from "node:test";
import assert from "node:assert/strict";
import { checkDraft, mergeDraft, draftWeeks, checkPlan, makeGoals } from "../src/goals.js";
import { draftHtml } from "../public/js/goalplan.js";

const TODAY = "2026-11-05";
const DRAFT = {
  start: "2026-11-11", ideal: "X と note で月 30 万", idealWhen: "2027 年 3 月",
  kgi: [{ n: "フォロワー", v: 800, to: 3000, u: "人" }, { n: "LINE 登録", to: 300, u: "人" }, { n: "売上", to: 30, u: "万円" }, { n: "4 つ目", to: 1 }],
  spare: [5, 10, 13],
  ms: [{ n: "毎日投稿の仕組みができている", kpi: [{ n: "投稿", to: 7, u: "本" }, { n: "" }] }, { n: "" }, { n: "X 記事で 1 万インプ", kpi: [] }],
  hack: 1,
};

test("下書き：形をそろえる（KGI は 3 つまで・空の状態と KPI は捨てる・始める日は月曜・知らない項目は捨てる）", () => {
  const c = checkDraft(DRAFT);
  assert.equal(c.ok, true);
  const d = c.draft;
  assert.equal(d.start, "2026-11-09");
  assert.equal(d.kgi.length, 3);
  assert.deepEqual(d.kgi[0], { n: "フォロワー", v: 800, to: 3000, u: "人" });
  assert.equal(d.ms.length, 2);
  assert.deepEqual(d.ms[0].kpi, [{ n: "投稿", v: 0, to: 7, u: "本" }]);
  assert.equal("tasks" in d.ms[0], false);
  assert.equal("bud" in d, false);
  assert.equal("hack" in d, false);
  assert.equal(checkDraft({}).error, "draft_empty");
  assert.equal(checkDraft(null).error, "bad_draft");
});

test("下書きを重ねる：①〜③は下書き、リソース予算と記録は今のまま、続ける週は外す", () => {
  const plan = checkPlan({ start: "2026-11-02", ideal: "前の理想", bud: [{ n: "睡眠", h: 50 }, { n: "X", h: 10, g: 1 }], ext: { 0: 2 }, wk: { 1: { memo: "書いた" } }, ms: [{ n: "前の状態", tasks: [{ t: "やる" }] }] }, TODAY).plan;
  const m = mergeDraft(plan, checkDraft(DRAFT).draft, TODAY);
  assert.equal(m.ok, true);
  assert.equal(m.plan.ideal, "X と note で月 30 万");
  assert.equal(m.plan.start, "2026-11-09");
  assert.equal(m.plan.bud.length, 2);
  assert.equal(m.plan.wk[1].memo, "書いた");
  assert.deepEqual(m.plan.ext, {});
  assert.deepEqual(m.plan.ms.map((x) => x.n), ["毎日投稿の仕組みができている", "X 記事で 1 万インプ"]);
  assert.deepEqual(m.plan.ms[0].tasks, []);
  assert.deepEqual(m.plan.spare, [5, 10, 13]);
});

test("承認の画面の週の並び：予備の週を飛ばして状態を置く", () => {
  const w = draftWeeks(checkDraft({ ...DRAFT, spare: [2] }).draft);
  assert.equal(w.length, 13);
  assert.match(w[0], /^第 1 週（11\/9〜）毎日投稿の仕組みができている／KPI：投稿 7本$/);
  assert.equal(w[1], "第 2 週（11/16〜）予備の週");
  assert.match(w[2], /^第 3 週（11\/23〜）X 記事で 1 万インプ$/);
  assert.equal(w[3], "第 4 週（11/30〜）（空き）");
  const many = draftWeeks(checkDraft({ start: "2026-11-09", spare: [1, 2, 3, 4], ms: Array.from({ length: 12 }, (_, i) => ({ n: "S" + i })) }).draft);
  assert.match(many[13], /並びきらない状態 3 個/);
});

function fake() {
  const t = {
    member_alias: [{ member_id: "m1", kind: "shr_student_id", value: "44" }, { member_id: "m3", kind: "shr_student_id", value: "7" }, { member_id: "m4", kind: "shr_student_id", value: "7" }],
    shr_students: [{ id: 44, name: "ひろ", goal: "", track: [], archived: false, deleted: false }, { id: 7, name: "二重", archived: false, deleted: false }, { id: 9, name: "結びなし", archived: false, deleted: false }],
    b_goal_plans: [], b_goal_reviews: [], b_goal_drafts: [],
  };
  const parse = (path) => { const [tbl, qs = ""] = path.split("?"); const f = {}; for (const p of qs.split("&")) { const m = p.match(/^([a-z_]+)=eq\.(.*)$/); if (m) f[m[1]] = decodeURIComponent(m[2]); } return { tbl, hit: (r) => Object.entries(f).every(([k, v]) => String(r[k]) === v) }; };
  const rawDb = async (env, method, path, body) => {
    const { tbl, hit } = parse(path);
    if (method === "GET") return t[tbl].filter(hit);
    if (method === "POST") { const out = []; for (const b of body) { const i = t[tbl].findIndex((r) => r.member_id === b.member_id); if (i >= 0) t[tbl][i] = { ...t[tbl][i], ...b }; else t[tbl].push({ ...b }); out.push({ updated_at: "now", ...t[tbl][i >= 0 ? i : t[tbl].length - 1] }); } return out; }
    if (method === "PATCH") { t[tbl] = t[tbl].map((r) => (hit(r) ? { ...r, ...body } : r)); return null; }
    if (method === "DELETE") { t[tbl] = t[tbl].filter((r) => !hit(r)); return null; }
  };
  return { t, g: makeGoals({ rawDb }) };
}

test("承認を頼む前：生徒の名前と週の並びを足す・結ばれていない／二重に結ばれた生徒は止める", async () => {
  const { g } = fake();
  const p = await g.prepareDraft({}, { student_id: 44, source: "10/30 の面談", draft: DRAFT });
  assert.equal(p.ok, true);
  assert.equal(p.args.student_name, "ひろ");
  assert.equal(p.args.weeks.length, 13);
  assert.equal((await g.prepareDraft({}, { student_id: 9, draft: DRAFT })).error, "not_linked");
  assert.equal((await g.prepareDraft({}, { student_id: 7, draft: DRAFT })).error, "linked_twice");
  assert.equal((await g.prepareDraft({}, { student_id: "44;drop", draft: DRAFT })).error, "bad_student_id");
  assert.equal((await g.prepareDraft({}, { student_id: 999, draft: DRAFT })).error, "student_not_found");
});

test("承認のあと：下書きが入り、生徒の設計は変わらない。生徒の画面に下書きが出る", async () => {
  const { t, g } = fake();
  const r = await g.setDraft({}, { student_id: 44, source: "10/30 の面談", draft: DRAFT });
  assert.equal(r.ok, true);
  assert.equal(t.b_goal_plans.length, 0);
  const v = await g.view({}, "m1", TODAY);
  assert.equal(v.draft.ideal, "X と note で月 30 万");
  assert.equal(v.draft.source, "10/30 の面談");
  assert.equal(v.plan.saved_at, null);
});

test("始める → 設計に写る → 元に戻すと設計が無い状態へ戻り、下書きがまた出る", async () => {
  const { t, g } = fake();
  await g.setDraft({}, { student_id: 44, draft: DRAFT });
  const s = await g.draftAction({}, "m1", { action: "start" }, TODAY);
  assert.equal(s.ok, true);
  assert.equal(s.plan.ideal, "X と note で月 30 万");
  assert.equal(t.b_goal_plans.length, 1);
  assert.equal((await g.view({}, "m1", TODAY)).draft, null);
  assert.equal((await g.draftAction({}, "m1", { action: "start" }, TODAY)).error, "draft_closed");
  const u = await g.draftAction({}, "m1", { action: "undo" }, TODAY);
  assert.equal(u.ok, true);
  assert.equal(t.b_goal_plans.length, 0);
  assert.equal(u.draft.ideal, "X と note で月 30 万");
});

test("前の設計があるときの元に戻す：前の設計に戻る", async () => {
  const { t, g } = fake();
  await g.savePlan({}, "m1", { plan: { ideal: "自分の理想", bud: [{ n: "X", h: 5, g: 1 }] } }, TODAY);
  await g.setDraft({}, { student_id: 44, draft: DRAFT });
  const s = await g.draftAction({}, "m1", { action: "start" }, TODAY);
  assert.equal(s.plan.bud[0].h, 5); // リソース予算は残る
  await g.draftAction({}, "m1", { action: "undo" }, TODAY);
  assert.equal(t.b_goal_plans[0].plan.ideal, "自分の理想");
});

test("今のままにする → 下書きは出なくなる・設計は変わらない・元に戻すとまた出る", async () => {
  const { t, g } = fake();
  await g.setDraft({}, { student_id: 44, draft: DRAFT });
  assert.equal((await g.draftAction({}, "m1", { action: "keep" }, TODAY)).ok, true);
  assert.equal((await g.view({}, "m1", TODAY)).draft, null);
  assert.equal(t.b_goal_plans.length, 0);
  await g.draftAction({}, "m1", { action: "undo" }, TODAY);
  assert.ok((await g.view({}, "m1", TODAY)).draft);
  assert.equal((await g.draftAction({}, "m1", { action: "x" }, TODAY)).error, "bad_action");
  assert.equal((await g.draftAction({}, "m9", { action: "keep" }, TODAY)).error, "not_student");
});

test("生徒の画面の帯：中を見るで週の並び、押したあとは元に戻すの帯だけ、文字は逃がす", () => {
  const d = { ...checkDraft(DRAFT).draft, source: "<b>10/30</b> の面談" };
  const closed = draftHtml(d, false, "");
  assert.match(closed, /シアニンと決めた下書きがあります/);
  assert.match(closed, /&lt;b&gt;10\/30/);
  assert.doesNotMatch(closed, /gk-draft-wk/);
  const open = draftHtml(d, true, "");
  assert.match(open, /第 1 週<small>11\/9〜<\/small>/);
  assert.match(open, /予備の週/);
  assert.match(draftHtml(d, false, "start"), /元に戻す/);
  assert.equal(draftHtml(null, false, ""), "");
});

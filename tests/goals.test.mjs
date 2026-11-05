// 目標達成くん：週の月曜・追う数字・生徒だけが読み書きできる（旧の日報・週報は 2026-11-05 に外した）
import test from "node:test";
import assert from "node:assert/strict";
import { weekStart, trackOf, jstDay, makeGoals } from "../src/goals.js";

const TODAY = "2026-10-30"; // 金曜

test("週の月曜", () => {
  assert.equal(weekStart("2026-10-30"), "2026-10-26");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
  assert.equal(jstDay(Date.parse("2026-10-29T15:30:00Z")), "2026-10-30");
});

test("追う数字：空と重なりを外して 3 つまで", () => {
  assert.deepEqual(trackOf({ track: ["投稿数", " 投稿数", "", "フォロワー", "売上", "4 つ目"] }), ["投稿数", "フォロワー", "売上"]);
  assert.deepEqual(trackOf({ track: null }), []);
});

function fake() {
  const t = { member_alias: [{ member_id: "m1", kind: "shr_student_id", value: "44" }, { member_id: "m2", kind: "email_hash", value: "x" }],
    shr_students: [{ id: 44, name: "ひろ", goal: "月 10 万", next_action: "毎日 1 本", next_mtg: "2026-11-02", last_mtg: "2026-10-23", track: ["投稿数"], archived: false, deleted: false }],
    b_reports: [], b_goal_plans: [], b_goal_reviews: [], b_goal_drafts: [] };
  const rawDb = async (env, method, path, body) => {
    const [tbl, qs = ""] = path.split("?");
    const f = {}; for (const p of qs.split("&")) { const m = p.match(/^([a-z_]+)=(eq|gte)\.(.*)$/); if (m) f[m[1]] = [m[2], decodeURIComponent(m[3])]; }
    const hit = (r) => Object.entries(f).every(([k, [op, v]]) => op === "eq" ? String(r[k]) === v : String(r[k]) >= v);
    if (method === "GET") return t[tbl].filter(hit);
    if (method === "POST") { const out = []; for (const b of body) { const i = t[tbl].findIndex((r) => r.member_id === b.member_id && r.kind === b.kind && r.day === b.day); if (i >= 0) t[tbl][i] = { ...t[tbl][i], ...b }; else t[tbl].push({ ...b }); out.push(t[tbl][i >= 0 ? i : t[tbl].length - 1]); } return out; }
  };
  return { t, g: makeGoals({ rawDb }) };
}

test("生徒だけ：結ばれた人は読めて、結ばれていない人は not_student", async () => {
  const { g } = fake();
  assert.equal(await g.isStudent({}, "m1"), true);
  assert.equal(await g.isStudent({}, "m2"), false);
  const v = await g.view({}, "m1", "2026-10-30");
  assert.equal(v.ok, true);
  assert.equal(v.next_mtg, "2026-11-02");
  assert.equal("daily" in v, false);
  assert.equal((await g.view({}, "m2", "2026-10-30")).error, "not_student");
});

// ---------- 目標達成くん（2026-11-05）：13 週の設計 ----------
import { checkPlan, seedPlan, checkReview } from "../src/goals.js";

test("設計：KGI は 3 つまで・長さをそろえる・知らない項目は捨てる・始めた週は月曜にそろえる", () => {
  const c = checkPlan({ start: "2026-11-05", ideal: "x".repeat(500), kgi: [1, 2, 3, 4].map((i) => ({ n: "K" + i, v: "420", to: "1,000", u: "人" })), hack: 1,
    bud: [{ n: "睡眠", h: 200, c: "red" }], spare: [5, 5, 0, 14, 10], ext: { 3: 9, "-1": 1 }, ms: [{ n: "状態", kpi: [{ n: "記事", to: 2 }], tasks: [{ t: "書く", hr: 99 }] }] }, "2026-11-05");
  assert.equal(c.ok, true);
  const p = c.plan;
  assert.equal(p.start, "2026-11-02");
  assert.equal(p.ideal.length, 200);
  assert.equal(p.kgi.length, 3);
  assert.deepEqual(p.kgi[0], { n: "K1", v: 420, to: 1000, u: "人" });
  assert.equal("hack" in p, false);
  assert.equal(p.bud[0].h, 168);
  assert.equal(p.bud[0].c.startsWith("#"), true);
  assert.deepEqual(p.spare, [5, 10]);
  assert.deepEqual(p.ext, { 3: 3 });
  assert.equal(p.ms[0].tasks[0].hr, 80);
  assert.equal(checkPlan(null).error, "bad_plan");
  assert.equal(checkPlan({ ms: Array.from({ length: 13 }, () => ({ n: "あ".repeat(80), res: "あ".repeat(2000), hyp: "あ".repeat(1000), tasks: Array.from({ length: 20 }, () => ({ t: "あ".repeat(100) })) })) }).error, "plan_too_large");
});

test("設計：最初の形は、しあらぼ管理の目標と追う数字を写し、168 時間の予算を置く", () => {
  const p = seedPlan({ goal: "月 10 万", track: ["投稿数"] }, "2026-11-05");
  assert.equal(p.goal13, "月 10 万");
  assert.equal(p.goal13Own, 1);
  assert.equal(p.bud.reduce((a, b) => a + b.h, 0), 168);
  assert.deepEqual(p.ms[0].kpi.map((k) => k.n), ["投稿数"]);
  assert.deepEqual(seedPlan({ goal: "", track: [] }, "2026-11-05").ms, []);
});

test("設計：生徒だけが保存でき、読むと保存した形が返る。保存前は最初の形", async () => {
  const { g } = fake();
  const v0 = await g.view({}, "m1", "2026-11-05");
  assert.equal(v0.plan.saved_at, null);
  assert.equal(v0.plan.goal13, "月 10 万");
  const r = await g.savePlan({}, "m1", { plan: { ...v0.plan, ideal: "講座で月 30 万" } }, "2026-11-05");
  assert.equal(r.ok, true);
  const v1 = await g.view({}, "m1", "2026-11-05");
  assert.equal(v1.plan.ideal, "講座で月 30 万");
  assert.equal((await g.savePlan({}, "m2", { plan: {} }, "2026-11-05")).error, "not_student");
  assert.equal((await g.savePlan({}, "m1", {}, "2026-11-05")).error, "bad_plan");
});

test("週報：設計を保存してから・理由と来週がそろってから出せる。先の週は出せない。出し直すと承認は外れる", async () => {
  const { t, g } = fake();
  const v0 = await g.view({}, "m1", "2026-11-05");
  const body = { week_no: 1, report: { reason: "うまくいった", next: "go", rates: { time: 55, act: 52 }, text: "【週報】" } };
  assert.equal((await g.submitReview({}, "m1", body, "2026-11-05")).error, "plan_not_saved");
  await g.savePlan({}, "m1", { plan: { ...v0.plan, start: "2026-11-02" } }, "2026-11-05");
  assert.equal((await g.submitReview({}, "m1", { week_no: 1, report: { reason: "", next: "go" } }, "2026-11-05")).error, "report_incomplete");
  assert.equal((await g.submitReview({}, "m1", { ...body, week_no: 2 }, "2026-11-05")).error, "week_out_of_range");
  const r = await g.submitReview({}, "m1", body, "2026-11-05");
  assert.equal(r.ok, true);
  assert.equal(r.review.week_start, "2026-11-02");
  t.b_goal_reviews[0].approved_at = "2026-11-06T00:00:00Z"; t.b_goal_reviews[0].comment = "いいね";
  const r2 = await g.submitReview({}, "m1", body, "2026-11-05");
  assert.equal(r2.review.approved_at, null);
  assert.equal(t.b_goal_reviews.length, 1);
  assert.equal((await g.view({}, "m1", "2026-11-05")).reviews.length, 1);
  assert.equal((await g.submitReview({}, "m2", body, "2026-11-05")).error, "not_student");
});

test("設計の週ごとの記録：知らない理由・13 週の外の週は捨てる", () => {
  const p = checkPlan({ wk: { 4: { used: { X: 300 }, reason: "なんとなく", next: "x" }, 20: { memo: "x" } } }, "2026-11-05").plan;
  assert.deepEqual(Object.keys(p.wk), ["4"]);
  assert.equal(p.wk[4].used.X, 168);
  assert.equal(p.wk[4].reason, "");
  assert.equal(p.wk[4].next, "");
  assert.equal(checkReview({ week_no: 1, report: {} }, p, "2026-11-05").error, "report_incomplete");
});

// 目標タブ（2026-10-30）：書いたものの確かめ・週の月曜・追う数字・生徒だけが読み書きできる
import test from "node:test";
import assert from "node:assert/strict";
import { checkReport, weekStart, trackOf, jstDay, makeGoals } from "../src/goals.js";

const TODAY = "2026-10-30"; // 金曜

test("週の月曜", () => {
  assert.equal(weekStart("2026-10-30"), "2026-10-26");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
  assert.equal(jstDay(Date.parse("2026-10-29T15:30:00Z")), "2026-10-30");
});

test("日報：今日から 7 日前まで・数字は 3 つまで・空は断る", () => {
  assert.equal(checkReport({ kind: "daily", day: TODAY, body: "書いた" }, TODAY).ok, true);
  assert.equal(checkReport({ kind: "daily", day: "2026-10-23", body: "x" }, TODAY).ok, true);
  assert.equal(checkReport({ kind: "daily", day: "2026-10-22", body: "x" }, TODAY).error, "day_out_of_range");
  assert.equal(checkReport({ kind: "daily", day: "2026-10-31", body: "x" }, TODAY).error, "day_out_of_range");
  assert.equal(checkReport({ kind: "daily", day: TODAY }, TODAY).error, "empty");
  assert.equal(checkReport({ kind: "daily", day: TODAY, numbers: { 投稿: "abc" } }, TODAY).error, "bad_number");
  assert.equal(checkReport({ kind: "daily", day: TODAY, numbers: { a: 1, b: 2, c: 3, d: 4 } }, TODAY).error, "too_many_numbers");
  const ok = checkReport({ kind: "daily", day: TODAY, numbers: { 投稿: "2", いいね: "", 空: null } }, TODAY);
  assert.deepEqual(ok.row.numbers, { 投稿: 2 });
  assert.equal(checkReport({ kind: "monthly", day: TODAY, body: "x" }, TODAY).error, "bad_kind");
});

test("週報：月曜の日付で、今週か先週だけ", () => {
  assert.equal(checkReport({ kind: "weekly", day: "2026-10-26", body: "x" }, TODAY).ok, true);
  assert.equal(checkReport({ kind: "weekly", day: "2026-10-19", body: "x" }, TODAY).ok, true);
  assert.equal(checkReport({ kind: "weekly", day: "2026-10-12", body: "x" }, TODAY).error, "day_out_of_range");
  assert.equal(checkReport({ kind: "weekly", day: "2026-10-27", body: "x" }, TODAY).error, "not_week_start");
});

test("追う数字：空と重なりを外して 3 つまで", () => {
  assert.deepEqual(trackOf({ track: ["投稿数", " 投稿数", "", "フォロワー", "売上", "4 つ目"] }), ["投稿数", "フォロワー", "売上"]);
  assert.deepEqual(trackOf({ track: null }), []);
});

function fake() {
  const t = { member_alias: [{ member_id: "m1", kind: "shr_student_id", value: "44" }, { member_id: "m2", kind: "email_hash", value: "x" }],
    shr_students: [{ id: 44, name: "ひろ", goal: "月 10 万", next_action: "毎日 1 本", next_mtg: "2026-11-02", last_mtg: "2026-10-23", track: ["投稿数"], archived: false, deleted: false }],
    b_reports: [], b_goal_plans: [] };
  const rawDb = async (env, method, path, body) => {
    const [tbl, qs = ""] = path.split("?");
    const f = {}; for (const p of qs.split("&")) { const m = p.match(/^([a-z_]+)=(eq|gte)\.(.*)$/); if (m) f[m[1]] = [m[2], decodeURIComponent(m[3])]; }
    const hit = (r) => Object.entries(f).every(([k, [op, v]]) => op === "eq" ? String(r[k]) === v : String(r[k]) >= v);
    if (method === "GET") return t[tbl].filter(hit);
    if (method === "POST") { const out = []; for (const b of body) { const i = t[tbl].findIndex((r) => r.member_id === b.member_id && r.kind === b.kind && r.day === b.day); if (i >= 0) t[tbl][i] = { ...t[tbl][i], ...b }; else t[tbl].push({ ...b }); out.push(t[tbl][i >= 0 ? i : t[tbl].length - 1]); } return out; }
  };
  return { t, g: makeGoals({ rawDb }) };
}

test("生徒だけ：結ばれた人は目標を読めて、書くと同じ日は上書き。結ばれていない人は not_student", async () => {
  const { t, g } = fake();
  assert.equal(await g.isStudent({}, "m1"), true);
  assert.equal(await g.isStudent({}, "m2"), false);
  const v = await g.view({}, "m1", TODAY);
  assert.equal(v.goal.text, "月 10 万");
  assert.deepEqual(v.goal.track, ["投稿数"]);
  assert.equal(v.week, "2026-10-26");
  assert.equal((await g.save({}, "m1", { kind: "daily", day: TODAY, body: "1 回目", numbers: { 投稿数: 1 } }, TODAY)).ok, true);
  assert.equal((await g.save({}, "m1", { kind: "daily", day: TODAY, body: "直した", numbers: { 投稿数: 2 } }, TODAY)).ok, true);
  assert.equal(t.b_reports.length, 1);
  assert.equal(t.b_reports[0].body, "直した");
  assert.equal((await g.save({}, "m2", { kind: "daily", day: TODAY, body: "x" }, TODAY)).error, "not_student");
  assert.equal((await g.view({}, "m2", TODAY)).error, "not_student");
});

// ---------- 目標達成くん（2026-11-05）：13 週の設計 ----------
import { checkPlan, seedPlan } from "../src/goals.js";

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

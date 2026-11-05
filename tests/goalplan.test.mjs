// 目標達成くん（2026-11-05）1 便目：画面の計算（週の並び・今週・状態の色・直し方）と、描いたものに大事な言葉が出るか
import test from "node:test";
import assert from "node:assert/strict";
import { weekNo, place, weekState, goal13Text, goalHours, budSum, monthWeek, setPath, applyAction, planHtml, chainHtml, homeCardHtml, popHtml } from "../public/js/goalplan.js";
import { seedPlan } from "../src/goals.js";

const plan = () => {
  const p = seedPlan({ goal: "", track: [] }, "2026-10-12");
  p.kgi = [{ n: "フォロワー", v: 420, to: 1000, u: "人" }];
  p.ms = Array.from({ length: 10 }, (_, i) => ({ n: "状態" + (i + 1), kpi: i < 3 ? [{ n: "x", v: 1, to: 1, u: "" }] : [{ n: "記事", v: 1, to: 2, u: "本" }], tasks: [], res: "", hyp: "", resDone: 0, hypDone: 0 }));
  return p;
};

test("今週は 13 週の何週目か（始まる前は 0、終わったら 14）", () => {
  const p = plan();
  assert.equal(p.start, "2026-10-12");
  assert.equal(weekNo(p, "2026-11-05"), 4);
  assert.equal(weekNo(p, "2026-10-11"), 0);
  assert.equal(weekNo(p, "2027-01-30"), 14);
  assert.equal(monthWeek(p, 4), "11月1週");
});

test("状態は予備の週を飛ばして並び、続ける週はすぐ後ろに入る。入りきらない数を出す", () => {
  const p = plan();
  assert.deepEqual(place(p).w.slice(1, 7), [[0, 0], [1, 0], [2, 0], [3, 0], "spare", [4, 0]]);
  assert.equal(place(p).over, 0);
  p.ext = { 3: 1 }; p.spare = [10, 13];
  assert.deepEqual(place(p).w[5], [3, 1]);
  p.spare = []; p.ms.push(...Array.from({ length: 3 }, () => ({ n: "", kpi: [] })));
  assert.equal(place(p).over, 1);
});

test("週の色：前の週は KPI がそろえば達成・そろわなければ未達、今週、これから、予備", () => {
  const p = plan();
  assert.equal(weekState(p, 1, 4), "done");
  assert.equal(weekState(p, 4, 4), "now");
  assert.equal(weekState(p, 5, 4), "spare");
  assert.equal(weekState(p, 6, 4), "next");
  assert.equal(weekState(p, 4, 6), "late");
});

test("13 週の目標は KGI から作る。自分で書いたらそちらを使う", () => {
  const p = plan();
  assert.equal(goal13Text(p), "フォロワー 1,000 人に届いている");
  assert.equal(setPath(p, "kgi.0.to", "1,200"), true);
  assert.equal(goal13Text(p), "フォロワー 1,200 人に届いている");
  assert.equal(setPath(p, "goal13", "体験会を開いている"), true);
  assert.equal(goal13Text(p), "体験会を開いている");
  assert.equal(setPath(p, "goal13", "体験会を開いている"), false);
});

test("リソース予算：合計 168・目標に使う時間・＋－と置き場所の移し替え", () => {
  const p = plan();
  assert.equal(budSum(p), 168);
  assert.equal(goalHours(p), 40);
  applyAction(p, { bh: "5", d: "1" }, 4);
  assert.equal(goalHours(p), 41);
  applyAction(p, { bmv: "3" }, 4);
  assert.equal(goalHours(p), 51);
});

test("予備：先の週だけ切り替えられる。状態を消すと、続ける週の番号もずれる", () => {
  const p = plan();
  assert.equal(applyAction(p, { spare: "3" }, 4), false);
  assert.equal(applyAction(p, { spare: "7" }, 4), true);
  assert.deepEqual(p.spare, [5, 7, 10, 13]);
  p.ext = { 5: 1 };
  applyAction(p, { del: "ms.2" }, 4);
  assert.deepEqual(p.ext, { 4: 1 });
});

test("画面：8 段の帯（④〜⑧は準備中）・全体像・ポップアップ・ホームのカード。書いた字は消毒して出す", () => {
  const p = plan(); p.ideal = "<b>講座</b>";
  const h = planHtml(p, "2026-11-05");
  assert.match(h, /4 半期の全体像/);
  assert.match(h, /&lt;b&gt;講座/);
  assert.doesNotMatch(h, /<b>講座/);
  assert.match(h, /第 4 週（11月1週）／13 週/);
  const c = chainHtml(p);
  assert.match(c, /data-to="s1"/);
  assert.equal((c.match(/準備中/g) || []).length, 5);
  assert.match(popHtml(p, 4, 4), /状態 4：状態4/);
  assert.match(popHtml(p, 8, 4), /この週を予備にする/);
  assert.doesNotMatch(popHtml(p, 2, 4), /予備にする/);
  assert.match(homeCardHtml(p, "2026-11-05"), /今週（第 4 週）の状態：状態4/);
});

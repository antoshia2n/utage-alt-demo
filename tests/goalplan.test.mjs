// 目標達成くん（2026-11-05）1 便目：画面の計算（週の並び・今週・状態の色・直し方）と、描いたものに大事な言葉が出るか
import test from "node:test";
import assert from "node:assert/strict";
import { weekNo, place, weekState, goal13Text, goalHours, budSum, monthWeek, setPath, applyAction, applyField, planHtml, chainHtml, homeCardHtml, popHtml, tacHtml, nowMs, tasksHours, recHtml, reviewHtml, growHtml, reportFor, applyWeek, applyNext, carryTry, timeRate, actRate, verdict } from "../public/js/goalplan.js";
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

test("画面：8 段の帯（全部開いた）・全体像・ポップアップ・ホームのカード。書いた字は消毒して出す", () => {
  const p = plan(); p.ideal = "<b>講座</b>";
  const h = planHtml(p, "2026-11-05");
  assert.match(h, /4 半期の全体像/);
  assert.match(h, /&lt;b&gt;講座/);
  assert.doesNotMatch(h, /<b>講座/);
  assert.match(h, /第 4 週（11月1週）／13 週/);
  const c = chainHtml(p, "2026-11-05");
  assert.match(c, /data-to="s4"/);
  assert.equal((c.match(/準備中/g) || []).length, 0);
  assert.match(c, /data-to="s8"/);
  assert.match(popHtml(p, 4, 4), /状態 4：状態4/);
  assert.match(popHtml(p, 8, 4), /この週を予備にする/);
  assert.doesNotMatch(popHtml(p, 2, 4), /予備にする/);
  assert.match(homeCardHtml(p, "2026-11-05"), /今週（第 4 週）の状態：状態4/);
});

test("④ 戦術：開いていなければ今週の状態。KPI とリサーチ・仮説を書くと印が付き、④ の段が「できた」になる", () => {
  const p = plan();
  assert.equal(nowMs(p, "2026-11-05"), 3);
  assert.match(tacHtml(p, "2026-11-05", null), /状態 4：状態4（今週）" ?|selected>状態 4：状態4（今週）/);
  assert.match(tacHtml(p, "2026-11-05", 5), /value="5" selected/);
  const m = p.ms[3];
  assert.equal(applyField(p, { dataset: { mtx: "3.res" }, value: "・伸びている人を 3 人見た" }), true);
  assert.equal(m.resDone, 1);
  assert.equal(applyField(p, { dataset: { mtx: "3.hyp" }, value: "・1 行目に数字を入れれば伸びるはず" }), true);
  assert.match(chainHtml(p, "2026-11-05"), /data-to="s4" class="gk-ci g2  ">.*?戦術<span class="st">できた/);
  assert.equal(applyField(p, { dataset: { mck: "3.resDone" }, checked: false }), true);
  assert.equal(m.resDone, 0);
  assert.equal(applyField(p, { dataset: { kf: "3.0.to" }, value: "1,000" }), true);
  assert.equal(m.kpi[0].to, 1000);
  assert.equal(applyField(p, { dataset: { kf: "3.0.to" }, value: "1000" }), false);
});

test("④ やること：時間を足し、② の目標に使う時間を超えたら「はみ出し」。KPI を消しても続ける週はずれない", () => {
  const p = plan();
  applyAction(p, { addt: "3" }, 4); setPath(p, "ms.3.tasks.0.hr", "30");
  applyAction(p, { addt: "3" }, 4); setPath(p, "ms.3.tasks.1.hr", "12.5");
  assert.equal(tasksHours(p.ms[3]), 42.5);
  assert.match(tacHtml(p, "2026-11-05", 3), /2\.5 時間はみ出し/);
  p.ext = { 5: 1 };
  applyAction(p, { addk: "3" }, 4);
  applyAction(p, { del: "ms.3.kpi.1" }, 4);
  assert.deepEqual(p.ext, { 5: 1 });
  assert.match(popHtml(p, 4, 4), /data-ms="3"/);
});

test("⑤⑥ 記録：KPI の数・やることのチェック・使った時間で、2 つの実行率が出る", () => {
  const p = plan(); p.ms[3].tasks = [{ t: "書く", when: "", hr: 6, d: 0, from: 0 }];
  applyWeek(p, 4, { dataset: { kv: "3.0", d: "1" } });
  assert.equal(p.ms[3].kpi[0].v, 2);
  applyWeek(p, 4, { dataset: { td: "3.0" }, checked: true });
  applyWeek(p, 4, { dataset: { used: "X" }, value: "6" });
  applyWeek(p, 4, { dataset: { used: "副業" }, value: "16" });
  assert.equal(timeRate(p, 4), 55);
  assert.equal(actRate(p, 4), 100);
  assert.deepEqual(verdict(55, 100), ["少ない時間で進められた", "この仮説は効いている"]);
  assert.equal(actRate(p, 5), null);
  const h = recHtml(p, "2026-11-05", 4);
  assert.match(h, /data-used="X" value="6"/);
  assert.match(h, /data-kin="3\.0" value="2"/);
  applyWeek(p, 4, { dataset: { kin: "3.0" }, value: "46" });
  assert.equal(p.ms[3].kpi[0].v, 46);
  assert.match(h, /第 4 週（11月1週）・今週/);
});

test("⑧ 修正：続けるは次の週の予備を使い、選び直すと元に戻る。予備が無ければ後ろがずれる", () => {
  const p = plan();
  assert.equal(applyNext(p, 4, "cont"), true);
  assert.deepEqual(place(p).w[5], [3, 1]);
  assert.deepEqual(p.spare, [10, 13]);
  applyNext(p, 4, "go");
  assert.deepEqual(p.spare, [5, 10, 13]);
  assert.deepEqual(p.ext, {});
  p.spare = [10, 13]; applyNext(p, 3, "cont");
  assert.deepEqual(p.spare, [10]);
  assert.deepEqual(place(p).w[4], [2, 1]);
});

test("⑦⑧ 週報：理由と来週を選ぶと出せる。コピーの文と、来週変えることは来週の ④ へ 1 回だけ", () => {
  const p = plan();
  assert.match(reviewHtml(p, "2026-11-05", 4, null), /data-submit disabled/);
  applyWeek(p, 4, { dataset: { rs: "時間が取れなかった" } });
  applyNext(p, 4, "go");
  applyWeek(p, 4, { dataset: { wtx: "tryy" }, value: "火曜の朝に書く" });
  assert.doesNotMatch(reviewHtml(p, "2026-11-05", 4, null), /data-submit disabled/);
  const r = reportFor(p, 4);
  assert.match(r.text, /【週報】11月1週（11\/2〜11\/8）第4週／13/);
  assert.match(r.text, /理由：時間が取れなかった/);
  assert.match(r.text, /来週：次の状態へ進む/);
  assert.equal(carryTry(p, 4), true);
  assert.equal(carryTry(p, 4), false);
  assert.deepEqual(p.ms[4].tasks.at(-1), { t: "火曜の朝に書く", when: "", hr: 0, d: 0, from: 1 });
  assert.match(reviewHtml(p, "2026-11-05", 4, { week_no: 4, approved_at: "2026-11-06", comment: "いいね" }), /シアニンが承認 ✓[\s\S]*いいね/);
});

test("成長レポート：出した週報の実行率と KGI の値で伸びを描く。今週はいまの値", () => {
  const p = plan();
  const reviews = [{ week_no: 2, rates: { act: 71 }, kgi: [{ n: "フォロワー", v: 340, to: 1000, u: "人" }] }, { week_no: 3, rates: { act: 88 }, kgi: [{ n: "フォロワー", v: 380, to: 1000, u: "人" }] }];
  const h = growHtml(p, "2026-11-05", reviews);
  assert.match(h, /2<small> \/ 4<\/small><\/b><span>週報を出した週/);
  assert.match(h, />71<\/text>/);
  assert.match(h, />88<\/text>/);
  assert.match(h, />420<\/text>/);
  assert.match(h, /KGI の伸び：フォロワー/);
  assert.match(reportFor(p, 4).kgi[0].n, /フォロワー/);
  assert.match(growHtml(p, "2026-10-01", []), /13 週が始まると/);
});

// マイページの「目標」タブ＝目標達成くん（2026-10-30 に「目標と日報」として始め、2026-11-05 に作り直した）
//
// しあらぼの生徒が、自分で 13 週の設計（b_goal_plans）を書き、週報（b_goal_reviews）を出す。シアニンはしあらぼ管理で読んで承認する。
// まだ設計の無い生徒には、しあらぼ管理（shr_students）の目標と追う数字を最初の値として出す。
// 生徒かどうかは、門番の別名の表（member_alias の kind=shr_student_id）で結ばれているかで決める。ゲストには出ない。
// 旧の日報・週報（b_reports）は 2026-11-05 に 0 行のまま外した。

const TRACK_MAX = 3, NAME_MAX = 20;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 日本時間の今日（YYYY-MM-DD）
export const jstDay = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// その日を含む週の月曜
export const weekStart = (day) => { const d = new Date(day + "T00:00:00Z").getUTCDay(); return addDays(day, -((d + 6) % 7)); };

// 追う数字の名前（しあらぼ管理の track。文字の配列。最大 3 つ）
export function trackOf(student) {
  const t = student && student.track;
  const arr = Array.isArray(t) ? t : [];
  return [...new Set(arr.map((x) => String(x ?? "").trim().slice(0, NAME_MAX)).filter(Boolean))].slice(0, TRACK_MAX);
}

// ---------- 目標達成くん（2026-11-05）：13 週の設計。生徒が書き、ここが正本 ----------
const WEEKS = 13;
const LIM = { ideal: 200, when: 40, goal13: 200, strat: 300, kgi: 3, name: 30, unit: 10, bud: 12, budName: 20, ms: 13, msName: 80, kpi: 5, tasks: 20, task: 100, taskWhen: 30, res: 2000, hyp: 1000, bytes: 60000 };
const PALETTE = ["#94a3b8", "#cbd5e1", "#f9a8d4", "#86efac", "#4644c7", "#2b2a7a", "#fcd34d", "#a78bfa", "#67e8f9", "#fdba74"];
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const num = (v, lo, hi) => { const n = Number(String(v ?? "").replace(/[,，\s]/g, "")); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
const arr = (v) => (Array.isArray(v) ? v : []);
export const REASONS = ["時間が取れなかった", "やり方が合わなかった", "予定外の仕事", "体調・気分", "思ったより難しかった", "うまくいった"];
const weekRec = (r) => {
  const used = {};
  for (const [k, v] of Object.entries(r && typeof r.used === "object" && !Array.isArray(r.used) ? r.used : {}).slice(0, LIM.bud)) { const n = str(k, LIM.budName); if (n) used[n] = Math.round(num(v, 0, 168) * 2) / 2; }
  return { used, memo: str(r && r.memo, LIM.res), reason: REASONS.includes(r && r.reason) ? r.reason : "", why: str(r && r.why, 200),
    next: ["cont", "go"].includes(r && r.next) ? r.next : "", rmSpare: Math.trunc(num(r && r.rmSpare, 0, WEEKS)), tryy: str(r && r.tryy, 200), tryAdded: r && r.tryAdded ? 1 : 0 };
};
const metric = (k) => ({ n: str(k && k.n, LIM.name), v: num(k && k.v, -1e9, 1e9), to: num(k && k.to, 0, 1e9), u: str(k && k.u, LIM.unit) });

// 生徒が送ってきた設計を、決まった形と長さにそろえる（知らない項目は捨てる）
export function checkPlan(input, today = jstDay()) {
  const p = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!p) return { ok: false, error: "bad_plan" };
  const start = DAY_RE.test(String(p.start || "")) && !isNaN(Date.parse(p.start)) ? weekStart(p.start) : weekStart(today);
  const spare = [...new Set(arr(p.spare).map((n) => Math.trunc(Number(n))).filter((n) => n >= 1 && n <= WEEKS))].sort((a, b) => a - b);
  const ext = {};
  for (const [k, v] of Object.entries(p.ext && typeof p.ext === "object" ? p.ext : {})) { const i = Math.trunc(Number(k)), n = Math.trunc(num(v, 0, 3)); if (i >= 0 && i < LIM.ms && n > 0) ext[i] = n; }
  const plan = {
    v: 1, start,
    ideal: str(p.ideal, LIM.ideal), idealWhen: str(p.idealWhen, LIM.when),
    kgi: arr(p.kgi).slice(0, LIM.kgi).map(metric),
    bud: arr(p.bud).slice(0, LIM.bud).map((b, i) => ({ n: str(b && b.n, LIM.budName), h: Math.round(num(b && b.h, 0, 168) * 2) / 2, g: b && b.g ? 1 : 0, c: PALETTE.includes(b && b.c) ? b.c : PALETTE[i % PALETTE.length] })),
    goal13: str(p.goal13, LIM.goal13), goal13Own: p.goal13Own ? 1 : 0,
    strat: str(p.strat, LIM.strat), spare, ext,
    wk: Object.fromEntries(Object.entries(p.wk && typeof p.wk === "object" && !Array.isArray(p.wk) ? p.wk : {}).map(([k, v]) => [Math.trunc(Number(k)), weekRec(v)]).filter(([k]) => k >= 1 && k <= WEEKS)),
    ms: arr(p.ms).slice(0, LIM.ms).map((m) => ({
      n: str(m && m.n, LIM.msName),
      kpi: arr(m && m.kpi).slice(0, LIM.kpi).map(metric),
      tasks: arr(m && m.tasks).slice(0, LIM.tasks).map((t) => ({ t: str(t && t.t, LIM.task), when: str(t && t.when, LIM.taskWhen), hr: Math.round(num(t && t.hr, 0, 80) * 2) / 2, d: t && t.d ? 1 : 0, from: t && t.from ? 1 : 0 })),
      res: str(m && m.res, LIM.res), hyp: str(m && m.hyp, LIM.hyp), resDone: m && m.resDone ? 1 : 0, hypDone: m && m.hypDone ? 1 : 0,
    })),
  };
  if (JSON.stringify(plan).length > LIM.bytes) return { ok: false, error: "plan_too_large" };
  return { ok: true, plan };
}

// 週報（その週の控え）。中身は画面が作り、ここは形と長さをそろえるだけ
export function checkReview(body, plan, today = jstDay()) {
  const r = body && body.report && typeof body.report === "object" ? body.report : null;
  if (!r || !plan) return { ok: false, error: "bad_report" };
  const n = Math.trunc(Number(body.week_no));
  const ws = addDays(plan.start, (n - 1) * 7);
  if (!(n >= 1 && n <= WEEKS) || ws > weekStart(today)) return { ok: false, error: "week_out_of_range" };
  if (!REASONS.includes(r.reason) || !["cont", "go"].includes(r.next)) return { ok: false, error: "report_incomplete" };
  const pct = (v) => Math.round(num(v, 0, 999));
  const report = {
    state: str(r.state, LIM.msName), done: r.done ? 1 : 0,
    kpi: arr(r.kpi).slice(0, LIM.kpi).map(metric),
    kgi: arr(r.kgi).slice(0, LIM.kgi).map(metric),
    hours: { used: num(r.hours && r.hours.used, 0, 168), cap: num(r.hours && r.hours.cap, 0, 168) },
    rates: { time: pct(r.rates && r.rates.time), act: pct(r.rates && r.rates.act) },
    tasks: { done: Math.trunc(num(r.tasks && r.tasks.done, 0, LIM.tasks)), all: Math.trunc(num(r.tasks && r.tasks.all, 0, LIM.tasks)) },
    reason: r.reason, why: str(r.why, 200), next: r.next, tryy: str(r.tryy, 200), memo: str(r.memo, LIM.res), text: str(r.text, 3000),
  };
  return { ok: true, row: { week_start: ws, week_no: n, report } };
}

// まだ設計が無い生徒の最初の形。しあらぼ管理に入っている目標と追う数字を、最初の値として写す
export function seedPlan(student, today = jstDay()) {
  const track = trackOf(student);
  return checkPlan({
    start: weekStart(today),
    goal13: String((student && student.goal) || ""), goal13Own: student && student.goal ? 1 : 0,
    bud: [{ n: "睡眠", h: 50 }, { n: "労働", h: 40 }, { n: "家庭", h: 28 }, { n: "習慣", h: 10 }, { n: "X", h: 10, g: 1 }, { n: "副業", h: 30, g: 1 }]
      .map((b, i) => ({ ...b, c: PALETTE[i] })),
    spare: [5, 10, 13],
    ms: track.length ? [{ n: "", kpi: track.map((n) => ({ n, v: 0, to: 0, u: "" })) }] : [],
  }, today).plan;
}

export function makeGoals(h) {
  // h: { rawDb }
  async function studentOf(env, memberId) {
    const [a] = await h.rawDb(env, "GET", `member_alias?select=value&member_id=eq.${memberId}&kind=eq.shr_student_id&limit=1`);
    if (!a || !/^\d{1,9}$/.test(String(a.value))) return null;
    const [s] = await h.rawDb(env, "GET", `shr_students?select=id,name,goal,next_action,next_mtg,last_mtg,track&id=eq.${a.value}&archived=eq.false&deleted=eq.false`);
    return s || null;
  }

  // マイページに「目標」タブを出すか（/api/me から呼ぶ・軽く）
  async function isStudent(env, memberId) {
    const rows = await h.rawDb(env, "GET", `member_alias?select=id&member_id=eq.${memberId}&kind=eq.shr_student_id&limit=1`);
    return rows.length > 0;
  }

  async function view(env, memberId, today = jstDay()) {
    const s = await studentOf(env, memberId);
    if (!s) return { ok: false, error: "not_student" };
    return {
      ok: true, today, next_mtg: s.next_mtg || "",
      plan: await planOf(env, memberId, s, today),
      reviews: await h.rawDb(env, "GET", `b_goal_reviews?select=week_start,week_no,submitted_at,approved_at,comment,report->rates,report->kgi,report->done&member_id=eq.${memberId}&order=week_start.desc&limit=20`),
    };
  }

  async function planOf(env, memberId, s, today) {
    const [row] = await h.rawDb(env, "GET", `b_goal_plans?select=plan,updated_at&member_id=eq.${memberId}`);
    if (row && row.plan && row.plan.v) return { ...checkPlan(row.plan, today).plan, saved_at: row.updated_at };
    return { ...seedPlan(s, today), saved_at: null };
  }

  async function savePlan(env, memberId, body, today = jstDay()) {
    if (!(await studentOf(env, memberId))) return { ok: false, error: "not_student" };
    const c = checkPlan(body && body.plan, today);
    if (!c.ok) return c;
    const now = new Date().toISOString();
    const [row] = await h.rawDb(env, "POST", "b_goal_plans?on_conflict=member_id",
      [{ member_id: memberId, plan: c.plan, updated_at: now }], "resolution=merge-duplicates,return=representation");
    return { ok: true, plan: { ...row.plan, saved_at: row.updated_at } };
  }

  // 週報を出す（同じ週は出し直し。出し直すと承認は外れる）
  async function submitReview(env, memberId, body, today = jstDay()) {
    const s = await studentOf(env, memberId);
    if (!s) return { ok: false, error: "not_student" };
    const plan = await planOf(env, memberId, s, today);
    if (!plan.saved_at) return { ok: false, error: "plan_not_saved" };
    const c = checkReview(body, plan, today);
    if (!c.ok) return c;
    const [row] = await h.rawDb(env, "POST", "b_goal_reviews?on_conflict=member_id,week_start",
      [{ member_id: memberId, ...c.row, submitted_at: new Date().toISOString(), approved_at: null, comment: "" }], "resolution=merge-duplicates,return=representation");
    return { ok: true, review: { week_start: row.week_start, week_no: row.week_no, submitted_at: row.submitted_at, approved_at: row.approved_at, comment: row.comment, rates: row.report.rates, kgi: row.report.kgi, done: row.report.done } };
  }

  return { view, savePlan, submitReview, isStudent, studentOf };
}

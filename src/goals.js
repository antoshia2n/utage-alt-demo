// マイページの「目標」タブ（2026-10-30・依頼書「haAku の生徒の画面」の 1 便目・Naoki 12:20「OK」）
//
// しあらぼの生徒が、自分の目標（しあらぼ管理 shr_students の goal・next_action・next_mtg・track）を見ながら、
// 毎日の数字と日報、週の振り返りを付ける。目標の正本はしあらぼ管理（ここは読むだけ）。
// 日報・週報の正本は b_reports（会員の番号ごと）。シアニンはしあらぼ管理で読む（2 便目）。
// 生徒かどうかは、門番の別名の表（member_alias の kind=shr_student_id）で結ばれているかで決める。ゲストには出ない。

export const REPORT_KINDS = ["daily", "weekly"];
const TRACK_MAX = 3, NAME_MAX = 20, BODY_MAX = 2000;
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

// 書いたものを確かめる。日報は今日から 7 日前まで、週報は今週か先週（月曜の日付）だけ
export function checkReport(body = {}, today = jstDay()) {
  const kind = String(body.kind || "");
  if (!REPORT_KINDS.includes(kind)) return { ok: false, error: "bad_kind" };
  const day = String(body.day || "");
  if (!DAY_RE.test(day) || isNaN(Date.parse(day))) return { ok: false, error: "bad_day" };
  if (kind === "daily" && (day > today || day < addDays(today, -7))) return { ok: false, error: "day_out_of_range" };
  if (kind === "weekly") {
    if (weekStart(day) !== day) return { ok: false, error: "not_week_start" };
    const thisWeek = weekStart(today);
    if (day !== thisWeek && day !== addDays(thisWeek, -7)) return { ok: false, error: "day_out_of_range" };
  }
  const numbers = {};
  const src = body.numbers && typeof body.numbers === "object" && !Array.isArray(body.numbers) ? body.numbers : {};
  for (const [k, v] of Object.entries(src)) {
    const name = String(k).trim().slice(0, NAME_MAX);
    if (!name || v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) return { ok: false, error: "bad_number", name };
    numbers[name] = n;
    if (Object.keys(numbers).length > TRACK_MAX) return { ok: false, error: "too_many_numbers", max: TRACK_MAX };
  }
  const text = String(body.body ?? "").trim();
  if (text.length > BODY_MAX) return { ok: false, error: "body_too_long", max: BODY_MAX };
  if (!text && !Object.keys(numbers).length) return { ok: false, error: "empty" };
  return { ok: true, row: { kind, day, numbers, body: text } };
}


// ---------- 目標達成くん（2026-11-05）：13 週の設計。生徒が書き、ここが正本 ----------
const WEEKS = 13;
const LIM = { ideal: 200, when: 40, goal13: 200, strat: 300, kgi: 3, name: 30, unit: 10, bud: 12, budName: 20, ms: 13, msName: 80, kpi: 5, tasks: 20, task: 100, taskWhen: 30, res: 2000, hyp: 1000, bytes: 60000 };
const PALETTE = ["#94a3b8", "#cbd5e1", "#f9a8d4", "#86efac", "#4644c7", "#2b2a7a", "#fcd34d", "#a78bfa", "#67e8f9", "#fdba74"];
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const num = (v, lo, hi) => { const n = Number(String(v ?? "").replace(/[,，\s]/g, "")); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
const arr = (v) => (Array.isArray(v) ? v : []);
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
    const since = addDays(weekStart(today), -21);
    const rows = await h.rawDb(env, "GET", `b_reports?select=kind,day,numbers,body,updated_at&member_id=eq.${memberId}&day=gte.${since}&order=day.desc&limit=200`);
    return {
      ok: true, today, week: weekStart(today), last_week: addDays(weekStart(today), -7),
      goal: { text: s.goal || "", next_action: s.next_action || "", next_mtg: s.next_mtg || "", last_mtg: s.last_mtg || "", track: trackOf(s) },
      daily: rows.filter((r) => r.kind === "daily"), weekly: rows.filter((r) => r.kind === "weekly"),
      plan: await planOf(env, memberId, s, today),
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

  async function save(env, memberId, body, today = jstDay()) {
    if (!(await studentOf(env, memberId))) return { ok: false, error: "not_student" };
    const c = checkReport(body, today);
    if (!c.ok) return c;
    const [row] = await h.rawDb(env, "POST", "b_reports?on_conflict=member_id,kind,day",
      [{ member_id: memberId, ...c.row, updated_at: new Date().toISOString() }], "resolution=merge-duplicates,return=representation");
    return { ok: true, report: { kind: row.kind, day: row.day, numbers: row.numbers, body: row.body, updated_at: row.updated_at } };
  }

  return { view, save, savePlan, isStudent, studentOf };
}

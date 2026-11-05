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


// ---------- 6 便目（2026-11-05 Naoki 14:55「OK」）：面談の議事録から Claude が作った設計の下書き ----------
// 下書きは b_goal_drafts（会員ごとに 1 つ）。Claude の道具 set_goal_draft は「承認が要る」で、Naoki が承認して初めて入る。
// 生徒が「この設計で始める」を押すまで、生徒の設計（b_goal_plans）は変えない。入れるのは ①理想 ②KGI ③13 週（始める日・状態と KPI・予備の週）だけ。
// リソース予算と ④ 戦術・記録は下書きに入れない（生活の時間は議事録から読めないため）。
export function checkDraft(input) {
  const d = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!d) return { ok: false, error: "bad_draft" };
  const ms = arr(d.ms).slice(0, LIM.ms).map((m) => ({ n: m && m.n, kpi: arr(m && m.kpi).map((k) => ({ n: k && k.n, v: 0, to: k && k.to, u: k && k.u })) }));
  const c = checkPlan({ start: d.start, ideal: d.ideal, idealWhen: d.idealWhen, kgi: arr(d.kgi).map((k) => ({ n: k && k.n, v: k && k.v, to: k && k.to, u: k && k.u })),
    goal13: d.goal13, goal13Own: d.goal13 ? 1 : 0, spare: d.spare, ms });
  if (!c.ok) return c;
  const p = c.plan;
  const draft = { start: p.start, ideal: p.ideal, idealWhen: p.idealWhen, kgi: p.kgi, goal13: p.goal13, goal13Own: p.goal13Own, spare: p.spare, ms: p.ms.filter((m) => m.n).map((m) => ({ n: m.n, kpi: m.kpi.filter((k) => k.n) })) };
  if (!draft.ideal && !draft.kgi.length && !draft.ms.length) return { ok: false, error: "draft_empty" };
  return { ok: true, draft };
}

// 下書きを今の設計に重ねる。リソース予算（bud）と 13 週の記録（wk）・方針（strat）は今の設計のまま残す
export function mergeDraft(plan, draft, today = jstDay()) {
  return checkPlan({
    ...plan,
    start: draft.start, ideal: draft.ideal, idealWhen: draft.idealWhen, kgi: draft.kgi,
    goal13: draft.goal13, goal13Own: draft.goal13Own, spare: draft.spare, ext: {},
    ms: draft.ms.map((m) => ({ n: m.n, kpi: m.kpi.map((k) => ({ ...k, v: 0 })), tasks: [], res: "", hyp: "", resDone: 0, hypDone: 0 })),
  }, today);
}

// 承認の画面に出す 1 週ずつの並び（予備の週を飛ばして状態を置く。goalplan.js の place と同じ並べ方）
export function draftWeeks(draft) {
  const out = []; let j = 0;
  const md = (n) => { const t = new Date(Date.parse(draft.start + "T00:00:00Z") + (n - 1) * 7 * 86400000); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
  for (let n = 1; n <= WEEKS; n++) {
    if (draft.spare.includes(n)) { out.push(`第 ${n} 週（${md(n)}〜）予備の週`); continue; }
    const m = draft.ms[j++];
    out.push(m ? `第 ${n} 週（${md(n)}〜）${m.n}${m.kpi.length ? "／KPI：" + m.kpi.map((k) => `${k.n} ${Number(k.to || 0).toLocaleString("ja-JP")}${k.u}`).join("・") : ""}` : `第 ${n} 週（${md(n)}〜）（空き）`);
  }
  if (j < draft.ms.length) out.push(`並びきらない状態 ${draft.ms.length - j} 個（予備の週を減らすか、状態を減らす）`);
  return out;
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
      draft: await draftOf(env, memberId),
      reviews: await h.rawDb(env, "GET", `b_goal_reviews?select=week_start,week_no,submitted_at,approved_at,comment,report->rates,report->kgi,report->done&member_id=eq.${memberId}&order=week_start.desc&limit=20`),
    };
  }

  // まだ始めても、しまってもいない下書き（無ければ null）
  async function draftOf(env, memberId) {
    const [row] = await h.rawDb(env, "GET", `b_goal_drafts?select=draft,source,created_at,applied_at,dismissed_at&member_id=eq.${memberId}`);
    if (!row || row.applied_at || row.dismissed_at) return null;
    return { ...row.draft, source: row.source || "", created_at: row.created_at };
  }

  // しあらぼ管理の生徒の番号から会員をたどる（Claude の道具はこの番号で生徒を指す）
  async function memberOfStudent(env, studentId) {
    const sid = String(studentId ?? "").trim();
    if (!/^\d{1,9}$/.test(sid)) return { ok: false, error: "bad_student_id" };
    const [s] = await h.rawDb(env, "GET", `shr_students?select=id,name&id=eq.${sid}&archived=eq.false&deleted=eq.false`);
    if (!s) return { ok: false, error: "student_not_found" };
    const links = await h.rawDb(env, "GET", `member_alias?select=member_id&kind=eq.shr_student_id&value=eq.${sid}&limit=2`);
    if (!links.length) return { ok: false, error: "not_linked", note: "この生徒はまだマーケくんの会員と結ばれていない" };
    if (links.length > 1) return { ok: false, error: "linked_twice", note: "この生徒の番号に会員が 2 人以上結ばれている。結びを直してから" };
    return { ok: true, member_id: links[0].member_id, name: s.name || "" };
  }

  // 承認を頼む前に：中身をそろえ、承認の画面に出す名前と週の並びを足す（Naoki が読んで決められるように）
  async function prepareDraft(env, args) {
    const who = await memberOfStudent(env, args && args.student_id);
    if (!who.ok) return who;
    const c = checkDraft(args && args.draft);
    if (!c.ok) return c;
    return { ok: true, args: { student_id: Number(args.student_id), student_name: who.name, source: str(args.source, 120), draft: c.draft, weeks: draftWeeks(c.draft) } };
  }

  // 承認されたあとに入れる（同じ生徒の前の下書きは置き換える。生徒の設計には触らない）
  async function setDraft(env, args) {
    const pre = await prepareDraft(env, args);
    if (!pre.ok) return pre;
    const who = await memberOfStudent(env, args.student_id);
    await h.rawDb(env, "POST", "b_goal_drafts?on_conflict=member_id",
      [{ member_id: who.member_id, draft: pre.args.draft, source: pre.args.source, created_at: new Date().toISOString(), applied_at: null, dismissed_at: null, prev: null }], "resolution=merge-duplicates,return=minimal");
    return { ok: true, student_id: pre.args.student_id, student_name: pre.args.student_name, states: pre.args.draft.ms.length, note: "生徒の目標タブに「シアニンと決めた下書きがあります」が出る。生徒が「この設計で始める」を押すまで、生徒の設計は変わらない" };
  }

  // 生徒が下書きをどうするか：start＝この設計で始める・keep＝今のままにする・undo＝直前の start / keep を元に戻す
  async function draftAction(env, memberId, body, today = jstDay()) {
    const s = await studentOf(env, memberId);
    if (!s) return { ok: false, error: "not_student" };
    const action = body && body.action;
    const [row] = await h.rawDb(env, "GET", `b_goal_drafts?select=draft,prev,applied_at,dismissed_at&member_id=eq.${memberId}`);
    if (!row) return { ok: false, error: "no_draft" };
    const now = new Date().toISOString();
    const patch = (o) => h.rawDb(env, "PATCH", `b_goal_drafts?member_id=eq.${memberId}`, o, "return=minimal");
    if (action === "keep") {
      if (row.applied_at || row.dismissed_at) return { ok: false, error: "draft_closed" };
      await patch({ dismissed_at: now });
      return { ok: true };
    }
    if (action === "start") {
      if (row.applied_at || row.dismissed_at) return { ok: false, error: "draft_closed" };
      const [cur] = await h.rawDb(env, "GET", `b_goal_plans?select=plan&member_id=eq.${memberId}`);
      const base = cur && cur.plan && cur.plan.v ? checkPlan(cur.plan, today).plan : seedPlan(s, today);
      const m = mergeDraft(base, row.draft, today);
      if (!m.ok) return m;
      const [saved] = await h.rawDb(env, "POST", "b_goal_plans?on_conflict=member_id",
        [{ member_id: memberId, plan: m.plan, updated_at: now }], "resolution=merge-duplicates,return=representation");
      // 元に戻すために、始める前の設計を控える（設計が無かったときは null）
      await patch({ applied_at: now, prev: cur && cur.plan && cur.plan.v ? cur.plan : null });
      return { ok: true, plan: { ...saved.plan, saved_at: saved.updated_at } };
    }
    if (action === "undo") {
      if (row.applied_at) {
        if (row.prev) await h.rawDb(env, "POST", "b_goal_plans?on_conflict=member_id", [{ member_id: memberId, plan: row.prev, updated_at: now }], "resolution=merge-duplicates,return=minimal");
        else await h.rawDb(env, "DELETE", `b_goal_plans?member_id=eq.${memberId}`, undefined, "return=minimal");
      }
      await patch({ applied_at: null, dismissed_at: null, prev: null });
      return { ok: true, plan: await planOf(env, memberId, s, today), draft: await draftOf(env, memberId) };
    }
    return { ok: false, error: "bad_action" };
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

  return { view, savePlan, submitReview, isStudent, studentOf, prepareDraft, setDraft, draftAction };
}

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
    };
  }

  async function save(env, memberId, body, today = jstDay()) {
    if (!(await studentOf(env, memberId))) return { ok: false, error: "not_student" };
    const c = checkReport(body, today);
    if (!c.ok) return c;
    const [row] = await h.rawDb(env, "POST", "b_reports?on_conflict=member_id,kind,day",
      [{ member_id: memberId, ...c.row, updated_at: new Date().toISOString() }], "resolution=merge-duplicates,return=representation");
    return { ok: true, report: { kind: row.kind, day: row.day, numbers: row.numbers, body: row.body, updated_at: row.updated_at } };
  }

  return { view, save, isStudent, studentOf };
}

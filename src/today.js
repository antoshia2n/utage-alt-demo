// B の便 8f-1：シアニン用のホーム「今日の 1 枚」と、段階のボード。表は増やさない。
//   今日の予定 … Google カレンダーの「iCal 形式の非公開 URL」を表 b_settings の行に置き、毎回読む（写しは置かない）
//                 便 8f-2 で 2 つにした：既定のカレンダー（key=calendar_ics）と UTAGE のカレンダー（key=calendar_utage_ics・個別相談やセミナーの予約が入る）
//   やること   … 承認待ち・未返信の添削・今日の個別相談・今日の知らせ（どれも既にある記録から数える）
//                 便 8f-2 でタスクマスターの今日の分（期限が今日か過ぎている未完了）を足した。shia2n-mcp の TaskmasterReader をサービスの結びで読む（合言葉は要らない）
//   段階のボード … 人をお客さんの段階（設計図のレーン 7 つ）に振り分ける。出来事と権利と商談の段階から毎回計算する
// iCal の繰り返し（RRULE）は DAILY・WEEKLY・MONTHLY・YEARLY を広げる（便 8f-2 で「第 2 火曜」「月末の金曜」「毎月 15 日」などの形も広げた）。
// 時間ごと・分ごとの繰り返しは広げず、数と形（題名は入れない）を返す

import { LANES } from "./plan.js";

export const CALENDAR_KEY = "calendar_ics";
// 読み元のカレンダー。key は表 b_settings の行の名前
export const CALENDARS = [
  { which: "main", key: CALENDAR_KEY, label: "Google カレンダー" },
  { which: "utage", key: "calendar_utage_ics", label: "UTAGE のカレンダー" },
];
const ICS_URL_RE = /^https:[/][/]calendar[.]google[.]com[/]calendar[/]ical[/][^\s<>"']{10,480}[.]ics$/;
const JST = 9 * 3600e3;
const DAY = 864e5;
const WD = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

// 日本時間の日付（YYYY-MM-DD）と、その日の 0 時の UTC の時刻
export function jstDay(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
export function jstMidnightUtc(day) { return Date.parse(day + "T00:00:00Z") - JST; }

function unfold(text) { return String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function unescapeText(s) { return String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim(); }

// 「DTSTART;TZID=Asia/Tokyo:20261009T130000」などを読む。UTC の時刻と終日かどうかを返す。TZID の無い時刻と Asia/Tokyo 以外の TZID は日本時間として読む
export function parseIcsTime(name, value) {
  const v = String(value || "").trim();
  const params = String(name || "").toUpperCase();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || params.includes("VALUE=DATE")) {
    m = m || v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { ms: jstMidnightUtc(`${m[1]}-${m[2]}-${m[3]}`), allDay: true };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const utc = Date.parse(iso);
  return { ms: m[7] === "Z" ? utc : utc - JST, allDay: false };
}

export function parseIcs(text) {
  const lines = unfold(text).split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const name = line.slice(0, i), value = line.slice(i + 1);
    const key = name.split(";")[0].toUpperCase();
    if (key === "SUMMARY") cur.title = unescapeText(value);
    else if (key === "LOCATION") cur.location = unescapeText(value);
    else if (key === "UID") cur.uid = value.trim();
    else if (key === "STATUS") cur.status = value.trim().toUpperCase();
    else if (key === "DTSTART") cur.start = parseIcsTime(name, value);
    else if (key === "DTEND") cur.end = parseIcsTime(name, value);
    else if (key === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, x]) => [k.toUpperCase(), x]));
    else if (key === "EXDATE") for (const x of value.split(",")) { const t = parseIcsTime(name, x); if (t) cur.exdates.push(jstDay(t.ms)); }
    else if (key === "RECURRENCE-ID") cur.recurrenceId = parseIcsTime(name, value);
  }
  return events;
}

// その月の中で当たる日（1〜31 の集まり）。BYMONTHDAY（-1 は月末）・BYDAY（2TU＝第 2 火曜・-1FR＝最後の金曜・TU＝毎週火曜）・BYSETPOS（候補の何番目か）を読む。
// どれも無ければ始めの日と同じ日付
export function monthDays(y, m, r, startDate) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let days = [];
  if (r.BYMONTHDAY) {
    for (const x of r.BYMONTHDAY.split(",").map(Number)) { const v = x < 0 ? last + 1 + x : x; if (v >= 1 && v <= last) days.push(v); }
  } else if (r.BYDAY) {
    for (const code of r.BYDAY.split(",")) {
      const wd = WD[code.slice(-2)];
      if (wd === undefined) continue;
      const all = [];
      for (let v = 1; v <= last; v++) if (new Date(Date.UTC(y, m - 1, v)).getUTCDay() === wd) all.push(v);
      const n = code.length > 2 ? parseInt(code.slice(0, -2), 10) : 0;
      if (!n) days.push(...all);
      else { const v = n > 0 ? all[n - 1] : all[all.length + n]; if (v) days.push(v); }
    }
  } else if (startDate <= last) days.push(startDate);
  days = [...new Set(days)].sort((a, b) => a - b);
  if (r.BYSETPOS) days = r.BYSETPOS.split(",").map(Number).map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter(Boolean);
  return new Set(days);
}

// 繰り返しの決まりで、その日（日本時間の日付）に当たるか。広げられない形は null
export function occursOn(ev, day) {
  const startDay = jstDay(ev.start.ms);
  if (day < startDay) return false;
  // 何日も続く終日の予定（繰り返し無し）は、続いている日すべてに出す
  if (!ev.rrule) return day === startDay || (!!ev.start.allDay && !!ev.end && day < jstDay(ev.end.ms));
  const r = ev.rrule;
  const interval = Math.max(parseInt(r.INTERVAL || "1", 10) || 1, 1);
  if (r.UNTIL) { const u = parseIcsTime(r.UNTIL.length === 8 ? "VALUE=DATE" : "", r.UNTIL); if (u && day > jstDay(u.ms)) return false; }
  if (ev.exdates.includes(day)) return false;
  const match = (d) => {
    const diff = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(startDay + "T00:00:00Z")) / DAY);
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), dd = Number(d.slice(8));
    const sy = Number(startDay.slice(0, 4)), sm = Number(startDay.slice(5, 7)), sd = Number(startDay.slice(8));
    if (r.BYMONTH && !r.BYMONTH.split(",").map(Number).includes(m)) return false;
    if (r.FREQ === "DAILY") return diff % interval === 0 && (!r.BYDAY || r.BYDAY.split(",").map((x) => WD[x.slice(-2)]).includes(dow));
    if (r.FREQ === "WEEKLY") {
      const days = r.BYDAY ? r.BYDAY.split(",").map((x) => WD[x.slice(-2)]) : [new Date(startDay + "T00:00:00Z").getUTCDay()];
      const monday = (x) => { const t = Date.parse(x + "T00:00:00Z"); const w = (new Date(t).getUTCDay() + 6) % 7; return t - w * DAY; };
      const weeks = Math.round((monday(d) - monday(startDay)) / (7 * DAY));
      return weeks % interval === 0 && days.includes(dow);
    }
    if (r.FREQ === "MONTHLY") {
      const months = (y - sy) * 12 + m - sm;
      return months % interval === 0 && monthDays(y, m, r, sd).has(dd);
    }
    if (r.FREQ === "YEARLY") {
      if ((y - sy) % interval !== 0) return false;
      if (!r.BYMONTH && m !== sm) return false;
      return monthDays(y, m, r, sd).has(dd);
    }
    return null;
  };
  const hit = match(day);
  if (hit !== true) return hit;
  if (r.COUNT) {
    // 始めの日からその日までに当たった回数が COUNT を超えていないか（多くても 10 年分）
    const limit = parseInt(r.COUNT, 10);
    let n = 0;
    for (let t = Date.parse(startDay + "T00:00:00Z"), end = Date.parse(day + "T00:00:00Z"), i = 0; t <= end && i < 3700; t += DAY, i++) {
      const dd = new Date(t).toISOString().slice(0, 10);
      if (!ev.exdates.includes(dd) && match(dd) === true) n++;
    }
    if (n > limit) return false;
  }
  return true;
}

// その日の予定（日本時間）。取り消された予定と、別に書き直された回の元は出さない
export function eventsOn(events, day) {
  const moved = new Set(events.filter((e) => e.recurrenceId && e.uid).map((e) => `${e.uid}|${jstDay(e.recurrenceId.ms)}`));
  const out = [];
  let skipped = 0;
  const shapes = new Set();
  for (const e of events) {
    if (!e.start || e.status === "CANCELLED") continue;
    if (!e.recurrenceId && e.uid && moved.has(`${e.uid}|${day}`)) continue;
    const hit = e.recurrenceId ? jstDay(e.start.ms) === day : occursOn(e, day);
    if (hit === null) { skipped++; shapes.add(Object.keys(e.rrule || {}).filter((k) => /^(FREQ|BY)/.test(k)).map((k) => k === "FREQ" ? e.rrule.FREQ : k).join(";")); continue; }
    if (!hit) continue;
    const dur = e.end ? e.end.ms - e.start.ms : (e.start.allDay ? DAY : 0);
    const startMs = e.start.allDay ? jstMidnightUtc(day) : jstMidnightUtc(day) + ((e.start.ms + JST) % DAY);
    out.push({ title: e.title || "（題名なし）", all_day: !!e.start.allDay, start: new Date(startMs).toISOString(), end: new Date(startMs + dur).toISOString(), location: e.location || "" });
  }
  out.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
  return { events: out, skipped, shapes: [...shapes] };
}

// 段階（レーン）の振り分け。上から順に見て、最初に当たったもの
export function stageOf({ labels = [], deal = "none", logins = 0 }) {
  const has = (x) => labels.includes(x);
  // 便 8g-2：誰かを紹介した人は、いちばん先の段階「紹介」
  if (has("紹介した")) return "refer";
  if (has("会員") || has("教材を見た")) return "learn";
  if (has("購入者") || deal === "won") return "buy";
  if (deal === "booked" || deal === "done" || has("個別相談を予約した")) return "consult";
  if (has("リンクを押した") || has("セミナーに申し込んだ") || logins > 0) return "warm";
  return "signup";
}

export function makeToday(h) {
  const { db, logInbound, connect, bin4, guard, listRooms } = h;

  const calOf = (which) => CALENDARS.find((c) => c.which === (which || "main"));

  async function calendarUrl(env, which = "main") {
    const cal = calOf(which);
    if (!cal) return { url: "", updated_at: null, updated_by: null };
    const rows = await db(env, "GET", `settings?select=value,updated_at,updated_by&key=eq.${cal.key}`);
    return rows.length ? { url: rows[0].value || "", updated_at: rows[0].updated_at, updated_by: rows[0].updated_by } : { url: "", updated_at: null, updated_by: null };
  }

  // 読み元ごとの「入っているか」（画面と AI の返事用。URL そのものは返さない）
  async function calendarStatus(env) {
    const out = [];
    for (const c of CALENDARS) {
      const u = await calendarUrl(env, c.which);
      out.push({ which: c.which, label: c.label, set: !!u.url, shown: maskUrl(u.url), updated_at: u.updated_at, updated_by: u.updated_by });
    }
    return out;
  }

  // 非公開の URL そのものは返さない（画面には「入っているか」と末尾 6 文字だけ）
  function maskUrl(u) { return u ? `…${u.slice(-10, -4)}.ics` : ""; }

  async function setCalendarUrl(env, { url, which }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const cal = calOf(which);
    if (!cal) return { ok: false, error: "bad_which", allowed: CALENDARS.map((c) => c.which) };
    const v = String(url == null ? "" : url).trim();
    if (v && !ICS_URL_RE.test(v)) return { ok: false, error: "bad_url", note: "Google カレンダーの設定「iCal 形式の非公開アドレス」（https://calendar.google.com/calendar/ical/ で始まり .ics で終わる）。外すときは空にする" };
    const other = CALENDARS.filter((c) => c.which !== cal.which);
    for (const o of other) { const u = await calendarUrl(env, o.which); if (v && u.url === v) return { ok: false, error: "same_as_other", note: `${o.label}と同じ URL です` }; }
    const before = await calendarUrl(env, cal.which);
    await db(env, "POST", "settings?on_conflict=key", [{ key: cal.key, value: v, updated_at: new Date().toISOString(), updated_by: String(actor).slice(0, 200) }], "resolution=merge-duplicates,return=minimal");
    // 非公開の URL は「変えた記録」（AI からも読める・元に戻すで書き戻す）に残さない。入れた・外したことだけを受け口の記録に残す
    await logInbound(env, "calendar_set", { actor, which: cal.which, cleared: !v, had_before: !!before.url }, { ok: true }, 200);
    return { ok: true, which: cal.which, set: !!v, shown: maskUrl(v) };
  }

  async function readCalendar(env, cal, day) {
    const c = await calendarUrl(env, cal.which);
    if (!c.url) return { which: cal.which, label: cal.label, state: "unset", events: [] };
    try {
      const res = await fetch(c.url, { headers: { accept: "text/calendar" } });
      if (!res.ok) return { which: cal.which, label: cal.label, state: "error", error: `status_${res.status}`, events: [] };
      const r = eventsOn(parseIcs(await res.text()), day);
      return { which: cal.which, label: cal.label, state: "ok", events: r.events.map((e) => ({ ...e, source: cal.which })), not_expanded: r.skipped, not_expanded_shapes: r.shapes, shown: maskUrl(c.url) };
    } catch (e) {
      return { which: cal.which, label: cal.label, state: "error", error: String(e && e.message || e).slice(0, 120), events: [] };
    }
  }

  // 2 つの読み元を 1 つの並びにまとめる。state は「どれか 1 つでも入っていれば ok か error」、全部無ければ unset
  async function calendarToday(env, day) {
    const parts = await Promise.all(CALENDARS.map((c) => readCalendar(env, c, day)));
    const events = parts.flatMap((p) => p.events);
    events.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
    const anySet = parts.some((p) => p.state !== "unset");
    const anyOk = parts.some((p) => p.state === "ok");
    return {
      state: !anySet ? "unset" : anyOk ? "ok" : "error",
      error: anyOk ? undefined : parts.find((p) => p.state === "error")?.error,
      events,
      not_expanded: parts.reduce((n, p) => n + (p.not_expanded || 0), 0),
      not_expanded_shapes: [...new Set(parts.flatMap((p) => p.not_expanded_shapes || []))],
      sources: parts.map((p) => ({ which: p.which, label: p.label, state: p.state, count: p.events.length, error: p.error })),
    };
  }

  // タスクマスターの今日の分。shia2n-mcp の TaskmasterReader をサービスの結び（env.TASKMASTER）で呼ぶ。結びが無い・読めないときは state で返す
  async function tasksToday(env, day) {
    if (!env.TASKMASTER || typeof env.TASKMASTER.today !== "function") return { state: "unset", due_count: 0, overdue_count: 0, due: [], overdue: [] };
    try {
      const r = await env.TASKMASTER.today(day);
      if (!r || r.ok === false) return { state: "error", error: String(r && r.error || "no_result").slice(0, 120), due_count: 0, overdue_count: 0, due: [], overdue: [] };
      return { state: "ok", due_count: r.due_count, overdue_count: r.overdue_count, due: r.due || [], overdue: r.overdue || [] };
    } catch (e) {
      return { state: "error", error: String(e && e.message || e).slice(0, 120), due_count: 0, overdue_count: 0, due: [], overdue: [] };
    }
  }

  async function board(env) {
    const [people, lm, dm] = await Promise.all([
      db(env, "GET", "customer_summary?select=id,name,email,login_count,last_event_at&limit=10000"),
      connect.labelMap(env),
      bin4.dealMap(env),
    ]);
    const lanes = LANES.map((l) => ({ ...l, people: [] }));
    const byId = Object.fromEntries(lanes.map((l) => [l.id, l]));
    for (const p of people) {
      const labels = (lm.get(p.id) || []).map((x) => x.label);
      const st = stageOf({ labels, deal: dm[p.id] ? dm[p.id].stage : "none", logins: p.login_count || 0 });
      byId[st].people.push({ id: p.id, name: p.name || "", email: p.email, last_event_at: p.last_event_at, deal: dm[p.id] ? dm[p.id].stage : "none" });
    }
    for (const l of lanes) l.people.sort((a, b) => String(b.last_event_at || "").localeCompare(String(a.last_event_at || "")));
    return { ok: true, total: people.length, lanes: lanes.map((l) => ({ id: l.id, label: l.label, count: l.people.length, people: l.people.slice(0, 50) })),
      note: "出会う（まだ登録していない人）は記録が無いので 0。段階は上から 紹介（その人のリンクから誰かが登録した）→ 受講（会員か教材を見た）→ 購入 → 相談 → 温める（リンクを押した・セミナー・ログイン）→ 登録" };
  }

  async function today(env, now = Date.now()) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const day = jstDay(now);
    const from = new Date(jstMidnightUtc(day)).toISOString();
    const [cal, tasks, approvals, rooms, consults, notices, b] = await Promise.all([
      calendarToday(env, day),
      tasksToday(env, day),
      guard.listApprovals(env, { status: "pending" }),
      listRooms(env, { only_unreplied: true }),
      bin4.listConsults(env, {}),
      db(env, "GET", `events?select=customer_id,payload,occurred_at&type=eq.admin_notified&occurred_at=gte.${encodeURIComponent(from)}&order=occurred_at.desc&limit=50`),
      board(env),
    ]);
    const todayConsults = (consults.consults || []).filter((c) => jstDay(Date.parse(c.slot)) === day);
    const ids = [...new Set(notices.map((n) => n.customer_id))];
    const names = ids.length ? Object.fromEntries((await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`)).map((p) => [p.id, p.name || p.email])) : {};
    const steps = notices.length ? Object.fromEntries((await db(env, "GET", `b_steps?select=id,name&id=in.(${[...new Set(notices.map((n) => n.payload.step_id))].join(",")})`)).map((s) => [s.id, s.name])) : {};
    return {
      ok: true, day,
      calendar: cal,
      tasks,
      todo: {
        approvals: { count: (approvals.approvals || []).length, items: (approvals.approvals || []).slice(0, 10).map((a) => ({ id: a.id, tool: a.tool, created_at: a.created_at })) },
        rooms: { count: rooms.unreplied_total || 0, items: (rooms.rooms || []).slice(0, 10).map((r) => ({ person_id: r.person_id, name: r.name || r.email, unreplied: r.unreplied })) },
        consults: { count: todayConsults.length, items: todayConsults.map((c) => ({ person_id: c.person_id, name: c.name || c.email, slot: c.slot, topic: c.topic })) },
        notices: { count: notices.length, items: notices.slice(0, 10).map((n) => ({ person_id: n.customer_id, name: names[n.customer_id] || "", connector: steps[n.payload.step_id] || `コネクタ ${n.payload.step_id}`, at: n.occurred_at })) },
      },
      stages: b.lanes.map((l) => ({ id: l.id, label: l.label, count: l.count })),
    };
  }

  return { today, board, calendarUrl, calendarStatus, setCalendarUrl, maskUrl };
}

// B の便 8f-1：シアニン用のホーム「今日の 1 枚」と、段階のボード。表は増やさない。
//   今日の予定 … Google カレンダーの「iCal 形式の非公開 URL」を表 b_settings の 1 行（key=calendar_ics）に置き、毎回読む（写しは置かない）
//   やること   … 承認待ち・未返信の添削・今日の個別相談・今日の知らせ（どれも既にある記録から数える）
//   段階のボード … 人をお客さんの段階（設計図のレーン 7 つ）に振り分ける。出来事と権利と商談の段階から毎回計算する
// iCal の繰り返し（RRULE）は DAILY・WEEKLY・MONTHLY（同じ日付）・YEARLY だけを広げる。「第 2 火曜」のような形は広げず、数を返す

import { LANES } from "./plan.js";

export const CALENDAR_KEY = "calendar_ics";
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
    if (r.FREQ === "DAILY") return diff % interval === 0;
    if (r.FREQ === "WEEKLY") {
      const days = r.BYDAY ? r.BYDAY.split(",").map((x) => WD[x.slice(-2)]) : [new Date(startDay + "T00:00:00Z").getUTCDay()];
      const monday = (x) => { const t = Date.parse(x + "T00:00:00Z"); const w = (new Date(t).getUTCDay() + 6) % 7; return t - w * DAY; };
      const weeks = Math.round((monday(d) - monday(startDay)) / (7 * DAY));
      return weeks % interval === 0 && days.includes(dow);
    }
    if (r.FREQ === "MONTHLY") {
      if (r.BYDAY) return null;
      const months = (Number(d.slice(0, 4)) - Number(startDay.slice(0, 4))) * 12 + Number(d.slice(5, 7)) - Number(startDay.slice(5, 7));
      return months % interval === 0 && d.slice(8) === startDay.slice(8);
    }
    if (r.FREQ === "YEARLY") return d.slice(5) === startDay.slice(5) && (Number(d.slice(0, 4)) - Number(startDay.slice(0, 4))) % interval === 0;
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
  for (const e of events) {
    if (!e.start || e.status === "CANCELLED") continue;
    if (!e.recurrenceId && e.uid && moved.has(`${e.uid}|${day}`)) continue;
    const hit = e.recurrenceId ? jstDay(e.start.ms) === day : occursOn(e, day);
    if (hit === null) { skipped++; continue; }
    if (!hit) continue;
    const dur = e.end ? e.end.ms - e.start.ms : (e.start.allDay ? DAY : 0);
    const startMs = e.start.allDay ? jstMidnightUtc(day) : jstMidnightUtc(day) + ((e.start.ms + JST) % DAY);
    out.push({ title: e.title || "（題名なし）", all_day: !!e.start.allDay, start: new Date(startMs).toISOString(), end: new Date(startMs + dur).toISOString(), location: e.location || "" });
  }
  out.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
  return { events: out, skipped };
}

// 段階（レーン）の振り分け。上から順に見て、最初に当たったもの
export function stageOf({ labels = [], deal = "none", logins = 0 }) {
  const has = (x) => labels.includes(x);
  if (has("会員") || has("教材を見た")) return "learn";
  if (has("購入者") || deal === "won") return "buy";
  if (deal === "booked" || deal === "done" || has("個別相談を予約した")) return "consult";
  if (has("リンクを押した") || has("セミナーに申し込んだ") || logins > 0) return "warm";
  return "signup";
}

export function makeToday(h) {
  const { db, logInbound, connect, bin4, guard, listRooms } = h;

  async function calendarUrl(env) {
    const rows = await db(env, "GET", `settings?select=value,updated_at,updated_by&key=eq.${CALENDAR_KEY}`);
    return rows.length ? { url: rows[0].value || "", updated_at: rows[0].updated_at, updated_by: rows[0].updated_by } : { url: "", updated_at: null, updated_by: null };
  }

  // 非公開の URL そのものは返さない（画面には「入っているか」と末尾 6 文字だけ）
  function maskUrl(u) { return u ? `…${u.slice(-10, -4)}.ics` : ""; }

  async function setCalendarUrl(env, { url }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const v = String(url == null ? "" : url).trim();
    if (v && !ICS_URL_RE.test(v)) return { ok: false, error: "bad_url", note: "Google カレンダーの設定「iCal 形式の非公開 URL」（https://calendar.google.com/calendar/ical/ で始まり .ics で終わる）。外すときは空にする" };
    const before = await calendarUrl(env);
    await db(env, "POST", "settings?on_conflict=key", [{ key: CALENDAR_KEY, value: v, updated_at: new Date().toISOString(), updated_by: String(actor).slice(0, 200) }], "resolution=merge-duplicates,return=minimal");
    // 非公開の URL は「変えた記録」（AI からも読める・元に戻すで書き戻す）に残さない。入れた・外したことだけを受け口の記録に残す
    await logInbound(env, "calendar_set", { actor, cleared: !v, had_before: !!before.url }, { ok: true }, 200);
    return { ok: true, set: !!v, shown: maskUrl(v) };
  }

  async function calendarToday(env, day) {
    const c = await calendarUrl(env);
    if (!c.url) return { state: "unset", events: [] };
    try {
      const res = await fetch(c.url, { headers: { accept: "text/calendar" } });
      if (!res.ok) return { state: "error", error: `status_${res.status}`, events: [] };
      const r = eventsOn(parseIcs(await res.text()), day);
      return { state: "ok", events: r.events, not_expanded: r.skipped, shown: maskUrl(c.url) };
    } catch (e) {
      return { state: "error", error: String(e && e.message || e).slice(0, 120), events: [] };
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
      note: "出会う（まだ登録していない人）と紹介は記録が無いので 0。段階は上から 受講（会員か教材を見た）→ 購入 → 相談 → 温める（リンクを押した・セミナー・ログイン）→ 登録" };
  }

  async function today(env, now = Date.now()) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const day = jstDay(now);
    const from = new Date(jstMidnightUtc(day)).toISOString();
    const [cal, approvals, rooms, consults, notices, b] = await Promise.all([
      calendarToday(env, day),
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
      todo: {
        approvals: { count: (approvals.approvals || []).length, items: (approvals.approvals || []).slice(0, 10).map((a) => ({ id: a.id, tool: a.tool, created_at: a.created_at })) },
        rooms: { count: rooms.unreplied_total || 0, items: (rooms.rooms || []).slice(0, 10).map((r) => ({ person_id: r.person_id, name: r.name || r.email, unreplied: r.unreplied })) },
        consults: { count: todayConsults.length, items: todayConsults.map((c) => ({ person_id: c.person_id, name: c.name || c.email, slot: c.slot, topic: c.topic })) },
        notices: { count: notices.length, items: notices.slice(0, 10).map((n) => ({ person_id: n.customer_id, name: names[n.customer_id] || "", connector: steps[n.payload.step_id] || `コネクタ ${n.payload.step_id}`, at: n.occurred_at })) },
      },
      stages: b.lanes.map((l) => ({ id: l.id, label: l.label, count: l.count })),
    };
  }

  return { today, board, calendarUrl, setCalendarUrl, maskUrl };
}

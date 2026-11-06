// B の便 13b：個別相談の予約（2026-10-10 Naoki「進めて」）。
// 表は 1 本（supabase/b13b_booking.sql）。
//   b_booking_types … 予約の種類（名前・長さ・受け付ける曜日と時間帯・何日先まで・何時間前まで・Zoom・サンクスページ・受付と前日の知らせの文）
// 予約そのものは表を増やさず、今までどおり出来事 consult_booked（slot・type_id・minutes・topic）に積む。
//   便 4 の商談の段階（相談予約 → 面談済 → 成約／失注）とホームの「今日の個別相談」がそのまま使える。
// 空き時間：受け付ける曜日と時間帯を長さで刻み、
//   ① いまから「何時間前まで」より近いもの ② ほかの予約（どの種類でも）と重なるもの ③ Naoki の Google カレンダーの予定と重なるもの（終日の予定は除く）
//   を外す。カレンダーは便 8f で入れた iCal の非公開 URL（既定と UTAGE の 2 つ）を読む（today.js の busyBetween）。
// 予約の窓口はページの中の印 data-lab-part="booking:住所の名前"（lp.shia2n.jp）。ログイン不要で、名前とメールで予約する。
// 受付のメールはすぐ、前日の知らせは定時の処理（毎時 7 分）で送る。どちらも手続きのメール（kind=booking_notice）。
// 2026-11-05（Naoki OK）：生徒にも生徒以外にも使える形にした。種類ごとに
//   audience（public＝ページに置く／member＝マイページで会員が予約）・entitlements（member で予約できる権利）・
//   questions（予約のときに聞く質問）・after_actions（予約のあとに書く先。shr_next_mtg＝しあらぼ管理の「次の面談」）を持つ。
//   答えは出来事 consult_booked の answers に [{label, value}] で積む（質問を直しても、その時の問いが残る）。

import { fmtJst, parseStart } from "./seminars.js";
import { eventActor } from "./connect.js";
import { putMember } from "./plan.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const URL_RE = /^https:[/][/][^\s<>"']{4,490}$/;
const TIMES_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
const JST = 9 * 3600e3;
const DAY = 864e5;
const WINDOW_MS = 3 * 3600e3;
const now = () => new Date().toISOString();
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
export const AUDIENCES = ["public", "member"];
export const AFTER_ACTIONS = ["shr_next_mtg"];
// 回答形式：短文・長文・単一選択・複数選択・数値（選択式は options に選択肢）
export const Q_KINDS = ["text", "textarea", "radio", "check", "number"];
const CHOICE = new Set(["radio", "check"]);

// 質問の並びを確かめて整える。合わなければ { error }
export function cleanQuestions(list) {
  if (list == null) return { questions: [] };
  if (!Array.isArray(list) || list.length > 12) return { error: "bad_questions", note: "質問は 12 問まで" };
  const out = [], keys = new Set();
  for (const [i, q] of list.entries()) {
    const label = String((q && q.label) || "").trim();
    if (!label || label.length > 80) return { error: "bad_question_label", note: `${i + 1} 問目の問い（1〜80 字）` };
    const key = String((q && q.key) || `q${i + 1}`).trim().toLowerCase();
    if (!KEY_RE.test(key) || keys.has(key)) return { error: "bad_question_key", note: `${i + 1} 問目の key` };
    keys.add(key);
    const kind = Q_KINDS.includes(q.kind) ? q.kind : "textarea";
    const row = { key, label, kind, required: !!q.required, hint: CHOICE.has(kind) ? "" : String(q.hint || "").slice(0, 1000) };
    if (CHOICE.has(kind)) {
      const opts = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => String(o || "").trim()).filter(Boolean))];
      if (opts.length < 2 || opts.length > 20 || opts.some((o) => o.length > 60)) return { error: "bad_question_options", note: `${i + 1} 問目の選択肢（2〜20 個・1 つ 60 字まで）` };
      row.options = opts;
    }
    out.push(row);
  }
  return { questions: out };
}

// 答えを確かめる。返すのは [{key,label,value}]（問いの並び順）。足りなければ { error, key }
export function cleanAnswers(questions, answers) {
  const a = answers && typeof answers === "object" ? answers : {};
  const out = [];
  for (const q of questions || []) {
    const raw = a[q.key];
    if (q.kind === "check") {
      const vals = [...new Set((Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw]).map((x) => String(x).trim()))];
      if (vals.some((x) => !(q.options || []).includes(x))) return { error: "bad_answer", key: q.key, label: q.label };
      if (q.required && !vals.length) return { error: "answer_required", key: q.key, label: q.label };
      out.push({ key: q.key, label: q.label, value: vals.join("、"), values: vals });
      continue;
    }
    let v = String(raw ?? "").trim().slice(0, q.kind === "text" ? 200 : 4000);
    if (q.required && !v) return { error: "answer_required", key: q.key, label: q.label };
    if (v && q.kind === "radio" && !(q.options || []).includes(v)) return { error: "bad_answer", key: q.key, label: q.label };
    if (v && q.kind === "number") {
      const n = v.replace(/[,，\s]/g, "").replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      if (!/^-?\d+(\.\d+)?$/.test(n) || n.length > 20) return { error: "bad_number", key: q.key, label: q.label };
      v = n;
    }
    out.push({ key: q.key, label: q.label, value: v });
  }
  return { answers: out };
}

// 会員の予約：その人の会員プラン（権利）か、個別に許可されたユーザーか
// 管理者は止めている種類も見られる（受け付ける前に、マイページでの見え方を確かめるため）
export function canBook(type, ent, admin, customerId) {
  if (!type || type.audience !== "member" || type.archived_at) return false;
  if (admin) return true;
  if (!type.active) return false;
  if (customerId && (type.allowed_members || []).includes(customerId)) return true;
  const g = new Set((ent && ent.grants) || []);
  return (type.entitlements || []).some((k) => g.has(k));
}

// 終わりの時刻（日本時間の「HH:MM」）
export function endLabel(iso, minutes) {
  const d = new Date(Date.parse(iso) + (minutes || 30) * 60e3 + 9 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// メールの差し込み {{answers}}：問いと答えを並べる
export function answersText(answers) {
  return (answers || []).filter((x) => x.value).map((x) => `■ ${x.label}\n${x.value}`).join("\n\n") || "（なし）";
}

export const DEFAULT_TEXTS = {
  confirm_subject: "【ご予約を受け付けました】{{title}}",
  confirm_body: "{{name}} さん\n\n{{title}} のご予約を受け付けました。\n\n日時：{{date}}（{{minutes}} 分）\n参加の URL（Zoom）：{{zoom}}\nご相談の内容：{{topic}}\n\n前日にもう一度お知らせします。\n日時の変更や取り消しは、このメールに返信してお知らせください。",
  remind_subject: "【明日です】{{title}}",
  remind_body: "{{name}} さん\n\n明日、{{title}} があります。\n\n日時：{{date}}（{{minutes}} 分）\n参加の URL（Zoom）：{{zoom}}\n\nお時間になりましたら、上の URL から入ってください。",
};

// 「10:00-12:00,20:00-22:00」を分の区間に。合わなければ null
export function parseTimes(s) {
  const out = [];
  for (const part of String(s || "").split(/[,、\s]+/).filter(Boolean)) {
    const m = part.match(TIMES_RE);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (+m[2] > 59 || +m[4] > 59 || a >= b || b > 24 * 60) return null;
    out.push([a, b]);
  }
  return out.length ? out : null;
}

// 曜日ごとの受付時間 {0..6: [[開始分, 終了分], ...]}。week_hours が無ければ今までの weekdays＋times から作る
export function weekHours(type) {
  const out = {};
  if (type.week_hours && typeof type.week_hours === "object") {
    for (let w = 0; w <= 6; w++) out[w] = Array.isArray(type.week_hours[w]) ? type.week_hours[w] : [];
    return out;
  }
  const ranges = parseTimes(type.times) || [];
  const wds = new Set((type.weekdays || []).map(Number));
  for (let w = 0; w <= 6; w++) out[w] = wds.has(w) ? ranges : [];
  return out;
}
const jstDay = (ms) => new Date(ms + JST).toISOString().slice(0, 10);

// 受け付ける枠の候補（日本時間）。特定日の設定があればその日はそちら。t は「いま」、minutes は所要時間
export function candidates(type, t = Date.now(), minutes = type.minutes) {
  const wk = weekHours(type), ov = type.date_overrides || {};
  const len = minutes * 60e3, step = (type.slot_step || minutes) * 60e3;
  const earliest = t + (type.min_notice_hours || 0) * 3600e3;
  const today = Date.parse(jstDay(t) + "T00:00:00Z") - JST; // 今日の 0 時（日本時間）の UTC
  const out = [];
  for (let d = 0; d <= (type.days_ahead || 14); d++) {
    const day0 = today + d * DAY, key = jstDay(day0);
    const ranges = Array.isArray(ov[key]) ? ov[key] : wk[new Date(day0 + JST).getUTCDay()];
    for (const [a, b] of ranges) {
      for (let s = day0 + a * 60e3; s + len <= day0 + b * 60e3; s += step) if (s >= earliest) out.push(s);
    }
  }
  return out;
}

const overlaps = (s, e, list) => list.some((x) => s < x.end && x.start < e);

// 空き時間：候補から、ほかの予約・予定と重なる枠（前後のバッファ込み）と、1 日の上限に達した日を外す
// booked は {start, end, type_id}。上限は同じメニュー（type.id）の予約で数える
export function freeSlots(type, { booked = [], busy = [] } = {}, t = Date.now(), minutes = type.minutes) {
  const len = minutes * 60e3, pre = (type.buffer_before || 0) * 60e3, post = (type.buffer_after || 0) * 60e3;
  // ほかの予約も、その前後のバッファぶん押さえる（続けて入ると、あいだは「後」＋「前」になる）
  const held = booked.map((b) => ({ start: b.start - pre, end: b.end + post }));
  const perDay = new Map();
  if (type.max_per_day) for (const b of booked) if (b.type_id && b.type_id === type.id) { const k = jstDay(b.start); perDay.set(k, (perDay.get(k) || 0) + 1); }
  return candidates(type, t, minutes)
    .filter((s) => !overlaps(s - pre, s + len + post, held) && !overlaps(s - pre, s + len + post, busy))
    .filter((s) => !type.max_per_day || (perDay.get(jstDay(s)) || 0) < type.max_per_day)
    .map((s) => new Date(s).toISOString());
}

// 予約する人が選べる所要時間（いちばん目が既定）
// 予約者が自分で変更・キャンセルできる期限を過ぎたか
export const tooLate = (type, slot, at = Date.now()) => type.cancel_hours != null && Date.parse(slot) - at < type.cancel_hours * 3600e3;
export const lengthsOf = (type) => { const d = (type.durations || []).filter((m) => Number.isInteger(m)); return d.length ? d : [type.minutes]; };

// 受付時間の検査：[[開始分, 終了分], ...]（5 分刻み・重ならない・1 日 8 つまで）
export function cleanRanges(v) {
  if (!Array.isArray(v) || v.length > 8) return null;
  const out = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2) return null;
    const [a, b] = r.map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a % 5 || b % 5 || a < 0 || b > 1440 || a >= b) return null;
    out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < out.length; i++) if (out[i][0] < out[i - 1][1]) return null;
  return out;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanOverrides(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > 120) return null;
  const out = {};
  for (const k of keys.sort()) {
    if (!DATE_RE.test(k) || Number.isNaN(Date.parse(k + "T00:00:00Z"))) return null;
    const r = cleanRanges(v[k]);
    if (!r) return null;
    out[k] = r;
  }
  return out;
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const rangesText = (rs) => rs.map(([a, b]) => `${hm(a)}-${hm(b)}`).join(",");

export const SIGN = "シアニン（シアラボ）";
export function render(text, type, b, person, extra = {}) {
  const map = {
    booking_url: (type.audience || "public") === "member" ? "https://lab.shia2n.jp/app#booking" : "", sign: SIGN, ...extra,
    name: (person && person.name) || "", email: (person && person.email) || "",
    title: type.title, date: fmtJst(b.slot), minutes: String(b.minutes || type.minutes),
    zoom: type.zoom_url || "（追ってお知らせします）", end: endLabel(b.slot, b.minutes || type.minutes), topic: b.topic || "（未記入）", answers: answersText(b.answers),
  };
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
}

// 通知の並び（便④）：いつ（予約した直後・開始の◯分前・終わって◯分後・キャンセルされたとき）× どのテンプレート
// 差し込み項目（テンプレートの {{…}}）
export const TPL_KEYS = { name: "名前", title: "メニュー名", date: "日時", end: "終了時刻", minutes: "所要時間", zoom: "Zoom の URL", answers: "フォームの回答", topic: "相談したいこと", booking_url: "予約ページ", sign: "署名" };
export const REMIND_WHEN = ["booked", "before", "after", "canceled"];
export function cleanReminders(v) {
  if (!Array.isArray(v) || v.length > 10) return { error: "bad_reminders", note: "通知は 10 件まで" };
  const out = [], keys = new Set();
  for (const [i, r] of v.entries()) {
    if (!r || !REMIND_WHEN.includes(r.when)) return { error: "bad_reminders", note: `${i + 1} 件目のタイミング` };
    const minutes = r.when === "before" || r.when === "after" ? Number(r.minutes) : 0;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 30 * 1440 || ((r.when === "before" || r.when === "after") && minutes < 10)) return { error: "bad_reminders", note: `${i + 1} 件目の時間（10 分〜30 日）` };
    if (!UUID_RE.test(String(r.template_id || ""))) return { error: "bad_reminders", note: `${i + 1} 件目のテンプレート` };
    let key = String(r.key || "").trim();
    if (!/^[a-z0-9_-]{1,20}$/.test(key) || keys.has(key)) { let n = i + 1; while (keys.has("s" + n) || v.some((x, j) => j !== i && x && x.key === "s" + n)) n++; key = "s" + n; }
    keys.add(key);
    out.push({ key, when: r.when, minutes, template_id: r.template_id, on: r.on !== false });
  }
  return { reminders: out };
}
// 送る時刻（before：開始の◯分前／after：終わって◯分後）。それ以外は null
export const remindAt = (r, b) => (r.when === "before" ? Date.parse(b.slot) - r.minutes * 60e3 : r.when === "after" ? Date.parse(b.slot) + ((b.minutes || 30) + r.minutes) * 60e3 : null);

export function makeBooking(h) {
  const { db, addEvent, logInbound, bin3, registerPerson, busyBetween, pagesOrigin, afterBooked, gcal } = h;

  async function typeById(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [r] = await db(env, "GET", `b_booking_types?select=*&id=eq.${id}`);
    return r || null;
  }
  async function typeBySlug(env, slug) {
    const s = String(slug || "").toLowerCase();
    if (!SLUG_RE.test(s)) return null;
    const [r] = await db(env, "GET", `b_booking_types?select=*&slug=eq.${s}`);
    return r || null;
  }

  // いま生きている予約（取り消しを引いたもの）。どの種類でも重なりは避ける
  async function bookings(env) {
    const evs = await db(env, "GET", "events?select=id,customer_id,type,payload,occurred_at&type=in.(consult_booked,consult_canceled)&order=id.asc&limit=20000");
    const map = new Map();
    for (const e of evs) {
      const p = e.payload || {};
      if (!p.slot) continue;
      const k = e.customer_id + "|" + p.slot;
      if (e.type === "consult_booked") map.set(k, { customer_id: e.customer_id, slot: p.slot, type_id: p.type_id || null, type_title: p.type_title || "", minutes: p.minutes || 30, topic: p.topic || "", answers: Array.isArray(p.answers) ? p.answers : [], gcal_event_id: p.gcal_event_id || null, at: e.occurred_at });
      else map.delete(k);
    }
    return [...map.values()];
  }
  const asInterval = (b) => ({ start: Date.parse(b.slot), end: Date.parse(b.slot) + (b.minutes || 30) * 60e3, type_id: b.type_id });

  const view = (env, t, extra = {}) => ({
    id: t.id, slug: t.slug, title: t.title, minutes: t.minutes, weekdays: t.weekdays, times: t.times, days_ahead: t.days_ahead,
    min_notice_hours: t.min_notice_hours, zoom_url: t.zoom_url, thanks_page_slug: t.thanks_page_slug, avoid_calendar: t.avoid_calendar,
    remind_minutes: t.remind_minutes, confirm_subject: t.confirm_subject, confirm_body: t.confirm_body, remind_subject: t.remind_subject, remind_body: t.remind_body,
    active: t.active, archived: !!t.archived_at, audience: t.audience || "public", entitlements: t.entitlements || [], questions: t.questions || [], after_actions: t.after_actions || [],
    description: t.description || "", color: t.color || "", allowed_members: t.allowed_members || [],
    week_hours: weekHours(t), date_overrides: t.date_overrides || {}, durations: t.durations || [], slot_step: t.slot_step || null,
    buffer_before: t.buffer_before || 0, buffer_after: t.buffer_after || 0, max_per_day: t.max_per_day || null, max_per_person: t.max_per_person || 1, cancel_hours: t.cancel_hours ?? null, reminders: Array.isArray(t.reminders) ? t.reminders : null, gcal_write: t.gcal_write !== false, gcal_invite: t.gcal_invite !== false,
    embed: (t.audience || "public") === "public" ? `<div data-lab-part="booking:${t.slug}"></div>` : "", ...extra,
  });

  async function list(env, { include_archived } = {}) {
    let q = "b_booking_types?select=*&order=created_at.asc";
    if (!(include_archived === true || include_archived === "true")) q += "&archived_at=is.null";
    const [rows, bs] = await Promise.all([db(env, "GET", q), bookings(env)]);
    const t0 = Date.now();
    return { ok: true, store: "production", count: rows.length, types: rows.map((t) => view(env, t, { upcoming: bs.filter((b) => b.type_id === t.id && Date.parse(b.slot) > t0).length })) };
  }

  async function get(env, { type_id } = {}) {
    const t = await typeById(env, type_id);
    if (!t) return { ok: true, found: false };
    const bs = (await bookings(env)).filter((b) => b.type_id === t.id).sort((a, b) => a.slot.localeCompare(b.slot));
    const ids = [...new Set(bs.map((b) => b.customer_id))];
    const people = ids.length ? new Map((await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`)).map((p) => [p.id, p])) : new Map();
    const t0 = Date.now();
    const al = (t.allowed_members || []).filter((x) => UUID_RE.test(x));
    const allowed = al.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${al.join(",")})`) : [];
    return {
      ok: true, found: true, type: view(env, t), allowed_people: allowed,
      bookings: bs.map((b) => ({ person_id: b.customer_id, name: (people.get(b.customer_id) || {}).name || "", email: (people.get(b.customer_id) || {}).email || "", slot: b.slot, label: fmtJst(b.slot), topic: b.topic, answers: b.answers, past: Date.parse(b.slot) < t0 })),
      placeholders: ["{{name}}", "{{title}}", "{{date}}", "{{minutes}}", "{{zoom}}", "{{topic}}", "{{answers}}", "{{end}}"],
    };
  }

  // 作る・直す
  async function set(env, args = {}, by = "admin") {
    let cur = null;
    if (args.id) { cur = await typeById(env, args.id); if (!cur) return { ok: false, error: "not_found" }; }
    const row = { updated_at: now(), updated_by: String(by).slice(0, 200) };
    if ("title" in args || !cur) {
      const v = String(args.title || "").trim();
      if (!v || v.length > 80) return { ok: false, error: "bad_title" };
      row.title = v;
    }
    if ("slug" in args || !cur) {
      const v = String(args.slug || "").trim().toLowerCase();
      if (!SLUG_RE.test(v)) return { ok: false, error: "bad_slug", note: "英小文字・数字・ハイフンの 2〜41 字（例 consult-30）" };
      const dup = await db(env, "GET", `b_booking_types?select=id&slug=eq.${v}`);
      if (dup.some((d) => !cur || d.id !== cur.id)) return { ok: false, error: "slug_taken" };
      row.slug = v;
    }
    if ("minutes" in args || !cur) {
      const n = Number(args.minutes ?? 30);
      if (!Number.isInteger(n) || n < 10 || n > 240) return { ok: false, error: "bad_minutes" };
      row.minutes = n;
    }
    if ("weekdays" in args || !cur) {
      const arr = (Array.isArray(args.weekdays) ? args.weekdays : String(args.weekdays ?? "1,2,3,4,5").split(",")).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
      if (!arr.length) return { ok: false, error: "bad_weekdays", note: "0＝日 1＝月 … 6＝土 から 1 つ以上" };
      row.weekdays = [...new Set(arr)].sort();
    }
    if ("times" in args || !cur) {
      const v = String(args.times ?? "10:00-12:00,20:00-22:00").trim();
      if (!parseTimes(v)) return { ok: false, error: "bad_times", note: "例 10:00-12:00,20:00-22:00（日本時間）" };
      row.times = v;
    }
    if ("week_hours" in args) {
      const src = args.week_hours || {}, wk = {};
      if (typeof src !== "object" || Array.isArray(src)) return { ok: false, error: "bad_week_hours" };
      for (let w = 0; w <= 6; w++) { const r = cleanRanges(src[w] || []); if (!r) return { ok: false, error: "bad_week_hours", note: "曜日ごとに [[開始分, 終了分]]（5 分刻み・重ならない）" }; wk[w] = r; }
      const days = Object.keys(wk).filter((w) => wk[w].length).map(Number);
      if (!days.length) return { ok: false, error: "bad_week_hours", note: "受付時間を 1 つ以上選択してください" };
      row.week_hours = wk;
      // 今までの列も合わせておく（AI の道具や古い読み手のため）
      row.weekdays = days; row.times = rangesText(wk[days[0]]);
    }
    if ("date_overrides" in args) {
      const v = cleanOverrides(args.date_overrides || {});
      if (!v) return { ok: false, error: "bad_date_overrides", note: '{"2026-11-20":[]} で休業日、[[600,660]] でその日だけの時間（分）' };
      row.date_overrides = v;
    }
    if ("durations" in args) {
      const arr = [...new Set((Array.isArray(args.durations) ? args.durations : []).map(Number))];
      if (arr.length > 6 || arr.some((n) => !Number.isInteger(n) || n < 10 || n > 240 || n % 5)) return { ok: false, error: "bad_durations", note: "10〜240 分（5 分刻み）を 6 つまで" };
      row.durations = arr.length > 1 ? arr : [];
      if (arr.length) row.minutes = arr[0];
    }
    for (const [k, min, max] of [["slot_step", 5, 240], ["max_per_day", 1, 50], ["cancel_hours", 0, 168]]) if (k in args) {
      const v = args[k] === null || args[k] === "" ? null : Number(args[k]);
      if (v !== null && (!Number.isInteger(v) || v < min || v > max)) return { ok: false, error: "bad_" + k };
      row[k] = v;
    }
    for (const [k, min, max] of [["buffer_before", 0, 120], ["buffer_after", 0, 120], ["max_per_person", 1, 10]]) if (k in args) {
      const v = Number(args[k]);
      if (!Number.isInteger(v) || v < min || v > max) return { ok: false, error: "bad_" + k };
      row[k] = v;
    }
    for (const [k, min, max, def] of [["days_ahead", 1, 90, 14], ["min_notice_hours", 0, 168, 12]]) if (k in args || !cur) {
      const n = Number(args[k] ?? def);
      if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: "bad_" + k };
      row[k] = n;
    }
    if ("remind_minutes" in args) {
      const v = args.remind_minutes === null || args.remind_minutes === "" ? null : Number(args.remind_minutes);
      if (v !== null && (!Number.isInteger(v) || v < 30 || v > 7 * 1440)) return { ok: false, error: "bad_remind_minutes", note: "開催の何分前か（30〜10080）。空なら送らない" };
      row.remind_minutes = v;
    }
    if ("zoom_url" in args) {
      const v = String(args.zoom_url || "").trim();
      if (v && !URL_RE.test(v)) return { ok: false, error: "bad_zoom_url" };
      row.zoom_url = v;
    }
    if ("thanks_page_slug" in args) {
      const v = String(args.thanks_page_slug || "").trim().toLowerCase();
      if (v) {
        if (!SLUG_RE.test(v)) return { ok: false, error: "bad_thanks_page_slug" };
        const [p] = await db(env, "GET", `b_pages?select=id&slug=eq.${v}`);
        if (!p) return { ok: false, error: "thanks_page_not_found" };
      }
      row.thanks_page_slug = v || null;
    }
    for (const k of ["confirm_subject", "remind_subject"]) if (k in args) {
      const v = String(args[k] || "").trim();
      if (!v || v.length > 200) return { ok: false, error: "bad_" + k };
      row[k] = v;
    }
    for (const k of ["confirm_body", "remind_body"]) if (k in args) {
      const v = String(args[k] || "").trim();
      if (!v || v.length > 8000) return { ok: false, error: "bad_" + k };
      row[k] = v;
    }
    if ("avoid_calendar" in args) row.avoid_calendar = !!args.avoid_calendar;
    if ("audience" in args) {
      if (!AUDIENCES.includes(args.audience)) return { ok: false, error: "bad_audience", note: "public（ページに置く）か member（マイページ）" };
      row.audience = args.audience;
    }
    if ("entitlements" in args) {
      const arr = (Array.isArray(args.entitlements) ? args.entitlements : String(args.entitlements || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
      if (arr.some((k) => !/^[a-z0-9_]{2,60}$/.test(k))) return { ok: false, error: "bad_entitlements" };
      row.entitlements = [...new Set(arr)];
    }
    if ("description" in args) {
      const v = String(args.description || "").trim();
      if (v.length > 1000) return { ok: false, error: "bad_description" };
      row.description = v;
    }
    if ("color" in args) {
      const v = String(args.color || "").trim().toLowerCase();
      if (v && !/^#[0-9a-f]{6}$/.test(v)) return { ok: false, error: "bad_color" };
      row.color = v;
    }
    if ("allowed_members" in args) {
      const arr = [...new Set((Array.isArray(args.allowed_members) ? args.allowed_members : []).map(String))];
      if (arr.length > 200 || arr.some((x) => !UUID_RE.test(x))) return { ok: false, error: "bad_allowed_members" };
      row.allowed_members = arr;
    }
    if ("questions" in args) {
      const r = cleanQuestions(args.questions);
      if (r.error) return { ok: false, error: r.error, note: r.note };
      row.questions = r.questions;
    }
    if ("after_actions" in args) {
      const arr = (Array.isArray(args.after_actions) ? args.after_actions : []).map(String);
      if (arr.some((k) => !AFTER_ACTIONS.includes(k))) return { ok: false, error: "bad_after_actions", note: "使えるのは shr_next_mtg（しあらぼ管理の次の面談）" };
      row.after_actions = [...new Set(arr)];
    }
    for (const k of ["gcal_write", "gcal_invite"]) if (k in args) row[k] = !!args[k];
    if ("reminders" in args) {
      if (args.reminders === null) row.reminders = null;
      else {
        const r = cleanReminders(args.reminders);
        if (r.error) return { ok: false, error: r.error, note: r.note };
        const ids = [...new Set(r.reminders.map((x) => x.template_id))];
        const found = ids.length ? await templates(env, ids) : [];
        if (found.filter((x) => !x.archived_at).length !== ids.length) return { ok: false, error: "template_not_found" };
        row.reminders = r.reminders;
      }
    }
    if ("active" in args) row.active = !!args.active;
    if ("archived" in args) row.archived_at = args.archived ? now() : null;
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_booking_types?id=eq.${cur.id}`, row, "return=representation");
    else {
      [out] = await db(env, "POST", "b_booking_types", [{ zoom_url: "", remind_minutes: 1440, avoid_calendar: true, active: true, ...DEFAULT_TEXTS, ...row }], "return=representation");
      if (UUID_RE.test(String(args.campaign_id || ""))) {
        try { await putMember(db, env, { part_type: "booking", part_id: out.id, campaign_id: args.campaign_id, role: "個別相談", updated_at: now(), updated_by: String(by).slice(0, 200) }); }
        catch (_) { /* 企画が無くても種類は作る */ }
      }
    }
    await logInbound(env, "change", { kind: "booking_type", id: out.id, before: cur, after: out, by }, { ok: true }, 200);
    return { ok: true, created: !cur, type: view(env, out) };
  }

  // 空き時間（公開の面と AI の両方）。カレンダーが読めないときは、予定を避けずに出して calendar に理由を返す
  async function slots(env, t, at = Date.now(), minutes = t.minutes) {
    const range = [at, at + ((t.days_ahead || 14) + 1) * DAY];
    const booked = (await bookings(env)).map(asInterval);
    let busy = [], calendar = "off";
    if (t.avoid_calendar && busyBetween) {
      const r = await busyBetween(env, range[0], range[1]).catch((e) => ({ state: "error", error: String(e.message), busy: [] }));
      busy = r.busy || []; calendar = r.state;
    }
    return { slots: freeSlots(t, { booked, busy }, at, minutes), calendar, booked, busy };
  }

  async function publicSlots(env, slug) {
    const t = await typeBySlug(env, slug);
    if (!t || !t.active || t.archived_at || (t.audience || "public") !== "public") return { ok: false, error: "not_found" };
    const r = await slots(env, t);
    return { ok: true, type: { title: t.title, minutes: t.minutes }, questions: (t.questions || []).map(({ key, label, kind, required, hint, options }) => ({ key, label, kind, required, hint, ...(options ? { options } : {}) })),
      slots: r.slots.map((s) => ({ slot: s, label: fmtJst(s), day: fmtJst(s).split("（")[0] })) };
  }

  async function getSlots(env, { type_id, slug } = {}) {
    const t = type_id ? await typeById(env, type_id) : await typeBySlug(env, slug);
    if (!t) return { ok: true, found: false };
    const r = await slots(env, t);
    return { ok: true, found: true, title: t.title, count: r.slots.length, calendar: r.calendar, slots: r.slots.slice(0, 200).map((s) => ({ slot: s, label: fmtJst(s) })) };
  }

  async function sendNotice(env, t, b, person, which, actor) {
    const r = await bin3.sendMail(env, person, {
      kind: "booking_notice", subject: render(t[which + "_subject"], t, b, person), text: render(t[which + "_body"], t, b, person),
      actor, extra: { booking_type: t.id, slot: b.slot, which },
    });
    return r.result;
  }
  // テンプレート（便④）
  async function templates(env, ids) {
    const list = ids ? [...new Set(ids)].filter((x) => UUID_RE.test(String(x))) : null;
    if (list && !list.length) return [];
    return await db(env, "GET", "b_booking_templates?select=*&order=created_at.asc" + (list ? `&id=in.(${list.join(",")})` : "&archived_at=is.null"));
  }
  async function sendTemplate(env, t, b, person, tpl, step, actor) {
    const r = await bin3.sendMail(env, person, { kind: "booking_notice", subject: render(tpl.subject, t, b, person), text: render(tpl.body, t, b, person), actor, extra: { booking_type: t.id, slot: b.slot, which: step.when, step: step.key, template: tpl.id } });
    return r.result;
  }
  // 予約した直後・キャンセルされたときの通知。並びが無いメニューは今までどおり（予約した直後だけ）
  async function notifyNow(env, t, b, person, when, actor = "site") {
    if (!Array.isArray(t.reminders)) return when === "booked" ? await sendNotice(env, t, b, person, "confirm", actor) : "none";
    const steps = t.reminders.filter((r) => r.on && r.when === when);
    if (!steps.length) return "none";
    const tpls = new Map((await templates(env, steps.map((r) => r.template_id))).map((x) => [x.id, x]));
    let out = "none";
    for (const st of steps) { const tpl = tpls.get(st.template_id); if (!tpl || tpl.archived_at) continue; out = await sendTemplate(env, t, b, person, tpl, st, actor); }
    return out;
  }

  // 予約する（lp の住所から。ログイン不要）
  async function book(env, slug, body = {}) {
    const t = await typeBySlug(env, slug);
    if (!t || !t.active || t.archived_at || (t.audience || "public") !== "public") return { ok: false, error: "not_found" };
    const slot = String(body.slot || "");
    const iso = parseStart(slot);
    if (!iso) return { ok: false, error: "bad_slot" };
    // 予約の直前にもう一度空きを確かめる（同じ枠を 2 人が取らない）
    const free = (await slots(env, t)).slots;
    if (!free.includes(iso)) return { ok: false, error: "slot_taken" };
    const topic = String(body.topic || "").trim().slice(0, 1000);
    const ans = cleanAnswers(t.questions, body.answers);
    if (ans.error) return { ok: false, error: ans.error, key: ans.key, label: ans.label };
    const reg = await registerPerson(env, { email: body.email, name: body.name, source: body.source, consent: body.consent, via: "booking:" + t.slug, route: body.route, page_id: body.page_id });
    if (!reg.ok) return reg;
    const mine = (await bookings(env)).filter((b) => b.customer_id === reg.id && b.type_id === t.id && Date.parse(b.slot) > Date.now());
    if (mine.length >= (t.max_per_person || 1)) return { ok: false, error: "already_booked", slot: mine[0].slot, label: fmtJst(mine[0].slot) };
    const b = { slot: iso, type_id: t.id, type_title: t.title, minutes: t.minutes, topic, ...(ans.answers.length ? { answers: ans.answers } : {}) };
    const [person] = await db(env, "GET", `customers?select=id,name,email&id=eq.${reg.id}`);
    const gev = person ? await gcalCreate(env, t, b, person) : null;
    if (gev) b.gcal_event_id = gev;
    await addEvent(env, reg.id, "consult_booked", b, "site");
    const mail = person ? await notifyNow(env, t, b, person, "booked") : "failed";
    await logInbound(env, "booking", { slug: t.slug, slot: iso }, { ok: true, is_new: reg.is_new, mail }, 200);
    let thanks_url = null;
    if (t.thanks_page_slug) {
      const [tp] = await db(env, "GET", `b_pages?select=slug,status&slug=eq.${t.thanks_page_slug}`);
      if (tp && tp.status === "published") thanks_url = `${pagesOrigin(env)}/${tp.slug}`;
    }
    return { ok: true, id: reg.id, is_new: reg.is_new, slot: iso, label: fmtJst(iso), mail, thanks_url };
  }

  // Google カレンダー（便⑤）：つないでいれば予定を作る・消す。失敗しても予約は止めない
  async function gcalCreate(env, t, b, person) { if (!gcal) return null; try { return await gcal.createFor(env, t, b, person); } catch (_) { return null; } }
  async function gcalRemove(env, id) { if (!gcal || !id) return; try { await gcal.remove(env, id); } catch (_) { /* 予定が残るだけ */ } }

  // 定時の処理：開始の◯分前・終わって◯分後の通知（送る時刻から 3 時間のうち・1 人 1 枠 1 通知 1 回）
  // 並びが無いメニューは今までの「前日の知らせ」（remind_minutes・remind_*）
  async function run(env, at = Date.now()) {
    const out = { sent: 0, blocked: 0, failed: 0 };
    const types = new Map((await db(env, "GET", "b_booking_types?select=*&archived_at=is.null")).map((t) => [t.id, t]));
    if (!types.size) return out;
    // 送った印。step の無い古い印は、前日の知らせ（移した並びの s2）として数える
    const done = new Set((await db(env, "GET", "events?select=customer_id,payload&type=eq.consult_reminded&limit=20000")).map((e) => e.customer_id + "|" + (e.payload && e.payload.slot) + "|" + ((e.payload && e.payload.step) || "s2")));
    const tplIds = [...types.values()].flatMap((t) => (Array.isArray(t.reminders) ? t.reminders : []).map((r) => r.template_id));
    const tpls = new Map((await templates(env, tplIds)).map((x) => [x.id, x]));
    const people = new Map();
    const person = async (id) => { if (!people.has(id)) { const [p] = await db(env, "GET", `customers?select=id,name,email&id=eq.${id}`); people.set(id, p || null); } return people.get(id); };
    for (const b of await bookings(env)) {
      const t = types.get(b.type_id);
      if (!t) continue;
      const steps = Array.isArray(t.reminders) ? t.reminders.filter((r) => r.on && (r.when === "before" || r.when === "after"))
        : t.remind_minutes == null ? [] : [{ key: "s2", when: "before", minutes: t.remind_minutes, legacy: true }];
      for (const st of steps) {
        const send = remindAt(st, b);
        if (at < send || at >= send + WINDOW_MS || Date.parse(b.at) > send) continue;
        if (done.has(b.customer_id + "|" + b.slot + "|" + st.key)) continue;
        const p = await person(b.customer_id);
        if (!p) continue;
        let r;
        if (st.legacy) r = await sendNotice(env, t, b, p, "remind", "site");
        else { const tpl = tpls.get(st.template_id); if (!tpl || tpl.archived_at) continue; r = await sendTemplate(env, t, b, p, tpl, st, "site"); }
        if (r !== "failed") { await addEvent(env, b.customer_id, "consult_reminded", { slot: b.slot, type_id: t.id, step: st.key, mail: r }, eventActor("site")); done.add(b.customer_id + "|" + b.slot + "|" + st.key); }
        out[r] = (out[r] || 0) + 1;
      }
    }
    return out;
  }

  // ---- 会員の予約（マイページ・ログインした人）----
  // その人が予約できる種類と空き時間・自分のこれからの予約
  async function forMember(env, customer, ent, admin, at = Date.now()) {
    const types = (await db(env, "GET", "b_booking_types?select=*&audience=eq.member&archived_at=is.null&order=created_at.asc")).filter((t) => canBook(t, ent, admin, customer.id));
    const mine = (await bookings(env)).filter((b) => b.customer_id === customer.id && Date.parse(b.slot) > at).sort((a, b) => a.slot.localeCompare(b.slot));
    const out = [];
    for (const t of types) {
      const r = await slots(env, t, at);
      const lens = lengthsOf(t);
      const mk = (list, m) => list.map((s) => ({ slot: s, label: fmtJst(s), end: endLabel(s, m), day: fmtJst(s).split("（")[0] }));
      const options = lens.length > 1 ? lens.map((m) => ({ minutes: m, slots: mk(m === t.minutes ? r.slots : freeSlots(t, { booked: r.booked, busy: r.busy }, at, m), m) })) : null;
      const mineT = mine.filter((b) => b.type_id === t.id);
      out.push({ slug: t.slug, title: t.title, minutes: t.minutes, ...(options ? { options } : {}), max_per_person: t.max_per_person || 1, cancel_hours: t.cancel_hours ?? null, description: t.description || "", color: t.color || "", zoom: !!t.zoom_url, ...(t.active ? {} : { paused: true }),
        questions: (t.questions || []).map(({ key, label, kind, required, hint, options }) => ({ key, label, kind, required, hint, ...(options ? { options } : {}) })),
        booked: mineT.length >= (t.max_per_person || 1), slots: mk(r.slots, t.minutes) });
    }
    return { ok: true, ready: out.length > 0, types: out,
      mine: mine.map((b) => { const t = types.find((x) => x.id === b.type_id); return { slot: b.slot, label: fmtJst(b.slot), end: endLabel(b.slot, b.minutes), slug: t ? t.slug : null, title: b.type_title || (t || {}).title || "個別相談", minutes: b.minutes, answers: b.answers, ...(t && tooLate(t, b.slot, at) ? { locked: true, cancel_hours: t.cancel_hours } : {}) }; }) };
  }

  async function memberBook(env, customer, ent, admin, body = {}) {
    const t = await typeBySlug(env, body.slug);
    if (!canBook(t, ent, admin, customer.id)) return { ok: false, error: "not_found" };
    const iso = parseStart(String(body.slot || ""));
    if (!iso) return { ok: false, error: "bad_slot" };
    const ans = cleanAnswers(t.questions, body.answers);
    if (ans.error) return { ok: false, error: ans.error, key: ans.key, label: ans.label };
    const lens = lengthsOf(t), m = body.minutes == null || body.minutes === "" ? lens[0] : Number(body.minutes);
    if (!lens.includes(m)) return { ok: false, error: "bad_minutes" };
    if (!(await slots(env, t, Date.now(), m)).slots.includes(iso)) return { ok: false, error: "slot_taken" };
    // 日時を変更（from＝いまの予約の時刻）：同じ種類のいまの予約を、新しい時刻に入れ替える
    const fromIso = body.from ? parseStart(String(body.from)) : null;
    const mine = (await bookings(env)).filter((b) => b.customer_id === customer.id && b.type_id === t.id && Date.parse(b.slot) > Date.now());
    const moving = fromIso ? mine.find((b) => b.slot === fromIso) : null;
    if (fromIso && !moving) return { ok: false, error: "not_found" };
    if (moving && tooLate(t, moving.slot)) return { ok: false, error: "too_late", cancel_hours: t.cancel_hours };
    if (mine.length >= (t.max_per_person || 1) && !moving) return { ok: false, error: "already_booked", slot: mine[0].slot, label: fmtJst(mine[0].slot) };
    const b = { slot: iso, type_id: t.id, type_title: t.title, minutes: m, topic: (t.questions || []).length ? "" : String((body.answers && body.answers.topic) || "").trim().slice(0, 1000), answers: ans.answers, ...(moving ? { moved_from: moving.slot } : {}) };
    const gev = await gcalCreate(env, t, b, customer);
    if (gev) b.gcal_event_id = gev;
    await addEvent(env, customer.id, "consult_booked", b, "site");
    if (moving) { await addEvent(env, customer.id, "consult_canceled", { slot: moving.slot, type_id: t.id, type_title: t.title, moved_to: iso }, "site"); await gcalRemove(env, moving.gcal_event_id); }
    const mail = await notifyNow(env, t, b, customer, "booked").catch(() => "failed");
    let after = null;
    if (afterBooked && (t.after_actions || []).length) after = await afterBooked(env, customer.id, t.after_actions, { booked: iso }).catch((e) => ({ error: String(e.message || e) }));
    await logInbound(env, "booking", { slug: t.slug, slot: iso, member: true }, { ok: true, mail, after }, 200);
    return { ok: true, slot: iso, label: fmtJst(iso), end: endLabel(iso, m), minutes: m, moved: !!moving, mail };
  }

  async function memberCancel(env, customer, body = {}) {
    const iso = parseStart(String(body.slot || ""));
    const b = iso && (await bookings(env)).find((x) => x.customer_id === customer.id && x.slot === iso && Date.parse(x.slot) > Date.now());
    if (!b) return { ok: false, error: "not_found" };
    const t = b.type_id ? await typeById(env, b.type_id) : null;
    if (!t || t.audience !== "member") return { ok: false, error: "not_found" };
    if (tooLate(t, b.slot)) return { ok: false, error: "too_late", cancel_hours: t.cancel_hours };
    await addEvent(env, customer.id, "consult_canceled", { slot: b.slot, type_id: t.id, type_title: t.title }, "site");
    await gcalRemove(env, b.gcal_event_id);
    const mail = await notifyNow(env, t, b, { id: customer.id, name: customer.name || "", email: customer.email || "" }, "canceled").catch(() => "failed");
    let after = null;
    if (afterBooked && (t.after_actions || []).length) after = await afterBooked(env, customer.id, t.after_actions, { canceled: b.slot }).catch((e) => ({ error: String(e.message || e) }));
    await logInbound(env, "booking_cancel", { slug: t.slug, slot: b.slot }, { ok: true, after, mail }, 200);
    // 「元に戻す」のために、取り消した予約の中身を返す
    return { ok: true, slot: b.slot, slug: t.slug, minutes: b.minutes, answers: Object.fromEntries((b.answers || []).map((a) => [a.key, a.values || a.value])) };
  }

  async function forPlan(env) {
    return await db(env, "GET", "b_booking_types?select=id,slug,title,active,thanks_page_slug&archived_at=is.null&order=created_at.asc").catch(() => []);
  }

  // テンプレートの一覧（使っているメニューの数つき）・作る・直す・消す
  async function listTemplates(env) {
    const [rows, types] = await Promise.all([templates(env), db(env, "GET", "b_booking_types?select=id,title,reminders&archived_at=is.null")]);
    return { ok: true, templates: rows.map((x) => ({ id: x.id, name: x.name, subject: x.subject, body: x.body, updated_at: x.updated_at,
      used: types.filter((t) => (t.reminders || []).some((r) => r.template_id === x.id)).map((t) => t.title) })),
      placeholders: TPL_KEYS };
  }
  async function setTemplate(env, args = {}, by = "admin") {
    let cur = null;
    if (args.id) { [cur] = await templates(env, [args.id]); if (!cur) return { ok: false, error: "not_found" }; }
    const row = { updated_at: now(), updated_by: String(by).slice(0, 200) };
    if (args.archived === true) {
      if (!cur) return { ok: false, error: "not_found" };
      const users = (await db(env, "GET", "b_booking_types?select=id,title,reminders&archived_at=is.null")).filter((t) => (t.reminders || []).some((r) => r.template_id === cur.id));
      if (users.length) return { ok: false, error: "template_in_use", used: users.map((t) => t.title) };
      row.archived_at = now();
    } else {
      if (args.archived === false) row.archived_at = null;
      for (const [k, max] of [["name", 60], ["subject", 200], ["body", 8000]]) if (k in args || !cur) {
        const v = String(args[k] || "").replace(/\u200b/g, "").trim();
        if (!v || v.length > max) return { ok: false, error: "bad_template_" + k };
        row[k] = v;
      }
    }
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_booking_templates?id=eq.${cur.id}`, row, "return=representation");
    else [out] = await db(env, "POST", "b_booking_templates", [row], "return=representation");
    await logInbound(env, "change", { kind: "booking_template", id: out.id, before: cur, after: out, by }, { ok: true }, 200);
    return { ok: true, created: !cur, template: { id: out.id, name: out.name, subject: out.subject, body: out.body, archived: !!out.archived_at } };
  }
  // テスト送信：見本の予約で差し込んで、管理者のメールに送る
  async function testTemplate(env, { subject, body, type_id } = {}, adminEmail) {
    const em = String(adminEmail || "").toLowerCase();
    const [p] = await db(env, "GET", `customers?select=id,name,email&email=eq.${encodeURIComponent(em)}`);
    if (!p) return { ok: false, error: "no_admin_person", note: "管理者のメールが顧客に入っていません" };
    const t = (type_id && await typeById(env, type_id)) || { id: null, title: "個別相談", minutes: 30, zoom_url: "https://zoom.us/j/…", audience: "member" };
    const slot = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 11) + "11:00:00.000Z";
    const b = { slot, minutes: t.minutes, topic: "（見本）相談したいこと", answers: [{ label: "（見本）質問", value: "（見本）回答" }] };
    const s = String(subject || "").replace(/\u200b/g, "").trim(), x = String(body || "").replace(/\u200b/g, "").trim();
    if (!s || !x) return { ok: false, error: "bad_template_body" };
    const r = await bin3.sendMail(env, p, { kind: "booking_notice", subject: "【テスト】" + render(s, t, b, p), text: render(x, t, b, p), actor: "admin", force: true, extra: { test: true } });
    return { ok: r.result === "sent", result: r.result, to: p.email, error: r.error || r.reason || null };
  }

  return { list, get, set, getSlots, publicSlots, book, run, forPlan, forMember, memberBook, memberCancel, listTemplates, setTemplate, testTemplate };
}

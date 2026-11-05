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
const Q_KINDS = ["text", "textarea"];

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
    out.push({ key, label, kind, required: !!q.required, hint: String(q.hint || "").slice(0, 1000) });
  }
  return { questions: out };
}

// 答えを確かめる。返すのは [{key,label,value}]（問いの並び順）。足りなければ { error, key }
export function cleanAnswers(questions, answers) {
  const a = answers && typeof answers === "object" ? answers : {};
  const out = [];
  for (const q of questions || []) {
    const v = String(a[q.key] ?? "").trim().slice(0, q.kind === "text" ? 200 : 4000);
    if (q.required && !v) return { error: "answer_required", key: q.key, label: q.label };
    out.push({ key: q.key, label: q.label, value: v });
  }
  return { answers: out };
}

// 会員の予約：その人の権利で予約できる種類か
// 管理者は止めている種類も見られる（受け付ける前に、マイページでの見え方を確かめるため）
export function canBook(type, ent, admin) {
  if (!type || type.audience !== "member" || type.archived_at) return false;
  if (admin) return true;
  if (!type.active) return false;
  const g = new Set((ent && ent.grants) || []);
  return (type.entitlements || []).some((k) => g.has(k));
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

// 受け付ける枠の候補（日本時間で曜日と時間帯を刻む）。t は「いま」
export function candidates(type, t = Date.now()) {
  const ranges = parseTimes(type.times) || [];
  const wds = new Set((type.weekdays || []).map(Number));
  const step = type.minutes * 60e3;
  const earliest = t + (type.min_notice_hours || 0) * 3600e3;
  const today = Date.parse(new Date(t + JST).toISOString().slice(0, 10) + "T00:00:00Z") - JST; // 今日の 0 時（日本時間）の UTC
  const out = [];
  for (let d = 0; d <= (type.days_ahead || 14); d++) {
    const day0 = today + d * DAY;
    if (!wds.has(new Date(day0 + JST).getUTCDay())) continue;
    for (const [a, b] of ranges) {
      for (let s = day0 + a * 60e3; s + step <= day0 + b * 60e3; s += step) if (s >= earliest) out.push(s);
    }
  }
  return out;
}

const overlaps = (s, e, list) => list.some((x) => s < x.end && x.start < e);

// 空き時間：候補から、ほかの予約と重なる枠・予定と重なる枠を外す
export function freeSlots(type, { booked = [], busy = [] } = {}, t = Date.now()) {
  const step = type.minutes * 60e3;
  return candidates(type, t).filter((s) => !overlaps(s, s + step, booked) && !overlaps(s, s + step, busy)).map((s) => new Date(s).toISOString());
}

export function render(text, type, b, person) {
  const map = {
    name: (person && person.name) || "", email: (person && person.email) || "",
    title: type.title, date: fmtJst(b.slot), minutes: String(b.minutes || type.minutes),
    zoom: type.zoom_url || "（追ってお知らせします）", topic: b.topic || "（未記入）", answers: answersText(b.answers),
  };
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
}

export function makeBooking(h) {
  const { db, addEvent, logInbound, bin3, registerPerson, busyBetween, pagesOrigin, afterBooked } = h;

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
      if (e.type === "consult_booked") map.set(k, { customer_id: e.customer_id, slot: p.slot, type_id: p.type_id || null, type_title: p.type_title || "", minutes: p.minutes || 30, topic: p.topic || "", answers: Array.isArray(p.answers) ? p.answers : [], at: e.occurred_at });
      else map.delete(k);
    }
    return [...map.values()];
  }
  const asInterval = (b) => ({ start: Date.parse(b.slot), end: Date.parse(b.slot) + (b.minutes || 30) * 60e3 });

  const view = (env, t, extra = {}) => ({
    id: t.id, slug: t.slug, title: t.title, minutes: t.minutes, weekdays: t.weekdays, times: t.times, days_ahead: t.days_ahead,
    min_notice_hours: t.min_notice_hours, zoom_url: t.zoom_url, thanks_page_slug: t.thanks_page_slug, avoid_calendar: t.avoid_calendar,
    remind_minutes: t.remind_minutes, confirm_subject: t.confirm_subject, confirm_body: t.confirm_body, remind_subject: t.remind_subject, remind_body: t.remind_body,
    active: t.active, archived: !!t.archived_at, audience: t.audience || "public", entitlements: t.entitlements || [], questions: t.questions || [], after_actions: t.after_actions || [],
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
    return {
      ok: true, found: true, type: view(env, t),
      bookings: bs.map((b) => ({ person_id: b.customer_id, name: (people.get(b.customer_id) || {}).name || "", email: (people.get(b.customer_id) || {}).email || "", slot: b.slot, label: fmtJst(b.slot), topic: b.topic, answers: b.answers, past: Date.parse(b.slot) < t0 })),
      placeholders: ["{{name}}", "{{title}}", "{{date}}", "{{minutes}}", "{{zoom}}", "{{topic}}", "{{answers}}"],
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
  async function slots(env, t, at = Date.now()) {
    const range = [at, at + ((t.days_ahead || 14) + 1) * DAY];
    const booked = (await bookings(env)).map(asInterval);
    let busy = [], calendar = "off";
    if (t.avoid_calendar && busyBetween) {
      const r = await busyBetween(env, range[0], range[1]).catch((e) => ({ state: "error", error: String(e.message), busy: [] }));
      busy = r.busy || []; calendar = r.state;
    }
    return { slots: freeSlots(t, { booked, busy }, at), calendar };
  }

  async function publicSlots(env, slug) {
    const t = await typeBySlug(env, slug);
    if (!t || !t.active || t.archived_at || (t.audience || "public") !== "public") return { ok: false, error: "not_found" };
    const r = await slots(env, t);
    return { ok: true, type: { title: t.title, minutes: t.minutes }, questions: (t.questions || []).map(({ key, label, kind, required, hint }) => ({ key, label, kind, required, hint })),
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
    if (mine.length) return { ok: false, error: "already_booked", slot: mine[0].slot, label: fmtJst(mine[0].slot) };
    const b = { slot: iso, type_id: t.id, type_title: t.title, minutes: t.minutes, topic, ...(ans.answers.length ? { answers: ans.answers } : {}) };
    await addEvent(env, reg.id, "consult_booked", b, "site");
    const [person] = await db(env, "GET", `customers?select=id,name,email&id=eq.${reg.id}`);
    const mail = person ? await sendNotice(env, t, b, person, "confirm", "site") : "failed";
    await logInbound(env, "booking", { slug: t.slug, slot: iso }, { ok: true, is_new: reg.is_new, mail }, 200);
    let thanks_url = null;
    if (t.thanks_page_slug) {
      const [tp] = await db(env, "GET", `b_pages?select=slug,status&slug=eq.${t.thanks_page_slug}`);
      if (tp && tp.status === "published") thanks_url = `${pagesOrigin(env)}/${tp.slug}`;
    }
    return { ok: true, id: reg.id, is_new: reg.is_new, slot: iso, label: fmtJst(iso), mail, thanks_url };
  }

  // 定時の処理：前日の知らせ（送る時刻から 3 時間のうち・1 人 1 枠 1 回）
  async function run(env, at = Date.now()) {
    const out = { sent: 0, blocked: 0, failed: 0 };
    const types = new Map((await db(env, "GET", "b_booking_types?select=*&archived_at=is.null")).map((t) => [t.id, t]));
    if (!types.size) return out;
    const done = new Set((await db(env, "GET", "events?select=customer_id,payload&type=eq.consult_reminded&limit=20000")).map((e) => e.customer_id + "|" + (e.payload && e.payload.slot)));
    for (const b of await bookings(env)) {
      const t = types.get(b.type_id);
      if (!t || t.remind_minutes == null) continue;
      const send = Date.parse(b.slot) - t.remind_minutes * 60e3;
      if (at < send || at >= send + WINDOW_MS || Date.parse(b.at) > send) continue;
      if (done.has(b.customer_id + "|" + b.slot)) continue;
      const [person] = await db(env, "GET", `customers?select=id,name,email&id=eq.${b.customer_id}`);
      if (!person) continue;
      const r = await sendNotice(env, t, b, person, "remind", "site");
      if (r !== "failed") await addEvent(env, b.customer_id, "consult_reminded", { slot: b.slot, type_id: t.id, mail: r }, eventActor("site"));
      out[r]++;
    }
    return out;
  }

  // ---- 会員の予約（マイページ・ログインした人）----
  // その人が予約できる種類と空き時間・自分のこれからの予約
  async function forMember(env, customer, ent, admin, at = Date.now()) {
    const types = (await db(env, "GET", "b_booking_types?select=*&audience=eq.member&archived_at=is.null&order=created_at.asc")).filter((t) => canBook(t, ent, admin));
    const mine = (await bookings(env)).filter((b) => b.customer_id === customer.id && Date.parse(b.slot) > at).sort((a, b) => a.slot.localeCompare(b.slot));
    const out = [];
    for (const t of types) {
      const r = await slots(env, t, at);
      out.push({ slug: t.slug, title: t.title, minutes: t.minutes, ...(t.active ? {} : { paused: true }), questions: (t.questions || []).map(({ key, label, kind, required, hint }) => ({ key, label, kind, required, hint })),
        booked: mine.some((b) => b.type_id === t.id), slots: r.slots.map((s) => ({ slot: s, label: fmtJst(s), day: fmtJst(s).split("（")[0] })) });
    }
    return { ok: true, ready: out.length > 0, types: out,
      mine: mine.map((b) => ({ slot: b.slot, label: fmtJst(b.slot), title: b.type_title || (types.find((t) => t.id === b.type_id) || {}).title || "個別相談", minutes: b.minutes, answers: b.answers })) };
  }

  async function memberBook(env, customer, ent, admin, body = {}) {
    const t = await typeBySlug(env, body.slug);
    if (!canBook(t, ent, admin)) return { ok: false, error: "not_found" };
    const iso = parseStart(String(body.slot || ""));
    if (!iso) return { ok: false, error: "bad_slot" };
    const ans = cleanAnswers(t.questions, body.answers);
    if (ans.error) return { ok: false, error: ans.error, key: ans.key, label: ans.label };
    if (!(await slots(env, t)).slots.includes(iso)) return { ok: false, error: "slot_taken" };
    const mine = (await bookings(env)).filter((b) => b.customer_id === customer.id && b.type_id === t.id && Date.parse(b.slot) > Date.now());
    if (mine.length) return { ok: false, error: "already_booked", slot: mine[0].slot, label: fmtJst(mine[0].slot) };
    const b = { slot: iso, type_id: t.id, type_title: t.title, minutes: t.minutes, topic: "", answers: ans.answers };
    await addEvent(env, customer.id, "consult_booked", b, "site");
    const mail = await sendNotice(env, t, b, customer, "confirm", "site").catch(() => "failed");
    let after = null;
    if (afterBooked && (t.after_actions || []).length) after = await afterBooked(env, customer.id, t.after_actions, { booked: iso }).catch((e) => ({ error: String(e.message || e) }));
    await logInbound(env, "booking", { slug: t.slug, slot: iso, member: true }, { ok: true, mail, after }, 200);
    return { ok: true, slot: iso, label: fmtJst(iso), mail };
  }

  async function memberCancel(env, customer, body = {}) {
    const iso = parseStart(String(body.slot || ""));
    const b = iso && (await bookings(env)).find((x) => x.customer_id === customer.id && x.slot === iso && Date.parse(x.slot) > Date.now());
    if (!b) return { ok: false, error: "not_found" };
    const t = b.type_id ? await typeById(env, b.type_id) : null;
    if (!t || t.audience !== "member") return { ok: false, error: "not_found" };
    await addEvent(env, customer.id, "consult_canceled", { slot: b.slot, type_id: t.id, type_title: t.title }, "site");
    let after = null;
    if (afterBooked && (t.after_actions || []).length) after = await afterBooked(env, customer.id, t.after_actions, { canceled: b.slot }).catch((e) => ({ error: String(e.message || e) }));
    await logInbound(env, "booking_cancel", { slug: t.slug, slot: b.slot }, { ok: true, after }, 200);
    return { ok: true };
  }

  async function forPlan(env) {
    return await db(env, "GET", "b_booking_types?select=id,slug,title,active,thanks_page_slug&archived_at=is.null&order=created_at.asc").catch(() => []);
  }

  return { list, get, set, getSlots, publicSlots, book, run, forPlan, forMember, memberBook, memberCancel };
}

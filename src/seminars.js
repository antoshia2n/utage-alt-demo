// B の便 13：セミナーの回と知らせ（2026-10-10 Naoki「進めて」）。
// 表は 2 本（supabase/b13_seminars.sql）。
//   b_seminars         … セミナーの回（題名・日時・長さ・定員・Zoom の URL・アーカイブの URL・申込のフォーム・サンクスページ）
//   b_seminar_notices  … 回ごとの知らせ。名前（key）で見分け、あとから足せる。いつ送るかは「開催の何分前」（offset_minutes）
//                        offset_minutes が空なら申込の直後（受付のメール）。マイナスは開催のあと（アーカイブなど）
// 申込は出来事 seminar_registered（seminar_id・title・form_slug）として人の行に積む。
//   その回のフォームに答えた人が申込者になる（forms.js の submit から onForm を呼ぶ）。
//   申込者には自動のラベル「セミナー:題名」が付くので、あとから一斉配信やコネクタの宛先にできる（connect.js）。
// 送った知らせは出来事 seminar_notice_sent（seminar_id・key・mail）で、同じ人に同じ知らせを 2 回送らない。
// 知らせは手続きのメール（kind=seminar_notice）として送る。送る範囲が login のままで申込者に届く（mailcfg.js）。
// 定時の処理（毎時 7 分）で送るので、送る時刻は最大 1 時間遅れる。

import { seminarLabel, eventActor } from "./connect.js";

export const NOTICE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const URL_RE = /^https:[/][/][^\s<>"']{4,490}$/;
const OFFSET_MIN = -7 * 24 * 60; // 開催の 7 日あとまで
const OFFSET_MAX = 30 * 24 * 60; // 開催の 30 日前から
const WINDOW_MS = 3 * 3600e3; // 送る時刻を過ぎて 3 時間のうちに送れなかった知らせは送らない（古い知らせを遅れて出さない）
const now = () => new Date().toISOString();

// 申込のあと最初に入る知らせ 3 本（UTAGE のイベントのリマインダの型）。あとから画面か AI で直す・足す
export const DEFAULT_NOTICES = [
  {
    key: "accepted", offset_minutes: null, sort: 0,
    subject: "【お申し込み完了】{{title}}",
    body: "{{name}} さん\n\n{{title}} のお申し込みを受け付けました。\n\n日時：{{date}}（{{minutes}} 分）\n参加の URL（Zoom）：{{zoom}}\n\n開催の前日と 1 時間前にもお知らせします。\n当日お会いできるのを楽しみにしています。",
  },
  {
    key: "day-before", offset_minutes: 24 * 60, sort: 10,
    subject: "【明日です】{{title}}",
    body: "{{name}} さん\n\n明日、{{title}} があります。\n\n日時：{{date}}（{{minutes}} 分）\n参加の URL（Zoom）：{{zoom}}\n\nお時間になりましたら、上の URL から入ってください。",
  },
  {
    key: "hour-before", offset_minutes: 60, sort: 20,
    subject: "【まもなく開始】{{title}}",
    body: "{{name}} さん\n\nまもなく {{title}} が始まります。\n\n日時：{{date}}\n参加の URL（Zoom）：{{zoom}}",
  },
];

// 日本時間の見た目（11/1（日）21:00）
export function fmtJst(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}（${"日月火水木金土"[d.getUTCDay()]}）${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// 日時を読む。時差の無い「2026-11-01 21:00」「2026-11-01T21:00」は日本時間として読む
export function parseStart(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// 知らせの本文の差し込み
export function render(text, s, person) {
  const map = {
    name: (person && person.name) || "",
    email: (person && person.email) || "",
    title: s.title, date: fmtJst(s.starts_at), minutes: String(s.minutes || 60),
    zoom: s.zoom_url || "（追ってお知らせします）",
    archive: s.archive_url || "（追ってお知らせします）",
  };
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
}

// 知らせを送る時刻（申込の直後は null）
export const sendAt = (s, n) => (n.offset_minutes == null ? null : new Date(new Date(s.starts_at).getTime() - n.offset_minutes * 60e3));

// いつ送るかを言葉で（画面と AI の両方に出す）
export function whenLabel(offset) {
  if (offset == null) return "申込の直後";
  const a = Math.abs(offset);
  const t = a % 1440 === 0 ? `${a / 1440} 日` : a % 60 === 0 ? `${a / 60} 時間` : `${a} 分`;
  return offset === 0 ? "開催の時刻" : offset > 0 ? `開催の ${t}前` : `開催の ${t}あと`;
}

// 定時の処理で、この知らせをこの人に送るか（申込が送る時刻より後なら、その知らせは送らない）
export function dueFor(s, n, regAt, t) {
  if (!n.active || n.offset_minutes == null) return false;
  const at = sendAt(s, n).getTime();
  if (t < at || t >= at + WINDOW_MS) return false;
  return new Date(regAt).getTime() <= at;
}

export function makeSeminars(h) {
  const { db, addEvent, logInbound, bin3, pagesOrigin } = h;

  async function byId(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [s] = await db(env, "GET", `b_seminars?select=*&id=eq.${id}`);
    return s || null;
  }
  async function noticesOf(env, ids) {
    if (!ids.length) return [];
    return await db(env, "GET", `b_seminar_notices?select=*&seminar_id=in.(${ids.join(",")})&order=sort.asc,id.asc`);
  }
  // 申込者（1 人 1 回・最初の申込の時刻）
  async function registrants(env, sid) {
    const evs = await db(env, "GET", `events?select=customer_id,occurred_at&type=eq.seminar_registered&payload->>seminar_id=eq.${sid}&order=id.asc&limit=20000`);
    const m = new Map();
    for (const e of evs) if (!m.has(e.customer_id)) m.set(e.customer_id, e.occurred_at);
    return m;
  }
  async function sentOf(env, sid) {
    const evs = await db(env, "GET", `events?select=customer_id,payload&type=eq.seminar_notice_sent&payload->>seminar_id=eq.${sid}&limit=50000`);
    const done = new Set(), count = {};
    for (const e of evs) {
      const k = e.payload && e.payload.key;
      done.add(e.customer_id + "|" + k);
      if (e.payload && e.payload.mail === "sent") count[k] = (count[k] || 0) + 1;
    }
    return { done, count };
  }
  const thanksUrl = (env, s) => (s.thanks_page_slug ? `${pagesOrigin(env)}/${s.thanks_page_slug}` : null);
  const view = (env, s, n) => ({
    id: s.id, title: s.title, starts_at: s.starts_at, label: fmtJst(s.starts_at), minutes: s.minutes, capacity: s.capacity,
    zoom_url: s.zoom_url, archive_url: s.archive_url, form_slug: s.form_slug, thanks_page_slug: s.thanks_page_slug,
    thanks_url: thanksUrl(env, s), label_name: labelName(s), past: new Date(s.starts_at).getTime() < Date.now(),
    archived: !!s.archived_at, registrants: n,
  });

  async function list(env, { include_archived } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, seminars: [] };
    let q = "b_seminars?select=*&order=starts_at.desc";
    if (!(include_archived === true || include_archived === "true")) q += "&archived_at=is.null";
    const rows = await db(env, "GET", q);
    const out = [];
    for (const s of rows) out.push(view(env, s, (await registrants(env, s.id)).size));
    return { ok: true, store: "production", count: out.length, seminars: out };
  }

  async function get(env, { seminar_id } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const s = await byId(env, seminar_id);
    if (!s) return { ok: true, found: false };
    const [notices, regs, sent] = await Promise.all([noticesOf(env, [s.id]), registrants(env, s.id), sentOf(env, s.id)]);
    const ids = [...regs.keys()];
    const people = ids.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
    const pm = new Map(people.map((p) => [p.id, p]));
    return {
      ok: true, found: true,
      seminar: view(env, s, regs.size),
      notices: notices.map((n) => ({
        id: n.id, key: n.key, offset_minutes: n.offset_minutes, when: whenLabel(n.offset_minutes),
        send_at: n.offset_minutes == null ? null : sendAt(s, n).toISOString(), subject: n.subject, body: n.body, active: n.active, sort: n.sort, sent: sent.count[n.key] || 0,
      })),
      registrants: ids.map((id) => ({ person_id: id, name: (pm.get(id) || {}).name || "", email: (pm.get(id) || {}).email || "", registered_at: regs.get(id) })),
      placeholders: ["{{name}}", "{{title}}", "{{date}}", "{{minutes}}", "{{zoom}}", "{{archive}}"],
    };
  }

  // 回を作る・直す。作ったときは知らせ 3 本（DEFAULT_NOTICES）が入る
  async function set(env, args = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    let cur = null;
    if (args.id) { cur = await byId(env, args.id); if (!cur) return { ok: false, error: "not_found" }; }
    const row = { updated_at: now(), updated_by: String(by).slice(0, 200) };
    if ("title" in args || !cur) {
      const t = String(args.title || "").trim();
      if (!t || t.length > 80) return { ok: false, error: "bad_title" };
      row.title = t;
    }
    if ("starts_at" in args || !cur) {
      const iso = parseStart(args.starts_at);
      if (!iso) return { ok: false, error: "bad_starts_at", note: "例 2026-11-01 21:00（日本時間）" };
      row.starts_at = iso;
    }
    if ("minutes" in args) {
      const n = Number(args.minutes);
      if (!Number.isInteger(n) || n < 10 || n > 600) return { ok: false, error: "bad_minutes" };
      row.minutes = n;
    }
    if ("capacity" in args) {
      const v = args.capacity === null || args.capacity === "" ? null : Number(args.capacity);
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 100000)) return { ok: false, error: "bad_capacity" };
      row.capacity = v;
    }
    for (const k of ["zoom_url", "archive_url"]) if (k in args) {
      const v = String(args[k] || "").trim();
      if (v && !URL_RE.test(v)) return { ok: false, error: "bad_" + k, note: "https:// で始まる住所。外すときは空にする" };
      row[k] = v;
    }
    if ("form_slug" in args) {
      const v = String(args.form_slug || "").trim().toLowerCase();
      if (v) {
        if (!SLUG_RE.test(v)) return { ok: false, error: "bad_form_slug" };
        const [f] = await db(env, "GET", `b_forms?select=id&slug=eq.${v}`);
        if (!f) return { ok: false, error: "form_not_found" };
        const dup = await db(env, "GET", `b_seminars?select=id&form_slug=eq.${v}&archived_at=is.null`);
        if (dup.some((d) => !cur || d.id !== cur.id)) return { ok: false, error: "form_used_by_another_seminar" };
      }
      row.form_slug = v || null;
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
    if ("archived" in args) row.archived_at = args.archived ? now() : null;
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_seminars?id=eq.${cur.id}`, row, "return=representation");
    else {
      [out] = await db(env, "POST", "b_seminars", [{ minutes: 60, capacity: null, zoom_url: "", archive_url: "", ...row }], "return=representation");
      await db(env, "POST", "b_seminar_notices", DEFAULT_NOTICES.map((n) => ({ ...n, seminar_id: out.id, active: true, updated_by: String(by).slice(0, 200) })), "return=minimal");
      if (UUID_RE.test(String(args.campaign_id || ""))) {
        try { await db(env, "POST", "b_campaign_parts?on_conflict=part_type,part_id", [{ part_type: "seminar", part_id: out.id, campaign_id: args.campaign_id, role: "セミナー", updated_at: now(), updated_by: String(by).slice(0, 200) }], "resolution=merge-duplicates,return=minimal"); }
        catch (_) { /* 企画が無くても回は作る */ }
      }
    }
    await logInbound(env, "change", { kind: "seminar", id: out.id, before: cur, after: out, by }, { ok: true }, 200);
    return { ok: true, created: !cur, seminar: view(env, out, (await registrants(env, out.id)).size) };
  }

  // 知らせを足す・直す（名前 key で見分ける。同じ名前なら直す）。リマインドの流れに、あとから配信を足すのはここ
  async function setNotice(env, args = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const s = await byId(env, args.seminar_id);
    if (!s) return { ok: false, error: "seminar_not_found" };
    const key = String(args.key || "").trim().toLowerCase();
    if (!NOTICE_KEY_RE.test(key)) return { ok: false, error: "bad_key", note: "英小文字・数字・ハイフンの 1〜30 字（例 three-days-before）" };
    const [cur] = await db(env, "GET", `b_seminar_notices?select=*&seminar_id=eq.${s.id}&key=eq.${key}`);
    const row = { updated_at: now(), updated_by: String(by).slice(0, 200) };
    if ("offset_minutes" in args || !cur) {
      const raw = args.offset_minutes;
      if (raw === null || raw === undefined || raw === "") row.offset_minutes = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < OFFSET_MIN || n > OFFSET_MAX) return { ok: false, error: "bad_offset_minutes", note: "開催の何分前か（例 1440＝前日・60＝1 時間前・-120＝開催の 2 時間あと）。空なら申込の直後" };
        row.offset_minutes = n;
      }
    }
    if ("subject" in args || !cur) {
      const v = String(args.subject || "").trim();
      if (!v || v.length > 200) return { ok: false, error: "bad_subject" };
      row.subject = v;
    }
    if ("body" in args || !cur) {
      const v = String(args.body || "").trim();
      if (!v || v.length > 8000) return { ok: false, error: "bad_body" };
      row.body = v;
    }
    if ("active" in args) row.active = !!args.active;
    if ("sort" in args) row.sort = Number.parseInt(args.sort, 10) || 0;
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_seminar_notices?id=eq.${cur.id}`, row, "return=representation");
    else [out] = await db(env, "POST", "b_seminar_notices", [{ seminar_id: s.id, key, active: true, sort: 100, ...row }], "return=representation");
    await logInbound(env, "change", { kind: "seminar_notice", seminar_id: s.id, key, before: cur || null, after: out, by }, { ok: true }, 200);
    const warn = [];
    if (out.offset_minutes != null && out.offset_minutes > 0 && out.offset_minutes < 60) warn.push("定時の処理は毎時 7 分なので、開催の 1 時間前より近い知らせは開催に間に合わないことがある");
    if (out.offset_minutes != null && sendAt(s, out).getTime() < Date.now()) warn.push("送る時刻はもう過ぎている。いまの申込者に送るなら send_seminar_notice で送る");
    return { ok: true, created: !cur, notice: { ...out, when: whenLabel(out.offset_minutes) }, warnings: warn };
  }

  // 1 人に 1 本送る（送った・送らなかったは出来事に残す。失敗は残さず、次の定時の処理でもう一度）
  async function sendOne(env, s, n, person, by) {
    const actor = eventActor(by); // 出来事の記録の actor の決まり（site・admin・mcp・webhook・seed）に合わせる
    const r = await bin3.sendMail(env, person, {
      kind: "seminar_notice", subject: render(n.subject, s, person), text: render(n.body, s, person),
      actor, extra: { seminar_id: s.id, notice_key: n.key },
    });
    if (r.result !== "failed") await addEvent(env, person.id, "seminar_notice_sent", { seminar_id: s.id, key: n.key, mail: r.result }, actor);
    return r.result;
  }

  // その回のフォームに答えた人を申込者にする。受付のメール（申込の直後の知らせ）を送り、サンクスページの住所を返す
  async function onForm(env, customerId, formSlug) {
    if (!env.B_STORE || !formSlug) return null;
    const [s] = await db(env, "GET", `b_seminars?select=*&form_slug=eq.${String(formSlug).toLowerCase()}&archived_at=is.null`);
    if (!s) return null;
    // サンクスページは公開中のときだけ使う（下書きや止めたページへ移さない）
    let thanks = null;
    if (s.thanks_page_slug) {
      const [tp] = await db(env, "GET", `b_pages?select=slug,status&slug=eq.${s.thanks_page_slug}`);
      if (tp && tp.status === "published") thanks = thanksUrl(env, s);
    }
    const out = { seminar_id: s.id, thanks_url: thanks };
    if (new Date(s.starts_at).getTime() < Date.now()) return { ...out, registered: false, reason: "over" };
    const regs = await registrants(env, s.id);
    if (regs.has(customerId)) return { ...out, registered: false, already: true };
    if (s.capacity && regs.size >= s.capacity) {
      await addEvent(env, customerId, "seminar_full", { seminar_id: s.id, title: s.title }, "site");
      return { ...out, registered: false, reason: "full" };
    }
    await addEvent(env, customerId, "seminar_registered", { seminar_id: s.id, title: s.title, form_slug: s.form_slug }, "site");
    const [person] = await db(env, "GET", `customers?select=id,name,email&id=eq.${customerId}`);
    const mails = [];
    for (const n of (await noticesOf(env, [s.id])).filter((x) => x.active && x.offset_minutes == null)) if (person) mails.push(await sendOne(env, s, n, person, "site"));
    return { ...out, registered: true, mails };
  }

  // いますぐ 1 本送る（まだ受け取っていない申込者へ・時刻は見ない）。試しと、送る時刻を過ぎてから足した知らせに使う
  async function sendNotice(env, { seminar_id, key } = {}, actor = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const s = await byId(env, seminar_id);
    if (!s) return { ok: false, error: "seminar_not_found" };
    const [n] = await db(env, "GET", `b_seminar_notices?select=*&seminar_id=eq.${s.id}&key=eq.${String(key || "").toLowerCase()}`);
    if (!n) return { ok: false, error: "notice_not_found" };
    const [regs, sent] = await Promise.all([registrants(env, s.id), sentOf(env, s.id)]);
    const out = { ok: true, registrants: regs.size, sent: 0, blocked: 0, failed: 0, skipped: 0 };
    const ids = [...regs.keys()];
    const people = ids.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
    for (const p of people) {
      if (sent.done.has(p.id + "|" + n.key)) { out.skipped++; continue; }
      out[await sendOne(env, s, n, p, actor)]++;
    }
    return out;
  }

  // 定時の処理：送る時刻が来た知らせを、まだ受け取っていない申込者へ
  async function run(env, t = Date.now()) {
    const out = { seminars: 0, sent: 0, blocked: 0, failed: 0 };
    if (!env.B_STORE) return out;
    const from = new Date(t - (-OFFSET_MIN) * 60e3 - WINDOW_MS).toISOString(), to = new Date(t + OFFSET_MAX * 60e3).toISOString();
    const rows = await db(env, "GET", `b_seminars?select=*&archived_at=is.null&starts_at=gte.${encodeURIComponent(from)}&starts_at=lte.${encodeURIComponent(to)}`);
    if (!rows.length) return out;
    const notices = await noticesOf(env, rows.map((s) => s.id));
    for (const s of rows) {
      const due = notices.filter((n) => n.seminar_id === s.id && n.active && n.offset_minutes != null && t >= sendAt(s, n).getTime() && t < sendAt(s, n).getTime() + WINDOW_MS);
      if (!due.length) continue;
      out.seminars++;
      const [regs, sent] = await Promise.all([registrants(env, s.id), sentOf(env, s.id)]);
      const ids = [...regs.keys()];
      const people = ids.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
      for (const n of due) for (const p of people) {
        if (sent.done.has(p.id + "|" + n.key) || !dueFor(s, n, regs.get(p.id), t)) continue;
        out[await sendOne(env, s, n, p, "site")]++;
      }
    }
    return out;
  }

  // 設計図に使う（しまっていない回）
  async function forPlan(env) {
    if (!env.B_STORE) return [];
    return await db(env, "GET", "b_seminars?select=id,title,starts_at,form_slug,thanks_page_slug&archived_at=is.null&order=starts_at.asc").catch(() => []);
  }

  return { list, get, set, setNotice, sendNotice, onForm, run, forPlan };
}

// 自動のラベル「セミナー:題名」（connect.js の seminarLabel と同じ）
export function labelName(s) { return seminarLabel(s && s.title); }

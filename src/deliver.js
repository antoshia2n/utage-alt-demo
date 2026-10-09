// B の便 5：届ける。ステップ配信・条件で絞った一斉配信・クリックの計測・送信元を温める・ログインのメール。
// 表は 3 本（b_steps・b_broadcasts・b_links）。送った・押した・送らなかったは、これまでどおり出来事の記録に積む：
//   email_sent / email_blocked / email_failed … payload.kind が step（ステップ）・broadcast（一斉）、step_id や broadcast_id 付き
//   email_clicked … メールの中のリンクを押した（token・url・kind・ref）
// 送る先の制限は bin3 の mailAllowed。誰に送るかは設定の mail_scope（src/mailcfg.js・便 7c-1）。一斉配信とステップは scope が all のときだけ誰にでも。
// 送信元を温める：ステップと一斉配信の 1 日の数に上限を置き、最初に送った日から少しずつ増やす。ログインや購入の確認のメールは数えない。
// ログインのメール：Supabase の「メールを送る引き金（Send Email Hook）」がここを呼ぶ。Supabase の既定の送り方は組織の人にしか届かないため。
// B の便 8e：ステップの表 b_steps を「コネクタ（トリガー → セレクタ → アクション）」に広げた。きっかけ・誰に・何をするかの一覧は src/connect.js。
//   コネクタが動いた結果は、これまでどおり出来事の記録に step_id と trigger_id（きっかけの出来事の番号）付きで積む。
//   宛先の条件（一斉配信とコネクタのセレクタ）に labels（全部持つ）・not_labels（どれも持たない）を足した。ラベルは出来事から計算する。

import { TRIGGERS, ACTIONS, DONE_TYPES, FAIL_TYPES, LABEL_RE } from "./connect.js";

const NL = String.fromCharCode(10);
const QUOTE = String.fromCharCode(34);
const WARM = [20, 40, 80, 150, 250, 400, 600, 1000];
const WARM_AFTER = 2000;
const SOURCES = ["x", "note", "youtube", "direct", "other"];
const UUID_RE = /^[0-9a-f-]{36}$/i;
const URL_RE = new RegExp("https?://[^ <>" + QUOTE + "'" + NL + String.fromCharCode(13, 9) + "　]+", "g");
const MAX_PER_RUN = 100;

export function makeDeliver(h) {
  const { db, addEvent, logInbound, bin3, sell, connect } = h;

  const origin = (env) => env.PUBLIC_ORIGIN || "https://utage-alt-demo.gameister1.workers.dev";

  async function hmacB64(keyBytes, text) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
  async function hmacHex(secret, text) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function safeEqual(a, b) {
    a = String(a || ""); b = String(b || "");
    if (!a || !b || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  const clickSig = async (env, token, cid) => (await hmacHex(env.MCP_SECRET, "click:" + token + ":" + cid)).slice(0, 16);

  // 日本時間の今日の 0 時
  function jstMidnight(now = Date.now()) {
    const j = new Date(now + 9 * 3600e3);
    return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 9 * 3600e3);
  }

  // ---------- 送信元を温める（1 日の上限） ----------
  async function warmState(env) {
    const first = await db(env, "GET", "events?select=occurred_at&type=eq.email_sent&payload->>kind=in.(step,broadcast)&order=id.asc&limit=1");
    const since = jstMidnight().toISOString();
    const today = await db(env, "GET", `events?select=id&type=eq.email_sent&payload->>kind=in.(step,broadcast)&occurred_at=gte.${encodeURIComponent(since)}&limit=10000`);
    const day = first.length ? Math.floor((jstMidnight().getTime() - jstMidnight(new Date(first[0].occurred_at).getTime()).getTime()) / 864e5) : 0;
    const cap = day < WARM.length ? WARM[day] : WARM_AFTER;
    return { day, cap, sent_today: today.length, left: Math.max(0, cap - today.length) };
  }

  // ---------- リンクの計測 ----------
  async function linkToken(env, url, kind, ref) {
    const rows = await db(env, "GET", `b_links?select=token&url=eq.${encodeURIComponent(url)}&kind=eq.${kind}&ref=eq.${encodeURIComponent(ref)}&limit=1`);
    if (rows.length) return rows[0].token;
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await db(env, "POST", "b_links", [{ token, url, kind, ref: String(ref) }], "return=minimal");
    return token;
  }

  // 本文の中の https のリンクを、押したら記録してから元へ飛ぶ住所に置き換える（1 人ごとに印を付ける）
  async function trackLinks(env, text, kind, ref, customerId) {
    const urls = [...new Set(String(text).match(URL_RE) || [])];
    let out = String(text);
    for (const u of urls) {
      if (u.startsWith(origin(env) + "/api/unsubscribe")) continue;
      const token = await linkToken(env, u, kind, ref);
      const tracked = `${origin(env)}/r/${token}?c=${customerId}&s=${await clickSig(env, token, customerId)}`;
      out = out.split(u).join(tracked);
    }
    return out;
  }

  async function handleClick(env, url, token) {
    const [link] = /^[0-9a-f]{12}$/.test(token) ? await db(env, "GET", `b_links?select=*&token=eq.${token}`) : [];
    if (!link) return new Response("リンクが見つかりません", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const cid = url.searchParams.get("c") || "", sig = url.searchParams.get("s") || "";
    if (UUID_RE.test(cid) && safeEqual(sig, await clickSig(env, token, cid))) {
      try { await addEvent(env, cid, "email_clicked", { token, url: link.url, kind: link.kind, ref: link.ref }, "site"); } catch (_) { /* 記録の失敗で飛び先を止めない */ }
    }
    return Response.redirect(link.url, 302);
  }

  // ---------- 宛先の絞り込み ----------
  function normFilter(f = {}) {
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
    const out = {};
    const src = arr(f.source).filter((s) => SOURCES.includes(s));
    if (src.length) out.source = src;
    for (const k of ["purchased", "not_purchased"]) { const v = arr(f[k]).filter((x) => /^[a-z0-9-]{2,40}$/.test(x)); if (v.length) out[k] = v; }
    for (const k of ["member", "note_member"]) if (f[k] === true || f[k] === false || f[k] === "true" || f[k] === "false") out[k] = f[k] === true || f[k] === "true";
    for (const k of ["registered_after", "registered_before"]) if (f[k] && !isNaN(new Date(f[k]).getTime())) out[k] = new Date(f[k]).toISOString();
    const emails = arr(f.emails).map((e) => e.toLowerCase()).filter((e) => e.includes("@"));
    if (emails.length) out.emails = emails.slice(0, 200);
    for (const k of ["labels", "not_labels"]) { const v = arr(f[k]).map((x) => x.trim()).filter((x) => LABEL_RE.test(x)); if (v.length) out[k] = [...new Set(v)].slice(0, 20); }
    return out;
  }

  async function audience(env, filter) {
    const f = normFilter(filter);
    const people = await db(env, "GET", "customer_summary?select=id,email,name,source,note_member,created_at&limit=10000");
    let list = people;
    if (f.emails) list = list.filter((p) => f.emails.includes(String(p.email).toLowerCase()));
    if (f.source) list = list.filter((p) => f.source.includes(p.source));
    if ("note_member" in f) list = list.filter((p) => !!p.note_member === f.note_member);
    if (f.registered_after) list = list.filter((p) => p.created_at && p.created_at >= f.registered_after);
    if (f.registered_before) list = list.filter((p) => p.created_at && p.created_at < f.registered_before);
    if (f.purchased || f.not_purchased) {
      const ev = await db(env, "GET", "events?select=customer_id,payload&type=eq.purchase_completed&limit=10000");
      const bought = new Map();
      for (const e of ev) { const pid = e.payload && e.payload.product_id; if (!bought.has(e.customer_id)) bought.set(e.customer_id, new Set()); bought.get(e.customer_id).add(pid); }
      if (f.purchased) list = list.filter((p) => f.purchased.some((x) => bought.get(p.id) && bought.get(p.id).has(x)));
      if (f.not_purchased) list = list.filter((p) => !f.not_purchased.some((x) => bought.get(p.id) && bought.get(p.id).has(x)));
    }
    if ("member" in f) {
      const ent = await sell.entitlementMap(env);
      list = list.filter((p) => !!(ent[p.id] && ent[p.id].member) === f.member);
    }
    if (f.labels || f.not_labels) {
      const lm = await connect.labelMap(env);
      const has = (p) => new Set((lm.get(p.id) || []).map((x) => x.label));
      if (f.labels) list = list.filter((p) => { const s = has(p); return f.labels.every((l) => s.has(l)); });
      if (f.not_labels) list = list.filter((p) => { const s = has(p); return !f.not_labels.some((l) => s.has(l)); });
    }
    const unsub = await db(env, "GET", "events?select=customer_id&type=eq.email_unsubscribed&limit=10000");
    const off = new Set(unsub.map((e) => e.customer_id));
    return { filter: f, people: list, unsubscribed: list.filter((p) => off.has(p.id)).length };
  }

  async function previewAudience(env, { filter } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const a = await audience(env, filter || {});
    return {
      ok: true, filter: a.filter, count: a.people.length, unsubscribed: a.unsubscribed,
      will_send: a.people.length - a.unsubscribed,
      sample: a.people.slice(0, 5).map((p) => ({ id: p.id, name: p.name, source: p.source })),
      open_to_all: (await h.mailcfg.get(env)).scope === "all",
    };
  }

  // ---------- ステップ配信 ----------
  async function listSteps(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, steps: [] };
    const steps = await db(env, "GET", "b_steps?select=*&order=sort.asc,id.asc");
    const ev = await db(env, "GET", "events?select=type,payload&type=in.(email_sent,email_clicked)&payload->>kind=eq.step&limit=10000");
    const ran = await db(env, "GET", "events?select=type,payload&type=in.(admin_notified,admin_notify_failed,label_added,connector_skipped)&payload->>step_id=not.is.null&limit=10000");
    for (const s of steps) {
      const mine = (t) => ran.filter((e) => e.type === t && String(e.payload.step_id) === String(s.id)).length;
      s.sent = ev.filter((e) => e.type === "email_sent" && String(e.payload.step_id) === String(s.id)).length;
      s.clicks = ev.filter((e) => e.type === "email_clicked" && String(e.payload.ref) === String(s.id)).length;
      s.notified = mine("admin_notified");
      s.labeled = mine("label_added");
      s.skipped = mine("connector_skipped");
      s.action = s.action || "send_email";
      s.trigger_label = TRIGGERS[s.trigger] ? TRIGGERS[s.trigger].label : s.trigger;
      s.action_label = ACTIONS[s.action] || s.action;
    }
    return { ok: true, count: steps.length, steps, triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [k, v.label])), actions: ACTIONS };
  }

  // コネクタを足す・直す・動かす・止める。欄の決まりは connect.js の TRIGGERS・ACTIONS と b8e_connect.sql の check に合わせる
  async function setStep(env, args, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const patch = {};
    if ("name" in args) patch.name = String(args.name || "").trim().slice(0, 120);
    if ("trigger" in args) { if (!TRIGGERS[args.trigger]) return { ok: false, error: "bad_trigger", triggers: Object.keys(TRIGGERS) }; patch.trigger = args.trigger; }
    if ("product_id" in args) { if (args.product_id !== null && args.product_id !== "" && !/^[a-z0-9-]{2,40}$/.test(String(args.product_id))) return { ok: false, error: "bad_product_id" }; patch.product_id = args.product_id || null; }
    if ("trigger_args" in args) {
      const t = args.trigger_args || {}, out = {};
      if (t.label) { if (!LABEL_RE.test(String(t.label))) return { ok: false, error: "bad_trigger_label" }; out.label = String(t.label); }
      if (t.url) { if (!/^https?:[/][/]\S{1,480}$/.test(String(t.url))) return { ok: false, error: "bad_trigger_url" }; out.url = String(t.url); }
      patch.trigger_args = out;
    }
    if ("selector" in args) patch.selector = normFilter(args.selector || {});
    if ("action" in args) { if (!ACTIONS[args.action]) return { ok: false, error: "bad_action", actions: Object.keys(ACTIONS) }; patch.action = args.action; }
    if ("action_args" in args) {
      const t = args.action_args || {}, out = {};
      if (t.label) { if (!LABEL_RE.test(String(t.label))) return { ok: false, error: "bad_action_label" }; out.label = String(t.label); }
      patch.action_args = out;
    }
    if ("delay_hours" in args) { const d = Number(args.delay_hours); if (!Number.isInteger(d) || d < 0 || d > 24 * 365) return { ok: false, error: "bad_delay_hours" }; patch.delay_hours = d; }
    if ("subject" in args) patch.subject = String(args.subject || "").trim().slice(0, 200);
    if ("body" in args) patch.body = String(args.body || "").slice(0, 10000);
    if ("sort" in args) patch.sort = Number(args.sort) || 100;
    if ("active" in args) patch.active = args.active === true || args.active === "true";
    patch.updated_at = new Date().toISOString();
    patch.updated_by = String(by || "unknown").slice(0, 120);
    let before = null;
    if (args.id) {
      [before] = await db(env, "GET", `b_steps?select=*&id=eq.${Number(args.id)}`);
      if (!before) return { ok: false, error: "not_found" };
    }
    // 保存する前に、保存後の形で確かめる（不完全な行を動かさないため）
    const next = { action: "send_email", trigger_args: {}, action_args: {}, ...(before || {}), ...patch };
    if (!next.name || !next.trigger) return { ok: false, error: "need_name_trigger" };
    if (next.action === "send_email" && (!next.subject || !next.body)) return { ok: false, error: "need_subject_and_body" };
    if (next.action === "add_label" && !(next.action_args && next.action_args.label)) return { ok: false, error: "need_action_label" };
    if (next.trigger === "label_added" && !(next.trigger_args && next.trigger_args.label)) return { ok: false, error: "need_trigger_label" };
    if (next.trigger === "label_added" && next.action === "add_label" && next.trigger_args.label === next.action_args.label) return { ok: false, error: "same_label_loop" };
    let row;
    if (before) {
      // 止まっていたものを動かすとき、その時刻から後のきっかけだけを対象にする（昔の人へまとめて動かないため）
      if (patch.active && !before.active) patch.active_since = patch.updated_at;
      [row] = await db(env, "PATCH", `b_steps?id=eq.${Number(args.id)}`, patch, "return=representation");
    } else {
      if (patch.active) patch.active_since = patch.updated_at;
      [row] = await db(env, "POST", "b_steps", [patch], "return=representation");
    }
    return { ok: true, step: row };
  }

  // きっかけの出来事を探す問い合わせ。動かした時刻から、待つ時間を過ぎたものまで
  function triggerQuery(s, due) {
    const t = TRIGGERS[s.trigger];
    const ta = s.trigger_args || {};
    let q = `events?select=id,customer_id,type,payload,occurred_at&type=eq.${t.type}&occurred_at=gte.${encodeURIComponent(s.active_since)}&occurred_at=lte.${encodeURIComponent(due)}&order=id.asc&limit=1000`;
    if (s.trigger === "purchase" && s.product_id) q += `&payload->>product_id=eq.${s.product_id}`;
    if (s.trigger === "label_added" && ta.label) q += `&payload->>label=eq.${encodeURIComponent(ta.label)}`;
    if (s.trigger === "clicked" && ta.url) q += `&payload->>url=eq.${encodeURIComponent(ta.url)}`;
    return q;
  }

  function fillText(t, c, e) {
    const p = (e && e.payload) || {};
    return String(t || "").split("{{name}}").join(c.name || "").split("{{email}}").join(c.email || "")
      .split("{{product}}").join(p.product_name || p.product_id || "").split("{{label}}").join(p.label || "").split("{{url}}").join(p.url || "");
  }

  async function runSteps(env, left) {
    const out = { checked: 0, sent: 0, blocked: 0, failed: 0, waiting_cap: 0, notified: 0, labeled: 0, skipped: 0 };
    const steps = await db(env, "GET", "b_steps?select=*&active=eq.true&order=sort.asc,id.asc");
    for (const s of steps) {
      if (!TRIGGERS[s.trigger]) continue;
      const action = s.action || "send_email";
      const due = new Date(Date.now() - s.delay_hours * 3600e3).toISOString();
      const triggers = await db(env, "GET", triggerQuery(s, due));
      if (!triggers.length) continue;
      const done = await db(env, "GET", `events?select=type,payload&type=in.(${DONE_TYPES.join(",")})&payload->>step_id=eq.${s.id}&limit=10000`);
      const fails = new Map(), finished = new Set();
      for (const e of done) {
        const k = String(e.payload.trigger_id);
        if (FAIL_TYPES.includes(e.type)) fails.set(k, (fails.get(k) || 0) + 1); else finished.add(k);
      }
      const todo = triggers.filter((t) => !finished.has(String(t.id)) && (fails.get(String(t.id)) || 0) < 3);
      if (!todo.length) continue;
      // セレクタ：空なら全員。条件があれば、この回に 1 度だけ宛先を計算して当てる
      const sel = normFilter(s.selector || {});
      const allowed = Object.keys(sel).length ? new Set((await audience(env, sel)).people.map((p) => p.id)) : null;
      for (const t of todo) {
        out.checked++;
        const extra = { step_id: s.id, trigger_id: t.id };
        if (allowed && !allowed.has(t.customer_id)) {
          await addEvent(env, t.customer_id, "connector_skipped", { ...extra, reason: "selector" }, "site");
          out.skipped++;
          continue;
        }
        const [c] = await db(env, "GET", `customers?select=id,email,name&id=eq.${t.customer_id}`);
        if (!c) continue;
        if (action === "notify_admin") {
          const what = TRIGGERS[s.trigger].label;
          const subject = fillText(s.subject, c, t) || `【Lab OS】${what}：${c.name || c.email}`;
          const text = (fillText(s.body, c, t) || `${c.name || "（名前なし）"}（${c.email}）が「${what}」。`) + `\n\nコネクタ：${s.name}\nシアニン用の画面：${origin(env)}/admin`;
          const r = await connect.notifyAdmins(env, { subject, text });
          if (r.sent > 0) { await addEvent(env, c.id, "admin_notified", { ...extra, to: r.sent }, "site"); out.notified++; }
          else { await addEvent(env, c.id, "admin_notify_failed", { ...extra, error: r.error || "send_failed" }, "site"); out.failed++; }
          continue;
        }
        if (action === "add_label") {
          const r = await connect.addLabel(env, { person_id: c.id, label: s.action_args && s.action_args.label }, "site", extra);
          // もう付いていたら出来事は積まれないので、動いた印として skipped を残す（同じきっかけで回り続けないため）
          if (r.ok && r.changed) out.labeled++;
          else { await addEvent(env, c.id, "connector_skipped", { ...extra, reason: r.ok ? "already_labeled" : (r.error || "label_failed") }, "site"); out.skipped++; }
          continue;
        }
        if (left.n <= 0) { out.waiting_cap++; continue; }
        const r = await sendOne(env, c, { kind: "step", ref: s.id, subject: s.subject, body: s.body, extra });
        if (r.result === "sent") left.n--;
        out[r.result === "sent" ? "sent" : r.result === "blocked" ? "blocked" : "failed"]++;
      }
    }
    return out;
  }

  async function sendOne(env, customer, { kind, ref, subject, body, extra }) {
    const fill = (t) => String(t).split("{{name}}").join(customer.name || "");
    const text = await trackLinks(env, fill(body), kind, ref, customer.id);
    // 出来事の記録の actor は site・admin・mcp・webhook・seed のどれか（b_events の決まり）。定時の処理は site で積む
    return await bin3.sendMail(env, customer, { kind, subject: fill(subject), text, actor: "site", extra });
  }

  // ---------- 一斉配信 ----------
  async function listBroadcasts(env, { limit = 30 } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, broadcasts: [] };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const rows = await db(env, "GET", `b_broadcasts?select=*&order=created_at.desc&limit=${lim}`);
    if (rows.length) {
      const ev = await db(env, "GET", "events?select=type,customer_id,payload&type=in.(email_sent,email_blocked,email_failed,email_clicked)&payload->>kind=eq.broadcast&limit=10000");
      for (const b of rows) {
        const mine = ev.filter((e) => String(e.payload.broadcast_id || e.payload.ref) === b.id);
        b.sent = mine.filter((e) => e.type === "email_sent").length;
        b.blocked = mine.filter((e) => e.type === "email_blocked").length;
        b.failed = mine.filter((e) => e.type === "email_failed").length;
        b.clicks = mine.filter((e) => e.type === "email_clicked").length;
        b.clicked_people = new Set(mine.filter((e) => e.type === "email_clicked").map((e) => e.customer_id)).size;
      }
    }
    return { ok: true, count: rows.length, broadcasts: rows, open_to_all: (await h.mailcfg.get(env)).scope === "all" };
  }

  // 下書きを作る・直す（送らない）。送るのは queueBroadcast
  async function draftBroadcast(env, args, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const subject = String(args.subject || "").trim().slice(0, 200), body = String(args.body || "").slice(0, 10000);
    if (!subject || !body.trim()) return { ok: false, error: "need_subject_and_body" };
    const filter = normFilter(args.filter || {});
    const row = { subject, body, filter, updated_at: new Date().toISOString(), updated_by: String(by || "unknown").slice(0, 120) };
    let out;
    if (args.id) {
      if (!UUID_RE.test(String(args.id))) return { ok: false, error: "bad_id" };
      out = await db(env, "PATCH", `b_broadcasts?id=eq.${args.id}&status=eq.draft`, row, "return=representation");
      if (!out.length) return { ok: false, error: "not_draft" };
    } else {
      out = await db(env, "POST", "b_broadcasts", [{ ...row, status: "draft", created_by: row.updated_by }], "return=representation");
    }
    const pv = await previewAudience(env, { filter });
    return { ok: true, broadcast: out[0], audience: { count: pv.count, will_send: pv.will_send, unsubscribed: pv.unsubscribed } };
  }

  // 送る列に入れる。宛先の数はこの時点で数えて残す（実際に送るのは毎時の定時の処理。1 日の上限の中で少しずつ）
  async function queueBroadcast(env, { id }, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const [b] = await db(env, "GET", `b_broadcasts?select=*&id=eq.${id}`);
    if (!b) return { ok: false, error: "not_found" };
    if (b.status !== "draft") return { ok: false, error: "not_draft", status: b.status };
    const a = await audience(env, b.filter || {});
    if (!a.people.length) return { ok: false, error: "no_audience" };
    const [row] = await db(env, "PATCH", `b_broadcasts?id=eq.${id}&status=eq.draft`,
      { status: "queued", target_count: a.people.length, queued_at: new Date().toISOString(), queued_by: String(by || "unknown").slice(0, 120) }, "return=representation");
    if (!row) return { ok: false, error: "not_draft" };
    return { ok: true, broadcast: row, note: "毎時の定時の処理で、1 日の上限の中から送る" };
  }

  async function cancelBroadcast(env, { id }, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const rows = await db(env, "PATCH", `b_broadcasts?id=eq.${id}&status=in.(draft,queued,sending)`,
      { status: "canceled", finished_at: new Date().toISOString(), updated_by: String(by || "unknown").slice(0, 120) }, "return=representation");
    return rows.length ? { ok: true, broadcast: rows[0] } : { ok: false, error: "not_cancelable" };
  }

  async function runBroadcasts(env, left) {
    const out = { broadcasts: 0, sent: 0, blocked: 0, failed: 0, waiting_cap: 0, finished: 0 };
    const rows = await db(env, "GET", "b_broadcasts?select=*&status=in.(queued,sending)&order=queued_at.asc");
    for (const b of rows) {
      out.broadcasts++;
      if (b.status === "queued") await db(env, "PATCH", `b_broadcasts?id=eq.${b.id}`, { status: "sending" }, "return=minimal");
      const a = await audience(env, b.filter || {});
      const done = await db(env, "GET", `events?select=customer_id,type&type=in.(email_sent,email_blocked,email_failed)&payload->>broadcast_id=eq.${b.id}&limit=10000`);
      const touched = new Set(done.map((e) => e.customer_id));
      // 列に入れたあとに条件に入った人へは送らない（数えた時点の人数を超えない）
      const remaining = a.people.filter((p) => !touched.has(p.id)).slice(0, Math.max(0, (b.target_count || 0) - touched.size));
      let count = 0;
      for (const p of remaining) {
        if (left.n <= 0 || count >= MAX_PER_RUN) { out.waiting_cap += remaining.length - count; break; }
        const r = await sendOne(env, p, { kind: "broadcast", ref: b.id, subject: b.subject, body: b.body, extra: { broadcast_id: b.id } });
        if (r.result === "sent") left.n--;
        out[r.result === "sent" ? "sent" : r.result === "blocked" ? "blocked" : "failed"]++;
        count++;
      }
      if (count === remaining.length) {
        await db(env, "PATCH", `b_broadcasts?id=eq.${b.id}`, { status: "done", finished_at: new Date().toISOString() }, "return=minimal");
        out.finished++;
      }
    }
    return out;
  }

  // 定時の処理（と、シアニン用の画面の「いま送る」）。ステップが先、一斉配信が後
  async function run(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", skipped: true };
    const warm = await warmState(env);
    const left = { n: warm.left };
    const steps = await runSteps(env, left);
    const broadcasts = await runBroadcasts(env, left);
    return { ok: true, warm: { ...warm, left_after: left.n }, steps, broadcasts };
  }

  // ---------- ログインのメール（Supabase の Send Email Hook） ----------
  // 署名は Standard Webhooks の形：webhook-id.webhook-timestamp.本文 を、秘密の値（v1,whsec_ を外して base64 を戻したもの）で HMAC-SHA256
  async function verifyHook(env, request, raw) {
    const secret = String(env.B_AUTH_HOOK_SECRET || "").replace(/^v1,whsec_/, "");
    if (!secret) return "hook_secret_missing";
    const id = request.headers.get("webhook-id") || "", ts = request.headers.get("webhook-timestamp") || "";
    const sigs = (request.headers.get("webhook-signature") || "").split(" ").map((s) => s.split(",")[1]).filter(Boolean);
    if (!id || !ts || !sigs.length) return "missing_headers";
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return "too_old";
    const keyBytes = Uint8Array.from(atob(secret), (ch) => ch.charCodeAt(0));
    const expected = await hmacB64(keyBytes, `${id}.${ts}.${raw}`);
    return sigs.some((s) => safeEqual(s, expected)) ? null : "bad_signature";
  }

  const AUTH_SUBJECT = {
    magiclink: "ログイン用のリンク", signup: "メールアドレスの確認", recovery: "パスワードの再設定",
    invite: "ご招待", email_change: "メールアドレスの変更の確認", reauthentication: "確認コード",
  };

  async function isAdmin(env, email) {
    const rows = await db(env, "GET", `admins?select=email&email=eq.${encodeURIComponent(email)}`);
    return rows.length > 0;
  }

  // 文字だけの本文に長いリンク 1 本、という形を避けるため、見た目を整えた本文も付ける
  function authHtml(type, link, token) {
    const e = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    if (type === "reauthentication") {
      return `<div style="font-family:sans-serif;line-height:1.8;color:#222"><p>確認コードは次の 6 桁です。</p><p style="font-size:24px;letter-spacing:4px;font-family:monospace">${e(token)}</p><p style="color:#777;font-size:13px">心当たりが無ければ、このメールは捨ててください。</p><p style="color:#777;font-size:12px">シアラボ（株式会社Best Life Consulting）</p></div>`;
    }
    const label = type === "magiclink" || type === "signup" ? "ログインする" : "手続きを進める";
    return `<div style="font-family:sans-serif;line-height:1.8;color:#222"><p>シアラボからのお知らせです。下のボタンを押すと${type === "magiclink" || type === "signup" ? "ログインできます" : "手続きが進みます"}。リンクは 1 回だけ使えます。</p>`
      + `<p style="margin:24px 0"><a href="${e(link)}" style="background:#1f5c4d;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">${label}</a></p>`
      + (token ? `<p style="color:#555;font-size:13px">ボタンが押せないときの確認コード：<span style="font-family:monospace">${e(token)}</span></p>` : "")
      + `<p style="color:#777;font-size:13px">心当たりが無ければ、このメールは捨ててください。</p><p style="color:#777;font-size:12px">シアラボ（株式会社Best Life Consulting）</p></div>`;
  }

  async function handleAuthEmail(request, env) {
    const raw = await request.text();
    const bad = await verifyHook(env, request, raw);
    let body = null;
    try { body = JSON.parse(raw); } catch (_) {}
    const user = (body && body.user) || {}, d = (body && body.email_data) || {};
    const to = String(user.email || "").toLowerCase();
    const type = String(d.email_action_type || "");
    const reqLog = { type, to_domain: to.split("@")[1] || null, sig_ok: !bad };
    const reply = async (status, res) => {
      await logInbound(env, "auth_email", reqLog, res, status);
      return new Response(JSON.stringify(status === 200 ? {} : { error: { http_code: status, message: res.error } }), { status, headers: { "content-type": "application/json" } });
    };
    if (bad) return await reply(401, { ok: false, error: bad });
    if (!to || !type) return await reply(400, { ok: false, error: "bad_body" });
    if (!(await bin3.mailAllowed(env, to, "auth"))) return await reply(400, { ok: false, error: "mail_not_open" });
    const cfg = await h.mailcfg.get(env);
    if (!env.EMAIL || !cfg.from) return await reply(500, { ok: false, error: "mail_not_configured" });
    // B の便 7c-1 の続き：リンクは B 自身の住所の /auth を通す（送り元とリンク先の住所をそろえる）。
    // 行き先は /app か /admin だけ。Supabase が行き先を既定の住所に置き換えたときは、シアニンなら /admin、それ以外は /app
    let next = "";
    try { next = new URL(d.redirect_to || "").pathname; } catch (_) {}
    if (!["/app", "/admin"].includes(next)) next = (await isAdmin(env, to)) ? "/admin" : "/app";
    const link = `${origin(env)}/auth?th=${encodeURIComponent(d.token_hash || "")}&ty=${encodeURIComponent(type)}&n=${encodeURIComponent(next)}`;
    const title = AUTH_SUBJECT[type] || "お知らせ";
    const lines = type === "reauthentication"
      ? ["確認コードは次の 6 桁です。", "", String(d.token || ""), "", "心当たりが無ければ、このメールは捨ててください。"]
      : [`下のリンクを押すと${type === "magiclink" || type === "signup" ? "ログインできます" : "手続きが進みます"}。リンクは 1 回だけ使えます。`, "", link, "", d.token ? `リンクが開けないときの確認コード：${d.token}` : "", "", "心当たりが無ければ、このメールは捨ててください。"];
    try {
      const msg = { to, from: h.mailcfg.fromField(cfg), subject: `【シアラボ】${title}`, text: lines.join(NL), html: authHtml(type, link, d.token) };
      if (cfg.reply_to) msg.replyTo = cfg.reply_to;
      const r = await env.EMAIL.send(msg);
      return await reply(200, { ok: true, message_id: (r && r.messageId) || null });
    } catch (e) {
      return await reply(500, { ok: false, error: "send_failed", detail: String(e && e.message || e).slice(0, 200) });
    }
  }

  return { previewAudience, listSteps, setStep, listBroadcasts, draftBroadcast, queueBroadcast, cancelBroadcast, run, warmState, handleClick, handleAuthEmail, normFilter, triggerQuery };
}

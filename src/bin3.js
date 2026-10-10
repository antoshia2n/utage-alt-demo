// 便 3：決済（UnivaPay のテスト）とメール（Cloudflare Email Service）
// 芯の書き方は便 1・2 と同じ。新しい表は作らず、出来事の記録（events）に積み、権利は記録から計算する。
//   subscription_started   … 定期課金が始まった（画面の確かめ、または知らせで分かった）
//   subscription_payment   … 定期課金の 2 回目以降の入金（UnivaPay の知らせ）
//   subscription_failed / subscription_canceled / subscription_suspended … 止まった
//   email_sent / email_failed / email_blocked … メールを送った・失敗した・テスト宛てでないので送らなかった
//   email_unsubscribed     … 配信を止めた
// 外から来た知らせ（UnivaPay の Webhook）は inbound_log に受け取った中身と返事を 1 件ずつ残す。

export const PLAN = { name: "言語化ラボ 月額（テスト）", amount: 3000, currency: "jpy", period: "monthly" };

const UNIVAPAY_API = "https://api.univapay.com";
const ACTIVE = new Set(["subscription_started", "subscription_payment"]);
const INACTIVE = new Set(["subscription_failed", "subscription_canceled", "subscription_suspended"]);
const PAY_TYPES = [...ACTIVE, ...INACTIVE];

export function makeBin3(h) {
  const { db, addEvent, logInbound, json } = h;

  // ---------- 共通 ----------
  function jwtClaims(token) {
    try {
      const part = String(token || "").split(".")[1];
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
      return JSON.parse(atob(b64));
    } catch (_) { return {}; }
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

  // Webhook の合言葉は新しい秘密の値を増やさず、MCP_SECRET から作る（シアニン用の画面にだけ出す）
  const webhookAuth = async (env) => (await hmacHex(env.MCP_SECRET, "univapay-webhook")).slice(0, 40);
  const unsubToken = async (env, customerId) => (await hmacHex(env.MCP_SECRET, "unsub:" + customerId)).slice(0, 32);

  function univapayState(env) {
    const token = env.UNIVAPAY_APP_TOKEN || "";
    const c = jwtClaims(token);
    return {
      configured: !!(token && env.UNIVAPAY_APP_SECRET),
      app_id: token || null,
      store_id: c.store_id || null,
      mode: c.mode || null,
    };
  }

  async function univapay(env, method, path, body) {
    const res = await fetch(UNIVAPAY_API + path, {
      method,
      headers: {
        authorization: `Bearer ${env.UNIVAPAY_APP_SECRET}.${env.UNIVAPAY_APP_TOKEN}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 300) }; }
    return { ok: res.ok, status: res.status, data };
  }

  // ---------- 権利（記録から計算する） ----------
  async function payEvents(env, customerId) {
    let q = `events?select=id,customer_id,type,payload,occurred_at&type=in.(${PAY_TYPES.join(",")})&order=id.asc&limit=5000`;
    if (customerId) q += `&customer_id=eq.${customerId}`;
    return await db(env, "GET", q);
  }

  function entitlementOf(evs) {
    let last = null, sub = null, since = null;
    for (const e of evs) {
      last = e;
      if (e.type === "subscription_started") { sub = e.payload && e.payload.subscription_id; since = since || e.occurred_at; }
    }
    if (!last) return { member: false, status: "none", plan: null };
    return {
      member: ACTIVE.has(last.type),
      status: ACTIVE.has(last.type) ? "active" : last.type.replace("subscription_", ""),
      plan: PLAN.name,
      subscription_id: sub,
      since,
      last_event_at: last.occurred_at,
    };
  }

  async function entitlement(env, customerId) {
    return entitlementOf(await payEvents(env, customerId));
  }

  async function entitlementMap(env) {
    const evs = await payEvents(env);
    const by = new Map();
    for (const e of evs) { if (!by.has(e.customer_id)) by.set(e.customer_id, []); by.get(e.customer_id).push(e); }
    const out = {};
    for (const [id, list] of by) out[id] = entitlementOf(list);
    return out;
  }

  // 定期課金の番号から、どの人のものかを引く（始まったときの記録で結ぶ）
  async function customerBySubscription(env, subscriptionId) {
    const rows = await db(env, "GET", `events?select=customer_id&type=eq.subscription_started&payload->>subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`);
    return rows.length ? rows[0].customer_id : null;
  }

  // ---------- 決済の確かめ（画面から） ----------
  // ウィジェットが UnivaPay で定期課金を作ったあと、画面がその番号を送ってくる。
  // 画面の言うことは信じず、秘密の鍵で UnivaPay に聞き直してから台帳に積む。
  async function confirmCheckout(env, { email, subscription_id, raw }) {
    const st = univapayState(env);
    if (!st.configured || !st.store_id) return { ok: false, error: "univapay_not_configured" };
    const mail = String(email || "").trim().toLowerCase();
    const sid = String(subscription_id || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: "bad_email" };
    if (!/^[0-9a-f-]{36}$/i.test(sid)) return { ok: false, error: "bad_subscription_id", raw_keys: raw && typeof raw === "object" ? Object.keys(raw) : null };
    const [customer] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(mail)}`);
    if (!customer) return { ok: false, error: "not_registered" };
    const already = await customerBySubscription(env, sid);
    if (already && already !== customer.id) return { ok: false, error: "subscription_taken" };
    if (already === customer.id) return { ok: true, already: true, entitlement: await entitlement(env, customer.id) };
    const r = await univapay(env, "GET", `/stores/${st.store_id}/subscriptions/${sid}`);
    if (!r.ok) return { ok: false, error: "univapay_lookup_failed", status: r.status };
    const s = r.data || {};
    if (["canceled", "suspended", "unpaid"].includes(s.status)) return { ok: false, error: "subscription_not_active", status: s.status };
    await addEvent(env, customer.id, "subscription_started", {
      subscription_id: sid, status: s.status || null, amount: s.amount ?? PLAN.amount,
      currency: s.currency || PLAN.currency, period: s.period || PLAN.period, mode: s.mode || st.mode, via: "checkout",
    }, "site");
    const mailResult = await sendMail(env, customer, {
      kind: "purchase",
      subject: "【言語化ラボ・デモ】ご入会ありがとうございます",
      text: `${customer.name || ""} さん\n\n${PLAN.name}（月 ${PLAN.amount.toLocaleString()} 円・テスト決済）のお申し込みを受け付けました。\nログインすると教材と添削ルームが使えます。\n\nhttps://utage-alt-demo.gameister1.workers.dev/app`,
    });
    return { ok: true, already: false, entitlement: await entitlement(env, customer.id), mail: mailResult.result };
  }

  // ---------- UnivaPay の知らせ（Webhook） ----------
  async function handleWebhook(request, env) {
    const raw = await request.text();
    let body = null;
    try { body = JSON.parse(raw); } catch (_) {}
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = await webhookAuth(env);
    const event = body && body.event;
    const data = (body && body.data) || {};
    const reqLog = { event: event || null, id: data.id || null, subscription_id: data.subscription_id || (String(event || "").startsWith("subscription_") ? data.id : null), status: data.status || null, auth_ok: safeEqual(auth, expected) };
    if (!safeEqual(auth, expected)) {
      await logInbound(env, "univapay", reqLog, { ok: false, error: "unauthorized" }, 401);
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!event) {
      await logInbound(env, "univapay", reqLog, { ok: false, error: "bad_body" }, 400);
      return json({ ok: false, error: "bad_body" }, 400);
    }
    // B の便 4：単発の決済の知らせ（charge_finished）は売る側（sell.js）が見る
    if (h.onCharge && String(event).startsWith("charge_")) {
      const rc = await h.onCharge(env, event, data);
      if (rc) {
        await logInbound(env, "univapay", reqLog, rc, 200);
        return json(rc);
      }
    }
    const map = {
      subscription_payment: "subscription_payment",
      subscription_failure: "subscription_failed",
      subscription_canceled: "subscription_canceled",
      subscription_suspended: "subscription_suspended",
    };
    let result = { ok: true, recorded: false };
    const subId = reqLog.subscription_id;
    if (subId && map[event]) {
      const customerId = await customerBySubscription(env, subId);
      if (customerId) {
        // 同じ知らせが再送されても 1 件だけ積む
        const dup = await db(env, "GET", `events?select=id&customer_id=eq.${customerId}&type=eq.${map[event]}&payload->>webhook_key=eq.${encodeURIComponent(event + ":" + (data.id || "") + ":" + (data.status || "") + ":" + (data.last_payment_date || data.next_payment && data.next_payment.id || ""))}&limit=1`);
        if (!dup.length) {
          await addEvent(env, customerId, map[event], {
            subscription_id: subId, status: data.status || null, amount: data.amount ?? null,
            webhook_key: event + ":" + (data.id || "") + ":" + (data.status || "") + ":" + (data.last_payment_date || data.next_payment && data.next_payment.id || ""),
          }, "webhook");
          result = { ok: true, recorded: true, type: map[event] };
          // 便 6b：定期が止まった・戻ったら、門番の表の B の権利を合わせ直す
          if (h.onSubEvent) result.grants = await h.onSubEvent(env, customerId, map[event], subId);
        } else result = { ok: true, recorded: false, duplicate: true };
      } else result = { ok: true, recorded: false, reason: "unknown_subscription" };
    } else result = { ok: true, recorded: false, reason: "not_tracked" };
    await logInbound(env, "univapay", reqLog, result, 200);
    return json(result);
  }

  // ---------- メール ----------
  // 送り先の制限。誰にでも送るかは設定の mail_scope（src/mailcfg.js）で決まる。
  // 誰にでも送らないときは、シアニン用の画面に入れるメール（とその + 付きの別名）と、MAIL_ALLOW に並べた宛先だけ
  async function mailAllowed(env, to, kind) {
    const cfg = await h.mailcfg.get(env);
    if (h.mailcfg.openFor(cfg, kind)) return true;
    const addr = String(to || "").toLowerCase();
    const [local, domain] = addr.split("@");
    if (!local || !domain) return false;
    const base = local.split("+")[0] + "@" + domain;
    const extra = String(env.MAIL_ALLOW || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    if (extra.includes(addr) || extra.includes(base)) return true;
    const admins = await db(env, "GET", "admins?select=email");
    return admins.some((a) => a.email === addr || a.email === base);
  }

  async function unsubscribed(env, customerId) {
    const rows = await db(env, "GET", `events?select=id&customer_id=eq.${customerId}&type=eq.email_unsubscribed&limit=1`);
    return rows.length > 0;
  }

  // B の便 7c-1：送り元・表示名・返信先・誰に送るかは表 b_settings（デモの置き場は Cloudflare の値）
  async function mailState(env) {
    const cfg = await h.mailcfg.get(env);
    return { binding: !!env.EMAIL, from: cfg.from || null, from_name: cfg.from_name || null, reply_to: cfg.reply_to || null, scope: cfg.scope, configured: !!(env.EMAIL && cfg.from) };
  }

  // 送った・送らなかった・失敗した、のどれでも出来事として積む（0 件と失敗を混ぜない）
  async function sendMail(env, customer, { kind, subject, text, actor = "site", force = false, extra = {} }) {
    const base = { kind, to: customer.email, subject, ...extra };
    if (!force && await unsubscribed(env, customer.id)) {
      await addEvent(env, customer.id, "email_blocked", { ...base, reason: "unsubscribed" }, actor);
      return { result: "blocked", reason: "unsubscribed" };
    }
    if (!(await mailAllowed(env, customer.email, kind))) {
      await addEvent(env, customer.id, "email_blocked", { ...base, reason: "not_test_recipient" }, actor);
      return { result: "blocked", reason: "not_test_recipient" };
    }
    const ms = await mailState(env);
    if (!ms.configured) {
      await addEvent(env, customer.id, "email_failed", { ...base, error: "mail_not_configured" }, actor);
      return { result: "failed", error: "mail_not_configured" };
    }
    const cfg = await h.mailcfg.get(env);
    const origin = env.PUBLIC_ORIGIN || "https://utage-alt-demo.gameister1.workers.dev";
    const unsubUrl = `${origin}/api/unsubscribe?c=${customer.id}&t=${await unsubToken(env, customer.id)}`;
    const foot = h.mailcfg.footer(env, cfg, unsubUrl);
    const bodyText = String(text) + foot.text;
    const html = "<div style=\"font-family:sans-serif;line-height:1.8;white-space:pre-wrap\">" + escapeHtml(String(text)) + "</div>"
      + "<hr style=\"border:0;border-top:1px solid #ddd;margin:24px 0\"><div style=\"font-size:12px;color:#777;font-family:sans-serif\">" + foot.html + "</div>";
    try {
      const msg = {
        to: customer.email, from: h.mailcfg.fromField(cfg), subject, text: bodyText, html,
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
      if (cfg.reply_to) msg.replyTo = cfg.reply_to;
      const r = await env.EMAIL.send(msg);
      await addEvent(env, customer.id, "email_sent", { ...base, message_id: r && r.messageId || null }, actor);
      return { result: "sent", message_id: r && r.messageId || null };
    } catch (e) {
      const err = { code: e && e.code || null, message: String(e && e.message || e).slice(0, 200) };
      await addEvent(env, customer.id, "email_failed", { ...base, error: err.code || "send_error", detail: err.message }, actor);
      return { result: "failed", error: err.code || "send_error", detail: err.message };
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function sendMailTo(env, { person_id, subject, body }, actor) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const s = String(subject || "").trim().slice(0, 200), b = String(body || "").trim().slice(0, 10000);
    if (!s || !b) return { ok: false, error: "need_subject_and_body" };
    const [customer] = await db(env, "GET", `customers?select=id,email,name&id=eq.${person_id}`);
    if (!customer) return { ok: true, found: false };
    const r = await sendMail(env, customer, { kind: "manual", subject: s, text: b, actor });
    return { ok: r.result !== "failed", found: true, ...r };
  }

  async function handleUnsubscribe(request, env, url) {
    const c = url.searchParams.get("c") || "", t = url.searchParams.get("t") || "";
    const page = (msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>配信の停止</title><body style="font-family:sans-serif;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.8"><h1 style="font-size:20px">配信の停止</h1><p>${msg}</p><p><a href="/">${env.B_STORE ? "シアラボ" : "言語化ラボ（デモ）"}へ</a></p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!/^[0-9a-f-]{36}$/i.test(c) || !safeEqual(t, await unsubToken(env, c))) return page("このリンクは使えません。");
    if (!(await unsubscribed(env, c))) await addEvent(env, c, "email_unsubscribed", { via: request.method === "POST" ? "one_click" : "link" }, "site");
    return page("お知らせのメールを止めました。ログインのリンクなど、手続きに要るメールは届きます。");
  }

  // ---------- 定時の処理：添削が返ったのに 1 時間以上読まれていない人へ、メールを 1 通だけ ----------
  async function remindUnread(env, roomEvents, roomState) {
    const evs = await roomEvents(env);
    const by = new Map();
    for (const e of evs) { if (!by.has(e.customer_id)) by.set(e.customer_id, []); by.get(e.customer_id).push(e); }
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const out = { checked: by.size, sent: 0, blocked: 0, failed: 0, skipped: 0 };
    for (const [cid, list] of by) {
      const s = roomState(list);
      const unread = list.filter((e) => e.type === "correction_returned" && e.id > s.studentReadUpto);
      if (!unread.length) continue;
      const latest = unread[unread.length - 1];
      if (new Date(latest.occurred_at).getTime() > hourAgo) { out.skipped++; continue; }
      const done = await db(env, "GET", `events?select=id&customer_id=eq.${cid}&type=in.(email_sent,email_blocked)&payload->>kind=eq.room_unread&payload->>upto=eq.${latest.id}&limit=1`);
      if (done.length) continue;
      const [customer] = await db(env, "GET", `customers?select=id,email,name&id=eq.${cid}`);
      if (!customer) continue;
      const r = await sendMailWithUpto(env, customer, latest.id, unread.length);
      out[r.result === "sent" ? "sent" : r.result === "blocked" ? "blocked" : "failed"]++;
    }
    return out;
  }

  // 送った記録に upto（どの返事についてか）を残し、同じ返事について 2 通目を出さない
  async function sendMailWithUpto(env, customer, upto, n) {
    return await sendMail(env, customer, {
      kind: "room_unread",
      subject: env.B_STORE ? "【シアラボ】添削が返っています" : "【言語化ラボ・デモ】添削が返っています",
      text: `${customer.name || ""} さん\n\n添削ルームに、まだ読んでいない添削が ${n} 件あります。\n\n${env.PUBLIC_ORIGIN || "https://utage-alt-demo.gameister1.workers.dev"}/app#room`,
      extra: { upto: String(upto) },
    });
  }

  return {
    PLAN, univapayState, mailState, webhookAuth, entitlement, entitlementMap,
    confirmCheckout, handleWebhook, sendMail, sendMailTo, handleUnsubscribe, remindUnread, mailAllowed,
  };
}

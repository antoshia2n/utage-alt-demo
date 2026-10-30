// マーケくん：招待リンク（2026-10-30・依頼書「ゲストの招待リンク」・Naoki 09:49「OK」）
//
// お金を払わずに入る人（ゲスト・モニター・先行）の入口。リンクを開いて「Google で登録」を押すと、
// Google が確かめたメールで会員の行を作り（いればその行）、リンクに決めた権利を期限つきで付け、
// Google のログインの番号を会員の行に結ぶ（5 つのアプリは同じ Google で入れる）。
// お金を払う権利（shiarabo_basic・NEXT など）は付けられない。決済を通らずに入る抜け道になるため。
//
// 表は supabase/b31_invites.sql（b_invites・b_invite_uses・関数 b_invite_take）。

import { PUBLISH_APPS } from "./bridge.js";

export const INVITE_KEYS = ["guest", "shiarabo_monitor", "shiarabo_pilot"];
export const INVITE_KEY_LABEL = { guest: "ゲスト", shiarabo_monitor: "モニター", shiarabo_pilot: "先行で試す" };
// 期限を必ず付ける権利（bridge.js の EXPIRY_REQUIRED と同じ）
const GRANT_UNTIL_REQUIRED = ["guest", "shiarabo_monitor"];

// 5 つのアプリが使う Google ログイン（Firebase）の番号。公開してよい値（どのアプリの画面にも載っている）
export const FIREBASE_PROJECT = "gen-lang-client-0371348401";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86400000;

const b64url = (s) => {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

export function newToken() {
  const a = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// リンクの今の状態（表の行から）。数えた数は外へ出さず、使えるかだけ返す
export function inviteState(inv, now = Date.now()) {
  if (!inv) return "not_found";
  if (!inv.active) return "stopped";
  if (new Date(inv.link_until).getTime() <= now) return "expired";
  if (Number(inv.used) >= Number(inv.max_uses)) return "used_up";
  return "ok";
}

// 作るときの値を確かめる。日付は「その日の終わり（日本時間）」まで
export function checkCreate(body = {}, now = Date.now()) {
  const name = String(body.name ?? "").trim();
  if (!name) return { ok: false, error: "name_required" };
  if (name.length > 40) return { ok: false, error: "name_too_long", max: 40 };
  const key = String(body.key ?? "");
  if (!INVITE_KEYS.includes(key)) return { ok: false, error: "key_not_allowed", allowed: INVITE_KEYS };
  const maxUses = Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) return { ok: false, error: "bad_max_uses", min: 1, max: 100 };
  const linkUntil = dayEnd(body.link_until);
  if (!linkUntil) return { ok: false, error: "link_until_required" };
  if (new Date(linkUntil).getTime() <= now) return { ok: false, error: "link_until_past" };
  if (new Date(linkUntil).getTime() > now + 180 * DAY) return { ok: false, error: "link_until_too_far", max_days: 180 };
  let grantUntil = null;
  if (body.grant_until) {
    grantUntil = dayEnd(body.grant_until);
    if (!grantUntil) return { ok: false, error: "bad_grant_until" };
    if (new Date(grantUntil).getTime() <= now) return { ok: false, error: "grant_until_past" };
  }
  if (!grantUntil && GRANT_UNTIL_REQUIRED.includes(key)) return { ok: false, error: "grant_until_required" };
  return { ok: true, row: { name, key, max_uses: maxUses, link_until: linkUntil, grant_until: grantUntil } };
}

// "2026-12-31" → その日の 23:59:59（日本時間）。ISO の日時ならそのまま
export function dayEnd(v) {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(`${s}T23:59:59+09:00`);
    return isNaN(t) ? null : t.toISOString();
  }
  const t = new Date(s);
  return s && !isNaN(t) ? t.toISOString() : null;
}

// Google（Firebase）のログインの印を確かめる。署名・発行元・宛先・期限・メールを Google が確かめ済みか
export async function verifyGoogleToken(idToken, { fetchImpl = fetch, now = Date.now(), keys = null } = {}) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return { ok: false, error: "bad_token" };
  let head, pay;
  try { head = b64urlJson(parts[0]); pay = b64urlJson(parts[1]); } catch { return { ok: false, error: "bad_token" }; }
  if (head.alg !== "RS256" || !head.kid) return { ok: false, error: "bad_token" };
  let jwks = keys;
  if (!jwks) {
    const r = await fetchImpl(JWK_URL);
    if (!r.ok) return { ok: false, error: "google_keys_unavailable" };
    jwks = (await r.json()).keys || [];
  }
  const jwk = jwks.find((k) => k.kid === head.kid);
  if (!jwk) return { ok: false, error: "bad_token" };
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!good) return { ok: false, error: "bad_token" };
  const sec = Math.floor(now / 1000);
  if (pay.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` || pay.aud !== FIREBASE_PROJECT) return { ok: false, error: "bad_token" };
  if (!(pay.exp > sec) || !(pay.iat <= sec + 300)) return { ok: false, error: "token_expired" };
  if (!pay.sub || typeof pay.sub !== "string") return { ok: false, error: "bad_token" };
  const email = String(pay.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "no_email" };
  if (pay.email_verified !== true) return { ok: false, error: "email_not_verified" };
  return { ok: true, uid: pay.sub, email, name: String(pay.name || "").trim().slice(0, 60) };
}

export function makeInvite(h) {
  // h: { db, rpc, addEvent, logInbound, grantManual, appUrls, mailcfg, mailText, mailHtml, origin, verify }
  const verify = h.verify || verifyGoogleToken;

  async function byToken(env, token) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const [inv] = await h.db(env, "GET", `b_invites?select=*&token=eq.${encodeURIComponent(token)}`);
    return inv || null;
  }
  const linkOf = (env, token) => `${h.origin(env)}/invite?t=${token}`;

  // その権利で開くアプリ（アプリの公開の表から）
  async function appsFor(env, key) {
    const rows = await h.db(env, "GET", `member_access?select=target&entitlement_key=eq.${encodeURIComponent(key)}&limit=100`);
    return [...new Set(rows.map((r) => r.target))].filter((t) => h.appUrls[t]).map((t) => ({ target: t, name: (PUBLISH_APPS.find((a) => a.target === t) || {}).name || t, url: h.appUrls[t] }));
  }

  // ---------- 公開の面（ログイン不要） ----------
  async function publicView(env, token) {
    const inv = await byToken(env, token);
    const state = inviteState(inv);
    if (!inv) return { ok: false, error: "not_found" };
    return { ok: true, state, name: inv.name, key: inv.key, key_label: INVITE_KEY_LABEL[inv.key] || inv.key, grant_until: inv.grant_until };
  }

  async function accept(env, { token, id_token } = {}) {
    const inv = await byToken(env, token);
    const pre = inviteState(inv);
    if (!inv) return { ok: false, error: "not_found" };
    const g = await verify(id_token);
    if (!g.ok) return g;

    // 1. 誰か：同じ Google の番号を持つ会員がいればその人、いなければ同じメールの人、どちらもいなければ作る
    let [m] = await h.db(env, "GET", `member?select=id,email,auth_uid&auth_uid=eq.${encodeURIComponent(g.uid)}`);
    let created = false;
    if (!m) [m] = await h.db(env, "GET", `member?select=id,email,auth_uid&email=eq.${encodeURIComponent(g.email)}`);
    if (!m && pre !== "ok") return { ok: false, error: pre };
    if (!m) {
      const rows = await h.db(env, "POST", "customers", [{ email: g.email, name: g.name, source: "direct" }], "return=representation");
      m = { id: rows[0].id, email: g.email, auth_uid: null };
      created = true;
      await h.addEvent(env, m.id, "registered", { source: "direct", via: "invite", invite_id: inv.id }, "site");
    }
    // 2. Google の番号を会員の行に結ぶ（空のときだけ。埋まっていれば触らない）
    let bound = m.auth_uid === g.uid ? "already" : "skipped";
    if (!m.auth_uid) {
      await h.db(env, "PATCH", `member?id=eq.${m.id}&auth_uid=is.null`, { auth_uid: g.uid }, "return=minimal");
      bound = "bound";
    }
    // 3. リンクを 1 人分使う（人数・期限・止めた印は表の中の関数が 1 か所で見る。同じ人の 2 回目は数えない）
    const took = await h.rpc(env, "b_invite_take", { p_token: inv.token, p_member: m.id });
    if (took !== "ok" && took !== "already") {
      await h.logInbound(env, "invite", { invite_id: inv.id, member_id: m.id }, { ok: false, error: took, created }, 409);
      return { ok: false, error: took };
    }
    // 4. 権利を付ける（同じ権利の手当ての行があれば、期限を遅いほうへ延ばす）
    const grant = await grantOrExtend(env, m.id, inv);
    if (!grant.ok) {
      await h.logInbound(env, "invite", { invite_id: inv.id, member_id: m.id }, { ok: false, error: grant.error, took }, 500);
      return { ok: false, error: "grant_failed", detail: grant.error };
    }
    await h.addEvent(env, m.id, "invite_accepted", { invite_id: inv.id, key: inv.key, until: inv.grant_until, again: took === "already", bound }, "site");
    await h.logInbound(env, "invite", { invite_id: inv.id, member_id: m.id }, { ok: true, took, created, bound, grant: grant.how }, 200);
    return { ok: true, email: g.email, is_new: created, again: took === "already", key: inv.key, key_label: INVITE_KEY_LABEL[inv.key], grant_until: inv.grant_until, bound, apps: await appsFor(env, inv.key) };
  }

  async function grantOrExtend(env, memberId, inv) {
    const rows = await h.db(env, "GET", `member_entitlement?select=id,expires_at&member_id=eq.${memberId}&key=eq.${inv.key}&source=eq.manual`);
    if (rows.length) {
      const cur = rows[0];
      const later = cur.expires_at && (!inv.grant_until || new Date(inv.grant_until) > new Date(cur.expires_at));
      if (later) await h.db(env, "PATCH", `member_entitlement?id=eq.${cur.id}`, { expires_at: inv.grant_until }, "return=minimal");
      return { ok: true, how: later ? "extended" : "kept" };
    }
    const r = await h.grantManual(env, { person_id: memberId, key: inv.key, reason: `招待リンク「${inv.name}」`, expires_at: inv.grant_until }, "site");
    return r.ok && r.found ? { ok: true, how: "granted" } : { ok: false, error: r.error || "not_found" };
  }

  // ---------- 管理画面（/admin だけ） ----------
  async function list(env) {
    const invs = await h.db(env, "GET", "b_invites?select=*&order=created_at.desc&limit=200");
    const uses = invs.length ? await h.db(env, "GET", `b_invite_uses?select=invite_id,member_id,used_at&invite_id=in.(${invs.map((i) => i.id).join(",")})&order=used_at.desc&limit=2000`) : [];
    const ids = [...new Set(uses.map((u) => u.member_id))];
    const people = ids.length ? await h.db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
    const who = new Map(people.map((p) => [p.id, p]));
    return {
      ok: true, keys: INVITE_KEYS.map((k) => ({ key: k, label: INVITE_KEY_LABEL[k], grant_until_required: GRANT_UNTIL_REQUIRED.includes(k) })),
      invites: invs.map((i) => ({
        id: i.id, name: i.name, key: i.key, key_label: INVITE_KEY_LABEL[i.key] || i.key, grant_until: i.grant_until,
        max_uses: i.max_uses, used: i.used, link_until: i.link_until, state: inviteState(i), created_at: i.created_at, created_by: i.created_by,
        url: linkOf(env, i.token),
        uses: uses.filter((u) => u.invite_id === i.id).map((u) => ({ person_id: u.member_id, name: (who.get(u.member_id) || {}).name || "", email: (who.get(u.member_id) || {}).email || "", used_at: u.used_at })),
      })),
    };
  }

  async function create(env, body, by) {
    const c = checkCreate(body);
    if (!c.ok) return c;
    const [row] = await h.db(env, "POST", "b_invites", [{ ...c.row, token: newToken(), created_by: by || null }], "return=representation");
    return { ok: true, invite: { id: row.id, name: row.name, url: linkOf(env, row.token) } };
  }

  async function stop(env, id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const rows = await h.db(env, "PATCH", `b_invites?id=eq.${id}&active=eq.true`, { active: false, stopped_at: new Date().toISOString() }, "return=representation");
    return { ok: true, stopped: rows.length };
  }

  // 招待のメール（相手のメールを入れて送る）。まだ台帳にいない人へも送れる（宣伝ではなく、本人に渡す招待）
  async function send(env, id, { emails, note } = {}, by) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const list = [...new Set(String(Array.isArray(emails) ? emails.join("\n") : emails || "").split(/[\s,、]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
    if (!list.length) return { ok: false, error: "emails_required" };
    if (list.length > 20) return { ok: false, error: "too_many", max: 20 };
    const bad = list.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) return { ok: false, error: "bad_email", bad };
    const [inv] = await h.db(env, "GET", `b_invites?select=*&id=eq.${id}`);
    if (!inv) return { ok: false, error: "not_found" };
    const st = inviteState(inv);
    if (st !== "ok") return { ok: false, error: st };
    const cfg = await h.mailcfg.get(env);
    if (!env.EMAIL || !cfg.from) return { ok: false, error: "mail_not_configured" };
    const link = linkOf(env, inv.token);
    const until = inv.grant_until ? new Date(inv.grant_until).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : null;
    const extra = String(note || "").trim().slice(0, 500);
    const text = [
      "シアラボへの招待が届いています。",
      "",
      ...(extra ? [extra, ""] : []),
      "下のリンクを開いて「Google で登録」を押すと、登録が済みます。パスワードは要りません。",
      link,
      "",
      `・使えるようになるもの：${INVITE_KEY_LABEL[inv.key]}の範囲のアプリとマイページ${until ? `（${until} まで）` : ""}`,
      "・アプリには、登録に使った Google のアカウントで入ります",
      `・このリンクは ${new Date(inv.link_until).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} まで使えます`,
      "",
      "心当たりが無ければ、このメールは捨ててください。",
    ].join("\n");
    const results = [];
    for (const to of list) {
      try {
        const msg = { to, from: h.mailcfg.fromField(cfg), subject: "シアラボへの招待", text: h.mailText(text), html: h.mailHtml(text, { brand: "シアラボ" }) };
        if (cfg.reply_to) msg.replyTo = cfg.reply_to;
        const r = await env.EMAIL.send(msg);
        results.push({ to, result: "sent", message_id: (r && r.messageId) || null });
      } catch (e) {
        results.push({ to, result: "failed", error: String((e && (e.code || e.message)) || e).slice(0, 120) });
      }
    }
    await h.logInbound(env, "invite_mail", { invite_id: inv.id, count: list.length, by: by || null }, { results: results.map((r) => ({ result: r.result, error: r.error || null })) }, 200);
    return { ok: true, sent: results.filter((r) => r.result === "sent").length, failed: results.filter((r) => r.result !== "sent").length, results };
  }

  return { publicView, accept, list, create, stop, send, appsFor };
}

// B の便 14a：LINE の受け口。LINE の公式アカウントの知らせ（Webhook）を B が受け、同じ中身と同じ署名のまま UTAGE へ転送する。
//   住所：POST /api/line/webhook/<account>（account は英小文字と下線。例 college_ops）
//   署名の鍵：Cloudflare の秘密の値 LINE_SECRET_<ACCOUNT を大文字>（LINE Developers の「チャネルシークレット」）
//   転送先：表 b_settings の 1 行（key=line_forward_<account>・UTAGE の Webhook の住所）。画面か承認つきの AI の道具で変える
// 記録：知らせ 1 回につき b_inbound_log に 1 行。転送できたら channel=line、できなかったら channel=line_forward_failed（統括の条件 1）。
//   中身は知らせの要点（種類・LINE の番号・メッセージの種類と文）と、転送の結果（状態の番号・かかった時間）。
// LINE には署名を確かめた時点ですぐ 200 を返し、転送はそのあと（ctx.waitUntil）で行う。転送は 10 秒で打ち切る。
// 戻し方（統括の条件 2）：LINE Developers の Webhook URL を、控えた UTAGE の住所に戻せば元どおり（B を通らなくなる）。
// 表は増やさない。
// 便 14b：LINE で送る。鍵は Cloudflare の秘密の値 LINE_TOKEN_<ACCOUNT を大文字>（LINE Developers の長期のチャネルアクセストークン）。
//   友だち追加の知らせが来たら、その人専用の「メールを登録」のリンクを 1 通送る（push。UTAGE があいさつに返事の番号を使うので返事の番号は使わない）。
//   リンクの先 /line-link?t=… でメールを入れると、台帳の人と LINE の番号が出来事 line_linked（account・user）で結ばれる。
//   リンクの印は「アカウント:LINE の番号」をチャネルシークレットで署名したもの（ほかの人の番号をすり替えられない）。
//   送る道具（send_line）は承認が要る。送ったら 1 人ずつ出来事 line_sent を積む。ブロックした人（最後が unfollow）には送らない。

export const ACCOUNT_RE = /^[a-z][a-z_]{1,19}$/;
export const FORWARD_PREFIX = "line_forward_";
const URL_RE = /^https:[/][/][^\s<>"']{4,490}$/;
const FORWARD_TIMEOUT_MS = 10000;
const TEXT_KEEP = 1000;

export const secretName = (account) => "LINE_SECRET_" + String(account).toUpperCase();
export const tokenName = (account) => "LINE_TOKEN_" + String(account).toUpperCase();
const LINE_API = "https://api.line.me/v2/bot";
const TEXT_MAX = 2000;
const b64u = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))); };

// リンクの印：「account:user」を base64url にし、チャネルシークレットの HMAC の頭 22 字を付ける
export async function linkToken(secret, account, user) {
  const body = b64u(`${account}:${user}`);
  const sig = (await lineSignature(secret, "link:" + body)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
  return `${body}.${sig}`;
}
export function parseLinkToken(t) {
  const m = String(t || "").match(/^([A-Za-z0-9_-]{8,200})[.]([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  let raw = ""; try { raw = unb64u(m[1]); } catch (_) { return null; }
  const mm = raw.match(/^([a-z][a-z_]{1,19}):(U[0-9a-f]{32})$/);
  return mm ? { account: mm[1], user: mm[2], body: m[1], sig: m[2] } : null;
}

// 署名：チャネルシークレットを鍵にした本文の HMAC-SHA256 を base64 にしたもの（LINE の公式の決まり）
export async function lineSignature(secret, rawBody) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  let s = ""; for (const b of mac) s += String.fromCharCode(b);
  return btoa(s);
}

function sameText(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 知らせ 1 件の要点（記録に残す分）
export function summarizeEvent(e) {
  const o = { type: e.type, at: e.timestamp ? new Date(e.timestamp).toISOString() : null, id: e.webhookEventId || null };
  if (e.source) o.source = { type: e.source.type, user: e.source.userId || null, ...(e.source.groupId ? { group: e.source.groupId } : {}), ...(e.source.roomId ? { room: e.source.roomId } : {}) };
  if (e.deliveryContext && e.deliveryContext.isRedelivery) o.redelivery = true;
  if (e.message) o.message = { type: e.message.type, id: e.message.id || null, ...(e.message.type === "text" ? { text: String(e.message.text || "").slice(0, TEXT_KEEP) } : {}) };
  if (e.postback) o.postback = String(e.postback.data || "").slice(0, 300);
  return o;
}

export function makeLine(h) {
  const { db, logInbound, changes } = h;
  const forwardKey = (account) => FORWARD_PREFIX + account;

  async function forwardUrl(env, account) {
    const rows = await db(env, "GET", `settings?select=value,updated_at,updated_by&key=eq.${forwardKey(account)}`);
    return rows.length ? { url: rows[0].value || "", updated_at: rows[0].updated_at, updated_by: rows[0].updated_by } : { url: "", updated_at: null, updated_by: null };
  }

  async function forward(env, url, rawBody, signature) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FORWARD_TIMEOUT_MS);
    try {
      const r = await (h.fetch || fetch)(url, {
        method: "POST", body: rawBody, signal: ctl.signal,
        headers: { "content-type": "application/json; charset=utf-8", "x-line-signature": signature, "user-agent": "LineBotWebhook/2.0" },
      });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, status: 0, ms: Date.now() - t0, error: ctl.signal.aborted ? "timeout" : String(e && e.message || e).slice(0, 200) };
    } finally { clearTimeout(timer); }
  }

  // 受け口。返すのは Response。転送と記録は ctx.waitUntil の中
  async function handleWebhook(request, env, ctx, account) {
    const res = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
    if (!env.B_STORE) return res({ ok: false, error: "demo_store" }, 503);
    if (!ACCOUNT_RE.test(account)) return res({ ok: false, error: "bad_account" }, 404);
    const secret = env[secretName(account)];
    const raw = await request.text();
    if (!secret) {
      await logInbound(env, "line_forward_failed", { account, reason: "no_secret" }, { ok: false, error: "no_secret", need: secretName(account) }, 503);
      return res({ ok: false, error: "no_secret" }, 503);
    }
    const sig = request.headers.get("x-line-signature") || "";
    if (!sameText(sig, await lineSignature(secret, raw))) {
      await logInbound(env, "line_bad_signature", { account, bytes: raw.length }, { ok: false }, 401);
      return res({ ok: false, error: "bad_signature" }, 401);
    }
    let body = {};
    try { body = JSON.parse(raw); } catch (_) { body = {}; }
    const events = Array.isArray(body.events) ? body.events : [];
    const request_ = { account, destination: body.destination || null, count: events.length, events: events.slice(0, 50).map(summarizeEvent) };
    const work = (async () => {
      const fw = await forwardUrl(env, account);
      const r = fw.url ? await forward(env, fw.url, raw, sig) : { ok: false, status: 0, ms: 0, error: "no_forward_url" };
      await logInbound(env, r.ok ? "line" : "line_forward_failed", request_, { forward: r }, r.ok ? 200 : (r.status || 502));
      // 便 14b：友だち追加の人へ「メールを登録」のリンクを 1 通（鍵があり、まだ結ばれていない人だけ）
      for (const e of events) {
        if (e.type !== "follow" || !e.source || !e.source.userId) continue;
        try { await sendLinkInvite(env, account, e.source.userId, secret); } catch (err) { await logInbound(env, "line_link_invite", { account }, { ok: false, error: String(err && err.message || err).slice(0, 200) }, 500); }
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    return res({ ok: true }, 200);
  }

  // 設定を見る（AI と画面）。転送先の住所は丸ごとは返さず、住所の頭だけ
  async function settings(env, { account } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const origin = String(env.PUBLIC_ORIGIN || "https://lab.shia2n.jp").replace(/\/+$/, "");
    const rows = await db(env, "GET", `settings?select=key,value,updated_at,updated_by&key=like.${FORWARD_PREFIX}*`); // LINE の行だけ（ほかの設定の値は読まない）
    const names = new Set(rows.filter((r) => String(r.key).startsWith(FORWARD_PREFIX)).map((r) => String(r.key).slice(FORWARD_PREFIX.length)));
    if (account) { if (!ACCOUNT_RE.test(account)) return { ok: false, error: "bad_account", note: "英小文字で始まる英小文字と下線の 2〜20 字" }; names.add(account); }
    const accounts = [...names].sort().map((a) => {
      const row = rows.find((r) => r.key === forwardKey(a));
      let host = null; try { host = row && row.value ? new URL(row.value).host : null; } catch (_) { host = "読めない住所"; }
      return { account: a, webhook_url: `${origin}/api/line/webhook/${a}`, secret_name: secretName(a), secret_set: !!env[secretName(a)], token_name: tokenName(a), token_set: !!env[tokenName(a)],
        forward_set: !!(row && row.value), forward_host: host, updated_at: row ? row.updated_at : null, updated_by: row ? row.updated_by : null };
    });
    return { ok: true, count: accounts.length, accounts, undo: "LINE Developers の Webhook URL を、控えた UTAGE の住所に戻せば元どおり" };
  }

  // 転送先を入れる・外す。外すと UTAGE へ届かなくなる（UTAGE を止める日に使う）
  async function setForward(env, { account, url }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!ACCOUNT_RE.test(String(account || ""))) return { ok: false, error: "bad_account", note: "英小文字で始まる英小文字と下線の 2〜20 字" };
    const v = String(url == null ? "" : url).trim();
    if (v && !URL_RE.test(v)) return { ok: false, error: "bad_url", note: "https:// で始まる 500 文字までの住所" };
    if (v) {
      let host = ""; try { host = new URL(v).host; } catch (_) { return { ok: false, error: "bad_url" }; }
      const own = [env.PUBLIC_ORIGIN, "https://lab.shia2n.jp"].map((o) => { try { return new URL(String(o)).host; } catch (_) { return ""; } });
      if (own.includes(host)) return { ok: false, error: "loop", note: "B 自身の住所へは転送しない（回り続けるため）" };
    }
    const before = await forwardUrl(env, account);
    const now = new Date().toISOString();
    await db(env, "POST", "settings?on_conflict=key", [{ key: forwardKey(account), value: v, updated_at: now, updated_by: String(actor).slice(0, 200) }], "resolution=merge-duplicates,return=minimal");
    await logInbound(env, "line_forward_set", { account, actor, cleared: !v, changed: before.url !== v }, { ok: true }, 200);
    if (changes) await changes.record(env, { kind: "setting", target: forwardKey(account), before: before.url, after: v, summary: v ? `LINE（${account}）の転送先を入れた` : `LINE（${account}）の転送を外した`, actor });
    return { ok: true, account, forward_set: !!v, changed: before.url !== v, ...(await settings(env, { account })).accounts.find((x) => x.account === account) };
  }

  // 受けた数と転送の結果（統括の条件 1：転送の失敗を数える）
  async function inbound(env, { account, days = 7 } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
    const since = new Date(Date.now() - d * 864e5).toISOString();
    let q = `inbound_log?select=id,channel,request,response,status,at&channel=in.(line,line_forward_failed,line_bad_signature)&at=gte.${encodeURIComponent(since)}&order=id.desc&limit=5000`;
    if (account) { if (!ACCOUNT_RE.test(account)) return { ok: false, error: "bad_account" }; q += `&request->>account=eq.${account}`; }
    const rows = await db(env, "GET", q);
    const by = {};
    const acc = (a) => (by[a] = by[a] || { account: a, received: 0, forwarded: 0, forward_failed: 0, bad_signature: 0, events: 0, follows: 0, unfollows: 0, messages: 0, people: new Set(), last_at: null, failures: [] });
    for (const r of rows) {
      const q2 = r.request || {};
      const o = acc(q2.account || "?");
      if (!o.last_at || String(r.at) > o.last_at) o.last_at = r.at;
      if (r.channel === "line_bad_signature") { o.bad_signature++; continue; }
      o.received++;
      if (r.channel === "line") o.forwarded++;
      else { o.forward_failed++; if (o.failures.length < 5) o.failures.push({ at: r.at, status: r.status, error: (r.response && (r.response.forward && r.response.forward.error || r.response.error)) || null }); }
      for (const e of q2.events || []) {
        o.events++;
        if (e.type === "follow") o.follows++;
        if (e.type === "unfollow") o.unfollows++;
        if (e.type === "message") o.messages++;
        if (e.source && e.source.user) o.people.add(e.source.user);
      }
    }
    const accounts = Object.values(by).map((o) => ({ ...o, people: o.people.size })).sort((a, b) => a.account.localeCompare(b.account));
    const total = accounts.reduce((s, o) => ({ received: s.received + o.received, forward_failed: s.forward_failed + o.forward_failed }), { received: 0, forward_failed: 0 });
    return { ok: true, days: d, count: accounts.length, ...total, accounts };
  }

  // ---------- 便 14b：結ぶ・送る ----------
  const origin = (env) => String(env.PUBLIC_ORIGIN || "https://lab.shia2n.jp").replace(/\/+$/, "");
  async function api(env, account, method, path, body) {
    const token = env[tokenName(account)];
    if (!token) return { ok: false, status: 0, error: "no_token", need: tokenName(account) };
    const r = await (h.fetch || fetch)(LINE_API + path, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 200) }; }
    return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, error: (data && data.message) || `line_${r.status}` };
  }

  // 結ばれている人：LINE の番号 → 台帳の人（最後に結んだもの）
  async function links(env, account) {
    const rows = await db(env, "GET", `events?select=customer_id,payload,occurred_at&type=eq.line_linked&payload->>account=eq.${account}&order=id.asc&limit=20000`);
    const byUser = new Map(), byPerson = new Map();
    for (const r of rows) { const u = r.payload && r.payload.user; if (!u) continue; byUser.set(u, r.customer_id); byPerson.set(r.customer_id, u); }
    return { byUser, byPerson };
  }
  // 友だちの状態（受け口の記録から）：最後が unfollow ならブロック
  async function friendState(env, account) {
    const rows = await db(env, "GET", `inbound_log?select=request,at&channel=in.(line,line_forward_failed)&request->>account=eq.${account}&order=id.asc&limit=20000`);
    const st = new Map();
    for (const r of rows) for (const e of (r.request && r.request.events) || []) {
      const u = e.source && e.source.user; if (!u) continue;
      const o = st.get(u) || { user: u, first_at: e.at || r.at, last_at: null, blocked: false, messages: 0 };
      if (e.type === "follow") o.blocked = false;
      if (e.type === "unfollow") o.blocked = true;
      if (e.type === "message") o.messages++;
      o.last_at = e.at || r.at;
      st.set(u, o);
    }
    return st;
  }

  async function sendLinkInvite(env, account, user, secret) {
    if (!env[tokenName(account)]) return { ok: false, skipped: "no_token" };
    const { byUser } = await links(env, account);
    if (byUser.has(user)) return { ok: true, skipped: "linked" };
    const url = `${origin(env)}/line-link?t=${await linkToken(secret, account, user)}`;
    const text = `友だち追加ありがとうございます。\nお知らせをメールでも受け取れるよう、こちらからメールアドレスを登録してください。\n${url}`;
    const r = await api(env, account, "POST", "/message/push", { to: user, messages: [{ type: "text", text }] });
    await logInbound(env, "line_link_invite", { account, user }, { ok: r.ok, status: r.status, error: r.error || null }, r.ok ? 200 : (r.status || 500));
    return r;
  }

  // リンクの頁から：印を確かめ、台帳に入れて（いなければ）LINE の番号を結ぶ
  async function link(env, { t, email, name, consent }) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const p = parseLinkToken(t);
    if (!p) return { ok: false, error: "bad_link" };
    const secret = env[secretName(p.account)];
    if (!secret || (await linkToken(secret, p.account, p.user)) !== `${p.body}.${p.sig}`) return { ok: false, error: "bad_link" };
    const reg = await h.registerPerson(env, { email, name, consent: consent === true, source: "other", via: "line" });
    if (!reg.ok) return reg;
    const { byUser } = await links(env, p.account);
    const already = byUser.get(p.user) === reg.id;
    if (!already) await h.addEvent(env, reg.id, "line_linked", { account: p.account, user: p.user }, "site");
    return { ok: true, linked: true, already };
  }

  // AI：友だちの一覧（結ばれた人の名前とメール・ブロック）
  async function friends(env, { account }) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!ACCOUNT_RE.test(String(account || ""))) return { ok: false, error: "bad_account" };
    const [st, { byUser }] = await Promise.all([friendState(env, account), links(env, account)]);
    const ids = [...new Set(byUser.values())];
    const people = ids.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
    const pm = new Map(people.map((x) => [x.id, x]));
    for (const u of byUser.keys()) if (!st.has(u)) st.set(u, { user: u, first_at: null, last_at: null, blocked: false, messages: 0 });
    const list = [...st.values()].map((o) => { const pid = byUser.get(o.user); const pr = pid ? pm.get(pid) : null;
      return { user: o.user.slice(0, 6) + "…", linked: !!pid, person_id: pid || null, name: pr ? pr.name || "" : null, email: pr ? pr.email : null, blocked: o.blocked, messages: o.messages, first_at: o.first_at, last_at: o.last_at }; });
    return { ok: true, account, token_set: !!env[tokenName(account)], count: list.length, linked: list.filter((x) => x.linked).length, blocked: list.filter((x) => x.blocked).length, friends: list };
  }

  // AI：送る（承認の道具）。person_id で 1 人、filter（一斉配信の宛先と同じ形）で絞った人たち。結ばれていない・ブロックの人は数えるだけ
  async function send(env, { account, person_id, filter, text }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!ACCOUNT_RE.test(String(account || ""))) return { ok: false, error: "bad_account" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "need_text" };
    if (body.length > TEXT_MAX) return { ok: false, error: "too_long", max: TEXT_MAX };
    if (!env[tokenName(account)]) return { ok: false, error: "no_token", need: tokenName(account) };
    let targets;
    let excluded = 0;
    if (person_id) {
      // 便 17：1 人を名指ししても「除外」の人には送らない（一斉の絞り込みは h.audience の中で外れる）
      const ex = h.excluded ? await h.excluded(env) : new Set();
      if (ex.has(String(person_id))) { targets = []; excluded = 1; } else targets = [String(person_id)];
    } else if (filter && typeof filter === "object") { const a = await h.audience(env, filter); targets = a.people.map((x) => x.id); excluded = a.excluded || 0; }
    else return { ok: false, error: "need_person_or_filter" };
    const [{ byPerson }, st] = await Promise.all([links(env, account), friendState(env, account)]);
    const to = [], notLinked = [], blocked = [];
    for (const id of targets) { const u = byPerson.get(id); if (!u) notLinked.push(id); else if (st.get(u) && st.get(u).blocked) blocked.push(id); else to.push({ id, u }); }
    let sent = 0, failed = 0, error = null;
    for (let i = 0; i < to.length; i += 500) {
      const part = to.slice(i, i + 500);
      const r = part.length === 1
        ? await api(env, account, "POST", "/message/push", { to: part[0].u, messages: [{ type: "text", text: body }] })
        : await api(env, account, "POST", "/message/multicast", { to: part.map((x) => x.u), messages: [{ type: "text", text: body }] });
      if (r.ok) sent += part.length; else { failed += part.length; error = r.error; }
      const rows = part.map((x) => ({ customer_id: x.id, type: "line_sent", payload: { account, text: body.slice(0, 200), ok: r.ok, ...(r.ok ? {} : { error: String(r.error).slice(0, 120) }) }, actor: actor === "mcp" ? "mcp" : "admin" }));
      await db(env, "POST", "events", rows, "return=minimal");
    }
    await logInbound(env, "line_send", { account, targets: targets.length, actor }, { sent, failed, not_linked: notLinked.length, blocked: blocked.length, error }, failed ? 502 : 200);
    return { ok: failed === 0, account, targets: targets.length, sent, failed, not_linked: notLinked.length, blocked: blocked.length, excluded, ...(error ? { error } : {}) };
  }

  // AI：今月の送れる数と使った数（LINE の公式の数）
  async function quota(env, { account }) {
    if (!ACCOUNT_RE.test(String(account || ""))) return { ok: false, error: "bad_account" };
    const [q, c] = await Promise.all([api(env, account, "GET", "/message/quota"), api(env, account, "GET", "/message/quota/consumption")]);
    if (!q.ok) return { ok: false, error: q.error, ...(q.need ? { need: q.need } : {}) };
    return { ok: true, account, type: q.data.type, limit: q.data.type === "limited" ? q.data.value : null, used: c.ok ? c.data.totalUsage : null };
  }

  return { handleWebhook, settings, setForward, inbound, forwardUrl, link, friends, send, quota, sendLinkInvite };
}

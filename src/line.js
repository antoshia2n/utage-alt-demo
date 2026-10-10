// B の便 14a：LINE の受け口。LINE の公式アカウントの知らせ（Webhook）を B が受け、同じ中身と同じ署名のまま UTAGE へ転送する。
//   住所：POST /api/line/webhook/<account>（account は英小文字と下線。例 college_ops）
//   署名の鍵：Cloudflare の秘密の値 LINE_SECRET_<ACCOUNT を大文字>（LINE Developers の「チャネルシークレット」）
//   転送先：表 b_settings の 1 行（key=line_forward_<account>・UTAGE の Webhook の住所）。画面か承認つきの AI の道具で変える
// 記録：知らせ 1 回につき b_inbound_log に 1 行。転送できたら channel=line、できなかったら channel=line_forward_failed（統括の条件 1）。
//   中身は知らせの要点（種類・LINE の番号・メッセージの種類と文）と、転送の結果（状態の番号・かかった時間）。
// LINE には署名を確かめた時点ですぐ 200 を返し、転送はそのあと（ctx.waitUntil）で行う。転送は 10 秒で打ち切る。
// 戻し方（統括の条件 2）：LINE Developers の Webhook URL を、控えた UTAGE の住所に戻せば元どおり（B を通らなくなる）。
// 表は増やさない。友だちと台帳の人を結ぶのと LINE で送るのは便 14b。

export const ACCOUNT_RE = /^[a-z][a-z_]{1,19}$/;
export const FORWARD_PREFIX = "line_forward_";
const URL_RE = /^https:[/][/][^\s<>"']{4,490}$/;
const FORWARD_TIMEOUT_MS = 10000;
const TEXT_KEEP = 1000;

export const secretName = (account) => "LINE_SECRET_" + String(account).toUpperCase();

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
      return { account: a, webhook_url: `${origin}/api/line/webhook/${a}`, secret_name: secretName(a), secret_set: !!env[secretName(a)],
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

  return { handleWebhook, settings, setForward, inbound, forwardUrl };
}

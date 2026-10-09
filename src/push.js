// B の便 8f-3：Naoki のスマホへの通知（Web Push）。表は増やさない・Cloudflare の値も使わない。
//   鍵（VAPID）… 最初に使うとき Worker が作り、表 b_settings の 1 行（key=push_vapid）に置く。ブラウザからは読めない表（RLS・service_role だけ）
//                 公開の半分だけを画面に渡す。秘密の半分は返事にも記録にも出さない
//   宛先      … 端末ごとの購読。シアニン用の画面に入った人の台帳の行に、出来事 push_subscribed／push_unsubscribed として積む
//   中身      … RFC 8291（aes128gcm）で暗号にして送る。送り主の印は RFC 8292（VAPID・ES256 の JWT）
//   届かなくなった購読（404・410）は push_unsubscribed（reason gone）を積んで、次から送らない
// 送った結果は b_inbound_log の channel=push に件数だけ残す（宛先の住所は残さない）。

const KEY = "push_vapid";
const enc = new TextEncoder();

// 送ってよい宛先（ブラウザの通知の仕組みの住所）。これ以外の住所は購読として受け付けない
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export function endpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (_) { return false; }
}

// RFC 8291：中身を端末の鍵（p256dh）と合言葉（auth）で暗号にする。返すのは送る本体（ヘッダ 86 バイト＋暗号）
export async function encryptPayload(plain, p256dh, auth) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("bad_subscription_keys");
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = concat(typeof plain === "string" ? enc.encode(plain) : plain, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([65]), asPublic, cipher);
}

// RFC 8292：送り先の住所ごとの印（12 時間で切れる）
export async function vapidHeader(vapid, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.privateKey, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export function makePush(h) {
  const { db, addEvent, logInbound } = h;
  let cached = null;

  // 鍵を読む。作るのは「読み取りが成功し、行が 0」のときだけ（2 つ同時に作られても、先に入ったほうを使う）。
  // 読み取りが失敗したとき・行はあるのに中身が空のときは、作らずに止めて記録に残す。
  // 作り直すと、登録済みの端末への通知が黙って止まるため（統括 2026-10-09 15:11 の条件）
  async function vapid(env) {
    if (cached && cached.url === env.SUPABASE_URL) return cached.v;
    let rows;
    try { rows = await db(env, "GET", `settings?select=value&key=eq.${KEY}`); }
    catch (e) {
      await logInbound(env, "push_key", { created: false }, { ok: false, error: "key_read_failed", detail: String(e && e.message || e).slice(0, 160) }, 500);
      throw new Error("push_key_unreadable：通知の鍵を読めなかったので、作らずに止めた");
    }
    if (rows.length && !rows[0].value) {
      await logInbound(env, "push_key", { created: false }, { ok: false, error: "key_row_empty" }, 500);
      throw new Error("push_key_empty：通知の鍵の行が空だったので、作らずに止めた");
    }
    if (rows.length === 0) {
      const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
      await db(env, "POST", "settings?on_conflict=key",
        [{ key: KEY, value: JSON.stringify({ d: jwk.d, x: jwk.x, y: jwk.y }), updated_at: new Date().toISOString(), updated_by: "push" }],
        "resolution=ignore-duplicates,return=minimal");
      await logInbound(env, "push_key", { created: true }, { ok: true }, 200);
      rows = await db(env, "GET", `settings?select=value&key=eq.${KEY}`);
      if (!rows.length || !rows[0].value) throw new Error("push_key_unreadable：作った鍵を読み直せなかった");
    }
    const k = JSON.parse(rows[0].value);
    const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: k.d, x: k.x, y: k.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const v = { privateKey, publicKey: b64u(concat(new Uint8Array([4]), fromB64u(k.x), fromB64u(k.y))) };
    cached = { url: env.SUPABASE_URL, v };
    return v;
  }

  // 購読の一覧（端末ごとに最後の出来事で決める）。adminsOnly なら、いま b_admins にいる人の分だけ
  async function subscriptions(env) {
    const evs = await db(env, "GET", "events?select=id,customer_id,type,payload,occurred_at&type=in.(push_subscribed,push_unsubscribed)&order=id.asc&limit=2000");
    const last = new Map();
    for (const e of evs) if (e.payload && e.payload.endpoint) last.set(e.payload.endpoint, e);
    const subs = [...last.values()].filter((e) => e.type === "push_subscribed");
    if (!subs.length) return [];
    const ids = [...new Set(subs.map((e) => e.customer_id))];
    const people = await db(env, "GET", `customers?select=id,email&id=in.(${ids.join(",")})`);
    const admins = new Set((await db(env, "GET", "admins?select=email")).map((a) => a.email));
    const emailOf = Object.fromEntries(people.map((p) => [p.id, String(p.email || "").toLowerCase()]));
    return subs.filter((e) => admins.has(emailOf[e.customer_id])).map((e) => ({
      customer_id: e.customer_id, email: emailOf[e.customer_id], endpoint: e.payload.endpoint, p256dh: e.payload.p256dh, auth: e.payload.auth,
      device: e.payload.device || "", at: e.occurred_at,
    }));
  }

  const hostOf = (endpoint) => { try { return new URL(endpoint).hostname; } catch (_) { return ""; } };

  async function status(env) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    let v;
    try { v = await vapid(env); }
    catch (e) { return { ok: false, error: String(e && e.message || e).split("：")[0], note: "通知の鍵を読めないので止めている。作り直しはしない（登録済みの端末に届かなくなるため）" }; }
    const subs = await subscriptions(env);
    return { ok: true, public_key: v.publicKey, count: subs.length, devices: subs.map((s) => ({ email: s.email, device: s.device, service: hostOf(s.endpoint), since: s.at, endpoint_tail: s.endpoint.slice(-12) })) };
  }

  async function personByEmail(env, email) {
    const [c] = await db(env, "GET", `customers?select=id&email=eq.${encodeURIComponent(email)}`);
    return c || null;
  }

  async function subscribe(env, email, { endpoint, keys, device } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!endpointAllowed(endpoint)) return { ok: false, error: "bad_endpoint" };
    const p256dh = keys && keys.p256dh, auth = keys && keys.auth;
    try { if (fromB64u(p256dh).length !== 65 || fromB64u(auth).length !== 16) throw 0; } catch (_) { return { ok: false, error: "bad_keys" }; }
    const me = await personByEmail(env, email);
    if (!me) return { ok: false, error: "no_person_row", note: "このメールの人が台帳にいないので、購読を置けません" };
    const now = (await subscriptions(env)).find((s) => s.endpoint === endpoint);
    if (now && now.p256dh === p256dh && now.auth === auth && now.customer_id === me.id) return { ok: true, already: true };
    await addEvent(env, me.id, "push_subscribed", { endpoint, p256dh, auth, device: String(device || "").slice(0, 80) }, "admin");
    return { ok: true, already: false };
  }

  async function unsubscribe(env, email, { endpoint } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const s = (await subscriptions(env)).find((x) => x.endpoint === endpoint);
    if (!s) return { ok: true, found: false };
    await addEvent(env, s.customer_id, "push_unsubscribed", { endpoint, reason: "by_admin", by: email }, "admin");
    return { ok: true, found: true };
  }

  // 全部の端末へ 1 通。失敗しても投げない（知らせで本体を止めない）
  async function send(env, { title, body = "", url = "/admin", tag = "" } = {}) {
    if (!env.B_STORE) return { ok: true, sent: 0, skipped: "demo_store" };
    const out = { ok: true, devices: 0, sent: 0, failed: 0, gone: 0 };
    try {
      const subs = await subscriptions(env);
      out.devices = subs.length;
      if (!subs.length) return out;
      const v = await vapid(env);
      const subject = env.PUBLIC_ORIGIN || "https://lab.shia2n.jp";
      const payload = JSON.stringify({ title: String(title || "Lab OS").slice(0, 120), body: String(body).slice(0, 300), url: String(url).startsWith("/") ? String(url) : "/admin", tag: String(tag).slice(0, 60) });
      for (const s of subs) {
        try {
          const res = await fetch(s.endpoint, {
            method: "POST",
            headers: {
              authorization: await vapidHeader(v, s.endpoint, subject),
              "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
              ttl: "86400", urgency: "high",
            },
            body: await encryptPayload(payload, s.p256dh, s.auth),
          });
          if (res.ok) out.sent++;
          else if (res.status === 404 || res.status === 410) {
            out.gone++;
            await addEvent(env, s.customer_id, "push_unsubscribed", { endpoint: s.endpoint, reason: "gone", status: res.status }, "site");
          } else { out.failed++; out.last_error = `status_${res.status}`; }
        } catch (e) { out.failed++; out.last_error = String(e && e.message || e).slice(0, 120); }
      }
    } catch (e) {
      out.ok = false; out.error = String(e && e.message || e).slice(0, 160);
    }
    await logInbound(env, "push", { title: String(title || "").slice(0, 80), tag }, out, out.ok && !out.failed ? 200 : 500);
    return out;
  }

  return { vapid, status, subscribe, unsubscribe, send, subscriptions };
}

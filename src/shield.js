// 便 R1：公開の入口の守り（ロボット判定・回数の上限）。
// 公開の口（ログイン不要で誰でも送れる口）に、次の 2 つを掛ける。
// 1 ロボット判定（Cloudflare Turnstile）：判定はこの Worker の側で Cloudflare に聞き直して確かめる。
//   表示用の鍵（TURNSTILE_SITE_KEY・wrangler.jsonc）と秘密の鍵（TURNSTILE_SECRET_KEY・Cloudflare の秘密の値）が
//   両方そろったときだけ判定する。片方だけのときは飛ばす（入れる順番で全部の申込が止まらないため）。/api/health の shield に出る
// 2 回数の上限：同じ接続元は Cloudflare の回数制限（wrangler.jsonc の ratelimits・60 秒あたり）、
//   同じ住所は台帳の出来事（registered・register_again）を数える（10 分に 3 回・1 日に 10 回）。
// 止めたときは受け付けず、メールも送らない。止めた理由は受け口の記録（channel=shield）に残す（接続元の番号は残さない）

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const EMAIL_LIMITS = [{ minutes: 10, max: 3 }, { minutes: 24 * 60, max: 10 }];
// 1 回の受付で必ず 1 つ積まれる出来事（フォーム・予約・登録・LINE を結ぶは、どれも registerPerson を通る）
export const ENTRY_EVENTS = ["registered", "register_again"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 判定を掛けるか（両方の鍵がそろったときだけ）
export function botCheckOn(env) {
  return !!(env && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}
// 画面に渡す表示用の鍵（判定を掛けるときだけ。掛けないときは画面に判定の欄を出さない）
export function botSiteKey(env) {
  return botCheckOn(env) ? String(env.TURNSTILE_SITE_KEY) : null;
}
export function clientIp(request) {
  return String(request.headers.get("cf-connecting-ip") || "").slice(0, 64);
}

export function makeShield({ db, logInbound, fetch: fetchFn = (...a) => fetch(...a) }) {
  // ロボット判定。戻り値 { ok, skipped?, reason? }。判定の口に届かないときも通さない（申込の受付より守りを先にする）
  async function verifyBot(env, token, ip) {
    if (!botCheckOn(env)) return { ok: true, skipped: true };
    const t = typeof token === "string" ? token : "";
    if (!t || t.length > 2048) return { ok: false, reason: "missing" };
    const form = new FormData();
    form.append("secret", String(env.TURNSTILE_SECRET_KEY));
    form.append("response", t);
    if (ip) form.append("remoteip", ip);
    try {
      const res = await fetchFn(SITEVERIFY_URL, { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (j && j.success === true) return { ok: true };
      return { ok: false, reason: "rejected", codes: Array.isArray(j && j["error-codes"]) ? j["error-codes"].slice(0, 3) : [] };
    } catch (_) {
      return { ok: false, reason: "unreachable" };
    }
  }

  // 同じ接続元の回数（Cloudflare の回数制限）。結びが無い（手元の試験など）・接続元が分からないときは通す
  async function ipAllowed(env, kind, ip) {
    const b = kind === "hit" ? env.HIT_LIMIT : env.PUBLIC_LIMIT;
    if (!b || typeof b.limit !== "function" || !ip) return true;
    try { const r = await b.limit({ key: `${kind}:${ip}` }); return !!(r && r.success); } catch (_) { return true; }
  }

  // 同じ住所の回数（台帳の出来事を数える）。まだ台帳にいない住所は 0 回
  async function emailAllowed(env, email) {
    const e = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return { ok: true }; // 形の確かめは受付の側で行う
    const [c] = await db(env, "GET", `customers?select=id&email=eq.${encodeURIComponent(e)}`);
    if (!c) return { ok: true };
    const longest = Math.max(...EMAIL_LIMITS.map((l) => l.minutes));
    const since = new Date(Date.now() - longest * 60e3).toISOString();
    const rows = await db(env, "GET", `events?select=occurred_at&customer_id=eq.${c.id}&type=in.(${ENTRY_EVENTS.join(",")})&occurred_at=gte.${encodeURIComponent(since)}`);
    for (const l of EMAIL_LIMITS) {
      const from = Date.now() - l.minutes * 60e3;
      const n = rows.filter((r) => Date.parse(r.occurred_at) >= from).length;
      if (n >= l.max) return { ok: false, minutes: l.minutes, max: l.max };
    }
    return { ok: true };
  }

  // 公開の口の前で 1 回呼ぶ。止めるときは返事（Response を作るための中身）を返し、通すときは null
  // opts：{ ip: 回数を数える種類（"public"／"hit"）, bot: 判定を掛けるか, email: 回数を数える住所, token: 判定の印 }
  async function check(env, request, mouth, opts = {}) {
    const ip = clientIp(request);
    if (opts.ip && !(await ipAllowed(env, opts.ip, ip))) {
      return { status: 429, body: { ok: false, error: "too_many" } }; // 接続元で止めたものは記録しない（大量に来たときに記録で表を埋めないため）
    }
    if (opts.bot) {
      const v = await verifyBot(env, opts.token, ip);
      if (!v.ok) {
        await logInbound(env, "shield", { mouth, reason: `bot_${v.reason}` }, { ok: false, codes: v.codes || [] }, 403);
        return { status: 403, body: { ok: false, error: "bot_check_failed" } };
      }
    }
    if (opts.email !== undefined) {
      const m = await emailAllowed(env, opts.email);
      if (!m.ok) {
        await logInbound(env, "shield", { mouth, reason: "email_limit", minutes: m.minutes, max: m.max, to_domain: String(opts.email).split("@")[1] || null }, { ok: false }, 429);
        return { status: 429, body: { ok: false, error: "too_many" } };
      }
    }
    return null;
  }

  return { check, verifyBot, ipAllowed, emailAllowed };
}

// 外に返すエラーから中身（detail）を外す。Naoki の画面（/api/admin/）と AI の窓口（/mcp）はログインか合言葉が要るので残す
export function isPrivatePath(path) {
  return path.startsWith("/api/admin/") || path === "/mcp" || path.startsWith("/mcp/");
}
export async function stripDetail(res, onStripped) {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) return res;
  let body;
  try { body = await res.clone().json(); } catch (_) { return res; }
  const strip = (o) => { if (o && typeof o === "object" && !Array.isArray(o) && "detail" in o) { const d = o.detail; delete o.detail; return d; } return undefined; };
  const detail = strip(body);
  if (detail === undefined) return res;
  if (onStripped) await onStripped(detail, body);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: res.status, headers });
}

// utage-alt-demo — UTAGE の代わりのサイト兼アプリのデモ（架空のデータだけ）
// 入口は 1 つ：シアニン用の画面（/api/admin/*）と AI（/mcp）が同じ処理（core）を呼ぶ。
// 表の読み書きはこの Worker だけが秘密の鍵で行う。ブラウザからは表に触れない。

const VERSION = "0.1.1-bin1";
const SOURCES = ["x", "note", "youtube", "direct", "other"];
const MEMBER_EVENT_TYPES = ["lesson_viewed", "announcement_opened"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/mcp" || path.startsWith("/mcp/")) return await handleMcp(request, env, url);
      if (path.startsWith("/api/")) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: "internal_error", detail: String(err && err.message || err) }, 500);
    }
  },
};

// ---------- 共通 ----------

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function missingConfig(env) {
  const need = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "MCP_SECRET"];
  return need.filter((k) => !env[k] || String(env[k]).startsWith("SET_"));
}

function secretHeaders(env) {
  const key = env.SUPABASE_SECRET_KEY;
  const h = { apikey: key, "content-type": "application/json" };
  // 旧形式の鍵（JWT）のときだけ Authorization にも入れる。新形式（sb_secret_）は apikey だけで通る。
  if (key && key.startsWith("eyJ")) h.authorization = `Bearer ${key}`;
  return h;
}

// PostgREST を秘密の鍵で呼ぶ。失敗は投げる（0 件と失敗を混ぜない）
async function db(env, method, pathAndQuery, body, prefer) {
  const headers = secretHeaders(env);
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${method} ${pathAndQuery.split("?")[0]} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function addEvent(env, customerId, type, payload = {}, actor = "site") {
  const rows = await db(env, "POST", "events", [{ customer_id: customerId, type, payload, actor }], "return=representation");
  return rows[0];
}

async function logInbound(env, channel, request, response, status) {
  try {
    await db(env, "POST", "inbound_log", [{ channel, request, response, status }], "return=minimal");
  } catch (_) { /* 控えの失敗で本体を止めない */ }
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    return JSON.parse(atob(b64));
  } catch (_) { return null; }
}

// ブラウザから来たログインの印を Supabase に確かめてもらう
async function verifyUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "no_token" };
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: "invalid_token" };
  const user = await res.json();
  const claims = decodeJwtPayload(token) || {};
  return { user, claims, email: String(user.email || "").toLowerCase() };
}

async function requireAdmin(request, env) {
  const v = await verifyUser(request, env);
  if (v.error) return { error: v.error, status: 401 };
  const rows = await db(env, "GET", `admins?select=email&email=eq.${encodeURIComponent(v.email)}`);
  if (rows.length === 0) return { error: "not_admin", status: 403 };
  if (v.claims.aal !== "aal2") return { error: "need_second_factor", status: 403 };
  return { ok: true, email: v.email };
}

// ---------- 芯（シアニン用の画面と MCP が同じものを呼ぶ） ----------

const core = {
  async findPeople(env, { query = "", source = "", limit = 50 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    let q = `customer_summary?select=*&order=last_event_at.desc.nullslast&limit=${lim}`;
    const s = String(query).trim().replace(/[(),*]/g, " ").trim();
    if (s) q += `&or=(name.ilike.*${encodeURIComponent(s)}*,email.ilike.*${encodeURIComponent(s)}*)`;
    if (source && SOURCES.includes(source)) q += `&source=eq.${source}`;
    const people = await db(env, "GET", q);
    return { ok: true, count: people.length, people };
  },

  async getTimeline(env, { person_id }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const [person] = await db(env, "GET", `customer_summary?select=*&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const events = await db(env, "GET", `events?select=id,type,payload,actor,occurred_at&customer_id=eq.${person_id}&order=occurred_at.desc&limit=200`);
    return { ok: true, found: true, person, events };
  },

  async setNoteMember(env, { person_id, value }, actor) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const rows = await db(env, "PATCH", `customers?id=eq.${person_id}`, { note_member: !!value }, "return=representation");
    if (rows.length === 0) return { ok: true, found: false };
    await addEvent(env, person_id, "note_member_set", { value: !!value }, actor);
    return { ok: true, found: true, note_member: rows[0].note_member };
  },

  async stats(env) {
    const people = await db(env, "GET", "customer_summary?select=stage,source");
    const by = (k) => people.reduce((m, p) => ((m[p[k]] = (m[p[k]] || 0) + 1), m), {});
    const recent = await db(env, "GET", "events?select=type&occurred_at=gte." + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()));
    return {
      ok: true,
      customers: people.length,
      by_stage: by("stage"),
      by_source: by("source"),
      events_last_7_days: recent.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {}),
    };
  },
};

// ---------- /api ----------

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health") {
    const missing = missingConfig(env);
    let dbOk = null;
    if (!missing.includes("SUPABASE_URL") && !missing.includes("SUPABASE_SECRET_KEY")) {
      try { await db(env, "GET", "lessons?select=id&limit=1"); dbOk = true; } catch (e) { dbOk = String(e.message).slice(0, 200); }
    }
    return json({ ok: missing.length === 0 && dbOk === true, version: VERSION, missing_settings: missing, db: dbOk });
  }

  if (path === "/api/config") {
    return json({ supabaseUrl: env.SUPABASE_URL || null, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || null, version: VERSION });
  }

  const missing = missingConfig(env);
  if (missing.length) return json({ ok: false, error: "not_configured", missing_settings: missing }, 503);

  // 登録（公開の面）
  if (path === "/api/register" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 60);
    const source = SOURCES.includes(body.source) ? body.source : "direct";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "bad_email" }, 400);
    if (body.consent !== true) return json({ ok: false, error: "need_consent" }, 400);
    const existing = await db(env, "GET", `customers?select=id&email=eq.${encodeURIComponent(email)}`);
    let id, isNew = false;
    if (existing.length) {
      id = existing[0].id;
      await addEvent(env, id, "register_again", { source }, "site");
    } else {
      const rows = await db(env, "POST", "customers", [{ email, name, source, consent_at: new Date().toISOString() }], "return=representation");
      id = rows[0].id; isNew = true;
      await addEvent(env, id, "registered", { source }, "site");
    }
    await logInbound(env, "register", { email, source }, { ok: true, isNew }, 200);
    return json({ ok: true, is_new: isNew });
  }

  // 生徒：自分の情報・教材・お知らせ
  if (path === "/api/me" && method === "GET") {
    const v = await verifyUser(request, env);
    if (v.error) return json({ ok: false, error: v.error }, 401);
    let [customer] = await db(env, "GET", `customers?select=*&email=eq.${encodeURIComponent(v.email)}`);
    if (!customer) return json({ ok: false, error: "not_registered" }, 404);
    if (!customer.auth_user_id) {
      [customer] = await db(env, "PATCH", `customers?id=eq.${customer.id}`, { auth_user_id: v.user.id }, "return=representation");
    }
    if (url.searchParams.get("fresh") === "1") await addEvent(env, customer.id, "login", {}, "site");
    const lessons = await db(env, "GET", "lessons?select=id,sort,title,summary,minutes,youtube_id&published=eq.true&order=sort.asc");
    const announcements = await db(env, "GET", "announcements?select=id,title,body,published_at&order=published_at.desc&limit=20");
    const viewed = await db(env, "GET", `events?select=payload&customer_id=eq.${customer.id}&type=eq.lesson_viewed`);
    const viewedIds = [...new Set(viewed.map((e) => e.payload && e.payload.lesson_id).filter(Boolean))];
    return json({ ok: true, me: { name: customer.name, email: customer.email, source: customer.source }, lessons, announcements, viewed: viewedIds });
  }

  if (path === "/api/events" && method === "POST") {
    const v = await verifyUser(request, env);
    if (v.error) return json({ ok: false, error: v.error }, 401);
    const body = await request.json().catch(() => ({}));
    if (!MEMBER_EVENT_TYPES.includes(body.type)) return json({ ok: false, error: "bad_type" }, 400);
    const [customer] = await db(env, "GET", `customers?select=id&email=eq.${encodeURIComponent(v.email)}`);
    if (!customer) return json({ ok: false, error: "not_registered" }, 404);
    const payload = {};
    if (body.lesson_id) payload.lesson_id = String(body.lesson_id).slice(0, 20);
    if (body.announcement_id) payload.announcement_id = Number(body.announcement_id) || null;
    const ev = await addEvent(env, customer.id, body.type, payload, "site");
    return json({ ok: true, id: ev.id });
  }

  // シアニン用（2 段階の確認を通ったときだけ）
  if (path.startsWith("/api/admin/")) {
    const a = await requireAdmin(request, env);
    if (a.error) return json({ ok: false, error: a.error }, a.status);
    if (path === "/api/admin/whoami") return json({ ok: true, email: a.email });
    if (path === "/api/admin/people" && method === "GET") {
      return json(await core.findPeople(env, { query: url.searchParams.get("q") || "", source: url.searchParams.get("source") || "" }));
    }
    const m = path.match(/^\/api\/admin\/people\/([0-9a-f-]{36})$/i);
    if (m && method === "GET") return json(await core.getTimeline(env, { person_id: m[1] }));
    if (m && method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      return json(await core.setNoteMember(env, { person_id: m[1], value: body.note_member }, "admin"));
    }
    if (path === "/api/admin/stats") return json(await core.stats(env));
  }

  return json({ ok: false, error: "not_found" }, 404);
}

// ---------- /mcp（AI の入口・JSON-RPC） ----------

const TOOLS = [
  {
    name: "find_person",
    description: "デモの顧客の台帳から人を探す。名前かメールの一部で探し、段階・流入元・最後の出来事の時刻を返す。query を空にすると最近動いた順に返す。0 件は count: 0 で返す（失敗とは別）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "名前かメールの一部" },
        source: { type: "string", enum: SOURCES, description: "流入元で絞る" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "get_timeline",
    description: "1 人の出来事を新しい順に返す（登録・ログイン・視聴など）。person_id は find_person の id。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } }, required: ["person_id"] },
  },
  {
    name: "stats",
    description: "台帳の件数を 1 回で数える（段階別・流入元別・直近 7 日の出来事の種類別）。",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleMcp(request, env, url) {
  const missing = missingConfig(env);
  if (missing.length) return json({ ok: false, error: "not_configured", missing_settings: missing }, 503);

  const pathToken = url.pathname.startsWith("/mcp/") ? url.pathname.slice(5) : "";
  const auth = request.headers.get("authorization") || "";
  const headerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(pathToken || headerToken, env.MCP_SECRET)) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET") {
    // 確かめ用：?tool=find_person&query=... で道具を 1 回呼べる（合言葉は同じ。POST と同じ処理を通す）
    const tool = url.searchParams.get("tool");
    if (tool) {
      const args = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "tool"));
      const r = await rpc({ jsonrpc: "2.0", id: "get", method: "tools/call", params: { name: tool, arguments: args } }, env);
      return json(r.result || r);
    }
    return json({ ok: true, name: "utage-alt-demo", version: VERSION, tools: TOOLS.map((t) => t.name) });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const msg = await request.json().catch(() => null);
  if (!msg) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  if (Array.isArray(msg)) {
    const out = [];
    for (const m of msg) { const r = await rpc(m, env); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await rpc(msg, env);
  return r ? json(r) : new Response(null, { status: 202 });
}

async function rpc(msg, env) {
  const { id, method, params = {} } = msg || {};
  if (id === undefined || id === null) return null; // 知らせ（notifications/*）には返事をしない
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return ok({
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "utage-alt-demo", version: VERSION },
    });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments || {};
    let result, isError = false;
    try {
      if (name === "find_person") result = await core.findPeople(env, args);
      else if (name === "get_timeline") result = await core.getTimeline(env, args);
      else if (name === "stats") result = await core.stats(env);
      else { result = { ok: false, error: "unknown_tool" }; }
      isError = result.ok === false;
    } catch (e) {
      result = { ok: false, error: "failed", detail: String(e.message).slice(0, 300) };
      isError = true;
    }
    await logInbound(env, "mcp", { tool: name, arguments: args }, summarize(result), isError ? 500 : 200);
    return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError });
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } };
}

function summarize(result) {
  if (!result || typeof result !== "object") return {};
  const s = { ok: result.ok };
  if ("count" in result) s.count = result.count;
  if ("found" in result) s.found = result.found;
  if (result.error) s.error = result.error;
  return s;
}

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

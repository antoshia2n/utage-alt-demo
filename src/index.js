// utage-alt-demo — UTAGE の代わりのサイト兼アプリのデモ（架空のデータだけ）
// 入口は 1 つ：シアニン用の画面（/api/admin/*）と AI（/mcp）が同じ処理（core）を呼ぶ。
// 表の読み書きはこの Worker だけが秘密の鍵で行う。ブラウザからは表に触れない。
// 便 2：添削ルーム（1 対 1）。やりとりは新しい表を作らず、出来事の記録（events）に積む。
//   correction_submitted … 生徒が出した文章と画像
//   correction_returned  … 原文・添削後・コメントの 3 欄で返したもの（reply_to で出した側を指す）
//   room_read            … どこまで読んだか（by：student / admin、upto：最後に読んだ出来事の番号）
// 画像は R2（IMAGES）に置き、ログインした本人とシアニンだけが読める。

const VERSION = "0.2.0-bin2";
const SOURCES = ["x", "note", "youtube", "direct", "other"];
const MEMBER_EVENT_TYPES = ["lesson_viewed", "announcement_opened"];
const ROOM_TYPES = ["correction_submitted", "correction_returned", "room_read"];
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX = 8000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

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

  // 添削ルームの一覧：未返信のある部屋が上、その中は待たせている時間が長い順
  async listRooms(env, { only_unreplied = false } = {}) {
    const evs = await roomEvents(env);
    const byCustomer = new Map();
    for (const e of evs) {
      if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, []);
      byCustomer.get(e.customer_id).push(e);
    }
    const ids = [...byCustomer.keys()];
    const people = ids.length
      ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`)
      : [];
    const pmap = Object.fromEntries(people.map((p) => [p.id, p]));
    let rooms = ids.map((id) => {
      const s = roomState(byCustomer.get(id));
      const msgs = byCustomer.get(id).filter((e) => e.type !== "room_read");
      const last = msgs[msgs.length - 1];
      return {
        person_id: id,
        name: pmap[id] ? pmap[id].name : "",
        email: pmap[id] ? pmap[id].email : "",
        unreplied: s.unreplied.length,
        oldest_unreplied_at: s.unreplied.length ? s.unreplied[0].occurred_at : null,
        unread_for_admin: s.unreadForAdmin,
        last_at: last ? last.occurred_at : null,
        last_from: last ? (last.type === "correction_submitted" ? "student" : "cyanin") : null,
        last_text: last ? snippet(last) : "",
      };
    }).filter((r) => r.last_at);
    if (only_unreplied === true || only_unreplied === "true") rooms = rooms.filter((r) => r.unreplied > 0);
    rooms.sort((a, b) =>
      (b.unreplied > 0) - (a.unreplied > 0)
      || (a.unreplied > 0 ? String(a.oldest_unreplied_at).localeCompare(String(b.oldest_unreplied_at)) : 0)
      || String(b.last_at).localeCompare(String(a.last_at)));
    return { ok: true, count: rooms.length, unreplied_total: rooms.reduce((n, r) => n + r.unreplied, 0), rooms };
  },

  // 1 部屋のやりとり。mark_read が真なら、シアニンが読んだ印を積む（新しいものがあるときだけ）
  async getRoom(env, { person_id, mark_read = false }, actor = "admin") {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const [person] = await db(env, "GET", `customers?select=id,name,email&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const evs = await roomEvents(env, person_id);
    const s = roomState(evs);
    const messages = evs.filter((e) => e.type !== "room_read").map((e) => toMessage(e, s));
    if ((mark_read === true || mark_read === "true") && messages.length && s.lastMessageId > s.adminReadUpto) {
      await addEvent(env, person_id, "room_read", { by: "admin", upto: s.lastMessageId }, actor);
    }
    return {
      ok: true, found: true, person,
      unreplied: s.unreplied.map((e) => e.id),
      count: messages.length,
      messages,
    };
  },

  // 3 欄で返す。reply_to を省くと、いちばん古い未返信に返す
  async returnCorrection(env, { person_id, reply_to, original, corrected, comment = "" }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const corr = String(corrected ?? "").trim();
    if (!corr) return { ok: false, error: "need_corrected" };
    if (corr.length > TEXT_MAX || String(comment).length > TEXT_MAX || String(original ?? "").length > TEXT_MAX) {
      return { ok: false, error: "too_long", max: TEXT_MAX };
    }
    const [person] = await db(env, "GET", `customers?select=id&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const evs = await roomEvents(env, person_id);
    const s = roomState(evs);
    let target;
    if (reply_to !== undefined && reply_to !== null && reply_to !== "") {
      target = evs.find((e) => e.type === "correction_submitted" && String(e.id) === String(reply_to));
      if (!target) return { ok: false, error: "reply_to_not_found" };
    } else {
      target = s.unreplied[0];
      if (!target) return { ok: false, error: "nothing_to_return" };
    }
    const orig = String(original ?? "").trim() || String((target.payload && target.payload.text) || "");
    const ev = await addEvent(env, person_id, "correction_returned", {
      reply_to: target.id,
      original: orig,
      corrected: corr,
      comment: String(comment || "").trim(),
    }, actor);
    return { ok: true, found: true, id: ev.id, reply_to: target.id, remaining_unreplied: s.unreplied.filter((e) => e.id !== target.id).length };
  },
};

// 添削ルームの出来事を古い順に読む（person_id を省くと全部屋）
async function roomEvents(env, personId) {
  let q = `events?select=id,customer_id,type,payload,actor,occurred_at&type=in.(${ROOM_TYPES.join(",")})&order=id.asc&limit=5000`;
  if (personId) q += `&customer_id=eq.${personId}`;
  return await db(env, "GET", q);
}

// 1 部屋の状態を出来事から計算する（未返信・どこまで読んだか）
function roomState(evs) {
  const replied = new Set(evs.filter((e) => e.type === "correction_returned").map((e) => String(e.payload && e.payload.reply_to)));
  const msgs = evs.filter((e) => e.type !== "room_read");
  const readUpto = (by) => evs.filter((e) => e.type === "room_read" && e.payload && e.payload.by === by)
    .reduce((m, e) => Math.max(m, Number(e.payload.upto) || 0), 0);
  const studentReadUpto = readUpto("student");
  const adminReadUpto = readUpto("admin");
  return {
    unreplied: msgs.filter((e) => e.type === "correction_submitted" && !replied.has(String(e.id))),
    studentReadUpto,
    adminReadUpto,
    lastMessageId: msgs.length ? msgs[msgs.length - 1].id : 0,
    unreadForAdmin: msgs.filter((e) => e.type === "correction_submitted" && e.id > adminReadUpto).length,
    unreadForStudent: msgs.filter((e) => e.type === "correction_returned" && e.id > studentReadUpto).length,
    replied,
  };
}

function toMessage(e, s) {
  const p = e.payload || {};
  if (e.type === "correction_submitted") {
    return {
      id: e.id, from: "student", at: e.occurred_at,
      text: p.text || "", images: Array.isArray(p.images) ? p.images : [],
      replied: s.replied.has(String(e.id)),
      read_by_cyanin: e.id <= s.adminReadUpto,
    };
  }
  return {
    id: e.id, from: "cyanin", at: e.occurred_at, actor: e.actor,
    reply_to: p.reply_to, original: p.original || "", corrected: p.corrected || "", comment: p.comment || "",
    read_by_student: e.id <= s.studentReadUpto,
  };
}

function snippet(e) {
  const p = e.payload || {};
  const t = e.type === "correction_submitted"
    ? (p.text || (p.images && p.images.length ? "（画像）" : ""))
    : (p.comment || p.corrected || "");
  return String(t).replace(/\s+/g, " ").slice(0, 60);
}

async function customerByEmail(env, email) {
  const [c] = await db(env, "GET", `customers?select=id,name,email&email=eq.${encodeURIComponent(email)}`);
  return c || null;
}

// 画像の置き場の名前：room/<顧客の番号>/<ばらばらの番号>.<種類>
function imageOwner(key) {
  const m = String(key || "").match(/^room\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i);
  return m ? m[1] : null;
}

async function serveImage(env, key) {
  if (!env.IMAGES) return json({ ok: false, error: "no_image_store" }, 503);
  const obj = await env.IMAGES.get(key);
  if (!obj) return json({ ok: false, error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

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
    return json({ ok: missing.length === 0 && dbOk === true, version: VERSION, missing_settings: missing, db: dbOk, images: !!env.IMAGES });
  }

  if (path === "/api/config") {
    return json({
      supabaseUrl: env.SUPABASE_URL || null,
      supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || null,
      communityUrl: env.COMMUNITY_URL || null,
      version: VERSION,
    });
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
    const room = roomState(await roomEvents(env, customer.id));
    return json({
      ok: true,
      me: { name: customer.name, email: customer.email, source: customer.source },
      lessons, announcements, viewed: viewedIds,
      room_unread: room.unreadForStudent,
      community_url: env.COMMUNITY_URL || null,
    });
  }

  // 生徒：添削ルーム（自分の部屋だけ）
  if (path.startsWith("/api/room")) {
    const v = await verifyUser(request, env);
    if (v.error) return json({ ok: false, error: v.error }, 401);
    const customer = await customerByEmail(env, v.email);
    if (!customer) return json({ ok: false, error: "not_registered" }, 404);

    if (path === "/api/room" && method === "GET") {
      const evs = await roomEvents(env, customer.id);
      const s = roomState(evs);
      const messages = evs.filter((e) => e.type !== "room_read").map((e) => toMessage(e, s));
      return json({ ok: true, count: messages.length, unread: s.unreadForStudent, messages, images_enabled: !!env.IMAGES });
    }

    if (path === "/api/room" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const text = String(body.text || "").trim();
      const images = Array.isArray(body.images) ? body.images.map(String) : [];
      if (!text && images.length === 0) return json({ ok: false, error: "empty" }, 400);
      if (text.length > TEXT_MAX) return json({ ok: false, error: "too_long", max: TEXT_MAX }, 400);
      if (images.length > 4) return json({ ok: false, error: "too_many_images", max: 4 }, 400);
      if (images.some((k) => imageOwner(k) !== customer.id)) return json({ ok: false, error: "bad_image" }, 400);
      const ev = await addEvent(env, customer.id, "correction_submitted", { text, images }, "site");
      await logInbound(env, "room", { customer_id: customer.id, chars: text.length, images: images.length }, { ok: true, id: ev.id }, 200);
      return json({ ok: true, id: ev.id });
    }

    if (path === "/api/room/read" && method === "POST") {
      const evs = await roomEvents(env, customer.id);
      const s = roomState(evs);
      if (s.lastMessageId > s.studentReadUpto) {
        await addEvent(env, customer.id, "room_read", { by: "student", upto: s.lastMessageId }, "site");
      }
      return json({ ok: true, upto: s.lastMessageId });
    }

    if (path === "/api/room/images" && method === "POST") {
      if (!env.IMAGES) return json({ ok: false, error: "no_image_store" }, 503);
      const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = IMAGE_TYPES[type];
      if (!ext) return json({ ok: false, error: "bad_type", allowed: Object.keys(IMAGE_TYPES) }, 400);
      const buf = await request.arrayBuffer();
      if (buf.byteLength === 0) return json({ ok: false, error: "empty" }, 400);
      if (buf.byteLength > IMAGE_MAX_BYTES) return json({ ok: false, error: "too_large", max_bytes: IMAGE_MAX_BYTES }, 400);
      const key = `room/${customer.id}/${crypto.randomUUID()}.${ext}`;
      await env.IMAGES.put(key, buf, { httpMetadata: { contentType: type } });
      return json({ ok: true, key, bytes: buf.byteLength });
    }

    if (path === "/api/room/image" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (imageOwner(key) !== customer.id) return json({ ok: false, error: "not_found" }, 404);
      return await serveImage(env, key);
    }

    return json({ ok: false, error: "not_found" }, 404);
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
    if (path === "/api/admin/rooms" && method === "GET") {
      return json(await core.listRooms(env, { only_unreplied: url.searchParams.get("only_unreplied") === "1" }));
    }
    const rm = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})$/i);
    if (rm && method === "GET") return json(await core.getRoom(env, { person_id: rm[1], mark_read: true }, "admin"));
    const rr = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/reply$/i);
    if (rr && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await core.returnCorrection(env, { ...body, person_id: rr[1] }, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/image" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!imageOwner(key)) return json({ ok: false, error: "not_found" }, 404);
      return await serveImage(env, key);
    }
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
  {
    name: "list_rooms",
    description: "添削ルームの部屋の一覧。未返信のある部屋が上（待たせている時間が長い順）。unreplied は返していない投稿の数。0 件は count: 0。",
    inputSchema: {
      type: "object",
      properties: { only_unreplied: { type: "boolean", description: "真なら未返信のある部屋だけ" } },
    },
  },
  {
    name: "get_room",
    description: "1 人の添削ルームのやりとりを古い順に返す。生徒の投稿は text・images・replied、返したものは original・corrected・comment。unreplied は未返信の投稿の id。読んだ印は付けない。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } }, required: ["person_id"] },
  },
  {
    name: "return_correction",
    description: "添削を 3 欄（原文・添削後・コメント）で返す。台帳に出来事として積まれ、生徒の画面に新着として出る。reply_to を省くといちばん古い未返信に返す。original を省くと投稿の文章をそのまま原文にする。",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string" },
        reply_to: { type: "integer", description: "返す投稿の id（get_room の unreplied）" },
        original: { type: "string", description: "原文（省くと投稿の文章）" },
        corrected: { type: "string", description: "添削後（必須）" },
        comment: { type: "string", description: "コメント" },
      },
      required: ["person_id", "corrected"],
    },
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
      else if (name === "list_rooms") result = await core.listRooms(env, args);
      else if (name === "get_room") result = await core.getRoom(env, { person_id: args.person_id, mark_read: false }, "mcp");
      else if (name === "return_correction") result = await core.returnCorrection(env, args, "mcp");
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
  if ("id" in result) s.id = result.id;
  if ("unreplied_total" in result) s.unreplied_total = result.unreplied_total;
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

// utage-alt-demo — UTAGE の代わりのサイト兼アプリ（B）。本番の置き場は htzadzpckcpdrmpjvaut（便 2〜）。デモの置き場の分は架空のデータ
// 入口は 1 つ：シアニン用の画面（/api/admin/*）と AI（/mcp）が同じ処理（core）を呼ぶ。
// 表の読み書きはこの Worker だけが秘密の鍵で行う。ブラウザからは表に触れない。
// 便 2：添削ルーム（1 対 1）。やりとりは新しい表を作らず、出来事の記録（events）に積む。
//   correction_submitted … 生徒が出した文章と画像
//   correction_returned  … 原文・添削後・コメントの 3 欄で返したもの（reply_to で出した側を指す）
//   room_read            … どこまで読んだか（by：student / admin、upto：最後に読んだ出来事の番号）
// 画像は R2（IMAGES）に置き、ログインした本人とシアニンだけが読める。
// 便 3：決済（UnivaPay のテスト）とメール（Cloudflare Email Service）。中身は src/bin3.js。
// B の便 4：売る（商品の台帳・単発・定期・年払い・紹介用の価格）。中身は src/sell.js。権利の計算もこちらへ移した。
// B の便 5：届ける（ステップ配信・一斉配信・クリックの計測・送信元を温める・ログインのメール）。中身は src/deliver.js。
// B の便 6a：寄せる（見る側）。学ぶくんの本物の教材・公開の面・添削の振り返り・長文の指摘。中身は src/learn.js。
// B の便 6b：寄せる（裏側）。会員の権利を門番の表（member_entitlement）と 1 つにする・面談の記録を読む・表の目録。中身は src/bridge.js。
// B の便 7a：オプチャの招待リンクは会員とシアニンにだけ返す。リンクは表 b_settings の 1 行（key=community_url）に置き、
//   シアニン用の画面と AI の道具（set_community_link・承認が要る）で差し替える。ログイン無しの /api/config からは外した。
// B の便 8c：企画と設計図。部品の持ち主は b_campaign_parts、設計図は部品どうしのつながりから毎回組み立てる。中身は src/plan.js。
// B の便 7c-1：メールの送り元・表示名・返信先・誰に送るか（test／login／all）を表 b_settings に置く（Cloudflare の値から移した）。
//   変えるのはシアニン用の画面か、承認が要る AI の道具 set_mail_settings。中身は src/mailcfg.js。生徒に見える文と法定の頁を本物にした。
// B の便 8e：コネクタ（トリガー → セレクタ → アクション）・自動で付くラベル・Naoki への知らせ。表は増やさず b_steps を広げた。中身は src/connect.js と src/deliver.js。
// B の便 8f-1：シアニン用のホーム「今日の 1 枚」（Google カレンダーの予定・やること・段階ごとの人数）と段階のボード。表は増やさない。中身は src/today.js。
// B の便 8f-2：ホームの仕上げ。UTAGE のカレンダーを 2 つ目の読み元に・繰り返しの予定の形を広げた・タスクマスターの今日の分（shia2n-mcp の TaskmasterReader をサービスの結びで読む）。表は増やさない。
// B の便 8f-3：人の 1 枚（段階・ラベル・買ったもの・部屋の状態・時系列）とチャット、Naoki のスマホへの通知。表も Cloudflare の値も増やさない。
//   チャット … 添削ルームと同じ部屋に、出来事 room_chat（payload.from：student／cyanin）として積む。添削の未返信には数えない
//   通知     … Web Push。中身は src/push.js。知らせるのは、コネクタの「Naoki に知らせる」・生徒からのメッセージ・AI の承認待ち

import { makeBin3 } from "./bin3.js";
import { makeBin4 } from "./bin4.js";
import { makeGuard } from "./guard.js";
import { makeSell } from "./sell.js";
import { makeDeliver } from "./deliver.js";
import { makeLearn, normalizeNotes, LESSON_ID_RE } from "./learn.js";
import { makeBridge } from "./bridge.js";
import { makePlan } from "./plan.js";
import { makeMailCfg } from "./mailcfg.js";
import { makeChanges } from "./changes.js";
import { makeConnect } from "./connect.js";
import { makeToday, stageOf } from "./today.js";
import { makePush } from "./push.js";
import { makeRefer } from "./refer.js";
import { LANES } from "./plan.js";

const VERSION = "0.18.1-b8f3";
const SOURCES = ["x", "note", "youtube", "direct", "other"];
const MEMBER_EVENT_TYPES = ["lesson_viewed", "announcement_opened"];
const ROOM_TYPES = ["correction_submitted", "correction_returned", "room_chat", "room_read"];
// 出来事の種類と中身から、どちらが出したか（生徒／シアニン）
const fromOf = (e) => e.type === "correction_submitted" ? "student" : e.type === "correction_returned" ? "cyanin" : (e.payload && e.payload.from === "student" ? "student" : "cyanin");
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX = 8000;
const UUID_RE = /^[0-9a-f-]{36}$/i;
// 便 8g-2：返す版はこちら（VERSION の行は便 8g-1 のプルリクと同じ行を直さないよう、触らずに残した。次の便で 1 本にまとめる）
const VERSION_NOW = "0.20.0-b8g2";

export default {
  async fetch(request, env) {
    env = withStore(env);
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/mcp" || path.startsWith("/mcp/")) return await handleMcp(request, env, url);
      if (path.startsWith("/api/")) return await handleApi(request, env, url);
      // B の便 5：メールの中のリンク（押したら記録して元の住所へ）
      const rl = path.match(/^[/]r[/]([0-9a-f]{12})$/);
      if (rl && !missingConfig(env).length) return await deliver.handleClick(env, url, rl[1]);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: "internal_error", detail: String(err && err.message || err) }, 500);
    }
  },

  // 定時の処理（1 時間ごと）：添削が返って 1 時間読まれていない人へメールを 1 通
  async scheduled(event, env, ctx) {
    env = withStore(env);
    ctx.waitUntil((async () => {
      if (missingConfig(env).length) return;
      try {
        const r = await bin3.remindUnread(env, roomEvents, roomState);
        const s = await bin4.remindSeminars(env);
        const d = await deliver.run(env);
        await logInbound(env, "cron", { cron: event.cron }, { room: r, seminars: s, deliver: d }, 200);
      } catch (e) {
        await logInbound(env, "cron", { cron: event.cron }, { ok: false, error: String(e.message).slice(0, 200) }, 500);
      }
    })());
  },
};

const changes = makeChanges({ db, logInbound });
const mailcfg = makeMailCfg({ db, logInbound, changes });
const bin3 = makeBin3({ db, addEvent, logInbound, json, mailcfg, onCharge: (env, event, data) => sell.onCharge(env, event, data), onSubEvent: (env, id) => sell.syncGrants(env, id) });
const bin4 = makeBin4({ db, addEvent, bin3 });
const guard = makeGuard({ db, logInbound });
const bridge = makeBridge({ db, rawDb, addEvent, secretHeaders });
const sell = makeSell({ db, addEvent, bin3, bridge, logInbound });
// B の便 8g-2：紹介。紹介者の表は作らず、出来事 referred・referral_reward・referral_paid に積む。率は商品の台帳の affiliate_rate（%）。中身は src/refer.js
const refer = makeRefer({ db, addEvent, logInbound });
sell.onPurchased = (env, buyerId, ev, product, actor) => refer.onPurchase(env, buyerId, ev, product, actor);
const push = makePush({ db, addEvent, logInbound });
const connect = makeConnect({ db, addEvent, logInbound, sell, mailcfg, push });
const deliver = makeDeliver({ db, addEvent, logInbound, bin3, sell, mailcfg, connect });
const learn = makeLearn({ db });
const plan = makePlan({ db, logInbound, communityLink, changes });
const today = makeToday({ db, logInbound, connect, bin4, guard, listRooms: (env, a) => core.listRooms(env, a) });

// ---------- 共通 ----------

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// B の便 2：置き場をいまの本番のプロジェクトへ移す。
// B_SUPABASE_SECRET_KEY（Cloudflare の秘密の値）が入っているときだけ本番のプロジェクトを使い、
// 入っていなければデモのプロジェクトのまま動く（入れる前に組み立てが走っても止まらないため）。
// 本番では表の名前に b_ を付け、顧客の台帳は作らずに member（門番の表）へ寄せる。
const B_TABLES = {
  events: "b_events", inbound_log: "b_inbound_log", lessons: "b_lessons",
  announcements: "b_announcements", admins: "b_admins",
  customer_summary: "b_customer_summary", customers: "b_customers",
  // 便 6a：学ぶくんの表を読む見る表（デモの置き場には無い）
  mn_lessons: "b_mn_lessons", mn_access: "b_mn_access",
  // 便 7a：サイト全体の設定（いまはオプチャの招待リンクだけ）
  settings: "b_settings",
};

function withStore(env) {
  if (!env.B_SUPABASE_SECRET_KEY || !env.B_SUPABASE_URL || !env.B_SUPABASE_PUBLISHABLE_KEY) return env;
  return Object.assign(Object.create(env), {
    SUPABASE_URL: env.B_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: env.B_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: env.B_SUPABASE_SECRET_KEY,
    B_STORE: true,
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
// 本番の置き場では表の名前を b_ に読み替える。顧客の台帳への書き込みだけは別の道（storeCustomerWrite）を通る
async function db(env, method, pathAndQuery, body, prefer) {
  if (env.B_STORE) {
    const i = pathAndQuery.search(/[?]/);
    const table = i < 0 ? pathAndQuery : pathAndQuery.slice(0, i);
    if (table === "customers" && method !== "GET") return await storeCustomerWrite(env, method, pathAndQuery, body);
    if (B_TABLES[table]) pathAndQuery = B_TABLES[table] + (i < 0 ? "" : pathAndQuery.slice(i));
  }
  return await rawDb(env, method, pathAndQuery, body, prefer);
}

// 本番の置き場の顧客の台帳は「member（門番の表）＋ b_profile（B だけが使う欄）」を合わせた見る表 b_customers。
// 見る表へは書けないので、新規は関数 b_register、直しは b_profile への書き込みに置き換える。
// 返す形はデモの customers と同じ（呼ぶ側を変えないため）。
async function storeCustomerWrite(env, method, pathAndQuery, body) {
  if (method === "POST") {
    const row = Array.isArray(body) ? body[0] : body;
    const r = await rawDb(env, "POST", "rpc/b_register", { p_email: row.email, p_name: row.name || "", p_source: row.source || "direct" });
    return await rawDb(env, "GET", `b_customers?select=*&id=eq.${r.id}`);
  }
  const m = pathAndQuery.match(/^customers[?]id=eq[.]([0-9a-f-]{36})$/i);
  if (method === "PATCH" && m) {
    const patch = { member_id: m[1] };
    if ("note_member" in body) patch.note_member = !!body.note_member;
    if ("auth_user_id" in body) patch.sb_auth_uid = body.auth_user_id;
    const exists = await rawDb(env, "GET", `b_customers?select=id,source&id=eq.${m[1]}`);
    if (exists.length === 0) return [];
    // B の行がまだ無い人に行を作るとき、流入元が既定の direct に変わらないよう、いまの値を入れる（便 3 の通しで見つけた件）
    patch.source = exists[0].source;
    await rawDb(env, "POST", "b_profile?on_conflict=member_id", [patch], "resolution=merge-duplicates,return=minimal");
    return await rawDb(env, "GET", `b_customers?select=*&id=eq.${m[1]}`);
  }
  throw new Error(`db ${method} customers: 本番の置き場では使えない書き方`);
}

async function rawDb(env, method, pathAndQuery, body, prefer) {
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

// B の便 7a：オプチャの招待リンク。本番の置き場では表 b_settings の 1 行、デモの置き場では Cloudflare の値 COMMUNITY_URL。
const COMMUNITY_KEY = "community_url";
const COMMUNITY_URL_RE = /^https:[/][/][^\s<>"']{4,490}$/;
async function communityLink(env) {
  if (!env.B_STORE) return { url: env.COMMUNITY_URL || "", updated_at: null, updated_by: null };
  const rows = await db(env, "GET", `settings?select=value,updated_at,updated_by&key=eq.${COMMUNITY_KEY}`);
  return rows.length ? { url: rows[0].value || "", updated_at: rows[0].updated_at, updated_by: rows[0].updated_by } : { url: "", updated_at: null, updated_by: null };
}
// 差し替える。空の文字は「リンクを外す（入口を閉じる）」。actor は画面ならメール、AI なら mcp
async function setCommunityLink(env, { url }, actor) {
  if (!env.B_STORE) return { ok: false, error: "demo_store" };
  const v = String(url == null ? "" : url).trim();
  if (v && !COMMUNITY_URL_RE.test(v)) return { ok: false, error: "bad_url", note: "https:// で始まる 500 文字までのリンク。外すときは空にする" };
  const before = await communityLink(env);
  const rows = await db(env, "POST", "settings?on_conflict=key",
    [{ key: COMMUNITY_KEY, value: v, updated_at: new Date().toISOString(), updated_by: String(actor).slice(0, 200) }],
    "resolution=merge-duplicates,return=representation");
  await logInbound(env, "community_set", { actor, cleared: !v, changed: before.url !== v }, { ok: true }, 200);
  await changes.record(env, { kind: "setting", target: COMMUNITY_KEY, before: before.url, after: v, summary: v ? "オプチャの招待リンクを差し替えた" : "オプチャの招待リンクを外した", actor });
  return { ok: true, url: rows[0].value, cleared: !v, changed: before.url !== v, updated_at: rows[0].updated_at, updated_by: rows[0].updated_by };
}
// 渡してよいか。会員（門番の表を含む）とシアニン（b_admins）だけ。state：open（渡す）／locked（会員でない）／unset（リンクが未設定）
async function communityFor(env, ent, email) {
  const allowed = !!(ent && ent.member) || await learn.isAdminEmail(env, email);
  if (!allowed) return { state: "locked", url: null };
  const link = await communityLink(env);
  if (!link.url) return { state: "unset", url: null };
  return { state: "open", url: link.url };
}

async function requireAdmin(request, env) {
  const v = await verifyUser(request, env);
  if (v.error) return { error: v.error, status: 401 };
  const rows = await db(env, "GET", `admins?select=email&email=eq.${encodeURIComponent(v.email)}`);
  if (rows.length === 0) return { error: "not_admin", status: 403 };
  // 2026-10-08 Naoki の指示で認証アプリの 6 桁（aal2）を外した。入れるのは b_admins に載ったメールでリンクを受け取った人だけ
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
    const ent = await sell.entitlementMap(env);
    const dm = await bin4.dealMap(env);
    for (const p of people) {
      p.member = !!(ent[p.id] && ent[p.id].member);
      p.deal_stage = dm[p.id] ? dm[p.id].stage : "none";
    }
    return { ok: true, count: people.length, people };
  },

  // 便 8f-3：人の 1 枚。段階（設計図のレーンと同じ決め方）・買ったもの・部屋の状態を足した。
  // 通知の購読（push_*）の中身は端末の宛先なので、時系列には種類と端末の名前だけを出す
  async getTimeline(env, { person_id }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const [person] = await db(env, "GET", `customer_summary?select=*&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const events = (await db(env, "GET", `events?select=id,type,payload,actor,occurred_at&customer_id=eq.${person_id}&order=occurred_at.desc&limit=200`))
      .map((e) => String(e.type).startsWith("push_") ? { ...e, payload: { device: (e.payload && e.payload.device) || "", reason: (e.payload && e.payload.reason) || undefined } } : e);
    const deal = await bin4.deal(env, person_id);
    const labels = env.B_STORE ? ((await connect.getLabels(env, { person_id })).labels || []) : [];
    const lane = stageOf({ labels: labels.map((x) => x.label), deal: deal ? deal.stage : "none", logins: person.login_count || 0 });
    const purchases = (await db(env, "GET", `events?select=id,payload,occurred_at&customer_id=eq.${person_id}&type=eq.purchase_completed&order=occurred_at.desc&limit=50`))
      .map((e) => ({ at: e.occurred_at, product_id: e.payload.product_id || null, name: e.payload.product_name || e.payload.product_id || "", amount: e.payload.amount ?? null, kind: e.payload.kind || null, mode: e.payload.mode || null }));
    const rs = roomState(await roomEvents(env, person_id));
    return {
      ok: true, found: true,
      person: { ...person, entitlement: await sell.entitlement(env, person_id), deal, contract: bin4.contractOf(person.email) },
      stage: { id: lane, label: (LANES.find((l) => l.id === lane) || {}).label || lane },
      labels,
      purchases,
      room: { messages: rs.lastMessageId ? true : false, unread_for_admin: rs.unreadForAdmin, unreplied: rs.unreplied.length, unread_for_student: rs.unreadForStudent },
      events,
    };
  },

  // 便 8f-3：シアニンからチャットを 1 通（添削の 3 欄ではない、ふつうのやりとり）。生徒の画面の部屋に新着として出る
  async sendChat(env, { person_id, text }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const t = String(text ?? "").trim();
    if (!t) return { ok: false, error: "empty" };
    if (t.length > TEXT_MAX) return { ok: false, error: "too_long", max: TEXT_MAX };
    const [person] = await db(env, "GET", `customers?select=id&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const ev = await addEvent(env, person_id, "room_chat", { from: "cyanin", text: t }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, id: ev.id };
  },

  async setNoteMember(env, { person_id, value }, actor) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const rows = await db(env, "PATCH", `customers?id=eq.${person_id}`, { note_member: !!value }, "return=representation");
    if (rows.length === 0) return { ok: true, found: false };
    await addEvent(env, person_id, "note_member_set", { value: !!value }, actor);
    return { ok: true, found: true, note_member: rows[0].note_member };
  },

  // 便 7c-1 の続き：段階は会員かどうかを先に見る。会員は find_person と同じ entitlementMap（B で買った権利＋門番の表）で決める。
  // 会員でない人だけ、出来事から計算した段階（受講中・ログイン済・登録のみ）に分ける。出来事だけの段階は by_activity に残す
  async stats(env) {
    const people = await db(env, "GET", "customer_summary?select=id,stage,source");
    const ent = await sell.entitlementMap(env);
    const isMember = (p) => !!(ent[p.id] && ent[p.id].member);
    for (const p of people) p.member_stage = isMember(p) ? "会員" : p.stage;
    const by = (k) => people.reduce((m, p) => ((m[p[k]] = (m[p[k]] || 0) + 1), m), {});
    const recent = await db(env, "GET", "events?select=type&occurred_at=gte." + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()));
    return {
      ok: true,
      customers: people.length,
      members: people.filter(isMember).length,
      by_stage: by("member_stage"),
      by_activity: by("stage"),
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
        last_from: last ? fromOf(last) : null,
        last_text: last ? snippet(last) : "",
      };
    }).filter((r) => r.last_at);
    if (only_unreplied === true || only_unreplied === "true") rooms = rooms.filter((r) => r.unreplied > 0);
    rooms.sort((a, b) =>
      (b.unreplied > 0) - (a.unreplied > 0)
      || (a.unreplied > 0 ? String(a.oldest_unreplied_at).localeCompare(String(b.oldest_unreplied_at)) : 0)
      || (b.unread_for_admin > 0) - (a.unread_for_admin > 0)
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
  async returnCorrection(env, { person_id, reply_to, original, corrected, comment = "", notes }, actor) {
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
    // 便 6a：長文の指摘。引用は原文に必ずある文字列（無ければ返さずに止める）
    const nn = normalizeNotes(notes, orig);
    if (!nn.ok) return nn;
    const ev = await addEvent(env, person_id, "correction_returned", {
      reply_to: target.id,
      original: orig,
      corrected: corr,
      comment: String(comment || "").trim(),
      ...(nn.notes.length ? { notes: nn.notes } : {}),
    }, actor);
    return { ok: true, found: true, id: ev.id, reply_to: target.id, remaining_unreplied: s.unreplied.filter((e) => e.id !== target.id).length };
  },
};

// 便 6a：返した添削を新しい順に（生徒の振り返りと同じ中身）
async function listCorrections(env, { person_id, limit } = {}) {
  if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
  const [person] = await db(env, "GET", `customers?select=id&id=eq.${person_id}`);
  if (!person) return { ok: true, found: false };
  const evs = await roomEvents(env, person_id);
  const s = roomState(evs);
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const items = evs.filter((e) => e.type === "correction_returned").reverse().slice(0, n).map((e) => toMessage(e, s));
  return { ok: true, found: true, count: items.length, total: evs.filter((e) => e.type === "correction_returned").length, corrections: items };
}

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
    unreadForAdmin: msgs.filter((e) => fromOf(e) === "student" && e.id > adminReadUpto).length,
    unreadForStudent: msgs.filter((e) => fromOf(e) === "cyanin" && e.id > studentReadUpto).length,
    replied,
  };
}

function toMessage(e, s) {
  const p = e.payload || {};
  // 便 8f-3：チャット（添削以外のやりとり）。kind で添削と分ける
  if (e.type === "room_chat") {
    const from = fromOf(e);
    return {
      id: e.id, kind: "chat", from, at: e.occurred_at, actor: e.actor,
      text: p.text || "", images: Array.isArray(p.images) ? p.images : [],
      ...(from === "student" ? { read_by_cyanin: e.id <= s.adminReadUpto } : { read_by_student: e.id <= s.studentReadUpto }),
    };
  }
  if (e.type === "correction_submitted") {
    return {
      id: e.id, kind: "correction", from: "student", at: e.occurred_at,
      text: p.text || "", images: Array.isArray(p.images) ? p.images : [],
      replied: s.replied.has(String(e.id)),
      read_by_cyanin: e.id <= s.adminReadUpto,
    };
  }
  return {
    id: e.id, kind: "correction", from: "cyanin", at: e.occurred_at, actor: e.actor,
    reply_to: p.reply_to, original: p.original || "", corrected: p.corrected || "", comment: p.comment || "",
    notes: Array.isArray(p.notes) ? p.notes : [],
    read_by_student: e.id <= s.studentReadUpto,
  };
}

function snippet(e) {
  const p = e.payload || {};
  const t = e.type === "correction_submitted" || e.type === "room_chat"
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
    // 便 6a：学ぶくんの教材を読めるか（本番の置き場だけ）
    let manabu = null;
    if (dbOk === true && env.B_STORE) {
      try { await db(env, "GET", "mn_lessons?select=lesson_id&limit=1"); manabu = true; } catch (e) { manabu = String(e.message).slice(0, 200); }
    }
    const pay = bin3.univapayState(env);
    let mail;
    try { mail = await bin3.mailState(env); } catch (e) { mail = { binding: !!env.EMAIL, from: null, scope: null, error: String(e.message).slice(0, 200) }; }
    return json({
      ok: missing.length === 0 && dbOk === true, version: VERSION_NOW, missing_settings: missing, db: dbOk, images: !!env.IMAGES,
      store: env.B_STORE ? "production" : "demo", manabu, public_origin: env.PUBLIC_ORIGIN || null,
      univapay: { configured: pay.configured, mode: pay.mode, store: !!pay.store_id },
      mail: { binding: mail.binding, from: mail.from, from_name: mail.from_name || null, reply_to: mail.reply_to || null, scope: mail.scope, open_to_all: mail.scope === "all", auth_hook: !!env.B_AUTH_HOOK_SECRET, ...(mail.error ? { error: mail.error } : {}) },
    });
  }

  if (path === "/api/config") {
    return json({
      supabaseUrl: env.SUPABASE_URL || null,
      supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || null,
      univapayAppId: bin3.univapayState(env).app_id,
      univapayMode: bin3.univapayState(env).mode || null,
      plan: env.B_STORE ? null : bin3.PLAN,
      version: VERSION_NOW,
    });
  }

  const missing = missingConfig(env);
  if (missing.length) return json({ ok: false, error: "not_configured", missing_settings: missing }, 503);

  // 登録（公開の面）
  // 便 7c-1 の続き：台帳（member）にいるのに、まだ Supabase のログインの番号が無い人（ポータル時代の会員）が、ログインの頁でリンクを受け取れるようにする。
  // 台帳にいる人だけ、ログインの番号を先に作る（メールは確かめ済みにする）。台帳にいない人には何も作らない。返事はどちらも同じ形
  if (path === "/api/login/prepare" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "bad_email" }, 400);
    const [c] = await db(env, "GET", `customers?select=id,auth_user_id&email=eq.${encodeURIComponent(email)}`);
    let created = false;
    if (c && !c.auth_user_id) {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: secretHeaders(env), body: JSON.stringify({ email, email_confirm: true }) });
      created = res.ok; // 既にある（422）ときは作らずに進む
      if (!res.ok && res.status !== 422) await logInbound(env, "login_prepare", { email }, { ok: false, status: res.status, body: (await res.text()).slice(0, 200) }, res.status);
    }
    if (created) await logInbound(env, "login_prepare", { email }, { ok: true, created: true }, 200);
    return json({ ok: true });
  }

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
    // 便 8g-2：紹介のリンク（/register?ref=番号）から来たら、紹介された印を積む（1 人 1 回・自分の番号は積まない）
    let referred = false;
    if (env.B_STORE && body.ref) referred = (await refer.onRegister(env, id, String(body.ref), isNew)).referred === true;
    await logInbound(env, "register", { email, source, ref: body.ref ? String(body.ref).slice(0, 20) : undefined }, { ok: true, isNew, referred }, 200);
    return json({ ok: true, is_new: isNew });
  }

  // B の便 6a：公開の面（公式サイトの公開中の記事と教材の数。ログイン不要・中身や動画は出さない）
  if (path === "/api/public/front" && method === "GET") {
    return json(await learn.publicFront(env), 200, { "cache-control": "public, max-age=300" });
  }

  // B の便 4：商品の一覧（サイトに出すものだけ。?id= を付けると、出していなくても売っているもの 1 つ＝紹介用のリンク）
  if (path === "/api/products" && method === "GET") {
    return json(await sell.listForSite(env, url.searchParams.get("id") || ""));
  }
  // 窓を開く前の確かめ（登録済みか・売っているか・売り切れ・重ねて買えない商品をもう持っていないか）
  if (path === "/api/checkout/prepare" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const r = await sell.prepare(env, body);
    return json(r, r.ok ? 200 : 400);
  }
  // 決済の確かめ（ウィジェットのあと。ログインの前でも来る）。商品を指定したら便 4 の道、無ければ便 3 の見本のプラン
  if (path === "/api/checkout/confirm" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const r = body.product_id ? await sell.confirm(env, body) : await bin3.confirmCheckout(env, body);
    await logInbound(env, "checkout", { email: body.email || null, product_id: body.product_id || null, charge_id: body.charge_id || null, subscription_id: body.subscription_id || null, raw_keys: body.raw && typeof body.raw === "object" ? Object.keys(body.raw) : null }, { ok: r.ok, error: r.error || null, detail: r.detail || null }, r.ok ? 200 : 400);
    return json(r, r.ok ? 200 : 400);
  }
  if (path === "/api/webhooks/univapay" && method === "POST") return await bin3.handleWebhook(request, env);
  if (path === "/api/unsubscribe") return await bin3.handleUnsubscribe(request, env, url);
  // B の便 5：Supabase の「メールを送る引き金」。ログインのリンクを Cloudflare から送る（署名で Supabase からと確かめる）
  if (path === "/api/auth/send-email" && method === "POST") return await deliver.handleAuthEmail(request, env);

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
    const lib = await learn.lessonsFor(env, customer, v.email);
    const announcements = await db(env, "GET", "announcements?select=id,title,body,published_at&order=published_at.desc&limit=20");
    const viewed = await db(env, "GET", `events?select=payload&customer_id=eq.${customer.id}&type=eq.lesson_viewed`);
    const viewedIds = [...new Set(viewed.map((e) => e.payload && e.payload.lesson_id).filter(Boolean))];
    const room = roomState(await roomEvents(env, customer.id));
    const ent = await sell.entitlement(env, customer.id);
    const community = await communityFor(env, ent, v.email);
    return json({
      ok: true,
      me: { name: customer.name, email: customer.email, source: customer.source },
      lessons: lib.flat, announcements, viewed: viewedIds,
      library: { source: lib.source, member: lib.member, lesson_count: lib.lesson_count, programs: lib.programs },
      room_unread: room.unreadForStudent,
      entitlement: ent,
      community: community.state,
      community_url: community.url,
      // 便 8g-2：自分の紹介のリンクと数（紹介した人の名前は出さない）
      referral: await refer.mine(env, customer, url.origin),
    });
  }

  // 生徒：個別相談の予約とセミナー（便 4）
  if (path === "/api/booking" || path.startsWith("/api/booking/") || path.startsWith("/api/seminars/")) {
    const v = await verifyUser(request, env);
    if (v.error) return json({ ok: false, error: v.error }, 401);
    const customer = await customerByEmail(env, v.email);
    if (!customer) return json({ ok: false, error: "not_registered" }, 404);
    // B の便 7c-1：個別相談の枠とセミナーはまだ架空（本物は便 8f）。本番の置き場では、シアニン以外には「準備中」だけを返す
    if (env.B_STORE && !(await learn.isAdminEmail(env, v.email))) {
      if (method === "GET" && path === "/api/booking") return json({ ok: true, ready: false, note: "個別相談とセミナーの申し込みは準備中です" });
      return json({ ok: false, error: "not_ready" }, 403);
    }
    if (path === "/api/booking" && method === "GET") return json({ ready: true, ...(await bin4.studentView(env, customer)) });
    if (path === "/api/booking" && method === "POST") {
      const r = await bin4.book(env, customer, await request.json().catch(() => ({})));
      return json(r, r.ok ? 200 : 400);
    }
    if (path === "/api/booking/cancel" && method === "POST") {
      const r = await bin4.cancel(env, customer, await request.json().catch(() => ({})));
      return json(r, r.ok ? 200 : 400);
    }
    const sm = path.match(/^\/api\/seminars\/([a-z0-9-]+)\/register$/);
    if (sm && method === "POST") {
      const r = await bin4.registerSeminar(env, customer, sm[1]);
      return json(r, r.ok ? 200 : 400);
    }
    return json({ ok: false, error: "not_found" }, 404);
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
      // 便 8f-3：kind が chat なら添削の依頼ではなくメッセージ（未返信に数えない）。省くと今までどおり添削の依頼
      const isChat = body.kind === "chat";
      const ev = await addEvent(env, customer.id, isChat ? "room_chat" : "correction_submitted", isChat ? { from: "student", text, images } : { text, images }, "site");
      await logInbound(env, "room", { customer_id: customer.id, kind: isChat ? "chat" : "correction", chars: text.length, images: images.length }, { ok: true, id: ev.id }, 200);
      // 生徒からのメッセージはすぐ Naoki のスマホへ（添削の依頼はコネクタの知らせで届く）
      if (isChat) await push.send(env, { title: `メッセージ：${customer.name || customer.email}`, body: text ? text.replace(/\s+/g, " ").slice(0, 120) : "（画像）", url: `/admin#room/${customer.id}`, tag: `room-${customer.id}` });
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
    // 便 6a：学ぶくんの教材の番号は 36 文字（uuid）。切らずに入れ、形が違えば受け付けない
    if (body.lesson_id !== undefined) {
      if (!LESSON_ID_RE.test(String(body.lesson_id))) return json({ ok: false, error: "bad_lesson_id" }, 400);
      payload.lesson_id = String(body.lesson_id);
    }
    if (body.announcement_id) payload.announcement_id = Number(body.announcement_id) || null;
    const ev = await addEvent(env, customer.id, body.type, payload, "site");
    return json({ ok: true, id: ev.id });
  }

  // シアニン用（2 段階の確認を通ったときだけ）
  if (path.startsWith("/api/admin/")) {
    const a = await requireAdmin(request, env);
    if (a.error) return json({ ok: false, error: a.error }, a.status);
    if (path === "/api/admin/whoami") return json({ ok: true, email: a.email });
    // 便 7a：オプチャの招待リンク（読む・差し替える）
    if (path === "/api/admin/community" && method === "GET") return json({ ok: true, store: env.B_STORE ? "production" : "demo", ...(await communityLink(env)) });
    if (path === "/api/admin/community" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      const r = await setCommunityLink(env, { url: body.url }, a.email);
      return json(r, r.ok ? 200 : 400);
    }
    // 便 7c-1：メールの送り方（送り元・表示名・返信先・誰に送るか）
    if (path === "/api/admin/mail" && method === "GET") return json({ ok: true, settings: mailcfg.view(await mailcfg.get(env)) });
    if (path === "/api/admin/mail" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      const patch = {};
      for (const k of ["from", "from_name", "reply_to", "scope"]) if (k in body) patch[k] = body[k];
      const r = await mailcfg.set(env, patch, a.email);
      return json(r, r.ok ? 200 : 400);
    }
    if (path === "/api/admin/people" && method === "GET") {
      return json(await core.findPeople(env, { query: url.searchParams.get("q") || "", source: url.searchParams.get("source") || "" }));
    }
    const m = path.match(/^\/api\/admin\/people\/([0-9a-f-]{36})$/i);
    if (m && method === "GET") return json(await core.getTimeline(env, { person_id: m[1] }));
    // 便 6b：面談の記録（consult-manager の ic_ の表）
    const mm = path.match(/^\/api\/admin\/people\/([0-9a-f-]{36})\/meetings$/i);
    if (mm && method === "GET") return json(await bridge.meetings(env, { person_id: mm[1] }));
    if (m && method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      return json(await core.setNoteMember(env, { person_id: m[1], value: body.note_member }, "admin"));
    }
    if (path === "/api/admin/stats") return json(await core.stats(env));
    if (path === "/api/admin/setup" && method === "GET") {
      const pay = bin3.univapayState(env);
      return json({
        ok: true,
        univapay: { configured: pay.configured, mode: pay.mode, store: !!pay.store_id },
        webhook: { url: url.origin + "/api/webhooks/univapay", auth_token: await bin3.webhookAuth(env) },
        mail: await bin3.mailState(env),
      });
    }
    if (path === "/api/admin/consults" && method === "GET") {
      return json(await bin4.listConsults(env, { include_past: url.searchParams.get("past") === "1" }));
    }
    const dl = path.match(/^\/api\/admin\/people\/([0-9a-f-]{36})\/deal$/i);
    if (dl && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await bin4.setDealStage(env, { ...body, person_id: dl[1] }, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/seminars" && method === "GET") return json(await bin4.seminarsAdmin(env));
    const sr = path.match(/^\/api\/admin\/seminars\/([a-z0-9-]+)\/(remind|archive)$/);
    if (sr && method === "POST") {
      const r = sr[2] === "remind" ? await bin4.remindSeminars(env, { force_seminar_id: sr[1] }) : await bin4.sendArchive(env, sr[1], "admin");
      return json({ ok: r.ok !== false, ...r }, r.ok === false ? 400 : 200);
    }
    const em = path.match(/^\/api\/admin\/people\/([0-9a-f-]{36})\/email$/i);
    if (em && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await bin3.sendMailTo(env, { person_id: em[1], subject: body.subject, body: body.body }, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/rooms" && method === "GET") {
      return json(await core.listRooms(env, { only_unreplied: url.searchParams.get("only_unreplied") === "1" }));
    }
    const rm = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})$/i);
    if (rm && method === "GET") return json(await core.getRoom(env, { person_id: rm[1], mark_read: true }, "admin"));
    // 便 8f-3：シアニンからチャットを送る（画面からは承認なし。AI の send_chat は承認が要る）
    const rmsg = path.match(/^[/]api[/]admin[/]rooms[/]([0-9a-f-]{36})[/]message$/i);
    if (rmsg && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await core.sendChat(env, { person_id: rmsg[1], text: body.text }, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    // 便 8g-2：紹介（紹介者ごとの集計・払ったことの記録）
    if (path === "/api/admin/referrals" && method === "GET") { const r = await refer.list(env, { origin: url.origin }); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/referrals/paid" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await refer.markPaid(env, body, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    // 便 8f-3：スマホの通知（鍵の公開の半分・購読の一覧・購読する／やめる・試しに送る）
    if (path === "/api/admin/push" && method === "GET") { const r = await push.status(env); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/push" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await push.subscribe(env, a.email, body);
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/push" && method === "DELETE") {
      const body = await request.json().catch(() => ({}));
      return json(await push.unsubscribe(env, a.email, body));
    }
    if (path === "/api/admin/push/test" && method === "POST") {
      const r = await push.send(env, { title: "Lab OS の通知の試し", body: "この知らせが見えたら、スマホへの通知は届いています", url: "/admin", tag: "test" });
      return json(r, r.ok === false ? 400 : 200);
    }
    const rr = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/reply$/i);
    if (rr && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await core.returnCorrection(env, { ...body, person_id: rr[1] }, "admin");
      return json(r, r.ok === false ? 400 : 200);
    }
    // B の便 3：承認待ち・権限の表・AI の操作の記録（入れるのは b_admins のメールだけ）
    if (path === "/api/admin/approvals" && method === "GET") {
      return json(await guard.listApprovals(env, { status: url.searchParams.get("status") || "pending" }));
    }
    const ap = path.match(/^[/]api[/]admin[/]approvals[/]([0-9a-f-]{36})$/i);
    if (ap && method === "GET") return json(await guard.getApproval(env, { approval_id: ap[1] }));
    if (ap && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await guard.decide(env, { approval_id: ap[1], decision: body.decision }, a.email, async (tool, args) => {
        const out = await runTool(env, tool, args);
        await logInbound(env, "mcp", { tool, arguments: args, approved_by: a.email, approval_id: ap[1] }, summarize(out), out.ok === false ? 500 : 200);
        return out;
      });
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/permissions" && method === "GET") return json(await guard.listPermissions(env));
    if (path === "/api/admin/permissions" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await guard.setPermission(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/ai-log" && method === "GET") return json(await guard.aiLog(env, {}));
    // B の便 8c：設計図と企画（シアニン用の画面からは承認なしで変えられる。AI からは「しまう・戻す」だけ承認が要る）
    if (path === "/api/admin/blueprint" && method === "GET") {
      const r = await plan.blueprint(env, { campaign_id: url.searchParams.get("campaign") || "all" });
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/campaigns" && method === "GET") return json(await plan.listCampaigns(env, { include_archived: url.searchParams.get("archived") === "1" }));
    if (path === "/api/admin/campaigns" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await plan.createCampaign(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/campaigns/assign" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await plan.setPartCampaign(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/campaigns/archive" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await plan.archiveCampaign(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    // 便 8d：片付け案と、変えた記録・元に戻す（シアニン用の画面からは承認なし）
    if (path === "/api/admin/tidy" && method === "GET") { const r = await plan.tidyPlan(env); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/tidy" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      return json(await plan.applyTidy(env, body, a.email));
    }
    if (path === "/api/admin/changes" && method === "GET") { const r = await changes.list(env, { limit: url.searchParams.get("limit") || 50 }); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/changes/undo" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await changes.undo(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    // B の便 5：配信（シアニン用の画面からは承認なしで送れる。AI からは一斉配信とステップの変更に承認が要る）
    if (path === "/api/admin/deliver" && method === "GET") {
      const [b, s, w] = await Promise.all([deliver.listBroadcasts(env, {}), deliver.listSteps(env), env.B_STORE ? deliver.warmState(env) : null]);
      return json({ ok: true, broadcasts: b.broadcasts, steps: s.steps, warm: w, open_to_all: (await mailcfg.get(env)).scope === "all" });
    }
    if (path === "/api/admin/deliver/run" && method === "POST") return json(await deliver.run(env));
    if (path === "/api/admin/audience" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      return json(await deliver.previewAudience(env, body));
    }
    if (path === "/api/admin/broadcasts" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await deliver.draftBroadcast(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    const bq = path.match(/^[/]api[/]admin[/]broadcasts[/]([0-9a-f-]{36})[/](queue|cancel)$/i);
    if (bq && method === "POST") {
      const r = bq[2] === "queue" ? await deliver.queueBroadcast(env, { id: bq[1] }, a.email) : await deliver.cancelBroadcast(env, { id: bq[1] }, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    // B の便 8f-1：ホームの今日の 1 枚・段階のボード・カレンダーの非公開 URL（画面からは承認なしで変えられる。AI からは承認が要る）
    if (path === "/api/admin/today" && method === "GET") { const r = await today.today(env); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/board" && method === "GET") return json(await today.board(env));
    if (path === "/api/admin/calendar" && method === "GET") return json({ ok: true, calendars: await today.calendarStatus(env) });
    if (path === "/api/admin/calendar" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      const r = await today.setCalendarUrl(env, { url: body.url, which: body.which }, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    // B の便 8e：ラベル（自動の一覧と人数・手で付ける／外す）
    if (path === "/api/admin/labels" && method === "GET") { const r = await connect.getLabels(env, { person_id: url.searchParams.get("person_id") || undefined }); return json(r, r.ok === false ? 400 : 200); }
    if (path === "/api/admin/labels" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = body.remove ? await connect.removeLabel(env, body, a.email) : await connect.addLabel(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    if (path === "/api/admin/steps" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await deliver.setStep(env, body, a.email);
      return json(r, r.ok === false ? 400 : 200);
    }
    // B の便 4：商品の台帳（シアニン用の画面からは承認なしで変えられる。AI からは承認が要る）
    if (path === "/api/admin/products" && method === "GET") return json(await sell.listProducts(env, {}));
    if (path === "/api/admin/products" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const r = await sell.setProduct(env, body, a.email);
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
    description: "人の 1 枚。1 人の出来事を新しい順に返す（登録・ログイン・視聴など）に加えて、いまの段階 stage（出会う・登録・温める・相談・購入・受講・紹介のどれか）・ラベル labels（auto が false は手かコネクタで付けたもの）・買ったもの purchases・部屋の状態 room（シアニンが読んでいない数・添削の未返信・生徒が読んでいない数）を返す。person_id は find_person の id。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } }, required: ["person_id"] },
  },
  {
    name: "stats",
    description: "台帳の件数を 1 回で数える。members は会員の人数（find_person の member と同じ判定：B で買った権利と門番の表 member_entitlement の shiarabo_basic）。by_stage は会員を先に数え、残りを出来事の段階（受講中・ログイン済・登録のみ）に分ける。by_activity は出来事だけの段階。ほかに流入元別・直近 7 日の出来事の種類別。",
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
    description: "1 人の添削ルームのやりとりを古い順に返す。kind が correction は添削（生徒の投稿は text・images・replied、返したものは original・corrected・comment）、chat はふつうのメッセージ（from：student／cyanin・text）。unreplied は添削の未返信の投稿の id（メッセージは数えない）。読んだ印は付けない。",
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
        notes: {
          type: "array", maxItems: 30,
          description: "長文の指摘（任意）。quote は原文の一部をそのまま写したもの（原文に無いと quote_not_in_original で止まる）、text は指摘。番号は上から 1 から振られ、生徒の画面で原文の色の範囲と右の指摘が同じ番号で結ばれる",
          items: { type: "object", properties: { quote: { type: "string" }, text: { type: "string" } }, required: ["text"] },
        },
      },
      required: ["person_id", "corrected"],
    },
  },
  {
    name: "send_chat",
    description: "シアニンとして 1 人にメッセージを送る（添削の 3 欄ではない、ふつうのやりとり）。生徒の画面の添削ルームに新着として出る。文字だけ・8000 文字まで。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, text: { type: "string" } }, required: ["person_id", "text"] },
  },
  {
    name: "notify_naoki",
    description: "Naoki のスマホへ通知を 1 つ送る（Web Push）。title は 120 文字・body は 300 文字まで。url は押したときに開くシアニン用の画面の場所（/admin で始まる。省くとホーム）。届けた端末の数 sent を返す。端末が 0 なら devices: 0。",
    inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, url: { type: "string" } }, required: ["title"] },
  },
  {
    name: "list_referrals",
    description: "紹介の集計。紹介者ごとに、紹介の番号とリンク（/register?ref=番号）・紹介で登録した人の数 referred・その人たちの購入の数 purchases・報酬の合計 reward_total・払った合計 paid_total・まだ払っていない unpaid と、紹介した人の一覧を返す。報酬は商品の台帳の affiliate_rate（%）を買った時点の値で掛けたもの（紹介から 90 日以内の購入だけ・定期は最初の 1 回だけ）。referrer_id で 1 人に絞れる。0 件は count: 0。",
    inputSchema: { type: "object", properties: { referrer_id: { type: "string" } } },
  },
  {
    name: "mark_referral_paid",
    description: "紹介者に報酬を払ったことを記録する（払う作業そのものは B の外の振込など）。amount は円の整数で、まだ払っていない分 unpaid を超えると over_unpaid で止まる。referrer_id は list_referrals の referrer_id。",
    inputSchema: { type: "object", properties: { referrer_id: { type: "string" }, amount: { type: "integer" }, note: { type: "string" } }, required: ["referrer_id", "amount"] },
  },
  {
    name: "get_push_status",
    description: "スマホへの通知を受け取る端末の一覧（メール・端末の名前・通知の仕組みの住所の名前・いつから）。端末の宛先そのものと鍵は返さない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_corrections",
    description: "1 人に返した添削を新しい順に返す（原文・添削後・コメント・指摘・返した日時・出した文章の id）。生徒の「振り返り」の画面と同じ中身。0 件は count: 0。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, limit: { type: "integer", description: "最大件数（既定 20・最大 100）" } }, required: ["person_id"] },
  },
  {
    name: "get_meetings",
    description: "1 人分の面談の記録を返す（consult-manager の ic_ の表から、その人の番号・旧の番号・メールのどれかがそのまま入っている行）。表の欄は決め打ちせず、行をそのまま返す。looked は見た表と行数。0 件は count: 0。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } }, required: ["person_id"] },
  },
  {
    name: "list_tables",
    description: "本番の表の目録から、欄の名前と行数を返す（中身は返さない）。見られる頭の名前は ic_・mn_tensaku_・member・shr_billing_logs・b_ だけ。prefix で絞れる。",
    inputSchema: { type: "object", properties: { prefix: { type: "string" } } },
  },
  {
    name: "get_community_link",
    description: "オプチャの招待リンク（会員にだけ見えるもの）と、最後に変えた日時・人を返す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_community_link",
    description: "オプチャの招待リンクを差し替える。url を空にするとリンクを外す（入口を閉じる）。https:// で始まる 500 文字まで。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "get_mail_settings",
    description: "メールの送り方を返す：送り元（from）・表示名（from_name）・返信先（reply_to）・誰に送るか（scope：test＝テスト宛てだけ／login＝ログインと手続きのメールは誰にでも・お知らせはテスト宛てだけ／all＝お知らせも誰にでも）と、最後に変えた日時・人。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_mail_settings",
    description: "メールの送り方を変える。渡した欄だけ変わる。from は mail.shia2n.jp か demo.shia2n.jp の住所だけ。reply_to を空にすると返信先を外す。scope は test／login／all。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" }, from_name: { type: "string" }, reply_to: { type: "string" },
        scope: { type: "string", enum: ["test", "login", "all"] },
      },
    },
  },
  {
    name: "list_lessons",
    description: "学ぶくんの本物の教材の数を、プログラムとコースごとに返す（題名の一覧は返さない）。person_id を渡すと、その人に見える分だけ（受講の結びが無ければ member: false）。with_video は動画のある教材の数。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } } },
  },
  {
    name: "send_email",
    description: "1 人にメールを送る。届く相手は get_mail_settings の scope で決まる（test のときはテスト宛て＝シアニン用の画面に入れるメールとその + 付きの別名だけ。届かない相手には送らずに email_blocked を台帳に積む）。全メールの末尾に事業者の表記と配信停止のリンクが付く。結果は result: sent / blocked / failed。",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "本文（文字だけ）" },
      },
      required: ["person_id", "subject", "body"],
    },
  },
  {
    name: "list_consults",
    description: "個別相談の予約の一覧（近い順）。各予約に人と商談の段階（booked・done・won・lost）が付く。0 件は count: 0。include_past で終わった枠も含める。",
    inputSchema: { type: "object", properties: { include_past: { type: "boolean" } } },
  },
  {
    name: "set_deal_stage",
    description: "商談の段階を進める。stage は done（面談した）・won（成約）・lost（失注）。memo に面談のメモ、won のときは amount（円）。台帳に出来事として積まれ、シアニン用の画面の時系列に出る。",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string" },
        stage: { type: "string", enum: ["done", "won", "lost"] },
        memo: { type: "string" },
        amount: { type: "integer", minimum: 0 },
      },
      required: ["person_id", "stage"],
    },
  },
  {
    name: "list_seminars",
    description: "セミナーの一覧（架空の 2 回）。申込者の数・前日の知らせを送った数・アーカイブを配った数を返す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_note_member",
    description: "note のメンバーかどうかの印を付ける・外す（シアニン用の画面のチェックと同じ）。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, value: { type: "boolean" } }, required: ["person_id", "value"] },
  },
  {
    name: "send_seminar_reminder",
    description: "セミナーの前日の知らせを、まだ受け取っていない申込者に 1 人 1 回だけ送る（決まった型のリマインド）。seminar_id を指定する。",
    inputSchema: { type: "object", properties: { seminar_id: { type: "string" } }, required: ["seminar_id"] },
  },
  {
    name: "send_seminar_archive",
    description: "終わったセミナーのアーカイブを、まだ受け取っていない申込者に送る。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。",
    inputSchema: { type: "object", properties: { seminar_id: { type: "string" } }, required: ["seminar_id"] },
  },
  {
    name: "list_approvals",
    description: "承認待ちの一覧。status は pending（既定）・approved・rejected・expired・failed・all。承認の期限は頼んでから 24 時間。",
    inputSchema: { type: "object", properties: { status: { type: "string" }, limit: { type: "integer" } } },
  },
  {
    name: "get_approval",
    description: "承認待ち 1 件の状態と、承認されて実行されたときの結果を返す。",
    inputSchema: { type: "object", properties: { approval_id: { type: "string" } }, required: ["approval_id"] },
  },
  {
    name: "list_permissions",
    description: "道具ごとの権限（auto＝自動・approve＝承認が要る・deny＝禁止）を返す。表に無い道具は禁止。権限を変えられるのは Naoki だけ（シアニン用の画面）で、AI からは変えられない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_products",
    description: "商品の台帳を返す（名前・種類 one_time／subscription／installment・金額・周期・権利の日数・重ねて買えるか・販売数の上限・紹介用の価格の元・売っているか active・サイトに出すか public・売れた数 sold）。UTAGE の商品の価格の行から写したもの。",
    inputSchema: { type: "object", properties: { include_inactive: { type: "boolean", description: "売っていないものも含める（省略時 true）" } } },
  },
  {
    name: "set_product",
    description: "商品を 1 つ変える、または足す。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。変えられる欄：name・amount（円）・period（monthly／annually・定期だけ）・grant_days（単発の権利の日数）・grants（権利の印の配列）・deny_multiple・sales_limit・list_price_of・description・active（売る）・public（サイトに出す）・sort・note・affiliate_rate（紹介の報酬の率 %・0〜100 の整数・null で払わない）。新しく足すときは id・kind・name・amount が要る（分割 installment は足せない）。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "商品の id（英小文字・数字・ハイフン）" },
        kind: { type: "string", enum: ["one_time", "subscription"], description: "新しく足すときだけ" },
        name: { type: "string" }, amount: { type: "integer" }, period: { type: "string", enum: ["monthly", "annually"] },
        grant_days: { type: ["integer", "null"] }, grants: { type: "array", items: { type: "string" } },
        deny_multiple: { type: "boolean" }, sales_limit: { type: ["integer", "null"] }, list_price_of: { type: ["string", "null"] },
        description: { type: "string" }, active: { type: "boolean" }, public: { type: "boolean" }, sort: { type: "integer" }, note: { type: "string" },
        affiliate_rate: { type: ["integer", "null"], description: "紹介の報酬の率（%）。null で払わない" },
      },
      required: ["id"],
    },
  },
  {
    name: "preview_audience",
    description: "一斉配信の宛先を、条件で絞って数える（送らない）。filter の欄：source（流入元の配列 x／note／youtube／direct／other）・purchased（買った商品の id の配列）・not_purchased（買っていない商品の id の配列）・member（会員か true／false）・note_member（true／false）・registered_after／registered_before（日時）・emails（メールの配列。試しに送るとき）・labels（このラベルを全部持つ人。get_labels の名前）・not_labels（このラベルをどれも持たない人）。配信を止めている人の数も返す。コネクタのセレクタも同じ形。",
    inputSchema: { type: "object", properties: { filter: { type: "object" } } },
  },
  {
    name: "draft_broadcast",
    description: "一斉配信の下書きを作る、または直す（送らない）。subject・body・filter（preview_audience と同じ形）。本文の {{name}} は名前に置き換わり、https のリンクは押したかを数える住所に置き換わる。id を渡すと下書きのままのものを直す。宛先の人数も返す。",
    inputSchema: { type: "object", properties: { id: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, filter: { type: "object" } }, required: ["subject", "body"] },
  },
  {
    name: "queue_broadcast",
    description: "下書きの一斉配信を送る列に入れる。承認が要る道具：呼ぶと承認待ちになり approval_url が返る。送るのは毎時の定時の処理で、送信元を温めるための 1 日の上限の中から少しずつ送る。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "cancel_broadcast",
    description: "一斉配信を止める（下書き・列の中・送っている途中のどれでも）。もう送った分は戻らない。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_broadcasts",
    description: "一斉配信の一覧と結果（状態・宛先の人数・送った・送らなかった・失敗・リンクを押した回数と人数）。open_to_all が false の間は、テスト宛て以外へは送らない。",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
  },
  {
    name: "list_steps",
    description: "コネクタ（トリガー → セレクタ → アクション）の一覧。便 5 のステップ配信もここに入る。欄：trigger（きっかけ）・trigger_args・product_id・delay_hours（何時間後）・selector（誰に。preview_audience の filter と同じ形・空なら全員）・action（send_email／notify_admin／add_label）・action_args・subject・body・active。結果の数（sent・clicks・notified・labeled・skipped）と、選べるきっかけ triggers・アクション actions も返す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_step",
    description: "コネクタを足す・直す・動かす・止める。承認が要る道具。欄：id（直すとき）・name・trigger（registered 登録した／purchase 買った／clicked メールのリンクを押した／lesson_viewed 教材を見た／correction_submitted 添削を出した／login ログインした／label_added ラベルが付いた）・trigger_args（label：label_added のときのラベル・url：clicked のときのリンク）・product_id（purchase のとき。省くとどの購入でも）・delay_hours（何時間後）・selector（誰に。preview_audience の filter と同じ形）・action（send_email メールを送る／notify_admin Naoki に知らせる／add_label ラベルを付ける）・action_args（label：add_label のとき）・subject・body（{{name}}・{{email}}・{{product}}・{{label}}・{{url}} が置き換わる）・active。動かした時刻より後のきっかけだけが対象。セレクタに当たらない人は connector_skipped として残る。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" }, name: { type: "string" },
        trigger: { type: "string", enum: ["registered", "purchase", "clicked", "lesson_viewed", "correction_submitted", "login", "label_added"] },
        trigger_args: { type: "object" }, product_id: { type: ["string", "null"] }, delay_hours: { type: "integer" },
        selector: { type: "object" }, action: { type: "string", enum: ["send_email", "notify_admin", "add_label"] }, action_args: { type: "object" },
        subject: { type: "string" }, body: { type: "string" }, active: { type: "boolean" }, sort: { type: "integer" },
      },
    },
  },
  {
    name: "get_today",
    description: "シアニン用のホーム「今日の 1 枚」。今日（日本時間）の Google カレンダーの予定（既定のカレンダーと UTAGE のカレンダーをまとめたもの。calendar.sources に読み元ごとの状態。calendar.state が unset ならどちらも未設定）・タスクマスターの今日の分（tasks：期限が今日の due と過ぎている overdue）・やること（承認待ち・未返信の添削・今日の個別相談・今日の知らせ）・段階ごとの人数を返す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_stage_board",
    description: "段階のボード。人をお客さんの段階（出会う・登録・温める・相談・購入・受講・紹介）に振り分けて、段階ごとの人数と人（新しく動いた順に 50 人まで）を返す。段階は上から 受講（会員か教材を見た）→ 購入 → 相談 → 温める → 登録 の順に当てる。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_calendar_url",
    description: "ホームに出す Google カレンダーの「iCal 形式の非公開 URL」を入れる・外す。承認が要る道具。which は main（既定のカレンダー・省略時）か utage（UTAGE のカレンダー）。url は https://calendar.google.com/calendar/ical/ で始まり .ics で終わる。空にすると外す。URL そのものは記録にも返事にも出さない。",
    inputSchema: { type: "object", properties: { url: { type: "string" }, which: { type: "string", enum: ["main", "utage"] } }, required: ["url"] },
  },
  {
    name: "get_labels",
    description: "ラベル。person_id を渡すとその人のラベル（auto が true は出来事から自動で付いたもの・false は手かコネクタで付けたもの）、省くと全員のラベルの名前と人数。自動のラベル：流入元:X など・会員／会員でない・購入者・買った:商品の外の名前（生徒に見える名前）・リンクを押した・教材を見た・添削を出した・セミナーに申し込んだ・個別相談を予約した・企画:企画名・最後に動いた:7日以内／30日以内／30日より前。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } } },
  },
  {
    name: "add_label",
    description: "1 人にラベルを手で付ける。承認が要る道具。ラベルは空白・カンマ・山かっこ・引用符を含まない 1〜40 文字。もう付いていれば何もしない。付けると「ラベルが付いた」のコネクタのきっかけになる。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, label: { type: "string" } }, required: ["person_id", "label"] },
  },
  {
    name: "remove_label",
    description: "手かコネクタで付けたラベルを 1 人から外す。承認が要る道具。自動で付いたラベルは外せない（出来事から毎回計算するため）。",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, label: { type: "string" } }, required: ["person_id", "label"] },
  },
  {
    name: "get_blueprint",
    description: "設計図を返す。部品（page・step・broadcast・seminar・booking・product・course・room・community）を集める・育てる・売る・届ける・紹介のレーンに並べ、実際の設定から引いたつながり（線）と、部品ごとの先週 7 日の数を返す。部品ごとに外の名前（name・生徒に見える）・中の名前（inner_name・企画名｜種類｜役目）・持ち主の企画・線でつながる別の企画（used_by）・どこともつながっていないか（isolated）が付く。campaign_id：all（しまった企画を除く全部）／unassigned（企画に入っていない部品）／企画の番号（その企画の部品と、線でつながる外の部品 outside）。",
    inputSchema: { type: "object", properties: { campaign_id: { type: "string" } } },
  },
  {
    name: "list_campaigns",
    description: "企画の一覧（名前・常設か・開催日・しまったか・持ち主の部品の数）と、企画に入っていない部品の数。include_archived が真ならしまった企画も返す。",
    inputSchema: { type: "object", properties: { include_archived: { type: "boolean" } } },
  },
  {
    name: "create_campaign",
    description: "企画を作る（部品は動かない）。title は 1〜60 文字。名前の頭に年月が自動で付く（starts_on＝開催日 YYYY-MM-DD があればその月、無ければ今月）。しまっていない企画と同じ名前は作れない。",
    inputSchema: { type: "object", properties: { title: { type: "string" }, starts_on: { type: "string" } }, required: ["title"] },
  },
  {
    name: "set_part_campaign",
    description: "部品の持ち主の企画と役目を変える（部品は動かない）。part_type・part_id は get_blueprint の type と id。role は 60 文字まで（中の名前の最後に入る。空なら外の名前）。campaign_id を空にすると企画から外す。しまった企画には入れられない。",
    inputSchema: { type: "object", properties: { part_type: { type: "string" }, part_id: { type: "string" }, campaign_id: { type: ["string", "null"] }, role: { type: "string" } }, required: ["part_type", "part_id"] },
  },
  {
    name: "archive_campaign",
    description: "企画をしまう（restore が真なら戻す）。承認が要る道具。常設はしまえない。持ち主の部品が 1 つでも動いていたら（動いているステップ・送る列の一斉配信・売っている商品・これからのセミナーなど）しまわずに running で並べて返す。しまうと一覧と設計図から消えるが、部品と数字は残る。",
    inputSchema: { type: "object", properties: { campaign_id: { type: "string" }, restore: { type: "boolean" } }, required: ["campaign_id"] },
  },
  // 便 8d：片付けと元に戻す
  {
    name: "get_tidy_plan",
    description: "片付け案を返す（何も変えない）。企画に入っていない部品ごとに、入れる先の企画と役目の案（既定は常設・商品はまとまりの名前）と、部品が 1 つも無い企画をしまう案（archives）。別の企画へ入れたいものは campaign_id を変えて apply_tidy に渡す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "apply_tidy",
    description: "片付け案を当てる。承認が要る道具。assignments（part_type・part_id・campaign_id・role の並び・200 件まで）と archives（しまう企画の campaign_id の並び）を渡すとそのとおり、どちらも渡さなければ get_tidy_plan の案のまま。部品の振り分けは 1 件ずつ変えた記録に残り、list_changes の番号で undo_change すると戻せる。しまった企画は archive_campaign（restore true）で戻す。",
    inputSchema: { type: "object", properties: { assignments: { type: "array", items: { type: "object" } }, archives: { type: "array", items: { type: "string" } } } },
  },
  {
    name: "list_changes",
    description: "変えた記録（新しい順）。設定（メールの送り方・オプチャの招待リンク）と部品の持ち主の変更を、前と後・誰が・いつ・戻したかで返す。",
    inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
  },
  {
    name: "undo_change",
    description: "変えた記録の 1 件を元に戻す。承認が要る道具。前の値を書き戻す。同じ記録は 1 回だけ。同じ設定・部品にあとの変更があるときは newer_change で止まる（あとのほうを先に戻す）。",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
];

// 承認待ちの知らせに出す道具の名前（画面の TOOL_LABEL と同じ言い方）
const TOOL_NAMES = { apply_tidy: "片付け案を当てる", add_label: "ラベルを付ける", remove_label: "ラベルを外す", set_step: "コネクタを変える", queue_broadcast: "一斉配信を送る", set_mail_settings: "メールの送り方を変える", set_community_link: "オプチャのリンクを変える", set_calendar_url: "カレンダーを変える", return_correction: "添削を返す", send_email: "メールを送る", send_chat: "メッセージを送る", set_product: "商品を変える", set_deal_stage: "商談を進める", set_note_member: "note の印を変える", send_seminar_archive: "アーカイブを配る", archive_campaign: "企画をしまう", undo_change: "元に戻す", mark_referral_paid: "紹介の報酬を払った記録" };

// 道具を 1 回実行する（権限の確かめは呼ぶ側で済ませる）。承認されたあとの実行もここを通る
async function runTool(env, name, args) {
  if (name === "find_person") return await core.findPeople(env, args);
  if (name === "get_timeline") return await core.getTimeline(env, args);
  if (name === "stats") return await core.stats(env);
  if (name === "list_rooms") return await core.listRooms(env, args);
  if (name === "get_room") return await core.getRoom(env, { person_id: args.person_id, mark_read: false }, "mcp");
  if (name === "return_correction") return await core.returnCorrection(env, args, "mcp");
  if (name === "list_corrections") return await listCorrections(env, args);
  if (name === "send_chat") return await core.sendChat(env, args, "mcp");
  if (name === "notify_naoki") {
    const u = String(args.url || "/admin");
    if (!String(args.title || "").trim()) return { ok: false, error: "need_title" };
    return await push.send(env, { title: args.title, body: args.body || "", url: u.startsWith("/admin") ? u : "/admin", tag: "ai" });
  }
  if (name === "list_referrals") return await refer.list(env, { referrer_id: args.referrer_id, origin: env.PUBLIC_ORIGIN || "https://lab.shia2n.jp" });
  if (name === "mark_referral_paid") return await refer.markPaid(env, args, "mcp");
  if (name === "get_push_status") { const r = await push.status(env); if (r.ok) delete r.public_key; return r; }
  if (name === "list_lessons") return await learn.listLessons(env, args);
  if (name === "get_meetings") return await bridge.meetings(env, args);
  if (name === "list_tables") return await bridge.listTables(env, args);
  if (name === "get_community_link") return { ok: true, ...(await communityLink(env)) };
  if (name === "set_community_link") return await setCommunityLink(env, { url: args.url }, "mcp");
  if (name === "get_mail_settings") return { ok: true, settings: mailcfg.view(await mailcfg.get(env)) };
  if (name === "set_mail_settings") {
    const patch = {};
    for (const k of ["from", "from_name", "reply_to", "scope"]) if (args && k in args) patch[k] = args[k];
    return await mailcfg.set(env, patch, "mcp");
  }
  if (name === "send_email") return await bin3.sendMailTo(env, args, "mcp");
  if (name === "list_consults") return await bin4.listConsults(env, args);
  if (name === "set_deal_stage") return await bin4.setDealStage(env, args, "mcp");
  if (name === "list_seminars") return await bin4.seminarsAdmin(env);
  if (name === "set_note_member") return await core.setNoteMember(env, { person_id: args.person_id, value: args.value }, "mcp");
  if (name === "send_seminar_reminder") {
    if (!/^[a-z0-9-]{1,40}$/.test(String(args.seminar_id || ""))) return { ok: false, error: "bad_seminar_id" };
    return await bin4.remindSeminars(env, { force_seminar_id: args.seminar_id });
  }
  if (name === "send_seminar_archive") {
    if (!/^[a-z0-9-]{1,40}$/.test(String(args.seminar_id || ""))) return { ok: false, error: "bad_seminar_id" };
    return await bin4.sendArchive(env, args.seminar_id, "mcp");
  }
  if (name === "list_approvals") return await guard.listApprovals(env, args);
  if (name === "get_approval") return await guard.getApproval(env, args);
  if (name === "list_permissions") return await guard.listPermissions(env);
  if (name === "list_products") return await sell.listProducts(env, args);
  if (name === "set_product") return await sell.setProduct(env, args, "mcp");
  if (name === "preview_audience") return await deliver.previewAudience(env, args);
  if (name === "list_broadcasts") return await deliver.listBroadcasts(env, args);
  if (name === "draft_broadcast") return await deliver.draftBroadcast(env, args, "mcp");
  if (name === "queue_broadcast") return await deliver.queueBroadcast(env, args, "mcp");
  if (name === "cancel_broadcast") return await deliver.cancelBroadcast(env, args, "mcp");
  if (name === "list_steps") return await deliver.listSteps(env);
  if (name === "set_step") return await deliver.setStep(env, args, "mcp");
  if (name === "get_labels") return await connect.getLabels(env, args);
  if (name === "get_today") return await today.today(env);
  if (name === "get_stage_board") return await today.board(env);
  if (name === "set_calendar_url") return await today.setCalendarUrl(env, { url: args.url, which: args.which }, "mcp");
  if (name === "add_label") return await connect.addLabel(env, args, "mcp");
  if (name === "remove_label") return await connect.removeLabel(env, args, "mcp");
  if (name === "get_blueprint") return await plan.blueprint(env, args);
  if (name === "list_campaigns") return await plan.listCampaigns(env, args);
  if (name === "create_campaign") return await plan.createCampaign(env, args, "mcp");
  if (name === "set_part_campaign") return await plan.setPartCampaign(env, args, "mcp");
  if (name === "archive_campaign") return await plan.archiveCampaign(env, args, "mcp");
  if (name === "get_tidy_plan") return await plan.tidyPlan(env);
  if (name === "apply_tidy") return await plan.applyTidy(env, args, "mcp");
  if (name === "list_changes") return await changes.list(env, args);
  if (name === "undo_change") return await changes.undo(env, args, "mcp");
  return { ok: false, error: "unknown_tool" };
}

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
      const r = await rpc({ jsonrpc: "2.0", id: "get", method: "tools/call", params: { name: tool, arguments: args } }, env, url.origin);
      return json(r.result || r);
    }
    return json({ ok: true, name: "utage-alt-demo", version: VERSION_NOW, tools: TOOLS.map((t) => t.name) });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const msg = await request.json().catch(() => null);
  if (!msg) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  if (Array.isArray(msg)) {
    const out = [];
    for (const m of msg) { const r = await rpc(m, env, url.origin); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await rpc(msg, env, url.origin);
  return r ? json(r) : new Response(null, { status: 202 });
}

async function rpc(msg, env, origin = "") {
  const { id, method, params = {} } = msg || {};
  if (id === undefined || id === null) return null; // 知らせ（notifications/*）には返事をしない
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return ok({
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "utage-alt-demo", version: VERSION_NOW },
    });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments || {};
    let result, isError = false;
    try {
      // B の便 3：道具ごとの権限（自動・承認・禁止）を先に見る
      const known = TOOLS.some((t) => t.name === name);
      const mode = known ? await guard.modeOf(env, name) : "auto";
      if (mode === "deny") result = { ok: false, error: "denied_by_permission", tool: name, note: "この道具は権限の表で禁止になっている。変えられるのは Naoki だけ" };
      else if (mode === "approve") {
        result = await guard.requestApproval(env, name, args, origin);
        // 便 8f-3：承認待ちができたら Naoki のスマホへ（押すとその承認の画面が開く）
        if (result.pending_approval) await push.send(env, { title: "承認待ち：" + (TOOL_NAMES[name] || name), body: "AI が承認を頼んでいます。開いて中身を見て決めてください", url: `/admin#approval/${result.approval_id}`, tag: "approval" });
      }
      else result = await runTool(env, name, args);
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
  if (result.pending_approval) { s.pending_approval = true; s.approval_id = result.approval_id; }
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

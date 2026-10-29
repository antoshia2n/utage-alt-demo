// B の便 6b：寄せる（裏側）。
//  ・権利：会員かどうかの正本は門番の権利の表（member_entitlement）。shr-webhook が本番の会員の支払いから
//    shiarabo_basic を付けている（2026-10-08 に 24 人）。B はこれを読み、B で買った商品の権利の印（grants）も同じ表へ書く。
//    表の決まり：source は payment か manual。B が書く行は source=payment・reason が「B で購入」で始まる。
//    同じ key の payment の行がもうある人（shr-webhook が付けた人）には足さない。外すときは B が書いた行だけを外す。
//  ・決済の受け口そのもの（UnivaPay の知らせの宛先）は動かさない。付け替えは便 7b（10/19・10/21 の本番の課金を見てから）。
//  ・面談の記録：consult-manager の表（ic_）の欄は開発部から読めないので、決め打ちしない。
//    表の一覧と欄は Supabase の表の目録（/rest/v1/ の定義）から取り、1 人分は「行のどこかにその人の番号かメールが入っている行」で拾う。
//  ・表の目録を読む道具（list_tables）：決めた頭の名前の表だけ、欄の名前と行数を返す（中身は返さない）。

// 2026-10-29 Naoki「OK」：NEXT の 2 つとモニターも、しあらぼの会員と同じ扱い（ゲストは会員扱いにしない）
export const MEMBER_KEYS = ["shiarabo_basic", "shiarabo_next_premium", "shiarabo_next_standard", "shiarabo_monitor"];
export const B_REASON = "B で購入";
const TABLE_PREFIXES = ["ic_", "mn_tensaku_", "member", "shr_billing_logs", "b_"];
const MEETING_PREFIX = "ic_";
const MEETING_SKIP = new Set(["ic_status_logs"]); // 動きの記録（控えでも外している履歴の表）
const MEETING_ROWS_MAX = 2000;

// マーケくん便 2（2026-10-24）：顧客管理の画面から手で権利を付け外しする。
//  ・付けるのは source=manual の行だけ。理由は必ず書く（表の側にも決まりがある）。支払いの行（source=payment）は画面からは触らない
//  ・外せるのは source=manual の行だけ。外す理由も必ず書き、付けた・外したを出来事（b_events）に残す
//  ・付けられる権利の名前は、門番の表にもうある名前と、下の決めた名前だけ（打ち間違いで新しい名前を作らない）
//  ・2026-10-29 Naoki「OK」：選べる名前はこの 6 つだけ。ほかの名前は表に残っていても選ぶ欄に出さない（消さない）
//  ・ゲストは期限を必ず入れる（試用のあとに開いたまま残さないため）
export const KNOWN_KEYS = ["shiarabo_basic", "shiarabo_pilot", "shiarabo_next_premium", "shiarabo_next_standard", "shiarabo_monitor", "guest"];
export const GUEST_KEY = "guest";
// 期限が要る名前：ゲスト（10/29 08:06 Naoki「OK」）とモニター（10/27 の判断記録「手で・期限つき」）
export const EXPIRY_REQUIRED = [GUEST_KEY, "shiarabo_monitor"];

// マーケくん便 5（2026-10-27）：アプリの公開スイッチ。権利 × 開くものの表（member_access）の行を画面から入れる・外す。
//  ・入れる・外すのは「先行で試す」の権利（shiarabo_pilot・2026-10-27 21:20 Naoki「OK」）の行だけ。basic の生徒から Naoki が名前で選んだ人に付ける
//  ・アプリは会員公開の関門 1〜7 が全部 ○ のものだけ（事業の設計図 表 E）。○ になったアプリはここに 1 行足す
//  ・ほかの権利の行は見るだけ。門番（shia2n-mcp の /gate/resolve）はこの表でその人の apps を決め、各アプリは apps に自分の名前があるときだけ通す
export const PILOT_KEY = "shiarabo_pilot";
// 公開スイッチで切り替えられる権利：先行で試す と ゲスト（ゲストは関門を通ったアプリを開く・MCP は付けない。10/29 08:06 Naoki「OK」）
export const SWITCH_KEYS = [PILOT_KEY, "guest"];
// 関門 1（2026-10-29）：生徒の画面（/app）のマイページ・教材・お知らせ・添削ルーム・振り返りを開ける権利。
// それ以外の人（無料の登録・会員でない買い手）は「ご契約」だけ（表A の確定「無料の登録はアプリは使えない」）
// 2026-10-29 統括（Naoki 20:49）：公開の順番はゲスト → 先行 → 生徒。今マイページを全部使えるのは guest と shiarabo_pilot（とシアニン）だけ。
// 生徒（会員の 4 つ）だけの人は「ご契約」だけで、画面には「準備中・教材は学ぶくんで」と出す（memberWaiting）
export const APP_ACCESS_KEYS = [PILOT_KEY, GUEST_KEY];
export function appAccess(ent, admin = false) {
  if (admin) return "full";
  return ((ent && ent.gate_keys) || []).some((k) => APP_ACCESS_KEYS.includes(k)) ? "full" : "contract";
}
export function memberWaiting(ent) {
  return !!(ent && (ent.member || ((ent.gate_keys) || []).some((k) => MEMBER_KEYS.includes(k))));
}
export const PUBLISH_APPS = [
  { target: "x-koryaku", name: "X攻略くん" },
  { target: "note-koryaku", name: "note攻略くん" },
  { target: "swipe-file", name: "スワイプくん" },
  { target: "mindmap", name: "思考整理くん" }, // 2026-10-27 23:57 関門 1〜7 が全部 ○（Naoki「全部OK」）
  { target: "content-os", name: "コンテンツくん" }, // 2026-10-28 08:32 関門 1〜7 が全部 ○（Naoki「全部OK」）
];
const KEY_RE = /^[a-z0-9_]{2,60}$/;
const REASON_MAX = 200;

// 期限の入力を確かめる。日付だけ（2026-11-15）なら日本時間のその日の終わり。空なら期限なし。過去は受けない
export function parseUntil(v, now = Date.now()) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, value: null };
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + "T23:59:59+09:00");
  else d = new Date(s);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "bad_expires_at" };
  if (d.getTime() <= now) return { ok: false, error: "expires_in_past" };
  return { ok: true, value: d.toISOString() };
}

// 付ける前の確かめ（表に書く前に全部ここで止める）
export function checkGrant({ key, reason, expires_at } = {}, allowed, existing, now = Date.now()) {
  const k = String(key ?? "").trim();
  if (!KEY_RE.test(k)) return { ok: false, error: "bad_key" };
  if (!allowed.includes(k)) return { ok: false, error: "unknown_key", allowed };
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, error: "reason_required" };
  if (why.length > REASON_MAX) return { ok: false, error: "reason_too_long", max: REASON_MAX };
  const u = parseUntil(expires_at, now);
  if (!u.ok) return u;
  if (EXPIRY_REQUIRED.includes(k) && !u.value) return { ok: false, error: "expires_required" };
  if (existing.some((r) => r.key === k && r.source === "manual")) return { ok: false, error: "already_manual" };
  return { ok: true, row: { key: k, source: "manual", reason: why, expires_at: u.value } };
}

const live = (r, now = Date.now()) => !r.expires_at || new Date(r.expires_at).getTime() > now;

// 出来事から計算した B の権利（sell.entitlement の返り）から、門番の表に置くべき行を出す。key ごとに一番遅い期限（無期限が勝つ）
export function desiredGrants(ent) {
  const out = new Map();
  for (const it of (ent && ent.items) || []) {
    if (it.status !== "active") continue;
    for (const key of it.grants || []) {
      const until = it.until || null;
      if (!out.has(key)) out.set(key, { key, expires_at: until, product_id: it.product_id });
      else {
        const cur = out.get(key);
        if (cur.expires_at && (!until || new Date(until) > new Date(cur.expires_at))) out.set(key, { key, expires_at: until, product_id: it.product_id });
      }
    }
  }
  return [...out.values()];
}

// いまの行と、置くべき行の差。B が書いた行（reason が B で購入…）だけを外す・直す対象にする
export function planGrants(existing, desired) {
  const mine = existing.filter((r) => r.source === "payment" && String(r.reason || "").startsWith(B_REASON));
  const others = existing.filter((r) => !mine.includes(r));
  const insert = [], update = [], remove = [];
  for (const d of desired) {
    const m = mine.find((r) => r.key === d.key);
    if (m) {
      if ((m.expires_at || null) !== (d.expires_at || null) && !(m.expires_at && d.expires_at && new Date(m.expires_at).getTime() === new Date(d.expires_at).getTime())) update.push({ id: m.id, expires_at: d.expires_at });
      continue;
    }
    // shr-webhook などが同じ key の payment の行をもう付けているなら足さない（2 本作らない）
    if (others.some((r) => r.key === d.key && r.source === "payment" && live(r))) continue;
    insert.push({ key: d.key, source: "payment", reason: `${B_REASON}（${d.product_id}）`, expires_at: d.expires_at });
  }
  for (const m of mine) if (!desired.some((d) => d.key === m.key)) remove.push(m.id);
  return { insert, update, remove };
}

// 行のどこかに、その人の番号・旧の番号・メールのどれかがそのまま入っているか
export function rowMatches(row, needles) {
  const set = new Set(needles.filter(Boolean).map((s) => String(s).toLowerCase()));
  if (!set.size) return false;
  const walk = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "object") return Object.values(v).some(walk);
    return set.has(String(v).trim().toLowerCase());
  };
  return walk(row);
}

export function makeBridge(h) {
  const { db, rawDb, addEvent } = h;
  let catalogCache = null;

  async function gateRows(env, memberId) {
    return await db(env, "GET", `member_entitlement?select=id,key,source,reason,expires_at&member_id=eq.${memberId}`);
  }

  // 門番の表の権利を、B の権利の返りに足す（会員かどうかはここで決まる）
  async function withGate(env, customerId, ent) {
    const rows = (await gateRows(env, customerId)).filter((r) => live(r));
    const keys = [...new Set(rows.map((r) => r.key))];
    const gateMember = keys.some((k) => MEMBER_KEYS.includes(k));
    const out = { ...ent, gate_keys: keys };
    if (gateMember && !ent.member) {
      out.member = true;
      out.status = "active";
      out.plan = out.plan || "しあらぼ会員";
      out.via_gate = true;
    }
    out.grants = [...new Set([...(ent.grants || []), ...keys])];
    return out;
  }

  // 一覧用：門番の表で会員の人の番号の集まり
  async function gateMembers(env) {
    const rows = await db(env, "GET", `member_entitlement?select=member_id,expires_at&key=in.(${MEMBER_KEYS.join(",")})&limit=10000`);
    return new Set(rows.filter((r) => live(r)).map((r) => r.member_id));
  }

  // B で買った権利の印を門番の表へ合わせる。何度呼んでも同じ結果。失敗しても決済の記録は止めない
  async function syncGrants(env, customerId, ent) {
    try {
      const existing = await gateRows(env, customerId);
      const plan = planGrants(existing, desiredGrants(ent));
      for (const r of plan.insert) await db(env, "POST", "member_entitlement", [{ member_id: customerId, ...r }], "return=minimal");
      for (const u of plan.update) await db(env, "PATCH", `member_entitlement?id=eq.${u.id}`, { expires_at: u.expires_at }, "return=minimal");
      for (const id of plan.remove) await db(env, "DELETE", `member_entitlement?id=eq.${id}`, undefined, "return=minimal");
      const changed = plan.insert.length + plan.update.length + plan.remove.length;
      if (changed) {
        await addEvent(env, customerId, "grants_synced", {
          added: plan.insert.map((r) => r.key), updated: plan.update.length, removed: plan.remove.length,
        }, "site");
      }
      return { ok: true, added: plan.insert.length, updated: plan.update.length, removed: plan.remove.length };
    } catch (e) {
      return { ok: false, error: "grant_sync_failed", detail: String(e.message || e).slice(0, 200) };
    }
  }

  // Supabase の表の目録（/rest/v1/ の定義）。欄の名前を決め打ちしないための元
  async function catalog(env) {
    if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.defs;
    const spec = await rawDb(env, "GET", "");
    const defs = (spec && spec.definitions) || {};
    catalogCache = { at: Date.now(), defs };
    return defs;
  }

  async function countRows(env, table) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: { ...h.secretHeaders(env), prefer: "count=exact" } });
    if (!res.ok) return null;
    const cr = res.headers.get("content-range") || "";
    const n = Number(cr.split("/")[1]);
    return Number.isFinite(n) ? n : null;
  }

  // AI の道具：決めた頭の名前の表の、欄の名前と行数（中身は返さない）
  async function listTables(env, { prefix } = {}) {
    const want = String(prefix || "");
    if (want && !TABLE_PREFIXES.some((p) => want.startsWith(p))) return { ok: false, error: "prefix_not_allowed", allowed: TABLE_PREFIXES };
    const defs = await catalog(env);
    const names = Object.keys(defs).filter((n) => (want ? n.startsWith(want) : TABLE_PREFIXES.some((p) => n.startsWith(p)))).sort();
    const tables = [];
    for (const n of names) {
      const props = (defs[n] && defs[n].properties) || {};
      tables.push({ name: n, columns: Object.keys(props), rows: await countRows(env, n) });
    }
    return { ok: true, count: tables.length, tables };
  }

  // 1 人分の面談の記録（consult-manager の ic_ の表から、その人の番号・旧の番号・メールが入っている行）
  async function meetings(env, { person_id } = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const [m] = await db(env, "GET", `member?select=id,email,legacy_shr_id&id=eq.${person_id}`);
    if (!m) return { ok: true, found: false };
    const defs = await catalog(env);
    const tables = Object.keys(defs).filter((n) => n.startsWith(MEETING_PREFIX) && !MEETING_SKIP.has(n)).sort();
    const records = [];
    const looked = [];
    for (const t of tables) {
      const rows = await db(env, "GET", `${t}?select=*&limit=${MEETING_ROWS_MAX}`);
      looked.push({ table: t, rows: rows.length });
      for (const r of rows) if (rowMatches(r, [m.id, m.legacy_shr_id, m.email])) records.push({ table: t, row: r });
    }
    return { ok: true, found: true, count: records.length, looked, records };
  }

  // ---------- マーケくん便 2：権利の一覧と手での付け外し ----------
  const ENT_COLS = "id,member_id,key,source,reason,granted_at,expires_at";

  // 付けられる権利の名前：決めた 6 つだけ（2026-10-29）
  async function entitlementKeys(env) {
    return { ok: true, keys: [...KNOWN_KEYS] };
  }

  // 一覧用：全員の権利の行（人の番号ごと）。期限切れも返し、画面で見分ける
  async function gateAll(env) {
    const rows = await db(env, "GET", `member_entitlement?select=${ENT_COLS}&order=granted_at.asc&limit=10000`);
    const out = {};
    for (const r of rows) (out[r.member_id] = out[r.member_id] || []).push(r);
    return out;
  }

  // 1 人分の権利の行（詳細の「権利」のタブ）
  async function gateFull(env, memberId) {
    return await db(env, "GET", `member_entitlement?select=${ENT_COLS}&member_id=eq.${memberId}&order=granted_at.asc`);
  }

  async function grantManual(env, { person_id, key, reason, expires_at } = {}, actor = "admin") {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const [m] = await db(env, "GET", `member?select=id&id=eq.${person_id}`);
    if (!m) return { ok: true, found: false };
    const existing = await gateFull(env, person_id);
    const c = checkGrant({ key, reason, expires_at }, (await entitlementKeys(env)).keys, existing);
    if (!c.ok) return c;
    const [row] = await db(env, "POST", "member_entitlement", [{ member_id: person_id, ...c.row }], "return=representation");
    await addEvent(env, person_id, "entitlement_granted", { key: c.row.key, reason: c.row.reason, expires_at: c.row.expires_at, entitlement_id: row && row.id }, actor);
    return { ok: true, found: true, entitlement: row || null, entitlements: await gateFull(env, person_id) };
  }

  async function revokeManual(env, { person_id, entitlement_id, reason } = {}, actor = "admin") {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    if (!/^[0-9a-z-]{1,40}$/i.test(String(entitlement_id ?? ""))) return { ok: false, error: "bad_entitlement_id" };
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, error: "reason_required" };
    if (why.length > REASON_MAX) return { ok: false, error: "reason_too_long", max: REASON_MAX };
    const [r] = await db(env, "GET", `member_entitlement?select=${ENT_COLS}&id=eq.${entitlement_id}&member_id=eq.${person_id}`);
    if (!r) return { ok: true, found: false };
    if (r.source !== "manual") return { ok: false, error: "not_manual" };
    await db(env, "DELETE", `member_entitlement?id=eq.${r.id}&member_id=eq.${person_id}&source=eq.manual`, undefined, "return=minimal");
    await addEvent(env, person_id, "entitlement_revoked", { key: r.key, reason: why, granted_reason: r.reason, granted_at: r.granted_at, expires_at: r.expires_at }, actor);
    return { ok: true, found: true, removed: { id: r.id, key: r.key }, entitlements: await gateFull(env, person_id) };
  }

  // ---------- マーケくん便 5：アプリの公開スイッチ ----------
  // 画面に出す形：関門を通ったアプリごとに、先行で試すがオンか・ほかに開いている権利（見るだけ）・その権利を持つ人数
  async function accessList(env, { key } = {}) {
    const k = key == null || key === "" ? PILOT_KEY : String(key);
    if (!SWITCH_KEYS.includes(k)) return { ok: false, error: "unknown_key" };
    const targets = PUBLISH_APPS.map((a) => a.target);
    const rows = await db(env, "GET", `member_access?select=entitlement_key,target,created_at&target=in.(${targets.join(",")})&limit=1000`);
    const now = Date.now();
    const holders = (await db(env, "GET", `member_entitlement?select=member_id,expires_at&key=eq.${k}&limit=10000`)).filter((r) => live(r, now));
    const apps = PUBLISH_APPS.map((a) => {
      const mine = rows.filter((r) => r.target === a.target);
      const hit = mine.find((r) => r.entitlement_key === k);
      return {
        target: a.target, name: a.name,
        on: !!hit, since: hit ? hit.created_at || null : null,
        others: mine.filter((r) => r.entitlement_key !== k).map((r) => r.entitlement_key).sort(),
      };
    });
    return { ok: true, key: k, keys: [...SWITCH_KEYS], holders: new Set(holders.map((r) => r.member_id)).size, apps };
  }

  async function setAccess(env, { target, on, key } = {}) {
    const k = key == null || key === "" ? PILOT_KEY : String(key);
    if (!SWITCH_KEYS.includes(k)) return { ok: false, error: "unknown_key" };
    const app = PUBLISH_APPS.find((a) => a.target === String(target ?? ""));
    if (!app) return { ok: false, error: "unknown_app" };
    if (typeof on !== "boolean") return { ok: false, error: "bad_on" };
    const where = `entitlement_key=eq.${k}&target=eq.${app.target}`;
    const [have] = await db(env, "GET", `member_access?select=entitlement_key&${where}`);
    if (on && !have) await db(env, "POST", "member_access", [{ entitlement_key: k, target: app.target }], "return=minimal");
    if (!on && have) await db(env, "DELETE", `member_access?${where}`, undefined, "return=minimal");
    const [after] = await db(env, "GET", `member_access?select=entitlement_key&${where}`);
    if (!!after !== on) return { ok: false, error: "not_applied" };
    return { ok: true, changed: !!have !== on, ...(await accessList(env, { key: k })) };
  }

  return { withGate, gateMembers, syncGrants, listTables, meetings, entitlementKeys, gateAll, gateFull, grantManual, revokeManual, accessList, setAccess };
}

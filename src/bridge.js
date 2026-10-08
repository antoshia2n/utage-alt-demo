// B の便 6b：寄せる（裏側）。
//  ・権利：会員かどうかの正本は門番の権利の表（member_entitlement）。shr-webhook が本番の会員の支払いから
//    shiarabo_basic を付けている（2026-10-08 に 24 人）。B はこれを読み、B で買った商品の権利の印（grants）も同じ表へ書く。
//    表の決まり：source は payment か manual。B が書く行は source=payment・reason が「B で購入」で始まる。
//    同じ key の payment の行がもうある人（shr-webhook が付けた人）には足さない。外すときは B が書いた行だけを外す。
//  ・決済の受け口そのもの（UnivaPay の知らせの宛先）は動かさない。付け替えは便 7b（10/19・10/21 の本番の課金を見てから）。
//  ・面談の記録：consult-manager の表（ic_）の欄は開発部から読めないので、決め打ちしない。
//    表の一覧と欄は Supabase の表の目録（/rest/v1/ の定義）から取り、1 人分は「行のどこかにその人の番号かメールが入っている行」で拾う。
//  ・表の目録を読む道具（list_tables）：決めた頭の名前の表だけ、欄の名前と行数を返す（中身は返さない）。

export const MEMBER_KEYS = ["shiarabo_basic"];
export const B_REASON = "B で購入";
const TABLE_PREFIXES = ["ic_", "mn_tensaku_", "member", "shr_billing_logs", "b_"];
const MEETING_PREFIX = "ic_";
const MEETING_SKIP = new Set(["ic_status_logs"]); // 動きの記録（控えでも外している履歴の表）
const MEETING_ROWS_MAX = 2000;

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
    if (!env.B_STORE) return ent;
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
    if (!env.B_STORE) return new Set();
    const rows = await db(env, "GET", `member_entitlement?select=member_id,expires_at&key=in.(${MEMBER_KEYS.join(",")})&limit=10000`);
    return new Set(rows.filter((r) => live(r)).map((r) => r.member_id));
  }

  // B で買った権利の印を門番の表へ合わせる。何度呼んでも同じ結果。失敗しても決済の記録は止めない
  async function syncGrants(env, customerId, ent) {
    if (!env.B_STORE) return { ok: true, skipped: "demo_store" };
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
    if (!env.B_STORE) return { ok: true, store: "demo", tables: [] };
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
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, records: [] };
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

  return { withGate, gateMembers, syncGrants, listTables, meetings };
}

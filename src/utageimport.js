// B の便 16a：UTAGE の読者と個別相談の予約者を、B の台帳へ流しっぱなしで取り込む（2026-10-10 Naoki「進めて」）。
//   読者：UTAGE の REST を、アカウントごとに 100 件ずつ全ページ読む。読み口は shia2n-mcp の UtageReader（サービスの結び env.UTAGE・
//     鍵は shia2n-mcp がすでに持っているので B に増やさない）。結びが無いときだけ Cloudflare の秘密の値 UTAGE_API_KEY で直接読む。
//     読む順はシナリオごとで新しい順ではないので、どこまで読んだか（しおり）を表 b_settings の 1 行（key=utage_import_cursor）に置き、
//     毎時の処理で PAGES_PER_RUN ページずつ進める。最後まで読んだら頭に戻る（1 周で全員を見直す）。
//   予約者：shia2n-mcp が毎朝 consult-manager の表 ic_persons に入れている UTAGE の予約者（source=UTAGE）を読む（UTAGE の鍵を増やさないため）。
// 台帳へ：メールで突き合わせ、いなければ関数 b_register で入れる（流入元は other）。1 回に新しく入れるのは NEW_PER_RUN 人まで。
//   出来事は「登録した（registered）」ではなく utage_imported（アカウントごとに 1 人 1 回）。登録のきっかけの自動の動きは動かない。
//   予約者は consult_booked（via utage・日時の枠 slot は持たない＝空き時間をふさがず、前日の知らせも出ない）を 1 人 1 回。
//     出来事の時刻は UTAGE で予約した元の日（ic_persons.first_date の 0 時・日本時間）。取り込んだ時刻で積むと、先週 7 日で数える
//     設計図の線・段階のボード・ホームの個別相談が膨らむため（便 16a の 2・2026-10-10 統括の確かめ）。前に今日の時刻で積んだ分も、毎回付け直す。
//   UTAGE で配信停止かメールエラーの読者は、B でも email_unsubscribed（via utage）を積み、B から一斉配信もステップも届かない。
// 表と SQL は増やさない。メールの無い読者（LINE だけ）は数えるだけで入れない。UTAGE には書き込まない。

export const CURSOR_KEY = "utage_import_cursor";
export const PER_PAGE = 100;
export const PAGES_PER_RUN = 10;
export const NEW_PER_RUN = 80;
const EMAIL_RE = /^[^\s@,"()]+@[^\s@,"()]+\.[^\s@,"()]+$/;
const ACTOR = "webhook"; // 外のしくみから来たもの（b_events の actor の決まりの中）

export function readerEmail(r) {
  const pick = (o) => (o && typeof o.mail === "string" ? o.mail : null);
  const m = (typeof r.mail === "string" && r.mail) || pick(r.scenario_fields) || pick(r.common_fields) || "";
  const e = String(m).trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}
export function readerName(r) {
  const f = { ...(r.common_fields || {}), ...(r.scenario_fields || {}) };
  const t = (v) => (typeof v === "string" ? v.trim() : "");
  const n = t(f.name) || [t(f.sei), t(f.mei)].filter(Boolean).join(" ");
  return n.slice(0, 60);
}
// UTAGE の日時（日本時間・"2026-08-28 04:53:01"）を ISO に
export function utageTime(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}+09:00`).toISOString() : null;
}
const inList = (vals) => "(" + vals.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",") + ")";

export function makeUtageImport(h) {
  const { db, addEvent, logInbound, register } = h;
  const fx = (...a) => (h.fetch || fetch)(...a);

  async function getCursor(env) {
    const rows = await db(env, "GET", `settings?select=value,updated_at&key=eq.${CURSOR_KEY}`);
    try { const v = JSON.parse(rows.length ? rows[0].value : "{}"); return { a: v.a | 0, p: Math.max(v.p | 0, 1), sweep: v.sweep | 0, last_sweep_at: v.last_sweep_at || null }; }
    catch (_) { return { a: 0, p: 1, sweep: 0, last_sweep_at: null }; }
  }
  async function putCursor(env, c) {
    await db(env, "POST", "settings?on_conflict=key", [{ key: CURSOR_KEY, value: JSON.stringify(c).slice(0, 500), updated_at: new Date().toISOString(), updated_by: "utage_import" }], "resolution=merge-duplicates,return=minimal");
  }

  const hasBinding = (env) => !!(env.UTAGE && typeof env.UTAGE.readers === "function");
  const sourceOf = (env) => (hasBinding(env) ? "binding" : env.UTAGE_API_KEY ? "key" : null);
  async function utage(env, path, query = {}) {
    if (hasBinding(env)) {
      const m = path.match(/^[/]accounts[/]([^/]+)[/]readers$/);
      const r = m ? await env.UTAGE.readers(decodeURIComponent(m[1]), query.page, query.per_page) : await env.UTAGE.accounts();
      if (!r || r.ok === false) throw new Error(`UTAGE ${(r && r.error) || "no_answer"}${r && r.detail ? ": " + String(r.detail).slice(0, 150) : ""}`);
      return r;
    }
    const u = new URL(String(env.UTAGE_API_BASE || "https://api.utage-system.com/v1").replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    const r = await fx(u.toString(), { headers: { Authorization: `Bearer ${env.UTAGE_API_KEY}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`UTAGE ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  }

  // メールの並びから、台帳の人（id）を引く。いなければ新しく入れる（上限つき）。返すのは email → id と、上限に当たったか
  async function ensurePeople(env, people, budget) {
    const emails = [...people.keys()];
    const ids = new Map();
    for (let i = 0; i < emails.length; i += 80) {
      const part = emails.slice(i, i + 80);
      for (const r of await db(env, "GET", `customers?select=id,email&email=in.${encodeURIComponent(inList(part))}`)) ids.set(String(r.email).toLowerCase(), r.id);
    }
    let created = 0;
    for (const e of emails) {
      if (ids.has(e)) continue;
      if (budget.left <= 0) return { ids, created, full: true };
      const r = await register(env, e, people.get(e).name || "");
      ids.set(e, r.id); budget.left--;
      if (r.is_new !== false) created++; // 大文字まじりのメールで先にいた人は b_register が見つけて返す（新しくは数えない）
    }
    return { ids, created, full: false };
  }

  // 1 人 1 回の出来事を、まだ無い人にだけ積む
  async function eventsOnce(env, type, ids, payloadOf, matchKey, matchVal, atOf) {
    if (!ids.length) return 0;
    let q = `events?select=customer_id&type=eq.${type}&customer_id=in.${encodeURIComponent(inList(ids))}`;
    if (matchKey) q += `&payload->>${matchKey}=eq.${encodeURIComponent(matchVal)}`;
    const have = new Set((await db(env, "GET", q)).map((r) => r.customer_id));
    const rows = ids.filter((id) => !have.has(id)).map((id) => {
      const row = { customer_id: id, type, payload: payloadOf(id), actor: ACTOR };
      const at = atOf ? atOf(id) : null;
      if (at) row.occurred_at = at;
      return row;
    });
    if (rows.length) await db(env, "POST", "events", rows, "return=minimal");
    return rows.length;
  }

  // 読者の 1 ページを台帳へ
  async function importPage(env, account, readers, budget, out) {
    const people = new Map();
    for (const r of readers) {
      const e = readerEmail(r);
      if (!e) { out.no_email++; continue; }
      const at = utageTime(r.created_at);
      const p = people.get(e) || { name: "", at, blocked: false, scenarios: new Set(), tracking: new Set(), reader: r.common_reader_id || null };
      if (!p.name) p.name = readerName(r);
      if (at && (!p.at || at < p.at)) p.at = at;
      if (r.is_blocked || r.is_mail_error) p.blocked = true;
      if (r.scenario_title) p.scenarios.add(String(r.scenario_title).slice(0, 60));
      for (const t of [r.funnel_tracking_name, r.message_tracking_name]) if (t) p.tracking.add(String(t).slice(0, 60));
      people.set(e, p);
    }
    const { ids, created, full } = await ensurePeople(env, people, budget);
    out.created += created;
    if (full) return false; // このページは次の回にやり直す（入れ終えた人は次の回に「もういる」になる）
    const byId = new Map([...people].map(([e, p]) => [ids.get(e), p]));
    const all = [...byId.keys()];
    out.imported += await eventsOnce(env, "utage_imported", all, (id) => {
      const p = byId.get(id);
      return { via: "utage", account: account.id, account_name: account.name, reader: p.reader, utage_at: p.at, scenarios: [...p.scenarios].slice(0, 10), tracking: [...p.tracking].slice(0, 5) };
    }, "account", account.id);
    const blocked = all.filter((id) => byId.get(id).blocked);
    out.unsubscribed += await eventsOnce(env, "email_unsubscribed", blocked, () => ({ via: "utage" }));
    out.readers += readers.length;
    return true;
  }

  // 予約者（ic_persons の source=UTAGE）を台帳へ
  async function importConsults(env, budget, out) {
    const rows = await db(env, "GET", "ic_persons?select=id,name,email,first_date,source&source=eq.UTAGE&limit=2000");
    const people = new Map();
    for (const r of rows) {
      const e = EMAIL_RE.test(String(r.email || "").trim().toLowerCase()) ? String(r.email).trim().toLowerCase() : null;
      if (!e) { out.consult_no_email++; continue; }
      people.set(e, { name: String(r.name || "").slice(0, 60), ic: r.id, date: r.first_date || null });
    }
    const { ids, created, full } = await ensurePeople(env, people, budget);
    out.created += created;
    if (full) { out.consult_waiting = true; return; }
    const byId = new Map([...people].map(([e, p]) => [ids.get(e), p]));
    const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? new Date(`${d}T00:00:00+09:00`).toISOString() : null);
    out.consults += await eventsOnce(env, "consult_booked", [...byId.keys()], (id) => {
      const p = byId.get(id);
      return { via: "utage", ic_person_id: p.ic, date: p.date, utage_at: dayOf(p.date) };
    }, "via", "utage", (id) => dayOf(byId.get(id).date));
    out.consult_restamped = await restampConsults(env);
  }

  // 前に取り込んだ時刻で積んだ予約を、予約した元の日へ付け直す（何度流しても同じ）
  async function restampConsults(env) {
    const rows = await db(env, "GET", "events?select=id,occurred_at,payload&type=eq.consult_booked&payload->>via=eq.utage&limit=5000");
    let n = 0;
    for (const r of rows || []) {
      const at = r.payload && r.payload.utage_at;
      if (!at || Date.parse(at) === Date.parse(r.occurred_at)) continue;
      await db(env, "PATCH", `events?id=eq.${Number(r.id)}`, { occurred_at: at }, "return=minimal");
      n++;
    }
    return n;
  }

  async function run(env) {
    const out = { ok: true, readers: 0, pages: 0, created: 0, imported: 0, unsubscribed: 0, no_email: 0, consults: 0, consult_no_email: 0, consult_waiting: false, consult_restamped: 0, sweep_done: false };
    if (!env.B_STORE) return { ok: true, skipped: "demo_store" };
    if (!sourceOf(env)) return { ok: true, skipped: "no_source" };
    const budget = { left: NEW_PER_RUN };
    try {
      const accounts = ((await utage(env, "/accounts")).data || []).map((a) => ({ id: a.id, name: a.name })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const c = await getCursor(env);
      if (c.a >= accounts.length) { c.a = 0; c.p = 1; }
      for (let n = 0; n < PAGES_PER_RUN && accounts.length; n++) {
        const acc = accounts[c.a];
        const res = await utage(env, `/accounts/${encodeURIComponent(acc.id)}/readers`, { per_page: PER_PAGE, page: c.p });
        const data = res.data || [];
        const total = res.meta && typeof res.meta.total === "number" ? res.meta.total : null;
        if (data.length && !(await importPage(env, acc, data, budget, out))) { out.stopped = "new_limit"; break; }
        out.pages++;
        const last = data.length < PER_PAGE || (total !== null && c.p * PER_PAGE >= total);
        if (!last) { c.p++; continue; }
        c.a++; c.p = 1;
        if (c.a >= accounts.length) { c.a = 0; c.sweep++; c.last_sweep_at = new Date().toISOString(); out.sweep_done = true; break; }
      }
      await putCursor(env, c);
      out.cursor = c;
      await importConsults(env, budget, out);
    } catch (e) {
      out.ok = false; out.error = String(e && e.message || e).slice(0, 300);
    }
    await logInbound(env, "utage_import", { run: new Date().toISOString() }, out, out.ok ? 200 : 500);
    return out;
  }

  // AI の道具：取り込みの様子（しおり・直近の回・取り込んだ人の数）
  async function status(env) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const [c, runs, imported, unsub, consults] = await Promise.all([
      getCursor(env),
      db(env, "GET", "inbound_log?select=at,status,response&channel=eq.utage_import&order=id.desc&limit=10"),
      db(env, "GET", "events?select=customer_id,payload&type=eq.utage_imported&limit=50000"),
      db(env, "GET", "events?select=customer_id,payload&type=eq.email_unsubscribed&payload->>via=eq.utage&limit=50000"),
      db(env, "GET", "events?select=customer_id&type=eq.consult_booked&payload->>via=eq.utage&limit=50000"),
    ]);
    const byAcc = {};
    for (const e of imported) { const k = (e.payload && e.payload.account_name) || "?"; byAcc[k] = byAcc[k] || new Set(); byAcc[k].add(e.customer_id); }
    return {
      ok: true, source: sourceOf(env), cursor: c,
      people: new Set(imported.map((e) => e.customer_id)).size,
      by_account: Object.fromEntries(Object.entries(byAcc).map(([k, s]) => [k, s.size])),
      unsubscribed_from_utage: new Set(unsub.map((e) => e.customer_id)).size,
      consults_from_utage: new Set(consults.map((e) => e.customer_id)).size,
      last_runs: runs.map((r) => ({ at: r.at, ok: r.status === 200, ...(r.response || {}) })),
    };
  }

  return { run, status, getCursor };
}

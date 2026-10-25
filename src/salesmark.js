// 決済受け口 便 1（2026-10-25 開発部）：今の定期 3 件の引き継ぎと、課金が通った月を売上管理で入金済みにする。
// 依頼：https://app.notion.com/p/4049c6c1c439812595c5d1f0975e6dcb（Naoki「OK」：3 件の結び・止まった 4 件は引き継がない）
//
//  ・引き継ぎ（takeover）：shr-webhook が受けてきた本番の定期を、B の出来事 subscription_started として 1 件ずつ積む。
//    B の UnivaPay の鍵はまだ試しの鍵なので、UnivaPay には聞き直せない。代わりに決済の記録（shr_billing_logs）に
//    その定期の入金があり、その会員のものであるときだけ積む（記録に無い・ほかの人の番号なら断る）。
//    始まりの時刻は記録の最後の入金の時刻にする（次の課金の時刻と権利の期限を正しく出すため）。
//    payload に売上管理の契約の番号 sales_contract_id を持たせる（会員と売上管理の契約は名前でしか結べないため、Naoki の確かめた結びを持つ）
//  ・入金済みにする（markMonth）：結びのある定期の入金を、課金の日（日本時間）の月の契約の行として、shia2n-mcp の口
//    SalesWriter（サービスの結び env.SALES）から売上管理へ書く。書き方は売上管理の画面と同じ（shia2n-mcp が sales-manager の入口を呼ぶ）。
//    同じ定期の同じ月は 1 回だけ（出来事 sales_marked で見る）。売上管理で入金済みのときは書かずに記録だけ残す。
//    結びが無い・断られた・書けなかったときは Naoki のスマホへ知らせる（入金が売上に入らないまま埋もれないため）
//  ・UnivaPay の知らせの宛先は変えない（便 2）。権利（門番の表）は shr-webhook が付けた行があるので、B は 2 本目を足さない（bridge.js の決まりのまま）

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NL = String.fromCharCode(10);

// 日本時間の日付（YYYY-MM-DD）
export function jstDay(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
}

// 決済の記録の行から、その定期の最後の入金を選ぶ（その会員の subscription_payment か、始まりの charge_finished）
export function lastPaymentOf(rows, subscriptionId, customerId) {
  const mine = (rows || []).filter((r) => r && r.univa_charge_id === subscriptionId && r.event_type === "subscription_payment");
  if (!mine.length) return { ok: false, error: "not_in_billing_logs" };
  const owners = [...new Set(mine.map((r) => r.member_new_id).filter(Boolean))];
  if (owners.length !== 1 || owners[0] !== customerId) return { ok: false, error: "owner_mismatch", owners };
  const last = mine.reduce((a, b) => (String(b.created_at) > String(a.created_at) ? b : a));
  return { ok: true, at: last.created_at, amount: Number(last.amount), count: mine.length };
}

export function makeSalesMark(h) {
  const { db, logInbound } = h;

  async function startedOf(env, subscriptionId) {
    const rows = await db(env, "GET", `events?select=id,customer_id,payload,occurred_at&type=eq.subscription_started&payload->>subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`);
    return rows[0] || null;
  }

  async function tell(env, title, body) {
    if (!h.notify) return null;
    try { return await h.notify(env, { title, body, url: "/admin", tag: "sales" }); } catch (_) { return { ok: false, error: "notify_failed" }; }
  }

  // 課金が通った月を売上管理で入金済みにする。at は課金の時刻（受け取った時刻）、amount は入った額
  async function markMonth(env, customerId, subscriptionId, { at, amount } = {}, via = "webhook") {
    if (!env.B_STORE) return { ok: true, skipped: "demo_store" };
    const st = await startedOf(env, subscriptionId);
    const p = (st && st.payload) || {};
    const day = jstDay(at);
    if (!day) return { ok: false, error: "bad_time" };
    const ym = day.slice(0, 7);
    const amt = Number.isInteger(Number(amount)) && Number(amount) > 0 ? Number(amount) : Number(p.amount);
    const contract = p.sales_contract_id != null && p.sales_contract_id !== "" ? String(p.sales_contract_id) : null;
    const base = { subscription_id: subscriptionId, year_month: ym, paid_date: day, amount: amt, contract_id: contract, via };
    if (!contract) {
      await h.addEvent(env, customerId, "sales_marked", { ...base, result: "no_link" }, "webhook");
      const t = await tell(env, "定期の入金：売上管理に結ぶ契約が無い", `${day} に ${amt.toLocaleString()} 円の定期の入金がありました。売上管理の契約と結んでいないため、入金済みにしていません。${NL}定期の番号 ${subscriptionId.slice(0, 8)}…`);
      return { ok: true, marked: false, reason: "no_link", notified: !!(t && t.ok) };
    }
    const done = await db(env, "GET", `events?select=id,payload&type=eq.sales_marked&payload->>subscription_id=eq.${encodeURIComponent(subscriptionId)}&payload->>year_month=eq.${ym}&limit=20`);
    if (done.some((e) => e.payload && ["created", "updated", "already_paid"].includes(e.payload.result))) return { ok: true, marked: false, reason: "already_marked", year_month: ym };
    if (!env.SALES || typeof env.SALES.markPaid !== "function") {
      await h.addEvent(env, customerId, "sales_marked", { ...base, result: "no_binding" }, "webhook");
      await tell(env, "定期の入金：売上管理へ書けなかった", `${day} の ${amt.toLocaleString()} 円（契約 ${contract}・${ym}）を入金済みにできませんでした（売上管理への口が無い）。売上管理で手で入金済みにしてください。`);
      return { ok: false, error: "no_binding" };
    }
    let r;
    try { r = await env.SALES.markPaid({ contract_id: contract, year_month: ym, paid_date: day, actual_amount: amt }); }
    catch (e) { r = { ok: false, error: "call_failed", detail: String((e && e.message) || e).slice(0, 200) }; }
    const result = r && r.ok ? String((r.body && r.body.action) || "updated") : String((r && r.error) || "failed");
    await h.addEvent(env, customerId, "sales_marked", { ...base, result }, "webhook");
    if (logInbound) await logInbound(env, "sales_mark", base, { ok: !!(r && r.ok), result, status: r && r.status }, r && r.ok ? 200 : (r && r.status) || 500);
    if (r && r.ok) return { ok: true, marked: true, action: result, year_month: ym, contract_id: contract };
    if (result === "already_paid") return { ok: true, marked: false, reason: "already_paid", year_month: ym, contract_id: contract };
    await tell(env, "定期の入金：売上管理へ書けなかった", `${day} の ${amt.toLocaleString()} 円（契約 ${contract}・${ym}）を入金済みにできませんでした（${result}）。売上管理で確かめてください。`);
    return { ok: false, error: result, year_month: ym, contract_id: contract };
  }

  // 今の定期を引き継ぐ（承認の道具 takeover_subscriptions）。items: [{ subscription_id, customer_id, product_id, sales_contract_id }]
  async function takeover(env, { items } = {}, by = "mcp") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const list = Array.isArray(items) ? items : [];
    if (!list.length || list.length > 10) return { ok: false, error: "need_items", max: 10 };
    const products = Object.fromEntries((await db(env, "GET", "b_products?select=id,kind,period,amount,grants")).map((x) => [x.id, x]));
    const out = [];
    for (const it of list) {
      const sid = String((it && it.subscription_id) || "").trim();
      const cid = String((it && it.customer_id) || "").trim();
      const pid = String((it && it.product_id) || "").trim();
      const contract = String((it && it.sales_contract_id) ?? "").trim();
      const row = { subscription_id: sid, customer_id: cid, product_id: pid, sales_contract_id: contract || null };
      if (!UUID_RE.test(sid) || !UUID_RE.test(cid)) { out.push({ ...row, ok: false, error: "bad_id" }); continue; }
      if (contract && !/^\d{1,9}$/.test(contract)) { out.push({ ...row, ok: false, error: "bad_contract_id" }); continue; }
      const prod = products[pid];
      if (!prod || prod.kind !== "subscription") { out.push({ ...row, ok: false, error: "not_subscription_product" }); continue; }
      const [person] = await db(env, "GET", `customers?select=id,name&id=eq.${cid}`);
      if (!person) { out.push({ ...row, ok: false, error: "no_customer" }); continue; }
      const already = await startedOf(env, sid);
      if (already) { out.push({ ...row, ok: already.customer_id === cid, error: already.customer_id === cid ? undefined : "subscription_taken", already: true }); continue; }
      const logs = await db(env, "GET", `shr_billing_logs?select=member_new_id,event_type,amount,univa_charge_id,created_at&univa_charge_id=eq.${sid}&limit=200`);
      const last = lastPaymentOf(logs, sid, cid);
      if (!last.ok) { out.push({ ...row, ok: false, error: last.error }); continue; }
      if (last.amount !== Number(prod.amount)) { out.push({ ...row, ok: false, error: "amount_mismatch", billed: last.amount, product_amount: prod.amount }); continue; }
      await db(env, "POST", "events", [{
        customer_id: cid, type: "subscription_started", actor: "mcp", occurred_at: last.at,
        payload: { subscription_id: sid, status: "current", amount: last.amount, currency: "jpy", period: prod.period || "monthly", product_id: pid, mode: "live", via: "takeover", sales_contract_id: contract || null, takeover_by: String(by).slice(0, 120), takeover_at: new Date().toISOString(), billing_log_rows: last.count },
      }], "return=minimal");
      const grants = h.syncGrants ? await h.syncGrants(env, cid) : null;
      // 最後の入金の月を、いま売上管理で入金済みにする（引き継ぐ前の分も、結びの確かめとして 1 回通す）
      const sales = contract ? await markMonth(env, cid, sid, { at: last.at, amount: last.amount }, "takeover") : { ok: true, marked: false, reason: "no_link" };
      out.push({ ...row, ok: true, name: person.name || "", last_paid_at: last.at, billing_log_rows: last.count, grants, sales });
    }
    const ok = out.every((x) => x.ok);
    if (logInbound) await logInbound(env, "takeover", { count: list.length, by }, { ok, results: out.map((x) => ({ subscription_id: x.subscription_id, ok: x.ok, error: x.error || null })) }, ok ? 200 : 207);
    return { ok, count: out.length, results: out };
  }

  return { markMonth, takeover, startedOf };
}

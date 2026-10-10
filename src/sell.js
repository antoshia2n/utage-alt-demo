// B の便 4：売る。商品の台帳（b_products）と、単発・定期・年払い・紹介用の価格の決済。
// 買った記録は表を増やさず、出来事の記録に積む：
//   purchase_completed … 決済が通った（商品・金額・UnivaPay の番号・権利の期限）
//   subscription_started … 定期の商品のときは、これまでどおり定期課金の始まりも積む（2 回目以降の入金と止まった知らせを結ぶため）
// 画面の言うことは信じない：決済の番号を秘密の鍵で UnivaPay に聞き直し、金額・通貨・周期・商品が台帳と合うときだけ積む。
// 同じ決済の番号は 1 回しか積まない（画面の確かめと UnivaPay の知らせの両方から来ても 1 件）。
// デモの置き場（B_STORE が無いとき）には商品の台帳が無いので、便 3 の見本のプラン 1 つだけを商品として見せる。
// 権利（grants）は B の中の印。便 6b から門番の権利の表（member_entitlement）へも書く（中身は src/bridge.js）。
// 会員かどうかは、B で買ったものに加えて門番の表の shiarabo_basic（shr-webhook が付ける本番の会員）でも決まる。
// 便 12c：① カード会社の分割（card_installments の商品だけ、決済の枠をページに埋め込んで回数をお客さんが選ぶ）
//   ② 回数を決めた分割（kind=installment。1 回あたり amount × installments 回。UnivaPay の「回数指定の定期課金」で作り、
//      決めた回数が済むと UnivaPay の側で止まる）③ 継続課金の一覧と解約（UnivaPay の DELETE）④ 課金が失敗した人へのメール

const KINDS = ["one_time", "subscription", "installment"];
const PERIODS = ["monthly", "annually"];
const SUB_ACTIVE = new Set(["subscription_started", "subscription_payment"]);
const SUB_TYPES = ["subscription_started", "subscription_payment", "subscription_failed", "subscription_canceled", "subscription_suspended"];
const ID_RE = /^[a-z0-9-]{2,40}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const NL = String.fromCharCode(10);
const EDITABLE = ["name", "amount", "period", "installments", "grant_days", "grants", "deny_multiple", "sales_limit", "list_price_of", "description", "active", "public", "sort", "note", "affiliate_rate", "thanks_page_slug", "card_installments", "failed_mail_subject", "failed_mail_body"];
// 便 12c：課金が失敗したときのメールの最初の文（商品ごとに直せる）。{{name}}・{{product}}・{{amount}}
export const FAILED_MAIL = {
  subject: "【シアラボ】お支払いが確認できませんでした：{{product}}",
  body: "{{name}} さん\n\n{{product}}（{{amount}}）のお支払いが、カード会社で通りませんでした。\nカードの有効期限やご利用枠をご確認のうえ、このメールにご返信ください。\n\nシアラボ",
};
const isRecurring = (p) => p && (p.kind === "subscription" || p.kind === "installment");

// 便 R3：払った期間の終わり（次の課金の時刻）。最後に入金した時刻に、月払いなら 1 か月・年払いなら 1 年を足す。
// 月末の日（1/31 など）は次の月の末日にそろえる（3/3 へずれない）。決められないときは null
export function paidUntil(lastPaidAt, period) {
  const t = Date.parse(lastPaidAt || "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const months = period === "annually" ? 12 : period === "monthly" || !period ? 1 : 0;
  if (!months) return null;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
// 便 R3：止めたあとも期限まで使えるか（最後が「止めた」で、本人が止めたときの keep_until が今より先）
// 便 R3 の直し：本人が止めた直後に UnivaPay の「止まった」の知らせ（keep_until なし）が続いても、期限は消さない
const keepsUntil = (last, keep, now = Date.now()) => !!(last && last.type === "subscription_canceled" && keep && Date.parse(keep) > now);
const keepOf = (e) => (e && e.type === "subscription_canceled" && e.payload && e.payload.keep_until) || null;

import { isTestPurchase } from "./purchase.js";

export function makeSell(h) {
  const { db, addEvent, bin3 } = h;

  // ---------- 商品の台帳 ----------
  function demoProducts() {
    const p = bin3.PLAN;
    return [{
      id: "demo-monthly", name: p.name, kind: "subscription", amount: p.amount, currency: p.currency, period: p.period,
      installments: null, grant_days: null, grants: [], deny_multiple: true, sales_limit: null, list_price_of: null,
      description: "", active: true, public: true, sort: 1, note: "デモの置き場の見本",
    }];
  }

  async function allProducts(env) {
    if (!env.B_STORE) return demoProducts();
    return await db(env, "GET", "b_products?select=*&order=sort.asc,id.asc");
  }

  async function product(env, id) {
    if (!ID_RE.test(String(id || ""))) return null;
    const list = await allProducts(env);
    return list.find((p) => p.id === id) || null;
  }

  // 生徒に見せる形（UTAGE の番号やメモは出さない）
  function publicShape(p) {
    return {
      id: p.id, name: p.name, kind: p.kind, amount: p.amount, currency: p.currency, period: p.period,
      grant_days: p.grant_days, description: p.description, list_price_of: p.list_price_of,
      installments: p.installments || null, card_installments: !!p.card_installments,
    };
  }

  // サイトの一覧：売っていて、サイトに出すものだけ。id を指定すると、サイトに出していなくても売っていれば返す（紹介用のリンク）
  async function listForSite(env, id) {
    const list = await allProducts(env);
    if (id) {
      const p = list.find((x) => x.id === id && x.active);
      return { ok: true, count: p ? 1 : 0, products: p ? [publicShape(p)] : [] };
    }
    const shown = list.filter((x) => x.active && x.public).map(publicShape);
    return { ok: true, count: shown.length, products: shown };
  }

  async function listProducts(env, { include_inactive = true } = {}) {
    const list = await allProducts(env);
    const sold = await salesCount(env);
    const rows = list.filter((p) => include_inactive === true || include_inactive === "true" || p.active)
      .map((p) => ({ ...p, sold: sold[p.id] || 0 }));
    return { ok: true, store: env.B_STORE ? "production" : "demo", count: rows.length, products: rows };
  }

  // 価格・売る売らない・サイトに出す出さない・権利などを変える。新しい id なら足す。変えた中身は戻せるように前後を返す
  async function setProduct(env, args, by) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const id = String(args.id || "");
    if (!ID_RE.test(id)) return { ok: false, error: "bad_id" };
    const [before] = await db(env, "GET", `b_products?select=*&id=eq.${id}`);
    const patch = {};
    for (const k of EDITABLE) if (k in args) patch[k] = args[k];
    if (!before) {
      if (!KINDS.includes(args.kind)) return { ok: false, error: "need_kind", kinds: KINDS };
      patch.kind = args.kind;
      if (!("name" in patch) || !("amount" in patch)) return { ok: false, error: "need_name_and_amount" };
    }
    const err = checkPatch(patch, before);
    if (err) return { ok: false, error: err };
    // 便 12b：決済のあとに移るページ（サンクス）。ページの台帳にある住所の名前だけ
    if (patch.thanks_page_slug) {
      const [pg] = await db(env, "GET", `b_pages?select=id&slug=eq.${patch.thanks_page_slug}`);
      if (!pg) return { ok: false, error: "thanks_page_not_found" };
    }
    if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
    patch.updated_at = new Date().toISOString();
    patch.updated_by = String(by || "unknown").slice(0, 120);
    let after;
    if (before) [after] = await db(env, "PATCH", `b_products?id=eq.${id}`, patch, "return=representation");
    else [after] = await db(env, "POST", "b_products", [{ id, ...patch }], "return=representation");
    const changed = before ? Object.fromEntries(Object.keys(patch).filter((k) => !["updated_at", "updated_by"].includes(k))
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => [k, { from: before[k], to: after[k] }])) : null;
    return { ok: true, created: !before, id, changed, product: after };
  }

  function checkPatch(p, before) {
    const kind = p.kind || (before && before.kind);
    if ("name" in p) { p.name = String(p.name || "").trim().slice(0, 120); if (!p.name) return "bad_name"; }
    if ("amount" in p) { p.amount = Number(p.amount); if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount > 10000000) return "bad_amount"; }
    if (kind === "subscription") {
      const period = "period" in p ? p.period : before && before.period;
      if (!PERIODS.includes(period)) return "need_period";
      p.period = period;
    } else if ("period" in p && p.period) return "period_only_for_subscription";
    // 便 12c：回数を決めた分割。毎月 1 回、installments 回（2〜60）
    if (kind === "installment") {
      const n = "installments" in p ? Number(p.installments) : before && before.installments;
      if (!Number.isInteger(n) || n < 2 || n > 60) return "need_installments";
      p.installments = n;
    } else if ("installments" in p && p.installments != null) return "installments_only_for_installment";
    if ("card_installments" in p) {
      p.card_installments = p.card_installments === true || p.card_installments === "true";
      if (p.card_installments && kind !== "one_time") return "card_installments_only_for_one_time";
    }
    for (const k of ["failed_mail_subject", "failed_mail_body"]) if (k in p) {
      p[k] = String(p[k] || "").trim() || null;
      if (p[k] && p[k].length > (k.endsWith("subject") ? 200 : 4000)) return "bad_" + k;
    }
    if ("grant_days" in p && p.grant_days !== null) { p.grant_days = Number(p.grant_days); if (!Number.isInteger(p.grant_days) || p.grant_days < 1 || p.grant_days > 3650) return "bad_grant_days"; }
    if ("grants" in p) {
      if (!Array.isArray(p.grants) || p.grants.length > 20 || p.grants.some((g) => !/^[a-z0-9_]{2,60}$/.test(String(g)))) return "bad_grants";
      p.grants = [...new Set(p.grants.map(String))];
    }
    if ("sales_limit" in p && p.sales_limit !== null) { p.sales_limit = Number(p.sales_limit); if (!Number.isInteger(p.sales_limit) || p.sales_limit < 1) return "bad_sales_limit"; }
    if ("list_price_of" in p && p.list_price_of !== null && !ID_RE.test(String(p.list_price_of))) return "bad_list_price_of";
    for (const k of ["deny_multiple", "active", "public"]) if (k in p) p[k] = p[k] === true || p[k] === "true";
    if ("sort" in p) { p.sort = Number(p.sort); if (!Number.isInteger(p.sort)) return "bad_sort"; }
    if ("description" in p) p.description = String(p.description || "").slice(0, 2000);
    if ("note" in p) p.note = String(p.note || "").slice(0, 500);
    if ("thanks_page_slug" in p) {
      p.thanks_page_slug = String(p.thanks_page_slug || "").trim().toLowerCase() || null;
      if (p.thanks_page_slug && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.thanks_page_slug)) return "bad_thanks_page_slug";
    }
    // 便 8g-2：紹介の報酬の率（%）。空か null なら払わない
    if ("affiliate_rate" in p) {
      if (p.affiliate_rate === "" || p.affiliate_rate === null) p.affiliate_rate = null;
      else { p.affiliate_rate = Number(p.affiliate_rate); if (!Number.isInteger(p.affiliate_rate) || p.affiliate_rate < 0 || p.affiliate_rate > 100) return "bad_affiliate_rate"; }
    }
    return null;
  }

  // ---------- 買った記録と権利 ----------
  async function salesCount(env) {
    const rows = await db(env, "GET", "events?select=payload&type=eq.purchase_completed&limit=10000");
    const out = {};
    // 便 12e：試しの決済は売れた数（と販売数の上限）に数えない
    for (const r of rows) { const id = r.payload && r.payload.product_id; if (id && !isTestPurchase(r.payload)) out[id] = (out[id] || 0) + 1; }
    return out;
  }

  async function payEvents(env, customerId) {
    let q = `events?select=id,customer_id,type,payload,occurred_at&type=in.(purchase_completed,${SUB_TYPES.join(",")})&order=id.asc&limit=10000`;
    if (customerId) q += `&customer_id=eq.${customerId}`;
    return await db(env, "GET", q);
  }

  // 1 人の権利を出来事から計算する。定期は番号ごとに最後の状態、単発は期限（無ければずっと）で見る
  function entitlementOf(evs, products) {
    const pmap = Object.fromEntries(products.map((p) => [p.id, p]));
    const subs = new Map();
    const items = [];
    for (const e of evs) {
      const p = e.payload || {};
      if (e.type === "purchase_completed") {
        if (p.kind === "subscription" || p.kind === "installment") continue; // 定期と回数を決めた分割は subscription_* の側で見る
        const active = !p.grant_until || new Date(p.grant_until).getTime() > Date.now();
        // 便 12d：試しの決済（UnivaPay の mode test）は記録だけ残し、会員にも権利にも数えない
        const test = p.mode === "test";
        items.push({ product_id: p.product_id, name: (pmap[p.product_id] || {}).name || p.product_name || p.product_id, kind: p.kind,
          status: test ? "test" : (active ? "active" : "expired"), mode: p.mode || null, since: e.occurred_at, until: p.grant_until || null, grants: p.grants || [], amount: p.amount });
        continue;
      }
      const sid = p.subscription_id;
      if (!sid) continue;
      if (!subs.has(sid)) subs.set(sid, { since: null, product_id: null, last: null, amount: null });
      const s = subs.get(sid);
      if (e.type === "subscription_started") { s.since = s.since || e.occurred_at; s.product_id = p.product_id || s.product_id; s.amount = p.amount ?? s.amount; s.installments = p.installments || null; s.mode = p.mode || s.mode || null; }
      if (keepOf(e)) s.keep = keepOf(e);
      s.last = e;
    }
    for (const [sid, s] of subs) {
      const prod = s.product_id ? pmap[s.product_id] : null;
      items.push({
        product_id: s.product_id, subscription_id: sid, kind: s.installments ? "installment" : "subscription",
        name: prod ? prod.name : (s.product_id ? s.product_id : bin3.PLAN.name),
        // 便 R3：本人が止めた定期は、払った期間の終わり（keep_until）まで続いている扱い。期限は門番の表の expires_at にも入る
        status: s.mode === "test" ? "test" : (SUB_ACTIVE.has(s.last.type) || keepsUntil(s.last, s.keep) ? "active" : s.last.type.replace("subscription_", "")), mode: s.mode || null,
        since: s.since, until: keepsUntil(s.last, s.keep) ? s.keep : null, ending: keepsUntil(s.last, s.keep) || undefined,
        grants: prod ? prod.grants : [], amount: s.amount, last_event_at: s.last.occurred_at,
      });
    }
    // 会員＝続いている定期が 1 つでもある、または期限付き・権利付きの単発が生きている
    const live = items.filter((x) => x.status === "active");
    const memberItem = live.find((x) => x.kind === "subscription" || x.kind === "installment" || x.until || (x.grants && x.grants.length));
    const lastSub = [...subs.values()].filter((x) => x.mode !== "test").pop();
    return {
      member: !!memberItem,
      status: memberItem ? "active" : (lastSub ? lastSub.last.type.replace("subscription_", "") : (items.some((x) => x.status !== "test") ? "purchased" : "none")),
      plan: memberItem ? memberItem.name : null,
      since: memberItem ? memberItem.since : null,
      grants: [...new Set(live.flatMap((x) => x.grants || []))],
      items,
    };
  }

  // B で買ったものだけから計算した権利（門番の表へ書く元）
  async function ownEntitlement(env, customerId) {
    return entitlementOf(await payEvents(env, customerId), await allProducts(env));
  }

  // 便 6b：門番の表の権利も合わせた権利（画面・AI・会員かどうかの判定はこちら）
  async function entitlement(env, customerId) {
    const own = await ownEntitlement(env, customerId);
    return h.bridge ? await h.bridge.withGate(env, customerId, own) : own;
  }

  // 便 6b：B で買った権利の印を門番の表へ合わせる（何度呼んでも同じ結果）
  async function syncGrants(env, customerId) {
    if (!h.bridge) return { ok: true, skipped: "no_bridge" };
    return await h.bridge.syncGrants(env, customerId, await ownEntitlement(env, customerId));
  }

  async function entitlementMap(env) {
    const evs = await payEvents(env);
    const products = await allProducts(env);
    const by = new Map();
    for (const e of evs) { if (!by.has(e.customer_id)) by.set(e.customer_id, []); by.get(e.customer_id).push(e); }
    const out = {};
    for (const [id, list] of by) out[id] = entitlementOf(list, products);
    // 便 6b：門番の表で会員の人（B で何も買っていない本番の会員を含む）
    if (h.bridge) {
      for (const id of await h.bridge.gateMembers(env)) {
        out[id] = out[id] && out[id].member ? out[id]
          : { ...(out[id] || { items: [], grants: [] }), member: true, status: "active", plan: "しあらぼ会員", via_gate: true };
      }
    }
    return out;
  }

  // ---------- 買う前の確かめ（窓を開く前） ----------
  async function canBuy(env, customer, p) {
    if (!p || !p.active) return "not_for_sale";
    if (p.sales_limit) {
      const sold = (await salesCount(env))[p.id] || 0;
      if (sold >= p.sales_limit) return "sold_out";
    }
    if (p.deny_multiple && customer) {
      const ent = await entitlement(env, customer.id);
      if (ent.items.some((x) => x.product_id === p.id && x.status === "active")) return "already_purchased";
    }
    return null;
  }

  async function prepare(env, { email, product_id }) {
    const st = bin3.univapayState(env);
    if (!st.configured) return { ok: false, error: "univapay_not_configured" };
    const mail = String(email || "").trim().toLowerCase();
    const [customer] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(mail)}`);
    if (!customer) return { ok: false, error: "not_registered" };
    const p = await product(env, product_id);
    const why = await canBuy(env, customer, p);
    if (why) return { ok: false, error: why };
    return { ok: true, product: publicShape(p), app_id: st.app_id };
  }

  // ---------- 決済の確かめ（画面から・UnivaPay の知らせから） ----------
  async function univapayGet(env, path) {
    const r = await fetch("https://api.univapay.com" + path, {
      headers: { authorization: `Bearer ${env.UNIVAPAY_APP_SECRET}.${env.UNIVAPAY_APP_TOKEN}` },
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    return { ok: r.ok, status: r.status, data };
  }

  async function alreadyRecorded(env, key, value) {
    const rows = await db(env, "GET", `events?select=id,customer_id&type=eq.purchase_completed&payload->>${key}=eq.${encodeURIComponent(value)}&limit=1`);
    return rows[0] || null;
  }

  function grantUntil(p, from) {
    if (!p.grant_days) return null;
    return new Date(new Date(from).getTime() + p.grant_days * 864e5).toISOString();
  }

  async function record(env, customer, p, extra, via) {
    const now = new Date().toISOString();
    const payload = {
      product_id: p.id, product_name: p.name, kind: p.kind, amount: p.amount, currency: p.currency, period: p.period || null,
      grants: p.grants || [], grant_until: grantUntil(p, now), list_price_of: p.list_price_of || null, via, ...extra,
    };
    const ev = await addEvent(env, customer.id, "purchase_completed", payload, via === "webhook" ? "webhook" : "site");
    if (isRecurring(p)) {
      await addEvent(env, customer.id, "subscription_started", {
        subscription_id: extra.subscription_id, status: extra.status || null, amount: p.amount, currency: p.currency,
        period: p.period || "monthly", product_id: p.id, mode: extra.mode || null, via,
        ...(p.kind === "installment" ? { installments: p.installments } : {}),
      }, via === "webhook" ? "webhook" : "site");
    }
    await syncGrants(env, customer.id);
    // 便 8g-2：紹介された人の購入なら、紹介者に報酬を積む（失敗しても買った記録は取り消さない）
    if (api.onPurchased) {
      try { await api.onPurchased(env, customer.id, ev, p, via === "webhook" ? "webhook" : "site"); }
      catch (e) { if (h.logInbound) await h.logInbound(env, "referral", { buyer_id: customer.id, product_id: p.id }, { ok: false, error: String(e && e.message || e).slice(0, 160) }, 500); }
    }
    return ev;
  }

  // 画面が送ってきた番号を UnivaPay に聞き直す。単発は charge_id、定期は subscription_id
  // 便 12b：決済のあとに移るページの住所。公開中のときだけ（下書きや止めたページへは移さない）
  async function thanksUrl(env, p) {
    if (!p.thanks_page_slug) return null;
    const [pg] = await db(env, "GET", `b_pages?select=slug,status&slug=eq.${p.thanks_page_slug}`).catch(() => []);
    if (!pg || pg.status !== "published") return null;
    return `${String(env.PAGES_ORIGIN || "https://lp.shia2n.jp").replace(/[/]$/, "")}/${pg.slug}`;
  }

  async function confirm(env, { email, product_id, charge_id, subscription_id }) {
    const st = bin3.univapayState(env);
    if (!st.configured || !st.store_id) return { ok: false, error: "univapay_not_configured" };
    const mail = String(email || "").trim().toLowerCase();
    const [customer] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(mail)}`);
    if (!customer) return { ok: false, error: "not_registered" };
    const p = await product(env, product_id);
    if (!p || !p.active) return { ok: false, error: "not_for_sale" };
    const isSub = isRecurring(p);
    const id = String((isSub ? subscription_id : charge_id) || "").trim();
    if (!UUID_RE.test(id)) return { ok: false, error: isSub ? "bad_subscription_id" : "bad_charge_id" };
    const key = isSub ? "subscription_id" : "charge_id";
    const done = await alreadyRecorded(env, key, id);
    if (done) {
      if (done.customer_id !== customer.id) return { ok: false, error: "payment_taken" };
      return { ok: true, already: true, entitlement: await entitlement(env, customer.id), thanks_url: await thanksUrl(env, p) };
    }
    const r = await lookupWithWait(env, st, isSub, id);
    if (!r.ok) return { ok: false, error: "univapay_lookup_failed", status: r.status };
    const d = r.data || {};
    const bad = mismatch(p, d, isSub);
    if (bad) return { ok: false, error: "payment_mismatch", detail: bad };
    if (isSub && ["canceled", "suspended", "unpaid"].includes(d.status)) return { ok: false, error: "subscription_not_active", status: d.status };
    if (!isSub && d.status !== "successful") return { ok: false, error: d.status === "pending" || d.status === "awaiting" ? "charge_pending" : "charge_not_successful", status: d.status };
    const over = await canBuy(env, customer, p);
    await record(env, customer, p, { [key]: id, status: d.status || null, mode: d.mode || st.mode || null, over_limit: over || null }, "checkout");
    const mailResult = await bin3.sendMail(env, customer, {
      kind: "purchase",
      subject: `【シアラボ】お申し込みの確認：${p.name}`,
      text: [`${customer.name || ""} さん`, "", `${p.name}（${priceText(p)}）のお申し込みを受け付けました。`, "", `${env.PUBLIC_ORIGIN || "https://utage-alt-demo.gameister1.workers.dev"}/app`].join(NL),
      extra: { product_id: p.id },
    });
    return { ok: true, already: false, product: publicShape(p), entitlement: await entitlement(env, customer.id), mail: mailResult.result, thanks_url: await thanksUrl(env, p) };
  }

  // 単発の決済は、通った直後だと UnivaPay の側でまだ処理中のことがあるので、少し待って 3 回まで聞き直す
  async function lookupWithWait(env, st, isSub, id) {
    const path = `/stores/${st.store_id}/${isSub ? "subscriptions" : "charges"}/${id}`;
    let r = await univapayGet(env, path);
    for (let i = 0; i < 2 && !isSub && r.ok && r.data && ["pending", "awaiting"].includes(r.data.status); i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await univapayGet(env, path);
    }
    return r;
  }

  function mismatch(p, d, isSub) {
    // 定期は amount・currency、単発（charge）は requested_amount・requested_currency（通ったあとは charged_*）で返ってくる
    const amount = Number(d.amount ?? d.requested_amount ?? d.charged_amount);
    const currency = d.currency || d.requested_currency || d.charged_currency || "";
    // 便 12c：回数を決めた分割は、合計（1 回あたり × 回数）で作るので、合計か 1 回あたりのどちらかで合えばよい
    const okAmounts = p.kind === "installment" ? [p.amount, p.amount * p.installments] : [p.amount];
    if (!okAmounts.includes(amount)) return { amount: { expected: okAmounts, got: amount } };
    if (String(currency).toLowerCase() !== String(p.currency || "jpy").toLowerCase()) return { currency: { expected: p.currency, got: currency } };
    if (isSub && d.period && d.period !== (p.period || "monthly")) return { period: { expected: p.period || "monthly", got: d.period } };
    const meta = d.metadata || {};
    if (meta.product_id && meta.product_id !== p.id) return { product_id: { expected: p.id, got: meta.product_id } };
    return null;
  }

  function priceText(p) {
    const yen = Number(p.amount).toLocaleString() + " 円";
    if (p.kind === "subscription") return (p.period === "annually" ? "年 " : "月 ") + yen;
    if (p.kind === "installment") return `月 ${yen} × ${p.installments} 回（合計 ${(p.amount * p.installments).toLocaleString()} 円）`;
    return yen + (p.grant_days ? `・${p.grant_days} 日` : "");
  }

  // UnivaPay の知らせ：単発の決済が通った（charge_finished）。画面の確かめが届かなかったときの取りこぼしを拾う
  // 誰の何の決済かは、窓を開くときに付けた metadata（email・product_id）で引く。無ければ積まない
  async function onCharge(env, event, data) {
    if (event !== "charge_finished") return null;
    const meta = data.metadata || {};
    if (!data.id || !meta.product_id || !meta.email) return { ok: true, recorded: false, reason: "no_metadata" };
    if (data.status !== "successful") return { ok: true, recorded: false, reason: "status_" + (data.status || "none") };
    if (await alreadyRecorded(env, "charge_id", data.id)) return { ok: true, recorded: false, duplicate: true };
    const p = await product(env, meta.product_id);
    if (!p || p.kind !== "one_time") return { ok: true, recorded: false, reason: "unknown_product" };
    const bad = mismatch(p, data, false);
    if (bad) return { ok: true, recorded: false, reason: "payment_mismatch", detail: bad };
    const [customer] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(String(meta.email).toLowerCase())}`);
    if (!customer) return { ok: true, recorded: false, reason: "not_registered" };
    await record(env, customer, p, { charge_id: data.id, status: data.status, mode: data.mode || null }, "webhook");
    return { ok: true, recorded: true, type: "purchase_completed" };
  }

  // ---------- 便 12c：継続課金の一覧・解約・失敗のメール ----------
  const STATUS_LABEL = { active: "続いている", failed: "失敗", canceled: "解約", suspended: "止まった", completed: "回数どおり済み", ending: "止めた（期限まで使える）" };

  // 定期課金の番号ごとに、誰の・何の・いまの状態・入金の回数をまとめる（出来事から計算する）
  // 便 R3：customerId を渡すとその人の分だけ読む。last_paid_at（最後の入金）・paid_until（次の課金の時刻）・keep_until（止めたあと使える期限）
  async function subscriptions(env, customerId) {
    let q = `events?select=id,customer_id,type,payload,occurred_at&type=in.(${SUB_TYPES.join(",")})&order=id.asc&limit=20000`;
    if (customerId) q += `&customer_id=eq.${customerId}`;
    const evs = await db(env, "GET", q);
    const pmap = Object.fromEntries((await allProducts(env)).map((p) => [p.id, p]));
    const subs = new Map();
    for (const e of evs) {
      const p = e.payload || {};
      const sid = p.subscription_id;
      if (!sid) continue;
      if (!subs.has(sid)) subs.set(sid, { subscription_id: sid, customer_id: e.customer_id, product_id: null, amount: null, installments: null, since: null, payments: 0, failures: 0, last_type: null, last_at: null, mode: null, period: null, last_paid_at: null, keep_until: null, last_event: null });
      const s = subs.get(sid);
      if (e.type === "subscription_started") { s.since = s.since || e.occurred_at; s.product_id = p.product_id || s.product_id; s.amount = p.amount ?? s.amount; s.installments = p.installments || s.installments; s.mode = p.mode || s.mode; s.period = p.period || s.period; s.payments += 1; s.last_paid_at = e.occurred_at; }
      // 1 回目の入金は始まりの記録で数える。UnivaPay が 1 回目にも入金の知らせを送ってきたとき（始まりから 10 分のうち）は数えない
      if (e.type === "subscription_payment" && !(s.since && Date.parse(e.occurred_at) - Date.parse(s.since) < 600e3)) s.payments += 1;
      if (e.type === "subscription_payment") s.last_paid_at = e.occurred_at;
      if (e.type === "subscription_failed") s.failures += 1;
      if (keepOf(e)) s.keep_until = keepOf(e);
      s.last_type = e.type; s.last_at = e.occurred_at; s.last_event = e;
    }
    return [...subs.values()].map(({ last_event, ...s }) => {
      const prod = s.product_id ? pmap[s.product_id] : null;
      let status = SUB_ACTIVE.has(s.last_type) ? "active" : s.last_type.replace("subscription_", "");
      if (s.installments && s.payments >= s.installments && status === "active") status = "completed";
      if (keepsUntil(last_event, s.keep_until)) status = "ending";
      const period = s.period || (prod && prod.period) || "monthly";
      return { ...s, period, paid_until: paidUntil(s.last_paid_at, period), keep_until: s.keep_until || null,
        product_name: prod ? prod.name : s.product_id || bin3.PLAN.name, kind: s.installments ? "installment" : "subscription", status, status_label: STATUS_LABEL[status] || status };
    });
  }

  async function listSubscriptions(env, { status } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, subscriptions: [] };
    let list = await subscriptions(env);
    if (status) list = list.filter((s) => s.status === status);
    const ids = [...new Set(list.map((s) => s.customer_id))];
    const people = ids.length ? new Map((await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`)).map((x) => [x.id, x])) : new Map();
    list = list.map((s) => ({ ...s, name: (people.get(s.customer_id) || {}).name || "", email: (people.get(s.customer_id) || {}).email || "" }))
      .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
    const counts = {};
    for (const s of list) counts[s.status] = (counts[s.status] || 0) + 1;
    return { ok: true, store: "production", count: list.length, counts, subscriptions: list.slice(0, 500) };
  }

  // 解約：UnivaPay の定期課金を消す（永久停止。戻せない）。消えたら出来事に積んで権利を合わせ直す
  // 便 R3：opts.via（admin／self）と opts.keep_until（止めたあと使える期限。無ければその場で使えなくなる＝前と同じ）
  async function cancelSubscription(env, { subscription_id, reason } = {}, by = "admin", opts = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const sid = String(subscription_id || "");
    if (!UUID_RE.test(sid)) return { ok: false, error: "bad_subscription_id" };
    const s = (await subscriptions(env)).find((x) => x.subscription_id === sid);
    if (!s) return { ok: false, error: "not_found" };
    if (s.status === "canceled") return { ok: true, already: true, subscription: s };
    const st = bin3.univapayState(env);
    if (!st.configured || !st.store_id) return { ok: false, error: "univapay_not_configured" };
    const r = await fetch(`https://api.univapay.com/stores/${st.store_id}/subscriptions/${sid}`, {
      method: "DELETE", headers: { authorization: `Bearer ${env.UNIVAPAY_APP_SECRET}.${env.UNIVAPAY_APP_TOKEN}` },
    });
    const text = await r.text().catch(() => "");
    if (h.logInbound) await h.logInbound(env, "univapay_cancel", { subscription_id: sid, by }, { ok: r.ok, status: r.status, body: text.slice(0, 300) }, r.status);
    if (!r.ok) return { ok: false, error: "univapay_cancel_failed", status: r.status, detail: text.slice(0, 200) };
    const via = opts.via === "self" ? "self" : "admin";
    const keep = opts.keep_until && Date.parse(opts.keep_until) > Date.now() ? opts.keep_until : null;
    await addEvent(env, s.customer_id, "subscription_canceled", { subscription_id: sid, status: "canceled", via, by: String(by).slice(0, 120), reason: String(reason || "").slice(0, 200), ...(keep ? { keep_until: keep } : {}) },
      via === "self" ? "site" : by === "mcp" ? "mcp" : "admin");
    await syncGrants(env, s.customer_id);
    const status = keep ? "ending" : "canceled";
    return { ok: true, canceled: true, subscription: { ...s, status, status_label: STATUS_LABEL[status], keep_until: keep } };
  }

  // ---------- 便 R3：生徒が自分の契約を見て、定期を止める ----------
  // 生徒に見せる形（UnivaPay の番号は止めるボタンのために返すが、ほかの人の分は返さない）
  async function mySubscriptions(env, customer) {
    if (!env.B_STORE || !customer) return { ok: true, subscriptions: [] };
    const pmap = Object.fromEntries((await allProducts(env)).map((p) => [p.id, p]));
    const list = (await subscriptions(env, customer.id)).filter((s) => s.customer_id === customer.id)
      .sort((a, b) => String(b.since || "").localeCompare(String(a.since || "")));
    return {
      ok: true,
      subscriptions: list.map((s) => {
        const p = s.product_id ? pmap[s.product_id] : null;
        const live = s.status === "active" || s.status === "failed";
        return {
          subscription_id: s.subscription_id, product_name: s.product_name, kind: s.kind, status: s.status, status_label: s.status_label,
          price: p ? priceText(p) : (s.amount != null ? Number(s.amount).toLocaleString() + " 円" : ""),
          since: s.since, next_charge_at: live && s.kind === "subscription" ? s.paid_until : null, keep_until: s.keep_until,
          payments: s.payments, installments: s.installments, remaining: s.installments ? Math.max(0, s.installments - s.payments) : null,
          test: s.mode === "test",
          // 分割は一括の代金の払い方なので、本人の画面からは止めない（止める＝残りの未払いになる）
          can_cancel: s.kind === "subscription" && live && !!s.paid_until,
        };
      }),
    };
  }

  // 本人が止める：UnivaPay の課金は今止め、使えるのは払った期間の終わり（次の課金の時刻）まで
  async function cancelOwnSubscription(env, customer, { subscription_id } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!customer) return { ok: false, error: "not_registered" };
    const sid = String(subscription_id || "");
    if (!UUID_RE.test(sid)) return { ok: false, error: "bad_subscription_id" };
    const s = (await subscriptions(env, customer.id)).find((x) => x.subscription_id === sid && x.customer_id === customer.id);
    if (!s) return { ok: false, error: "not_found" };
    if (s.kind === "installment") return { ok: false, error: "installment_not_cancelable" };
    if (s.status === "canceled" || s.status === "ending") return { ok: true, already: true, keep_until: s.keep_until };
    if (!s.paid_until) return { ok: false, error: "no_paid_until" };
    const r = await cancelSubscription(env, { subscription_id: sid, reason: "本人が画面で止めた" }, `self:${customer.email || customer.id}`, { via: "self", keep_until: s.paid_until });
    // 失敗の中身（UnivaPay の返事）は生徒に返さない。記録は univapay_cancel に残る
    return r.ok ? { ok: true, canceled: true, keep_until: r.subscription.keep_until } : { ok: false, error: r.error };
  }

  // UnivaPay の知らせで課金が失敗したとき（bin3 から呼ばれる）。同じ番号の失敗には 1 日 1 通まで
  async function onSubscriptionFailed(env, customerId, subscriptionId) {
    const s = (await subscriptions(env)).find((x) => x.subscription_id === subscriptionId);
    const p = s && s.product_id ? await product(env, s.product_id) : null;
    const [customer] = await db(env, "GET", `customers?select=id,email,name&id=eq.${customerId}`);
    if (!customer) return { mail: "no_customer" };
    const since = new Date(Date.now() - 864e5).toISOString();
    const sent = await db(env, "GET", `events?select=id&customer_id=eq.${customerId}&type=eq.email_sent&payload->>kind=eq.billing_failed&payload->>subscription_id=eq.${subscriptionId}&occurred_at=gte.${since}&limit=1`).catch(() => []);
    if (sent.length) return { mail: "already_today" };
    const map = { name: customer.name || "", product: p ? p.name : (s ? s.product_name : "ご契約"), amount: p ? priceText(p) : "" };
    const fill = (t) => String(t || "").replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
    const r = await bin3.sendMail(env, customer, {
      kind: "billing_failed",
      subject: fill((p && p.failed_mail_subject) || FAILED_MAIL.subject),
      text: fill((p && p.failed_mail_body) || FAILED_MAIL.body),
      extra: { subscription_id: subscriptionId, product_id: p ? p.id : null },
    });
    return { mail: r.result };
  }

  const api = { allProducts, product, listForSite, listProducts, setProduct, entitlement, entitlementMap, syncGrants, prepare, confirm, onCharge, priceText, listSubscriptions, cancelSubscription, mySubscriptions, cancelOwnSubscription, onSubscriptionFailed, onPurchased: null };
  return api;
}

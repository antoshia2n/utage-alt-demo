// B の便 4：売る。商品の台帳（b_products）と、単発・定期・年払い・紹介用の価格の決済。
// 買った記録は表を増やさず、出来事の記録に積む：
//   purchase_completed … 決済が通った（商品・金額・UnivaPay の番号・権利の期限）
//   subscription_started … 定期の商品のときは、これまでどおり定期課金の始まりも積む（2 回目以降の入金と止まった知らせを結ぶため）
// 画面の言うことは信じない：決済の番号を秘密の鍵で UnivaPay に聞き直し、金額・通貨・周期・商品が台帳と合うときだけ積む。
// 同じ決済の番号は 1 回しか積まない（画面の確かめと UnivaPay の知らせの両方から来ても 1 件）。
// デモの置き場（B_STORE が無いとき）には商品の台帳が無いので、便 3 の見本のプラン 1 つだけを商品として見せる。
// 権利（grants）は B の中の印。便 6b から門番の権利の表（member_entitlement）へも書く（中身は src/bridge.js）。
// 会員かどうかは、B で買ったものに加えて門番の表の shiarabo_basic（shr-webhook が付ける本番の会員）でも決まる。

const KINDS = ["one_time", "subscription", "installment"];
const PERIODS = ["monthly", "annually"];
const SUB_ACTIVE = new Set(["subscription_started", "subscription_payment"]);
const SUB_TYPES = ["subscription_started", "subscription_payment", "subscription_failed", "subscription_canceled", "subscription_suspended"];
const ID_RE = /^[a-z0-9-]{2,40}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const NL = String.fromCharCode(10);
const EDITABLE = ["name", "amount", "period", "grant_days", "grants", "deny_multiple", "sales_limit", "list_price_of", "description", "active", "public", "sort", "note"];

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
    };
  }

  // サイトの一覧：売っていて、サイトに出すものだけ。id を指定すると、サイトに出していなくても売っていれば返す（紹介用のリンク）
  async function listForSite(env, id) {
    const list = await allProducts(env);
    if (id) {
      const p = list.find((x) => x.id === id && x.active && x.kind !== "installment");
      return { ok: true, count: p ? 1 : 0, products: p ? [publicShape(p)] : [] };
    }
    const shown = list.filter((x) => x.active && x.public && x.kind !== "installment").map(publicShape);
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
    if (kind === "installment" && !before) return "installment_not_supported";
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
    return null;
  }

  // ---------- 買った記録と権利 ----------
  async function salesCount(env) {
    const rows = await db(env, "GET", "events?select=payload&type=eq.purchase_completed&limit=10000");
    const out = {};
    for (const r of rows) { const id = r.payload && r.payload.product_id; if (id) out[id] = (out[id] || 0) + 1; }
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
        if (p.kind === "subscription") continue; // 定期は subscription_* の側で見る
        const active = !p.grant_until || new Date(p.grant_until).getTime() > Date.now();
        items.push({ product_id: p.product_id, name: (pmap[p.product_id] || {}).name || p.product_name || p.product_id, kind: p.kind,
          status: active ? "active" : "expired", since: e.occurred_at, until: p.grant_until || null, grants: p.grants || [], amount: p.amount });
        continue;
      }
      const sid = p.subscription_id;
      if (!sid) continue;
      if (!subs.has(sid)) subs.set(sid, { since: null, product_id: null, last: null, amount: null });
      const s = subs.get(sid);
      if (e.type === "subscription_started") { s.since = s.since || e.occurred_at; s.product_id = p.product_id || s.product_id; s.amount = p.amount ?? s.amount; }
      s.last = e;
    }
    for (const [sid, s] of subs) {
      const prod = s.product_id ? pmap[s.product_id] : null;
      items.push({
        product_id: s.product_id, subscription_id: sid, kind: "subscription",
        name: prod ? prod.name : (s.product_id ? s.product_id : bin3.PLAN.name),
        status: SUB_ACTIVE.has(s.last.type) ? "active" : s.last.type.replace("subscription_", ""),
        since: s.since, until: null, grants: prod ? prod.grants : [], amount: s.amount, last_event_at: s.last.occurred_at,
      });
    }
    // 会員＝続いている定期が 1 つでもある、または期限付き・権利付きの単発が生きている
    const live = items.filter((x) => x.status === "active");
    const memberItem = live.find((x) => x.kind === "subscription" || x.until || (x.grants && x.grants.length));
    const lastSub = [...subs.values()].pop();
    return {
      member: !!memberItem,
      status: memberItem ? "active" : (lastSub ? lastSub.last.type.replace("subscription_", "") : (items.length ? "purchased" : "none")),
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
    if (p.kind === "installment") return "installment_not_supported";
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
    if (p.kind === "subscription") {
      await addEvent(env, customer.id, "subscription_started", {
        subscription_id: extra.subscription_id, status: extra.status || null, amount: p.amount, currency: p.currency,
        period: p.period, product_id: p.id, mode: extra.mode || null, via,
      }, via === "webhook" ? "webhook" : "site");
    }
    await syncGrants(env, customer.id);
    return ev;
  }

  // 画面が送ってきた番号を UnivaPay に聞き直す。単発は charge_id、定期は subscription_id
  async function confirm(env, { email, product_id, charge_id, subscription_id }) {
    const st = bin3.univapayState(env);
    if (!st.configured || !st.store_id) return { ok: false, error: "univapay_not_configured" };
    const mail = String(email || "").trim().toLowerCase();
    const [customer] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(mail)}`);
    if (!customer) return { ok: false, error: "not_registered" };
    const p = await product(env, product_id);
    if (!p || !p.active || p.kind === "installment") return { ok: false, error: "not_for_sale" };
    const isSub = p.kind === "subscription";
    const id = String((isSub ? subscription_id : charge_id) || "").trim();
    if (!UUID_RE.test(id)) return { ok: false, error: isSub ? "bad_subscription_id" : "bad_charge_id" };
    const key = isSub ? "subscription_id" : "charge_id";
    const done = await alreadyRecorded(env, key, id);
    if (done) {
      if (done.customer_id !== customer.id) return { ok: false, error: "payment_taken" };
      return { ok: true, already: true, entitlement: await entitlement(env, customer.id) };
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
      subject: `【お申し込みの確認】${p.name}`,
      text: [`${customer.name || ""} さん`, "", `${p.name}（${priceText(p)}）のお申し込みを受け付けました。`, "", "https://utage-alt-demo.gameister1.workers.dev/app"].join(NL),
      extra: { product_id: p.id },
    });
    return { ok: true, already: false, product: publicShape(p), entitlement: await entitlement(env, customer.id), mail: mailResult.result };
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
    if (amount !== p.amount) return { amount: { expected: p.amount, got: amount } };
    if (String(currency).toLowerCase() !== String(p.currency || "jpy").toLowerCase()) return { currency: { expected: p.currency, got: currency } };
    if (isSub && d.period && d.period !== p.period) return { period: { expected: p.period, got: d.period } };
    const meta = d.metadata || {};
    if (meta.product_id && meta.product_id !== p.id) return { product_id: { expected: p.id, got: meta.product_id } };
    return null;
  }

  function priceText(p) {
    const yen = Number(p.amount).toLocaleString() + " 円";
    if (p.kind === "subscription") return (p.period === "annually" ? "年 " : "月 ") + yen;
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

  return { allProducts, product, listForSite, listProducts, setProduct, entitlement, entitlementMap, syncGrants, prepare, confirm, onCharge, priceText };
}

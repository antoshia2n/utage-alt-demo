// B の便 8g-2：紹介。紹介者の表は作らず、出来事の記録（b_events）に積む。
//   紹介の番号 … 台帳の人の番号（uuid）の頭 12 字から作る（r＋12 字）。人ごとに決まっていて、変わらない
//   referred        … 紹介のリンク（/register?ref=番号）から登録した人の行に積む。{ by: 紹介者の番号, code }。1 人 1 回（先に来た紹介が勝つ）
//   referral_reward … 紹介された人が買ったとき、紹介者の行に積む。{ buyer_id, purchase_event_id, product_id, amount, rate, reward }
//                     率は商品の台帳の affiliate_rate（%・空か 0 なら積まない）を、買った時点の値で写す。紹介から REF_DAYS 日以内の購入だけ
//                     定期の商品は最初の購入の 1 回だけ（2 回目以降の入金には付けない）
//   referral_paid   … Naoki が紹介者に払った分。{ amount, note }。払うのは B の外（振込など）で、ここは記録だけ
// 自分で自分を紹介したもの・紹介者がいない番号は積まない（入口の記録 b_inbound_log の channel=referral に理由を残す）。

export const REF_DAYS = 90;
const CODE_RE = /^r[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function refCode(id) {
  return "r" + String(id || "").replace(/-/g, "").toLowerCase().slice(0, 12);
}
export function rewardOf(amount, rate) {
  const a = Number(amount), r = Number(rate);
  if (!Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r <= 0) return 0;
  return Math.floor((a * r) / 100);
}

export function makeRefer(h) {
  const { db, addEvent, logInbound } = h;

  async function people(env) {
    return await db(env, "GET", "customers?select=id,name,email&limit=10000");
  }

  async function resolve(env, code) {
    const c = String(code || "").trim().toLowerCase();
    if (!CODE_RE.test(c)) return null;
    return (await people(env)).find((p) => refCode(p.id) === c) || null;
  }

  // 登録のとき（新しく入った人も、もう台帳にいる人も）。紹介されていない人にだけ積む
  async function onRegister(env, personId, code, isNew) {
    const ref = await resolve(env, code);
    let reason = null;
    if (!ref) reason = "unknown_code";
    else if (ref.id === personId) reason = "self";
    else {
      const [had] = await db(env, "GET", `events?select=id&customer_id=eq.${personId}&type=eq.referred&limit=1`);
      if (had) reason = "already_referred";
    }
    if (reason) {
      await logInbound(env, "referral", { person_id: personId, code: String(code || "").slice(0, 20), is_new: !!isNew }, { ok: true, referred: false, reason }, 200);
      return { ok: true, referred: false, reason };
    }
    await addEvent(env, personId, "referred", { by: ref.id, code: refCode(ref.id), is_new: !!isNew }, "site");
    return { ok: true, referred: true, by: ref.id };
  }

  // 買ったとき（sell.js の record から呼ぶ）。紹介されていて、期間内で、率があるときだけ紹介者に報酬を積む
  async function onPurchase(env, buyerId, purchaseEv, product, actor = "site") {
    if (!env.B_STORE || !purchaseEv || !product) return { ok: true, reward: 0, skipped: "no_store" };
    const [r] = await db(env, "GET", `events?select=id,payload,occurred_at&customer_id=eq.${buyerId}&type=eq.referred&order=id.asc&limit=1`);
    if (!r || !r.payload || !UUID_RE.test(String(r.payload.by || ""))) return { ok: true, reward: 0, skipped: "not_referred" };
    const by = r.payload.by;
    if (by === buyerId) return { ok: true, reward: 0, skipped: "self" };
    const boughtAt = new Date(purchaseEv.occurred_at || Date.now()).getTime();
    if (boughtAt - new Date(r.occurred_at).getTime() > REF_DAYS * 864e5) return { ok: true, reward: 0, skipped: "expired" };
    const rate = Number(product.affiliate_rate) || 0;
    const amount = Number((purchaseEv.payload && purchaseEv.payload.amount) ?? product.amount) || 0;
    const reward = rewardOf(amount, rate);
    if (!reward) return { ok: true, reward: 0, skipped: "no_rate" };
    const [dup] = await db(env, "GET", `events?select=id&customer_id=eq.${by}&type=eq.referral_reward&payload->>purchase_event_id=eq.${encodeURIComponent(String(purchaseEv.id))}&limit=1`);
    if (dup) return { ok: true, reward: 0, skipped: "already" };
    await addEvent(env, by, "referral_reward", {
      buyer_id: buyerId, purchase_event_id: String(purchaseEv.id), product_id: product.id, product_name: product.name,
      amount, rate, reward,
    }, actor === "webhook" ? "webhook" : "site");
    return { ok: true, reward, referrer_id: by };
  }

  // 紹介者ごとの集計。referrer_id を渡すとその人だけ
  async function list(env, { referrer_id, origin = "" } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const evs = await db(env, "GET", "events?select=id,customer_id,type,payload,occurred_at&type=in.(referred,referral_reward,referral_paid)&order=id.asc&limit=50000");
    const ps = await people(env);
    const nameOf = Object.fromEntries(ps.map((p) => [p.id, { name: p.name || "", email: p.email }]));
    const rows = new Map();
    const row = (id) => {
      if (!rows.has(id)) rows.set(id, { referrer_id: id, ...(nameOf[id] || { name: "", email: "" }), code: refCode(id), link: (origin || "") + "/register?ref=" + refCode(id), referred: 0, purchases: 0, reward_total: 0, paid_total: 0, unpaid: 0, people: [] });
      return rows.get(id);
    };
    for (const e of evs) {
      const p = e.payload || {};
      if (e.type === "referred" && UUID_RE.test(String(p.by || ""))) {
        const x = row(p.by); x.referred++;
        x.people.push({ id: e.customer_id, ...(nameOf[e.customer_id] || {}), at: e.occurred_at, bought: 0, reward: 0 });
      } else if (e.type === "referral_reward") {
        const x = row(e.customer_id); x.purchases++; x.reward_total += Number(p.reward) || 0;
        const who = x.people.find((q) => q.id === p.buyer_id);
        if (who) { who.bought++; who.reward += Number(p.reward) || 0; }
      } else if (e.type === "referral_paid") {
        row(e.customer_id).paid_total += Number(p.amount) || 0;
      }
    }
    let list = [...rows.values()];
    for (const x of list) x.unpaid = x.reward_total - x.paid_total;
    if (referrer_id) list = list.filter((x) => x.referrer_id === referrer_id);
    list.sort((a, b) => b.unpaid - a.unpaid || b.referred - a.referred);
    return {
      ok: true, count: list.length, days: REF_DAYS,
      unpaid_total: list.reduce((n, x) => n + x.unpaid, 0),
      referrers: list,
    };
  }

  // 払ったことを記録する（払う作業そのものは B の外）。まだ払っていない分を超えては積まない
  async function markPaid(env, { referrer_id, amount, note = "" } = {}, actor = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!UUID_RE.test(String(referrer_id || ""))) return { ok: false, error: "bad_referrer_id" };
    const a = Number(amount);
    if (!Number.isInteger(a) || a <= 0) return { ok: false, error: "bad_amount" };
    const cur = (await list(env, { referrer_id })).referrers[0];
    if (!cur) return { ok: true, found: false };
    if (a > cur.unpaid) return { ok: false, error: "over_unpaid", unpaid: cur.unpaid };
    await addEvent(env, referrer_id, "referral_paid", { amount: a, note: String(note || "").slice(0, 200) }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, paid: a, unpaid: cur.unpaid - a };
  }

  // 生徒が自分の画面で見る分（紹介した人の名前は出さず、数だけ）
  async function mine(env, customer, origin = "") {
    const code = refCode(customer.id);
    const base = { code, link: (origin || "") + "/register?ref=" + code };
    if (!env.B_STORE) return { ...base, referred: 0, purchases: 0, reward_total: 0, paid_total: 0, unpaid: 0 };
    const r = (await list(env, { referrer_id: customer.id })).referrers[0];
    return { ...base, referred: r ? r.referred : 0, purchases: r ? r.purchases : 0, reward_total: r ? r.reward_total : 0, paid_total: r ? r.paid_total : 0, unpaid: r ? r.unpaid : 0 };
  }

  return { resolve, onRegister, onPurchase, list, markPaid, mine };
}

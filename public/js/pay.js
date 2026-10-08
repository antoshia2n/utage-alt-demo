// 便 3：UnivaPay のウィジェットで定期課金（テスト）を作り、サイトに確かめてもらう
// B の便 4：商品の台帳の 1 つを買う（単発は one_time、定期は subscription）。窓を開く前にサイトに確かめてもらう
// 鍵の秘密の側はブラウザに出さない。ブラウザが使うのは、ドメインを限ったアプリトークンだけ。
import { api } from "/js/common.js";

const WIDGET = "https://widget.univapay.com/client/checkout.js";
let loading = null;

function loadWidget() {
  if (window.UnivapayCheckout) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = WIDGET; s.async = true;
      s.onload = () => (window.UnivapayCheckout ? resolve() : reject(new Error("決済の画面を読み込めませんでした")));
      s.onerror = () => reject(new Error("決済の画面を読み込めませんでした"));
      document.head.appendChild(s);
    });
  }
  return loading;
}

// 返ってくる形が版によって違うので、入れ子の中から番号らしいものを探す
function findId(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const k of keys) if (typeof obj[k] === "string" && /^[0-9a-f-]{36}$/i.test(obj[k])) return obj[k];
  for (const v of Object.values(obj)) { const r = findId(v, keys, depth + 1); if (r) return r; }
  return null;
}

// product を渡すと B の便 4 の道（商品の台帳の 1 つを買う）。渡さなければ便 3 の見本のプラン
export async function startCheckout({ email, product, onStatus }) {
  if (product) return await startProductCheckout({ email, product, onStatus });
  const cfg = await fetch("/api/config").then((r) => r.json());
  if (!cfg.univapayAppId || !cfg.plan) throw new Error("決済の設定がまだ入っていません");
  await loadWidget();
  const plan = cfg.plan;
  return await new Promise((resolve, reject) => {
    let subId = null, settled = false, raw = null;
    const onEvt = (e) => { subId = subId || findId(e.detail, ["subscriptionId", "subscription_id", "id"]); };
    window.addEventListener("univapay:subscription-created", onEvt);
    const finish = async (result) => {
      if (settled) return; settled = true;
      window.removeEventListener("univapay:subscription-created", onEvt);
      raw = result;
      const id = findId(result, ["subscriptionId", "subscription_id"]) || subId;
      onStatus && onStatus("決済を確かめています…");
      const r = await api("/api/checkout/confirm", { method: "POST", body: { email, subscription_id: id, raw } });
      r.ok ? resolve(r) : reject(new Error("決済を確かめられませんでした（" + (r.error || r.status) + "）"));
    };
    const checkout = window.UnivapayCheckout.create({
      appId: cfg.univapayAppId,
      checkout: "payment",
      amount: plan.amount,
      currency: plan.currency,
      tokenType: "subscription",
      subscriptionPeriod: plan.period,
      metadata: { email },
      onSuccess: (result) => { finish(result).catch(reject); },
      onError: (err) => { if (!settled) { settled = true; reject(new Error("決済が通りませんでした" + (err && err.message ? "：" + err.message : ""))); } },
    });
    checkout.open();
  });
}

const PREPARE_ERR = {
  not_registered: "先に無料登録をしてください",
  not_for_sale: "この商品はいま売っていません",
  sold_out: "売り切れました",
  already_purchased: "この商品はもうお持ちです（重ねて買えない商品です）",
  installment_not_supported: "分割の支払いはまだ使えません",
  univapay_not_configured: "決済の設定がまだ入っていません",
};

async function startProductCheckout({ email, product, onStatus }) {
  const pre = await api("/api/checkout/prepare", { method: "POST", body: { email, product_id: product } });
  if (!pre.ok) throw new Error(PREPARE_ERR[pre.error] || "買えませんでした（" + (pre.error || pre.status) + "）");
  const p = pre.product;
  const isSub = p.kind === "subscription";
  await loadWidget();
  return await new Promise((resolve, reject) => {
    let seen = null, settled = false;
    const evName = isSub ? "univapay:subscription-created" : "univapay:charge-created";
    const keys = isSub ? ["subscriptionId", "subscription_id"] : ["chargeId", "charge_id"];
    const onEvt = (e) => { seen = seen || findId(e.detail, [...keys, "id"]); };
    window.addEventListener(evName, onEvt);
    const finish = async (result) => {
      if (settled) return; settled = true;
      window.removeEventListener(evName, onEvt);
      const id = findId(result, keys) || seen;
      onStatus && onStatus("決済を確かめています…");
      const body = { email, product_id: p.id, raw: result };
      body[isSub ? "subscription_id" : "charge_id"] = id;
      const r = await api("/api/checkout/confirm", { method: "POST", body });
      if (r.ok) return resolve(r);
      if (r.error === "charge_pending") return reject(new Error("決済の確認に時間がかかっています。確認できたらメールでお知らせします。"));
      reject(new Error("決済を確かめられませんでした（" + (r.error || r.status) + "）"));
    };
    const opts = {
      appId: pre.app_id,
      checkout: "payment",
      amount: p.amount,
      currency: p.currency || "jpy",
      tokenType: isSub ? "subscription" : "one_time",
      metadata: { email, product_id: p.id },
      onSuccess: (result) => { finish(result).catch(reject); },
      onError: (err) => { if (!settled) { settled = true; reject(new Error("決済が通りませんでした" + (err && err.message ? "：" + err.message : ""))); } },
    };
    if (isSub) opts.subscriptionPeriod = p.period;
    window.UnivapayCheckout.create(opts).open();
  });
}

// 値段の見せ方（画面どうしで同じにする）
export function priceLabel(p) {
  const yen = Number(p.amount).toLocaleString() + " 円";
  if (p.kind === "subscription") return (p.period === "annually" ? "年 " : "月 ") + yen;
  return yen + (p.grant_days ? "（" + p.grant_days + " 日）" : "");
}

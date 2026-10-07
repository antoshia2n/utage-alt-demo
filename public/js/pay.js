// 便 3：UnivaPay のウィジェットで定期課金（テスト）を作り、サイトに確かめてもらう
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

export async function startCheckout({ email, onStatus }) {
  const cfg = await fetch("/api/config").then((r) => r.json());
  if (!cfg.univapayAppId) throw new Error("決済の設定がまだ入っていません");
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

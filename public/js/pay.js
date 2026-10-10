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
  // 便 12c：回数を決めた分割（installment）も、UnivaPay では「回数指定の定期課金」なので定期の道を通る
  const isSub = p.kind === "subscription" || p.kind === "installment";
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
    if (isSub) opts.subscriptionPeriod = p.period || "monthly";
    // 便 12c：合計（1 回あたり × 回数）で作り、1 回あたりの金額を決める。回数が済むと UnivaPay の側で止まる
    if (p.kind === "installment") {
      opts.amount = p.amount * p.installments;
      opts.subscriptionPlan = "fixed_cycle_amount";
      opts.subscriptionQty = p.amount;
    }
    window.UnivapayCheckout.create(opts).open();
  });
}

// 便 12c：カード会社の分割を選べる決済の枠（ページに埋め込む形）。UnivaPay の決まりで、分割の回数を選ぶ欄は埋め込む形でしか出ない。
// 回数の選び肢は全部出し、使えるかどうかはお客さんのカード（ブランド）で決まる。返す pay() を押したときに決済する
export async function mountInlineCard({ container, email, product, onStatus }) {
  const pre = await api("/api/checkout/prepare", { method: "POST", body: { email, product_id: product } });
  if (!pre.ok) throw new Error(PREPARE_ERR[pre.error] || "買えませんでした（" + (pre.error || pre.status) + "）");
  const p = pre.product;
  container.innerHTML = "";
  const span = document.createElement("span");
  const attrs = { "app-id": pre.app_id, checkout: "payment", amount: String(p.amount), currency: p.currency || "jpy", "token-type": "one_time", inline: "true", "allow-card-installments": "true" };
  for (const [k, v] of Object.entries(attrs)) span.setAttribute("data-" + k, v);
  container.appendChild(span);
  await loadWidget();
  return {
    product: p,
    async pay() {
      const iframe = container.querySelector("iframe");
      if (!iframe) throw new Error("決済の欄を読み込めませんでした。ページを開き直してください");
      let data;
      try { data = await window.UnivapayCheckout.submit(iframe); }
      catch (err) { throw new Error("決済が通りませんでした" + (err && err.message ? "：" + err.message : "")); }
      // 便 12c の直し：決済の番号はフォームに足される univapayChargeId から取る（返ってくる値の id はカードのトークンの番号で、決済の番号ではない）
      const form = container.closest("form");
      const fromInput = form && form.querySelector('input[name="univapayChargeId"]');
      const id = (fromInput && fromInput.value) || findId(data, ["chargeId", "charge_id"]);
      if (!id) throw new Error("決済の番号を受け取れませんでした。UnivaPay からの確認のメールが届いているかをご確認ください");
      onStatus && onStatus("決済を確かめています…");
      const r = await api("/api/checkout/confirm", { method: "POST", body: { email, product_id: p.id, charge_id: id, raw: data } });
      if (r.ok) return r;
      if (r.error === "charge_pending") throw new Error("決済の確認に時間がかかっています。確認できたらメールでお知らせします。");
      throw new Error("決済を確かめられませんでした（" + (r.error || r.status) + "）");
    },
  };
}

// 値段の見せ方（画面どうしで同じにする）
export function priceLabel(p) {
  const yen = Number(p.amount).toLocaleString() + " 円";
  if (p.kind === "subscription") return (p.period === "annually" ? "年 " : "月 ") + yen;
  if (p.kind === "installment") return "月 " + yen + " × " + p.installments + " 回（合計 " + (p.amount * p.installments).toLocaleString() + " 円）";
  return yen + (p.grant_days ? "（" + p.grant_days + " 日）" : "") + (p.card_installments ? "・カードの分割払いを選べます" : "");
}

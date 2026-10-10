// 便 12c：商品管理の強化の試験。カードの分割の欄・回数を決めた分割・継続課金の一覧と解約・失敗のメール。
// 走らせ方：node --test tests/billing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSell, FAILED_MAIL } from "../src/sell.js";

const env = { B_STORE: true, UNIVAPAY_APP_TOKEN: "tok", UNIVAPAY_APP_SECRET: "sec" };
const C1 = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";

function setup() {
  const st = fakeStore();
  const mails = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const bin3 = {
    PLAN: { name: "見本" },
    univapayState: () => ({ configured: true, store_id: "store1", app_id: "tok", mode: "test" }),
    async sendMail(e, person, m) { mails.push({ to: person.email, ...m }); await addEvent(e, person.id, "email_sent", { kind: m.kind, ...(m.extra || {}) }); return { result: "sent" }; },
  };
  const sell = makeSell({ db: st.db, addEvent, bin3, bridge: null, logInbound: async () => {} });
  st.table("customers").push({ id: C1, email: "a@example.com", name: "A" });
  return { st, sell, mails, addEvent };
}

test("回数を決めた分割の商品を足せる。回数は 2〜60。カードの分割は単発だけ", async () => {
  const { st, sell } = setup();
  assert.equal((await sell.setProduct(env, { id: "x5", kind: "installment", name: "コンサル 5 回", amount: 100000 }, "mcp")).error, "need_installments");
  assert.equal((await sell.setProduct(env, { id: "x5", kind: "installment", name: "コンサル 5 回", amount: 100000, installments: 61 }, "mcp")).error, "need_installments");
  const r = await sell.setProduct(env, { id: "x5", kind: "installment", name: "コンサル 5 回", amount: 100000, installments: 5, active: true }, "mcp");
  assert.equal(r.ok, true);
  assert.equal(st.table("b_products")[0].installments, 5);
  assert.equal((await sell.setProduct(env, { id: "x5", card_installments: true }, "mcp")).error, "card_installments_only_for_one_time");
  const one = await sell.setProduct(env, { id: "big", kind: "one_time", name: "シアラボ（1年）", amount: 500000, card_installments: true, active: true }, "mcp");
  assert.equal(one.ok, true);
  const shown = await sell.listForSite(env, "big");
  assert.equal(shown.products[0].card_installments, true);
  assert.equal((await sell.listForSite(env, "x5")).products[0].installments, 5, "分割の商品も申し込みのリンクで買える");
});

test("回数を決めた分割の決済：UnivaPay の合計の金額で合っていれば記録し、定期の始まりに回数を残す", async () => {
  const { st, sell } = setup();
  await sell.setProduct(env, { id: "x5", kind: "installment", name: "コンサル 5 回", amount: 100000, installments: 5, active: true }, "mcp");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: SUB, amount: 500000, currency: "jpy", period: "monthly", status: "current", metadata: { product_id: "x5" } }), { status: 200 });
  try {
    const r = await sell.confirm(env, { email: "a@example.com", product_id: "x5", subscription_id: SUB });
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally { globalThis.fetch = realFetch; }
  const started = st.table("events").find((e) => e.type === "subscription_started");
  assert.equal(started.payload.installments, 5);
  const list = await sell.listSubscriptions(env, {});
  assert.equal(list.count, 1);
  assert.equal(list.subscriptions[0].kind, "installment");
  assert.equal(list.subscriptions[0].payments, 1);
  assert.equal(list.subscriptions[0].status, "active");
});

test("継続課金の一覧：入金の回数と状態（回数どおり済み・失敗）。1 回目の入金の知らせは二重に数えない", async () => {
  const { st, sell } = setup();
  await sell.setProduct(env, { id: "x2", kind: "installment", name: "2 回払い", amount: 1000, installments: 2 }, "mcp");
  const t0 = Date.parse("2026-10-01T00:00:00Z");
  const at = (m) => new Date(t0 + m * 60e3).toISOString();
  st.table("events").push(
    { id: 1, customer_id: C1, type: "subscription_started", payload: { subscription_id: SUB, product_id: "x2", installments: 2, amount: 1000 }, occurred_at: at(0) },
    { id: 2, customer_id: C1, type: "subscription_payment", payload: { subscription_id: SUB }, occurred_at: at(1) },
  );
  let s = (await sell.listSubscriptions(env, {})).subscriptions[0];
  assert.equal(s.payments, 1);
  assert.equal(s.status, "active");
  st.table("events").push({ id: 3, customer_id: C1, type: "subscription_payment", payload: { subscription_id: SUB }, occurred_at: at(60 * 24 * 30) });
  s = (await sell.listSubscriptions(env, {})).subscriptions[0];
  assert.equal(s.payments, 2);
  assert.equal(s.status, "completed");
  st.table("events").push({ id: 4, customer_id: C1, type: "subscription_failed", payload: { subscription_id: SUB }, occurred_at: at(60 * 24 * 31) });
  const r = await sell.listSubscriptions(env, { status: "failed" });
  assert.equal(r.count, 1);
  assert.equal(r.subscriptions[0].email, "a@example.com");
});

test("解約：UnivaPay に DELETE を送り、出来事を積む。UnivaPay が断ったら積まない", async () => {
  const { st, sell } = setup();
  st.table("events").push({ id: 1, customer_id: C1, type: "subscription_started", payload: { subscription_id: SUB, product_id: "m" }, occurred_at: "2026-10-01T00:00:00Z" });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url, method: o.method }); return new Response(calls.length === 1 ? "x" : null, { status: calls.length === 1 ? 500 : 204 }); };
  try {
    const bad = await sell.cancelSubscription(env, { subscription_id: SUB }, "admin");
    assert.equal(bad.error, "univapay_cancel_failed");
    assert.equal(st.table("events").filter((e) => e.type === "subscription_canceled").length, 0);
    const ok = await sell.cancelSubscription(env, { subscription_id: SUB, reason: "本人の希望" }, "admin");
    assert.equal(ok.ok, true);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls[1].method, "DELETE");
  assert.match(calls[1].url, /\/stores\/store1\/subscriptions\/22222222/);
  assert.equal(st.table("events").filter((e) => e.type === "subscription_canceled").length, 1);
  assert.equal((await sell.listSubscriptions(env, {})).subscriptions[0].status, "canceled");
  assert.equal((await sell.cancelSubscription(env, { subscription_id: SUB }, "admin")).already, true);
});

test("課金が失敗したらメール。同じ契約には 1 日 1 通まで。商品の文があればそれを使う", async () => {
  const { st, sell, mails } = setup();
  await sell.setProduct(env, { id: "nx", kind: "subscription", name: "NEXT", amount: 11000, period: "monthly", failed_mail_subject: "{{product}} のお支払い" }, "mcp");
  st.table("events").push({ id: 1, customer_id: C1, type: "subscription_started", payload: { subscription_id: SUB, product_id: "nx" }, occurred_at: "2026-10-01T00:00:00Z" });
  const r1 = await sell.onSubscriptionFailed(env, C1, SUB);
  assert.equal(r1.mail, "sent");
  assert.equal(mails[0].kind, "billing_failed");
  assert.equal(mails[0].subject, "NEXT のお支払い");
  assert.match(mails[0].text, /A さん/);
  assert.equal(mails[0].text, FAILED_MAIL.body.replace("{{name}}", "A").replace("{{product}}", "NEXT").replace("{{amount}}", "月 11,000 円"));
  assert.equal((await sell.onSubscriptionFailed(env, C1, SUB)).mail, "already_today");
});

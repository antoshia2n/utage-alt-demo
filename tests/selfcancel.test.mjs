// 便 R3：生徒が自分で定期を止める。止めたあとも払った期間の終わりまで使える。分割は本人からは止めない。
// 走らせ方：node --test tests/selfcancel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSell, paidUntil } from "../src/sell.js";
import { desiredGrants } from "../src/bridge.js";

const env = { B_STORE: true, UNIVAPAY_APP_TOKEN: "tok", UNIVAPAY_APP_SECRET: "sec" };
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "33333333-3333-4333-8333-333333333333";
const SUB = "22222222-2222-4222-8222-222222222222";
const INST = "44444444-4444-4444-8444-444444444444";
const DAY = 864e5;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

function setup() {
  const st = fakeStore();
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const bin3 = { PLAN: { name: "見本" }, univapayState: () => ({ configured: true, store_id: "store1", app_id: "tok", mode: "test" }), async sendMail() { return { result: "sent" }; } };
  const sell = makeSell({ db: st.db, addEvent, bin3, bridge: null, logInbound: async () => {} });
  st.table("customers").push({ id: C1, email: "a@example.com", name: "A" }, { id: C2, email: "b@example.com", name: "B" });
  st.table("b_products").push(
    { id: "nx", name: "シアラボ NEXT", kind: "subscription", amount: 11000, currency: "jpy", period: "monthly", grants: ["shiarabo_basic"], active: true, sort: 1 },
    { id: "x3", name: "コンサル 3 回", kind: "installment", amount: 50000, currency: "jpy", installments: 3, grants: [], active: true, sort: 2 },
  );
  // A：月払いの定期（10 日前に始まった）と 3 回の分割（1 回払い済み）
  st.table("events").push(
    { id: 1, customer_id: C1, type: "subscription_started", payload: { subscription_id: SUB, product_id: "nx", amount: 11000, period: "monthly" }, occurred_at: ago(10) },
    { id: 2, customer_id: C1, type: "subscription_started", payload: { subscription_id: INST, product_id: "x3", amount: 50000, installments: 3 }, occurred_at: ago(5) },
  );
  return { st, sell };
}

function mockUnivaPay(status = 204) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url: String(url), method: o && o.method }); return new Response(status === 204 ? null : "ng", { status }); };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("払った期間の終わり：月払いは 1 か月後・月末はその月の末日・年払いは 1 年後・読めなければ null", () => {
  assert.equal(paidUntil("2026-10-10T03:00:00.000Z", "monthly"), "2026-11-10T03:00:00.000Z");
  assert.equal(paidUntil("2026-01-31T00:00:00.000Z", "monthly"), "2026-02-28T00:00:00.000Z");
  assert.equal(paidUntil("2026-10-10T00:00:00.000Z", "annually"), "2027-10-10T00:00:00.000Z");
  assert.equal(paidUntil("", "monthly"), null);
  assert.equal(paidUntil("2026-10-10T00:00:00Z", "weekly"), null);
});

test("ご契約の一覧：自分の分だけ。定期は次の課金日と止めるボタン、分割は残りの回数だけで止めるボタンなし", async () => {
  const { sell } = setup();
  const mine = await sell.mySubscriptions(env, { id: C1 });
  assert.equal(mine.subscriptions.length, 2);
  const sub = mine.subscriptions.find((s) => s.kind === "subscription");
  const inst = mine.subscriptions.find((s) => s.kind === "installment");
  assert.equal(sub.can_cancel, true);
  assert.equal(sub.next_charge_at.slice(0, 10), paidUntil(ago(10), "monthly").slice(0, 10));
  assert.ok(Date.parse(sub.next_charge_at) > Date.now());
  assert.equal(sub.price, "月 11,000 円");
  assert.equal(inst.can_cancel, false);
  assert.equal(inst.remaining, 2);
  assert.equal(inst.next_charge_at, null);
  assert.equal((await sell.mySubscriptions(env, { id: C2 })).subscriptions.length, 0, "ほかの人の契約は見えない");
});

test("本人が止める：UnivaPay の課金は今止め、払った期間の終わりまで会員のまま。期限は門番の表の期限にも入る", async () => {
  const { st, sell } = setup();
  assert.equal((await sell.entitlement(env, C1)).member, true);
  const m = mockUnivaPay(204);
  let r;
  try { r = await sell.cancelOwnSubscription(env, { id: C1, email: "a@example.com" }, { subscription_id: SUB }); } finally { m.restore(); }
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].method, "DELETE");
  assert.match(m.calls[0].url, /\/stores\/store1\/subscriptions\/22222222/);
  const ev = st.table("events").find((e) => e.type === "subscription_canceled");
  assert.equal(ev.payload.via, "self");
  assert.equal(ev.payload.keep_until, r.keep_until);
  assert.ok(Date.parse(r.keep_until) > Date.now() + 15 * DAY, "10 日前に払った月払いなら、あと約 20 日使える");
  const ent = await sell.entitlement(env, C1);
  assert.equal(ent.member, true, "期限までは会員のまま");
  const item = ent.items.find((x) => x.subscription_id === SUB);
  assert.equal(item.until, r.keep_until);
  assert.equal(desiredGrants(ent).find((g) => g.key === "shiarabo_basic").expires_at, r.keep_until, "門番の表の権利に期限が付く");
  const list = await sell.listSubscriptions(env, { status: "ending" });
  assert.equal(list.count, 1);
  assert.equal(list.subscriptions[0].status_label, "止めた（期限まで使える）");
  const again = await sell.cancelOwnSubscription(env, { id: C1 }, { subscription_id: SUB });
  assert.equal(again.already, true, "2 回押しても UnivaPay へは 1 回");
});

test("期限を過ぎたら会員ではなくなる", async () => {
  const { st, sell } = setup();
  st.table("events").push({ id: 9, customer_id: C1, type: "subscription_canceled", payload: { subscription_id: SUB, via: "self", keep_until: ago(1) }, occurred_at: ago(30) });
  const ent = await sell.entitlement(env, C1);
  assert.equal(ent.items.find((x) => x.subscription_id === SUB).status, "canceled");
  assert.equal((await sell.listSubscriptions(env, { status: "canceled" })).count, 1);
});

test("止められないもの：ほかの人の契約・分割・番号の形が違う。UnivaPay が断ったら積まず、中身は返さない", async () => {
  const { st, sell } = setup();
  assert.equal((await sell.cancelOwnSubscription(env, { id: C2 }, { subscription_id: SUB })).error, "not_found");
  assert.equal((await sell.cancelOwnSubscription(env, { id: C1 }, { subscription_id: INST })).error, "installment_not_cancelable");
  assert.equal((await sell.cancelOwnSubscription(env, { id: C1 }, { subscription_id: "x" })).error, "bad_subscription_id");
  const m = mockUnivaPay(500);
  let r;
  try { r = await sell.cancelOwnSubscription(env, { id: C1 }, { subscription_id: SUB }); } finally { m.restore(); }
  assert.deepEqual(r, { ok: false, error: "univapay_cancel_failed" });
  assert.equal(st.table("events").filter((e) => e.type === "subscription_canceled").length, 0);
});

test("管理側の解約はこれまでどおり、その場で使えなくなる", async () => {
  const { sell } = setup();
  const m = mockUnivaPay(204);
  try { assert.equal((await sell.cancelSubscription(env, { subscription_id: SUB }, "admin")).ok, true); } finally { m.restore(); }
  const item = (await sell.entitlement(env, C1)).items.find((x) => x.subscription_id === SUB);
  assert.equal(item.status, "canceled");
  assert.equal(item.until, null);
});

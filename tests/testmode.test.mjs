// 便 12d：試しの決済（UnivaPay の mode test）を会員と門番の権利に数えない試験。
// 走らせ方：node --test tests/testmode.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSell } from "../src/sell.js";
import { desiredGrants } from "../src/bridge.js";

const env = { B_STORE: true, UNIVAPAY_APP_TOKEN: "tok", UNIVAPAY_APP_SECRET: "sec" };
const T = "11111111-1111-4111-8111-111111111111"; // 試しで買った人
const L = "33333333-3333-4333-8333-333333333333"; // 本番で買った人
const SUB = "22222222-2222-4222-8222-222222222222";

function setup() {
  const st = fakeStore();
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const bin3 = { PLAN: { name: "見本" }, univapayState: () => ({ configured: true, app_id: "tok", mode: "test" }), async sendMail() { return { result: "sent" }; } };
  const sell = makeSell({ db: st.db, addEvent, bin3, bridge: null, logInbound: async () => {} });
  st.table("customers").push({ id: T, email: "t@example.com", name: "T" }, { id: L, email: "l@example.com", name: "L" });
  return { st, sell, addEvent };
}

async function annual(sell) {
  await sell.setProduct(env, { id: "annual", kind: "one_time", name: "シアラボ（1年）", amount: 500000, grant_days: 365, grants: ["shiarabo_basic"], active: true }, "mcp");
}

function oneTime(mode) {
  return { product_id: "annual", product_name: "シアラボ（1年）", kind: "one_time", amount: 500000, grants: ["shiarabo_basic"],
    grant_until: new Date(Date.now() + 365 * 864e5).toISOString(), charge_id: "c-" + mode, status: "successful", mode, via: "checkout" };
}

test("試しの単発の決済：記録は残るが、会員にならず、権利も付かない", async () => {
  const { sell, addEvent } = setup();
  await annual(sell);
  await addEvent(env, T, "purchase_completed", oneTime("test"));
  const ent = await sell.entitlement(env, T);
  assert.equal(ent.member, false);
  assert.equal(ent.status, "none");
  assert.deepEqual(ent.grants, []);
  assert.equal(ent.items.length, 1, "記録は消さない");
  assert.equal(ent.items[0].status, "test");
  assert.deepEqual(desiredGrants(ent), [], "門番の表へ書く行は 0");
});

test("本番の単発の決済は今までどおり会員になり、権利が付く", async () => {
  const { sell, addEvent } = setup();
  await annual(sell);
  await addEvent(env, L, "purchase_completed", oneTime("live"));
  const ent = await sell.entitlement(env, L);
  assert.equal(ent.member, true);
  assert.deepEqual(ent.grants, ["shiarabo_basic"]);
  assert.equal(desiredGrants(ent).length, 1);
});

test("mode の無い古い記録は今までどおり数える（本番の記録を外さない）", async () => {
  const { sell, addEvent } = setup();
  await annual(sell);
  const p = oneTime("live"); delete p.mode;
  await addEvent(env, L, "purchase_completed", p);
  assert.equal((await sell.entitlement(env, L)).member, true);
});

test("試しの定期・分割：始まりが試しなら、続いていても会員にならない", async () => {
  const { sell, addEvent } = setup();
  await sell.setProduct(env, { id: "x2", kind: "installment", name: "試し 2 回払い", amount: 1000, installments: 2, grants: ["shiarabo_basic"], active: true }, "mcp");
  await addEvent(env, T, "purchase_completed", { product_id: "x2", kind: "installment", amount: 2000, grants: ["shiarabo_basic"], subscription_id: SUB, mode: "test" });
  await addEvent(env, T, "subscription_started", { subscription_id: SUB, product_id: "x2", amount: 2000, installments: 2, mode: "test" });
  await addEvent(env, T, "subscription_payment", { subscription_id: SUB });
  const ent = await sell.entitlement(env, T);
  assert.equal(ent.member, false);
  assert.equal(ent.status, "none");
  assert.equal(ent.items.find((x) => x.subscription_id === SUB).status, "test");
  assert.deepEqual(desiredGrants(ent), []);
});

test("一覧の数（stats・find_person の元）：試しの人は会員に入らず、本番の人だけ入る", async () => {
  const { sell, addEvent } = setup();
  await annual(sell);
  await addEvent(env, T, "purchase_completed", oneTime("test"));
  await addEvent(env, L, "purchase_completed", oneTime("live"));
  const map = await sell.entitlementMap(env);
  assert.equal(map[T].member, false);
  assert.equal(map[L].member, true);
});

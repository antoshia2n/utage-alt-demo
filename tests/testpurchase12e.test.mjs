// 便 12e：試しの決済（mode test）をラベル・売れた数・配信の宛先・経路の数・設計図の数に入れない試験。記録は残る。
// 走らせ方：node --test tests/testpurchase12e.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSell } from "../src/sell.js";
import { makeDeliver } from "../src/deliver.js";
import { autoLabels } from "../src/connect.js";
import { partKeyOf } from "../src/plan.js";
import { isTestPurchase } from "../src/purchase.js";

const env = { B_STORE: true, UNIVAPAY_APP_TOKEN: "tok", UNIVAPAY_APP_SECRET: "sec" };
const T = "11111111-1111-4111-8111-111111111111"; // 試しで買った人
const L = "33333333-3333-4333-8333-333333333333"; // 本番で買った人
const O = "44444444-4444-4444-8444-444444444444"; // mode の無い古い記録の人
const buy = (mode) => ({ product_id: "annual", product_name: "シアラボ（1年）", kind: "one_time", amount: 500000, charge_id: "c-" + mode, status: "successful", ...(mode ? { mode } : {}) });

function setup() {
  const st = fakeStore();
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const bin3 = { PLAN: { name: "見本" }, univapayState: () => ({ configured: true, app_id: "tok", mode: "test" }), async sendMail() { return { result: "sent" }; } };
  const sell = makeSell({ db: st.db, addEvent, bin3, bridge: null, logInbound: async () => {} });
  for (const [id, email] of [[T, "t@example.com"], [L, "l@example.com"], [O, "o@example.com"]]) {
    st.table("customers").push({ id, email, name: id.slice(0, 1) });
    st.table("customer_summary").push({ id, email, name: id.slice(0, 1), source: "direct", note_member: false, created_at: "2026-10-01T00:00:00Z" });
  }
  return { st, sell, addEvent };
}

test("見分け：mode test だけが試し。mode の無い古い記録と live は本番", () => {
  assert.equal(isTestPurchase({ mode: "test" }), true);
  assert.equal(isTestPurchase({ mode: "live" }), false);
  assert.equal(isTestPurchase({}), false);
  assert.equal(isTestPurchase(null), false);
});

test("自動ラベル：試しの購入では「購入者」「買った:」が付かない。本番と古い記録では付く", () => {
  const person = { id: "p", source: "direct", created_at: new Date().toISOString() };
  const at = new Date().toISOString();
  const t = autoLabels({ person, events: [{ type: "purchase_completed", payload: buy("test"), occurred_at: at }], productNames: { annual: "シアラボ（1年）" } });
  assert.ok(!t.includes("購入者"));
  assert.ok(!t.some((x) => x.startsWith("買った:")));
  const l = autoLabels({ person, events: [{ type: "purchase_completed", payload: buy("live"), occurred_at: at }], productNames: { annual: "シアラボ（1年）" } });
  assert.ok(l.includes("購入者"));
  assert.ok(l.includes("買った:シアラボ（1年）"));
  const o = autoLabels({ person, events: [{ type: "purchase_completed", payload: buy(null), occurred_at: at }], productNames: {} });
  assert.ok(o.includes("購入者"), "mode の無い古い記録は本番として数える");
});

test("売れた数：試しは数えず、本番と古い記録だけ数える。記録は消えない", async () => {
  const { st, sell, addEvent } = setup();
  await sell.setProduct(env, { id: "annual", kind: "one_time", name: "シアラボ（1年）", amount: 500000, grant_days: 365, active: true }, "mcp");
  await addEvent(env, T, "purchase_completed", buy("test"));
  await addEvent(env, T, "purchase_completed", { ...buy("test"), charge_id: "c-test2" });
  await addEvent(env, L, "purchase_completed", buy("live"));
  await addEvent(env, O, "purchase_completed", buy(null));
  const r = await sell.listProducts(env);
  assert.equal(r.products.find((p) => p.id === "annual").sold, 2);
  assert.equal(st.table("events").filter((e) => e.type === "purchase_completed").length, 4, "試しの記録は残る");
});

test("配信の宛先：「買った」で絞ると試しの人は入らず、「買っていない」で絞ると入る", async () => {
  const { st, addEvent } = setup();
  const deliver = makeDeliver({
    db: st.db, addEvent, logInbound: async () => {}, bin3: { async sendMail() { return { result: "sent" }; } },
    forms: { valuesMap: async () => new Map() },
    sell: { entitlementMap: async () => ({}) }, mailcfg: { get: async () => ({ scope: "all" }) },
    connect: { labelMap: async () => new Map(), notifyAdmins: async () => ({ sent: 0 }), addLabel: async () => ({ ok: true }) },
  });
  await addEvent(env, T, "purchase_completed", buy("test"));
  await addEvent(env, L, "purchase_completed", buy("live"));
  const yes = await deliver.audience(env, { purchased: ["annual"] });
  assert.deepEqual(yes.people.map((p) => p.id), [L]);
  const no = await deliver.audience(env, { not_purchased: ["annual"] });
  assert.deepEqual(no.people.map((p) => p.id).sort(), [T, O].sort());
});

test("設計図の数：試しの購入は商品の部品に当たらない", () => {
  assert.equal(partKeyOf({ type: "purchase_completed", payload: buy("test") }), null);
  assert.equal(partKeyOf({ type: "purchase_completed", payload: buy("live") }), "product:annual");
});

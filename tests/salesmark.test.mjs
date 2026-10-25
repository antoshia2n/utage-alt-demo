// 決済受け口 便 1：今の定期の引き継ぎと、課金が通った月を売上管理で入金済みにする試験。
// 走らせ方：node --test tests/salesmark.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSalesMark, jstDay, lastPaymentOf } from "../src/salesmark.js";
import { makeBin3 } from "../src/bin3.js";

// 2026-10-25 の実物の形（金額・時刻・記録の並び）に合わせた見本。番号は見本
const KANAE = "db302461-5751-4d0a-82ac-adf357eafb0a";
const OTHER = "e1c206b9-210b-4523-afba-72940f9a362c";
const SUB = "11f0a2c3-9280-c984-91da-0b3f5a768de8";

function setup({ withSales = true, salesReply } = {}) {
  const st = fakeStore();
  const calls = [], notes = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation");
    return row;
  };
  const env = { B_STORE: true, MCP_SECRET: "s" };
  if (withSales) env.SALES = { async markPaid(a) { calls.push(a); return salesReply ? salesReply(a, calls.length) : { ok: true, status: 200, body: { ok: true, action: "updated" } }; } };
  const grants = [];
  const sm = makeSalesMark({ db: st.db, addEvent, logInbound: async () => {}, notify: async (e, m) => { notes.push(m); return { ok: true }; }, syncGrants: async (e, id) => { grants.push(id); return { ok: true, added: 0 }; } });
  st.table("customers").push({ id: KANAE, name: "皐月かなえ" }, { id: OTHER, name: "田中 洋" });
  st.table("b_products").push({ id: "next-premium", kind: "subscription", period: "monthly", amount: 22000 }, { id: "one", kind: "one_time", amount: 22000 });
  // 10/6 の二重の受け取り（1 分違い・同じ番号）と 9/6 の入金
  st.table("shr_billing_logs").push(
    { member_new_id: KANAE, event_type: "subscription_payment", amount: 22000, univa_charge_id: SUB, created_at: "2026-09-05T22:22:18+00:00" },
    { member_new_id: KANAE, event_type: "charge_finished", amount: 22000, univa_charge_id: "11f1c10a-885c-d16c-b5f4-efea1da9943e", created_at: "2026-10-05T22:17:23+00:00" },
    { member_new_id: KANAE, event_type: "subscription_payment", amount: 22000, univa_charge_id: SUB, created_at: "2026-10-05T22:17:24+00:00" },
    { member_new_id: KANAE, event_type: "subscription_payment", amount: 22000, univa_charge_id: SUB, created_at: "2026-10-05T22:18:25+00:00" },
  );
  return { st, sm, env, calls, notes, grants, addEvent };
}
const ITEM = { subscription_id: SUB, customer_id: KANAE, product_id: "next-premium", sales_contract_id: "4" };

test("日本時間の日付：UTC の 22 時台の課金は次の日", () => {
  assert.equal(jstDay("2026-10-05T22:17:24+00:00"), "2026-10-06");
  assert.equal(jstDay("2026-10-31T15:00:00Z"), "2026-11-01");
  assert.equal(jstDay("x"), null);
});

test("記録の最後の入金：その人の subscription_payment だけを見る。ほかの人の番号・記録に無い番号は断る", () => {
  const rows = [
    { member_new_id: KANAE, event_type: "subscription_payment", amount: 22000, univa_charge_id: SUB, created_at: "2026-10-05T22:18:25+00:00" },
    { member_new_id: KANAE, event_type: "subscription_payment", amount: 22000, univa_charge_id: SUB, created_at: "2026-09-05T22:22:18+00:00" },
  ];
  assert.deepEqual(lastPaymentOf(rows, SUB, KANAE), { ok: true, at: "2026-10-05T22:18:25+00:00", amount: 22000, count: 2 });
  assert.equal(lastPaymentOf(rows, SUB, OTHER).error, "owner_mismatch");
  assert.equal(lastPaymentOf([], SUB, KANAE).error, "not_in_billing_logs");
});

test("引き継ぎ：始まりを最後の入金の時刻で積み、契約の 10 月を課金の日で入金済みにする。2 回目は already", async () => {
  const { st, sm, env, calls, grants } = setup();
  const r = await sm.takeover(env, { items: [ITEM] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ev = st.table("events").find((e) => e.type === "subscription_started");
  assert.equal(ev.occurred_at, "2026-10-05T22:18:25+00:00");
  assert.equal(ev.actor, "mcp");
  assert.deepEqual([ev.payload.via, ev.payload.mode, ev.payload.sales_contract_id, ev.payload.amount, ev.payload.product_id], ["takeover", "live", "4", 22000, "next-premium"]);
  assert.deepEqual(calls, [{ contract_id: "4", year_month: "2026-10", paid_date: "2026-10-06", actual_amount: 22000 }]);
  assert.deepEqual(grants, [KANAE]);
  const again = await sm.takeover(env, { items: [ITEM] });
  assert.equal(again.results[0].already, true);
  assert.equal(st.table("events").filter((e) => e.type === "subscription_started").length, 1);
  assert.equal(calls.length, 1);
});

test("引き継ぎで断るもの：記録に無い定期・ほかの人・単発の商品・金額の違い・契約の番号の形。断ったら何も積まない", async () => {
  const { st, sm, env, calls } = setup();
  const r = await sm.takeover(env, { items: [
    { ...ITEM, subscription_id: "22222222-2222-4222-8222-222222222222" },
    { ...ITEM, customer_id: OTHER },
    { ...ITEM, product_id: "one" },
    { ...ITEM, sales_contract_id: "4a" },
  ] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.results.map((x) => x.error), ["not_in_billing_logs", "owner_mismatch", "not_subscription_product", "bad_contract_id"]);
  st.table("b_products")[0].amount = 15000;
  assert.equal((await sm.takeover(env, { items: [ITEM] })).results[0].error, "amount_mismatch");
  assert.equal(st.table("events").length, 0);
  assert.equal(calls.length, 0);
  assert.equal((await sm.takeover({ ...env, B_STORE: false }, { items: [ITEM] })).error, "demo_store");
});

test("入金済みにする：同じ定期の同じ月は 1 回だけ。売上管理で入金済みなら書かずに記録だけ", async () => {
  const replies = [{ ok: false, status: 409, error: "already_paid" }];
  const { st, sm, env, calls, notes } = setup({ salesReply: (a, n) => (n === 2 ? replies[0] : { ok: true, status: 200, body: { action: "created" } }) });
  await sm.takeover(env, { items: [ITEM] });
  // 11/6 の入金の知らせが 2 回（再送）
  const a = await sm.markMonth(env, KANAE, SUB, { at: "2026-11-05T22:17:00Z", amount: 22000 });
  assert.equal(a.ok, true);
  assert.equal(a.reason, "already_paid");
  const b = await sm.markMonth(env, KANAE, SUB, { at: "2026-11-05T22:18:00Z", amount: 22000 });
  assert.equal(b.reason, "already_marked");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { contract_id: "4", year_month: "2026-11", paid_date: "2026-11-06", actual_amount: 22000 });
  assert.equal(notes.length, 0, "入金済みだったときは知らせない");
  assert.deepEqual(st.table("events").filter((e) => e.type === "sales_marked").map((e) => e.payload.result), ["created", "already_paid"]);
});

test("書けなかったときは Naoki へ知らせる。失敗は済みに数えないので、もう一度呼べば書く。結びが無い定期も知らせる", async () => {
  const { sm, env, calls, notes, addEvent } = setup({ salesReply: (a, n) => (n === 2 ? { ok: false, status: 404, error: "not_found" } : { ok: true, body: { action: "updated" } }) });
  await sm.takeover(env, { items: [ITEM] });
  const a = await sm.markMonth(env, KANAE, SUB, { at: "2026-12-05T22:17:00Z", amount: 22000 });
  assert.equal(a.error, "not_found");
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /契約 4・2026-12/);
  const b = await sm.markMonth(env, KANAE, SUB, { at: "2026-12-05T23:17:00Z", amount: 22000 });
  assert.equal(b.marked, true);
  assert.equal(calls.length, 3);
  // 結びの無い定期（B で買った定期など）
  const SUB2 = "33333333-3333-4333-8333-333333333333";
  await addEvent(env, OTHER, "subscription_started", { subscription_id: SUB2, amount: 15000 });
  const c = await sm.markMonth(env, OTHER, SUB2, { at: "2026-11-20T22:00:00Z" });
  assert.equal(c.reason, "no_link");
  assert.equal(notes.length, 2);
  assert.match(notes[1].body, /15,000 円/);
  assert.equal(calls.length, 3);
});

test("売上管理への口が無いときは書かずに知らせる", async () => {
  const { sm, env, notes } = setup({ withSales: false });
  await sm.takeover(env, { items: [ITEM] });
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /書けなかった/);
});

test("UnivaPay の入金の知らせ：引き継いだ定期は売上管理へ、知らない定期は Naoki へ知らせる", async () => {
  const { st, sm, env, calls, addEvent } = setup();
  await sm.takeover(env, { items: [ITEM] });
  const unknown = [];
  const bin3 = makeBin3({
    db: st.db, addEvent, logInbound: async () => {}, json: (b, s = 200) => new Response(JSON.stringify(b), { status: s }), mailcfg: {},
    onSubEvent: async (e, id, type, subId, data) => (type === "subscription_payment" ? { sales: await sm.markMonth(e, id, subId, { at: "2026-11-05T22:17:00Z", amount: data && data.amount }) } : {}),
    onUnknownPayment: async (e, subId) => { unknown.push(subId); return true; },
  });
  const auth = await bin3.webhookAuth(env);
  const send = (data) => bin3.handleWebhook(new Request("https://x/api/univapay/webhook", { method: "POST", headers: { authorization: "Bearer " + auth }, body: JSON.stringify({ event: "subscription_payment", data }) }), env);
  const r = await (await send({ id: SUB, status: "current", amount: 22000, last_payment_date: "2026-11-06" })).json();
  assert.equal(r.recorded, true);
  assert.equal(r.grants.sales.marked, true);
  assert.deepEqual(calls[1], { contract_id: "4", year_month: "2026-11", paid_date: "2026-11-06", actual_amount: 22000 });
  const dup = await (await send({ id: SUB, status: "current", amount: 22000, last_payment_date: "2026-11-06" })).json();
  assert.equal(dup.duplicate, true);
  assert.equal(calls.length, 2);
  const u = await (await send({ id: "44444444-4444-4444-8444-444444444444", status: "current", amount: 15000 })).json();
  assert.equal(u.reason, "unknown_subscription");
  assert.equal(u.notified, true);
  assert.deepEqual(unknown, ["44444444-4444-4444-8444-444444444444"]);
});

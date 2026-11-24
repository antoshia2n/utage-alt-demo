// 先着の数（2026-11-24・人数限定の個別相談）：予約の合計が数に届いたら空きを出さず、予約も「full」で断る。取り消すとまた開く
// 走らせ方：node --test tests/booking-total.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeBooking } from "../src/booking.js";

const ACTORS = ["site", "admin", "mcp", "webhook", "seed"];
const env = { B_STORE: true };

function setup({ busy = [], calState = "ok" } = {}) {
  const st = fakeStore();
  const mails = [], after = [];
  const addEvent = async (e, cid, type, payload, actor = "site") => {
    assert.ok(ACTORS.includes(actor), "actor の決まりに外れる：" + actor);
    const [row] = await st.db(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation");
    return row;
  };
  let seq = 0;
  const registerPerson = async (e, b) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ""))) return { ok: false, error: "bad_email" };
    if (b.consent !== true) return { ok: false, error: "need_consent" };
    let p = st.table("customers").find((x) => x.email === b.email);
    const isNew = !p;
    if (!p) { p = { id: `0000000${++seq}-0000-4000-8000-000000000000`.slice(-36), email: b.email, name: b.name || "" }; st.table("customers").push(p); }
    return { ok: true, id: p.id, is_new: isNew };
  };
  const bin3 = { async sendMail(e, person, m) { mails.push({ to: person.email, ...m }); return { result: "sent" }; } };
  const bk = makeBooking({ db: st.db, addEvent, logInbound: async () => {}, bin3, registerPerson, busyBetween: async () => ({ state: calState, busy }), pagesOrigin: () => "https://lp.shia2n.jp", afterBooked: async (e, id, acts, ev) => { after.push({ id, acts, ev }); return { ok: true }; } });
  return { st, bk, mails, after };
}

test("先着の数：2 件まで。3 人目は full で断り、空きも出さない。取り消すとまた受け付ける", async () => {
  const { st, bk } = setup();
  const r = await bk.set(env, { title: "モニター募集", slug: "monitor-2", weekdays: [0, 1, 2, 3, 4, 5, 6], times: "10:00-22:00", min_notice_hours: 0, max_total: 2 }, "mcp");
  assert.equal(r.ok, true);
  let s = await bk.publicSlots(env, "monitor-2");
  assert.ok(!s.full);
  assert.equal((await bk.book(env, "monitor-2", { email: "a@example.com", consent: true, slot: s.slots[0].slot })).ok, true);
  s = await bk.publicSlots(env, "monitor-2");
  assert.equal((await bk.book(env, "monitor-2", { email: "b@example.com", consent: true, slot: s.slots[0].slot })).ok, true);
  s = await bk.publicSlots(env, "monitor-2");
  assert.equal(s.full, true);
  assert.equal(s.slots.length, 0);
  const third = await bk.book(env, "monitor-2", { email: "c@example.com", consent: true, slot: new Date(Date.now() + 3 * 86400e3).toISOString() });
  assert.equal(third.ok, false); assert.equal(third.error, "full");
  // 1 件取り消すと、また 1 枠開く
  const ev = st.table("events").find((e) => e.type === "consult_booked");
  st.table("events").push({ id: 9999, customer_id: ev.customer_id, type: "consult_canceled", payload: { slot: ev.payload.slot, type_id: ev.payload.type_id }, occurred_at: new Date().toISOString() });
  s = await bk.publicSlots(env, "monitor-2");
  assert.ok(!s.full);
  assert.ok(s.slots.length > 0);
});

test("先着の数：空なら上限なし・1〜500 の外は弾く", async () => {
  const { bk } = setup();
  assert.equal((await bk.set(env, { title: "x", slug: "x-1", max_total: 0 }, "mcp")).error, "bad_max_total");
  assert.equal((await bk.set(env, { title: "x", slug: "x-2", max_total: 501 }, "mcp")).error, "bad_max_total");
  const ok = await bk.set(env, { title: "x", slug: "x-3", max_total: null }, "mcp");
  assert.equal(ok.ok, true);
  const g = await bk.getSlots(env, { slug: "x-3" });
  assert.equal(g.max_total, undefined);
});

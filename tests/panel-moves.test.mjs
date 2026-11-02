// シアニンパネルの「今日の動き」（src/today.js の summarizeMoves）：名前とメールを返さない・テストの決済は数えない・新しい順
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeMoves, MOVE_TYPES } from "../src/today.js";

const ev = (type, payload, at, customer_id = "c") => ({ type, payload, occurred_at: at, customer_id });

test("5 種類を数え、テストの決済と対象外の出来事は数えない", () => {
  const r = summarizeMoves([
    ev("registered", { source: "x" }, "2026-11-02T00:10:00Z"),
    ev("purchase_completed", { product_name: "本講座", amount: 98000 }, "2026-11-02T01:21:00Z"),
    ev("purchase_completed", { product_name: "本講座", amount: 98000, mode: "test" }, "2026-11-02T01:22:00Z"),
    ev("form_submitted", { title: "面談申込" }, "2026-11-02T00:30:00Z"),
    ev("consult_booked", { slot: "2026-11-05T04:00:00Z" }, "2026-11-02T00:40:00Z"),
    ev("seminar_registered", { title: "言語化セミナー" }, "2026-11-02T00:50:00Z"),
    ev("login", {}, "2026-11-02T02:00:00Z"),
  ]);
  assert.deepEqual(r.counts, { registered: 1, purchase_completed: 1, form_submitted: 1, consult_booked: 1, seminar_registered: 1 });
  assert.deepEqual(r.items.map((i) => i.type), ["purchase_completed", "seminar_registered", "consult_booked", "form_submitted", "registered"]);
  assert.equal(r.items[0].detail, "98,000 円 「本講座」");
  assert.equal(r.items[0].time, "10:21");
  assert.equal(r.items[2].detail, "11/05 13:00 の枠");
  assert.equal(r.items[4].detail, "X から");
});

test("名前とメールは返さない（人を開くための番号だけ）", () => {
  const r = summarizeMoves([ev("registered", { source: "note", name: "山田", email: "a@b.jp" }, "2026-11-02T00:10:00Z", "p1")]);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["at", "detail", "label", "person_id", "time", "type"]);
  assert.ok(!JSON.stringify(r).includes("山田") && !JSON.stringify(r).includes("a@b.jp"));
  assert.equal(Object.keys(MOVE_TYPES).length, 5);
});

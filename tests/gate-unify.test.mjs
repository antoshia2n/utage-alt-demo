// 権利の一本化（2026-11-15）：会員かどうかと権利は門番の表（member_entitlement）だけで決まる
import test from "node:test";
import assert from "node:assert/strict";
import { gateView } from "../src/bridge.js";

test("B の決済だけで会員でも、門番の表に無ければ会員にしない", () => {
  const own = { member: true, status: "active", plan: "個別相談 3回分割", grants: [], items: [{ product_id: "consult-100k-x3" }] };
  const v = gateView(own, []);
  assert.equal(v.member, false);
  assert.equal(v.status, "purchased");
  assert.equal(v.plan, null);
  assert.equal(v.b_member, true);
  assert.deepEqual(v.grants, []);
  assert.equal(v.items.length, 1); // 買ったものの一覧は残す
});

test("門番の表に basic があれば、B で何も買っていなくても会員", () => {
  const v = gateView(undefined, ["shiarabo_basic"]);
  assert.equal(v.member, true);
  assert.equal(v.status, "active");
  assert.equal(v.plan, "しあらぼ会員");
  assert.deepEqual(v.grants, ["shiarabo_basic"]);
});

test("権利は門番の表のキーだけ（B の grants は足さない）", () => {
  const v = gateView({ member: true, plan: "NEXT", grants: ["shiarabo_next_premium"] }, ["shiarabo_basic", "shiarabo_pilot"]);
  assert.deepEqual(v.grants, ["shiarabo_basic", "shiarabo_pilot"]);
  assert.deepEqual(v.gate_keys, ["shiarabo_basic", "shiarabo_pilot"]);
  assert.equal(v.plan, "NEXT");
});

test("ゲストだけの人は会員にしない", () => {
  const v = gateView({ member: false, status: "none", grants: [] }, ["guest"]);
  assert.equal(v.member, false);
  assert.equal(v.status, "none");
});

// 生徒のホームの版（2026-11-04）：権利から lab・mem・mon を決める
import test from "node:test";
import assert from "node:assert/strict";
import { homeTier } from "../src/index.js";

test("管理者はシアラボ会員の版", () => assert.equal(homeTier(true, { grants: [] }), "lab"));
test("しあらぼ・先行・NEXT・ゲストはシアラボ会員の版", () => {
  for (const k of ["shiarabo_basic", "shiarabo_pilot", "shiarabo_next_premium", "shiarabo_next_standard", "guest"]) assert.equal(homeTier(false, { grants: [k] }), "lab", k);
});
test("モニターだけならモニターの版", () => assert.equal(homeTier(false, { grants: ["shiarabo_monitor"] }), "mon"));
test("メンシプだけならメンシプの版", () => assert.equal(homeTier(false, { grants: ["note_membership"] }), "mem"));
test("シアラボとメンシプの両方ならシアラボ会員の版", () => assert.equal(homeTier(false, { grants: ["note_membership", "shiarabo_basic"] }), "lab"));

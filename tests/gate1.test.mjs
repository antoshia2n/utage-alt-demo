// 関門 1：生徒の画面を開ける権利（会員の 4 つ・先行で試す・ゲスト・シアニン）。それ以外は「ご契約」だけ
// 走らせ方：node --test tests/gate1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appAccess, APP_ACCESS_KEYS, memberWaiting } from "../src/bridge.js";

test("開ける権利は guest と shiarabo_pilot の 2 つだけ（2026-10-29 統括：ゲスト → 先行 → 生徒の順）", () => {
  assert.deepEqual([...APP_ACCESS_KEYS].sort(), ["guest", "shiarabo_pilot"]);
});
test("会員・先行で試す・ゲスト・シアニンは full、それ以外は contract", () => {
  assert.equal(appAccess({ member: true, gate_keys: ["shiarabo_basic"] }), "contract");
  assert.equal(appAccess({ member: false, gate_keys: ["shiarabo_pilot"] }), "full");
  assert.equal(appAccess({ member: false, gate_keys: ["guest"] }), "full");
  assert.equal(appAccess({ member: false, gate_keys: [] }, true), "full");
  assert.equal(appAccess({ member: false, gate_keys: [] }), "contract");
  assert.equal(appAccess({ member: false, gate_keys: ["consult_single"] }), "contract");
  assert.equal(appAccess(null), "contract");
});
test("マイページ・教材の質問とメモ・添削ルーム・目標の口は、contract の人に 403 を返す", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const n = (src.match(/studentAccess\(env, customer, v\.email\)\)\.access !== "full"\) return json\(NOT_MEMBER, 403\)/g) || []).length;
  assert.equal(n, 4, "マイページ・lesson・room・目標（2026-10-30）の 4 か所");
  assert.ok(src.includes('access: "contract"'), "/api/me は contract の人に中身を返さない");
});

test("生徒の権利だけの人は「ご契約」＋準備中の印", () => {
  assert.equal(memberWaiting({ member: false, gate_keys: ["shiarabo_basic"] }), true);
  assert.equal(memberWaiting({ member: true, gate_keys: [] }), true);
  assert.equal(memberWaiting({ member: false, gate_keys: [] }), false);
  assert.equal(memberWaiting(null), false);
});

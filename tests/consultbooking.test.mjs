// 相談の予約（2026-11-05）：UTAGE の予約ページへ飛ぶボタンを出す相手
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultBookingUrl, CONSULT_BOOKING_URL } from "../src/index.js";

test("行き先は UTAGE の しあらぼ月次アンケート＋個別相談予約フォーム", () => {
  assert.equal(CONSULT_BOOKING_URL, "https://utage-system.com/event/eSxP0FgLWHKP/register");
});
test("管理者には出す", () => assert.equal(consultBookingUrl(true, { grants: [] }), CONSULT_BOOKING_URL));
test("しあらぼの生徒・NEXT・モニターには出す", () => {
  for (const k of ["shiarabo_basic", "shiarabo_pilot", "shiarabo_next_premium", "shiarabo_next_standard", "shiarabo_monitor"]) {
    assert.equal(consultBookingUrl(false, { grants: [k] }), CONSULT_BOOKING_URL, k);
  }
});
test("ゲスト・メンシプだけ・休止・お試し・権利なしには出さない", () => {
  for (const g of [["guest"], ["note_membership"], ["shiarabo_paused"], ["shiarabo_trial"], [], undefined]) {
    assert.equal(consultBookingUrl(false, g ? { grants: g } : null), null, String(g));
  }
});

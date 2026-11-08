// 2026-11-09：宛先をメールで絞った「テスト配信」は、動かしてから 24 時間で自動で止める
import test from "node:test";
import assert from "node:assert/strict";
import { isTestSelector, testExpired, TEST_TTL_HOURS } from "../src/deliver.js";

const NOW = Date.parse("2026-11-09T00:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

test("テスト配信の見分け：宛先がメールだけのとき", () => {
  assert.equal(isTestSelector({ emails: ["a@example.com"] }), true);
  assert.equal(isTestSelector({}), false);
  assert.equal(isTestSelector({ emails: [] }), false);
  assert.equal(isTestSelector({ emails: ["a@example.com"], labels: ["x"] }), false);
  assert.equal(isTestSelector(null), false);
});

test("24 時間を過ぎたテスト配信だけが期限切れ", () => {
  assert.equal(TEST_TTL_HOURS, 24);
  const base = { active: true, selector: { emails: ["a@example.com"] } };
  assert.equal(testExpired({ ...base, active_since: hoursAgo(25) }, NOW), true);
  assert.equal(testExpired({ ...base, active_since: hoursAgo(23) }, NOW), false);
  // 動かした時刻が無い古い行は、最後に直した時刻で見る
  assert.equal(testExpired({ ...base, active_since: null, updated_at: hoursAgo(30) }, NOW), true);
  // 本番の配信（宛先の絞りなし・条件つき）と止まっている配信は止めない
  assert.equal(testExpired({ active: true, selector: {}, active_since: hoursAgo(100) }, NOW), false);
  assert.equal(testExpired({ active: true, selector: { labels: ["x"] }, active_since: hoursAgo(100) }, NOW), false);
  assert.equal(testExpired({ ...base, active: false, active_since: hoursAgo(100) }, NOW), false);
});

// 2026-11-21：公開のページの予約の枠を「月のカレンダー → その日の時間 → 入力」にした試験。
// 走らせ方：node --test tests/booking-cal.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EMBED_JS } from "../src/pages.js";

test("予約の枠は月のカレンダーで日を選ぶ形（空き時間を 1 列に並べない）", () => {
  assert.match(EMBED_JS, /data-grid/);
  assert.match(EMBED_JS, /lab-bk-tlist/);
  assert.match(EMBED_JS, /data-back/);
  assert.doesNotMatch(EMBED_JS, /lab-slots/);
});

test("印 booking:slug はそのまま拾う", () => {
  assert.match(EMBED_JS, /v\.startsWith\("booking:"\)\) mountBooking\(el, v\.slice\(8\)\)/);
});

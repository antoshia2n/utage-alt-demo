// 便 R2 の見本（Merge しない）：自動の試験が落ちたときに、プルリクの画面に赤の印が出るかを確かめるため、わざと必ず落ちる。
import { test } from "node:test";
import assert from "node:assert/strict";

test("見本：わざと落とす（このプルリクは Merge しない）", () => {
  assert.equal(1 + 1, 3);
});

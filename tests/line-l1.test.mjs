// 便 L1（2026-11-06）：友だち追加のリンクは、決めたアカウントだけ（既定は college_ops）
import test from "node:test";
import assert from "node:assert/strict";
import { inviteOnFollow } from "../src/line.js";

test("既定は college_ops だけ。シアニンには送らない", () => {
  assert.equal(inviteOnFollow({}, "college_ops"), true);
  assert.equal(inviteOnFollow({}, "shianin"), false);
});

test("LINE_INVITE_ACCOUNTS で足せる（読点・空白区切り）", () => {
  assert.equal(inviteOnFollow({ LINE_INVITE_ACCOUNTS: "college_ops, shianin" }, "shianin"), true);
  assert.equal(inviteOnFollow({ LINE_INVITE_ACCOUNTS: "shianin" }, "college_ops"), false);
});

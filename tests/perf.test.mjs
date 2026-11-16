import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("重さ（2026-11-16）：ホームは使わないもの（Google カレンダー・TaskMaster・段階の計算）を読まない", () => {
  const t = read("../src/today.js");
  assert.ok(t.includes('calendarToday(env, day, home ? ["utage"] : null)') && t.includes("home ? SKIP : tasksToday(env, day)") && t.includes("home ? { lanes: [] } : board(env)"));
  assert.ok(read("../src/index.js").includes('{ home: url.searchParams.get("for") === "home" }'));
  assert.ok(read("../public/js/admin.js").includes('/api/admin/today?for=home'));
});
test("重さ：ログインと管理者の確かめは 60 秒まで手元で使い回し、券の期限を越えない", () => {
  const s = read("../src/index.js");
  assert.ok(s.includes("const USER_TTL = 60e3") && s.includes("verifyUserFresh(token, env)") && s.includes("Math.min(now + USER_TTL"));
  assert.ok(s.includes("keep(adminSeen, v.email, true"), "管理者だったときだけ覚える（外したらすぐ効く側に倒す）");
});
test("重さ：ホームは whoami と同時に読み始め、棚の一覧は 2 回読まない", () => {
  assert.ok(read("../public/js/admin.js").includes("homePre = location.hash ? null"));
  assert.ok(read("../public/js/skillshelf.js").includes("if (!loadingFirst) loadingFirst = load()"));
});
test("ごちゃごちゃ（2026-11-16）：スキルの詳細は 頭・生徒に出す・くわしく（畳む）の 3 段で、見せる相手のキーの行は出さない", () => {
  const ui = read("../public/js/skillshelf.js");
  assert.ok(ui.includes('<details class="more"><summary>くわしく') && ui.includes('class="vline"') && ui.includes('<details class="qa">'));
  assert.ok(!ui.includes("<dt>見せる相手</dt>"));
});

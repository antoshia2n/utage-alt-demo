// 2026-11-06：画面でできることは AI からもできる、の試験。
// src/index.js からシアニン用の画面の受け口を読み出し、どれも src/coverage.js に「受け持つ道具」か「AI に渡さない理由」があるかを確かめる
// 走らせ方：node --test tests/coverage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COVERAGE } from "../src/coverage.js";
import { DEFAULT_MODES } from "../src/guard.js";

const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf-8");
const from = SRC.indexOf("const TOOLS = [\n"), to = SRC.indexOf("\n];\n", from);
const TOOLS = new Function("SOURCES", "return " + SRC.slice(from + "const TOOLS = ".length, to + 3))(["x", "note", "youtube", "direct", "other"]);
const NAMES = new Set(TOOLS.map((t) => t.name));

function routes() {
  const keys = new Set();
  for (const m of SRC.matchAll(/path === "(\/api\/admin\/[^"]+)"(?: && method === "([A-Z]+)")?/g)) keys.add(`${m[2] || "ANY"} ${m[1]}`);
  for (const m of SRC.matchAll(/sub === "([a-z-]+)" && method === "([A-Z]+)"|method === "([A-Z]+)" && sub === "([a-z-]+)"/g)) keys.add(`${m[2] || m[3]} /api/admin/site/${m[1] || m[4]}`);
  for (const m of SRC.matchAll(/path\.match\((\/\^[^\n]*?admin[^\n]*?\/i?)\)/g)) keys.add(`MATCH ${m[1]}`);
  return [...keys];
}

test("画面の受け口は、どれも道具か理由が書いてある", () => {
  const r = routes();
  assert.ok(r.length > 100, "受け口を読み出せていない");
  assert.deepEqual(r.filter((k) => !COVERAGE[k]), [], "src/coverage.js に無い受け口");
});
test("書いてある道具はどれも実在し、権限の最初の値がある", () => {
  const used = Object.values(COVERAGE).filter(Array.isArray).flat();
  assert.deepEqual(used.filter((n) => !NAMES.has(n)), [], "無い道具");
  assert.deepEqual([...NAMES].filter((n) => !DEFAULT_MODES[n] && !["list_approvals", "get_approval", "list_permissions"].includes(n)), [], "権限の最初の値が無い道具");
});
test("書いてある受け口は、どれも今も src/index.js にある（消した受け口を残さない）", () => {
  const r = new Set(routes());
  assert.deepEqual(Object.keys(COVERAGE).filter((k) => !r.has(k)), []);
});
test("どの道具も、動かす処理（runTool）に行き先がある", () => {
  const run = SRC.slice(SRC.indexOf("async function runTool("));
  assert.deepEqual([...NAMES].filter((n) => !run.includes(`name === "${n}"`) && !run.includes(`"${n}"`)), []);
});

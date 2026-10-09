// 便 9：Lab OS の「使い方」のできることリストが、道具の一覧から欠けずに組めるかの試験。
// 走らせ方：node --test tests/guide.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGuide, sayProblem, sayOf, SCREENS } from "../src/guide.js";
import { DEFAULT_MODES } from "../src/guard.js";

// 道具の一覧は src/index.js の中にある（Worker の入口から名前つきで外へ出さないため）。
// 試験では、その配列の部分だけを読み出して組み立てる
const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf-8");
const from = SRC.indexOf("const TOOLS = [\n");
const to = SRC.indexOf("\n];\n", from);
if (from < 0 || to < 0) throw new Error("src/index.js に道具の一覧が見つからない");
const TOOLS = new Function("SOURCES", "return " + SRC.slice(from + "const TOOLS = ".length, to + 3))(["x", "note", "youtube", "direct", "other"]);

test("どの道具にも、画面に出す言い方とどの画面かが書いてある", () => {
  const bad = TOOLS.map((t) => [t.name, sayProblem(t)]).filter(([, p]) => p);
  assert.deepEqual(bad, [], "欄が空か、中の名前が混ざっている道具：" + JSON.stringify(bad));
});

test("画面の名前は Lab OS のメニューにあるものだけ", () => {
  for (const t of TOOLS) assert.ok(SCREENS.includes(t.screen), t.name + " の screen：" + t.screen);
});

// 便 20：SCREENS は手で書いた並びなので、メニューの組み替えで古い名前（つなぐ・connect など）が残ると上の試験は通ってしまう。
// 左のメニュー（public/admin.html の .side の data-view）を読み、SCREENS の名前がすべてそこにあるかを見る
const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf-8");
const SIDE = HTML.slice(HTML.indexOf('<nav class="side"'), HTML.indexOf("</nav>", HTML.indexOf('<nav class="side"')));
const MENU = [...SIDE.matchAll(/data-view="([a-z_]+)"/g)].map((m) => m[1]);

test("SCREENS の画面名は、いまの左のメニューにあるものだけ（ai_only を除く）", () => {
  assert.ok(MENU.length > 0, "左のメニューが読めない");
  const stale = SCREENS.filter((v) => v !== "ai_only" && !MENU.includes(v));
  assert.deepEqual(stale, [], "メニューに無い画面名：" + JSON.stringify(stale));
});

test("どの道具にも最初の権限がある（権限の表に行が入る）", () => {
  const noMode = TOOLS.map((t) => t.name).filter((n) => !DEFAULT_MODES[n]);
  assert.deepEqual(noMode, []);
});

test("権限の表から、AI に頼むと承認が要るかが入る", () => {
  const g = buildGuide(TOOLS, [{ tool: "queue_broadcast", mode: "approve" }, { tool: "find_person", mode: "auto" }]);
  assert.equal(g.count, TOOLS.length);
  assert.equal(g.missing, 0);
  assert.equal(g.rows.find((r) => r.name === "queue_broadcast").ai, "approve");
  assert.equal(g.rows.find((r) => r.name === "find_person").ai, "auto");
  assert.equal(g.rows.find((r) => r.name === "stats").ai, "none");
});

test("欄が空の道具は「説明がまだ無い」と出て、数に入る", () => {
  const g = buildGuide([{ name: "new_tool" }, { name: "x_y", screen: "people", say: "set_product を使う" }], []);
  assert.equal(g.missing, 2);
  assert.equal(g.rows[0].say, "（説明がまだ無い操作）");
  assert.equal(g.rows[0].screen, "ai_only");
  assert.equal(g.rows[1].problem, "say_has_inner_name");
});

test("承認の見出しは道具の一覧の言い方を使う", () => {
  assert.equal(sayOf(TOOLS, "queue_broadcast"), "一斉配信を送る");
  assert.equal(sayOf(TOOLS, "no_such_tool"), "（説明がまだ無い操作）");
});

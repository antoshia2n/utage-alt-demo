// スキルズの管理 3便目（2026-11-15）：生徒にスキルを見せる権利。走らせ方：node --test tests/skills.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skillKeys } from "../src/index.js";

test("シアニンは全部（null）、会員は shiarabo_basic として数える、会員でない人は見せない", () => {
  assert.equal(skillKeys({ admin: true, access: "full", ent: {} }), null);
  assert.deepEqual(skillKeys({ admin: false, access: "contract", ent: { member: false, gate_keys: ["shiarabo_basic"] } }), ["shiarabo_basic"]);
  assert.deepEqual(skillKeys({ admin: false, access: "contract", ent: { member: true, gate_keys: [] } }), ["shiarabo_basic"]);
  assert.deepEqual(skillKeys({ admin: false, access: "full", ent: { member: false, gate_keys: ["guest"] } }), ["guest"]);
  assert.equal(skillKeys({ admin: false, access: "contract", ent: { member: false, gate_keys: ["consult_single"] } }), false);
});
test("生徒用の版（stable）にもカードが入り、部品は /stable/js から読む", () => {
  const st = readFileSync(new URL("../public/stable/js/app.js", import.meta.url), "utf8");
  assert.ok(st.includes('import("/stable/js/skills.js")'));
  const sk = readFileSync(new URL("../public/stable/js/skills.js", import.meta.url), "utf8");
  assert.ok(sk.includes('"/stable/js/common.js"'));
});
test("サービスの結び SKILLS は shia2n-mcp の SkillsReader", () => {
  const w = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.ok(w.includes('{ "binding": "SKILLS", "service": "shia2n-mcp", "entrypoint": "SkillsReader" }'));
});
// スキルの棚の便 1（2026-11-16）：シアニン用の管理画面「スキル」
test("棚：左のメニュー・画面の器・VIEWS・題の横の説明がそろっている", () => {
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  assert.ok(html.includes('data-view="skills"'));
  assert.ok(html.includes('id="view-skills"') && html.includes('id="skills-host"'));
  const js = readFileSync(new URL("../public/js/admin.js", import.meta.url), "utf8");
  assert.match(js, /const VIEWS = \[[^\]]*"skills"/);
  assert.ok(js.includes('import { mountSkillShelf } from "/js/skillshelf.js"'));
  const g = readFileSync(new URL("../public/js/guide.js", import.meta.url), "utf8");
  assert.match(g, /\n\s+skills: "/);
});
test("棚の口は管理者の門の内側で、生徒の口（/api/me/skills）とは別", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const gate = src.indexOf('if (path.startsWith("/api/admin/")) {');
  const shelf = src.indexOf('path === "/api/admin/skills"');
  assert.ok(gate > 0 && shelf > gate, "管理者の門の後ろにある");
  assert.ok(src.includes("env.SKILLS.shelf(") && src.includes("env.SKILLS.saveRecipe(") && src.includes("env.SKILLS.addHypothesis(") && src.includes("env.SKILLS.updateHypothesis("));
});
test("棚の画面：@最新 は基本スキルだけ選べ、正本へのリンクを出す", () => {
  const ui = readFileSync(new URL("../public/js/skillshelf.js", import.meta.url), "utf8");
  assert.ok(ui.includes("isBase(u.skill)"));
  assert.ok(ui.includes("https://github.com/antoshia2n/shia2n-skills"));
  assert.ok(!ui.includes("/stable/"), "管理画面の部品で、生徒の版には入れない");
});

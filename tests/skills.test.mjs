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

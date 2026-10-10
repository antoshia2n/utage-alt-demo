import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("利用規約の頁は準備中ではなく、15 条と制定日と変更の知らせ方を持つ", () => {
  const t = read("public/legal/terms.html");
  assert.ok(!t.includes("準備中"));
  assert.equal((t.match(/<h2>第\d+条/g) || []).length, 15);
  assert.ok(t.includes("附則：2026年10月11日 制定"));
  assert.ok(t.includes("効力が生じる日"));
});

test("下の欄に法定の頁が 3 つそろう", () => {
  const pages = ["index", "app", "login", "register", "form", "line-link", "legal/privacy", "legal/tokushoho", "legal/terms"];
  for (const p of pages) {
    const h = read(`public/${p}.html`);
    for (const href of ["/legal/tokushoho", "/legal/privacy", "/legal/terms"]) {
      assert.ok(h.includes(`href="${href}"`), `${p} に ${href} が無い`);
    }
  }
});

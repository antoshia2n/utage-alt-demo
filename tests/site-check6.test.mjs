// 公式サイトの作り直し 便 6（2026-11-25 Naoki OK）：WEBページの基準 1.1 の点検で直した所
// 走らせ方：node --test tests/site-check6.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBED_JS } from "../src/pages.js";
import { homeEmbed } from "../src/homeembed.js";
import fs from "node:fs";

test("字の大きさは段階表だけ（流れる大きさを使わない）", () => {
  const src = homeEmbed.toString();
  assert.ok(!/font-size:clamp/.test(src), "ホームの部品");
  assert.ok(!/font-size:clamp/.test(fs.readFileSync(new URL("../src/blog.js", import.meta.url), "utf8")), "記事の画面");
});

test("本棚の本は、見えている字がそのまま読み上げの名前に入る（aria-label で上書きしない）", () => {
  const src = homeEmbed.toString();
  assert.ok(!src.includes('aria-label="\' + esc(s.name) + "向け'), "上書きの名前が残っていない");
  assert.ok(src.includes("本目 ") && src.includes("lab-sr"));
});

test("埋め込みのフォームのボタンは標準の言葉（既定は「送信」）。サイドバーと記事の登録の枠は、その場の言葉を付ける", () => {
  assert.ok(EMBED_JS.includes('|| "送信")'));
  assert.ok(homeEmbed.toString().includes("data-join-form data-lab-cta"));
  assert.ok(fs.readFileSync(new URL("../src/blog.js", import.meta.url), "utf8").includes('data-lab-cta="登録して続きを読む"'));
});

test("/admin の見本で、登録前の見え方に切り替えられる", () => {
  const admin = fs.readFileSync(new URL("../public/js/admin.js", import.meta.url), "utf8");
  assert.ok(admin.includes('data-as="guest"') && admin.includes('"as=guest"'));
});

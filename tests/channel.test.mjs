// 生徒の画面の 2 つの版の出し分け（src/channel.js）と、生徒用の版の作り方（tools/release.mjs）
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { appChannel, serveApp } from "../src/channel.js";
import { rewrite } from "../tools/release.mjs";

test("/app 以外は触らない", () => {
  assert.equal(appChannel("/admin", "", "lab_ch=next"), null);
  assert.equal(appChannel("/js/app.js", "", ""), null);
});

test("印が無ければ生徒用、印があればシアニン用", () => {
  assert.deepEqual(appChannel("/app", "", ""), { use: "stable", set: null });
  assert.deepEqual(appChannel("/app", "", "a=1; lab_ch=next"), { use: "next", set: null });
  assert.deepEqual(appChannel("/app", "", "lab_ch=nextx"), { use: "stable", set: null });
});

test("?ch= で印を付け外しする", () => {
  assert.deepEqual(appChannel("/app", "?ch=next", ""), { use: "next", set: "next" });
  assert.deepEqual(appChannel("/app", "?ch=stable", "lab_ch=next"), { use: "stable", set: "stable" });
});

const assets = (have) => ({ ASSETS: { fetch: async (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/stable/app" && !have) return new Response("nf", { status: 404 });
  return new Response(p, { status: 200 });
} } });
const U = new URL("https://lab.shia2n.jp/app");

test("生徒用は写しを出し、写しが無ければ最新を出す", async () => {
  let r = await serveApp(new Request(U), assets(true), U, { use: "stable", set: null });
  assert.equal(await r.text(), "/stable/app");
  assert.equal(r.headers.get("x-lab-channel"), "stable");
  r = await serveApp(new Request(U), assets(false), U, { use: "stable", set: null });
  assert.equal(await r.text(), "/app");
  assert.equal(r.headers.get("x-lab-channel"), "next");
});

test("印を付けるときはクッキーを付けて /app へ戻す", async () => {
  const r = await serveApp(new Request(U), assets(true), U, { use: "next", set: "next" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("set-cookie"), /^lab_ch=next;/);
  assert.equal(r.headers.get("location"), "/app");
  assert.match(r.headers.get("set-cookie"), /Domain=shia2n\.jp$/);
});

test("写しの中の部品の住所は写しの方を向く（/api・絵は共通のまま）", () => {
  assert.equal(rewrite('import { a } from "/js/common.js"; fetch("/api/me"); src="/icons/x.png"'), 'import { a } from "/stable/js/common.js"; fetch("/api/me"); src="/icons/x.png"');
  assert.equal(rewrite("await import(`/js/pay.js`)"), "await import(`/stable/js/pay.js`)");
});

test("今ある生徒用の版の中に、最新の部品を向いた住所が残っていない", () => {
  if (!existsSync("public/stable/app.html")) return;
  const html = readFileSync("public/stable/app.html", "utf8");
  assert.ok(!/["'(`]\/(js|css)\//.test(html));
  assert.ok(html.includes("/stable/js/app.js"));
});

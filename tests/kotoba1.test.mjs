// デザインの指示集 便 1（2026-11-27 Naoki OK）：公式サイトの棚 /kotoba（指示 40 枚・場面 5 つ・見本・コピーは無料会員）
// 走らせ方：node --test tests/kotoba1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { siteToken, personToken } from "../src/pages.js";
import { kotobaClient, kotobaCopyText } from "../src/kotoba.js";
import { KOTOBA_RULES, KOTOBA_SCENES, KOTOBA_SAMPLE, KOTOBA_VIEWS } from "../src/kotoba-data.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
const r2 = new Map();
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
  IMAGES: { get: async (k) => (r2.has(k) ? { text: async () => r2.get(k) } : null), put: async (k, v) => { r2.set(k, v); } },
};
const lp = (path, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request("https://lp.shia2n.jp" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const A = "cccccccc-2222-4333-8444-555555555555";
s.table("b_customers").push({ id: A, email: "a@example.com", name: "Aさん" });
s.table("b_events"); s.table("b_settings"); s.table("b_pages");

test("中身：指示 40 枚は番号が重ならず、見るところは 6 つのどれか。場面と見本が指す番号はすべてある", () => {
  assert.equal(KOTOBA_RULES.length, 40);
  assert.equal(new Set(KOTOBA_RULES.map((r) => r[0])).size, 40);
  for (const r of KOTOBA_RULES) { assert.ok(KOTOBA_VIEWS.includes(r[1]), r[0]); assert.ok(r[5] && r[6], r[0]); }
  const ids = new Set(KOTOBA_RULES.map((r) => r[0]));
  for (const sc of KOTOBA_SCENES) for (const n of sc.rules) assert.ok(ids.has(n), sc.id + ":" + n);
  for (const p of KOTOBA_SAMPLE.picks) assert.ok(ids.has(p.id));
});

test("中身：人・作品・ブランドの名前を指示に入れない（パクらない参考術 決まり 3）", () => {
  const bad = /ジブリ|ディズニー|ピクサー|新海|宮崎|Apple|Nike|Ghibli|Disney|Pixar/;
  for (const r of KOTOBA_RULES) assert.doesNotMatch(r.join(" "), bad, String(r[0]));
});

test("画面：誰でも開けて、指示 40 枚・場面 5 つ・見本が HTML に入っている。ログイン先は /kotoba に戻る", async () => {
  const r = await lp("/kotoba");
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.equal((page.match(/<article class="card"/g) || []).length, 40);
  assert.equal((page.match(/role="tab" id=/g) || []).length, 5);
  assert.match(page, /見本：この図解を見立てると/);
  assert.match(page, /[/]login[?]next=%2Fkotoba/);
  assert.match(page, /href="[/]xmas-gift"/);
  assert.doesNotThrow(() => new Function("(" + kotobaClient.toString() + ")"));
});

test("見分け：何も無い人はコピーできない。公式サイトのログインか、登録したその端末の印ならコピーできる", async () => {
  assert.equal((await (await lp("/api/p/kotoba/me")).json()).member, false);
  const cookie = "lab_site=" + encodeURIComponent(await siteToken(env, A));
  assert.equal((await (await lp("/api/p/kotoba/me", { headers: { cookie } })).json()).member, true);
  const u = await personToken(env, A);
  assert.equal((await (await lp("/api/p/kotoba/me", { headers: { "x-lab-u": u } })).json()).member, true);
  assert.equal((await (await lp("/api/p/kotoba/me", { headers: { "x-lab-u": "nope" } })).json()).member, false);
});

test("コピーの文：1 枚・場面のまとめ・見本のまとめを日本語と英語で組み立てる", () => {
  assert.equal(kotobaCopyText("rule", 7), KOTOBA_RULES.find((r) => r[0] === 7)[5]);
  assert.equal(kotobaCopyText("rule", 7, "en"), KOTOBA_RULES.find((r) => r[0] === 7)[6]);
  const sc = kotobaCopyText("scene", "thumb");
  assert.match(sc, /^このサムネを、次の点で直してください。/); assert.equal(sc.split("\n").length, 7);
  assert.match(kotobaCopyText("sample", "all"), /全体：/);
  assert.match(kotobaCopyText("sample", "all", "en"), /^Please revise this diagram/);
  assert.equal(kotobaCopyText("rule", 999), "");
});

test("会員サイトの住所では /kotoba を出さない（公式サイトだけの棚）", async () => {
  const r = await worker.fetch(new Request("https://lab.shia2n.jp/api/p/kotoba/me"), env, { waitUntil() {} });
  assert.notEqual(r.status, 200);
});

test("本番の組み立てが差し込む __name が無くても、画面へ渡す動きが止まらない（指示集・チャット・埋め込み）", async () => {
  const { EMBED_JS } = await import("../src/pages.js");
  assert.match(EMBED_JS, /^[(][(][)] => [{]\n  var __name = [(]f[)] => f;/);
  for (const p of ["/kotoba", "/chat"]) assert.match(await (await lp(p)).text(), /<script>var __name=window\.__name\|\|function[(]f[)][{]return f[}];[(]function/, p);
});

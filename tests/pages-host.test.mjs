// 便 12a：公開のページの住所（lp.shia2n.jp）の試験。Worker の入口（src/index.js）を、Supabase への fetch を手元の入れ物に向けて呼ぶ。
// 見ること：lp の住所ではシアニン用の画面・API・静的ファイルを返さない／ページと /api/p/ の下だけ返す／lab の住所は今までどおり
// 走らせ方：node --test tests/pages-host.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { previewToken } from "../src/pages.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + u.search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

let assetCalls = [];
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async (req) => { assetCalls.push(new URL(req.url).pathname); return new Response("ASSET " + new URL(req.url).pathname, { status: 200 }); } },
};
const call = (url, init) => worker.fetch(new Request(url, init), env, { waitUntil() {} });

const PAGE_ID = "55555555-5555-4555-8555-555555555555";
s.table("b_pages").push({ id: PAGE_ID, slug: "zukai-1111", title: "申込", purpose: "seminar", status: "published", latest_version: 2, published_version: 1 });
s.table("b_page_versions").push(
  { page_id: PAGE_ID, version: 1, html: "<html><body><h1>公開の版</h1></body></html>", parts: {} },
  { page_id: PAGE_ID, version: 2, html: "<html><body><h1>下書きの版</h1></body></html>", parts: {} },
);

test("lp の住所では、シアニン用の画面・生徒の画面・静的ファイルを返さない（ASSETS を呼ばない）", async () => {
  assetCalls = [];
  for (const p of ["/admin.html", "/admin", "/app.html", "/login.html", "/js/admin.js", "/sw.js", "/", "/index.html"]) {
    const r = await call("https://lp.shia2n.jp" + p);
    assert.equal(r.status, 404, p);
    assert.match(await r.text(), /ページが見つかりません/, p);
  }
  assert.deepEqual(assetCalls, []);
});

test("lp の住所では、シアニン用の API と AI の入口を返さない", async () => {
  for (const p of ["/api/admin/pages", "/api/me", "/api/config", "/mcp", "/api/health", "/r/0123456789ab"]) {
    const r = await call("https://lp.shia2n.jp" + p);
    assert.equal(r.status, 404, p);
  }
});

test("lp の住所：公開中の版を返し、下書きは見本の印があるときだけ。差し込みの仕掛けは JavaScript で返す", async () => {
  const r = await call("https://lp.shia2n.jp/zukai-1111?r=x-固定ポスト");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /公開の版/);
  assert.match(h, /src="[/]_lab[/]embed[.]js"/);
  assert.match(h, /data-lab="https:\/\/lab\.shia2n\.jp"/);
  const pv = await previewToken(env, PAGE_ID, 2);
  const d = await call("https://lp.shia2n.jp/zukai-1111?preview=" + pv);
  assert.match(await d.text(), /下書きの版/);
  assert.equal(d.headers.get("x-robots-tag"), "noindex");
  assert.equal((await call("https://lp.shia2n.jp/zukai-1111?preview=2.9999999999.00000000000000000000000000000000")).status, 404);
  assert.equal((await call("https://lp.shia2n.jp/no-such-page")).status, 404);
  const js = await call("https://lp.shia2n.jp/_lab/embed.js");
  assert.match(js.headers.get("content-type"), /javascript/);
});

test("lp の住所：見たを受け取って数える", async () => {
  const r = await call("https://lp.shia2n.jp/api/p/hit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: PAGE_ID, kind: "view", vid: "abcd1234efgh", r: "x-固定ポスト" }) });
  assert.equal(r.status, 200);
  assert.equal(s.t.b_page_hits.length, 1);
  assert.equal(s.t.b_page_hits[0].version, 1);
});

test("lab の住所は今までどおり静的ファイルを返し、lp のページは返さない", async () => {
  assetCalls = [];
  const r = await call("https://lab.shia2n.jp/admin.html");
  assert.equal(await r.text(), "ASSET /admin.html");
  await call("https://lab.shia2n.jp/zukai-1111");
  assert.deepEqual(assetCalls, ["/admin.html", "/zukai-1111"], "lab の住所ではページを組み立てず、静的ファイルに任せる");
  assert.equal((await call("https://lab.shia2n.jp/api/p/hit", { method: "POST", body: "{}" })).status, 404);
});

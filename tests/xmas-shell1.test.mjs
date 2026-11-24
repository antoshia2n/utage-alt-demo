// 便 X1（2026-11-24 Naoki OK）：ページの印 blog:latest-n と、公開の住所の /api/p/blog-latest の試験
// 見ること：印を読める／数の外は読めない印になる／公開中の記事だけ新しい順に n 本返る
// 走らせ方：node --test tests/xmas-shell1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { parseParts, EMBED_JS } from "../src/pages.js";

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
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("ASSET", { status: 200 }) },
};
const call = (url) => worker.fetch(new Request(url), env, { waitUntil() {} });

test("印 blog:latest を読む（数は 1〜24・省いてよい）", () => {
  const p = parseParts('<div data-lab-part="blog:latest"></div><div data-lab-part="blog:latest-12"></div><div data-lab-part="blog:latest-30"></div><div data-lab-part="blog:latest-0"></div>');
  assert.deepEqual(p.blogs, ["blog:latest", "blog:latest-12"]);
  assert.deepEqual(p.bad, ["blog:latest-30", "blog:latest-0"]);
});

test("embed.js が印 blog: をカードに変える", () => {
  assert.ok(EMBED_JS.includes("mountBlog"));
  assert.ok(EMBED_JS.includes("/api/p/blog-latest?n="));
  assert.ok(EMBED_JS.includes(".lab-bl{"));
});

test("/api/p/blog-latest は公開中の記事だけを新しい順に n 本返す", async () => {
  const t = s.table("b_blog_posts");
  t.push({ id: "a", slug: "old", title: "古い", status: "published", published_at: "2026-11-01T00:00:00Z", thumb_url: "https://x.example/a.png" });
  t.push({ id: "b", slug: "new", title: "新しい", status: "published", published_at: "2026-11-20T00:00:00Z" });
  t.push({ id: "c", slug: "draft", title: "下書き", status: "draft", published_at: null });
  const r = await call("https://lp.shia2n.jp/api/p/blog-latest?n=5");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.posts.map((p) => p.slug), ["new", "old"]);
  assert.equal(j.posts[1].thumb_url, "https://x.example/a.png");
  const one = await (await call("https://lp.shia2n.jp/api/p/blog-latest?n=1")).json();
  assert.equal(one.posts.length, 1);
});

// 便 X1（2026-11-24 Naoki OK）：ページの印 blog:latest-n と、公開の住所の /api/p/blog-latest の試験
// 見ること：印を読める／数の外は読めない印になる／公開中の記事だけ新しい順に n 本返る
// 走らせ方：node --test tests/xmas-shell1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { parseParts, EMBED_JS, splitGate, gateToken, personToken, previewToken } from "../src/pages.js";

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

// 便 X2（2026-11-25 Naoki OK）：登録した人だけの中身
const GATE_PAGE = "aaaaaaaa-1111-4222-8333-444444444444";
s.table("b_pages").push({ id: GATE_PAGE, slug: "gift", title: "特別コンテンツ", purpose: "signup", status: "published", latest_version: 2, published_version: 1 });
s.table("b_page_versions").push(
  { page_id: GATE_PAGE, version: 1, html: '<html><body><div data-lab-guest>登録してください</div><template data-lab-gate><a href="https://youtu.be/HIDDEN1">動画</a></template></body></html>', parts: {} },
  { page_id: GATE_PAGE, version: 2, html: '<html><body><template data-lab-gate>見本の中身</template></body></html>', parts: {} },
);

test("splitGate は template の中を外し、順に返す", () => {
  const r = splitGate('<p>a</p><template data-lab-gate><b>x</b></template><template data-lab-gate class="y">z</template>');
  assert.equal(r.html, '<p>a</p><div data-lab-gated="0" hidden></div><div data-lab-gated="1" hidden></div>');
  assert.deepEqual(r.blocks, ["<b>x</b>", "z"]);
});

test("公開のページには登録した人だけの中身が入らない", async () => {
  const r = await call("https://lp.shia2n.jp/gift");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(!h.includes("HIDDEN1"));
  assert.ok(h.includes('data-lab-gated="0"'));
  assert.ok(h.includes("data-lab-guest"));
});

test("/api/p/gate は印が無ければ閉じ、フォームの印か人の印があれば中身を返す", async () => {
  const none = await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}`)).json();
  assert.equal(none.locked, true);
  assert.equal(none.blocks, undefined);
  const bad = await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&g=1999999999.00000000000000000000000000000000`)).json();
  assert.equal(bad.locked, true);
  const g = await gateToken(env);
  const okG = await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&g=${encodeURIComponent(g)}`)).json();
  assert.equal(okG.locked, false);
  assert.ok(okG.blocks[0].includes("HIDDEN1"));
  const u = await personToken(env, "bbbbbbbb-1111-4222-8333-444444444444");
  const okU = await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&u=${encodeURIComponent(u)}`)).json();
  assert.equal(okU.locked, false);
  const old = await gateToken(env, -1000);
  assert.equal((await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&g=${encodeURIComponent(old)}`)).json()).locked, true);
});

test("見本の印では、印なしで見本の版の中身を返す", async () => {
  const pv = await previewToken(env, GATE_PAGE, 2);
  const r = await (await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&preview=${encodeURIComponent(pv)}`)).json();
  assert.equal(r.locked, false);
  assert.deepEqual(r.blocks, ["見本の中身"]);
  const nf = await call(`https://lp.shia2n.jp/api/p/gate?page=${GATE_PAGE}&preview=1.1.x`);
  assert.equal(nf.status, 404);
});

test("embed.js は印を覚えて中身を開く", () => {
  assert.ok(EMBED_JS.includes('store.set("lab_g", res.g)'));
  assert.ok(EMBED_JS.includes("/api/p/gate?"));
  assert.ok(EMBED_JS.includes("[data-lab-guest]"));
});

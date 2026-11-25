// 公式サイトの作り直し 便 2（2026-11-25 Naoki OK）：ホームの中身（スライダー・本棚・サイドバー）・カテゴリで絞った一覧
// 走らせ方：node --test tests/site-home2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { normalizeHome, HOME_DEFAULT, HOME_KEY } from "../src/sitehome.js";
import { parseParts, EMBED_JS } from "../src/pages.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  if (u.pathname === "/auth/v1/user") return new Response(JSON.stringify({ email: "admin@example.com" }), { status: 200 });
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
const lp = (path) => worker.fetch(new Request("https://lp.shia2n.jp" + path), env, { waitUntil() {} });
const admin = (path, body) => worker.fetch(new Request("https://lab.shia2n.jp" + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer adm", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
s.table("b_admins").push({ email: "admin@example.com" });
s.table("admins").push({ email: "admin@example.com" });

const t = s.table("b_blog_posts");
t.push({ id: "p1", slug: "roadmap", title: "個人で豊かになるロードマップ", status: "published", published_at: "2026-11-01T00:00:00Z", category: "マインドセット", body_html: "<p>本文</p>" });
t.push({ id: "p2", slug: "x-100", title: "X 攻略 入門編 100 ステップ", status: "published", published_at: "2026-11-02T00:00:00Z", category: "SNS攻略", body_html: '<div class="lab-yt"></div>' });
t.push({ id: "p3", slug: "draft1", title: "下書き", status: "draft", published_at: null, body_html: "" });

test("中身の確かめ：題・画像の説明・住所・数の上限", () => {
  assert.equal(normalizeHome(HOME_DEFAULT).ok, true);
  assert.equal(normalizeHome({ slides: [{ title: "" }] }).error, "need_title");
  assert.deepEqual(normalizeHome({ slides: [{ title: "a", img: "https://x.example/a.png" }] }), { ok: false, error: "need_alt", field: "slides.0.alt" });
  assert.equal(normalizeHome({ slides: [{ title: "a", href: "javascript:alert(1)" }] }).error, "bad_href");
  assert.equal(normalizeHome({ slides: [{ title: "a", href: "//evil.example" }] }).error, "bad_href");
  assert.equal(normalizeHome({ slides: Array.from({ length: 9 }, () => ({ title: "a" })) }).error, "too_many");
  assert.equal(normalizeHome({ shelves: [{ name: "a", posts: ["Bad Slug"] }] }).error, "bad_post");
  const ok = normalizeHome({ slides: [{ title: "a", href: "/xmas-gift" }, { title: "b", href: "#consult" }], shelves: [{ name: "棚", posts: ["roadmap", "roadmap", "x-100"] }], sidebar: { consult: { booking: "monitor" } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.home.shelves[0].posts, ["roadmap", "x-100"]);
});

test("保存する前は仮の中身。保存すると R2 に置き、/admin で読める", async () => {
  const g = await (await admin("/api/admin/site/home")).json();
  assert.equal(g.ok, true);
  assert.equal(g.home.is_default, true);
  assert.ok(g.posts.some((p) => p.slug === "roadmap" && p.published));
  const bad = await admin("/api/admin/site/home", { slides: [{ title: "" }], shelves: [], sidebar: {} });
  assert.equal(bad.status, 400);
  const home = { slides: [{ label: "お知らせ", title: "1 枚目", body: "", cta: "見る", href: "/xmas-gift", img: "", alt: "", note: "" }], shelves: [{ name: "これから始める方", who: "基本から", posts: ["x-100", "draft1", "roadmap"] }], sidebar: { join: { title: "無料会員登録", body: "", form: "", cta: "登録", href: "/xmas-gift" }, consult: { title: "個別相談", body: "", booking: "monitor", cta: "予約する", href: "#consult" }, membership: { title: "メンバーシップ", body: "", cta: "詳しく見る", href: "https://note.com/x" } } };
  const r = await (await admin("/api/admin/site/home", home)).json();
  assert.equal(r.ok, true);
  assert.ok(r2.has(HOME_KEY));
  assert.equal((await (await admin("/api/admin/site/home")).json()).home.slides[0].title, "1 枚目");
});

test("公開の面：本棚は公開中の記事だけを並びどおりに出し、動画を見分ける。残り枠は先着の数から引く", async () => {
  s.table("b_booking_types").push({ id: "bt1", slug: "monitor", title: "モニター", active: true, audience: "public", max_total: 5, minutes: 60 });
  s.table("b_events").push({ id: 9001, customer_id: "c1", type: "consult_booked", payload: { slot: "2026-12-01T01:00:00Z", type_id: "bt1" }, occurred_at: "2026-11-20T00:00:00Z" });
  const r = await (await lp("/api/p/home")).json();
  assert.equal(r.ok, true);
  assert.deepEqual(r.shelves[0].books.map((b) => [b.slug, b.kind]), [["x-100", "動画"], ["roadmap", "記事"]]);
  assert.equal(r.slides.length, 1);
  assert.equal(r.sidebar.consult.max, 5);
  assert.equal(r.sidebar.consult.left, 4);
});

test("ページの印：ホームの部品は読める印になり、embed.js が描く", () => {
  const p = parseParts('<div data-lab-part="slider:home"></div><div data-lab-part="shelf:home"></div><div data-lab-part="sidebar:home"></div><div data-lab-part="categories"></div><div data-lab-part="account"></div><div data-lab-part="slider:other"></div>');
  assert.deepEqual(p.site, ["slider:home", "shelf:home", "sidebar:home", "categories", "account"]);
  assert.deepEqual(p.bad, ["slider:other"]);
  assert.doesNotThrow(() => new Function(EMBED_JS));
  assert.ok(EMBED_JS.includes("homeMount(el, v)") && EMBED_JS.includes("一時停止") && EMBED_JS.includes("prefers-reduced-motion: reduce"));
});

test("ブログの一覧はカテゴリで絞れる", async () => {
  const h = await (await lp("/blog?cat=" + encodeURIComponent("SNS攻略"))).text();
  assert.ok(h.includes("X 攻略 入門編 100 ステップ"));
  assert.ok(!h.includes("個人で豊かになるロードマップ"));
  assert.ok(h.includes("すべての記事"));
  const all = await (await lp("/blog")).text();
  assert.ok(all.includes("個人で豊かになるロードマップ") && all.includes("X 攻略 入門編 100 ステップ"));
});

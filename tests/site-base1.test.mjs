// 公式サイトの作り直し 便 1（2026-11-25 Naoki OK）：公式サイトだけで効くログイン・ログインした人に会員限定を開く・会員サイトは無料会員に渡さない・記事のカテゴリ
// 走らせ方：node --test tests/site-base1.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { makeSiteLogin, safeNext, siteLoginHtml, SITE_CODE_TRIES } from "../src/sitelogin.js";
import { siteToken, readSiteToken, siteCodeHash } from "../src/pages.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
const authCreated = [];
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  if (u.pathname === "/auth/v1/admin/users") { authCreated.push(JSON.parse(init.body).email); return new Response("{}", { status: 200 }); }
  const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
};
const lp = (path, init = {}) => worker.fetch(new Request("https://lp.shia2n.jp" + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, body: init.body ? JSON.stringify(init.body) : undefined }), env, { waitUntil() {} });
const lab = (path, init = {}) => worker.fetch(new Request("https://lab.shia2n.jp" + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, body: init.body ? JSON.stringify(init.body) : undefined }), env, { waitUntil() {} });

const FREE = "aaaaaaaa-2222-4333-8444-555555555555", MEM = "bbbbbbbb-2222-4333-8444-555555555555";
s.table("b_customers").push({ id: FREE, email: "free@example.com", name: "無料さん" }, { id: MEM, email: "member@example.com", name: "生徒さん" });
s.table("member_entitlement").push(
  { id: "e1", member_id: FREE, key: "free", source: "manual", reason: "メール登録で自動（無料会員）" },
  { id: "e2", member_id: MEM, key: "free", source: "manual", reason: "メール登録で自動（無料会員）" },
  { id: "e3", member_id: MEM, key: "shiarabo_basic", source: "manual" },
);

// 確認コードの流れ（メールは控えに取る）
const mails = [];
// 本物の db と同じく、台帳の表は b_ の名前で持つ
const bdb = (e, m, p, b, pr) => s.db(e, m, p.replace(/^(customers|events)\b/, "b_$1"), b, pr);
const addEvent = async (e, cid, type, payload, actor) => (await bdb(e, "POST", "events", [{ customer_id: cid, type, payload, actor }], "return=representation"))[0];
const login = makeSiteLogin({ db: bdb, addEvent, mail: async (e, m) => { mails.push(m); return { ok: true }; }, codeHash: siteCodeHash, siteToken });
const codeOf = (m) => (m.text.match(/\n(\d{6})\n/) || [])[1];

test("台帳にいない住所にも同じ返事を返し、メールは送らない", async () => {
  const r = await login.sendCode(env, { email: "nobody@example.com" });
  assert.deepEqual(r, { ok: true });
  assert.equal(mails.length, 0);
  assert.equal((await login.sendCode(env, { email: "bad" })).error, "bad_email");
});

test("コードを送り、正しいコードで入れる。控えにはコードを生で残さない。使ったコードは二度と使えない", async () => {
  const r = await login.sendCode(env, { email: "Free@Example.com" });
  assert.equal(r.ok, true);
  const code = codeOf(mails.at(-1));
  assert.match(code, /^\d{6}$/);
  const ev = s.table("b_events").filter((e) => e.customer_id === FREE && e.type === "site_login_code").at(-1);
  assert.ok(ev.payload.hash && !JSON.stringify(ev.payload).includes(code));
  const wrong = await login.verify(env, { email: "free@example.com", code: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.error, "bad_code");
  assert.equal(wrong.left, SITE_CODE_TRIES - 1);
  const ok = await login.verify(env, { email: "free@example.com", code });
  assert.equal(ok.ok, true);
  assert.equal(await readSiteToken(env, ok.token), FREE);
  assert.equal((await login.verify(env, { email: "free@example.com", code })).error, "no_code");
  assert.ok(s.table("b_events").some((e) => e.customer_id === FREE && e.type === "site_login"));
});

test("1 つのコードは 5 回まで。続けて間違えると使えなくなる", async () => {
  await login.sendCode(env, { email: "member@example.com" });
  const code = codeOf(mails.at(-1));
  const bad = code === "999999" ? "888888" : "999999";
  for (let i = 0; i < SITE_CODE_TRIES; i++) assert.equal((await login.verify(env, { email: "member@example.com", code: bad })).error, "bad_code");
  assert.equal((await login.verify(env, { email: "member@example.com", code })).error, "too_many_tries");
});

test("送る数は 10 分に 3 通まで", async () => {
  await login.sendCode(env, { email: "member@example.com" });
  await login.sendCode(env, { email: "member@example.com" });
  const r = await login.sendCode(env, { email: "member@example.com" });
  assert.equal(r.error, "too_many");
});

test("戻り先は同じ住所の中だけ", () => {
  assert.equal(safeNext("/blog/x?y=1"), "/blog/x?y=1");
  assert.equal(safeNext("https://evil.example/"), "/");
  assert.equal(safeNext("//evil.example"), "/");
  assert.equal(safeNext("/\\evil"), "/");
  const h = siteLoginHtml({ next: '/a"><script>' });
  assert.ok(!h.includes('"><script>'));
});

test("公式サイトのログインの画面・ログインの状態・ログアウト", async () => {
  const r = await lp("/login?next=/gift");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(h.includes("確認コードを送る") && h.includes('const NEXT = "/gift"'));
  assert.ok(h.includes("しあらぼ会員サイトのログイン"));
  assert.deepEqual(await (await lp("/api/p/me")).json(), { ok: true, logged_in: false });
  const tok = await siteToken(env, FREE);
  const me = await (await lp("/api/p/me", { headers: { cookie: "a=1; lab_site=" + encodeURIComponent(tok) } })).json();
  assert.deepEqual(me, { ok: true, logged_in: true, name: "無料さん" });
  const out = await lp("/api/p/logout", { method: "POST" });
  assert.match(out.headers.get("set-cookie"), /lab_site=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax/);
});

test("公式サイトにログインした人には、登録した人だけの中身を返す", async () => {
  const PAGE = "cccccccc-2222-4333-8444-555555555555";
  s.table("b_pages").push({ id: PAGE, slug: "gift2", title: "会員限定", purpose: "signup", status: "published", latest_version: 1, published_version: 1 });
  s.table("b_page_versions").push({ page_id: PAGE, version: 1, html: "<html><body><template data-lab-gate>中身</template></body></html>", parts: {} });
  assert.equal((await (await lp(`/api/p/gate?page=${PAGE}`)).json()).locked, true);
  const tok = await siteToken(env, FREE);
  const r = await (await lp(`/api/p/gate?page=${PAGE}`, { headers: { cookie: "lab_site=" + encodeURIComponent(tok) } })).json();
  assert.equal(r.locked, false);
  assert.deepEqual(r.blocks, ["中身"]);
  const old = await siteToken(env, FREE, -1000);
  assert.equal((await (await lp(`/api/p/gate?page=${PAGE}`, { headers: { cookie: "lab_site=" + encodeURIComponent(old) } })).json()).locked, true);
});

test("会員サイトのログインの番号は、無料会員（free だけ）には作らない・生徒には作る", async () => {
  authCreated.length = 0;
  assert.equal((await lab("/api/login/prepare", { method: "POST", body: { email: "free@example.com" } })).status, 200);
  assert.equal((await lab("/api/login/prepare", { method: "POST", body: { email: "member@example.com" } })).status, 200);
  assert.deepEqual(authCreated, ["member@example.com"]);
});

test("記事のカテゴリ：公開中の記事だけを数え、本数の多い順に返す", async () => {
  const t = s.table("b_blog_posts");
  t.push({ id: "p1", slug: "a", title: "A", status: "published", published_at: "2026-11-01T00:00:00Z", category: "SNS攻略" });
  t.push({ id: "p2", slug: "b", title: "B", status: "published", published_at: "2026-11-02T00:00:00Z", category: "SNS攻略" });
  t.push({ id: "p3", slug: "c", title: "C", status: "published", published_at: "2026-11-03T00:00:00Z", category: "マインドセット" });
  t.push({ id: "p4", slug: "d", title: "D", status: "draft", published_at: null, category: "下書きだけ" });
  const r = await (await lp("/api/p/categories")).json();
  assert.deepEqual(r.categories, [{ name: "SNS攻略", count: 2 }, { name: "マインドセット", count: 1 }]);
  const l = await (await lp("/api/p/blog-latest?n=3")).json();
  assert.equal(l.posts[0].category, "マインドセット");
});

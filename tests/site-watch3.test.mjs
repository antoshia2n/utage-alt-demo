// 公式サイトの作り直し 便 3（2026-11-25 Naoki OK）：視聴ページ（記事の途中から会員限定・その場で開く・動画の操作・おすすめの順番・関連記事）
// 走らせ方：node --test tests/site-watch3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeWeb } from "../src/web.js";
import { makeBlog, splitMembers, ytPlayable, withToc, ytEmbed } from "../src/blog.js";
import { previewToken, readPreviewToken, gateToken, readGateToken, siteToken, readSiteToken, EMBED_JS } from "../src/pages.js";

const BODY = "<p>はじめに</p><h2>一つ目</h2><p>だれでも読める</p><h2>二つ目</h2><p>ここから会員限定の中身</p><h2>三つ目</h2><p>最後</p>";
const HOME = {
  ok: true,
  shelves: [
    { name: "これから始める方", who: "", books: [{ slug: "first", title: "1本目の記事", kind: "記事" }, { slug: "gengoka", title: "言語化のコツ", kind: "記事" }, { slug: "third", title: "3本目の記事", kind: "動画" }] },
    { name: "発信中の方", who: "", books: [{ slug: "gengoka", title: "言語化のコツ", kind: "記事" }] },
  ],
  sidebar: { join: { title: "無料会員登録", form: "join", href: "/xmas-gift" }, consult: { title: "個別相談", href: "#consult", cta: "予約する", left: 2, max: 5 }, membership: {} },
};
function setup({ home = HOME } = {}) {
  const s = fakeStore();
  s.table("settings"); s.table("b_forms"); s.table("b_blog_posts"); s.table("b_blog_hits"); s.table("b_web_parts"); s.table("b_web_part_hits");
  s.table("accounts").push({ id: "acc_1", name: "シアニン" });
  s.table("posts").push(
    { id: 101, account_id: "acc_1", title: "言語化のコツ", body: BODY, status: "published", post_type: "x_article", thumb_url: null, datetime: "2026-10-07T18:02", updated_at: "2026-10-07" },
    { id: 102, account_id: "acc_1", title: "メンシプ", body: "<p>有料</p>", status: "published", post_type: "membership", thumb_url: null, datetime: "2026-10-08T18:02", updated_at: "2026-10-08" },
    { id: 103, account_id: "acc_1", title: "3本目の記事", body: "<p>x</p>", status: "published", post_type: "x_article", thumb_url: null, datetime: "2026-10-09T18:02", updated_at: "2026-10-09" },
  );
  const web = makeWeb({ db: s.db, logInbound: async () => {}, readPersonToken: async () => null, laneOf: async () => null });
  const canOpen = async (env, { g, site }) => (await readGateToken(env, g)) || !!(await readSiteToken(env, site).catch(() => null));
  const blog = makeBlog({ db: s.db, logInbound: async () => {}, web, pagesOrigin: () => "https://lp.example", previewToken, readPreviewToken, home: home ? async () => home : null, canOpen });
  return { s, blog, env: { MCP_SECRET: "t" } };
}
async function published(blog, env, src = "101", slug = "gengoka") {
  const { post } = await blog.copy(env, { post_id: src, slug }, "a");
  await blog.save(env, { id: post.id, action: "publish" });
  return post;
}

test("分け目：N 番目の見出しから後ろを外す。見出しが無ければ外さない", () => {
  const { body } = withToc(BODY);
  const r = splitMembers(body, 2);
  assert.match(r.free, /だれでも読める/); assert.ok(!/会員限定の中身/.test(r.free));
  assert.match(r.rest, /^<h2 id="s2">二つ目/);
  assert.equal(splitMembers(body, 0).rest, "");
  assert.equal(splitMembers(body, 9).rest, "");
  assert.match(ytPlayable(ytEmbed("abcdefghijk")), /data-yt="abcdefghijk"><iframe src="https:[/][/]www[.]youtube-nocookie[.]com[/]embed[/]abcdefghijk[?]enablejsapi=1/);
});

test("会員限定にする所：見出しの番号で決める。無い番号・メンシプ記事には付けない。get_blog に見出しの並び", async () => {
  const { blog, env } = setup();
  const post = await published(blog, env);
  assert.deepEqual((await blog.get(env)).posts.find((p) => p.id === post.id).headings, ["一つ目", "二つ目", "三つ目"]);
  assert.equal((await blog.save(env, { id: post.id, members_from: 4 })).error, "no_such_heading");
  assert.equal((await blog.save(env, { id: post.id, members_from: -1 })).error, "bad_members_from");
  assert.equal((await blog.save(env, { id: post.id, members_from: 2 })).post.members_from, 2);
  const m = await blog.copy(env, { post_id: "102", slug: "mship" }, "a");
  assert.equal((await blog.save(env, { id: m.post.id, members_from: 1 })).error, "not_for_membership");
  assert.equal((await blog.save(env, { id: post.id, members_from: 0 })).post.members_from, 0);
});

test("記事の画面：途中から外し、登録の枠をその場に出す。目次に会員限定の印。続きは登録した人にだけ返す", async () => {
  const { blog, env } = setup();
  const post = await published(blog, env);
  await blog.save(env, { id: post.id, members_from: 2 });
  const html = (await blog.publicArticle(env, "gengoka")).html;
  assert.match(html, /だれでも読める/);
  assert.ok(!html.includes("ここから会員限定の中身"), "続きは HTML に入れない（自動で作った説明も、だれでも読める所だけにする）");
  assert.match(html, /class="lab-wall" data-lab-guest/);
  assert.match(html, /data-lab-part="form:join"/); // ホームの無料会員登録のフォームをその場に
  assert.match(html, /[/]login[?]next=%2Fblog%2Fgengoka/);
  assert.match(html, /data-lab-gated="0" hidden/);
  assert.match(html, /二つ目<\/a> <small>（会員限定）<\/small>/);
  assert.match(html, /"isAccessibleForFree":false/);
  // 続き：印なしは閉じたまま、登録の印・公式サイトのログインで開く、見本の印でも開く
  assert.deepEqual(await blog.gate(env, { page: post.id }), { ok: true, locked: true, count: 1 });
  const open = await blog.gate(env, { page: post.id, g: await gateToken(env) });
  assert.equal(open.locked, false); assert.match(open.blocks[0], /ここから会員限定の中身/);
  assert.equal((await blog.gate(env, { page: post.id, site: await siteToken(env, "00000000-0000-4000-8000-000000000001") })).locked, false);
  const pv = new URL((await blog.get(env)).posts.find((p) => p.id === post.id).preview_url).searchParams.get("preview");
  assert.equal((await blog.gate(env, { page: post.id, preview: pv })).locked, false);
  await blog.save(env, { id: post.id, action: "unpublish" });
  assert.equal((await blog.gate(env, { page: post.id, g: await gateToken(env) })).error, "not_found");
});

test("おすすめの順番：棚の何本目か・次の記事・進み具合の枠。?s= で棚を選ぶ。横に残り枠と関連記事", async () => {
  const { blog, env } = setup();
  await published(blog, env);
  await published(blog, env, "103", "third");
  let html = (await blog.publicArticle(env, "gengoka")).html;
  assert.match(html, /ホーム<\/a> ／ これから始める方 ／ 2本目/);
  assert.match(html, /2本目 ／ 全3本/);
  assert.match(html, /data-lab-order="first,gengoka,third"/);
  assert.match(html, /href="[/]blog[/]gengoka[?]s=1" data-slug="gengoka" aria-current="page"/);
  assert.match(html, /次の記事へ/); assert.match(html, /href="[/]blog[/]third[?]s=1">次の記事へ/);
  assert.match(html, /残り 2 名/); assert.match(html, /href="[/]#consult" data-lab-button="side-consult"/);
  assert.ok(!/関連記事/.test(html), "次の記事は関連記事に重ねない");
  html = (await blog.publicArticle(env, "gengoka", null, { s: "2" })).html;
  assert.match(html, /発信中の方 ／ 1本目/); assert.ok(!/次の記事へ/.test(html));
  assert.match(html, /関連記事<\/h2><ul><li><a href="[/]blog[/]third">/);
  // ホームの中身が読めないときは、棚なしの形（パンくずは記事一覧）
  const b2 = setup({ home: null });
  await published(b2.blog, b2.env);
  const plain = (await b2.blog.publicArticle(b2.env, "gengoka")).html;
  assert.match(plain, /ホーム<\/a> ／ <a href="[/]blog">記事一覧<\/a>/); assert.ok(!/data-lab-order/.test(plain));
});

test("見た目：v0.7 の頭と足。一覧にも同じ頭が出て、ログインの表示が動く", async () => {
  const { blog, env } = setup();
  await published(blog, env);
  const html = (await blog.publicArticle(env, "gengoka")).html;
  assert.match(html, /class="skip" href="#main"/); assert.match(html, /<main class="bw" id="main"/);
  assert.match(html, /data-lab-part="account"/); assert.match(html, /class="join" href="[/]xmas-gift"/);
  assert.match(html, /data-kind="blog"/); assert.match(html, /利用規約/);
  const idx = await blog.publicIndex(env);
  assert.match(idx, /data-kind="site"/); assert.match(idx, /<h1 class="ba-h1">記事一覧<\/h1>/);
});

test("embed.js：記事の動き（続きから再生・速さ・視聴済み）が入り、ページの番号が無い一覧でも動く", () => {
  assert.doesNotThrow(() => new Function(EMBED_JS));
  assert.ok(EMBED_JS.includes("続きから再生") && EMBED_JS.includes("再生速度") && EMBED_JS.includes("視聴済み "));
  assert.ok(EMBED_JS.includes('if (!PAGE && KIND !== "site") return;'));
  assert.ok(EMBED_JS.includes("if (PREVIEW || !PAGE) return;"));
});

test("本物の口：/api/p/gate はページで無ければ記事の続きを返す。記事の画面に本棚が出る", async () => {
  const { default: worker } = await import("../src/index.js");
  const st = fakeStore();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname !== "db.example") return realFetch(input, init);
    const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
    const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
    const out = await st.db({}, init.method || "GET", pq, init.body ? JSON.parse(init.body) : undefined, "");
    return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const r2 = new Map([["site/home.json", JSON.stringify({ slides: [], shelves: [{ name: "これから始める方", who: "", posts: ["gengoka"] }], sidebar: { join: { title: "無料会員登録", form: "join", href: "/xmas-gift" }, consult: {}, membership: {} } })]]);
    const env = {
      SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
      B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
      PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp", ASSETS: { fetch: async () => new Response("asset") },
      IMAGES: { get: async (k) => (r2.has(k) ? { text: async () => r2.get(k) } : null), put: async (k, v) => { r2.set(k, v); } },
    };
    st.table("b_web_parts"); st.table("b_pages");
    st.table("b_blog_posts").push({ id: "11111111-1111-4111-8111-111111111111", slug: "gengoka", title: "言語化のコツ", status: "published", published_at: "2026-11-01T00:00:00Z", body_html: withToc(BODY).body.replace(/ id="s\d"/g, ""), members_from: 2, description: "説明" });
    const lp = (path, headers = {}) => worker.fetch(new Request("https://lp.shia2n.jp" + path, { headers }), env, { waitUntil() {} });
    const page = await (await lp("/blog/gengoka")).text();
    assert.match(page, /これから始める方 ／ 1本目/); assert.match(page, /data-lab-part="form:join"/);
    assert.ok(!page.includes("ここから会員限定の中身"));
    const locked = await (await lp("/api/p/gate?page=11111111-1111-4111-8111-111111111111")).json();
    assert.equal(locked.locked, true);
    const g = await gateToken(env);
    const open = await (await lp("/api/p/gate?page=11111111-1111-4111-8111-111111111111&g=" + encodeURIComponent(g))).json();
    assert.equal(open.locked, false); assert.match(open.blocks[0], /ここから会員限定の中身/);
  } finally { globalThis.fetch = realFetch; }
});

test("便 4：埋め込みのフォームは名前の札と欄が結び付き、ボタンの文字をページから決められ、間違いを読み上げる", () => {
  assert.ok(EMBED_JS.includes('-email">メールアドレス'));
  assert.ok(EMBED_JS.includes('data-lab-cta') && EMBED_JS.includes('role="alert"') && EMBED_JS.includes('aria-invalid'));
  assert.ok(EMBED_JS.includes("（任意）"));
});

// 便 S3（2026-11-07）：公開サイトのブログの試験
// 走らせ方：node --test tests/blog.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeWeb } from "../src/web.js";
import { makeBlog, cleanHtml, insertMid, withToc, plainText } from "../src/blog.js";
import { previewToken, readPreviewToken } from "../src/pages.js";
import { DEFAULT_MODES } from "../src/guard.js";

const BODY = "<p>はじめに</p><h2>一つ目</h2><p>a</p><p>b</p><h2>二つ目</h2><p>c</p><h2>三つ目</h2><p>d<img src=\"https://img.example/x.png\"></p>";
function setup() {
  const s = fakeStore();
  s.table("settings"); s.table("b_forms"); s.table("b_blog_posts"); s.table("b_blog_hits"); s.table("b_web_part_hits");
  s.table("accounts").push({ id: "acc_1", name: "シアニン" });
  s.table("posts").push(
    { id: 101, account_id: "acc_1", title: "言語化のコツ", body: BODY, status: "published", post_type: "x_article", thumb_url: null, datetime: "2026-10-07T18:02", updated_at: "2026-10-07" },
    { id: 102, account_id: "acc_1", title: "予約の記事", body: "<p>x</p>", status: "reserved", post_type: "x_article", datetime: "2026-11-09T18:02", updated_at: "2026-11-01" },
  );
  s.table("b_web_parts").push(
    { id: "gift-a", name: "特典A", place: "mid", rules: { new: { title: "無料で", href: "https://x.example/a" } }, active: true, sort: 0, created_at: "1" },
    { id: "side-a", name: "横", place: "side", rules: { _default: { title: "横の枠", href: "https://x.example/s" } }, active: true, sort: 1, created_at: "2" },
    { id: "gift-b", name: "特典B", place: "free", rules: { new: { title: "別の特典", href: "https://x.example/b" } }, active: true, sort: 2, created_at: "3" },
  );
  const web = makeWeb({ db: s.db, logInbound: async () => {}, readPersonToken: async () => null, laneOf: async () => null });
  const blog = makeBlog({ db: s.db, logInbound: async () => {}, web, pagesOrigin: () => "https://lp.example", previewToken, readPreviewToken });
  return { s, blog, env: { MCP_SECRET: "t" } };
}

test("本文の掃除：危ないものを落とし、入れてよい形と https の住所だけ残す", () => {
  const out = cleanHtml('<p style="color:red" onclick="x()">本文<script>alert(1)</script></p><a href="javascript:alert(1)">悪</a><a href="https://ok.example/?a=1&amp;b=2">良</a><img src="http://x/y.png"><img src="https://x/y.png" onerror="z()"><iframe src="https://e"></iframe><span style="font-size:17px">字</span>');
  assert.ok(!/script|onclick|onerror|iframe|javascript|style=/i.test(out), out);
  assert.match(out, /<p>本文<\/p>/);
  assert.match(out, /<a>悪<\/a>/);
  assert.match(out, /<a href="https:[/][/]ok\.example[/]\?a=1&amp;b=2" rel="noopener nofollow" target="_blank">良<\/a>/);
  assert.equal((out.match(/<img/g) || []).length, 1);
  assert.match(out, /字/); assert.ok(!/<span/.test(out));
  assert.ok(!/<img|onerror/.test(cleanHtml('<a title="<img src=x onerror=alert(1)>">t</a>'))); // 属性の中のタグも残らない
  assert.equal(plainText("<p>a&amp;b</p><p>c</p>"), "a&b c");
});

test("本文の途中：2 つ目の見出しの前。見出しが足りなければ 3 つ目の段落の後、それも無ければ最後", () => {
  assert.equal(insertMid("<h2>1</h2><p>a</p><h2>2</h2>", "[X]"), "<h2>1</h2><p>a</p>[X]<h2>2</h2>");
  assert.equal(insertMid("<p>1</p><p>2</p><p>3</p><p>4</p>", "[X]"), "<p>1</p><p>2</p><p>3</p>[X]<p>4</p>");
  assert.equal(insertMid("<p>1</p>", "[X]"), "<p>1</p>[X]");
  const t = withToc("<h2>A&amp;B</h2><h2>C</h2>");
  assert.deepEqual(t.toc, [{ id: "s1", text: "A&B" }, { id: "s2", text: "C" }]);
  assert.match(t.body, /<h2 id="s2">C<\/h2>/);
});

test("写す：公開済みの記事だけ・1 回だけ・住所の名前は 1 つ。下書きで入り、外には出ない", async () => {
  const { blog, env } = setup();
  const src = await blog.sources(env, { account: "acc_1" });
  assert.deepEqual(src.posts.map((p) => p.id), ["101"]); // 予約の記事は出さない
  assert.equal((await blog.copy(env, { post_id: "102", slug: "yoyaku" })).error, "source_not_published");
  assert.equal((await blog.copy(env, { post_id: "101", slug: "Bad Slug" })).error, "bad_slug");
  const r = await blog.copy(env, { post_id: "101", slug: "gengoka-kotsu" }, "a");
  assert.equal(r.ok, true);
  assert.equal(r.post.status, "draft");
  assert.equal(r.post.thumb_url, "https://img.example/x.png"); // サムネが無ければ本文の最初の画像
  assert.match(r.post.description, /^はじめに/);
  assert.equal((await blog.copy(env, { post_id: "101", slug: "other" })).error, "already_copied");
  assert.equal((await blog.sources(env, {})).posts[0].blog_slug, "gengoka-kotsu");
  assert.equal(await blog.publicArticle(env, "gengoka-kotsu"), null); // 下書きは出ない
  const pv = await blog.publicArticle(env, "gengoka-kotsu", new URL(r.post.preview_url).searchParams.get("preview"));
  assert.equal(pv.preview, true);
  assert.match(pv.html, /noindex/);
  assert.equal(await blog.publicArticle(env, "gengoka-kotsu", "1.9999999999.00000000000000000000000000000000"), null);
});

test("公開：部品を場所で差し込む（特典は記事ごと・無ければ本文の途中の部品）。一覧と地図に出る。見たを数える", async () => {
  const { blog, env, s } = setup();
  const { post } = await blog.copy(env, { post_id: "101", slug: "gengoka-kotsu" }, "a");
  assert.equal((await blog.save(env, { id: post.id, gift_part: "nope" })).error, "part_not_found");
  assert.equal((await blog.save(env, { id: post.id, action: "publish" })).post.status, "published");
  let page = (await blog.publicArticle(env, "gengoka-kotsu")).html;
  const mid = page.indexOf('data-lab-part="part:gift-a"'), h2b = page.indexOf('<h2 id="s2">');
  assert.ok(mid > 0 && mid < h2b, "既定の特典は 2 つ目の見出しの前");
  assert.match(page, /class="lab-side" data-lab-part="part:side-a"/);
  assert.match(page, /lab-toc/); // 見出しが 3 つで目次
  assert.match(page, /"@type":"Article"/);
  assert.match(page, /data-page="[0-9a-f-]{36}"/);
  await blog.save(env, { id: post.id, gift_part: "gift-b" });
  page = (await blog.publicArticle(env, "gengoka-kotsu")).html;
  assert.match(page, /part:gift-b/); assert.ok(!/part:gift-a/.test(page));
  assert.equal((await blog.save(env, { id: post.id, slug: "new-name" })).error, "slug_locked");
  assert.equal((await blog.save(env, { id: post.id, action: "remove" })).error, "unpublish_first");
  assert.match(await blog.publicIndex(env), /言語化のコツ/);
  assert.match(await blog.sitemap(env), /\/blog\/gengoka-kotsu/);
  assert.equal((await blog.hit(env, { kind: "view", page: post.id, vid: "abcdefgh1234" })).ok, true);
  assert.equal((await blog.hit(env, { kind: "view", page: post.id, vid: "abcdefgh1234" })).ok, true);
  assert.equal((await blog.get(env)).posts[0].week_viewers, 1); // 同じ端末は 1 人
  await blog.save(env, { id: post.id, action: "unpublish" });
  assert.equal(await blog.publicArticle(env, "gengoka-kotsu"), null);
  assert.equal((await blog.hit(env, { kind: "view", page: post.id, vid: "abcdefgh1234" })).error, "not_found");
});

test("写し直す：コンテンツくんの今の本文に入れ替える。手で入れたサムネは残す", async () => {
  const { blog, env, s } = setup();
  const { post } = await blog.copy(env, { post_id: "101", slug: "gengoka-kotsu" }, "a");
  await blog.save(env, { id: post.id, thumb_url: "https://mine.example/t.png" });
  s.table("posts").find((p) => p.id === 101).body = "<h2>新しい</h2><p>本文</p>";
  const r = await blog.save(env, { id: post.id, action: "refresh" });
  assert.equal(r.post.thumb_url, "https://mine.example/t.png");
  const pv = await blog.publicArticle(env, "gengoka-kotsu", new URL(r.post.preview_url).searchParams.get("preview"));
  assert.match(pv.html, /新しい/);
});

test("AI の道具：読むのは自動、公開や直しは承認", () => {
  assert.equal(DEFAULT_MODES.get_blog, "auto");
  assert.equal(DEFAULT_MODES.list_blog_sources, "auto");
  assert.equal(DEFAULT_MODES.copy_to_blog, "auto");
  assert.equal(DEFAULT_MODES.save_blog_post, "approve");
});

// 公開サイトの便 C（2026-11-24）：YouTube の埋め込み・メンシプ記事（本文を写さず note へのボタン）・頭のページ
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHtml, ytId, membershipBody, membershipLink, isMembershipBody, makeBlog } from "../src/blog.js";
import { fakeStore } from "./fake-store.mjs";

test("YouTube の住所から番号を取る（watch・youtu.be・shorts・embed）。ほかの住所は空", () => {
  assert.equal(ytId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(ytId("https://youtu.be/dQw4w9WgXcQ?t=10"), "dQw4w9WgXcQ");
  assert.equal(ytId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(ytId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(ytId("http://youtu.be/dQw4w9WgXcQ"), "");
  assert.equal(ytId("https://evil.example/watch?v=dQw4w9WgXcQ"), "");
});

test("本文の掃除：YouTube の iframe と住所だけの段落は埋め込みに、ほかの iframe は消す", () => {
  const h = cleanHtml('<p>前</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="x()"></iframe><p><a href="https://youtu.be/abcdefghijk">動画</a></p><p>https://www.youtube.com/watch?v=ABCDEFGHIJK</p><iframe src="https://evil.example/x"></iframe><p>文の中の <a href="https://youtu.be/zzzzzzzzzzz">リンク</a> は埋め込まない</p>');
  assert.equal((h.match(/class="lab-yt"/g) || []).length, 3);
  assert.ok(h.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"));
  assert.ok(h.includes("youtube-nocookie.com/embed/abcdefghijk"));
  assert.ok(h.includes("youtube-nocookie.com/embed/ABCDEFGHIJK"));
  assert.ok(!h.includes("evil.example"));
  assert.ok(!h.includes("onload"));
  assert.ok(h.includes('href="https://youtu.be/zzzzzzzzzzz"'));
});

test("メンシプ記事の本文の欄：住所があるときだけボタン。住所を読み戻せる", () => {
  assert.ok(isMembershipBody(membershipBody("")));
  assert.ok(!membershipBody("").includes("<a "));
  const b = membershipBody("https://note.com/x/n/n123");
  assert.equal(membershipLink(b), "https://note.com/x/n/n123");
  assert.equal(membershipLink("<p>ふつうの記事</p>"), "");
});

function setup() {
  const st = fakeStore();
  st.table("posts").push(
    { id: 101, account_id: "acc_1", title: "メンシプの記事", body: "<p>無料の書き出し</p><h2>有料の見出し</h2><p>有料の中身</p>", status: "published", post_type: "membership", updated_at: "2026-11-01T00:00:00Z" },
    { id: 102, account_id: "acc_1", title: "X の記事", body: "<p>本文</p><p>https://youtu.be/dQw4w9WgXcQ</p>", status: "published", post_type: "x_article", updated_at: "2026-11-01T00:00:00Z" },
  );
  const blog = makeBlog({ db: st.db, logInbound: async () => {}, web: { getLook: async () => ({ look: {} }), listParts: async () => [] }, pagesOrigin: () => "https://lp.shia2n.jp", previewToken: async () => "tok", readPreviewToken: async () => 1 });
  return { st, blog, env: {} };
}

test("メンシプ記事を写す：有料の中身は写さない・住所が無いと公開できない・住所を入れると公開できる", async () => {
  const { st, blog, env } = setup();
  const c = await blog.copy(env, { post_id: "101", slug: "mship-1" });
  assert.equal(c.ok, true);
  const row = st.table("b_blog_posts")[0];
  assert.ok(!row.body_html.includes("有料の中身"));
  assert.ok(!row.body_html.includes("有料の見出し"));
  assert.ok(row.description.startsWith("無料の書き出し"));
  assert.equal(c.post.kind, "membership");
  assert.equal((await blog.save(env, { id: row.id, action: "publish" })).error, "need_link_url");
  assert.equal((await blog.save(env, { id: row.id, link_url: "http://note.com/x" })).error, "bad_link_url");
  const s = await blog.save(env, { id: row.id, link_url: "https://note.com/x/n/n123" });
  assert.equal(s.ok, true); assert.equal(s.post.link_url, "https://note.com/x/n/n123");
  assert.equal((await blog.save(env, { id: row.id, action: "publish" })).ok, true);
  // 写し直しても住所は残り、有料の中身は入らない
  assert.equal((await blog.save(env, { id: row.id, action: "refresh" })).ok, true);
  const after = st.table("b_blog_posts")[0];
  assert.equal(membershipLink(after.body_html), "https://note.com/x/n/n123");
  assert.ok(!after.body_html.includes("有料の中身"));
});

test("ふつうの記事には note の住所を入れられない・本文の YouTube は埋め込みになる", async () => {
  const { st, blog, env } = setup();
  const c = await blog.copy(env, { post_id: "102", slug: "x-1" });
  assert.equal(c.ok, true);
  assert.ok(st.table("b_blog_posts")[0].body_html.includes("lab-yt"));
  assert.equal((await blog.save(env, { id: c.post.id, link_url: "https://note.com/x" })).error, "not_membership");
});

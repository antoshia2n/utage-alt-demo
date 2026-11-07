// 便 T2（2026-11-07 Naoki OK 23:05）：期間限定の公開の試験。期限を過ぎたら、終わったあとのページか決まった終了の画面を出す。
//   下書きの見え方（preview）は期限に関係なく見られる。ページの中の data-lab-countdown に残りが入る（埋め込みに期限を渡す）。
// 走らせ方：node --test tests/page-close-t2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePages, parseJstTime, isClosed, closedHtml, EMBED_JS, previewToken } from "../src/pages.js";
import { DEFAULT_MODES } from "../src/guard.js";
import { fakeStore } from "./fake-store.mjs";

function setup() {
  const s = fakeStore();
  const env = { B_STORE: true, MCP_SECRET: "test-secret", PAGES_ORIGIN: "https://lp.shia2n.jp", PUBLIC_ORIGIN: "https://lab.shia2n.jp" };
  const pages = makePages({ db: s.db, addEvent: async () => ({}), logInbound: async () => {}, forms: null, sell: null });
  const page = (id, slug, title, html) => {
    s.table("b_pages").push({ id, slug, title, purpose: "signup", status: "published", latest_version: 1, published_version: 1 });
    s.table("b_page_versions").push({ page_id: id, version: 1, html, parts: {} });
  };
  page("00000000-0000-4000-8000-0000000000a1", "x-roadmap", "X収益化ロードマップ動画", "<html><body><p>動画</p><span data-lab-countdown></span></body></html>");
  page("00000000-0000-4000-8000-0000000000a2", "x-roadmap-end", "公開終了のご案内", "<html><body><p>終わりました・メンシプへ</p></body></html>");
  return { ...s, env, pages };
}
const A1 = "00000000-0000-4000-8000-0000000000a1";

test("時刻の読み方：日本時間の「2026-11-12 23:59」と時差つきの ISO。読めないものは null", () => {
  assert.equal(parseJstTime("2026-11-12 23:59"), "2026-11-12T14:59:00.000Z");
  assert.equal(parseJstTime("2026-11-12T23:59:30"), "2026-11-12T14:59:30.000Z");
  assert.equal(parseJstTime("2026-11-12T14:59:00Z"), "2026-11-12T14:59:00.000Z");
  assert.equal(parseJstTime("2026-11-12T23:59:00+09:00"), "2026-11-12T14:59:00.000Z");
  assert.equal(parseJstTime("来週"), null);
  assert.equal(parseJstTime("2026/11/12"), null);
});

test("期限の前はいつものページ。埋め込みに期限が渡り、残りを書く仕掛けが入っている", async () => {
  const st = setup();
  const r = await st.pages.setClose(st.env, { page_id: A1, closes_at: new Date(Date.now() + 3 * 864e5).toISOString() }, "mcp");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.closed_now, false);
  const out = await st.pages.serve(st.env, "x-roadmap");
  assert.match(out.html, /<p>動画<\/p>/);
  assert.match(out.html, /data-closes="\d{4}-\d{2}-\d{2}T/);
  assert.match(EMBED_JS, /data-lab-countdown/);
  const list = await st.pages.listPages(st.env);
  const p = list.pages.find((x) => x.slug === "x-roadmap");
  assert.match(p.closes_label, /（日本時間）$/);
  assert.equal(p.closed_now, false);
});

test("期限を過ぎたら、終わったあとのページを出す。無ければ決まった終了の画面（題名だけ・中身は出さない）", async () => {
  const st = setup();
  await st.pages.setClose(st.env, { page_id: A1, closes_at: "2026-01-01 00:00", closed_to: "x-roadmap-end" }, "mcp");
  const out = await st.pages.serve(st.env, "x-roadmap");
  assert.match(out.html, /終わりました・メンシプへ/);
  assert.equal(out.closed_from, "x-roadmap");
  await st.pages.setClose(st.env, { page_id: A1, closed_to: "" }, "mcp");
  const out2 = await st.pages.serve(st.env, "x-roadmap");
  assert.equal(out2.closed, true);
  assert.match(out2.html, /公開は終了しました/);
  assert.match(out2.html, /X収益化ロードマップ動画/);
  assert.doesNotMatch(out2.html, /<p>動画<\/p>/);
  assert.match(out2.html, /noindex/);
});

test("終わったあとのページが止まっている・期限切れなら、決まった終了の画面に落ちる（回り続けない）", async () => {
  const st = setup();
  await st.pages.setClose(st.env, { page_id: A1, closes_at: "2026-01-01 00:00", closed_to: "x-roadmap-end" }, "mcp");
  st.table("b_pages").find((p) => p.slug === "x-roadmap-end").status = "stopped";
  assert.equal((await st.pages.serve(st.env, "x-roadmap")).closed, true);
  const end = st.table("b_pages").find((p) => p.slug === "x-roadmap-end");
  end.status = "published"; end.closes_at = "2026-01-01T00:00:00.000Z"; end.closed_to = "x-roadmap";
  assert.equal((await st.pages.serve(st.env, "x-roadmap")).closed, true);
});

test("下書きの見え方は期限に関係なく見られる", async () => {
  const st = setup();
  await st.pages.setClose(st.env, { page_id: A1, closes_at: "2026-01-01 00:00" }, "mcp");
  const out = await st.pages.serve(st.env, "x-roadmap", await previewToken(st.env, A1, 1));
  assert.equal(out.preview, true);
  assert.match(out.html, /<p>動画<\/p>/);
});

test("期限を外すと元どおり。読めない時刻・自分を指す・無いページは断る", async () => {
  const st = setup();
  await st.pages.setClose(st.env, { page_id: A1, closes_at: "2026-01-01 00:00" }, "mcp");
  await st.pages.setClose(st.env, { page_id: A1, closes_at: "" }, "mcp");
  assert.match((await st.pages.serve(st.env, "x-roadmap")).html, /<p>動画<\/p>/);
  assert.equal((await st.pages.setClose(st.env, { page_id: A1, closes_at: "あした" }, "mcp")).error, "bad_closes_at");
  assert.equal((await st.pages.setClose(st.env, { page_id: A1, closed_to: "x-roadmap" }, "mcp")).error, "closed_to_self");
  assert.equal((await st.pages.setClose(st.env, { page_id: A1, closed_to: "nai" }, "mcp")).error, "closed_to_not_found");
  assert.equal((await st.pages.setClose(st.env, { page_id: "00000000-0000-4000-8000-000000000000" }, "mcp")).error, "page_not_found");
});

test("終了の画面はページの題名の記号を外して出す", () => {
  assert.match(closedHtml({ title: "<b>x</b>" }), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(isClosed({ closes_at: null }), false);
  assert.equal(isClosed({ closes_at: "2000-01-01T00:00:00Z" }), true);
});

test("道具は承認が要る。表の列を足す SQL がある", () => {
  assert.equal(DEFAULT_MODES.set_page_close, "approve");
  const sql = readFileSync(new URL("../supabase/bt2_page_close.sql", import.meta.url), "utf8");
  assert.match(sql, /closes_at timestamptz/);
  assert.match(sql, /closed_to text/);
});

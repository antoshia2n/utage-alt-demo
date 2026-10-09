// 便 12b：売るページの試験。商品の「決済のあとに移るページ」と、ファネル構築の段と線。
// 走らせ方：node --test tests/sale.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeSell } from "../src/sell.js";
import { buildParts, buildEdges } from "../src/plan.js";

const env = { B_STORE: true };
function setup() {
  const st = fakeStore();
  const sell = makeSell({ db: st.db, addEvent: async () => {}, bin3: {}, bridge: {}, logInbound: async () => {} });
  st.table("b_pages").push({ id: "11111111-1111-4111-8111-111111111111", slug: "shiarabo-thanks", status: "published", title: "ご入会ありがとう" });
  return { st, sell };
}

test("商品を足すときに、決済のあとに移るページを結べる。無いページと形の違う名前は弾く", async () => {
  const { st, sell } = setup();
  const r = await sell.setProduct(env, { id: "shiarabo-annual", kind: "one_time", name: "シアラボ（1 年）", amount: 500000, grant_days: 365, grants: ["shiarabo_basic"], thanks_page_slug: "shiarabo-thanks" }, "mcp");
  assert.equal(r.ok, true);
  assert.equal(st.table("b_products")[0].thanks_page_slug, "shiarabo-thanks");
  assert.equal((await sell.setProduct(env, { id: "shiarabo-annual", thanks_page_slug: "nai-page" }, "mcp")).error, "thanks_page_not_found");
  assert.equal((await sell.setProduct(env, { id: "shiarabo-annual", thanks_page_slug: "Bad Slug" }, "mcp")).error, "bad_thanks_page_slug");
  const off = await sell.setProduct(env, { id: "shiarabo-annual", thanks_page_slug: null }, "mcp");
  assert.equal(off.ok, true);
  assert.equal(st.table("b_products")[0].thanks_page_slug, null);
});

test("ファネル構築：売るページと決済のあとのページはオファーの段。ページ → 商品 → サンクスの線", () => {
  const parts = buildParts({
    products: [{ id: "shiarabo-annual", name: "シアラボ（1 年）", active: true, grants: ["shiarabo_basic"], thanks_page_slug: "shiarabo-thanks" }],
    pages: [
      { id: "p1", title: "シアラボのご案内", slug: "shiarabo", status: "published", purpose: "sale", url: "x" },
      { id: "p2", title: "ご入会ありがとう", slug: "shiarabo-thanks", status: "published", purpose: "thanks", url: "y" },
      { id: "p3", title: "セミナーのありがとう", slug: "seminar-thanks", status: "published", purpose: "thanks", url: "z" },
    ],
    pageParts: { p1: { forms: [], checkouts: ["shiarabo-annual"], buttons: [], bookings: [] } },
  });
  const lane = (k) => parts.find((p) => p.key === k).lane;
  assert.equal(lane("page:p1"), "buy");
  assert.equal(lane("page:p2"), "buy");
  assert.equal(lane("page:p3"), "signup", "商品に結んでいないサンクスは今までどおりリストイン");
  const edges = buildEdges(parts).map((e) => `${e.from}>${e.to}:${e.label}`);
  assert.ok(edges.includes("page:p1>product:shiarabo-annual:申し込む"));
  assert.ok(edges.includes("product:shiarabo-annual>page:p2:サンクス"));
});

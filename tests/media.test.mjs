// メディアの便 M1：メディアの棚の試験。上げる・スライドのリンク・名前を直す・消す・UTAGE の置き場から写す（ほかの住所は取りに行かない・2 回写さない）
// 走らせ方：node --test tests/media.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeMedia, kindOf, slideEmbed, MAX_UPLOAD } from "../src/media.js";
import { DEFAULT_MODES } from "../src/guard.js";

function setup() {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = { put: async (k, b, o) => { r2.set(k, { b, o }); }, get: async (k) => r2.has(k) ? { body: "x", httpMetadata: r2.get(k).o.httpMetadata } : null, delete: async (k) => { r2.delete(k); } };
  const calls = [];
  const fetch = async (url) => { calls.push(url); return new Response(new Uint8Array(1234), { headers: { "content-type": "image/png", "content-length": "1234" } }); };
  const media = makeMedia({ db: s.db, logInbound: async () => {}, fetch });
  return { s, r2, media, env: { IMAGES }, calls };
}
const U = "https://utagesystem.s3.ap-northeast-1.amazonaws.com/5zsIIoZZ4z84/BxQZpur8takR/abc123.png";

test("種類は拡張子で決まる。スライドは埋め込みの住所に直す", () => {
  assert.equal(kindOf("a.PDF"), "pdf"); assert.equal(kindOf("b.mp4"), "video"); assert.equal(kindOf("c.zip"), "other");
  assert.equal(slideEmbed("https://docs.google.com/presentation/d/1n3WroRc5L0w9IUNjJNGHlJwqrCjMyxc_Oxsesb1SS6k/edit?usp=sharing"), "https://docs.google.com/presentation/d/1n3WroRc5L0w9IUNjJNGHlJwqrCjMyxc_Oxsesb1SS6k/embed");
  assert.equal(slideEmbed("https://example.com/x"), null);
});

test("上げる：R2 の media/ に置き、一覧に出る。大きすぎ・空は断る", async () => {
  const { media, env, r2 } = setup();
  assert.equal((await media.upload(env, { name: "資料.pdf", size: MAX_UPLOAD + 1, body: "x" }, "a")).error, "too_big");
  assert.equal((await media.upload(env, { name: "資料.pdf", size: 0, body: "x" }, "a")).error, "empty");
  const r = await media.upload(env, { name: "資料.pdf", folder: "配布", size: 100, body: "x" }, "a");
  assert.equal(r.ok, true); assert.equal(r.kind, "pdf");
  assert.ok([...r2.keys()][0].startsWith("media/"));
  const l = await media.list(env, {});
  assert.equal(l.total, 1); assert.equal(l.items[0].folder, "配布"); assert.equal(l.kinds.pdf, 1);
});

test("スライドのリンク・名前を直す・消すと R2 からも消える", async () => {
  const { media, env, r2 } = setup();
  assert.equal((await media.addSlide(env, { url: "https://example.com" }, "a")).error, "bad_slide_url");
  const sl = await media.addSlide(env, { url: "https://docs.google.com/presentation/d/1n3WroRc5L0w9IUNjJNGHlJwqrCjMyxc_Oxsesb1SS6k/edit", name: "講義" }, "a");
  assert.ok(sl.embed.endsWith("/embed"));
  const up = await media.upload(env, { name: "a.png", size: 10, body: "x" }, "a");
  assert.equal((await media.save(env, { id: up.id, name: "表紙", folder: "LP" }, "a")).name, "表紙");
  assert.equal((await media.save(env, { id: up.id, remove: true }, "a")).removed, true);
  assert.equal(r2.size, 0);
  assert.equal((await media.list(env, { kind: "slide" })).items[0].name, "講義");
});

test("UTAGE から写す：UTAGE の置き場だけ取りに行く。同じ元は 2 回写さない", async () => {
  const { media, env, calls, r2 } = setup();
  const r = await media.importUtage(env, { items: [{ url: U, name: "表紙.png", utage_id: "MrReMOq0brrd" }, { url: "https://evil.example.com/a.png", name: "x" }] }, "mcp");
  assert.equal(r.copied, 1); assert.equal(r.failed, 1);
  assert.equal(calls.length, 1, "ほかの住所は取りに行かない");
  const again = await media.importUtage(env, { items: [{ url: U, name: "表紙.png", utage_id: "MrReMOq0brrd" }] }, "mcp");
  assert.equal(again.skipped, 1); assert.equal(r2.size, 1);
  const l = await media.list(env, { folder: "UTAGE から" });
  assert.equal(l.items[0].source, "utage:MrReMOq0brrd"); assert.equal(l.items[0].size, 1234);
});

test("権限の最初の値：消すのだけ承認", () => {
  for (const t of ["list_media", "import_utage_media", "add_media_slide", "save_media"]) assert.equal(DEFAULT_MODES[t], "auto");
  assert.equal(DEFAULT_MODES.remove_media, "approve");
});

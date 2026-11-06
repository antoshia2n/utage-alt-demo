// メディアの便 M2：共有リンクの試験。作る・開く（数える）・止める・戻す・期限切れ・続き読みは数えない・写し終わっていないものは作れない
// 走らせ方：node --test tests/media-links.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeMedia } from "../src/media.js";
import { DEFAULT_MODES } from "../src/guard.js";

function setup() {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = { put: async (k, b, o) => { r2.set(k, { b, o }); }, get: async (k, opt) => r2.has(k) ? { body: "xxxxxxxxxx", size: 10, range: opt ? { offset: 4, length: 6 } : undefined } : null, delete: async (k) => { r2.delete(k); } };
  const media = makeMedia({ db: s.db, logInbound: async () => {} });
  return { s, media, env: { IMAGES } };
}
const O = "https://lab.shia2n.jp";
const get = (h = {}) => new Request("https://lab.shia2n.jp/m/x", { headers: h });
const tok = (url) => url.split("/m/")[1];

test("作ると /m/<24 桁> の住所。開くと数が 1 増え、続き読み（Range の途中から）は数えない", async () => {
  const { media, env } = setup();
  const up = await media.upload(env, { name: "特典.pdf", size: 10, body: "x" }, "a");
  const k = await media.makeLink(env, { media_id: up.id, label: "LINE の特典", days: 7 }, "a", O);
  assert.equal(k.ok, true); assert.match(k.url, /^https:[/][/]lab[.]shia2n[.]jp[/]m[/][0-9a-f]{24}$/); assert.equal(k.state, "live");
  const r = await media.serveLink(env, tok(k.url), get());
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "application/pdf"); assert.equal(r.headers.get("x-robots-tag"), "noindex");
  const part = await media.serveLink(env, tok(k.url), get({ range: "bytes=4-" }));
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), "bytes 4-9/10");
  const l = await media.links(env, { media_id: up.id }, O);
  assert.equal(l.links[0].opens, 1);
  const shelf = await media.list(env, {});
  assert.equal(shelf.items[0].live, 1); assert.equal(shelf.items[0].opens, 1);
});

test("止めると開けない・戻すと開ける。期限切れは開けない。違う形の印は表を読まない", async () => {
  const { media, env, s } = setup();
  const up = await media.upload(env, { name: "a.png", size: 10, body: "x" }, "a");
  const k = await media.makeLink(env, { media_id: up.id }, "a", O);
  assert.equal(k.expires_at, null);
  assert.equal((await media.stopLink(env, { id: k.id }, "a")).state, "stopped");
  assert.equal(await media.serveLink(env, tok(k.url), get()), null);
  assert.equal((await media.stopLink(env, { id: k.id, stop: false }, "a")).state, "live");
  assert.ok(await media.serveLink(env, tok(k.url), get()));
  await s.db(env, "PATCH", `b_media_links?id=eq.${k.id}`, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await media.serveLink(env, tok(k.url), get()), null);
  assert.equal((await media.links(env, {}, O)).links[0].state, "expired");
  assert.equal(await media.serveLink(env, "../../etc", get()), null);
});

test("作れないもの：無い・写し終わっていない・日数が変・過ぎた日時。HTML などは保存させる", async () => {
  const { media, env, s } = setup();
  assert.equal((await media.makeLink(env, { media_id: "00000000-0000-0000-0000-000000000000" }, "a", O)).error, "not_found");
  await s.db(env, "POST", "b_media", [{ id: "11111111-1111-1111-1111-111111111111", kind: "image", name: "待ち.png", folder: "", r2_key: null, size: 0, content_type: "", source: "utage:x", url: "https://utagesystem.s3.ap-northeast-1.amazonaws.com/a/b.png" }]);
  assert.equal((await media.makeLink(env, { media_id: "11111111-1111-1111-1111-111111111111" }, "a", O)).error, "no_file");
  const up = await media.upload(env, { name: "page.html", size: 10, body: "x" }, "a");
  assert.equal((await media.makeLink(env, { media_id: up.id, days: 0 }, "a", O)).error, "bad_days");
  assert.equal((await media.makeLink(env, { media_id: up.id, expires_at: "2000-01-01" }, "a", O)).error, "bad_expires");
  const k = await media.makeLink(env, { media_id: up.id }, "a", O);
  const r = await media.serveLink(env, tok(k.url), get());
  assert.equal(r.headers.get("content-type"), "application/octet-stream"); assert.match(r.headers.get("content-disposition"), /^attachment/);
});

test("スライドは元の住所へ送る。消すとリンクも一覧から消える（表の結びで消える前提）", async () => {
  const { media, env } = setup();
  const sl = await media.addSlide(env, { url: "https://docs.google.com/presentation/d/1n3WroRc5L0w9IUNjJNGHlJwqrCjMyxc_Oxsesb1SS6k/edit", name: "講義" }, "a");
  const k = await media.makeLink(env, { media_id: sl.id, label: "受講生へ" }, "a", O);
  const r = await media.serveLink(env, tok(k.url), get());
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /docs[.]google[.]com/);
});

test("権限：作るのは承認、見る・止めるは自動", () => {
  assert.equal(DEFAULT_MODES.create_media_link, "approve");
  assert.equal(DEFAULT_MODES.list_media_links, "auto");
  assert.equal(DEFAULT_MODES.stop_media_link, "auto");
});

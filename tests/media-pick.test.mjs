// メディアの便 M2b（2026-11-07 Naoki OK 09:07）：メディアから選ぶ・LINE のプレビューの試験
// プレビューを置く（画像だけ・jpg・1MB まで）／?p=1 はプレビューを返し数えない（無ければ元）／LINE の画像の確かめ／自動応答の保存が止まる
// 走らせ方：node --test tests/media-pick.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeMedia, previewKey, LINE_PREVIEW_MAX, LINE_IMAGE_MAX } from "../src/media.js";
import { makeLine, toLineMessages, linePreviewUrl } from "../src/line.js";

function setup() {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = {
    put: async (k, b, o) => { r2.set(k, { b, o }); },
    get: async (k) => r2.has(k) ? { body: "x".repeat(k.endsWith(".preview.jpg") ? 3 : 10), size: k.endsWith(".preview.jpg") ? 3 : 10 } : null,
    head: async (k) => r2.has(k) ? { size: 1 } : null,
    delete: async (k) => { r2.delete(k); },
  };
  const media = makeMedia({ db: s.db, logInbound: async () => {} });
  return { s, media, r2, env: { IMAGES } };
}
const O = "https://lab.shia2n.jp";
const tok = (url) => url.split("/m/")[1];
const req = () => new Request("https://lab.shia2n.jp/m/x");

test("プレビューは画像（写し済み）だけ・jpg だけ・1MB まで。置き場は media/<番号>.preview.jpg", async () => {
  const { media, env, r2 } = setup();
  const img = await media.upload(env, { name: "実績.png", size: 2 * 1024 * 1024, body: "x" }, "a");
  const pdf = await media.upload(env, { name: "特典.pdf", size: 10, body: "x" }, "a");
  assert.equal((await media.savePreview(env, { id: pdf.id, size: 10, type: "image/jpeg", body: "x" }, "a")).error, "not_image");
  assert.equal((await media.savePreview(env, { id: img.id, size: LINE_PREVIEW_MAX + 1, type: "image/jpeg", body: "x" }, "a")).error, "preview_too_big");
  assert.equal((await media.savePreview(env, { id: img.id, size: 10, type: "image/png", body: "x" }, "a")).error, "preview_not_jpeg");
  assert.equal((await media.savePreview(env, { id: "nai", size: 10, type: "image/jpeg", body: "x" }, "a")).error, "not_found");
  const ok = await media.savePreview(env, { id: img.id, size: 3, type: "image/jpeg", body: "x" }, "a");
  assert.equal(ok.ok, true);
  assert.ok(r2.has(previewKey(img.id)));
  // 消すとプレビューも消える
  await media.save(env, { id: img.id, remove: true }, "a");
  assert.ok(!r2.has(previewKey(img.id)));
});

test("?p=1 はプレビューを返し、開かれた数に数えない。プレビューが無ければ元の画像", async () => {
  const { media, env } = setup();
  const img = await media.upload(env, { name: "実績.png", size: 10, body: "x" }, "a");
  const k = await media.makeLink(env, { media_id: img.id, label: "LINE" }, "a", O);
  const noPv = await media.serveLink(env, tok(k.url), req(), { preview: true });
  assert.equal(noPv.headers.get("content-type"), "image/png");
  await media.savePreview(env, { id: img.id, size: 3, type: "image/jpeg", body: "x" }, "a");
  const pv = await media.serveLink(env, tok(k.url), req(), { preview: true });
  assert.equal(pv.status, 200); assert.equal(pv.headers.get("content-type"), "image/jpeg"); assert.equal(pv.headers.get("content-length"), "3");
  assert.equal((await media.links(env, { media_id: img.id }, O)).links[0].opens, 0);
  await media.serveLink(env, tok(k.url), req());
  assert.equal((await media.links(env, { media_id: img.id }, O)).links[0].opens, 1);
});

test("LINE の画像の確かめ：png か jpg・10MB まで・1MB を超えるならプレビューが要る・止めたリンクは不可・棚の外の住所は見ない", async () => {
  const { media, env, s } = setup();
  const big = await media.upload(env, { name: "まとめ.png", size: 2 * 1024 * 1024, body: "x" }, "a");
  const small = await media.upload(env, { name: "バナー.jpg", size: 300 * 1024, body: "x" }, "a");
  const gif = await media.upload(env, { name: "動く.gif", size: 100, body: "x" }, "a");
  const huge = await media.upload(env, { name: "大きい.jpg", size: 50 * 1024 * 1024, body: "x" }, "a");
  const lk = async (m) => (await media.makeLink(env, { media_id: m.id }, "a", O)).url;
  const uBig = await lk(big), uSmall = await lk(small), uGif = await lk(gif), uHuge = await lk(huge);
  assert.equal((await media.lineImageProblem(env, uBig)).error, "need_preview");
  await media.savePreview(env, { id: big.id, size: 3, type: "image/jpeg", body: "x" }, "a");
  assert.equal(await media.lineImageProblem(env, uBig), null);
  assert.equal(await media.lineImageProblem(env, uSmall), null);
  assert.equal((await media.lineImageProblem(env, uGif)).error, "line_image_type");
  assert.ok(50 * 1024 * 1024 > LINE_IMAGE_MAX);
  assert.equal((await media.lineImageProblem(env, uHuge)).error, "line_image_too_big");
  assert.equal(await media.lineImageProblem(env, "https://example.com/a.png"), null);
  assert.equal((await media.lineImageProblem(env, "https://lab.shia2n.jp/m/" + "0".repeat(24))).error, "line_image_unknown");
  const k = s.table("b_media_links").find((x) => x.token === tok(uSmall));
  await media.stopLink(env, { id: k.id }, "a");
  assert.equal((await media.lineImageProblem(env, uSmall)).error, "line_image_link_closed");
});

test("LINE へ送る形：棚の共有リンクはプレビューに ?p=1 を付ける。ほかの住所はそのまま", () => {
  const u = "https://lab.shia2n.jp/m/" + "a".repeat(24);
  assert.equal(linePreviewUrl(u), u + "?p=1");
  assert.equal(linePreviewUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
  const [m] = toLineMessages([{ type: "image", url: u }]);
  assert.deepEqual(m, { type: "image", originalContentUrl: u, previewImageUrl: u + "?p=1" });
});

test("自動応答とテンプレートの保存は、画像の確かめで止まる（文を直さない保存は止めない）", async () => {
  const s = fakeStore();
  const seen = [];
  const line = makeLine({ db: s.db, logInbound: async () => {}, changes: null, addEvent: async () => {}, registerPerson: async () => ({ ok: false }), audience: async () => ({ people: [] }),
    checkImage: async (env, url) => { seen.push(url); return url.includes("bad") ? { error: "need_preview", name: "まとめ.png" } : null; } });
  const env = {};
  const bad = await line.saveReply(env, { account: "shianin", name: "特典", keywords: ["特典"], messages: [{ type: "text", text: "どうぞ" }, { type: "image", url: "https://lab.shia2n.jp/bad" }] }, "a");
  assert.equal(bad.ok, false); assert.equal(bad.error, "need_preview"); assert.equal(bad.name, "まとめ.png");
  const good = await line.saveReply(env, { account: "shianin", name: "特典", keywords: ["特典"], messages: [{ type: "image", url: "https://lab.shia2n.jp/good" }] }, "a");
  assert.equal(good.ok, true);
  const n = seen.length;
  const rename = await line.saveReply(env, { account: "shianin", id: good.id, name: "特典 2" }, "a");
  assert.equal(rename.ok, true); assert.equal(seen.length, n);
  const t = await line.saveTemplate(env, { account: "shianin", name: "画像", messages: [{ type: "image", url: "https://lab.shia2n.jp/bad" }] }, "a");
  assert.equal(t.error, "need_preview");
});

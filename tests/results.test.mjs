// 実績の便 1（2026-11-13）：実績の棚の試験。
//  入れると AI が仕分ける・今あるフォルダ以外は受け箱・自信が無ければ受け箱・載せてよい範囲は AI が決めない・
//  フォルダを開いて入れたらそのフォルダ・自分の X のポストは「自分の実績」・フォルダの足す／名前を変える／空のときだけ消す
// 走らせ方：node --test tests/results.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeResults } from "../src/results.js";

function setup(answer) {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = { put: async (k, b) => { r2.set(k, new Uint8Array(b)); }, get: async (k) => (r2.has(k) ? { body: r2.get(k), arrayBuffer: async () => r2.get(k).buffer } : null) };
  const calls = [];
  const AI = { run: async (model, input) => { calls.push(input); return { response: typeof answer === "function" ? answer(input) : answer }; } };
  const res = makeResults({ db: s.db, logInbound: async () => {} });
  return { s, r2, res, env: { IMAGES, AI }, calls };
}
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])]).stream();

test("画像を入れると AI が仕分け、今あるフォルダに入る。載せてよい範囲は AI が決めない", async () => {
  const { res, env, s, calls } = setup(JSON.stringify({ whose: "person", folder: "X のフォロワー", title: "3 か月で X フォロワー 1,000 人", who_name: "@abc", achieved_on: "2026-11-10", labels: ["X", "フォロワー"], quote: "迷わず書ける", confident: true, publish: "name" }));
  const r = await res.upload(env, { name: "shot.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r.ok, true);
  assert.equal(r.item.folder, "X のフォロワー");
  assert.equal(r.item.ai, "done");
  assert.equal(r.item.title, "3 か月で X フォロワー 1,000 人");
  assert.equal(s.t.b_results[0].publish, "unknown", "AI の答えの publish は使わない");
  assert.ok(calls[0].messages[1].content.some((c) => c.type === "image_url"), "画像を AI に見せている");
});

test("今あるフォルダに無い名前や、自信が無いときは受け箱", async () => {
  const a = setup(JSON.stringify({ whose: "person", folder: "存在しない", title: "x 人", confident: true }));
  const r1 = await a.res.upload(a.env, { name: "a.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r1.item.folder, ""); assert.equal(r1.item.ai, "unsure");
  const b = setup(JSON.stringify({ whose: "person", folder: "収益化", title: "初収益", confident: false, note: "数字がかすれている" }));
  const r2 = await b.res.upload(b.env, { name: "b.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r2.item.folder, ""); assert.equal(r2.item.ai, "unsure"); assert.equal(r2.item.ai_note, "数字がかすれている");
});

test("フォルダを開いて入れたものは、AI が別を言ってもそのフォルダ", async () => {
  const { res, env } = setup(JSON.stringify({ whose: "person", folder: "収益化", title: "初収益", confident: true }));
  const r = await res.upload(env, { name: "a.png", size: "7", type: "image/png", body: png(), whose: "me", folder: "売上・成約" }, "a");
  assert.equal(r.item.whose, "me"); assert.equal(r.item.folder, "売上・成約");
});

test("入れられないもの：種類・大きさ・空", async () => {
  const { res, env } = setup("{}");
  assert.equal((await res.upload(env, { name: "a.exe", size: "7", type: "x", body: png() }, "a")).error, "bad_type");
  assert.equal((await res.upload(env, { name: "a.png", size: String(30 * 1024 * 1024), type: "image/png", body: png() }, "a")).error, "too_big");
  assert.equal((await res.upload(env, { name: "a.png", size: "0", type: "image/png", body: new Blob([]).stream() }, "a")).error, "empty");
});

test("リンク：自分の X のポストは自分の実績・同じ住所は 2 回入れない・https だけ", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ author_name: "シアニン", author_url: "https://x.com/antoshia2n", html: "<p>言語化ポストが 52 万インプ</p>" }));
  try {
    const { res, env, calls } = setup(JSON.stringify({ whose: "person", folder: "X のポスト・数字", title: "52 万インプ", confident: true }));
    const r = await res.addLink(env, { url: "https://x.com/antoshia2n/status/123456789" }, "a");
    assert.equal(r.ok, true); assert.equal(r.item.whose, "me");
    assert.match(calls[0].messages[1].content[0].text, /52 万インプ/, "ポストの本文を AI に渡している");
    assert.equal((await res.addLink(env, { url: "https://x.com/antoshia2n/status/123456789" }, "a")).error, "already");
    assert.equal((await res.addLink(env, { url: "http://x.com/a" }, "a")).error, "bad_url");
  } finally { globalThis.fetch = realFetch; }
});

test("受け箱から人がフォルダを選ぶと AI の印は「仕分け済み」になる・載せてよい範囲は人が選ぶ", async () => {
  const { res, env } = setup(JSON.stringify({ title: "x", confident: false }));
  const r = await res.upload(env, { name: "a.png", size: "7", type: "image/png", body: png() }, "a");
  const s1 = await res.save(env, { id: r.item.id, folder: "収益化", publish: "anon" }, "a");
  assert.equal(s1.item.folder, "収益化"); assert.equal(s1.item.ai, "done"); assert.equal(s1.item.publish, "anon");
  assert.equal((await res.save(env, { id: r.item.id, publish: "yes" }, "a")).error, "bad_publish");
});

test("フォルダ：足す・名前を変えると中身も移る・中身があると消せない", async () => {
  const { res, env } = setup(JSON.stringify({ whose: "person", folder: "収益化", title: "初収益", confident: true }));
  assert.equal((await res.folderEdit(env, { action: "add", whose: "person", name: "収益化" }, "a")).error, "already");
  assert.equal((await res.folderEdit(env, { action: "add", whose: "person", name: "メンシプ" }, "a")).ok, true);
  const r = await res.upload(env, { name: "a.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r.item.folder, "収益化");
  assert.equal((await res.folderEdit(env, { action: "remove", whose: "person", name: "収益化" }, "a")).error, "not_empty");
  assert.equal((await res.folderEdit(env, { action: "rename", whose: "person", name: "収益化", to: "マネタイズ" }, "a")).ok, true);
  const l = await res.list(env, { whose: "person", folder: "マネタイズ" });
  assert.equal(l.count, 1);
  assert.ok(l.folders.person.some((f) => f.name === "メンシプ"));
  assert.ok(!l.folders.person.some((f) => f.name === "収益化"));
});

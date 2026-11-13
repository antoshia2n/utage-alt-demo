// 実績の便 1（2026-11-13）：実績の棚の試験。
//  入れると AI が仕分ける・今あるフォルダ以外は受け箱・自信が無ければ受け箱・載せてよい範囲は AI が決めない・
//  フォルダを開いて入れたらそのフォルダ・自分の X のポストは「自分の実績」・フォルダの足す／名前を変える／空のときだけ消す
// 走らせ方：node --test tests/results.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeResults, matchFolder } from "../src/results.js";

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

test("ドライブの受け箱：取り込んで AI が仕分け、取り込んだ番号だけ知らせる・許可が無ければ止まる", async () => {
  const { res, env, s } = setup(JSON.stringify({ whose: "me", folder: "売上・成約", title: "35 回で 805,440 円の売上", confident: true }));
  const told = [];
  env.ZOOM = {
    results_inbox_take: async () => ({ ok: true, files: [{ file_id: "abcdefghijk1", name: "uriage.png", mime: "image/png", size: 7, data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer }, { file_id: "abcdefghijk2", name: "memo.txt", mime: "text/plain", size: 3, data: new Uint8Array([1, 2, 3]).buffer }], skipped: [] }),
    results_inbox_done: async (ids) => { told.push(...ids); return { ok: true }; },
  };
  const r = await res.drainDrive(env);
  assert.equal(r.taken, 2, "種類の合わないファイルも、2 回目に回さないよう取り込んだ扱い");
  assert.deepEqual(told, ["abcdefghijk1", "abcdefghijk2"]);
  assert.equal(s.t.b_results.length, 1);
  assert.equal(s.t.b_results[0].source, "drive");
  assert.equal(s.t.b_results[0].folder, "売上・成約");
  env.ZOOM.results_inbox_take = async () => ({ ok: false, error: "need_permit" });
  assert.equal((await res.drainDrive(env)).error, "need_permit");
});

test("AI の返したフォルダの名前の揺れ（中黒・全角半角・一部だけ）を、今あるフォルダに当てる", () => {
  const L = ["X のポスト・数字", "売上・成約"];
  assert.equal(matchFolder("売上･成約", L), "売上・成約");
  assert.equal(matchFolder("売上 成約", L), "売上・成約");
  assert.equal(matchFolder("売上", L), "売上・成約");
  assert.equal(matchFolder("Xのポスト", L), "X のポスト・数字");
  assert.equal(matchFolder("収益化", L), "");
  assert.equal(matchFolder("", L), "");
});

test("確かめ済みの実績は、AI がもう一度仕分けても成果を書き換えない・人が保存すると確かめ済み・実績でないものは受け箱", async () => {
  let ans = { whose: "me", folder: "売上・成約", title: "35 回で 805,440 円", confident: true };
  const { res, env } = setup(() => JSON.stringify(ans));
  const r = await res.upload(env, { name: "a.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r.item.checked, false);
  const s1 = await res.save(env, { id: r.item.id, title: "35 回で 700,920 円" }, "a");
  assert.equal(s1.item.checked, true);
  ans = { whose: "me", folder: "X のポスト・数字", title: "35 回で 805,400 円", labels: ["売上"], confident: true };
  const s2 = await res.resort(env, r.item.id, "a");
  assert.equal(s2.item.title, "35 回で 700,920 円");
  assert.equal(s2.item.folder, "X のポスト・数字");
  ans = { is_result: false, whose: "me", folder: "売上・成約", title: "価格表", confident: true };
  const r3 = await res.upload(env, { name: "b.png", size: "7", type: "image/png", body: png() }, "a");
  assert.equal(r3.item.folder, ""); assert.match(r3.item.ai_note, /実績ではなさそう/);
});

// 実績の便 3（2026-11-13）：X攻略くんのパネルは表に行を足すだけ。5 分ごとの処理がそれを仕分ける。AI の道具は探す・開く・リンクで入れる
test("パネルが足した行（ai=none）は 5 分ごとの処理で仕分けられ、自分のポストは自分の実績のまま", async () => {
  const { res, env, s } = setup(JSON.stringify({ is_result: true, whose: "me", folder: "X のポスト・数字", title: "1 ポストで 100 万インプ", confident: true }));
  s.t.b_results = [{ id: "11111111-1111-1111-1111-111111111111", whose: "me", folder: "", title: "", link_url: "https://x.com/antoshia2n/status/123456789", source: "panel", publish: "unknown", ai: "none", labels: [], archived: false, checked: false, created_at: "2026-11-13T09:00:00Z", updated_by: "x-koryaku" }];
  globalThis.fetch = async () => new Response(JSON.stringify({ author_name: "シアニン", author_url: "https://x.com/antoshia2n", html: "<p>100 万インプ</p>" }), { status: 200 });
  const r = await res.drainPending(env);
  assert.equal(r.sorted, 1);
  const row = s.t.b_results[0];
  assert.equal(row.ai, "done"); assert.equal(row.whose, "me"); assert.equal(row.folder, "X のポスト・数字");
  const again = await res.drainPending(env);
  assert.equal(again.sorted, 0, "仕分けた行はもう回らない");
});

test("探す：checked_only で人が確かめた行だけ・既定は 30 件まで。開く：AI が読んだ文も返す", async () => {
  const { res, env, s } = setup("{}");
  s.t.b_results = Array.from({ length: 35 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, whose: "person", folder: "収益化", title: `初収益 ${i}`, publish: "unknown", ai: "done", labels: [], archived: false, checked: i < 2, created_at: `2026-11-13T09:${String(i).padStart(2, "0")}:00Z`, ai_text: i === 0 ? "読んだ文" : "" }));
  const all = await res.find(env, {});
  assert.equal(all.count, 35); assert.equal(all.items.length, 30);
  const ok = await res.find(env, { checked_only: true });
  assert.equal(ok.count, 2);
  const one = await res.one(env, s.t.b_results[0].id);
  assert.equal(one.item.ai_text, "読んだ文");
  assert.equal((await res.one(env, "nope")).ok, false);
});

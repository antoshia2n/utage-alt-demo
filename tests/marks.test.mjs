// 便 B2（2026-11-06）：生徒の印（お気に入り・視聴済み・自分のラベル）
import { test } from "node:test";
import assert from "node:assert/strict";
import { latestMarks, cleanLabels, makeMarks } from "../src/marks.js";
import { makeRecToken, readRecToken } from "../src/recplay.js";

test("教材ごとにいちばん新しい印を使う", () => {
  const m = latestMarks([{ payload: { lesson_id: "a", star: true, labels: ["X"] } }, { payload: { lesson_id: "a", star: false } }, { payload: { lesson_id: "b", done: true } }]);
  assert.deepEqual(m.a, { star: true, done: false, labels: ["X"] });
  assert.equal(m.b.done, true);
});

test("ラベルは全角半角・空白・大文字小文字の違いを今あるものにまとめる", () => {
  assert.deepEqual(cleanLabels(["ｘ投稿", "あとで  見直す", "X投稿"], ["X投稿"]), ["X投稿", "あとで 見直す"]);
  assert.deepEqual(cleanLabels(["", "  "]), []);
});

test("送られた欄だけ変え、名前を変えると付いている教材すべてが変わる", async () => {
  const ev = [];
  const db = async (env, m, q) => (q.startsWith("events?") ? ev.slice().reverse() : []);
  const addEvent = async (env, id, type, payload) => { ev.push({ payload }); };
  const mk = makeMarks({ db, addEvent });
  const c = { id: "u1" };
  await mk.set({}, c, { lesson_id: "lesson-0001", star: true, labels: ["あとで見直す"] });
  const r = await mk.set({}, c, { lesson_id: "lesson-0001", done: true });
  assert.deepEqual(r.mark, { star: true, done: true, labels: ["あとで見直す"] });
  await mk.set({}, c, { lesson_id: "lesson-0002", labels: ["ｱﾄﾃﾞ見直す", "あとで見直す"] });
  const e = await mk.editLabel({}, c, { action: "rename", from: "あとで見直す", to: "見直す" });
  assert.equal(e.changed, 2);
  const all = await mk.all({}, "u1");
  assert.deepEqual(all["lesson-0001"].labels, ["見直す"]);
  assert.equal((await mk.set({}, c, { lesson_id: "bad id" })).ok, false);
});

test("録画の合言葉：置き場が入り、鍵が違う・期限切れ・書き換えは通らない", async () => {
  const t = await makeRecToken("s", { lesson: "L1", key: "rec/2026/a.mp4" });
  assert.equal((await readRecToken("s", t)).k, "rec/2026/a.mp4");
  assert.equal(await readRecToken("x", t), null);
  assert.equal(await readRecToken("s", t, Date.now() + 7 * 3600e3), null);
  const [b] = t.split(".");
  const forged = btoa(JSON.stringify({ l: "L1", k: "other.mp4", e: 9e9 })).replace(/=+$/, "") + "." + t.split(".")[1];
  assert.equal(await readRecToken("s", forged), null);
  assert.ok(b);
});

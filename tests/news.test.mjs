// お知らせ（src/news.js）：書く・日時を決めて出す・下書き・取り下げ。生徒には出してよいものだけ
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeNews, checkNews, newsQuery } from "../src/news.js";
import { fakeStore } from "./fake-store.mjs";

const env = { B_STORE: true };
const visible = async (st) => (await st.db(env, "GET", newsQuery(env, 20))).map((r) => r.title);

test("確かめ：題名が要る・日時を決めて出すには日時が要り過去は受けない・下書き", () => {
  const now = Date.parse("2026-10-29T04:00:00Z");
  assert.equal(checkNews({ title: " " }, now).error, "title_required");
  assert.equal(checkNews({ title: "x", mode: "at" }, now).error, "at_required");
  assert.equal(checkNews({ title: "x", mode: "at", at: "2026-10-01T00:00:00Z" }, now).error, "at_in_past");
  assert.equal(checkNews({ title: "x", mode: "at", at: "2026-11-01T00:00:00Z" }, now).row.published_at, "2026-11-01T00:00:00.000Z");
  assert.equal(checkNews({ title: "x", mode: "draft" }, now).row.status, "draft");
});

test("生徒に出るのは、出すにしていて日時を過ぎたものだけ・取り下げると消え、戻すと出る", async () => {
  const st = fakeStore();
  const n = makeNews({ db: st.db });
  const a = await n.save(env, { title: "すぐ", body: "本文", mode: "now" }, "admin:x");
  await n.save(env, { title: "あとで", mode: "at", at: new Date(Date.now() + 864e5).toISOString() }, "admin:x");
  await n.save(env, { title: "下書き", mode: "draft" }, "admin:x");
  assert.deepEqual(await visible(st), ["すぐ"]);
  const l = await n.list(env);
  assert.deepEqual(l.news.map((x) => x.state).sort(), ["draft", "live", "scheduled"]);
  await n.setStatus(env, { id: a.id, status: "withdrawn" }, "admin:x");
  assert.deepEqual(await visible(st), []);
  await n.setStatus(env, { id: a.id, status: "published" }, "admin:x");
  assert.deepEqual(await visible(st), ["すぐ"]);
  assert.equal((await n.setStatus(env, { id: a.id, status: "gone" })).error, "bad_status");
});

test("直す：出ているものを「すぐ出す」のまま直しても日時は動かない・デモの置き場では書かない", async () => {
  const st = fakeStore();
  const n = makeNews({ db: st.db });
  st.table("announcements").push({ id: 7, title: "前から", body: "", published_at: "2026-10-01T00:00:00.000Z", status: "published" });
  assert.equal((await n.save(env, { id: 7, title: "前から（直した）", mode: "now" }, "admin:x")).ok, true);
  const row = st.table("announcements").find((x) => x.id === 7);
  assert.equal(row.title, "前から（直した）");
  assert.equal(row.published_at, "2026-10-01T00:00:00.000Z");
  assert.equal((await n.save({}, { title: "x" })).error, "demo_store");
  assert.doesNotMatch(newsQuery({}, 5), /status/); // デモの置き場の表には status が無い
});

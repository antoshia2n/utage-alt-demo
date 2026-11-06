// 便 C（2026-11-06）：手で上げる。マーケくんは録画の保管（結び ZOOM）へ渡すだけ
import test from "node:test";
import assert from "node:assert/strict";
import { recordings } from "../src/recordings.js";

function fakeZoom() {
  const calls = [];
  return {
    calls,
    upload_start: async (b) => (calls.push(["start", b]), { ok: true, id: "up_a", parts_total: 2, parts_done: [] }),
    upload_part: async (id, n, body) => (calls.push(["part", id, n, await new Response(body).text()]), { ok: true }),
    upload_complete: async (id) => (calls.push(["complete", id]), { ok: true, id }),
    upload_abort: async (id) => (calls.push(["abort", id]), { ok: true, id }),
  };
}

test("始める：会の種類は決まった 5 つ以外を「その他」に・ラベルは 20 まで・誰が上げたかを渡す", async () => {
  const z = fakeZoom();
  const r = await recordings.uploadStart({ ZOOM: z }, { file_name: "a.mov", size: 100, date: "2026-11-05", title: "t", kai: "知らない", labels: Array.from({ length: 30 }, (_, i) => "l" + i) }, "admin:x");
  assert.equal(r.ok, true);
  const b = z.calls[0][1];
  assert.equal(b.kai, "その他");
  assert.equal(b.labels.length, 20);
  assert.equal(b.by, "admin:x");
  assert.equal(b.size, 100);
});

test("1 片：届いた本文の流れをそのまま渡す", async () => {
  const z = fakeZoom();
  const body = new Blob(["abc"]).stream();
  const r = await recordings.uploadPart({ ZOOM: z }, "up_a", "2", body);
  assert.equal(r.ok, true);
  assert.deepEqual(z.calls[0], ["part", "up_a", 2, "abc"]);
});

test("完了・中止は番号を渡す。結びが無いときは no_binding", async () => {
  const z = fakeZoom();
  assert.equal((await recordings.uploadComplete({ ZOOM: z }, "up_a")).ok, true);
  assert.equal((await recordings.uploadAbort({ ZOOM: z }, "up_a")).ok, true);
  assert.equal((await recordings.uploadStart({}, { file_name: "a.mp4" })).error, "no_binding");
});

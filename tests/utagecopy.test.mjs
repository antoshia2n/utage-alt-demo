// UTAGE の写し（2026-11-06 便 U1）：マーケくんは shia2n-mcp の UtageReader の archive_* を呼ぶだけ
import test from "node:test";
import assert from "node:assert/strict";
import { utageCopy } from "../src/utagecopy.js";

test("結びが古い（archive_* が無い）ときは no_binding を返して止まらない", async () => {
  const r = await utageCopy.status({ UTAGE: { accounts: async () => ({}) } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_binding");
});

test("読み物・探す・品目は引数をそろえて渡す（探すは 50 件まで・品目は raw を付けない）", async () => {
  const calls = [];
  const UTAGE = {
    archive_status: async () => ({ ok: true }),
    archive_doc: async (d) => (calls.push(["doc", d]), { ok: true, markdown: "# x" }),
    archive_search: async (q) => (calls.push(["search", q]), { ok: true, rows: [] }),
    archive_item: async (ref, raw) => (calls.push(["item", ref, raw]), { ok: true }),
  };
  await utageCopy.doc({ UTAGE }, null);
  await utageCopy.search({ UTAGE }, "決済", "page");
  await utageCopy.item({ UTAGE }, "page:abc");
  assert.deepEqual(calls[0], ["doc", "overview"]);
  assert.deepEqual(calls[1], ["search", { words: "決済", kind: "page", limit: 50 }]);
  assert.deepEqual(calls[2], ["item", "page:abc", false]);
});

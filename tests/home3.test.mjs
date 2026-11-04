// 生徒のホームと図書館の 3 本目（2026-11-04）：種類と、版ごとの段の並び
import test from "node:test";
import assert from "node:assert/strict";
import { checkContent, checkHomeRows, KINDS } from "../src/site.js";

test("種類は一覧の 6 つか空だけ", () => {
  assert.equal(checkContent({ title: "a", kind: "セミナー" }).row.kind, "セミナー");
  assert.equal(checkContent({ title: "a", kind: "" }).row.kind, null);
  assert.equal(checkContent({ title: "a" }).row.kind, null);
  assert.deepEqual(checkContent({ title: "a", kind: "動画" }), { ok: false, error: "bad_kind", field: "kind" });
  assert.equal(KINDS.length, 6);
});
test("段の並びは決まった名前だけ・重なりは 1 つに", () => {
  assert.deepEqual(checkHomeRows({ lab: ["picks", "record", "picks"] }), { ok: true, rows: { lab: ["picks", "record"] } });
  assert.equal(checkHomeRows({ lab: ["news"] }).ok, false);
  assert.deepEqual(checkHomeRows({ zzz: ["record"] }), { ok: true, rows: {} });
});

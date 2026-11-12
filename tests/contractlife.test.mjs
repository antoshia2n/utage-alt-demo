// 契約の便 3（ShiaSign）：期限の通知・自動更新・期間満了・更新と解約・まとめてダウンロード（ZIP）の試験
// 走らせ方：node --test tests/contractlife.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeContracts } from "../src/contracts.js";
import { makeContractLife, nextEnd, zip, crc32 } from "../src/contractlife.js";

function setup() {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = { put: async (k, b) => { r2.set(k, new Uint8Array(b)); }, get: async (k) => r2.has(k) ? { body: r2.get(k) } : null, head: async (k) => r2.has(k) ? {} : null };
  const mails = [], notes = [];
  const logInbound = async () => {};
  const contracts = makeContracts({ db: s.db, logInbound });
  const life = makeContractLife({ db: s.db, logInbound, contracts, mail: async (env, m) => { mails.push(m); return { ok: true }; }, admins: async () => ["naoki@example.com"], notify: async (env, m) => { notes.push(m); }, origin: () => "https://lab.example" });
  return { s, r2, contracts, life, env: { IMAGES }, mails, notes };
}
const at9 = (day) => Date.parse(day + "T00:30:00Z"); // 日本時間 9:30
const mk = async (x, o) => (await x.contracts.create(x.env, { title: "契約", company: "テスト商事", status: "signed", signed_on: "2026-01-05", start_date: "2026-01-01", end_date: "2026-12-31", amount: 120000, ...o }, "a")).id;

test("同じ長さだけ延ばす（開始日が無ければ 1 年）", () => {
  assert.equal(nextEnd("2026-01-01", "2026-12-31"), "2027-12-31");
  assert.equal(nextEnd(null, "2026-06-30"), "2027-06-30");
  assert.equal(nextEnd("2026-04-01", "2026-09-30"), "2027-03-31");
});

test("30 日前から 1 回だけ通知する。9 時台だけ動く", async () => {
  const x = setup();
  await mk(x, {});
  assert.equal((await x.life.daily(x.env, { now: at9("2026-11-30") })).noticed, 0); // あと 31 日
  assert.equal((await x.life.daily(x.env, { now: Date.parse("2026-12-01T05:00:00Z") })).skipped, true); // 14 時
  const r = await x.life.daily(x.env, { now: at9("2026-12-01") });
  assert.equal(r.noticed, 1);
  assert.ok(x.mails[0].subject.includes("30日前")); assert.equal(x.mails[0].to, "naoki@example.com");
  assert.equal(x.notes.length, 1);
  assert.equal((await x.life.daily(x.env, { now: at9("2026-12-02") })).noticed, 0);
});

test("終了日を過ぎたら：自動更新ありは延ばし、なしは終了にする。どちらも履歴に残る", async () => {
  const x = setup();
  const a = await mk(x, { auto_renew: true });
  const b = await mk(x, { auto_renew: false });
  const r = await x.life.daily(x.env, { now: at9("2027-01-01") });
  assert.equal(r.renewed, 1); assert.equal(r.ended, 1);
  assert.equal((await x.contracts.get(x.env, a)).contract.end_date, "2027-12-31");
  assert.equal((await x.contracts.get(x.env, b)).contract.status, "ended");
  assert.equal((await x.life.history(x.env, a)).items[0].label, "更新");
  assert.equal((await x.life.history(x.env, b)).items[0].label, "期間満了で終了");
});

test("画面から更新・解約：日付を確かめ、履歴に残す", async () => {
  const x = setup();
  const id = await mk(x, { auto_renew: true });
  assert.equal((await x.life.renew(x.env, { id, to_end: "2026-06-01" }, "a")).error, "bad_date");
  assert.equal((await x.life.renew(x.env, { id }, "a")).to_end, "2027-12-31");
  const c = await x.life.cancel(x.env, { id, on: "2027-03-31", note: "先方の都合" }, "a");
  assert.equal(c.ok, true);
  const g = (await x.contracts.get(x.env, id)).contract;
  assert.equal(g.status, "ended"); assert.equal(g.end_date, "2027-03-31"); assert.equal(g.auto_renew, false);
  const h = (await x.life.history(x.env, id)).items.map((i) => i.kind).sort();
  assert.deepEqual(h, ["cancelled", "renewed"]);
  assert.equal((await x.life.cancel(x.env, { id }, "a")).error, "already_ended");
  const d = await mk(x, { status: "draft" });
  assert.equal((await x.life.renew(x.env, { id: d }, "a")).error, "not_signed");
});

test("まとめてダウンロード：ZIP に台帳・履歴・書類（規則性のあるファイル名）", async () => {
  const x = setup();
  const id = await mk(x, {});
  await x.contracts.addFile(x.env, { contract_id: id, role: "signed", name: "契約書.pdf", body: new TextEncoder().encode("%PDF-1.7 a") }, "a");
  const r = await x.life.exportZip(x.env, "a");
  assert.equal(r.ok, true);
  const txt = new TextDecoder().decode(r.body);
  assert.ok(txt.includes("契約の台帳.csv")); assert.ok(txt.includes("書類/20260105_テスト商事_120000円_署名済み_1.pdf"));
  assert.ok(txt.includes("%PDF-1.7 a"));
  const v = new DataView(r.body.buffer); assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(r.body.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(r.body.length - 22 + 10, true), 4);
});

test("CRC32 は標準の値", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(zip([]).length, 22);
});

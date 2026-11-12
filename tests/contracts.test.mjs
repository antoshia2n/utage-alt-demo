// 契約の便 1（ShiaSign）：契約の台帳と書類の試験。
//  入れる・検索（日付・金額・取引先の組み合わせ）・状態・ハッシュ値で書き換えを見つける・上書きしない・消さない・入力の確かめ
// 走らせ方：node --test tests/contracts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeContracts, sha256Hex, daysLeft, shape, MAX_FILE } from "../src/contracts.js";

function setup() {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = {
    put: async (k, b, o) => { r2.set(k, { b: new Uint8Array(b), o }); },
    get: async (k) => r2.has(k) ? { body: r2.get(k).b } : null,
    head: async (k) => r2.has(k) ? {} : null,
    delete: async (k) => { r2.delete(k); },
  };
  const logs = [];
  const c = makeContracts({ db: s.db, logInbound: async (env, ch, req) => { logs.push([ch, req]); } });
  return { s, r2, c, env: { IMAGES }, logs };
}
const pdf = (t) => new TextEncoder().encode("%PDF-1.7 " + t);
const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";

test("入れる：題名は必須・金額は数だけ・終了日は開始日より後", async () => {
  const { c, env } = setup();
  assert.equal((await c.create(env, {}, "a")).error, "need_title");
  assert.equal((await c.create(env, { title: "x", amount: "abc" }, "a")).error, "bad_amount");
  assert.equal((await c.create(env, { title: "x", start_date: "2026-05-01", end_date: "2026-04-01" }, "a")).error, "end_before_start");
  assert.equal((await c.create(env, { title: "x", signer_email: "nope" }, "a")).error, "bad_email");
  const r = await c.create(env, { title: "コンサル契約", amount: "300,000円", company: "株式会社テスト" }, "a");
  assert.equal(r.ok, true);
  const g = await c.get(env, r.id);
  assert.equal(g.contract.amount, 300000); assert.equal(g.contract.status, "draft"); assert.equal(g.contract.status_label, "下書き");
});

test("検索：日付の範囲・金額の範囲・取引先を組み合わせられる。顧客ごとにも絞れる", async () => {
  const { c, env } = setup();
  await c.create(env, { title: "A", company: "株式会社アルファ", amount: 100000, signed_on: "2026-03-10", person_id: P1, status: "signed" }, "a");
  await c.create(env, { title: "B", company: "ベータ合同会社", amount: 500000, signed_on: "2026-06-01", person_id: P2, status: "signed" }, "a");
  await c.create(env, { title: "C", signer_name: "山田 花子", amount: 800000, start_date: "2026-09-01" }, "a");
  assert.equal((await c.list(env, {})).count, 3);
  assert.equal((await c.list(env, { from: "2026-05-01", to: "2026-12-31" })).count, 2);
  assert.equal((await c.list(env, { min: 200000, max: 600000 })).items[0].title, "B");
  assert.equal((await c.list(env, { q: "ｱﾙﾌｧ" })).count, 1); // 半角カナでも見つかる
  assert.equal((await c.list(env, { q: "アルファ" })).count, 1);
  assert.equal((await c.list(env, { q: "山田", from: "2026-08-01", min: 700000 })).count, 1);
  assert.equal((await c.list(env, { person_id: P2 })).items[0].title, "B");
  assert.equal((await c.list(env, { from: "2026/01/01" })).error, "bad_date");
  const all = await c.list(env, {});
  assert.equal(all.counts.signed, 2); assert.equal(all.counts.draft, 1);
});

test("状態：署名待ちは依頼した日と相手を残す。締結済みは締結日が入り、署名済みの書類が無ければ知らせる", async () => {
  const { c, env } = setup();
  const { id } = await c.create(env, { title: "X", signer_email: "a@example.com" }, "a");
  assert.equal((await c.setStatus(env, { id, status: "nope" }, "a")).error, "bad_status");
  await c.setStatus(env, { id, status: "waiting" }, "a");
  let g = (await c.get(env, id)).contract;
  assert.equal(g.status, "waiting"); assert.ok(g.requested_at); assert.equal(g.requested_to, "a@example.com");
  const r = await c.setStatus(env, { id, status: "signed", signed_on: "2026-11-12" }, "a");
  assert.deepEqual(r.warnings, ["no_signed_file"]);
  g = (await c.get(env, id)).contract;
  assert.equal(g.signed_on, "2026-11-12"); assert.equal(g.status_label, "締結済み");
});

test("書類：中身は加工せず R2 へ。ハッシュ値を持ち、書き換えると見つかる", async () => {
  const { c, env, r2, logs } = setup();
  const { id } = await c.create(env, { title: "X" }, "a");
  const body = pdf("signed");
  const f = await c.addFile(env, { contract_id: id, role: "signed", name: "契約書.pdf", source: "docusign", size: body.byteLength, body }, "a");
  assert.equal(f.ok, true);
  assert.equal(f.sha256, await sha256Hex(body));
  const key = [...r2.keys()][0];
  assert.ok(key.startsWith(`contracts/${id}/`));
  assert.deepEqual([...r2.get(key).b], [...body]); // 1 バイトも変えていない
  assert.equal((await c.verify(env, f.id)).match, true);
  r2.get(key).b = pdf("tampered"); // 置き場の中身を書き換える
  const v = await c.verify(env, f.id);
  assert.equal(v.match, false);
  assert.ok(logs.some(([ch]) => ch === "contract_file_mismatch"));
  r2.delete(key);
  assert.equal((await c.verify(env, f.id)).missing, true);
});

test("書類：同じ契約に入れても別の住所（上書きしない）。役目・大きさ・空を確かめる", async () => {
  const { c, env, r2 } = setup();
  const { id } = await c.create(env, { title: "X" }, "a");
  await c.addFile(env, { contract_id: id, role: "signed", name: "a.pdf", body: pdf("1") }, "a");
  await c.addFile(env, { contract_id: id, role: "signed", name: "a.pdf", body: pdf("2") }, "a");
  assert.equal(r2.size, 2);
  assert.equal((await c.addFile(env, { contract_id: id, role: "bad", name: "a.pdf", body: pdf("3") }, "a")).error, "bad_role");
  assert.equal((await c.addFile(env, { contract_id: id, role: "signed", name: "a.pdf", size: MAX_FILE + 1, body: pdf("3") }, "a")).error, "too_big");
  assert.equal((await c.addFile(env, { contract_id: id, role: "signed", name: "a.pdf", body: new Uint8Array(0) }, "a")).error, "empty");
  assert.equal((await c.addFile(env, { contract_id: "33333333-3333-4333-8333-333333333333", role: "signed", name: "a.pdf", body: pdf("3") }, "a")).error, "not_found");
  const g = (await c.get(env, id)).contract;
  assert.equal(g.files.length, 2); assert.equal(g.signed_file, true);
  assert.equal(g.files[0].url, null); // R2 の住所は外に出さない
});

test("消さない：しまうと一覧から消えるが、戻せる。消す道具は無い", async () => {
  const { c, env, s } = setup();
  const { id } = await c.create(env, { title: "X" }, "a");
  await c.archive(env, { id, archived: true }, "a");
  assert.equal((await c.list(env, {})).count, 0);
  assert.equal((await c.list(env, { archived: true })).count, 1);
  assert.equal(s.t.b_contracts.length, 1);
  await c.archive(env, { id, archived: false }, "a");
  assert.equal((await c.list(env, {})).count, 1);
  assert.equal(c.remove, undefined);
});

test("Google ドキュメントのリンク・番号のいたずら・残り日数", async () => {
  const { c, env } = setup();
  const { id } = await c.create(env, { title: "X" }, "a");
  assert.equal((await c.addDocLink(env, { contract_id: id, url: "https://example.com/doc" }, "a")).error, "bad_doc_url");
  assert.equal((await c.addDocLink(env, { contract_id: id, url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit" }, "a")).ok, true);
  assert.equal((await c.get(env, "x' or 1=1")).error, "not_found");
  assert.equal(await c.file(env, "../etc"), null);
  assert.equal(daysLeft("2026-12-12", Date.parse("2026-11-12T03:00:00Z")), 30);
  assert.equal(daysLeft(null), null);
  assert.equal(shape({ title: "x", person_id: "bad" }).error, "bad_person");
});

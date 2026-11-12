// 契約の便 2（ShiaSign）：署名ページの試験。依頼 → コード（LINE か メール）→ 確かめ → PDF → 署名 → 記録・時刻の証明・控え
// 走らせ方：node --test tests/contractsign.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeContracts, sha256Hex } from "../src/contracts.js";
import { makeContractSign, tsaRequest, tsaStatus, maskEmail, CODE_TRIES } from "../src/contractsign.js";

const P1 = "11111111-1111-4111-8111-111111111111";
function setup({ lineOk = false, tsaOk = true, mailOk = true } = {}) {
  const s = fakeStore();
  const r2 = new Map();
  const IMAGES = { put: async (k, b) => { r2.set(k, new Uint8Array(b)); }, get: async (k) => r2.has(k) ? { body: r2.get(k) } : null, head: async (k) => r2.has(k) ? {} : null };
  const logs = [], mails = [], lines = [], notes = [];
  const logInbound = async (env, ch, req) => { logs.push([ch, req]); };
  const contracts = makeContracts({ db: s.db, logInbound });
  const tsaBody = new Uint8Array([0x30, 0x0a, 0x30, 0x03, 0x02, 0x01, 0x00, 0x30, 0x03, 0x02, 0x01, 0x00]);
  const fetch = async (url, o) => { assert.equal(url, "https://freetsa.org/tsr"); assert.equal(o.headers["content-type"], "application/timestamp-query"); return tsaOk ? new Response(tsaBody) : new Response("x", { status: 500 }); };
  const sign = makeContractSign({ db: s.db, logInbound, contracts, fetch,
    mail: async (env, m) => { mails.push(m); return { ok: mailOk }; },
    hasLine: async () => lineOk, line: async (env, pid, text) => { lines.push(text); return { sent: lineOk }; },
    admins: async () => ["naoki@example.com"], notify: async (env, m) => { notes.push(m); }, origin: () => "https://lab.example" });
  return { s, r2, contracts, sign, env: { IMAGES }, logs, mails, lines, notes };
}
const tokenOf = (mail) => mail.text.match(/#t=([0-9a-f]{48})/)[1];
const codeOf = (text) => text.match(/(\d{6})/)[1];
async function prepared(o) {
  const x = setup(o);
  const { id } = await x.contracts.create(x.env, { title: "テスト契約", company: "テスト商事", signer_name: "山田", signer_email: "yamada@example.com", amount: 100000, person_id: P1 }, "a");
  const pdf = new TextEncoder().encode("%PDF-1.7 test");
  await x.contracts.addFile(x.env, { contract_id: id, role: "draft", name: "契約書.pdf", body: pdf }, "a");
  return { ...x, id, pdf };
}

test("依頼：PDF が無ければ断る。あればリンクをメールし、署名待ちにする。リンクの鍵は表に持たない", async () => {
  const x = setup();
  const { id } = await x.contracts.create(x.env, { title: "X", signer_email: "a@example.com" }, "a");
  assert.equal((await x.sign.request(x.env, { contract_id: id }, "a")).error, "need_pdf");
  const p = await prepared();
  const r = await p.sign.request(p.env, { contract_id: p.id }, "a");
  assert.equal(r.ok, true); assert.equal(r.to, "yamada@example.com");
  const t = tokenOf(p.mails[0]);
  assert.ok(!JSON.stringify(p.s.t.b_contract_signs).includes(t));
  assert.equal((await p.contracts.get(p.env, p.id)).contract.status, "waiting");
  const o = await p.sign.open(p.env, { t });
  assert.equal(o.ok, true); assert.equal(o.title, "テスト契約"); assert.equal(o.email, maskEmail("yamada@example.com"));
  assert.equal((await p.sign.open(p.env, { t: "0".repeat(48) })).error, "bad_link");
});

test("コード：LINE でつながっていれば LINE、つながっていなければメール。続けて送るのは 60 秒あける", async () => {
  const a = await prepared({ lineOk: true });
  await a.sign.request(a.env, { contract_id: a.id }, "a");
  const ta = tokenOf(a.mails[0]);
  assert.equal((await a.sign.sendCode(a.env, { t: ta })).channel, "line");
  assert.equal(a.lines.length, 1);
  assert.equal((await a.sign.sendCode(a.env, { t: ta })).error, "wait");
  const b = await prepared({ lineOk: false });
  await b.sign.request(b.env, { contract_id: b.id }, "a");
  const r = await b.sign.sendCode(b.env, { t: tokenOf(b.mails[0]) });
  assert.equal(r.channel, "email"); assert.equal(b.mails.length, 2);
});

test("確かめ：違うコードは回数を数え、5 回で止める。正しいコードで PDF が見られる", async () => {
  const p = await prepared();
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  const t = tokenOf(p.mails[0]);
  await p.sign.sendCode(p.env, { t });
  const code = codeOf(p.mails[1].text);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await p.sign.pdf(p.env, { t, session: "a".repeat(48) })).error, "need_code");
  const w = await p.sign.verify(p.env, { t, code: wrong });
  assert.equal(w.error, "bad_code"); assert.equal(w.left, CODE_TRIES - 1);
  const v = await p.sign.verify(p.env, { t, code });
  assert.equal(v.ok, true); assert.equal(v.file.sha256, await sha256Hex(p.pdf));
  const f = await p.sign.pdf(p.env, { t, session: v.session });
  assert.deepEqual(new Uint8Array(await f.response.arrayBuffer()), p.pdf);
  // 使い終わったコードはもう効かない
  assert.equal((await p.sign.verify(p.env, { t, code })).error, "no_code");
});

test("確かめ：5 回まちがえるとそのコードは使えない", async () => {
  const p = await prepared();
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  const t = tokenOf(p.mails[0]);
  await p.sign.sendCode(p.env, { t });
  const code = codeOf(p.mails[1].text);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < CODE_TRIES; i++) await p.sign.verify(p.env, { t, code: wrong });
  assert.equal((await p.sign.verify(p.env, { t, code })).error, "too_many_tries");
});

async function verified(o) {
  const p = await prepared(o);
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  const t = tokenOf(p.mails[0]);
  await p.sign.sendCode(p.env, { t });
  const v = await p.sign.verify(p.env, { t, code: codeOf(p.mails[1].text) });
  return { ...p, t, session: v.session };
}

test("署名：氏名と同意が要る。署名すると締結済み・同じ PDF を署名済みに・記録と時刻の証明・控えのメール", async () => {
  const p = await verified();
  assert.equal((await p.sign.submit(p.env, { t: p.t, session: p.session, name: "", agree: true })).error, "need_name");
  assert.equal((await p.sign.submit(p.env, { t: p.t, session: p.session, name: "山田 太郎", agree: false })).error, "need_agree");
  const r = await p.sign.submit(p.env, { t: p.t, session: p.session, name: "山田 太郎", agree: true }, { ip: "203.0.113.5", ua: "test-agent" });
  assert.equal(r.ok, true); assert.equal(r.tsa, true); assert.equal(r.sha256, await sha256Hex(p.pdf));
  const c = (await p.contracts.get(p.env, p.id)).contract;
  assert.equal(c.status, "signed");
  const roles = c.files.map((f) => f.role).sort();
  assert.deepEqual(roles, ["certificate", "draft", "other", "signed"]);
  assert.equal(c.files.find((f) => f.role === "signed").sha256, r.sha256);
  const ev = c.files.find((f) => f.role === "certificate");
  const key = [...p.r2.keys()].find((k) => k.includes(ev.id));
  const json = JSON.parse(new TextDecoder().decode(p.r2.get(key)));
  assert.equal(json.signature.typed_name, "山田 太郎"); assert.equal(json.signature.ip, "203.0.113.5"); assert.equal(json.document.sha256, r.sha256);
  assert.equal(json.contract.person_id, P1);
  const ctl = p.mails.filter((m) => m.subject.includes("署名"));
  assert.ok(ctl.some((m) => m.to === "yamada@example.com" && m.text.includes(r.sha256)));
  assert.ok(ctl.some((m) => m.to === "naoki@example.com"));
  assert.equal(p.notes.length, 1);
  // 同じリンクで 2 回は署名できない
  assert.equal((await p.sign.submit(p.env, { t: p.t, session: p.session, name: "x", agree: true })).error, "already_signed");
  // 控えのリンクで署名済みの PDF が取り出せる
  const rc = p.mails.find((m) => m.to === "yamada@example.com" && m.text.includes("#r=")).text.match(/#r=([0-9a-f]{48})/)[1];
  const got = await p.sign.receipt(p.env, { r: rc });
  assert.deepEqual(new Uint8Array(await got.response.arrayBuffer()), p.pdf);
});

test("署名：時刻の証明が取れなくても署名は止めず、理由を残す", async () => {
  const p = await verified({ tsaOk: false });
  const r = await p.sign.submit(p.env, { t: p.t, session: p.session, name: "山田", agree: true });
  assert.equal(r.ok, true); assert.equal(r.tsa, false);
  assert.equal(p.s.t.b_contract_signs[0].tsa_error, "http_500");
});

test("取り消し・期限・再依頼：前の依頼のリンクは使えない", async () => {
  const p = await prepared();
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  const t1 = tokenOf(p.mails[0]);
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  assert.equal((await p.sign.open(p.env, { t: t1 })).error, "cancelled");
  const t2 = tokenOf(p.mails[1]);
  const id2 = p.s.t.b_contract_signs.find((x) => x.status === "open").id;
  await p.sign.cancel(p.env, { id: id2 }, "a");
  assert.equal((await p.sign.open(p.env, { t: t2 })).error, "cancelled");
  await p.sign.request(p.env, { contract_id: p.id }, "a");
  p.s.t.b_contract_signs.find((x) => x.status === "open").expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await p.sign.open(p.env, { t: tokenOf(p.mails[2]) })).error, "expired");
});

test("時刻の証明の頼み（DER）と返事の読み取り", () => {
  const h = "ab".repeat(32);
  const req = tsaRequest(h, "01".repeat(8));
  assert.equal(req[0], 0x30); assert.equal(req[1], req.length - 2); assert.equal(req.length, 70);
  assert.equal([...req.slice(24, 56)].map((b) => b.toString(16).padStart(2, "0")).join(""), h);
  assert.equal(tsaStatus(new Uint8Array([0x30, 0x0a, 0x30, 0x03, 0x02, 0x01, 0x00])), 0);
  assert.equal(tsaStatus(new Uint8Array([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02])), 2);
  assert.equal(tsaStatus(new Uint8Array([0x04])), null);
});

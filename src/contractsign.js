// 契約の便 2（2026-11-12 Naoki OK 12:33・ShiaSign）：相手が署名するページ。
//  流れ：①Naoki が「署名を依頼」→ 相手に署名のリンクをメール（期限 7 日・署名したら使えない）
//        ②リンクを開いて「確認コードを送る」→ 6 桁のコード。LINE でつながっている人は LINE、ほかはメール
//        ③コードを入れると PDF の全文が出る（60 分）④氏名を打ち、同意にチェックして署名
//        ⑤署名の記録（日時・IP・端末・PDF の指紋・氏名）を JSON で残し、その指紋を外の時刻の証明（FreeTSA・RFC 3161）へ。
//          見せた PDF をそのまま「署名済み」として入れ、契約を締結済みにする。相手と Naoki へ控えのメール（指紋つき）
//  ・リンク・コード・画面の鍵は SHA-256 だけを表に持つ。PDF は加工しない
//  ・これは電子署名法第 3 条の推定効を狙う仕組みではない（Naoki 判断 2026-11-12 11:20）。画面では「署名ページ（同意の記録）」と書く
//  ・表は b_contract_signs（正本は supabase/b_contract_signs.sql）
import { sha256Hex } from "./contracts.js";

const S = "b_contract_signs";
const F = "b_contract_files";
const C = "b_contracts";
export const LINK_DAYS = 7;
export const CODE_MINUTES = 10;
export const CODE_TRIES = 5;
export const CODE_SENDS = 5;
export const CODE_GAP_SEC = 60;
export const SESSION_MINUTES = 60;
export const RECEIPT_DAYS = 30;
export const TSA_URL = "https://freetsa.org/tsr";
export const AGREE_TEXT = "上の契約書の内容を確認し、同意して署名します。";
const TOKEN_RE = /^[0-9a-f]{48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+[.][^\s@]+$/;
const enc = new TextEncoder();

export const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const hashOf = (s) => sha256Hex(enc.encode(String(s)));
export function sixDigits() { const v = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000; return String(v).padStart(6, "0"); }
export const maskEmail = (e) => { const [l, d] = String(e || "").split("@"); return l && d ? `${l.slice(0, 2)}${"*".repeat(Math.max(1, l.length - 2))}@${d}` : ""; };
const jstDay = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const jstTime = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19) + "（日本時間）";

// ---------- RFC 3161：時刻の証明の頼み（TimeStampReq）を DER で組む・返事の状態を読む ----------
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export function tsaRequest(hashHex, nonceHex = randomHex(8)) {
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00];
  const imprint = [0x30, 0x31, ...algo, 0x04, 0x20, ...hexToBytes(hashHex)];
  const nonce = [0x02, 0x09, 0x00, ...hexToBytes(nonceHex)];
  const body = [0x02, 0x01, 0x01, ...imprint, ...nonce, 0x01, 0x01, 0xff];
  return new Uint8Array([0x30, body.length, ...body]);
}
// 返事の PKIStatus（0 = 認めた・1 = 手を加えて認めた）。形が違えば null
export function tsaStatus(buf) {
  const b = new Uint8Array(buf);
  let i = 0;
  const len = () => { let l = b[i++]; if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = (l << 8) | b[i++]; } return l; };
  if (b[i++] !== 0x30) return null; len();
  if (b[i++] !== 0x30) return null; len();
  if (b[i++] !== 0x02) return null; const l = len();
  let v = 0; for (let k = 0; k < l; k++) v = (v << 8) | b[i++];
  return v;
}

export function makeContractSign(h) {
  // h：db・logInbound・contracts（makeContracts の戻り）・mail(env,{to,subject,text})・line(env,person_id,text) → { sent:bool }
  //    notify(env,{title,body})（Naoki のスマホへ・無くてよい）・admins(env) → [email]・origin(env)・fetch（試験で差し替え）
  const { db, logInbound, contracts } = h;
  const doFetch = h.fetch || ((...a) => fetch(...a));
  const log = (env, ch, req, res, st = 200) => logInbound(env, ch, req, res, st).catch(() => {});
  const nowIso = () => new Date().toISOString();

  async function contractOf(env, id) { const [c] = await db(env, "GET", `${C}?select=*&id=eq.${id}`); return c || null; }

  // ---------- Naoki：署名を依頼する ----------
  async function request(env, { contract_id, file_id, email }, actor) {
    if (!UUID_RE.test(String(contract_id || ""))) return { ok: false, error: "not_found" };
    const c = await contractOf(env, contract_id);
    if (!c) return { ok: false, error: "not_found" };
    if (c.status === "signed" || c.status === "ended") return { ok: false, error: "already_signed" };
    const files = await db(env, "GET", `${F}?select=*&contract_id=eq.${c.id}&order=created_at.desc`);
    const pdfs = files.filter((x) => x.r2_key && /pdf/.test(x.content_type) && (x.role === "draft" || x.role === "other"));
    const file = file_id ? pdfs.find((x) => x.id === file_id) : pdfs[0];
    if (!file) return { ok: false, error: "need_pdf", note: "下書きの PDF を先に入れてください" };
    const to = String(email || c.signer_email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return { ok: false, error: "need_email" };
    // 前の依頼は使えなくする（同じ契約に生きたリンクを 2 本持たない）
    await db(env, "PATCH", `${S}?contract_id=eq.${c.id}&status=eq.open`, { status: "cancelled" }, "return=minimal");
    const token = randomHex(24);
    const row = { id: crypto.randomUUID(), contract_id: c.id, file_id: file.id, email: to, status: "open", code_sends: 0, code_tries: 0, token_hash: await hashOf(token), expires_at: new Date(Date.now() + LINK_DAYS * 86400e3).toISOString(), created_by: String(actor).slice(0, 200) };
    await db(env, "POST", S, [row], "return=minimal");
    const url = `${h.origin(env)}/sign.html#t=${token}`;
    const text = `${c.signer_name || ""}${c.signer_name ? " 様" : ""}\n\n株式会社Best Life Consulting（シアニン）より、契約書の署名のお願いです。\n\n契約：${c.title}\n${c.company ? "契約先：" + c.company + "\n" : ""}\n下のボタンから契約書を確認し、署名してください。開くと本人確認の 6 桁のコードをお送りします。\n\n[[契約書を確認して署名する|${url}]]\n\nこのリンクの期限は ${jstDay(Date.parse(row.expires_at))} までです。お心当たりがない場合は、このメールを破棄してください。`;
    const m = await h.mail(env, { to, subject: `【署名のお願い】${c.title}`, text });
    if (!m.ok) { await db(env, "PATCH", `${S}?id=eq.${row.id}`, { status: "cancelled" }, "return=minimal"); return { ok: false, error: "mail_failed", detail: m.error || null }; }
    await contracts.setStatus(env, { id: c.id, status: "waiting", requested_to: to }, actor);
    await log(env, "contract_sign_request", { contract_id: c.id, sign_id: row.id, file_id: file.id, to_domain: to.split("@")[1], actor }, { ok: true });
    return { ok: true, id: row.id, to, expires_at: row.expires_at, file: { id: file.id, name: file.name, sha256: file.sha256 } };
  }

  async function cancel(env, { id }, actor) {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "not_found" };
    const [s] = await db(env, "GET", `${S}?select=id,status,contract_id&id=eq.${id}`);
    if (!s) return { ok: false, error: "not_found" };
    if (s.status !== "open") return { ok: false, error: "not_open" };
    await db(env, "PATCH", `${S}?id=eq.${s.id}`, { status: "cancelled" }, "return=minimal");
    await log(env, "contract_sign_cancel", { sign_id: s.id, contract_id: s.contract_id, actor }, { ok: true });
    return { ok: true, id: s.id };
  }

  // ---------- 相手：リンクから ----------
  async function byToken(env, t) {
    if (!TOKEN_RE.test(String(t || ""))) return { error: "bad_link" };
    const [s] = await db(env, "GET", `${S}?select=*&token_hash=eq.${await hashOf(t)}`);
    if (!s) return { error: "bad_link" };
    if (s.status === "cancelled") return { error: "cancelled" };
    if (s.status === "signed") return { error: "already_signed", s };
    if (Date.parse(s.expires_at) <= Date.now()) return { error: "expired" };
    return { s };
  }

  // 開いたとき：何の契約か（中身は出さない）と、コードがどこへ届くか
  async function open(env, { t }) {
    const { s, error } = await byToken(env, t);
    if (error) return { ok: false, error };
    const c = await contractOf(env, s.contract_id);
    const viaLine = !!(c.person_id && h.hasLine && await h.hasLine(env, c.person_id));
    return { ok: true, title: c.title, company: c.company || "", channel: viaLine ? "line" : "email", email: maskEmail(s.email), verified: !!(s.session_until && Date.parse(s.session_until) > Date.now()), expires_at: s.expires_at };
  }

  async function sendCode(env, { t }) {
    const { s, error } = await byToken(env, t);
    if (error) return { ok: false, error };
    if (s.code_sends >= CODE_SENDS) return { ok: false, error: "too_many_codes" };
    if (s.code_last_at && Date.now() - Date.parse(s.code_last_at) < CODE_GAP_SEC * 1000) return { ok: false, error: "wait", seconds: Math.ceil(CODE_GAP_SEC - (Date.now() - Date.parse(s.code_last_at)) / 1000) };
    const c = await contractOf(env, s.contract_id);
    const code = sixDigits();
    const text = `【シアニン】契約書の署名の確認コード：${code}\n${CODE_MINUTES} 分以内に署名ページへ入れてください。お心当たりがなければ無視してください。`;
    let channel = "email", sent = false;
    if (c.person_id && h.line) { const r = await h.line(env, c.person_id, text).catch(() => ({ sent: false })); if (r && r.sent) { channel = "line"; sent = true; } }
    if (!sent) { const m = await h.mail(env, { to: s.email, subject: `確認コード ${code}（契約書の署名）`, text }); sent = !!m.ok; }
    if (!sent) return { ok: false, error: "send_failed" };
    await db(env, "PATCH", `${S}?id=eq.${s.id}`, { code_hash: await hashOf(s.id + ":" + code), code_expires_at: new Date(Date.now() + CODE_MINUTES * 60e3).toISOString(), code_channel: channel, code_sends: s.code_sends + 1, code_last_at: nowIso(), code_tries: 0 }, "return=minimal");
    await log(env, "contract_sign_code", { sign_id: s.id, channel }, { ok: true });
    return { ok: true, channel, email: channel === "email" ? maskEmail(s.email) : null };
  }

  async function verify(env, { t, code }) {
    const { s, error } = await byToken(env, t);
    if (error) return { ok: false, error };
    if (!s.code_hash || !s.code_expires_at) return { ok: false, error: "no_code" };
    if (Date.parse(s.code_expires_at) <= Date.now()) return { ok: false, error: "code_expired" };
    if (s.code_tries >= CODE_TRIES) return { ok: false, error: "too_many_tries" };
    const good = /^\d{6}$/.test(String(code || "")) && (await hashOf(s.id + ":" + code)) === s.code_hash;
    if (!good) {
      await db(env, "PATCH", `${S}?id=eq.${s.id}`, { code_tries: s.code_tries + 1 }, "return=minimal");
      return { ok: false, error: "bad_code", left: Math.max(0, CODE_TRIES - s.code_tries - 1) };
    }
    const session = randomHex(24);
    await db(env, "PATCH", `${S}?id=eq.${s.id}`, { verified_at: nowIso(), code_hash: null, session_hash: await hashOf(session), session_until: new Date(Date.now() + SESSION_MINUTES * 60e3).toISOString() }, "return=minimal");
    await log(env, "contract_sign_verified", { sign_id: s.id, channel: s.code_channel }, { ok: true });
    const [f] = await db(env, "GET", `${F}?select=name,sha256,size&id=eq.${s.file_id}`);
    return { ok: true, session, file: f ? { name: f.name, sha256: f.sha256, size: f.size } : null, agree: AGREE_TEXT };
  }

  async function bySession(env, t, session) {
    const r = await byToken(env, t);
    if (r.error) return r;
    if (!TOKEN_RE.test(String(session || "")) || !r.s.session_hash || (await hashOf(session)) !== r.s.session_hash) return { error: "need_code" };
    if (!r.s.session_until || Date.parse(r.s.session_until) <= Date.now()) return { error: "need_code" };
    return r;
  }

  async function pdf(env, { t, session }) {
    const { s, error } = await bySession(env, t, session);
    if (error) return { error };
    const [f] = await db(env, "GET", `${F}?select=*&id=eq.${s.file_id}`);
    const obj = f && f.r2_key && env.IMAGES && await env.IMAGES.get(f.r2_key);
    if (!obj) return { error: "no_file" };
    return { response: new Response(obj.body, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` } }) };
  }

  // 外の時刻の証明。届かなくても署名は止めない（理由を残す）
  async function stamp(hashHex) {
    try {
      const res = await doFetch(TSA_URL, { method: "POST", headers: { "content-type": "application/timestamp-query" }, body: tsaRequest(hashHex) });
      if (!res.ok) return { error: `http_${res.status}` };
      const buf = await res.arrayBuffer();
      const st = tsaStatus(buf);
      if (st !== 0 && st !== 1) return { error: `status_${st}` };
      return { buf };
    } catch (e) { return { error: String(e && e.message || e).slice(0, 100) }; }
  }

  async function submit(env, { t, session, name, agree }, meta = {}) {
    const { s, error } = await bySession(env, t, session);
    if (error) return { ok: false, error };
    const nm = String(name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
    if (!nm) return { ok: false, error: "need_name" };
    if (agree !== true) return { ok: false, error: "need_agree" };
    // 先に締めて、同じリンクで 2 回署名されないようにする
    const lockedAt = nowIso();
    const locked = await db(env, "PATCH", `${S}?id=eq.${s.id}&status=eq.open`, { status: "signed", signed_at: lockedAt, signer_name: nm, ip: String(meta.ip || "").slice(0, 64), user_agent: String(meta.ua || "").slice(0, 300) }, "return=representation");
    if (!Array.isArray(locked) || !locked.length) return { ok: false, error: "already_signed" };
    const c = await contractOf(env, s.contract_id);
    const [f] = await db(env, "GET", `${F}?select=*&id=eq.${s.file_id}`);
    const obj = await env.IMAGES.get(f.r2_key);
    const buf = await new Response(obj.body).arrayBuffer();
    const now = await sha256Hex(buf);
    if (now !== f.sha256) await log(env, "contract_file_mismatch", { file_id: f.id, contract_id: c.id, stored: f.sha256, now, at: "sign" }, { ok: false }, 500);
    // 見せた PDF をそのまま「署名済み」として入れる（中身は同じなので指紋も同じ）
    const signed = await contracts.addFile(env, { contract_id: c.id, role: "signed", name: f.name, source: "shiasign", body: buf }, "sign:" + s.email);
    const evidence = {
      kind: "shiasign-evidence-v1", note: "シアニンの署名ページ（同意の記録）。電子署名法第 3 条の電子署名ではありません。",
      contract: { id: c.id, title: c.title, company: c.company || "", amount: c.amount, start_date: c.start_date, end_date: c.end_date, person_id: c.person_id || null, sales_contract_id: c.sales_contract_id || null },
      document: { file_id: f.id, name: f.name, size: f.size, sha256: now, sha256_when_stored: f.sha256, signed_file_id: signed.id || null },
      request: { sign_id: s.id, sent_to: s.email, sent_at: s.created_at, expires_at: s.expires_at },
      identity: { code_channel: s.code_channel, code_verified_at: s.verified_at },
      signature: { typed_name: nm, agree_text: AGREE_TEXT, signed_at: lockedAt, ip: meta.ip || null, user_agent: meta.ua || null, country: meta.country || null },
      server: h.origin(env),
    };
    const evText = JSON.stringify(evidence, null, 2);
    const ev = await contracts.addFile(env, { contract_id: c.id, role: "certificate", name: `署名の記録_${jstDay()}.json`, source: "shiasign", body: enc.encode(evText) }, "sign:" + s.email);
    const ts = await stamp(ev.sha256);
    let tsa = null;
    if (ts.buf) tsa = await contracts.addFile(env, { contract_id: c.id, role: "other", name: `時刻の証明_${jstDay()}.tsr`, source: "shiasign", body: ts.buf }, "sign:" + s.email);
    const receipt = randomHex(24);
    await db(env, "PATCH", `${S}?id=eq.${s.id}`, { signed_file_id: signed.id || null, evidence_file_id: ev.id || null, tsa_file_id: tsa && tsa.id || null, tsa_error: ts.error || null, receipt_hash: await hashOf(receipt), session_hash: null }, "return=minimal");
    await contracts.setStatus(env, { id: c.id, status: "signed", signed_on: jstDay() }, "sign:" + s.email);
    // 控え：相手と Naoki へ（指紋と時刻を本文に書く。メールの受け箱に残る控えになる）
    const receiptUrl = `${h.origin(env)}/sign.html#r=${receipt}`;
    const body = `契約書への署名を受け付けました。この内容は控えとして保管してください。\n\n契約：${c.title}\n${c.company ? "契約先：" + c.company + "\n" : ""}署名した人：${nm}\n署名の日時：${jstTime(lockedAt)}\n契約書：${f.name}\n契約書の指紋（SHA-256）：${now}\n署名の記録の指紋（SHA-256）：${ev.sha256}\n外の時刻の証明：${tsa ? "取得しました（FreeTSA）" : "取得できませんでした"}\n\n署名した契約書は ${RECEIPT_DAYS} 日のあいだ、下のボタンから取り出せます。手元に保存してください。\n[[署名した契約書を開く|${receiptUrl}]]\n\n指紋は、ファイルの中身が 1 文字でも変わると別の値になります。お手元のファイルの指紋と比べることで、書き換えがないかを確かめられます。`;
    const toSigner = await h.mail(env, { to: s.email, subject: `【控え】署名を受け付けました：${c.title}`, text: body });
    const admins = h.admins ? await h.admins(env) : [];
    for (const a of admins) await h.mail(env, { to: a, subject: `【署名済み】${c.company || nm}：${c.title}`, text: body.replace(receiptUrl, `${h.origin(env)}/admin`) });
    if (h.notify) await h.notify(env, { title: "契約書に署名がありました", body: `${c.company || nm}：${c.title}` }).catch(() => {});
    await log(env, "contract_signed", { sign_id: s.id, contract_id: c.id, sha256: now, evidence: ev.sha256, tsa: !!tsa, tsa_error: ts.error || null, mail_signer: !!toSigner.ok }, { ok: true });
    return { ok: true, signed_at: lockedAt, sha256: now, evidence_sha256: ev.sha256, tsa: !!tsa };
  }

  // 署名したあとの控え（30 日）
  async function receipt(env, { r }) {
    if (!TOKEN_RE.test(String(r || ""))) return { error: "bad_link" };
    const [s] = await db(env, "GET", `${S}?select=*&receipt_hash=eq.${await hashOf(r)}`);
    if (!s || s.status !== "signed" || Date.now() - Date.parse(s.signed_at) > RECEIPT_DAYS * 86400e3) return { error: "bad_link" };
    const [f] = await db(env, "GET", `${F}?select=*&id=eq.${s.signed_file_id || s.file_id}`);
    const obj = f && f.r2_key && env.IMAGES && await env.IMAGES.get(f.r2_key);
    if (!obj) return { error: "no_file" };
    return { response: new Response(obj.body, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` } }) };
  }

  return { request, cancel, open, sendCode, verify, pdf, submit, receipt, stamp };
}

// 契約の便 1（2026-11-12 Naoki OK 12:14・ShiaSign）：契約の台帳と書類の保管。DocuSign を解約しても契約を回すため。
//  ・表は b_contracts（契約 1 件 1 行）と b_contract_files（書類 1 つ 1 行）。正本は supabase/b_contracts.sql
//  ・書類の中身は R2（IMAGES の箱）の contracts/<契約の番号>/<書類の番号>.<拡張子>。毎回新しい番号なので上書きしない
//  ・入れたときに SHA-256（ハッシュ値）を計算して表に持つ。verify で R2 の中身と比べ、書き換えを見つける
//  ・書類は直さない・消さない（表の仕掛けでも断る）。契約も消さず「しまう」だけ（電子帳簿保存法の保存期間のため）
//  ・検索は電子帳簿保存法の 3 つ：日付（締結日、無ければ開始日）の範囲・金額の範囲・取引先（会社名・氏名・メール）。組み合わせられる
//  ・読み書きはシアニン用の画面だけ（呼ぶ側で requireAdmin）。操作は全部 inbound_log に残す
//  ・署名ページは便 2（src/contractsign.js）。期限の知らせ（便 3）はまだ無い
export const STATUSES = ["draft", "ready", "waiting", "signed", "ended"];
export const STATUS_LABEL = { draft: "下書き", ready: "署名依頼前", waiting: "署名待ち", signed: "締結済み", ended: "終了・解約" };
export const ROLES = ["draft", "signed", "certificate", "other"];
export const SOURCES = ["upload", "docusign", "google_docs", "shiasign", "other"];
export const MAX_FILE = 30 * 1024 * 1024; // 契約書 1 つの上限（PDF としては十分大きい）
const C = "b_contracts";
const F = "b_contract_files";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GDOC_RE = /^https:[/][/]docs[.]google[.]com[/]document[/]d[/][A-Za-z0-9_-]{20,80}/;
const EXT_TYPE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", json: "application/json", zip: "application/zip" };

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const extOf = (name) => { const m = String(name || "").toLowerCase().match(/[.]([a-z0-9]{2,5})$/); return m ? m[1] : ""; };
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();
export const dateOf = (r) => r.signed_on || r.start_date || null; // 検索に使う「取引年月日」

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 終了日までの日数（日本時間の今日から）。終了日が無ければ null
export function daysLeft(end, now = Date.now()) {
  if (!end || !DATE_RE.test(end)) return null;
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.parse(end) - Date.parse(today)) / 86400000);
}

// 入力を表の行の形へ。返り値 { ok, row } か { ok:false, error }
export function shape(b, { partial = false } = {}) {
  const row = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has("title")) { const t = clean(b.title, 200); if (!t) return { ok: false, error: "need_title" }; row.title = t; }
  for (const [k, n] of [["kind", 40], ["company", 120], ["signer_name", 80], ["signer_email", 200], ["note", 2000]]) if (!partial || has(k)) row[k] = clean(b[k], n);
  if (row.signer_email && !/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(row.signer_email)) return { ok: false, error: "bad_email" };
  if (!partial || has("amount")) {
    const v = b.amount;
    if (v === "" || v == null) row.amount = null;
    else { const n = Number(String(v).replace(/[,，円\s]/g, "")); if (!Number.isInteger(n) || n < 0) return { ok: false, error: "bad_amount" }; row.amount = n; }
  }
  for (const k of ["start_date", "end_date", "signed_on"]) if (!partial || has(k)) {
    const v = b[k]; if (v === "" || v == null) row[k] = null; else if (!DATE_RE.test(String(v))) return { ok: false, error: "bad_date", field: k }; else row[k] = String(v);
  }
  if (row.start_date && row.end_date && row.end_date < row.start_date) return { ok: false, error: "end_before_start" };
  if (!partial || has("auto_renew")) row.auto_renew = !!b.auto_renew;
  if (!partial || has("person_id")) { const p = b.person_id ? String(b.person_id) : null; if (p && !UUID_RE.test(p)) return { ok: false, error: "bad_person" }; row.person_id = p; }
  if (!partial || has("sales_contract_id")) {
    const v = b.sales_contract_id; if (v === "" || v == null) row.sales_contract_id = null;
    else { const n = Number(v); if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "bad_sales_contract" }; row.sales_contract_id = n; }
  }
  return { ok: true, row };
}

// 検索の条件に合うか（全部「かつ」でつなぐ）
export function matches(r, f = {}) {
  if (!f.archived && r.archived) return false;
  if (f.person_id && r.person_id !== f.person_id) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.kind && r.kind !== f.kind) return false;
  if (f.q) { const w = norm(f.q); if (!norm(`${r.company} ${r.signer_name} ${r.signer_email} ${r.title} ${r.kind}`).includes(w)) return false; }
  const d = dateOf(r);
  if (f.from && (!d || d < f.from)) return false;
  if (f.to && (!d || d > f.to)) return false;
  const a = r.amount;
  if (f.min != null && f.min !== "" && (a == null || a < Number(f.min))) return false;
  if (f.max != null && f.max !== "" && (a == null || a > Number(f.max))) return false;
  return true;
}

export function makeContracts(h) {
  const { db, logInbound } = h;
  const log = (env, ch, req, res) => logInbound(env, ch, req, res, 200).catch(() => {});
  const fileView = (x) => ({ id: x.id, role: x.role, name: x.name, size: x.size || 0, sha256: x.sha256 || null, content_type: x.content_type || "", source: x.source, url: x.r2_key ? null : x.url, has_file: !!x.r2_key, created_at: x.created_at, created_by: x.created_by });
  const view = (r, files = []) => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status, date: dateOf(r), days_left: daysLeft(r.end_date),
    files: files.map(fileView), signed_file: files.some((x) => x.role === "signed" && x.r2_key) });

  async function one(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [r] = await db(env, "GET", `${C}?select=*&id=eq.${id}`);
    return r || null;
  }

  // 一覧と検索。f：q・status・kind・from・to・min・max・person_id・archived
  async function list(env, f = {}) {
    for (const k of ["from", "to"]) if (f[k] && !DATE_RE.test(f[k])) return { ok: false, error: "bad_date", field: k };
    if (f.status && !STATUSES.includes(f.status)) return { ok: false, error: "bad_status" };
    let path = `${C}?select=*&order=updated_at.desc&limit=5000`;
    if (f.person_id) { if (!UUID_RE.test(f.person_id)) return { ok: false, error: "bad_person" }; path += `&person_id=eq.${f.person_id}`; }
    const all = await db(env, "GET", path);
    const rows = all.filter((r) => matches(r, f));
    const ids = rows.map((r) => r.id);
    const files = ids.length ? await db(env, "GET", `${F}?select=*&contract_id=in.(${ids.join(",")})&limit=20000`) : [];
    const by = {}; for (const x of files) (by[x.contract_id] = by[x.contract_id] || []).push(x);
    const counts = {}; for (const s of STATUSES) counts[s] = 0;
    for (const r of all) if (!r.archived && (!f.person_id || r.person_id === f.person_id)) counts[r.status]++;
    const kinds = [...new Set(all.map((r) => r.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
    return { ok: true, count: rows.length, total: all.filter((r) => !r.archived).length, counts, kinds, items: rows.map((r) => view(r, by[r.id] || [])) };
  }

  async function get(env, id) {
    const r = await one(env, id);
    if (!r) return { ok: false, error: "not_found" };
    const files = await db(env, "GET", `${F}?select=*&contract_id=eq.${r.id}&order=created_at.asc`);
    // 便 2：署名の依頼（鍵の指紋は出さない）
    const signs = await db(env, "GET", `b_contract_signs?select=id,file_id,email,status,expires_at,code_channel,code_sends,verified_at,signed_at,signer_name,signed_file_id,evidence_file_id,tsa_file_id,tsa_error,created_at&contract_id=eq.${r.id}&order=created_at.desc`).catch(() => []);
    return { ok: true, contract: { ...view(r, files), signs } };
  }

  async function create(env, b, actor) {
    const s = shape(b || {}); if (!s.ok) return s;
    const row = { id: crypto.randomUUID(), ...s.row, status: "draft", archived: false, updated_by: clean(actor, 200) };
    if (b && b.status && STATUSES.includes(b.status)) row.status = b.status; // DocuSign から移すときは最初から「締結済み」で入れられる
    await db(env, "POST", C, [row], "return=minimal");
    await log(env, "contract_create", { id: row.id, title: row.title, status: row.status, actor }, { ok: true });
    return { ok: true, id: row.id };
  }

  async function update(env, b, actor) {
    const r = await one(env, b && b.id); if (!r) return { ok: false, error: "not_found" };
    const s = shape(b, { partial: true }); if (!s.ok) return s;
    const patch = { ...s.row, updated_at: new Date().toISOString(), updated_by: clean(actor, 200) };
    await db(env, "PATCH", `${C}?id=eq.${r.id}`, patch, "return=minimal");
    const changed = Object.keys(s.row).filter((k) => String(r[k] ?? "") !== String(s.row[k] ?? ""));
    await log(env, "contract_update", { id: r.id, changed, before: Object.fromEntries(changed.map((k) => [k, r[k]])), actor }, { ok: true });
    return { ok: true, id: r.id, changed };
  }

  // 状態を変える。waiting（署名待ち）にしたら依頼した日と相手を残す。signed（締結済み）は締結日が要る（無ければ今日）
  async function setStatus(env, { id, status, requested_to, signed_on }, actor) {
    const r = await one(env, id); if (!r) return { ok: false, error: "not_found" };
    if (!STATUSES.includes(status)) return { ok: false, error: "bad_status" };
    const now = new Date().toISOString();
    const patch = { status, updated_at: now, updated_by: clean(actor, 200) };
    if (status === "waiting") { patch.requested_at = now; patch.requested_to = clean(requested_to || r.signer_email, 200); }
    if (status === "signed") {
      const d = signed_on || r.signed_on || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      if (!DATE_RE.test(d)) return { ok: false, error: "bad_date", field: "signed_on" };
      patch.signed_on = d;
    }
    await db(env, "PATCH", `${C}?id=eq.${r.id}`, patch, "return=minimal");
    const files = await db(env, "GET", `${F}?select=role,r2_key&contract_id=eq.${r.id}`);
    const warn = status === "signed" && !files.some((x) => x.role === "signed" && x.r2_key) ? ["no_signed_file"] : [];
    await log(env, "contract_status", { id: r.id, from: r.status, to: status, actor }, { ok: true, warn });
    return { ok: true, id: r.id, status, warnings: warn };
  }

  // しまう・戻す（消す代わり）
  async function archive(env, { id, archived }, actor) {
    const r = await one(env, id); if (!r) return { ok: false, error: "not_found" };
    await db(env, "PATCH", `${C}?id=eq.${r.id}`, { archived: !!archived, updated_at: new Date().toISOString(), updated_by: clean(actor, 200) }, "return=minimal");
    await log(env, "contract_archive", { id: r.id, archived: !!archived, actor }, { ok: true });
    return { ok: true, id: r.id, archived: !!archived };
  }

  // 書類を 1 つ入れる。中身はそのまま R2 へ（加工しない）。ハッシュ値を計算して表に持つ
  async function addFile(env, { contract_id, role, name, source, size, type, body }, actor) {
    if (!env.IMAGES) return { ok: false, error: "no_store" };
    const r = await one(env, contract_id); if (!r) return { ok: false, error: "not_found" };
    if (!ROLES.includes(role)) return { ok: false, error: "bad_role" };
    const src = SOURCES.includes(source) ? source : "upload";
    const nm = clean(name, 200).replace(/[\r\n]/g, ""); if (!nm) return { ok: false, error: "need_name" };
    const declared = Number(size) || 0;
    if (declared > MAX_FILE) return { ok: false, error: "too_big", max: MAX_FILE };
    const buf = await new Response(body).arrayBuffer();
    if (!buf.byteLength) return { ok: false, error: "empty" };
    if (buf.byteLength > MAX_FILE) return { ok: false, error: "too_big", max: MAX_FILE };
    const ext = extOf(nm);
    const ctype = EXT_TYPE[ext] || clean(type, 100) || "application/octet-stream";
    const id = crypto.randomUUID();
    const key = `contracts/${r.id}/${id}${ext ? "." + ext : ""}`;
    if (await env.IMAGES.head(key)) return { ok: false, error: "exists" }; // 上書きはしない（番号は毎回新しいので通常は起きない）
    const hash = await sha256Hex(buf);
    await env.IMAGES.put(key, buf, { httpMetadata: { contentType: ctype }, customMetadata: { sha256: hash, contract_id: r.id } });
    await db(env, "POST", F, [{ id, contract_id: r.id, role, name: nm, r2_key: key, size: buf.byteLength, sha256: hash, content_type: ctype, source: src, created_by: clean(actor, 200) }], "return=minimal");
    await db(env, "PATCH", `${C}?id=eq.${r.id}`, { updated_at: new Date().toISOString(), updated_by: clean(actor, 200) }, "return=minimal");
    await log(env, "contract_file_add", { contract_id: r.id, file_id: id, role, name: nm, size: buf.byteLength, sha256: hash, source: src, actor }, { ok: true });
    return { ok: true, id, sha256: hash, size: buf.byteLength };
  }

  // Google ドキュメントで作った契約書をリンクで入れる（下書き用。中身は Google 側）
  async function addDocLink(env, { contract_id, url, name }, actor) {
    const r = await one(env, contract_id); if (!r) return { ok: false, error: "not_found" };
    const u = String(url || "").trim();
    if (!GDOC_RE.test(u)) return { ok: false, error: "bad_doc_url" };
    const id = crypto.randomUUID();
    const nm = clean(name, 200) || "Google ドキュメント";
    await db(env, "POST", F, [{ id, contract_id: r.id, role: "draft", name: nm, url: u.slice(0, 500), size: 0, source: "google_docs", created_by: clean(actor, 200) }], "return=minimal");
    await log(env, "contract_doc_link", { contract_id: r.id, file_id: id, actor }, { ok: true });
    return { ok: true, id };
  }

  async function fileRow(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [x] = await db(env, "GET", `${F}?select=*&id=eq.${id}`);
    return x || null;
  }

  // 書類を開く（シアニン用の画面から）。開いたことも残す
  async function file(env, id, actor) {
    const x = await fileRow(env, id);
    if (!x || !x.r2_key || !env.IMAGES) return null;
    const obj = await env.IMAGES.get(x.r2_key);
    if (!obj) return null;
    await log(env, "contract_file_open", { file_id: x.id, contract_id: x.contract_id, actor }, { ok: true });
    return new Response(obj.body, { headers: { "content-type": x.content_type || "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(x.name)}` } });
  }

  // 書き換えの確かめ：R2 の中身のハッシュ値を計算し直し、入れたときの値と比べる
  async function verify(env, id) {
    const x = await fileRow(env, id);
    if (!x) return { ok: false, error: "not_found" };
    if (!x.r2_key) return { ok: false, error: "no_file" };
    const obj = env.IMAGES && await env.IMAGES.get(x.r2_key);
    if (!obj) return { ok: true, id: x.id, match: false, missing: true, stored: x.sha256 };
    const now = await sha256Hex(await new Response(obj.body).arrayBuffer());
    const match = now === x.sha256;
    if (!match) await log(env, "contract_file_mismatch", { file_id: x.id, contract_id: x.contract_id, stored: x.sha256, now }, { ok: false });
    return { ok: true, id: x.id, match, stored: x.sha256, now };
  }

  return { list, get, create, update, setStatus, archive, addFile, addDocLink, file, verify };
}

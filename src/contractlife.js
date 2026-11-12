// 契約の便 3（2026-11-12・ShiaSign）：契約の期限・更新・解約の履歴と、まとめてダウンロード（バックアップ）。
//  ・毎日 9 時台（日本時間）の定時の処理で、締結済みの契約の終了日を見る
//      30 日前から：Naoki へメールとスマホの通知（契約と終了日ごとに 1 回だけ）
//      終了日を過ぎたら：自動更新ありは同じ長さだけ延ばして「更新」を履歴へ。自動更新なしは「終了・解約」にして「終了」を履歴へ
//  ・画面から「更新する」（新しい終了日）・「解約する」（解約の日）。どれも履歴（b_contract_history）に残り、直せない・消せない
//  ・まとめてダウンロード：台帳の CSV と全部の書類を 1 つの ZIP に。ファイル名は「取引年月日_取引先_金額_種類」
//    （電子帳簿保存法の「規則性のあるファイル名」の形）。Google Drive などへの置き場は Naoki の手元から（このアプリは Google に書かない）
import { daysLeft, dateOf, STATUS_LABEL } from "./contracts.js";

const C = "b_contracts";
const F = "b_contract_files";
const H = "b_contract_history";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const NOTICE_DAYS = 30;
export const NOTICE_HOUR_JST = 9;
export const ZIP_MAX = 90 * 1024 * 1024;
export const KIND_LABEL = { renewed: "更新", cancelled: "解約", ended: "期間満了で終了", notice: "更新の30日前の通知" };
const ROLE_LABEL = { draft: "下書き", signed: "署名済み", certificate: "締結完了証明書", other: "そのほか" };
const enc = new TextEncoder();
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const todayJst = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);

// 終了日を同じ長さだけ延ばす。開始日と「終了日の翌日」の日がそろっていれば月で数える（4/1〜9/30 なら 6 か月）。開始日が無ければ 1 年
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
export function nextEnd(start, end) {
  const after = addDays(end, 1);
  if (start && DATE_RE.test(start) && start < end) {
    if (start.slice(8) === after.slice(8)) {
      const months = (Number(after.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(after.slice(5, 7)) - Number(start.slice(5, 7));
      return addDays(addMonths(after, months), -1);
    }
    return addDays(end, Math.round((Date.parse(end) - Date.parse(start)) / 86400e3) + 1);
  }
  return addDays(addMonths(after, 12), -1);
}

// ---------- ZIP（圧縮なし・UTF-8 のファイル名） ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files) {
  const parts = [], central = []; let off = 0;
  const dt = new Date(); const time = (dt.getUTCHours() << 11) | (dt.getUTCMinutes() << 5) | (dt.getUTCSeconds() >> 1); const date = ((dt.getUTCFullYear() - 1980) << 9) | ((dt.getUTCMonth() + 1) << 5) | dt.getUTCDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, "").slice(0, 40) || "取引先なし";

export function makeContractLife(h) {
  const { db, logInbound, contracts } = h;
  const log = (env, ch, req, res, st = 200) => logInbound(env, ch, req, res, st).catch(() => {});
  const one = async (env, id) => { if (!UUID_RE.test(String(id || ""))) return null; const [c] = await db(env, "GET", `${C}?select=*&id=eq.${id}`); return c || null; };
  const addHistory = (env, row) => db(env, "POST", H, [{ id: crypto.randomUUID(), note: "", by_who: "", ...row }], "return=minimal");

  async function history(env, id) {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "not_found" };
    const rows = await db(env, "GET", `${H}?select=*&contract_id=eq.${id}&order=at.desc`);
    return { ok: true, items: rows.map((r) => ({ ...r, label: KIND_LABEL[r.kind] || r.kind })) };
  }

  // 更新する：新しい終了日（無ければ同じ長さだけ延ばす）
  async function renew(env, { id, to_end, note }, actor) {
    const c = await one(env, id); if (!c) return { ok: false, error: "not_found" };
    if (c.status !== "signed") return { ok: false, error: "not_signed" };
    if (!c.end_date) return { ok: false, error: "no_end_date" };
    const to = to_end || nextEnd(c.start_date, c.end_date);
    if (!DATE_RE.test(to) || to <= c.end_date) return { ok: false, error: "bad_date", note: "今の終了日より後の日付" };
    await contracts.update(env, { id: c.id, end_date: to }, actor);
    await addHistory(env, { contract_id: c.id, kind: "renewed", from_end: c.end_date, to_end: to, note: clean(note, 1000), by_who: clean(actor, 200) });
    await log(env, "contract_renew", { id: c.id, from: c.end_date, to, actor }, { ok: true });
    return { ok: true, id: c.id, from_end: c.end_date, to_end: to };
  }

  // 解約する：解約の日（無ければ今の終了日）を終了日にし、「終了・解約」にする
  async function cancel(env, { id, on, note }, actor) {
    const c = await one(env, id); if (!c) return { ok: false, error: "not_found" };
    if (c.status === "ended") return { ok: false, error: "already_ended" };
    const day = on || c.end_date || todayJst();
    if (!DATE_RE.test(day)) return { ok: false, error: "bad_date" };
    if (c.start_date && day < c.start_date) return { ok: false, error: "bad_date", note: "開始日より後の日付" };
    await contracts.update(env, { id: c.id, end_date: day, auto_renew: false }, actor);
    await contracts.setStatus(env, { id: c.id, status: "ended" }, actor);
    await addHistory(env, { contract_id: c.id, kind: "cancelled", from_end: c.end_date, to_end: day, note: clean(note, 1000), by_who: clean(actor, 200) });
    await log(env, "contract_cancel", { id: c.id, on: day, actor }, { ok: true });
    return { ok: true, id: c.id, end_date: day };
  }

  // 毎時の定時の処理から呼ぶ。9 時台（日本時間）だけ動く（force で時間を問わず）
  async function daily(env, { now = Date.now(), force = false } = {}) {
    const hour = new Date(now + 9 * 3600e3).getUTCHours();
    if (!force && hour !== NOTICE_HOUR_JST) return { ok: true, skipped: true };
    const rows = (await db(env, "GET", `${C}?select=*&status=eq.signed&archived=eq.false&end_date=not.is.null&limit=5000`));
    const out = { checked: rows.length, noticed: 0, renewed: 0, ended: 0 };
    for (const c of rows) {
      const left = daysLeft(c.end_date, now);
      if (left == null) continue;
      if (left < 0) {
        if (c.auto_renew) {
          const to = nextEnd(c.start_date, c.end_date);
          await contracts.update(env, { id: c.id, end_date: to }, "auto");
          await addHistory(env, { contract_id: c.id, kind: "renewed", from_end: c.end_date, to_end: to, note: "自動更新（終了日を過ぎたため、同じ長さだけ延ばした）", by_who: "auto" });
          out.renewed++;
        } else {
          await contracts.setStatus(env, { id: c.id, status: "ended" }, "auto");
          await addHistory(env, { contract_id: c.id, kind: "ended", from_end: c.end_date, to_end: c.end_date, note: "期間満了（自動更新なし）", by_who: "auto" });
          out.ended++;
        }
        continue;
      }
      if (left > NOTICE_DAYS) continue;
      const done = await db(env, "GET", `${H}?select=id&contract_id=eq.${c.id}&kind=eq.notice&to_end=eq.${c.end_date}&limit=1`);
      if (done.length) continue;
      const who = c.company || c.signer_name || "（契約先なし）";
      const text = `契約の終了日が近づいています。\n\n契約：${c.title}\n契約先：${who}\n終了日：${c.end_date}（あと ${left} 日）\n自動更新：${c.auto_renew ? "あり（何もしなければ終了日の翌日に同じ長さで延びます）" : "なし（何もしなければ終了日の翌日に「終了・解約」になります）"}\n${c.amount != null ? "金額：" + Number(c.amount).toLocaleString() + " 円\n" : ""}\n続けるか・やめるかを決めて、マーケくんの「契約」で「更新する」か「解約する」を押してください。\n[[契約を開く|${h.origin(env)}/admin]]`;
      for (const a of h.admins ? await h.admins(env) : []) await h.mail(env, { to: a, subject: `【契約の更新 ${left}日前】${who}：${c.title}`, text });
      if (h.notify) await h.notify(env, { title: `契約の終了まであと ${left} 日`, body: `${who}：${c.title}` }).catch(() => {});
      await addHistory(env, { contract_id: c.id, kind: "notice", from_end: c.end_date, to_end: c.end_date, note: `あと ${left} 日で通知`, by_who: "auto" });
      out.noticed++;
    }
    if (out.noticed || out.renewed || out.ended) await log(env, "contract_daily", {}, out);
    return { ok: true, ...out };
  }

  // まとめてダウンロード（台帳の CSV ＋ 全部の書類）。しまった契約も入れる（保存の義務は続くため）
  async function exportZip(env, actor) {
    const rows = await db(env, "GET", `${C}?select=*&order=created_at.asc&limit=5000`);
    const files = await db(env, "GET", `${F}?select=*&order=created_at.asc&limit=20000`);
    const byC = {}; for (const f of files) (byC[f.contract_id] = byC[f.contract_id] || []).push(f);
    const out = [], lines = [["契約番号", "取引年月日", "取引先", "金額", "契約内容", "種別", "状態", "開始日", "終了日", "自動更新", "しまった", "書類の種類", "ファイル名（この ZIP の中）", "元のファイル名", "指紋（SHA-256）", "リンク"]];
    let bytes = 0;
    for (const c of rows) {
      const d = (dateOf(c) || "00000000").replace(/-/g, "");
      const who = safe(c.company || c.signer_name);
      const list = byC[c.id] || [];
      if (!list.length) lines.push([c.id, dateOf(c) || "", c.company || c.signer_name, c.amount ?? "", c.title, c.kind, STATUS_LABEL[c.status], c.start_date || "", c.end_date || "", c.auto_renew ? "あり" : "なし", c.archived ? "はい" : "", "", "", "", "", ""]);
      let n = 0;
      for (const f of list) {
        n++;
        let inZip = "";
        if (f.r2_key && env.IMAGES) {
          const obj = await env.IMAGES.get(f.r2_key);
          if (obj) {
            const data = new Uint8Array(await new Response(obj.body).arrayBuffer());
            bytes += data.length;
            if (bytes > ZIP_MAX) return { ok: false, error: "too_big", max: ZIP_MAX };
            const ext = (String(f.name).match(/[.]([A-Za-z0-9]{2,5})$/) || [, "bin"])[1].toLowerCase();
            inZip = `書類/${d}_${who}_${c.amount ?? 0}円_${ROLE_LABEL[f.role] || f.role}_${n}.${ext}`;
            out.push({ name: inZip, data });
          }
        }
        lines.push([c.id, dateOf(c) || "", c.company || c.signer_name, c.amount ?? "", c.title, c.kind, STATUS_LABEL[c.status], c.start_date || "", c.end_date || "", c.auto_renew ? "あり" : "なし", c.archived ? "はい" : "", ROLE_LABEL[f.role] || f.role, inZip, f.name, f.sha256 || "", f.r2_key ? "" : f.url || ""]);
      }
    }
    const csv = "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const hist = await db(env, "GET", `${H}?select=*&order=at.asc&limit=20000`);
    const hcsv = "﻿" + [["契約番号", "日時", "種類", "前の終了日", "新しい終了日", "メモ", "誰が"], ...hist.map((r) => [r.contract_id, r.at, KIND_LABEL[r.kind] || r.kind, r.from_end || "", r.to_end || "", r.note, r.by_who])].map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const readme = `契約のまとめてダウンロード（${todayJst()}）\r\n\r\n・契約の台帳.csv：契約 1 件・書類 1 つにつき 1 行。取引年月日・取引先・金額で並べ替え・絞り込みができます\r\n・更新と解約の履歴.csv：更新・解約・通知の記録\r\n・書類/：ファイル名は「取引年月日_取引先_金額_書類の種類_番号」\r\n・指紋（SHA-256）は入れたときの値です。ファイルの指紋と比べると、書き換えがないかを確かめられます\r\n`;
    const z = zip([{ name: "はじめに.txt", data: enc.encode(readme) }, { name: "契約の台帳.csv", data: enc.encode(csv) }, { name: "更新と解約の履歴.csv", data: enc.encode(hcsv) }, ...out]);
    await log(env, "contract_export", { contracts: rows.length, files: out.length, bytes: z.length, actor }, { ok: true });
    return { ok: true, body: z, name: `契約_${todayJst()}.zip` };
  }

  return { history, renew, cancel, daily, exportZip };
}

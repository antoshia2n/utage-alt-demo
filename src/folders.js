// マーケくん便 4（2026-10-25 Naoki「OK」）：データのフォルダ。
//  ・フォルダは種類ごとの 1 段（商品のフォルダ・ページのフォルダ…）。表は b_folders（名前）と b_folder_items（データ 1 つにフォルダ 1 つ）
//  ・フォルダは置き場だけ。何も動かさない（シナリオ＝旧企画は src/plan.js。1 つのデータを何本のシナリオにも入れられる）
//  ・フォルダを消すと、中のデータは「フォルダに入っていない」に戻る（データは消えない）
//  ・表がまだ無い置き場（SQL の marke4_folders_scenarios.sql の前）でも一覧は空で返し、作る・入れるは need_sql で断る

import { PART_TYPES } from "./plan.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NAME_MAX = 40;
const PART_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const FOLDER_TYPES = Object.keys(PART_TYPES);

// フォルダの名前をそろえる（前後の空白・続いた空白）
export function folderName(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

// 一覧の行を、フォルダごとの数つきの形にする（計算だけ）
export function folderView(folders, items, type) {
  const mine = folders.filter((f) => f.part_type === type).sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), "ja"));
  const ids = new Set(mine.map((f) => f.id));
  const placed = items.filter((x) => x.part_type === type && ids.has(x.folder_id));
  const count = {};
  for (const x of placed) count[x.folder_id] = (count[x.folder_id] || 0) + 1;
  return {
    folders: mine.map((f) => ({ id: f.id, name: f.name, count: count[f.id] || 0 })),
    items: Object.fromEntries(placed.map((x) => [String(x.part_id), x.folder_id])),
  };
}

// 表がまだ無いときの返事（PostgREST の 404・PGRST205、Postgres の 42P01）
const missing = (e) => /42P01|PGRST205|does not exist|Could not find the table| 404:/i.test(String((e && e.message) || e));

export function makeFolders(h) {
  const { db, logInbound } = h;

  async function read(env) {
    try {
      const [folders, items] = await Promise.all([
        db(env, "GET", "b_folders?select=id,part_type,name,sort&order=sort.asc,name.asc"),
        db(env, "GET", "b_folder_items?select=part_type,part_id,folder_id"),
      ]);
      return { ok: true, folders, items };
    } catch (e) {
      return { ok: false, folders: [], items: [], error: missing(e) ? "need_sql" : "read_failed" };
    }
  }

  // 一覧。part_type を渡すとその種類だけ（folders と、データの番号 → フォルダの番号 items）
  async function list(env, { part_type } = {}) {
    const r = await read(env);
    if (part_type) {
      if (!PART_TYPES[part_type]) return { ok: false, error: "bad_part_type", types: FOLDER_TYPES };
      return { ok: true, part_type, ...folderView(r.folders, r.items, part_type), ...(r.ok ? {} : { note: r.error }) };
    }
    const by = {};
    for (const t of FOLDER_TYPES) { const v = folderView(r.folders, r.items, t); if (v.folders.length) by[t] = v; }
    return { ok: true, types: by, ...(r.ok ? {} : { note: r.error }) };
  }

  // 作る（name）・名前を変える（id と name）・消す（id と remove）
  async function save(env, { id, part_type, name, remove = false } = {}, actor) {
    const by = String(actor || "unknown").slice(0, 200);
    const now = new Date().toISOString();
    try {
      if (id) {
        if (!UUID_RE.test(String(id))) return { ok: false, error: "bad_id" };
        const [f] = await db(env, "GET", `b_folders?select=*&id=eq.${id}`);
        if (!f) return { ok: false, error: "not_found" };
        if (remove === true || remove === "true") {
          await db(env, "DELETE", `b_folder_items?folder_id=eq.${id}`, undefined, "return=minimal");
          await db(env, "DELETE", `b_folders?id=eq.${id}`, undefined, "return=minimal");
          await logInbound(env, "folder", { action: "remove", id, name: f.name, part_type: f.part_type, by }, { ok: true }, 200);
          return { ok: true, removed: true, id };
        }
        const n = folderName(name);
        if (!n || n.length > NAME_MAX) return { ok: false, error: "bad_name", max: NAME_MAX };
        const dup = await db(env, "GET", `b_folders?select=id&part_type=eq.${f.part_type}&name=eq.${encodeURIComponent(n)}`);
        if (dup.some((x) => x.id !== id)) return { ok: false, error: "name_taken" };
        const [row] = await db(env, "PATCH", `b_folders?id=eq.${id}`, { name: n, updated_at: now, updated_by: by }, "return=representation");
        await logInbound(env, "folder", { action: "rename", id, from: f.name, to: n, by }, { ok: true }, 200);
        return { ok: true, folder: row };
      }
      if (!PART_TYPES[part_type]) return { ok: false, error: "bad_part_type", types: FOLDER_TYPES };
      const n = folderName(name);
      if (!n || n.length > NAME_MAX) return { ok: false, error: "bad_name", max: NAME_MAX };
      const dup = await db(env, "GET", `b_folders?select=id&part_type=eq.${part_type}&name=eq.${encodeURIComponent(n)}`);
      if (dup.length) return { ok: false, error: "name_taken" };
      const [row] = await db(env, "POST", "b_folders", [{ part_type, name: n, created_at: now, updated_at: now, updated_by: by }], "return=representation");
      await logInbound(env, "folder", { action: "create", id: row.id, name: n, part_type, by }, { ok: true }, 200);
      return { ok: true, folder: row };
    } catch (e) {
      return { ok: false, error: missing(e) ? "need_sql" : "write_failed", detail: String((e && e.message) || e).slice(0, 160) };
    }
  }

  // データ 1 つ（か複数）をフォルダに入れる。folder_id を空にすると「フォルダに入っていない」に戻す
  async function assign(env, { part_type, part_id, part_ids, folder_id = null } = {}, actor) {
    if (!PART_TYPES[part_type]) return { ok: false, error: "bad_part_type", types: FOLDER_TYPES };
    const ids = (Array.isArray(part_ids) ? part_ids : [part_id]).map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!ids.length || ids.length > 200) return { ok: false, error: "need_part_id", max: 200 };
    if (ids.some((x) => !PART_ID_RE.test(x))) return { ok: false, error: "bad_part_id" };
    const by = String(actor || "unknown").slice(0, 200);
    try {
      if (folder_id) {
        if (!UUID_RE.test(String(folder_id))) return { ok: false, error: "bad_folder_id" };
        const [f] = await db(env, "GET", `b_folders?select=id,part_type,name&id=eq.${folder_id}`);
        if (!f) return { ok: false, error: "folder_not_found" };
        if (f.part_type !== part_type) return { ok: false, error: "other_type_folder", folder_type: f.part_type };
      }
      for (const pid of ids) {
        await db(env, "DELETE", `b_folder_items?part_type=eq.${part_type}&part_id=eq.${encodeURIComponent(pid)}`, undefined, "return=minimal");
        if (folder_id) await db(env, "POST", "b_folder_items", [{ part_type, part_id: pid, folder_id, updated_at: new Date().toISOString(), updated_by: by }], "return=minimal");
      }
      await logInbound(env, "folder", { action: folder_id ? "assign" : "unassign", part_type, count: ids.length, folder_id, by }, { ok: true }, 200);
      return { ok: true, part_type, count: ids.length, folder_id: folder_id || null };
    } catch (e) {
      return { ok: false, error: missing(e) ? "need_sql" : "write_failed", detail: String((e && e.message) || e).slice(0, 160) };
    }
  }

  return { read, list, save, assign };
}

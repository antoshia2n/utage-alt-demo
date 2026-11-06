// メディアの便 M1（2026-11-07 Naoki OK 08:35）：メディアの棚。画像・PDF・Google スライド・動画を 1 か所に置く。
//  ・ファイルの中身は R2（IMAGES の箱）の media/<番号>.<拡張子>。一覧は表 b_media（正本は supabase/b_media.sql）
//  ・Google スライドはファイルではなくリンク（kind=slide・url）。見るときは埋め込みの住所へ直す
//  ・UTAGE の置き場（utagesystem の S3・wasabi）にある画像と動画を、解約で消える前にまとめて写す（import_utage_media）
//    写すのは住所が UTAGE の置き場のものだけ（ほかの住所は取りに行かない）。同じ元（source）は 2 回写さない
//  ・2 本目（M2）で共有リンク（止める・期限・開かれた数）と「メディアから選ぶ」を足す
export const KINDS = ["image", "pdf", "slide", "video", "audio", "other"];
const UTAGE_FILE_RE = /^https:[/][/]utagesystem[.]s3[.]ap-northeast-1[.](amazonaws|wasabisys)[.]com[/][^\s?#]{4,400}$/;
const SLIDE_RE = /^https:[/][/]docs[.]google[.]com[/]presentation[/]d[/]([A-Za-z0-9_-]{20,80})/;
const EXT_KIND = { jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image", pdf: "pdf", mp4: "video", mov: "video", m4v: "video", webm: "video", mp3: "audio", m4a: "audio", wav: "audio" };
const EXT_TYPE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
export const MAX_UPLOAD = 95 * 1024 * 1024; // 画面から 1 回で上げられる大きさ（Workers の受け取りの上限 100MB の内側）
const MAX_IMPORT = 2 * 1024 * 1024 * 1024;
const T = "b_media";

export const extOf = (name) => { const m = String(name || "").toLowerCase().match(/[.]([a-z0-9]{2,5})$/); return m ? m[1] : ""; };
export const kindOf = (name) => EXT_KIND[extOf(name)] || "other";
export function slideEmbed(url) { const m = String(url || "").match(SLIDE_RE); return m ? `https://docs.google.com/presentation/d/${m[1]}/embed` : null; }
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
const cleanFolder = (s) => String(s || "").replace(/[\u0000-\u001f/]/g, "").trim().slice(0, 60);

export function makeMedia(h) {
  const { db, logInbound } = h;
  const view = (r) => ({ id: r.id, kind: r.kind, name: r.name, folder: r.folder || "", size: r.size || 0, content_type: r.content_type || "", source: r.source || "",
    url: r.kind === "slide" ? r.url : null, embed: r.kind === "slide" ? slideEmbed(r.url) : null, has_file: !!r.r2_key, waiting: !r.r2_key && String(r.source || "").startsWith("utage:") && !String(r.content_type || "").startsWith("error:"), created_at: r.created_at, updated_at: r.updated_at });

  async function list(env, { kind, folder, q, limit } = {}) {
    let path = `${T}?select=*&order=created_at.desc&limit=${Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000)}`;
    if (kind) { if (!KINDS.includes(kind)) return { ok: false, error: "bad_kind", kinds: KINDS }; path += `&kind=eq.${kind}`; }
    if (folder) path += `&folder=eq.${encodeURIComponent(cleanFolder(folder))}`;
    let rows = await db(env, "GET", path);
    if (q) { const w = String(q).normalize("NFKC").toLowerCase(); rows = rows.filter((r) => `${r.name} ${r.folder}`.normalize("NFKC").toLowerCase().includes(w)); }
    const all = await db(env, "GET", `${T}?select=kind,folder,size&limit=5000`);
    const folders = {}; const kinds = {}; let bytes = 0;
    for (const r of all) { folders[r.folder || ""] = (folders[r.folder || ""] || 0) + 1; kinds[r.kind] = (kinds[r.kind] || 0) + 1; bytes += r.size || 0; }
    return { ok: true, count: rows.length, total: all.length, bytes, kinds, folders: Object.entries(folders).map(([name, n]) => ({ name, count: n })).sort((a, b) => a.name.localeCompare(b.name, "ja")), items: rows.map(view) };
  }

  async function putFile(env, { id, ext, body, size, type }) {
    if (!env.IMAGES) throw new Error("no_store");
    const key = `media/${id}${ext ? "." + ext : ""}`;
    await env.IMAGES.put(key, body, { httpMetadata: { contentType: type || EXT_TYPE[ext] || "application/octet-stream" } });
    return key;
  }

  // 画面から 1 つ上げる（95MB まで）。中身は request.body をそのまま R2 へ
  async function upload(env, { name, folder, size, type, body }, actor) {
    if (!env.IMAGES) return { ok: false, error: "no_store" };
    const nm = cleanName(name); if (!nm) return { ok: false, error: "need_name" };
    const n = Number(size) || 0;
    if (!n) return { ok: false, error: "empty" };
    if (n > MAX_UPLOAD) return { ok: false, error: "too_big", max: MAX_UPLOAD };
    const ext = extOf(nm), kind = kindOf(nm);
    const id = crypto.randomUUID();
    const key = await putFile(env, { id, ext, body, size: n, type: EXT_TYPE[ext] || type });
    const row = { id, kind, name: nm, folder: cleanFolder(folder), r2_key: key, size: n, content_type: EXT_TYPE[ext] || String(type || "").slice(0, 100), source: "upload", updated_by: String(actor).slice(0, 200) };
    await db(env, "POST", T, [row], "return=minimal");
    await logInbound(env, "media_upload", { id, kind, size: n, actor }, { ok: true }, 200);
    return { ok: true, id, kind, name: nm };
  }

  // Google スライドをリンクで置く
  async function addSlide(env, { name, url, folder }, actor) {
    if (!slideEmbed(url)) return { ok: false, error: "bad_slide_url", note: "https://docs.google.com/presentation/d/… の住所" };
    const nm = cleanName(name) || "Google スライド";
    const id = crypto.randomUUID();
    await db(env, "POST", T, [{ id, kind: "slide", name: nm, folder: cleanFolder(folder), url: String(url).trim().slice(0, 500), size: 0, source: "link", updated_by: String(actor).slice(0, 200) }], "return=minimal");
    return { ok: true, id, kind: "slide", name: nm, embed: slideEmbed(url) };
  }

  // 名前・フォルダを直す・消す（消すのは R2 の中身も）
  async function save(env, { id, name, folder, remove }, actor) {
    const [r] = await db(env, "GET", `${T}?select=*&id=eq.${encodeURIComponent(String(id || ""))}`);
    if (!r) return { ok: false, error: "not_found" };
    if (remove) {
      if (r.r2_key && env.IMAGES) await env.IMAGES.delete(r.r2_key);
      await db(env, "DELETE", `${T}?id=eq.${r.id}`);
      await logInbound(env, "media_remove", { id: r.id, name: r.name, source: r.source, actor }, { ok: true }, 200);
      return { ok: true, removed: true, id: r.id };
    }
    const patch = { updated_at: new Date().toISOString(), updated_by: String(actor).slice(0, 200) };
    if (name != null) { const nm = cleanName(name); if (!nm) return { ok: false, error: "need_name" }; patch.name = nm; }
    if (folder != null) patch.folder = cleanFolder(folder);
    await db(env, "PATCH", `${T}?id=eq.${r.id}`, patch, "return=minimal");
    return { ok: true, id: r.id, ...patch };
  }

  // UTAGE の置き場から写す。items：[{ url, name, folder?, utage_id? }]（1 回に 300 個まで）。
  // まず一覧に「写す待ち」（r2_key が空）で全部入れ、時間の許す分（既定 8 秒）だけその場で写す。残りは毎時の定時の処理（drain）が写す
  async function importUtage(env, { items }, actor) {
    if (!env.IMAGES) return { ok: false, error: "no_store" };
    const list = (Array.isArray(items) ? items : []).slice(0, 300);
    if (!list.length) return { ok: false, error: "need_items" };
    let queued = 0, skipped = 0, rejected = 0;
    const have = new Set((await db(env, "GET", `${T}?select=source&limit=5000`)).map((r) => r.source));
    const rows = [];
    for (const it of list) {
      const url = String(it && it.url || "").trim();
      if (!UTAGE_FILE_RE.test(url)) { rejected++; continue; }
      const source = "utage:" + (it.utage_id ? String(it.utage_id).slice(0, 40) : url.slice(-60));
      if (have.has(source)) { skipped++; continue; }
      have.add(source);
      const nm = cleanName(it.name) || url.split("/").pop();
      const ext = extOf(url) || extOf(nm);
      rows.push({ id: crypto.randomUUID(), kind: EXT_KIND[ext] || kindOf(nm), name: nm, folder: cleanFolder(it.folder || "UTAGE から"), r2_key: null, size: 0, content_type: "", source, url: url.slice(0, 500), updated_by: String(actor).slice(0, 200) });
    }
    for (let i = 0; i < rows.length; i += 100) await db(env, "POST", T, rows.slice(i, i + 100), "return=minimal");
    queued = rows.length;
    const d = await drain(env, { budgetMs: 8000 });
    await logInbound(env, "media_import_utage", { count: list.length, actor }, { queued, skipped, rejected, copied: d.copied, failed: d.failed }, 200);
    return { ok: true, queued, skipped, rejected, copied_now: d.copied, failed_now: d.failed, waiting: d.waiting, note: "残り（waiting）は毎時の定時の処理が写す。進み具合は media_import_status" };
  }

  // 写す待ちを写す（時間の許す分だけ）。失敗したものは content_type に error: を入れて、次からはとばす
  async function drain(env, { limit = 60, budgetMs = 8000 } = {}) {
    const out = { copied: 0, failed: 0, bytes: 0, waiting: 0 };
    if (!env.IMAGES) return out;
    const t0 = Date.now();
    const wait = (await db(env, "GET", `${T}?select=*&r2_key=is.null&order=created_at.asc&limit=1000`)).filter((r) => String(r.source).startsWith("utage:") && r.url && !String(r.content_type).startsWith("error:"));
    for (const r of wait.slice(0, limit)) {
      if (Date.now() - t0 > budgetMs) break;
      try {
        const res = await (h.fetch || fetch)(r.url);
        if (!res.ok) throw new Error(`http_${res.status}`);
        const len = Number(res.headers.get("content-length")) || 0;
        if (len > MAX_IMPORT) throw new Error("too_big");
        const ext = extOf(r.url) || extOf(r.name);
        const type = (res.headers.get("content-type") || EXT_TYPE[ext] || "application/octet-stream").slice(0, 100);
        const body = len ? res.body : await res.arrayBuffer();
        const size = len || body.byteLength;
        const key = await putFile(env, { id: r.id, ext, body, size, type });
        await db(env, "PATCH", `${T}?id=eq.${r.id}`, { r2_key: key, size, content_type: type, updated_at: new Date().toISOString() }, "return=minimal");
        out.copied++; out.bytes += size;
      } catch (e) {
        await db(env, "PATCH", `${T}?id=eq.${r.id}`, { content_type: ("error:" + String(e && e.message || e)).slice(0, 100) }, "return=minimal");
        out.failed++;
      }
    }
    out.waiting = Math.max(0, wait.length - out.copied - out.failed);
    return out;
  }

  // 進み具合（UTAGE から写したもの）
  async function importStatus(env) {
    const rows = (await db(env, "GET", `${T}?select=id,name,size,r2_key,content_type,source&limit=5000`)).filter((r) => String(r.source).startsWith("utage:"));
    const done = rows.filter((r) => r.r2_key), failed = rows.filter((r) => !r.r2_key && String(r.content_type).startsWith("error:"));
    return { ok: true, total: rows.length, copied: done.length, failed: failed.length, waiting: rows.length - done.length - failed.length, bytes: done.reduce((s, r) => s + (r.size || 0), 0),
      failures: failed.slice(0, 20).map((r) => ({ id: r.id, name: r.name, error: String(r.content_type).slice(6) })) };
  }

  // 画面で見る（シアニン用の画面から・ログインの確かめは呼ぶ側）
  async function file(env, id) {
    const [r] = await db(env, "GET", `${T}?select=*&id=eq.${encodeURIComponent(String(id || ""))}`);
    if (!r || !r.r2_key || !env.IMAGES) return null;
    const obj = await env.IMAGES.get(r.r2_key);
    if (!obj) return null;
    return new Response(obj.body, { headers: { "content-type": r.content_type || "application/octet-stream", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.name)}` } });
  }

  return { list, upload, addSlide, save, importUtage, drain, importStatus, file };
}

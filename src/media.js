// メディアの便 M1（2026-11-07 Naoki OK 08:35）：メディアの棚。画像・PDF・Google スライド・動画を 1 か所に置く。
//  ・ファイルの中身は R2（IMAGES の箱）の media/<番号>.<拡張子>。一覧は表 b_media（正本は supabase/b_media.sql）
//  ・Google スライドはファイルではなくリンク（kind=slide・url）。見るときは埋め込みの住所へ直す
//  ・UTAGE の置き場（utagesystem の S3・wasabi）にある画像と動画を、解約で消える前にまとめて写す（import_utage_media）
//    写すのは住所が UTAGE の置き場のものだけ（ほかの住所は取りに行かない）。同じ元（source）は 2 回写さない
//  ・M2（2026-11-07）：共有リンク。表 b_media_links（正本は supabase/b_media_links.sql）。住所は /m/<24 桁>（lab と lp の両方で開く）。
//    本ごとに止める・期限・開かれた数。ログインは要らない。止めた・期限切れ・ファイルが無いは同じ「開けません」の頁
//  ・M2b（2026-11-07 Naoki OK 09:07）：メディアから選ぶ。LINE のプレビュー（1MB まで）は R2 の media/<番号>.preview.jpg に置き（表は変えない）、
//    /m/<24 桁>?p=1 で出す（無ければ元の画像。プレビューは開かれた数に数えない）。LINE の画像は元が 10MB まで・png か jpg
export const KINDS = ["image", "pdf", "slide", "video", "audio", "other"];
const UTAGE_FILE_RE = /^https:[/][/]utagesystem[.]s3[.]ap-northeast-1[.](amazonaws|wasabisys)[.]com[/][^\s?#]{4,400}$/;
const SLIDE_RE = /^https:[/][/]docs[.]google[.]com[/]presentation[/]d[/]([A-Za-z0-9_-]{20,80})/;
const EXT_KIND = { jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image", pdf: "pdf", mp4: "video", mov: "video", m4v: "video", webm: "video", mp3: "audio", m4a: "audio", wav: "audio" };
const EXT_TYPE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
export const MAX_UPLOAD = 95 * 1024 * 1024; // 画面から 1 回で上げられる大きさ（Workers の受け取りの上限 100MB の内側）
const MAX_IMPORT = 2 * 1024 * 1024 * 1024;
const T = "b_media";
const L = "b_media_links";
export const TOKEN_RE = /^[0-9a-f]{24}$/;
const MAX_DAYS = 3650;
export const LINE_PREVIEW_MAX = 1024 * 1024;       // LINE のプレビューの上限
export const LINE_IMAGE_MAX = 10 * 1024 * 1024;    // LINE の元の画像の上限
const LINE_TYPES = ["image/png", "image/jpeg"];
export const previewKey = (id) => `media/${id}.preview.jpg`;

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
    const lk = {}; for (const k of await db(env, "GET", `${L}?select=media_id,stopped_at,expires_at,opens&limit=5000`).catch(() => [])) { const o = lk[k.media_id] || (lk[k.media_id] = { links: 0, live: 0, opens: 0 }); o.links++; o.opens += k.opens || 0; if (linkState(k) === "live") o.live++; }
    return { ok: true, count: rows.length, total: all.length, bytes, kinds, folders: Object.entries(folders).map(([name, n]) => ({ name, count: n })).sort((a, b) => a.name.localeCompare(b.name, "ja")), items: rows.map((r) => ({ ...view(r), ...(lk[r.id] || { links: 0, live: 0, opens: 0 }) })) };
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
      if (r.r2_key && env.IMAGES) { await env.IMAGES.delete(r.r2_key); if (r.kind === "image") await env.IMAGES.delete(previewKey(r.id)); }
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

  // ---------- M2：共有リンク ----------
  const linkState = (k, now = Date.now()) => k.stopped_at ? "stopped" : k.expires_at && Date.parse(k.expires_at) <= now ? "expired" : "live";
  const linkView = (k, origin) => ({ id: k.id, media_id: k.media_id, label: k.label || "", url: `${origin}/m/${k.token}`, state: linkState(k), expires_at: k.expires_at, stopped_at: k.stopped_at, opens: k.opens || 0, last_open_at: k.last_open_at, created_at: k.created_at });

  async function links(env, { media_id } = {}, origin) {
    let path = `${L}?select=*&order=created_at.desc&limit=1000`;
    if (media_id) path += `&media_id=eq.${encodeURIComponent(String(media_id))}`;
    const rows = await db(env, "GET", path);
    return { ok: true, count: rows.length, links: rows.map((k) => linkView(k, origin)) };
  }

  // 作る。days（1〜3650）か expires_at（日時）で期限。どちらも無ければ期限なし
  async function makeLink(env, { media_id, label, days, expires_at }, actor, origin) {
    const [r] = await db(env, "GET", `${T}?select=id,kind,name,r2_key,url&id=eq.${encodeURIComponent(String(media_id || ""))}`);
    if (!r) return { ok: false, error: "not_found" };
    if (r.kind !== "slide" && !r.r2_key) return { ok: false, error: "no_file", note: "まだ写し終わっていないか、写せなかったファイル" };
    let exp = null;
    if (days != null && days !== "") {
      const d = Number(days);
      if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) return { ok: false, error: "bad_days", note: "1〜3650 の整数" };
      exp = new Date(Date.now() + d * 86400000).toISOString();
    } else if (expires_at) {
      const t = Date.parse(expires_at);
      if (isNaN(t) || t <= Date.now()) return { ok: false, error: "bad_expires", note: "これから先の日時" };
      exp = new Date(t).toISOString();
    }
    const token = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const row = { id: crypto.randomUUID(), media_id: r.id, token, label: String(label || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60), expires_at: exp, created_by: String(actor).slice(0, 200) };
    await db(env, "POST", L, [row], "return=minimal");
    await logInbound(env, "media_link", { id: row.id, media_id: r.id, expires_at: exp, actor }, { ok: true }, 200);
    return { ok: true, ...linkView({ ...row, opens: 0 }, origin), name: r.name };
  }

  // 止める（stop:false で止めたのを戻す。期限切れは戻らないので作り直す）
  async function stopLink(env, { id, stop = true }, actor) {
    const [k] = await db(env, "GET", `${L}?select=*&id=eq.${encodeURIComponent(String(id || ""))}`);
    if (!k) return { ok: false, error: "not_found" };
    const stopped_at = stop === false ? null : new Date().toISOString();
    await db(env, "PATCH", `${L}?id=eq.${k.id}`, { stopped_at }, "return=minimal");
    await logInbound(env, stop === false ? "media_link_restart" : "media_link_stop", { id: k.id, actor }, { ok: true }, 200);
    return { ok: true, id: k.id, state: linkState({ ...k, stopped_at }) };
  }

  // 公開の住所 /m/<token>。開けないときは null（呼ぶ側が同じ頁を出す）。
  // 開かれた数は、最初から読むとき（Range なし・bytes=0- から）だけ 1 足す（動画の続き読みで数が増えないように）
  async function serveLink(env, token, request, { preview = false } = {}) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const [k] = await db(env, "GET", `${L}?select=*&token=eq.${token}`);
    if (!k || linkState(k) !== "live") return null;
    const [r] = await db(env, "GET", `${T}?select=*&id=eq.${k.media_id}`);
    if (!r) return null;
    const rangeH = request.headers.get("range");
    const first = request.method === "GET" && (!rangeH || /^bytes=0-/.test(rangeH));
    const count = async () => { if (first && !preview) await db(env, "PATCH", `${L}?id=eq.${k.id}`, { opens: (k.opens || 0) + 1, last_open_at: new Date().toISOString() }, "return=minimal"); };
    const base = { "x-content-type-options": "nosniff", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "cache-control": "private, no-store" };
    // LINE のプレビュー（?p=1）：小さな版があればそれ、無ければ元の画像。開かれた数には数えない
    if (preview && r.kind === "image" && env.IMAGES) {
      const pv = await env.IMAGES.get(previewKey(r.id));
      if (pv) return new Response(request.method === "HEAD" ? null : pv.body, { headers: { ...base, "content-type": "image/jpeg", ...(pv.size != null ? { "content-length": String(pv.size) } : {}) } });
    }
    if (r.kind === "slide") { if (!r.url) return null; await count(); return new Response(null, { status: 302, headers: { ...base, location: r.url } }); }
    if (!r.r2_key || !env.IMAGES) return null;
    const obj = await env.IMAGES.get(r.r2_key, rangeH ? { range: request.headers } : undefined);
    if (!obj) return null;
    await count();
    const headers = { ...base, "content-type": r.content_type && !r.content_type.startsWith("error:") ? r.content_type : "application/octet-stream", "accept-ranges": "bytes",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.name)}` };
    // 画像・PDF・動画・音声のほかは、その場で開かせず保存させる（HTML などを住所の上で動かさないため）
    if (!/^(image[/](png|jpeg|gif|webp)|application[/]pdf|video[/]|audio[/])/.test(headers["content-type"])) { headers["content-type"] = "application/octet-stream"; headers["content-disposition"] = headers["content-disposition"].replace("inline", "attachment"); }
    const total = obj.size;
    if (rangeH && obj.range && total != null) {
      const off = obj.range.offset || 0; const len = obj.range.length != null ? obj.range.length : total - off;
      return new Response(request.method === "HEAD" ? null : obj.body, { status: 206, headers: { ...headers, "content-range": `bytes ${off}-${off + len - 1}/${total}`, "content-length": String(len) } });
    }
    if (total != null) headers["content-length"] = String(total);
    return new Response(request.method === "HEAD" ? null : obj.body, { headers });
  }

  // ---------- M2b：LINE のプレビュー ----------
  // 画面が作った小さな jpg（1MB まで）を置く。元の画像が棚にあるもの（画像・写し済み）だけ
  async function savePreview(env, { id, size, type, body }, actor) {
    if (!env.IMAGES) return { ok: false, error: "no_store" };
    const [r] = await db(env, "GET", `${T}?select=id,kind,r2_key&id=eq.${encodeURIComponent(String(id || ""))}`);
    if (!r) return { ok: false, error: "not_found" };
    if (r.kind !== "image" || !r.r2_key) return { ok: false, error: "not_image", note: "棚にある画像（写し済み）だけ" };
    const n = Number(size) || 0;
    if (!n) return { ok: false, error: "empty" };
    if (n > LINE_PREVIEW_MAX) return { ok: false, error: "preview_too_big", max: LINE_PREVIEW_MAX };
    if (String(type || "").split(";")[0].trim() !== "image/jpeg") return { ok: false, error: "preview_not_jpeg" };
    await env.IMAGES.put(previewKey(r.id), body, { httpMetadata: { contentType: "image/jpeg" } });
    await logInbound(env, "media_preview", { id: r.id, size: n, actor }, { ok: true }, 200);
    return { ok: true, id: r.id, size: n };
  }

  // LINE で送る画像の住所を確かめる。棚の共有リンク（/m/<24 桁>）のときだけ中身を見る（ほかの住所は見られないので null）
  //  ・png か jpg・元が 10MB まで・1MB を超えるならプレビューが置いてあること
  async function lineImageProblem(env, url) {
    const m = String(url || "").match(/^https:[/][/][^/\s]+[/]m[/]([0-9a-f]{24})$/);
    if (!m) return null;
    const [k] = await db(env, "GET", `${L}?select=media_id,stopped_at,expires_at&token=eq.${m[1]}`);
    if (!k) return { error: "line_image_unknown", note: "棚の共有リンクとして見つからない住所" };
    if (linkState(k) !== "live") return { error: "line_image_link_closed", note: "止めたか期限切れの共有リンク" };
    const [r] = await db(env, "GET", `${T}?select=id,name,kind,size,content_type,r2_key&id=eq.${k.media_id}`);
    if (!r || !r.r2_key) return { error: "line_image_no_file", note: "まだ写し終わっていないか、消されたファイル" };
    if (r.kind !== "image" || !LINE_TYPES.includes(String(r.content_type).split(";")[0].trim())) return { error: "line_image_type", name: r.name, note: "LINE で送れる画像は png か jpg だけ" };
    if ((r.size || 0) > LINE_IMAGE_MAX) return { error: "line_image_too_big", name: r.name, max: LINE_IMAGE_MAX };
    if ((r.size || 0) > LINE_PREVIEW_MAX && env.IMAGES && !(await env.IMAGES.head(previewKey(r.id)))) return { error: "need_preview", name: r.name, note: "1MB を超える画像は、画面の「メディアから選ぶ」で選び直すとプレビューができる" };
    return null;
  }

  return { list, upload, addSlide, save, importUtage, drain, importStatus, file, links, makeLink, stopLink, serveLink, savePreview, lineImageProblem };
}

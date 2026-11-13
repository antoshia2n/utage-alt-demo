// 実績の便 1（2026-11-13 Naoki OK 16:50）：実績の棚。自分の実績と、生徒・お客さんの実績を 1 か所に集める。
//  ・一覧は表 b_results（正本は supabase/b_results.sql）。画像の中身は R2（IMAGES の箱）の results/<番号>.<拡張子>
//  ・フォルダは 2 つのまとまり（me＝自分の実績／person＝生徒・お客さんの実績）の下に並べる。並び（空のフォルダも）は
//    表 b_settings の 1 行（key=results_folders・「me:名前」「person:名前」を 1 行ずつ）。フォルダが空の行は受け箱
//  ・入れると AI（Workers AI・chatai.js と同じモデル）が画像か投稿の文を読み、成果・誰の実績か・フォルダ・ラベルを付ける。
//    フォルダは今あるものからしか選ばせない。迷ったら受け箱（ai=unsure）。載せてよい範囲は AI に決めさせない（必ず unknown）
//  ・X のポストのリンクは、X の公開の埋め込みの口（publish.twitter.com/oembed）で本文を読んでから AI に渡す
//  ・Naoki の言葉（2026-11-13）：「フォルダ的に管理したい」「AI やドライブとかにスクショとかアップしたら自動で仕分けて欲しい」
//    「ポストリンクとか、自分の実績とかも管理したい」
import { AI_MODEL } from "./chatai.js";

const T = "b_results";
const FOLDER_KEY = "results_folders";
export const WHOSE = ["me", "person"];
export const PUBLISH = ["unknown", "name", "anon", "no"];
const DEFAULT_FOLDERS = { me: ["X のポスト・数字", "売上・成約"], person: ["X のフォロワー", "X記事・インプ", "note・メンシプ", "収益化", "コンサルの成約"] };
const EXT_TYPE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
export const MAX_UPLOAD = 20 * 1024 * 1024; // スクショと PDF だけなので 20MB まで
const AI_IMAGE_MAX = 4 * 1024 * 1024;       // AI に見せる画像の上限（大きいものは AI に回さず受け箱へ）
const UUID_RE = /^[0-9a-f-]{36}$/i;
const LINK_RE = /^https:[/][/][^\s]{4,490}$/;
const X_RE = /^https:[/][/](?:www[.])?(?:x|twitter)[.]com[/]([A-Za-z0-9_]{1,30})[/]status[/](\d{5,25})/;
const SELF_X = ["antoshia2n"]; // シアニンの X のアカウント（このアカウントのポストは「自分の実績」）

export const extOf = (name) => { const m = String(name || "").toLowerCase().match(/[.]([a-z0-9]{2,5})$/); return m ? m[1] : ""; };
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const cleanFolder = (s) => clean(String(s ?? "").replace(/[\n\r/:]/g, " "), 60);
const cleanLabels = (a) => [...new Set((Array.isArray(a) ? a : String(a || "").split(/[,、]/)).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 12);
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null;

function parseFolders(v) {
  if (!v) return { me: [...DEFAULT_FOLDERS.me], person: [...DEFAULT_FOLDERS.person] };
  const out = { me: [], person: [] };
  for (const line of String(v).split("\n")) { const m = line.match(/^(me|person):(.+)$/); if (m) { const n = cleanFolder(m[2]); if (n && !out[m[1]].includes(n)) out[m[1]].push(n); } }
  return out;
}
const formatFolders = (f) => [...f.me.map((n) => `me:${n}`), ...f.person.map((n) => `person:${n}`)].join("\n");

export function makeResults(h) {
  const { db, logInbound } = h;

  async function readFolders(env) {
    const rows = await db(env, "GET", `settings?select=value&key=eq.${FOLDER_KEY}`);
    return parseFolders(rows[0] && rows[0].value);
  }
  async function writeFolders(env, f, actor) {
    const v = formatFolders(f);
    if (v.length > 500) return { ok: false, error: "folders_full" };
    await db(env, "POST", "settings?on_conflict=key", [{ key: FOLDER_KEY, value: v, updated_at: new Date().toISOString(), updated_by: clean(actor || "admin", 200) }], "resolution=merge-duplicates,return=minimal");
    return { ok: true };
  }

  const view = (r) => ({ id: r.id, whose: r.whose, folder: r.folder || "", title: r.title || "", who_name: r.who_name || "", person_id: r.person_id || null,
    achieved_on: r.achieved_on || null, quote: r.quote || "", labels: r.labels || [], publish: r.publish, has_image: !!r.r2_key, content_type: r.content_type || "",
    link_url: r.link_url || null, source: r.source, ai: r.ai, ai_note: r.ai_note || "", created_at: r.created_at, updated_at: r.updated_at, updated_by: r.updated_by || "" });

  // 一覧。whose＋folder で 1 つのフォルダ、inbox=1 で受け箱（フォルダが空）、q は成果・誰・ラベル・本人の言葉の言葉
  async function list(env, { whose, folder, inbox, q, publish, limit } = {}) {
    let path = `${T}?select=*&archived=eq.false&order=created_at.desc&limit=${Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000)}`;
    if (whose) { if (!WHOSE.includes(whose)) return { ok: false, error: "bad_whose" }; path += `&whose=eq.${whose}`; }
    if (inbox === "1" || inbox === true) path += `&folder=eq.`;
    else if (folder != null && folder !== "") path += `&folder=eq.${encodeURIComponent(cleanFolder(folder))}`;
    if (publish) { if (!PUBLISH.includes(publish)) return { ok: false, error: "bad_publish" }; path += `&publish=eq.${publish}`; }
    let rows = await db(env, "GET", path);
    if (q) { const w = String(q).normalize("NFKC").toLowerCase(); rows = rows.filter((r) => `${r.title} ${r.who_name} ${(r.labels || []).join(" ")} ${r.quote} ${r.folder} ${r.link_url || ""}`.normalize("NFKC").toLowerCase().includes(w)); }
    const all = await db(env, "GET", `${T}?select=whose,folder&archived=eq.false&limit=10000`);
    const f = await readFolders(env);
    const count = (w, n) => all.filter((r) => r.whose === w && r.folder === n).length;
    // 表にあるのにフォルダの並びに無い名前（手で消した後など）も出す
    for (const w of WHOSE) for (const r of all) if (r.whose === w && r.folder && !f[w].includes(r.folder)) f[w].push(r.folder);
    return { ok: true, count: rows.length, total: all.length, inbox: all.filter((r) => !r.folder).length,
      folders: { me: f.me.map((n) => ({ name: n, count: count("me", n) })), person: f.person.map((n) => ({ name: n, count: count("person", n) })) },
      items: rows.map(view) };
  }

  async function get(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    return (await db(env, "GET", `${T}?select=*&id=eq.${id}`))[0] || null;
  }

  // ---------- AI の仕分け ----------
  async function classify(env, row, { image, text } = {}) {
    const f = await readFolders(env);
    if (!env.AI || typeof env.AI.run !== "function") return { ai: "failed", ai_note: "AI につながっていない" };
    const sys = [
      "あなたは実績の棚の仕分け係。渡されたスクショか投稿の文から、成果を読み取って JSON 1 つだけを返す。説明や前置きは書かない。",
      "形：{\"whose\":\"me か person\",\"folder\":\"下のフォルダの名前のどれか。合うものが無いか自信が無ければ空\",\"title\":\"成果を 1 行（数字を入れる。例：3 か月で X フォロワー 1,000 人）\",\"who_name\":\"誰の実績か（名前か @ID。分からなければ空）\",\"achieved_on\":\"YYYY-MM-DD（読めなければ空）\",\"labels\":[\"短いラベル 1〜4 個\"],\"quote\":\"本人の言葉があれば 1〜2 文（無ければ空）\",\"confident\":true か false,\"note\":\"迷った理由を 1 文（無ければ空）\"}",
      `me（自分の実績＝シアニン本人。X の @${SELF_X.join("・@")} やシアニンの売上）のフォルダ：${f.me.join("／") || "（なし）"}`,
      `person（生徒・お客さんの実績）のフォルダ：${f.person.join("／") || "（なし）"}`,
      "数字を読み違えそうなとき、誰の実績か分からないとき、どのフォルダにも合わないときは confident を false にする。",
    ].join("\n");
    const content = [{ type: "text", text: [text ? `投稿の文：\n${clean(text, 3000)}` : "", row.link_url ? `住所：${row.link_url}` : "", "この実績を仕分けて。"].filter(Boolean).join("\n\n") }];
    if (image) content.push({ type: "image_url", image_url: { url: image } });
    let out;
    try {
      const r = await env.AI.run(AI_MODEL, { messages: [{ role: "system", content: sys }, { role: "user", content }], max_tokens: 500, temperature: 0.1 });
      const raw = typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r?.result?.response ?? "");
      const m = raw.match(/\{[\s\S]*\}/);
      out = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      await logInbound(env, "results_ai", { id: row.id }, { error: String((e && e.message) || e).slice(0, 300) }, 500).catch(() => {});
      return { ai: "failed", ai_note: "AI が読めなかった" };
    }
    if (!out || typeof out !== "object") return { ai: "failed", ai_note: "AI の答えが読めなかった" };
    const whose = out.whose === "me" ? "me" : "person";
    const folder = cleanFolder(out.folder);
    const okFolder = folder && f[whose].includes(folder) ? folder : "";
    const sure = out.confident === true && !!okFolder && !!clean(out.title, 200);
    return {
      whose, folder: sure ? okFolder : "", title: clean(out.title, 200) || row.title, who_name: clean(out.who_name, 80) || row.who_name,
      achieved_on: dateOk(out.achieved_on) || row.achieved_on, labels: cleanLabels(out.labels).length ? cleanLabels(out.labels) : row.labels, quote: clean(out.quote, 1000) || row.quote,
      ai: sure ? "done" : "unsure", ai_note: clean(sure ? "" : (out.note || (okFolder ? "自信が無い" : "合うフォルダが無い")), 500), ai_text: clean(text || "", 4000),
    };
  }
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

  async function sortOne(env, row, { buf, type } = {}) {
    let image = null, text = "";
    if (buf && /^image\/(png|jpeg|webp|gif)$/.test(type || "") && buf.byteLength <= AI_IMAGE_MAX) image = `data:${type};base64,${b64(buf)}`;
    if (row.link_url) text = await readPost(row.link_url);
    if (!image && !text) {
      const why = buf && buf.byteLength > AI_IMAGE_MAX ? "画像が大きくて AI に見せられなかった" : type === "application/pdf" ? "PDF は AI がまだ読めない" : "読めるものが無かった";
      return { ai: "unsure", ai_note: why };
    }
    return await classify(env, row, { image, text });
  }
  // X のポストは公開の埋め込みの口で本文を読む（ログインは要らない・失敗しても空で続ける）
  async function readPost(url) {
    if (!X_RE.test(url)) return "";
    try {
      const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" } });
      if (!r.ok) return "";
      const j = await r.json();
      const body = String(j.html || "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").trim();
      return `${j.author_name || ""}（${j.author_url || ""}）\n${body}`.trim();
    } catch (_) { return ""; }
  }

  const BASE = { publish: "unknown", ai: "none", labels: [], archived: false }; // 載せてよい範囲は必ず「まだ聞いていない」で入る
  const stamp = (actor) => ({ updated_at: new Date().toISOString(), updated_by: clean(actor || "admin", 200) });
  async function patch(env, id, p) { const r = await db(env, "PATCH", `${T}?id=eq.${id}`, p, "return=representation"); return r[0] || null; }

  // 画面から 1 つ上げる（20MB まで）。上げたらその場で AI が仕分ける
  async function upload(env, { name, size, type, body, whose, folder }, actor) {
    if (!env.IMAGES) return { ok: false, error: "no_store" };
    const ext = extOf(name);
    const ct = EXT_TYPE[ext] || "";
    if (!ct) return { ok: false, error: "bad_type" };
    const n = parseInt(size, 10) || 0;
    if (n > MAX_UPLOAD) return { ok: false, error: "too_big" };
    const buf = await new Response(body).arrayBuffer();
    if (!buf.byteLength) return { ok: false, error: "empty" };
    if (buf.byteLength > MAX_UPLOAD) return { ok: false, error: "too_big" };
    const id = crypto.randomUUID();
    const key = `results/${id}.${ext}`;
    await env.IMAGES.put(key, buf, { httpMetadata: { contentType: ct } });
    const w = WHOSE.includes(whose) ? whose : "person";
    const row = (await db(env, "POST", T, [{ id, whose: w, folder: cleanFolder(folder || ""), title: clean(String(name).replace(/[.][a-z0-9]{2,5}$/i, ""), 200), r2_key: key, content_type: ct, size: buf.byteLength, source: "upload", ...BASE, ...stamp(actor) }], "return=representation"))[0];
    const s = await sortOne(env, row, { buf, type: ct });
    const keepFolder = row.folder ? { folder: row.folder, whose: row.whose } : {}; // フォルダを開いて上げたときは、そのフォルダのまま
    const done = await patch(env, id, { ...s, ...keepFolder, ...stamp(actor) });
    return { ok: true, item: view(done || row) };
  }

  // ポストなどのリンクを入れる。X のポストは本文を読んで AI が仕分ける
  async function addLink(env, { url, whose, folder, source }, actor) {
    const u = clean(url, 500);
    if (!LINK_RE.test(u)) return { ok: false, error: "bad_url" };
    const dup = await db(env, "GET", `${T}?select=id&archived=eq.false&link_url=eq.${encodeURIComponent(u)}&limit=1`);
    if (dup[0]) return { ok: false, error: "already", id: dup[0].id };
    const xm = u.match(X_RE);
    const w = WHOSE.includes(whose) ? whose : xm && SELF_X.includes(xm[1].toLowerCase()) ? "me" : "person";
    const row = (await db(env, "POST", T, [{ whose: w, folder: cleanFolder(folder || ""), title: "", link_url: u, source: ["link", "panel", "mcp"].includes(source) ? source : "link", ...BASE, ...stamp(actor) }], "return=representation"))[0];
    const s = await sortOne(env, row, {});
    const keep = row.folder ? { folder: row.folder, whose: row.whose } : xm && SELF_X.includes(xm[1].toLowerCase()) ? { whose: "me" } : {};
    const done = await patch(env, row.id, { ...s, ...keep, ...stamp(actor) });
    return { ok: true, item: view(done || row) };
  }

  // 直す（フォルダ・成果・誰・日付・本人の言葉・ラベル・載せてよい範囲・顧客への結び）と、しまう・戻す
  async function save(env, b, actor) {
    const row = await get(env, b.id);
    if (!row) return { ok: false, error: "not_found" };
    const p = {};
    if ("whose" in b) { if (!WHOSE.includes(b.whose)) return { ok: false, error: "bad_whose" }; p.whose = b.whose; }
    if ("folder" in b) p.folder = cleanFolder(b.folder);
    if ("title" in b) p.title = clean(b.title, 200);
    if ("who_name" in b) p.who_name = clean(b.who_name, 80);
    if ("achieved_on" in b) p.achieved_on = dateOk(b.achieved_on);
    if ("quote" in b) p.quote = clean(b.quote, 1000);
    if ("labels" in b) p.labels = cleanLabels(b.labels);
    if ("publish" in b) { if (!PUBLISH.includes(b.publish)) return { ok: false, error: "bad_publish" }; p.publish = b.publish; }
    if ("person_id" in b) { if (b.person_id && !UUID_RE.test(String(b.person_id))) return { ok: false, error: "bad_person" }; p.person_id = b.person_id || null; }
    if ("archived" in b) p.archived = !!b.archived;
    if (p.folder && p.folder !== row.folder && row.ai === "unsure") p.ai = "done"; // 受け箱から人が移した
    if (!Object.keys(p).length) return { ok: false, error: "nothing" };
    const done = await patch(env, row.id, { ...p, ...stamp(actor) });
    return { ok: true, item: view(done) };
  }

  // もう一度 AI に仕分けさせる（フォルダを足したあとなど）
  async function resort(env, id, actor) {
    const row = await get(env, id);
    if (!row) return { ok: false, error: "not_found" };
    let buf = null;
    if (row.r2_key && env.IMAGES) { const o = await env.IMAGES.get(row.r2_key); if (o) buf = await o.arrayBuffer(); }
    const s = await sortOne(env, row, { buf, type: row.content_type });
    const done = await patch(env, row.id, { ...s, ...stamp(actor) });
    return { ok: true, item: view(done) };
  }

  async function file(env, id) {
    const row = await get(env, id);
    if (!row || !row.r2_key || !env.IMAGES) return null;
    const o = await env.IMAGES.get(row.r2_key);
    if (!o) return null;
    return new Response(o.body, { headers: { "content-type": row.content_type || "application/octet-stream", "cache-control": "private, no-store" } });
  }

  // フォルダ：足す・名前を変える（入っている実績も移る）・消す（空のときだけ）
  async function folderEdit(env, { action, whose, name, to }, actor) {
    if (!WHOSE.includes(whose)) return { ok: false, error: "bad_whose" };
    const f = await readFolders(env);
    const n = cleanFolder(name), t = cleanFolder(to);
    if (action === "add") {
      if (!n) return { ok: false, error: "need_name" };
      if (f[whose].includes(n)) return { ok: false, error: "already" };
      f[whose].push(n);
      return await writeFolders(env, f, actor);
    }
    if (!f[whose].includes(n)) return { ok: false, error: "not_found" };
    if (action === "rename") {
      if (!t) return { ok: false, error: "need_name" };
      if (f[whose].includes(t)) return { ok: false, error: "already" };
      f[whose] = f[whose].map((x) => (x === n ? t : x));
      const w = await writeFolders(env, f, actor); if (!w.ok) return w;
      await db(env, "PATCH", `${T}?whose=eq.${whose}&folder=eq.${encodeURIComponent(n)}`, { folder: t, ...stamp(actor) }, "return=minimal");
      return { ok: true };
    }
    if (action === "remove") {
      const left = await db(env, "GET", `${T}?select=id&archived=eq.false&whose=eq.${whose}&folder=eq.${encodeURIComponent(n)}&limit=1`);
      if (left[0]) return { ok: false, error: "not_empty" };
      f[whose] = f[whose].filter((x) => x !== n);
      return await writeFolders(env, f, actor);
    }
    return { ok: false, error: "bad_action" };
  }

  return { list, get, upload, addLink, save, resort, file, folderEdit, readFolders };
}

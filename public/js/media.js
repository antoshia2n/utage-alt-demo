// メディア（2026-11-07 メディアの便 M1・Naoki OK 08:35）：画像・PDF・Google スライド・動画を 1 か所に置く棚
//  ・録画（recordings.js）と同じ見た目（recordings.css）と影の DOM
//  ・左＝種類とフォルダ、真ん中＝表。上の帯に「アップロード」（95MB まで）と「スライドを追加」
//  ・中身は /api/admin/media*。見るときはログインの印つきで読み、画面の中だけの住所（blob:）にして開く
//  ・2 本目（M2）で共有リンク（止める・期限・開かれた数）と「メディアから選ぶ」を足す
import { api } from "/js/common.js";

const KIND = { image: "画像", pdf: "PDF", slide: "スライド", video: "動画", audio: "音声", other: "そのほか" };
const ERR = {
  too_big: "95MB までのファイルにしてください（大きな動画は「録画」のアップロードから）",
  empty: "空のファイルは入れられません",
  bad_slide_url: "Google スライドの住所（https://docs.google.com/presentation/d/…）を入れてください",
  need_name: "名前を入れてください",
  no_store: "置き場につながっていません",
  not_found: "見つかりませんでした（消されたかもしれません）",
};
const MAX = 95 * 1024 * 1024;
const size = (n) => !n ? "" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const day = (s) => { const d = new Date(s); return isNaN(d) ? "" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

export function mountMedia(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <div class="top"><span class="tab" aria-current="page" style="cursor:default">メディア</span><span class="grow"></span><span class="note-top" id="note-top"></span>
    <button class="btn sm" type="button" id="slide-open">スライドを追加</button>
    <label class="btn sm pri" for="up-file" style="cursor:pointer">アップロード</label><input type="file" id="up-file" multiple class="sr">
  </div>
  <div class="wrap"><nav class="side" id="side" aria-label="種類とフォルダ"></nav><main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#note-top").textContent = t; $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;

  let S = null, kind = "", folder = null, q = "", editId = null, back = null;

  async function load() {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (folder !== null) p.set("folder", folder);
    if (q) p.set("q", q);
    const r = await api("/api/admin/media?" + p, { token: getToken() });
    if (!r.ok) { $("#main").innerHTML = `<p class="lead">${esc(errText(r))}</p>`; return; }
    S = r; draw();
  }

  function side() {
    const k = S.kinds || {};
    const btn = (label, n, cur, data) => `<button type="button" ${data} ${cur ? 'aria-current="page"' : ""}><span>${esc(label)}</span><span class="c">${n || 0}</span></button>`;
    return `<h4>種類</h4>${btn("すべて", S.total, !kind && folder === null, 'data-kind=""')}${Object.keys(KIND).filter((x) => k[x]).map((x) => btn(KIND[x], k[x], kind === x, `data-kind="${x}"`)).join("")}
      <h4>フォルダ</h4>${(S.folders || []).map((f) => btn(f.name || "（フォルダなし）", f.count, folder === f.name, `data-folder="${esc(f.name)}"`)).join("") || '<p class="lead" style="margin:0 8px">まだありません</p>'}`;
  }

  function draw() {
    $("#side").innerHTML = side();
    $("#side").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.kind; folder = null; load(); }));
    $("#side").querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => { folder = b.dataset.folder; kind = ""; load(); }));
    const rows = S.items.map((x) => `<tr data-id="${esc(x.id)}">
      <td><span class="st off">${esc(KIND[x.kind] || x.kind)}</span></td>
      <td class="nm">${editId === x.id ? `<label class="sr" for="ed-name">名前</label><input id="ed-name" value="${esc(x.name)}" style="width:100%;padding:4px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel)">` : esc(x.name)}<small>${x.source.startsWith("utage:") ? "UTAGE から写した" : x.source === "link" ? "リンク" : "アップロード"}</small></td>
      <td>${editId === x.id ? `<label class="sr" for="ed-folder">フォルダ</label><input id="ed-folder" value="${esc(x.folder)}" list="folders" style="width:100%;padding:4px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel)">` : esc(x.folder)}</td>
      <td class="num">${size(x.size)}</td><td class="date">${day(x.created_at)}</td>
      <td style="white-space:nowrap;text-align:right">${editId === x.id
        ? `<button class="btn sm pri" type="button" data-save="${esc(x.id)}">保存</button> <button class="btn sm" type="button" data-cancel>キャンセル</button> <button class="btn sm" type="button" data-remove="${esc(x.id)}">削除</button>`
        : `<button class="btn sm" type="button" data-open="${esc(x.id)}" aria-label="「${esc(x.name)}」を別タブで開く">開く ↗</button> <button class="btn sm" type="button" data-edit="${esc(x.id)}" aria-label="「${esc(x.name)}」を編集">編集</button>`}</td></tr>`).join("");
    $("#main").innerHTML = `<h1>メディア</h1><p class="lead">画像・PDF・Google スライド・動画を置く棚です。全部で ${S.total} 個・${size(S.bytes) || "0 KB"}。UTAGE の置き場の分は AI が写します。</p>
      <div class="bar"><div class="search"><label for="q">探す</label><input type="search" id="q" value="${esc(q)}" placeholder="名前かフォルダの言葉"></div></div>
      <datalist id="folders">${(S.folders || []).map((f) => `<option value="${esc(f.name)}">`).join("")}</datalist>
      <form id="slide-form" class="tbl" style="padding:12px;margin-bottom:10px" hidden>
        <div class="bar"><label for="sl-url" style="min-width:8em">スライドの住所</label><input id="sl-url" placeholder="https://docs.google.com/presentation/d/…" style="flex:1;min-width:240px;padding:6px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel)"></div>
        <div class="bar"><label for="sl-name" style="min-width:8em">名前</label><input id="sl-name" style="flex:1;min-width:240px;padding:6px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel)"></div>
        <div class="bar"><button class="btn sm pri" type="submit">追加</button><button class="btn sm" type="button" id="sl-cancel">キャンセル</button><span class="lead" style="margin:0">スライドは Google 側で「リンクを知っている人が見られる」にしてください</span></div>
      </form>
      ${S.items.length ? `<div class="tbl"><table><thead><tr><th>種類</th><th>名前</th><th>フォルダ</th><th class="num">大きさ</th><th>入れた日</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="lead">まだありません。右上の「アップロード」か「スライドを追加」から入れられます。</p>'}`;
    const qi = $("#q");
    qi.addEventListener("keydown", (e) => { if (e.key === "Enter") { q = qi.value.trim(); load(); } });
    $("#main").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openItem(b.dataset.open)));
    $("#main").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => { back = b.dataset.edit; editId = b.dataset.edit; draw(); const f = $("#ed-name"); if (f) f.focus(); }));
    $("#main").querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", stopEdit));
    $("#main").querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => saveItem(b.dataset.save)));
    $("#main").querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => removeItem(b.dataset.remove)));
    const row = $("#main").querySelector(`tr[data-id="${CSS.escape(editId || "")}"]`);
    if (row) row.addEventListener("keydown", (e) => { if (e.key === "Escape") stopEdit(); if (e.key === "Enter" && e.target.tagName === "INPUT") saveItem(editId); });
    $("#slide-form").addEventListener("submit", addSlide);
    $("#sl-cancel").addEventListener("click", () => { $("#slide-form").hidden = true; $("#slide-open").focus(); });
  }
  function stopEdit() { editId = null; draw(); const b = back && $("#main").querySelector(`[data-edit="${CSS.escape(back)}"]`); if (b) b.focus(); }

  async function openItem(id) {
    const x = S.items.find((y) => y.id === id); if (!x) return;
    if (x.kind === "slide") { window.open(x.url, "_blank", "noopener"); return; }
    const w = window.open("", "_blank");
    const res = await fetch("/api/admin/media/file?id=" + encodeURIComponent(id), { headers: { authorization: "Bearer " + getToken() } });
    if (!res.ok) { if (w) w.close(); say("開けませんでした"); return; }
    const u = URL.createObjectURL(await res.blob());
    if (w) w.location = u; else window.open(u, "_blank");
  }
  async function saveItem(id) {
    const r = await api("/api/admin/media/save", { method: "POST", token: getToken(), body: { id, name: $("#ed-name").value, folder: $("#ed-folder").value } });
    if (!r.ok) { say(errText(r)); return; }
    editId = null; await load(); say("名前とフォルダを保存しました");
    const b = $("#main").querySelector(`[data-edit="${CSS.escape(id)}"]`); if (b) b.focus();
  }
  async function removeItem(id) {
    const x = S.items.find((y) => y.id === id);
    if (!confirm(`「${x ? x.name : ""}」を削除します。ファイルも消えて戻せません。よろしいですか？`)) return;
    const r = await api("/api/admin/media/save", { method: "POST", token: getToken(), body: { id, remove: true } });
    if (!r.ok) { say(errText(r)); return; }
    editId = null; await load(); say("削除しました");
  }
  async function addSlide(e) {
    e.preventDefault();
    const r = await api("/api/admin/media/slide", { method: "POST", token: getToken(), body: { url: $("#sl-url").value.trim(), name: $("#sl-name").value.trim(), folder: folder || "" } });
    if (!r.ok) { say(errText(r)); $("#sl-url").focus(); return; }
    await load(); say("スライドを追加しました");
  }
  async function upload(files) {
    let done = 0;
    for (const f of files) {
      if (f.size > MAX) { say(`「${f.name}」は 95MB を超えています（大きな動画は「録画」のアップロードから）`); continue; }
      say(`「${f.name}」を上げています…（${done + 1}/${files.length}）`);
      const res = await fetch(`/api/admin/media/upload?name=${encodeURIComponent(f.name)}&folder=${encodeURIComponent(folder || "")}`, { method: "POST", headers: { authorization: "Bearer " + getToken(), "content-type": f.type || "application/octet-stream" }, body: f });
      const r = await res.json().catch(() => ({ ok: false, error: res.status }));
      if (!r.ok) { say(`「${f.name}」を上げられませんでした：${errText(r)}`); continue; }
      done++;
    }
    await load(); if (done) say(`${done} 個を上げました`);
  }

  $("#up-file").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) upload(fs); });
  $("#slide-open").addEventListener("click", () => { const f = $("#slide-form"); if (!f) return; f.hidden = false; $("#sl-url").focus(); });
  return { open: () => load() };
}

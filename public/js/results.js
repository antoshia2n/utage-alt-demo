// 実績（2026-11-13 実績の便 1・Naoki OK 16:50）：自分の実績と、生徒・お客さんの実績の棚
//  ・録画とメディアと同じ見た目（recordings.css）と影の DOM。左＝フォルダ（自分の実績／生徒・お客さんの実績）、真ん中＝表、行を押すと右に詳細
//  ・画像（スクショ・PDF）を落とす／選ぶ、ポストのリンクを入れると、AI が成果・誰の実績か・フォルダ・ラベルを付ける。迷ったものは受け箱
//  ・載せてよい範囲は AI が決めない（最初は「まだ聞いていない」＝載せない扱い）
//  ・中身は /api/admin/results*。画像はログインの印つきで読み、画面の中だけの住所（blob:）で出す
import { api } from "/js/common.js";

const PUB = { unknown: ["off", "まだ聞いていない（載せない扱い）"], name: ["on", "名前を出してよい"], anon: ["stop", "名前を伏せれば載せてよい"], no: ["off", "載せない"] };
const PUB_SHORT = { unknown: "まだ聞いていない", name: "名前を出してよい", anon: "名前を伏せれば", no: "載せない" };
const WHOSE = { me: "自分の実績", person: "生徒・お客さんの実績" };
const ERR = {
  too_big: "20MB までの画像か PDF にしてください",
  bad_type: "入れられるのは画像（png・jpg・webp・gif）と PDF です",
  empty: "空のファイルは入れられません",
  bad_url: "https:// から始まる住所を入れてください",
  already: "同じものがもうあります",
  need_name: "名前を入れてください",
  not_empty: "中に実績があるフォルダは削除できません。先に別のフォルダへ移してください",
  folders_full: "フォルダの名前が長すぎるか多すぎます。短くするか、使っていないフォルダを削除してください",
  no_store: "置き場につながっていません",
  not_found: "見つかりませんでした",
};
const MAX = 20 * 1024 * 1024;
const day = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? String(s) : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

export function mountResults(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <style>
    .drop{border:2px dashed var(--field);border-radius:12px;padding:12px;text-align:center;color:var(--muted);font-size:13px;margin-bottom:12px;background:var(--panel)}
    .drop.over{border-color:var(--ink,#b45309);background:var(--abg,#fef3c7)}
    .ai{display:inline-block;white-space:nowrap;font-size:11px;font-weight:800;border-radius:6px;padding:0 6px;margin-left:6px;vertical-align:middle}
    .ai.done{background:#d1fae5;color:#065f46}.ai.unsure{background:#fef3c7;color:#92400e}.ai.failed{background:#fee2e2;color:#991b1b}
    .ev{display:inline-flex;align-items:center;justify-content:center;width:52px;height:34px;border-radius:6px;border:1px solid var(--line);font-size:11px;font-weight:800;color:var(--muted);background:var(--panel)}
    .pv{width:100%;max-height:320px;object-fit:contain;border-radius:10px;border:1px solid var(--line);background:var(--soft,#f7f3ee)}
    .seg{display:grid;grid-template-columns:repeat(2,1fr);gap:4px}.seg button{padding:6px 4px;border:1px solid var(--field);border-radius:8px;background:var(--panel);font-size:12px;font-weight:700;cursor:pointer;color:inherit}
    .seg button[aria-pressed=true]{background:var(--fg,#1a1a1a);color:var(--bg,#fff);border-color:var(--fg,#1a1a1a)}
    .side .add{margin:2px 8px 8px;font-size:12px}
    .fold-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 10px}
    form[hidden]{display:none!important}
    textarea.q{width:100%;min-height:64px;padding:6px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel);font:inherit;resize:vertical}
  </style>
  <div class="top"><span class="tab" aria-current="page" style="cursor:default">実績</span><span class="grow"></span><span class="note-top" id="note-top"></span>
    <button class="btn sm" type="button" id="link-open">リンクを追加</button>
    <label class="btn sm pri" for="up-file" style="cursor:pointer">画像を追加</label><input type="file" id="up-file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" class="sr">
  </div>
  <div class="wrap"><nav class="side" id="side" aria-label="実績のフォルダ"></nav><main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div class="scrim" id="scrim" hidden></div>
  <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden></aside>
  <div class="undo" id="undo" hidden><span id="undo-t"></span><button type="button" id="undo-b">元に戻す</button></div>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#note-top").textContent = t; $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;

  // 見ている場所：{ inbox } か { whose, folder } か すべて（null）
  let D = null, S = null, at = null, q = "", sel = null, back = null, blobUrl = null, undoFn = null, undoTimer = null, linkOpen = false;

  async function load() {
    const p = new URLSearchParams();
    if (at && at.inbox) p.set("inbox", "1");
    else if (at) { p.set("whose", at.whose); p.set("folder", at.folder); }
    if (q) p.set("q", q);
    const r = await api("/api/admin/results?" + p, { token: getToken() });
    if (!r.ok) { $("#main").innerHTML = `<p class="lead">${esc(errText(r))}</p>`; return; }
    S = r; draw();
    if (!D) { D = await api("/api/admin/results/drive", { token: getToken() }).catch(() => ({ ok: false })); draw(); }
  }
  const PERMIT_URL = "https://zoom-to-youtube.gameister1.workers.dev/oauth/start?for=workspace";
  function driveLine() {
    if (!D) return "";
    if (!D.ok) return `<p class="hint">ドライブの受け箱：様子を読めませんでした（${esc(D.error || "")}）</p>`;
    if (!D.permitted) return `<div class="drop" style="text-align:left;border-style:solid">ドライブの「実績の受け箱」を読むには、Google の許可を 1 回出し直してください：<a href="${PERMIT_URL}" target="_blank" rel="noopener">許可を出し直す ↗</a>（ふだんの Google アカウントを選ぶ）</div>`;
    return `<p class="hint">ドライブの受け箱：<a href="${esc(D.folder_url)}" target="_blank" rel="noopener">実績の受け箱を開く ↗</a>　入れたスクショは 5 分ごとにここへ入ります${D.waiting ? `（まだ ${D.waiting} 枚）<button class="btn sm" type="button" id="drive-now" style="margin-left:6px">いま取り込む</button>` : ""}</p>`;
  }
  const isAt = (w, f) => at && !at.inbox && at.whose === w && at.folder === f;

  function side() {
    const btn = (label, n, cur, data, extra = "") => `<button type="button" ${data} ${cur ? 'aria-current="page"' : ""} ${extra}><span>${esc(label)}</span><span class="c">${n || 0}</span></button>`;
    const group = (w) => `<h4>${WHOSE[w]}</h4>${S.folders[w].map((f) => btn(f.name, f.count, isAt(w, f.name), `data-whose="${w}" data-folder="${esc(f.name)}"`)).join("")}
      <button class="btn sm add" type="button" data-addf="${w}">＋ フォルダを追加</button>`;
    return `${btn("すべて", S.total, !at, 'data-all="1"')}${btn("受け箱（AI が迷った）", S.inbox, at && at.inbox, 'data-inbox="1"', S.inbox ? 'style="color:var(--ink,#b45309)"' : "")}${group("me")}${group("person")}`;
  }

  function draw() {
    $("#side").innerHTML = side();
    $("#side").querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => { at = null; sel = null; load(); }));
    $("#side").querySelectorAll("[data-inbox]").forEach((b) => b.addEventListener("click", () => { at = { inbox: true }; sel = null; load(); }));
    $("#side").querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => { at = { whose: b.dataset.whose, folder: b.dataset.folder }; sel = null; load(); }));
    $("#side").querySelectorAll("[data-addf]").forEach((b) => b.addEventListener("click", () => addFolder(b.dataset.addf)));
    const title = !at ? "すべての実績" : at.inbox ? "受け箱" : `${WHOSE[at.whose]} › ${at.folder}`;
    const lead = !at ? "自分の実績も、生徒・お客さんの実績もここ 1 か所。画像やポストのリンクを入れると、AI がフォルダへ仕分けます。"
      : at.inbox ? "AI が迷ったものです。行を開いてフォルダを選ぶと移ります。" : "このフォルダを開いたまま入れたものは、このフォルダに入ります（中身は AI が読みます）。";
    const rows = S.items.map((x) => `<tr class="rw ${sel === x.id ? "sel" : ""}" data-id="${esc(x.id)}" tabindex="0" aria-label="「${esc(x.title || "（成果なし）")}」の詳細を開く">
      <td>${x.has_image ? '<span class="ev">画像</span>' : '<span class="ev">ポスト</span>'}</td>
      <td class="nm">${esc(x.title || "（まだ読めていない）")}${x.checked ? "" : '<span class="ai unsure" title="AI が読んだ案。詳細で確かめて保存すると消える">AI の案</span>'}${x.ai === "done" ? '<span class="ai done">AI が仕分け</span>' : x.ai === "unsure" ? '<span class="ai unsure">AI が迷った</span>' : x.ai === "failed" ? '<span class="ai failed">AI が読めず</span>' : ""}
        ${x.labels.length ? `<span class="labs">${x.labels.map((l) => `<span class="lab">${esc(l)}</span>`).join("")}</span>` : ""}${!at ? `<small>${esc(WHOSE[x.whose])}${x.folder ? ` › ${esc(x.folder)}` : " › 受け箱"}</small>` : ""}</td>
      <td>${esc(x.who_name || (x.whose === "me" ? "自分" : ""))}</td>
      <td class="date">${esc(day(x.achieved_on) || day(x.created_at))}</td>
      <td><span class="st ${PUB[x.publish][0]}">${esc(PUB_SHORT[x.publish])}</span></td></tr>`).join("");
    $("#main").innerHTML = `<h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p>
      ${at && !at.inbox ? `<div class="fold-tools"><button class="btn sm" type="button" id="f-ren">フォルダの名前を変える</button><button class="btn sm" type="button" id="f-del">フォルダを削除</button></div>` : ""}
      ${driveLine()}
      <div class="drop" id="drop"><b>ここに画像やポストのリンクを落とすと追加</b>（スクショ・PDF・X の住所。複数まとめて OK）</div>
      <form id="link-form" class="bar" ${linkOpen ? "" : "hidden"}><label for="lk-url">ポストなどの住所</label><input id="lk-url" placeholder="https://x.com/…/status/…" style="flex:1;min-width:240px;padding:6px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel)"><button class="btn sm pri" type="submit">追加</button><button class="btn sm" type="button" id="lk-cancel">キャンセル</button></form>
      <div class="bar"><div class="search"><label for="q">探す</label><input type="search" id="q" value="${esc(q)}" placeholder="成果・誰・ラベル・本人の言葉"></div><span class="lead" style="margin:0">${S.count} 件</span></div>
      ${S.items.length ? `<div class="tbl list"><table><thead><tr><th>証拠</th><th>成果</th><th>誰</th><th>いつ</th><th>載せてよい範囲</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="lead">${at && at.inbox ? "受け箱は空です。" : "まだありません。右上の「画像を追加」か「リンクを追加」、またはここへ落として入れられます。"}</p>`}`;
    const qi = $("#q"); qi.addEventListener("keydown", (e) => { if (e.key === "Enter") { q = qi.value.trim(); load(); } });
    $("#main").querySelectorAll("tr.rw").forEach((tr) => { tr.addEventListener("click", () => openItem(tr.dataset.id)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openItem(tr.dataset.id); }); });
    $("#link-form").addEventListener("submit", (e) => { e.preventDefault(); addLink($("#lk-url").value.trim()); });
    $("#lk-cancel").addEventListener("click", () => { linkOpen = false; $("#link-form").hidden = true; $("#link-open").focus(); });
    const ren = $("#f-ren"); if (ren) ren.addEventListener("click", renameFolder);
    const del = $("#f-del"); if (del) del.addEventListener("click", removeFolder);
    wireDrop();
    const dn = $("#drive-now"); if (dn) dn.addEventListener("click", async () => { dn.disabled = true; say("ドライブから取り込んで、AI が読んでいます…"); const r = await api("/api/admin/results/drive", { method: "POST", token: getToken() }); D = null; await load(); say(r.ok ? `${r.taken} 枚を取り込みました` : errText(r)); });
  }

  function wireDrop() {
    const d = $("#drop"), m = $("#main");
    const on = (e) => { e.preventDefault(); d.classList.add("over"); };
    const off = () => d.classList.remove("over");
    m.addEventListener("dragover", on); m.addEventListener("dragleave", (e) => { if (!m.contains(e.relatedTarget)) off(); });
    m.addEventListener("drop", (e) => {
      e.preventDefault(); off();
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) { upload(files); return; }
      const t = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split(/\s+/).filter((u) => /^https:\/\//.test(u));
      if (t.length) addLinks(t); else say("画像か https:// の住所を落としてください");
    });
  }

  const where = () => (at && !at.inbox ? { whose: at.whose, folder: at.folder } : {});
  async function upload(files) {
    let done = 0;
    for (const f of files) {
      if (f.size > MAX) { say(`「${f.name}」は 20MB を超えています`); continue; }
      say(`「${f.name}」を入れて、AI が読んでいます…（${done + 1}/${files.length}）`);
      const w = where();
      const p = new URLSearchParams({ name: f.name, ...(w.whose ? { whose: w.whose, folder: w.folder } : {}) });
      const res = await fetch(`/api/admin/results/upload?${p}`, { method: "POST", headers: { authorization: "Bearer " + getToken(), "content-type": f.type || "application/octet-stream" }, body: f });
      const r = await res.json().catch(() => ({ ok: false, error: res.status }));
      if (!r.ok) { say(`「${f.name}」を入れられませんでした：${errText(r)}`); continue; }
      done++;
    }
    await load(); if (done) say(`${done} 件を入れました。AI が仕分けました（迷ったものは受け箱）`);
  }
  async function addLinks(urls) { for (const u of urls) await addLink(u, true); await load(); }
  async function addLink(url, quiet) {
    say("住所を読んで、AI が仕分けています…");
    const r = await api("/api/admin/results/link", { method: "POST", token: getToken(), body: { url, ...where() } });
    if (!r.ok) { say(errText(r)); if (!quiet) $("#lk-url") && $("#lk-url").focus(); return; }
    linkOpen = false;
    if (!quiet) await load();
    say(r.item.folder ? `「${r.item.title || "ポスト"}」を ${r.item.folder} に入れました` : "入れました（AI が迷ったので受け箱）");
  }

  // ---------- 詳細 ----------
  async function openItem(id) {
    back = id; sel = id;
    const x = S.items.find((y) => y.id === id); if (!x) return;
    draw(); drawDrawer(x);
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if (x.has_image) {
      const res = await fetch("/api/admin/results/file?id=" + encodeURIComponent(id), { headers: { authorization: "Bearer " + getToken() } });
      if (res.ok && sel === id) { blobUrl = URL.createObjectURL(await res.blob()); const pv = $("#pv"); if (pv) pv.innerHTML = x.content_type === "application/pdf" ? `<a class="btn sm" href="${blobUrl}" target="_blank" rel="noopener">PDF を開く ↗</a>` : `<a href="${blobUrl}" target="_blank" rel="noopener" aria-label="画像を大きく開く"><img class="pv" src="${blobUrl}" alt="証拠の画像"></a>`; }
    }
  }
  function drawDrawer(x) {
    const d = $("#drawer");
    const opts = (w) => [`<option value="" ${!x.folder ? "selected" : ""}>（受け箱）</option>`, ...S.folders[w].map((f) => `<option ${x.folder === f.name && x.whose === w ? "selected" : ""}>${esc(f.name)}</option>`)].join("");
    d.innerHTML = `<div class="dh"><h2 id="d-title">${esc(x.title || "（成果なし）")}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        <div class="sec" id="pv">${x.has_image ? '<p class="lead">画像を読み込んでいます…</p>' : ""}${x.link_url ? `<p style="margin:6px 0"><a href="${esc(x.link_url)}" target="_blank" rel="noopener">${esc(x.link_url)} ↗</a></p>` : ""}</div>
        ${x.ai_note ? `<p class="hint">AI：${esc(x.ai_note)}</p>` : ""}
        ${x.checked ? `<p class="hint">確かめ済み（AI はもう成果・誰・いつ・本人の言葉を書き換えません）</p>` : `<p class="hint" style="color:var(--ink,#b45309)">成果の欄は AI が読んだ案です。画像と見比べて、合っていれば（直したら）「保存」で確かめ済みになります。</p>`}
        <div class="sec"><div class="row2">
          <div class="f"><label for="d-whose">まとまり</label><select id="d-whose"><option value="me" ${x.whose === "me" ? "selected" : ""}>自分の実績</option><option value="person" ${x.whose === "person" ? "selected" : ""}>生徒・お客さんの実績</option></select></div>
          <div class="f"><label for="d-folder">フォルダ</label><select id="d-folder">${opts(x.whose)}</select></div></div>
          <div class="f"><label for="d-title-in">成果（数字を入れて 1 行）</label><input id="d-title-in" maxlength="200" value="${esc(x.title)}"></div>
          <div class="row2"><div class="f"><label for="d-who">誰の実績</label><input id="d-who" maxlength="80" value="${esc(x.who_name)}" placeholder="${x.whose === "me" ? "自分" : "名前か @ID"}"></div>
          <div class="f"><label for="d-date">いつ</label><input id="d-date" type="date" value="${esc(x.achieved_on || "")}"></div></div>
          <div class="f"><label for="d-labels">ラベル（読点か , で区切る）</label><input id="d-labels" value="${esc(x.labels.join("、"))}"></div>
          <div class="f"><label for="d-quote">本人の言葉</label><textarea class="q" id="d-quote" maxlength="1000">${esc(x.quote)}</textarea></div>
        </div>
        <div class="sec"><h3>載せてよい範囲</h3><div class="seg" role="group" aria-label="載せてよい範囲">${Object.keys(PUB).map((k) => `<button type="button" data-pub="${k}" aria-pressed="${x.publish === k}">${esc(PUB_SHORT[k])}</button>`).join("")}</div>
          <p class="hint">LP・ブログ・セミナーに使えるのは「名前を出してよい」と「名前を伏せれば」だけ。AI は決めません。</p></div>
        <dl class="meta"><dt>入れ方</dt><dd>${esc({ upload: "画面から", link: "リンク", drive: "ドライブの受け箱", panel: "シアニンパネル", mcp: "AI のチャット" }[x.source] || x.source)}</dd><dt>入れた日</dt><dd>${esc(day(x.created_at))}</dd></dl>
      </div>
      <div class="bar" style="padding:12px 16px;border-top:1px solid var(--line);margin:0"><button class="btn pri" type="button" id="d-save">保存</button><button class="btn" type="button" id="d-resort">AI にもう一度仕分けさせる</button><span class="grow" style="flex:1"></span><button class="btn" type="button" id="d-arch">しまう</button></div>`;
    d.hidden = false; $("#scrim").hidden = false;
    let pub = x.publish;
    d.querySelectorAll("[data-pub]").forEach((b) => b.addEventListener("click", () => { pub = b.dataset.pub; d.querySelectorAll("[data-pub]").forEach((y) => y.setAttribute("aria-pressed", String(y === b))); }));
    $("#d-whose").addEventListener("change", (e) => { $("#d-folder").innerHTML = opts(e.target.value).replace(/ selected/g, ""); });
    $("#d-close").addEventListener("click", closeDrawer);
    $("#d-save").addEventListener("click", () => saveItem(x.id, pub));
    $("#d-resort").addEventListener("click", () => resort(x.id));
    $("#d-arch").addEventListener("click", () => archive(x.id));
    $("#d-title-in").focus();
  }
  function closeDrawer() {
    $("#drawer").hidden = true; $("#scrim").hidden = true; sel = null;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    draw(); const tr = back && $("#main").querySelector(`tr[data-id="${CSS.escape(back)}"]`); if (tr) tr.focus();
  }
  async function saveItem(id, pub) {
    const body = { id, whose: $("#d-whose").value, folder: $("#d-folder").value, title: $("#d-title-in").value, who_name: $("#d-who").value, achieved_on: $("#d-date").value || null, labels: $("#d-labels").value, quote: $("#d-quote").value, publish: pub };
    const r = await api("/api/admin/results/save", { method: "POST", token: getToken(), body });
    if (!r.ok) { say(errText(r)); return; }
    await load(); const x = S.items.find((y) => y.id === id);
    say(`「${r.item.title || "実績"}」を保存しました`);
    if (x) drawDrawer(x); else closeDrawer();
  }
  async function resort(id) {
    say("AI が読み直しています…");
    const r = await api("/api/admin/results/resort", { method: "POST", token: getToken(), body: { id } });
    if (!r.ok) { say(errText(r)); return; }
    await load(); const x = S.items.find((y) => y.id === id);
    say(r.item.folder ? `AI が ${r.item.folder} に仕分けました` : "AI が迷ったので受け箱に入れました");
    if (x) openItem(id); else closeDrawer();
  }
  async function archive(id) {
    const r = await api("/api/admin/results/save", { method: "POST", token: getToken(), body: { id, archived: true } });
    if (!r.ok) { say(errText(r)); return; }
    closeDrawer(); await load();
    showUndo(`「${r.item.title || "実績"}」をしまいました`, async () => { await api("/api/admin/results/save", { method: "POST", token: getToken(), body: { id, archived: false } }); await load(); say("戻しました"); });
  }
  function showUndo(t, fn) {
    undoFn = fn; $("#undo-t").textContent = t; $("#undo").hidden = false; say(t);
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { $("#undo").hidden = true; undoFn = null; }, 8000);
  }

  // ---------- フォルダ ----------
  async function addFolder(whose) {
    const name = (prompt(`${WHOSE[whose]}に足すフォルダの名前`) || "").trim(); if (!name) return;
    const r = await api("/api/admin/results/folder", { method: "POST", token: getToken(), body: { action: "add", whose, name } });
    if (!r.ok) { say(errText(r)); return; }
    at = { whose, folder: name }; await load(); say(`フォルダ「${name}」を追加しました`);
  }
  async function renameFolder() {
    const to = (prompt("新しいフォルダの名前", at.folder) || "").trim(); if (!to || to === at.folder) return;
    const r = await api("/api/admin/results/folder", { method: "POST", token: getToken(), body: { action: "rename", whose: at.whose, name: at.folder, to } });
    if (!r.ok) { say(errText(r)); return; }
    at = { whose: at.whose, folder: to }; await load(); say(`フォルダの名前を「${to}」に変えました`);
  }
  async function removeFolder() {
    const r = await api("/api/admin/results/folder", { method: "POST", token: getToken(), body: { action: "remove", whose: at.whose, name: at.folder } });
    if (!r.ok) { say(errText(r)); return; }
    const name = at.folder, whose = at.whose; at = null; await load();
    showUndo(`フォルダ「${name}」を削除しました`, async () => { await api("/api/admin/results/folder", { method: "POST", token: getToken(), body: { action: "add", whose, name } }); await load(); });
  }

  $("#up-file").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) upload(fs); });
  $("#link-open").addEventListener("click", () => { linkOpen = true; const f = $("#link-form"); if (f) { f.hidden = false; $("#lk-url").focus(); } });
  $("#scrim").addEventListener("click", closeDrawer);
  $("#undo-b").addEventListener("click", async () => { const fn = undoFn; $("#undo").hidden = true; undoFn = null; if (fn) await fn(); });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) { e.preventDefault(); closeDrawer(); } });
  return { open: () => load() };
}

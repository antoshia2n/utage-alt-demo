// UTAGE の写し（2026-11-06 開発部・UTAGE 解約の便 U1・Naoki OK 19:47／19:56）
//  ・解約に備えて UTAGE の中身を全部写したものを、読むだけで見る棚。正本は shia2n-mcp（保管庫）。毎晩 JST 3 時台に取り直す
//  ・左＝棚（概要・ファネル・配信・LINE・イベント・会員サイト・商品・メディア・人の数）、真ん中＝読み物、行の `種類:番号` を押すと全文
//  ・AI も同じものを shia2n-mcp の utage_archive__* で読む。個人の情報は数だけ
//  ・録画（recordings.js）と同じ見た目（recordings.css）と影の DOM
import { api } from "/js/common.js";

const ERR = {
  no_binding: "UTAGE のバックアップ（shia2n-mcp）にまだつながっていません。shia2n-mcp の結合を待っています",
  no_run: "まだ 1 回も読み終えていません。初回は数時間かかります（15 分ごとに進みます）",
  not_found: "見つかりませんでした",
  personal: "個人の情報は数だけを見せています",
};

export function mountUtageCopy(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css"><link rel="stylesheet" href="/css/utagecopy.css">
  <div class="top"><span class="tab" aria-current="page" style="cursor:default">UTAGE のバックアップ</span><span class="grow"></span><span class="note-top" id="note-top"></span></div>
  <div class="wrap"><nav class="side" id="side" aria-label="棚"></nav><main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div class="scrim" id="scrim" hidden></div>
  <section class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden></section>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const call = (path) => api("/api/admin/utage-copy" + path, { token: getToken() });
  const errText = (r) => ERR[r.error] || r.message || `うまくいきませんでした（${r.error || r.status}）`;

  let S = null, doc = "overview", md = "", q = "", hits = null, openFrom = null;

  // 読み物（shia2n-mcp が作る決まった形の Markdown）を画面の形に。見出し・表・箇条・引用・`種類:番号`
  function render(mdText) {
    const lines = String(mdText || "").split("\n");
    const out = [];
    let i = 0;
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([a-z_]+:[^`]+)`/g, (_, ref) => `<button type="button" class="btn sm" data-ref="${ref}" aria-label="${ref} の全文を開く">全文</button>`).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/(https?:\/\/[^\s）)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1 ↗</a>');
    while (i < lines.length) {
      const l = lines[i];
      if (/^\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const body = rows.filter((r) => !/^\|\s*-/.test(r));
        out.push(`<div class="tbl"><table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^# /.test(l)) out.push(`<h1>${inline(l.slice(2))}</h1>`);
      else if (/^## /.test(l)) out.push(`<h2 class="uc-h2">${inline(l.slice(3))}</h2>`);
      else if (/^### /.test(l)) out.push(`<h3 class="uc-h3">${inline(l.slice(4))}</h3>`);
      else if (/^\s*> /.test(l)) out.push(`<p class="uc-q">${inline(l.replace(/^\s*> /, ""))}</p>`);
      else if (/^- /.test(l)) out.push(`<p class="uc-li">${inline(l.slice(2))}</p>`);
      else if (l.trim()) out.push(`<p class="lead">${inline(l)}</p>`);
      i++;
    }
    return out.join("");
  }

  function side() {
    const docs = (S && S.docs) || {};
    $("#side").innerHTML = `<h4>棚</h4>${Object.entries(docs).map(([k, v]) => `<button type="button" data-doc="${k}" aria-current="${doc === k ? "page" : "false"}"><span>${esc(v.replace(/（.*$/, ""))}</span></button>`).join("")}
      <p class="hint" style="margin:12px 10px 0">毎晩 3 時台に UTAGE から取り直します。読むだけの写しです（UTAGE には書きません）。</p>`;
  }
  function head() {
    const L = S && S.latest, C = S && S.current;
    const going = C && !C.finished_at;
    $("#note-top").textContent = L ? `${L.run} の写し${going ? `・いま取り直し中（残り ${C.queue_left}）` : ""}` : going ? `初回をコピーしています（残り ${C.queue_left}）` : "";
  }
  function main() {
    const search = `<div class="bar"><div class="search"><span aria-hidden="true">⌕</span><input type="search" id="q" placeholder="名前・文面・住所で探す（Enter）" value="${esc(q)}" aria-label="写しの中を探す"></div></div>`;
    if (hits) {
      $("#main").innerHTML = `<h1>「${esc(q)}」の検索結果</h1>${search}<p class="lead">${hits.matched} 件${hits.matched > hits.rows.length ? `（先頭の ${hits.rows.length} 件）` : ""}</p>
        <div class="tbl"><table><thead><tr><th>名前</th><th>道筋</th><th><span class="sr">操作</span></th></tr></thead><tbody>${hits.rows.map((r) => `<tr><td class="nm">${esc(r.name)}${r.excerpt ? `<small>${esc(r.excerpt.slice(0, 120))}</small>` : ""}</td><td style="font-size:12px;color:var(--muted)">${esc(r.path)}</td><td><button type="button" class="btn sm" data-ref="${esc(r.ref)}" aria-label="「${esc(r.name)}」の全文を開く">全文</button></td></tr>`).join("") || '<tr><td colspan="3" class="empty">見つかりませんでした</td></tr>'}</tbody></table></div>
        <div class="row2" style="margin-top:10px"><button type="button" class="btn" id="back">棚へ戻る</button></div>`;
      return;
    }
    $("#main").innerHTML = search + (md ? render(md) : `<div class="err">${esc(errText({ error: "no_run" }))}</div>`);
  }
  async function loadDoc(name) {
    doc = name; hits = null;
    const r = await call("/doc?name=" + encodeURIComponent(name));
    md = r.ok ? r.markdown : "";
    if (!r.ok && r.error !== "no_run") { $("#main").innerHTML = `<div class="err">${esc(errText(r))}</div>`; return; }
    side(); main();
  }
  async function load() {
    const r = await call("");
    if (!r.ok) { $("#main").innerHTML = `<div class="err">${esc(errText(r))}</div>`; return; }
    S = r; head(); side();
    await loadDoc(doc);
  }
  async function openItem(ref, from) {
    openFrom = from || root.activeElement;
    const r = await call("/item?ref=" + encodeURIComponent(ref));
    const d = $("#drawer");
    if (!r.ok) { say(errText(r)); return; }
    const it = r.item;
    d.innerHTML = `<div class="dh"><h2 id="d-title">${esc(it.name)}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
      <div class="db"><p class="hint">${esc(it.path || "")}${it.url ? `・<a href="${esc(it.url)}" target="_blank" rel="noopener">UTAGE で開く ↗</a>` : ""}</p>
      ${it.info ? `<p class="hint">${Object.entries(it.info).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${esc(k)}：${esc(v)}`).join("・")}</p>` : ""}
      <div class="uc-text">${r.text ? esc(r.text) : '<span class="hint">本文はありません（名前だけの品目）</span>'}</div>
      <p class="hint">AI に渡すときは「UTAGE のバックアップの ${esc(ref)} を読んで」と言えば同じものを読めます。</p></div>`;
    d.hidden = false; $("#scrim").hidden = false;
    setTimeout(() => $("#d-close")?.focus(), 30);
  }
  function closeItem() { $("#drawer").hidden = true; $("#scrim").hidden = true; openFrom?.focus?.(); openFrom = null; }

  root.addEventListener("click", (e) => {
    const t = e.target;
    const dc = t.closest("[data-doc]"); if (dc) return loadDoc(dc.dataset.doc);
    const rf = t.closest("[data-ref]"); if (rf) return openItem(rf.dataset.ref, rf);
    if (t.id === "d-close" || t.id === "scrim") return closeItem();
    if (t.id === "back") { hits = null; q = ""; main(); return; }
  });
  root.addEventListener("keydown", async (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) { e.stopPropagation(); return closeItem(); }
    if (e.key === "Tab" && !$("#drawer").hidden) {
      const f = [...$("#drawer").querySelectorAll("button,a[href]")];
      const first = f[0], last = f[f.length - 1], cur = root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === "Enter" && e.target.id === "q") {
      e.preventDefault();
      q = e.target.value.trim();
      if (!q) { hits = null; main(); return; }
      const r = await call("/search?q=" + encodeURIComponent(q));
      if (!r.ok) { say(errText(r)); return; }
      hits = r; main(); say(`${r.matched} 件見つかりました`); $("#q")?.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.composedPath().includes(host) || !host.isConnected || host.offsetParent === null) return;
    if (!$("#drawer").hidden) closeItem();
  });
  return { open: () => { if (!S) load(); } };
}

// 録画（2026-11-06 Naoki「R2 の動画を整理されて、あとで共有リンクを発行しやすくしておきたい」→ デモに OK 14:21・置き場 15:02 OK）
//  ・シアニン用の画面（admin.html）の「録画」の中に、影の DOM で入れる（会員サイトと同じ。見た目と id が今の画面とぶつからないため）
//  ・中身と共有リンクの正本は zoom-to-youtube（R2）。ここは /api/admin/recordings* を呼ぶだけ。書いたら読み直して描き直す
//  ・上の帯：棚（一覧とリンクの発行）／整理（会の種類の案・名前をそろえる）／点検（日付が合わない・ほぼ空・流せる動画が無い）
import { api } from "/js/common.js";

const KAI = { "セミナー": "#2563eb", "打ち合わせ": "#7c3aed", "個別相談": "#0d9488", "Zoom添削": "#db2777", "その他": "#a39a90" };
const ISSUE_ORDER = ["名前の日付と収録日が合わない", "ほぼ空（1 分未満か 10MB 未満）", "見る画面で流せる動画が無い（音声だけなど）"];
const lkey = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const ERR = {
  not_found: "録画が見つかりませんでした（消されたかもしれません）",
  no_video: "この録画には見る画面で流せる動画がありません（音声だけなど）",
  no_link: "先にリンクを発行してください",
  bad_date: "期限の日付が読めませんでした",
  no_binding: "録画の保管（zoom-to-youtube）につながっていません",
  no_ai: "AI が使えませんでした",
};
const PAGE = 200;

export function mountRecordings(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <div class="top" role="tablist" aria-label="録画の機能">
    <button class="tab" role="tab" type="button" data-tab="list" aria-selected="true">棚</button>
    <button class="tab" role="tab" type="button" data-tab="tidy" aria-selected="false">整理<span class="badge" id="b-tidy" hidden></span></button>
    <button class="tab" role="tab" type="button" data-tab="check" aria-selected="false">点検<span class="badge" id="b-check" hidden></span></button>
    <span class="grow"></span><span class="note-top" id="note-top"></span>
  </div>
  <div class="wrap"><nav class="side" id="side" aria-label="棚"></nav><main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div class="scrim" id="scrim" hidden></div>
  <section class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden></section>
  <div id="mslot"></div>
  <div class="undo" id="undo" role="status" aria-live="polite" hidden><span id="undo-t"></span><button type="button" id="undo-b">元に戻す</button></div>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const call = (path, method = "GET", body) => api("/api/admin/recordings" + path, { method, body, token: getToken() });
  const errText = (r) => ERR[r.error] || r.message || `うまくいきませんでした（${r.error || r.status}）`;
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  const hm = (m) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + "分" : ""}` : `${m}分`);

  let D = null, tab = "list", shelf = "all", q = "", inTx = false, txIds = null, filters = new Set(), shown = PAGE, sel = null, lastFocus = null, undoFn = null, undoTimer = 0, busy = false;
  const checked = new Set();
  let mlFrom = null;
  // 便 A：ラベルの一覧（多い順）
  const allLabels = () => { const m = new Map(); D.rows.forEach((r) => (r.labels || []).forEach((l) => m.set(l, (m.get(l) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")); };
  const labDatalist = (id) => `<datalist id="${id}">${allLabels().map(([l]) => `<option value="${esc(l)}">`).join("")}</datalist>`;

  async function load() {
    const r = await call("");
    if (!r.ok) { $("#main").innerHTML = `<div class="err">録画の一覧を読めませんでした：${esc(errText(r))}</div>`; return; }
    D = r;
    render();
  }

  function undo(text, fn) {
    undoFn = fn;
    $("#undo-t").textContent = text;
    $("#undo-b").hidden = !fn;
    $("#undo").hidden = false;
    say(text);
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => ($("#undo").hidden = true), 6000);
  }
  $("#undo-b").addEventListener("click", async () => { $("#undo").hidden = true; const f = undoFn; undoFn = null; if (f) { await f(); await load(); } });

  function stLabel(s) {
    if (!s) return '<span class="st off">― 未発行</span>';
    if (s.state === "on") return '<span class="st on">● 共有中</span>';
    return s.state === "stop" ? '<span class="st stop">■ 止めた</span>' : '<span class="st stop">■ 期限切れ</span>';
  }
  const kaiTag = (k) => `<span class="kai"><i class="dot" style="background:${KAI[k] || KAI["その他"]}"></i>${esc(k)}</span>`;

  // ---------- 左の棚 ----------
  function side() {
    const c = D.counts;
    const years = [...new Set(D.rows.map((r) => r.date.slice(0, 4)).filter(Boolean))].sort().reverse();
    const b = (key, label, n, dot) => `<button type="button" data-shelf="${key}" aria-current="${shelf === key ? "page" : "false"}"><span>${dot ? `<i class="dot" style="background:${dot}"></i>` : ""}${esc(label)}</span><span class="c">${n ?? ""}</span></button>`;
    $("#side").innerHTML =
      `<h4>会の種類</h4>${b("all", "すべて", c.all)}${Object.keys(KAI).map((k) => b(k, k, c[k], KAI[k])).join("")}` +
      `<h4>共有</h4>${b("shared", "共有中", c.shared)}${b("noshare", "未発行", D.rows.filter((r) => !r.share).length)}` +
      `<h4>年・月</h4>${years.map((y) => {
        const open = shelf === "y" + y || shelf.startsWith("m" + y);
        const ms = [...new Set(D.rows.filter((r) => r.date.startsWith(y)).map((r) => r.date.slice(5, 7)))].sort().reverse();
        return `<button type="button" data-shelf="y${y}" aria-current="${shelf === "y" + y ? "page" : "false"}" aria-expanded="${open}"><span>${open ? "▾" : "▸"} ${y} 年</span><span class="c">${D.rows.filter((r) => r.date.startsWith(y)).length}</span></button>` +
          (open ? ms.map((m) => `<button type="button" class="sub" data-shelf="m${y}-${m}" aria-current="${shelf === `m${y}-${m}` ? "page" : "false"}"><span>${Number(m)} 月</span><span class="c">${D.rows.filter((r) => r.date.startsWith(`${y}-${m}`)).length}</span></button>`).join("") : "");
      }).join("")}` +
      `<h4 class="lrow">ラベル<button type="button" class="mini-link" id="manage-l">整える</button></h4>${allLabels().map(([l, n]) => `<button type="button" data-shelf="L${esc(l)}" aria-current="${shelf === "L" + l ? "page" : "false"}"><span><span class="lab">${esc(l)}</span></span><span class="c">${n}</span></button>`).join("") || '<p class="hint" style="margin:0 10px">まだありません</p>'}`;
  }
  $("#side").addEventListener("click", (e) => {
    const b = e.target.closest("[data-shelf]");
    if (!b) return;
    shelf = b.dataset.shelf; shown = PAGE; setTab("list");
  });

  // ---------- 棚 ----------
  function rows() {
    const words = q.split(/[\s　]+/).filter(Boolean);
    return D.rows.filter((r) => {
      if (shelf === "shared" && !(r.share && r.share.state === "on")) return false;
      if (shelf === "noshare" && r.share) return false;
      if (KAI[shelf] && r.kai !== shelf) return false;
      if (shelf.startsWith("y") && !r.date.startsWith(shelf.slice(1))) return false;
      if (shelf.startsWith("m") && !r.date.startsWith(shelf.slice(1))) return false;
      if (shelf.startsWith("L") && !(r.labels || []).includes(shelf.slice(1))) return false;
      if (filters.has("yt") && !r.youtube) return false;
      if (filters.has("noyt") && r.youtube) return false;
      if (filters.has("sheet") && !r.managed) return false;
      if (inTx && txIds) { if (!txIds.has(r.id)) return false; }
      else if (words.length && !words.every((w) => r.title.includes(w))) return false;
      return true;
    });
  }
  const FILTERS = { yt: "YouTube あり", noyt: "YouTube なし", sheet: "管理シートにある録画" };
  function listView() {
    const rs = rows();
    const label = shelf === "all" ? "すべての録画" : KAI[shelf] ? shelf : shelf === "shared" ? "共有中" : shelf === "noshare" ? "リンク未発行"
      : shelf.startsWith("m") ? `${shelf.slice(1, 5)} 年 ${Number(shelf.slice(6))} 月` : shelf.startsWith("L") ? `ラベル「${shelf.slice(1)}」` : shelf.slice(1) + " 年";
    const page = rs.slice(0, shown);
    const act = (r) => (r.share && r.share.state === "on")
      ? `<button class="btn sm" type="button" data-copy="${esc(r.id)}" aria-label="「${esc(r.title)}」のリンクをコピー">コピー</button>`
      : r.share ? `<button class="btn sm" type="button" data-open="${esc(r.id)}" aria-label="「${esc(r.title)}」の共有の設定を開く">詳細 ▼</button>`
      : r.issues.includes(ISSUE_ORDER[2]) ? ""
      : `<button class="btn sm pri" type="button" data-issue="${esc(r.id)}" aria-label="「${esc(r.title)}」のリンクを発行">リンクを発行</button>`;
    return `<h1>${esc(label)}</h1><p class="lead">${rs.length} 本。行を押すと詳細。リンクは${D.short_link_ready ? " v.shia2n.jp の短い形" : "準備中のため長い形"}で出ます。</p>
    <div class="bar">
      <div class="search"><span aria-hidden="true">⌕</span><input type="search" id="q" placeholder="${inTx ? "文字起こしの中を探す（Enter）" : "題名で探す"}" value="${esc(q)}" aria-label="録画を探す">
        <label><input type="checkbox" id="intx" ${inTx ? "checked" : ""}>文字起こしの中も</label></div>
      <div class="pop"><button class="btn" type="button" id="fbtn" aria-haspopup="menu" aria-expanded="false">絞り込み ▾</button>
        <div class="menu" id="fmenu" role="menu" hidden>${Object.entries(FILTERS).map(([k, l]) => `<button type="button" role="menuitemcheckbox" data-f="${k}" aria-checked="${filters.has(k)}">${l}</button>`).join("")}</div></div>
    </div>
    ${checked.size ? `<div class="bulk" role="region" aria-label="まとめて"><b>${checked.size} 本を選択中</b><input id="bulk-l" list="lab-a" placeholder="ラベルを入れて Enter" aria-label="選んだ録画に付けるラベル">${labDatalist("lab-a")}<button class="btn sm pri" type="button" id="bulk-add">ラベルを追加</button><button class="btn sm" type="button" id="bulk-clear">選択を外す</button></div>` : ""}
    <div class="chips">${[...filters].map((f) => `<span class="chip">${FILTERS[f]}<button type="button" data-rmf="${f}" aria-label="「${FILTERS[f]}」を外す">✕</button></span>`).join("")}${inTx && txIds ? `<span class="chip">文字起こしに「${esc(q)}」<button type="button" data-rmtx aria-label="文字起こしの絞り込みを外す">✕</button></span>` : ""}</div>
    <div class="tbl list"><table><thead><tr><th><input type="checkbox" id="ck-all" aria-label="表に出ている録画を全部選ぶ" ${page.length && page.every((r) => checked.has(r.id)) ? "checked" : ""}></th><th>収録日</th><th>名前</th><th>会</th><th style="text-align:right">長さ</th><th>YouTube</th><th>共有リンク</th><th style="text-align:right">開かれた数</th><th><span class="sr">操作</span></th></tr></thead><tbody>
    ${page.map((r) => `<tr class="rw ${sel === r.id ? "sel" : ""}" data-id="${esc(r.id)}" tabindex="0" aria-label="${esc(r.date)} ${esc(r.title)} の詳細を開く">
      <td class="hide-sp"><input type="checkbox" class="ck" data-ck="${esc(r.id)}" ${checked.has(r.id) ? "checked" : ""} aria-label="「${esc(r.title)}」を選ぶ"></td>
      <td class="date">${esc(r.date)}</td><td class="nm">${esc(r.title)}${(r.labels || []).length ? `<span class="labs">${r.labels.map((l) => `<span class="lab">${esc(l)}</span>`).join("")}</span>` : ""}${r.issues.length ? `<small>点検：${esc(r.issues[0])}</small>` : ""}</td><td class="hide-sp">${kaiTag(r.kai)}</td>
      <td class="num hide-sp">${hm(r.minutes) || (r.size_gb != null ? r.size_gb.toFixed(2) + " GB" : "")}</td><td class="hide-sp" style="font-size:12px;color:var(--muted)">${r.youtube ? "あり" : "―"}</td>
      <td>${stLabel(r.share)}</td><td class="num hide-sp">${r.share ? r.share.views : ""}</td><td>${act(r)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">合う録画がありません</td></tr>`}
    </tbody></table>${rs.length > shown ? `<div class="more"><button class="btn" type="button" id="more">さらに ${Math.min(PAGE, rs.length - shown)} 本を出す（残り ${rs.length - shown} 本）</button></div>` : ""}</div>`;
  }

  // ---------- 整理 ----------
  function tidyView() {
    const ks = D.rows.filter((r) => r.suggest_kai), ns = D.rows.filter((r) => r.suggest_name);
    const left = D.rows.filter((r) => r.kai === "その他").length;
    return `<h1>整理</h1><p class="lead">案を見て、まとめて承認するだけ。承認しないものはそのまま残ります。承認したあとも「元に戻す」で戻せます。</p>
    <div class="card"><h2>会の種類の案（「その他」${left} 本）</h2><p>5 分ごとに AI が 6 本ずつ文字起こしを読んで案を出しています。違うものは右の選びから直してから承認します。</p>
      ${(() => { const pend = D.counts.sug_pending || 0, done = Math.max(0, left - pend), pct = left ? Math.round((done / left) * 100) : 100; return `<div class="prog" role="progressbar" aria-label="案の進み具合" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
      <p style="margin-top:6px">読み終えた ${done} 本／残り ${pend} 本${pend ? `（あと約 ${Math.ceil(pend / 6) * 5} 分）` : ""}${D.counts.sug_none ? `・文字起こしが無いなどで案を出せない ${D.counts.sug_none} 本` : ""}</p>`; })()}
      <div class="row2" style="margin-top:10px"><button class="btn sm" type="button" id="suggest">今すぐ 8 本読ませる</button><span class="why" id="sug-note"></span></div></div>
    ${ks.length ? `<div class="tbl" style="margin-bottom:12px"><table><thead><tr><th><input type="checkbox" id="all-k" checked aria-label="会の種類の案を全部選ぶ"></th><th>収録日</th><th>名前</th><th>案</th><th>理由</th></tr></thead><tbody>
      ${ks.map((r) => `<tr><td><input type="checkbox" class="ck-k" data-id="${esc(r.id)}" checked aria-label="「${esc(r.title)}」を承認に入れる"></td><td class="date">${esc(r.date)}</td><td class="nm">${esc(r.title)}</td>
        <td><select class="mini" data-k="${esc(r.id)}" aria-label="「${esc(r.title)}」の会の種類">${Object.keys(KAI).map((k) => `<option ${k === r.suggest_kai.kai ? "selected" : ""}>${k}</option>`).join("")}</select></td><td class="why">${esc(r.suggest_kai.why)}</td></tr>`).join("")}
      </tbody></table></div><div class="bar"><button class="btn pri" type="button" id="ok-k">選んだ録画の会の種類を承認</button></div>` : '<p class="lead">いま承認を待っている会の種類の案はありません。</p>'}
    <div class="card" style="margin-top:20px"><h2>名前をそろえる（日付｜会｜話題）（${ns.length} 本）</h2><p>管理シートに行がある録画は、シートの E 列（学ぶくんの題名）が正本なので、ここでは変えません。日付が合わない録画は点検へ回しています。</p></div>
    ${ns.length ? `<div class="tbl"><table><thead><tr><th><input type="checkbox" id="all-n" checked aria-label="名前の案を全部選ぶ"></th><th>収録日</th><th>今の名前</th><th>そろえた名前</th></tr></thead><tbody>
      ${ns.slice(0, 300).map((r) => `<tr><td><input type="checkbox" class="ck-n" data-id="${esc(r.id)}" checked aria-label="「${esc(r.title)}」を承認に入れる"></td><td class="date">${esc(r.date)}</td><td class="from">${esc(r.title)}</td><td class="to">${esc(r.suggest_name)}</td></tr>`).join("")}
      </tbody></table></div>${ns.length > 300 ? `<p class="hint">先頭の 300 本だけを出しています。承認すると次が出ます。</p>` : ""}<div class="bar" style="margin-top:12px"><button class="btn pri" type="button" id="ok-n">選んだ録画の名前をそろえる</button></div>` : ""}`;
  }

  // ---------- 点検 ----------
  function checkView() {
    const groups = ISSUE_ORDER.map((name) => [name, D.rows.filter((r) => r.issues.includes(name))]);
    const tiny = groups[1][1];
    const NOTE = {
      [ISSUE_ORDER[0]]: "別の回の名前や YouTube が付いている見込み。行を押して名前を直します。",
      [ISSUE_ORDER[1]]: "録り間違いの見込み。消すかどうかは Naoki が決めます（消すのは AI との壁打ちのあと・zoom_archive__delete）。",
      [ISSUE_ORDER[2]]: "画面つきの動画が無いので、共有リンクを出せません。",
    };
    return `<h1>点検</h1><p class="lead">怪しいものを集めました。ここでは何も消しません。</p>
    ${groups.map(([name, rs]) => `<div class="card"><h2>${esc(name)}（${rs.length} 本）</h2><p>${NOTE[name]}</p></div>
      ${rs.length ? `<div class="tbl" style="margin-bottom:20px"><table><thead><tr><th>収録日</th><th>名前</th><th>会</th><th style="text-align:right">大きさ</th></tr></thead><tbody>
      ${rs.slice(0, 100).map((r) => `<tr class="rw" data-id="${esc(r.id)}" tabindex="0" aria-label="${esc(r.date)} ${esc(r.title)} の詳細を開く"><td class="date">${esc(r.date)}</td><td class="nm">${esc(r.title)}</td><td>${kaiTag(r.kai)}</td><td class="num">${r.size_gb != null ? r.size_gb.toFixed(2) + " GB" : ""}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`).join("")}
    ${tiny.length ? `<div class="bar"><button class="btn" type="button" id="to-ai">消す候補を AI に渡す文をコピー</button></div>` : ""}`;
  }

  // ---------- 詳細 ----------
  function drawer() {
    const r = D && D.rows.find((x) => x.id === sel);
    if (!r) { $("#drawer").hidden = true; $("#scrim").hidden = true; return; }
    const s = r.share;
    $("#drawer").innerHTML = `<div class="dh"><h2 id="d-title">${esc(r.title)}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
    <div class="db">
      <div class="sec"><h3>共有リンク</h3>
      ${s ? `<div class="link"><code>${esc(s.link)}</code><button class="btn sm" type="button" data-copy="${esc(r.id)}">コピー</button></div>
        <div class="row2" style="margin-top:10px">${stLabel(s)}<span class="why">開かれた数 ${s.views}${s.last_viewed_at ? `・最後に開かれた ${esc(s.last_viewed_at.slice(0, 10))}` : ""}</span></div>
        <div class="f" style="margin-top:12px"><label class="tog"><input type="checkbox" id="d-stop" ${s.state === "stop" ? "checked" : ""}> 共有を止める</label></div>
        <div class="f"><label for="d-exp">共有の期限（この日の終わりまで・空で期限なし）</label><input type="date" id="d-exp" value="${esc(s.expires || "")}"></div>
        <a class="btn" href="${esc(s.link)}" target="_blank" rel="noopener">見る画面を別タブで開く ↗</a>`
      : r.issues.includes(ISSUE_ORDER[2]) ? `<div class="issue"><p>画面つきの動画が無いので、リンクを出せません（音声だけなど）。</p></div>`
      : `<div class="issue"><p>まだリンクはありません。発行すると、リンクを知っている人は誰でも見られます（検索には出ません）。</p><button class="btn pri" type="button" data-issue="${esc(r.id)}">リンクを発行してコピー</button></div>`}
      </div>
      <div class="sec"><h3>録画</h3><dl class="meta"><dt>収録日</dt><dd>${esc(r.date)}</dd>${r.minutes != null ? `<dt>長さ</dt><dd>${hm(r.minutes)}</dd>` : ""}<dt>大きさ</dt><dd>${r.size_gb != null ? r.size_gb.toFixed(2) + " GB" : "―"}</dd><dt>YouTube</dt><dd>${r.youtube ? "あり（限定公開）" : "なし"}</dd><dt>名前の正本</dt><dd>${r.managed ? "管理シートの E 列" : "この画面"}</dd>${r.issues.length ? `<dt>点検</dt><dd>${r.issues.map(esc).join("・")}</dd>` : ""}</dl></div>
      <div class="sec"><h3>ラベル</h3>
        <div class="chips">${(r.labels || []).map((l) => `<span class="chip lab-chip">${esc(l)}<button type="button" data-rmlab="${esc(l)}" aria-label="ラベル「${esc(l)}」を外す">✕</button></span>`).join("") || '<span class="why">まだありません</span>'}</div>
        <div class="row2"><input id="d-lab" list="lab-d" placeholder="ラベルを入れて Enter" aria-label="ラベルを追加" class="lab-in">${labDatalist("lab-d")}<button class="btn" type="button" id="d-lab-add">追加</button></div>
        <p class="hint">全角半角・空白・大文字小文字だけ違うものは、同じラベルにまとめます。</p>
      </div>
      <div class="sec"><h3>会の種類と名前</h3>
        <div class="f"><label for="d-kai">会の種類</label><select id="d-kai">${Object.keys(KAI).map((k) => `<option ${k === r.kai ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="f"><label for="d-name">名前</label><input id="d-name" value="${esc(r.title)}" ${r.managed ? "disabled" : ""}>${r.managed ? '<p class="hint">管理シートに行がある録画です。名前はシートの E 列で変えてください（次の 5 分の処理でそろいます）。</p>' : ""}</div>
        <div class="row2"><button class="btn" type="button" id="d-save">編集を保存</button><span class="why">⌘／Ctrl＋Enter でも保存</span></div>
      </div>
    </div>`;
    $("#drawer").hidden = false; $("#scrim").hidden = false;
  }
  function openDetail(id) {
    lastFocus = root.activeElement;
    sel = id; render();
    setTimeout(() => { const f = $("#drawer [data-issue], #drawer [data-copy], #d-close"); f && f.focus(); }, 30);
  }
  function closeDetail() {
    const was = sel;
    sel = null; render();
    const back = was && root.querySelector(`tr[data-id="${CSS.escape(was)}"]`);
    (back || lastFocus)?.focus?.();
  }

  // ---------- 描く ----------
  function setTab(t) { tab = t; sel = null; render(); $("#main").focus(); }
  function render() {
    if (!D) return;
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const nt = D.rows.filter((r) => r.suggest_kai || r.suggest_name).length, nc = D.counts.issues;
    $("#b-tidy").hidden = !nt; $("#b-tidy").textContent = nt;
    $("#b-check").hidden = !nc; $("#b-check").textContent = nc;
    $("#note-top").textContent = `R2 の録画 ${D.total} 本`;
    side();
    // 描き直しても、押したボタン・書いていた欄に戻る（5b）
    const ae = root.activeElement;
    const keepId = ae?.id || null, keepSel = ae?.id === "q" ? ae.selectionStart : null;
    const keepData = !keepId && ae ? ["data-issue", "data-copy", "data-tab", "data-shelf"].map((k) => ae.hasAttribute?.(k) ? `[${k}="${CSS.escape(ae.getAttribute(k))}"]` : "").find(Boolean) : "";
    $("#main").innerHTML = tab === "list" ? listView() : tab === "tidy" ? tidyView() : checkView();
    drawer();
    const back = keepId ? root.getElementById(keepId) : keepData ? root.querySelector(keepData) : null;
    if (back) { back.focus(); if (keepSel !== null) back.setSelectionRange(keepSel, keepSel); }
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ---------- 操作 ----------
  async function issue(id) {
    if (busy) return; busy = true;
    const r = await call("/link", "POST", { id });
    busy = false;
    if (!r.ok) { undo(errText(r), null); return; }
    const ok = await copy(r.link);
    await load();
    undo(r.created ? (ok ? "リンクを発行してコピーしました" : "リンクを発行しました（コピーは詳細から）") : (ok ? "リンクをコピーしました" : "リンクは詳細にあります"), null);
  }
  async function setMeta(items, label, undoItems) {
    const before = undoItems || items.map((m) => { const r = D.rows.find((x) => x.id === m.id); return { id: m.id, ...(m.kai !== undefined ? { kai: r.kai } : {}), ...(m.title !== undefined ? { title: r.title } : {}), ...(m.labels_add ? { labels_remove: m.labels_add.filter((l) => !(r.labels || []).some((x) => lkey(x) === lkey(l))) } : {}) }; });
    const r = await call("/meta", "POST", { items });
    if (!r.done) { undo(r.refused?.[0]?.why || errText(r), null); return; }
    await load();
    undo(`${label}（${r.done} 本）${r.refused?.length ? `・${r.refused.length} 本は変えられませんでした` : ""}`, async () => { await call("/meta", "POST", { items: before }); });
  }

  function addOne() {
    const v = $("#d-lab")?.value.trim();
    if (!v || !sel) { $("#d-lab")?.focus(); return; }
    return setMeta([{ id: sel, labels_add: [v] }], `ラベル「${v}」を追加しました`);
  }
  function addBulk() {
    const v = $("#bulk-l")?.value.trim();
    if (!v) { undo("付けるラベルを入れてください", null); $("#bulk-l")?.focus(); return; }
    const items = [...checked].map((id) => ({ id, labels_add: [v] }));
    checked.clear();
    return setMeta(items, `ラベル「${v}」を追加しました`);
  }
  async function editLabel(body, label, back, had) {
    const r = await call("/labels", "POST", body);
    if (!r.ok) { undo(errText(r), null); return; }
    if (body.action === "delete" && shelf === "L" + body.from) shelf = "all";
    if (body.action === "rename" && shelf === "L" + body.from) shelf = "L" + r.to;
    await load();
    if ($("#ml")) manage(true);
    const fix = back ? async () => { await call("/labels", "POST", { ...back, from: r.to || back.from }); }
      : had ? async () => { await call("/meta", "POST", { items: had.map((id) => ({ id, labels_add: [body.from] })) }); } : null;
    undo(`${label}（${r.changed} 本）`, fix);
  }
  function manage(keep) {
    if (!keep) mlFrom = root.activeElement;
    const ls = allLabels();
    $("#mslot").innerHTML = `<div class="scrim" id="ml-scrim"></div><div class="modal" id="ml" role="dialog" aria-modal="true" aria-labelledby="ml-t">
      <div class="dh"><h2 id="ml-t">ラベルを整える</h2><button class="x" type="button" id="ml-close" aria-label="閉じる">✕</button></div>
      <div class="db">${ls.map(([l, n], i) => `<div class="mlrow"><input id="ren-${i}" value="${esc(l)}" aria-label="ラベル「${esc(l)}」の名前"><span class="c">${n} 本</span><button class="btn sm" type="button" data-mlren="${esc(l)}" data-i="${i}">名前を変える</button><button class="btn sm" type="button" data-mldel="${esc(l)}">削除</button></div>`).join("") || '<p class="lead">まだラベルがありません</p>'}
      <p class="hint">名前を変える・削除は、付いている録画すべてに効きます。「元に戻す」で戻せます。</p></div></div>`;
    if (!keep) setTimeout(() => $("#ml input, #ml button")?.focus(), 30);
  }
  function closeManage() { $("#mslot").innerHTML = ""; mlFrom?.focus?.(); mlFrom = null; }

  root.addEventListener("click", async (e) => {
    const t = e.target;
    const iss = t.closest("[data-issue]"); if (iss) { e.stopPropagation(); return issue(iss.dataset.issue); }
    const cp = t.closest("[data-copy]");
    if (cp) { e.stopPropagation(); const r = D.rows.find((x) => x.id === cp.dataset.copy); const ok = r?.share && (await copy(r.share.link)); undo(ok ? "リンクをコピーしました" : "コピーできませんでした。リンクを選んでコピーしてください", null); return; }
    if (t.id === "fbtn") { const m = $("#fmenu"); m.hidden = !m.hidden; t.setAttribute("aria-expanded", String(!m.hidden)); if (!m.hidden) m.querySelector("button")?.focus(); return; }
    const f = t.closest("[data-f]"); if (f) { filters.has(f.dataset.f) ? filters.delete(f.dataset.f) : filters.add(f.dataset.f); if (f.dataset.f === "yt") filters.delete("noyt"); if (f.dataset.f === "noyt") filters.delete("yt"); render(); $("#fbtn")?.focus(); return; }
    const rf = t.closest("[data-rmf]"); if (rf) { filters.delete(rf.dataset.rmf); render(); return; }
    if (t.closest("[data-rmtx]")) { txIds = null; q = ""; render(); return; }
    if (t.id === "more") { shown += PAGE; render(); return; }
    if (t.id === "d-close" || t.id === "scrim") return closeDetail();
    if (t.id === "d-save") {
      const r = D.rows.find((x) => x.id === sel); if (!r) return;
      const kai = $("#d-kai").value, name = $("#d-name").value.trim();
      const item = { id: r.id };
      if (kai !== r.kai) item.kai = kai;
      if (!r.managed && name && name !== r.title) item.title = name;
      if (Object.keys(item).length === 1) { undo("変わったところはありません", null); return; }
      return setMeta([item], "編集を保存しました");
    }
    if (t.id === "suggest") {
      t.disabled = true; $("#sug-note").textContent = "AI が文字起こしを読んでいます…（1 分ほど）";
      const r = await call("/suggest", "POST", { limit: 8 });
      t.disabled = false;
      if (!r.ok) { $("#sug-note").textContent = errText(r); return; }
      await load();
      $("#sug-note").textContent = `${r.looked} 本を見て、案が出たのは ${r.suggested} 本（残り ${r.remaining} 本）`;
      return;
    }
    if (t.id === "all-k") { $$(".ck-k").forEach((c) => (c.checked = t.checked)); return; }
    if (t.id === "all-n") { $$(".ck-n").forEach((c) => (c.checked = t.checked)); return; }
    if (t.id === "ok-k") {
      const items = $$(".ck-k:checked").map((c) => ({ id: c.dataset.id, kai: root.querySelector(`select[data-k="${CSS.escape(c.dataset.id)}"]`).value }));
      if (!items.length) { undo("承認する録画にチェックを入れてください", null); $(".ck-k")?.focus(); return; }
      return setMeta(items, "会の種類を承認しました");
    }
    if (t.id === "ok-n") {
      const items = $$(".ck-n:checked").map((c) => ({ id: c.dataset.id, title: D.rows.find((x) => x.id === c.dataset.id).suggest_name }));
      if (!items.length) { undo("そろえる録画にチェックを入れてください", null); $(".ck-n")?.focus(); return; }
      return setMeta(items, "名前をそろえました");
    }
    if (t.id === "to-ai") { const ok = await copy("マーケくんの録画の点検にある「1 分未満・ほぼ空」の録画を zoom_archive__search で一覧にして、消す候補の下見を出して。消すのは私が決める"); undo(ok ? "AI に渡す文をコピーしました" : "コピーできませんでした", null); return; }
    const ck = t.closest("[data-ck]"); if (ck) { e.stopPropagation(); ck.checked ? checked.add(ck.dataset.ck) : checked.delete(ck.dataset.ck); render(); return; }
    if (t.id === "ck-all") { rows().slice(0, shown).forEach((r) => (t.checked ? checked.add(r.id) : checked.delete(r.id))); render(); return; }
    if (t.id === "bulk-clear") { checked.clear(); render(); return; }
    if (t.id === "bulk-add") return addBulk();
    if (t.id === "d-lab-add") return addOne();
    const rl = t.closest("[data-rmlab]"); if (rl) { const l = rl.dataset.rmlab; return setMeta([{ id: sel, labels_remove: [l] }], `ラベル「${l}」を外しました`, [{ id: sel, labels_add: [l] }]); }
    if (t.id === "manage-l") { e.stopPropagation(); return manage(); }
    const mr = t.closest("[data-mlren]"); if (mr) { const from = mr.dataset.mlren, to = root.getElementById("ren-" + mr.dataset.i).value.trim(); if (!to || to === from) return; return editLabel({ action: "rename", from, to }, `「${from}」の名前を変えました`, { action: "rename", from: to, to: from }); }
    const md = t.closest("[data-mldel]"); if (md) { const l = md.dataset.mldel; const had = D.rows.filter((r) => (r.labels || []).includes(l)).map((r) => r.id); return editLabel({ action: "delete", from: l }, `ラベル「${l}」を削除しました`, null, had); }
    if (t.id === "ml-close" || t.id === "ml-scrim") return closeManage();
    const op = t.closest("[data-open]"); if (op) { e.stopPropagation(); return openDetail(op.dataset.open); }
    const tr = t.closest("tr.rw[data-id]"); if (tr) return openDetail(tr.dataset.id);
    if (!t.closest(".pop")) { const m = $("#fmenu"); if (m && !m.hidden) { m.hidden = true; $("#fbtn").setAttribute("aria-expanded", "false"); } }
  });

  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "intx") { inTx = t.checked; txIds = null; render(); $("#q")?.focus(); return; }
    const r = D.rows.find((x) => x.id === sel);
    if (!r || !r.share) return;
    if (t.id === "d-stop") {
      const was = r.share.state === "stop";
      const res = await call("/share", "POST", { id: r.id, stopped: t.checked });
      if (!res.ok) { undo(errText(res), null); return; }
      await load();
      undo(t.checked ? "共有を止めました（次に開いた人から見られません）" : "共有を再開しました", async () => { await call("/share", "POST", { id: r.id, stopped: was }); });
    }
    if (t.id === "d-exp") {
      const was = r.share.expires || "";
      const res = await call("/share", "POST", { id: r.id, expires: t.value || "" });
      if (!res.ok) { undo(errText(res), null); return; }
      await load();
      undo(t.value ? `期限を ${t.value} にしました` : "期限を外しました", async () => { await call("/share", "POST", { id: r.id, expires: was }); });
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.id === "q" && !inTx) { q = e.target.value.trim(); shown = PAGE; render(); }
    if (e.target.id === "q" && inTx) q = e.target.value.trim();
  });

  // Esc は窓の外にフォーカスがあっても効くように、ページ全体で受ける（録画の画面が出ているときだけ）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.composedPath().includes(host) || !host.isConnected || host.offsetParent === null) return;
    if ($("#ml")) { closeManage(); return; }
    const m = $("#fmenu");
    if (m && !m.hidden) { m.hidden = true; $("#fbtn").setAttribute("aria-expanded", "false"); return; }
    if (sel) closeDetail();
  });
  root.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.id === "d-lab") { e.preventDefault(); return addOne(); }
    if (e.key === "Enter" && e.target.id === "bulk-l") { e.preventDefault(); return addBulk(); }
    if (e.key === "Escape" && $("#ml")) { e.stopPropagation(); return closeManage(); }
    if (e.key === "Escape") {
      const m = $("#fmenu");
      if (m && !m.hidden) { m.hidden = true; $("#fbtn").setAttribute("aria-expanded", "false"); $("#fbtn").focus(); return; }
      if (sel) { closeDetail(); return; }
    }
    if (e.key === "Enter" && e.target.id === "q" && inTx) {
      e.preventDefault();
      if (!q) { txIds = null; render(); return; }
      say("文字起こしの中を探しています");
      const r = await call("/search?q=" + encodeURIComponent(q));
      if (!r.ok) { undo(errText(r), null); return; }
      txIds = new Set(r.ids); shown = PAGE; render();
      say(`文字起こしに「${q}」がある録画は ${r.ids.length} 本`);
      return;
    }
    if (e.key === "Enter" && e.target.matches?.("tr.rw")) { openDetail(e.target.dataset.id); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.id === "d-name") { $("#d-save").click(); return; }
    // 詳細の窓の中で Tab を回す
    if (e.key === "Tab" && sel) {
      const f = [...$("#drawer").querySelectorAll("button,input,select,a[href]")].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
  });

  return { open: () => { if (!D) load(); else render(); } };
}

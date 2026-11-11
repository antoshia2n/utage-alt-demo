// 録画（2026-11-06 Naoki「R2 の動画を整理されて、あとで共有リンクを発行しやすくしておきたい」→ デモに OK 14:21・置き場 15:02 OK）
//  ・シアニン用の画面（admin.html）の「録画」の中に、影の DOM で入れる（会員サイトと同じ。見た目と id が今の画面とぶつからないため）
//  ・中身と共有リンクの正本は zoom-to-youtube（R2）。ここは /api/admin/recordings* を呼ぶだけ。書いたら読み直して描き直す
//  ・上の帯：棚（一覧とリンクの発行）／整理（会の種類の案・名前をそろえる）／点検（日付が合わない・ほぼ空・流せる動画が無い）
//  ・出し先のスイッチ（2026-11-12 Naoki OK）：詳細の「出し先」で YouTube・会員サイトを入り切り。上の帯の「出し先の決まり」で会の種類ごとの入れ先
//  ・便 C（2026-11-06 Naoki OK 19:47）：上の帯の「アップロード」から Zoom 以外の動画・音声を入れる。16MB ずつ送り、切れたら続きから
import { api } from "/js/common.js";

const KAI = { "セミナー": "#2563eb", "打ち合わせ": "#7c3aed", "個別相談": "#0d9488", "Zoom添削": "#db2777", "その他": "#a39a90" };
const ISSUE_ORDER = ["名前の日付と収録日が合わない", "ほぼ空（1 分未満か 10MB 未満）", "見る画面で流せる動画が無い（音声だけなど）", "同じ名前の録画がほかにもある"];
const lkey = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const ERR = {
  not_found: "録画が見つかりませんでした（削除されたかもしれません）",
  no_video: "この録画には見る画面で流せる動画がありません（音声だけなど）",
  no_link: "先にリンクを発行してください",
  bad_date: "期限の日付が読めませんでした",
  no_binding: "録画の保管（zoom-to-youtube）につながっていません",
  no_ai: "AI が使えませんでした",
  bad_type: "この種類のファイルは入れられません（mp4・mov・m4v・webm・m4a・mp3・wav）",
  too_big: "4GB までのファイルにしてください",
  missing_parts: "送れていない片があります。「続きから送る」を押してください",
  youtube_not_possible: "YouTube へ上げられるのは、11/02 以降に Zoom で録った録画だけです",
  bad_course: "コースが見つかりませんでした。選び直してください",
  bad_kai: "会の種類が読めませんでした",
};
const UP_EXT = ["mp4", "mov", "m4v", "webm", "m4a", "mp3", "wav"];
const UP_PART = 16 * 1024 * 1024;
const PAGE = 200;

export function mountRecordings(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <div class="top" role="tablist" aria-label="録画の機能">
    <button class="tab" role="tab" type="button" data-tab="list" aria-selected="true">棚</button>
    <button class="tab" role="tab" type="button" data-tab="tidy" aria-selected="false">整理<span class="badge" id="b-tidy" hidden></span></button>
    <button class="tab" role="tab" type="button" data-tab="check" aria-selected="false">点検<span class="badge" id="b-check" hidden></span></button>
    <span class="grow"></span><span class="note-top" id="note-top"></span>
    <button class="btn sm" type="button" id="rt-open">出し先の決まり</button>
    <button class="btn sm pri up-btn" type="button" id="up-open">アップロード</button>
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
  // 便B（2026-11-06）：会員サイトに入れた録画（コンテンツとコース）
  let placed = [], smFrom = null, smData = null;
  // 出し先のスイッチ（2026-11-12）：会の種類ごとの入れ先と、選べるコース
  let RC = { courses: {}, course_list: [], from: "" }, rtFrom = null;
  const courseName = (id) => { const c = RC.course_list.find((x) => x.id === id); return c ? c.path : ""; };
  const placedOf = (id) => placed.filter((p) => p.rec_id === id);
  // 便 A：ラベルの一覧（多い順）
  const allLabels = () => { const m = new Map(); D.rows.forEach((r) => (r.labels || []).forEach((l) => m.set(l, (m.get(l) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")); };
  const labDatalist = (id) => `<datalist id="${id}">${allLabels().map(([l]) => `<option value="${esc(l)}">`).join("")}</datalist>`;

  async function load() {
    const [r, m, rc] = await Promise.all([call(""), call("/member"), call("/route-config")]);
    if (m && m.ok) placed = m.placed || [];
    if (rc && rc.ok) RC = rc;
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
      if (filters.has("up") && r.kind !== "upload") return false;
      if (inTx && txIds) { if (!txIds.has(r.id)) return false; }
      else if (words.length && !words.every((w) => r.title.includes(w))) return false;
      return true;
    });
  }
  const FILTERS = { yt: "YouTube あり", noyt: "YouTube なし", sheet: "管理シートにある録画", up: "アップロードしたもの" };
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
    ${checked.size ? `<div class="bulk" role="region" aria-label="まとめて"><b>${checked.size} 本を選択中</b><input id="bulk-l" list="lab-a" placeholder="ラベルを入れて Enter" aria-label="選んだ録画に付けるラベル">${labDatalist("lab-a")}<button class="btn sm pri" type="button" id="bulk-add">ラベルを追加</button>
      <span class="sep" aria-hidden="true"></span><select id="bulk-k" class="mini" aria-label="選んだ録画の会の種類">${Object.keys(KAI).map((k) => `<option>${k}</option>`).join("")}</select><button class="btn sm pri" type="button" id="bulk-kai">会の種類を変える</button>
      <button class="btn sm" type="button" id="bulk-clear">選択を外す</button></div>` : ""}
    <div class="chips">${[...filters].map((f) => `<span class="chip">${FILTERS[f]}<button type="button" data-rmf="${f}" aria-label="「${FILTERS[f]}」を外す">✕</button></span>`).join("")}${inTx && txIds ? `<span class="chip">文字起こしに「${esc(q)}」<button type="button" data-rmtx aria-label="文字起こしの絞り込みを外す">✕</button></span>` : ""}</div>
    <div class="tbl list"><table><thead><tr><th><input type="checkbox" id="ck-all" aria-label="表に出ている録画を全部選ぶ" ${page.length && page.every((r) => checked.has(r.id)) ? "checked" : ""}></th><th>収録日</th><th>名前</th><th>会</th><th style="text-align:right">長さ</th><th>YouTube</th><th>共有リンク</th><th style="text-align:right">開かれた数</th><th><span class="sr">操作</span></th></tr></thead><tbody>
    ${page.map((r) => `<tr class="rw ${sel === r.id ? "sel" : ""}" data-id="${esc(r.id)}" tabindex="0" aria-label="${esc(r.date)} ${esc(r.title)} の詳細を開く">
      <td class="hide-sp"><input type="checkbox" class="ck" data-ck="${esc(r.id)}" ${checked.has(r.id) ? "checked" : ""} aria-label="「${esc(r.title)}」を選ぶ"></td>
      <td class="date">${esc(r.date)}</td><td class="nm">${esc(r.title)}${r.kind === "upload" ? '<span class="upl">アップロード</span>' : ""}${placedOf(r.id).length ? `<span class="insite">会員サイト ${placedOf(r.id).length}</span>` : ""}${pending(r) ? `<span class="upl">予定：${esc(pending(r))}</span>` : ""}${(r.labels || []).length ? `<span class="labs">${r.labels.map((l) => `<span class="lab">${esc(l)}</span>`).join("")}</span>` : ""}${r.issues.length ? `<small>点検：${esc(r.issues[0])}</small>` : ""}</td><td class="hide-sp">${kaiTag(r.kai)}</td>
      <td class="num hide-sp">${hm(r.minutes) || (r.size_gb != null ? r.size_gb.toFixed(2) + " GB" : "")}</td><td class="hide-sp" style="font-size:12px;color:var(--muted)">${r.youtube ? "あり" : "―"}</td>
      <td>${stLabel(r.share)}</td><td class="num hide-sp">${r.share ? r.share.views : ""}</td><td>${act(r)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">合う録画がありません</td></tr>`}
    </tbody></table>${rs.length > shown ? `<div class="more"><button class="btn" type="button" id="more">さらに ${Math.min(PAGE, rs.length - shown)} 本を出す（残り ${rs.length - shown} 本）</button></div>` : ""}</div>`;
  }

  // ---------- 整理 ----------
  function tidyView() {
    const ks = D.rows.filter((r) => r.suggest_kai), ns = D.rows.filter((r) => r.suggest_name);
    const left = D.rows.filter((r) => r.kai === "その他").length;
    return `<h1>整理</h1><p class="lead">案を見て、まとめて承認するだけ。承認しないものはそのまま残ります。承認したあとも「元に戻す」で戻せます。</p>
    <div class="card"><h2>会の種類の案（「その他」${left} 本）</h2><p>5 分ごとに AI が 6 本ずつ文字起こしを読んで案を出しています（文字起こしがある録画だけ）。違うものは右の選びから編集してから承認します。</p>
      ${(() => { const pend = D.counts.sug_pending || 0, done = Math.max(0, left - pend), pct = left ? Math.round((done / left) * 100) : 100; return `<div class="prog" role="progressbar" aria-label="案の進み具合" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
      <p style="margin-top:6px">読み終えた ${done} 本／残り ${pend} 本${pend ? `（あと約 ${Math.ceil(pend / 6) * 5} 分）` : ""}${D.counts.sug_none ? `・案が出ない ${D.counts.sug_none} 本（文字起こしが無いなど。棚の「その他」で選んで「会の種類を変える」でまとめて変えられます）` : ""}</p>`; })()}
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
      [ISSUE_ORDER[0]]: "別の回の名前や YouTube が付いている見込み。行を押して名前を編集します。",
      [ISSUE_ORDER[1]]: "録り間違いの見込み。削除するかどうかは Naoki が決めます（削除するのは AI との壁打ちのあと・zoom_archive__delete）。",
      [ISSUE_ORDER[2]]: "画面つきの動画が無いので、共有リンクを出せません。",
      [ISSUE_ORDER[3]]: "会員サイトに入れるときや共有のときに取り違えやすい録画です。収録日と中身を見て、片方の名前を編集します。",
    };
    return `<h1>点検</h1><p class="lead">怪しいものを集めました。ここでは何も消しません。</p>
    ${groups.map(([name, rs]) => `<div class="card"><h2>${esc(name)}（${rs.length} 本）</h2><p>${NOTE[name]}</p></div>
      ${rs.length ? `<div class="tbl" style="margin-bottom:20px"><table><thead><tr><th>収録日</th><th>名前</th><th>会</th><th style="text-align:right">大きさ</th></tr></thead><tbody>
      ${rs.slice(0, 100).map((r) => `<tr class="rw" data-id="${esc(r.id)}" tabindex="0" aria-label="${esc(r.date)} ${esc(r.title)} の詳細を開く"><td class="date">${esc(r.date)}</td><td class="nm">${esc(r.title)}</td><td>${kaiTag(r.kai)}</td><td class="num">${r.size_gb != null ? r.size_gb.toFixed(2) + " GB" : ""}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`).join("")}
    ${tiny.length ? `<div class="bar"><button class="btn" type="button" id="to-ai">削除候補を AI に渡す文をコピー</button></div>` : ""}`;
  }

  // ---------- 出し先のスイッチ（2026-11-12） ----------
  function pending(r) {
    const rt = r.route; if (!rt) return "";
    const p = [];
    if (rt.youtube && !r.youtube) p.push("YouTube");
    if (rt.site && !rt.done_at) p.push("会員サイト");
    return p.join("・");
  }
  function routeSec(r) {
    const rt = r.route;
    if (!rt) return "";
    const def = RC.courses[r.kai] || "";
    const course = rt.course_id || def;
    let state = "";
    if (rt.site) {
      if (rt.done_at) state = `<p class="why">会員サイトに入れました（${esc(rt.done_at.slice(0, 16).replace("T", " "))}・メールで知らせました）。公開は下の「会員サイト」から。</p>`;
      else if (rt.youtube && rt.youtube_possible && !r.youtube_url) state = '<p class="why">YouTube に上がってから、YouTube の埋め込みで会員サイトに入れます（YouTube へは 5 分ごとの処理が上げます）。</p>';
      else if (!course || !courseName(course)) state = '<p class="warn">入れ先のコースが決まっていません。下で選ぶか、上の「出し先の決まり」で会の種類ごとのコースを決めてください。</p>';
      else state = '<div class="row2"><span class="why">1 時間以内に下書きで入れて、メールで知らせます。</span><button class="btn sm" type="button" id="d-rt-run">今すぐ入れる</button></div>';
    } else if (rt.youtube && !r.youtube) state = '<p class="why">次の 5 分の処理で YouTube に限定公開で上げます。</p>';
    return `<div class="sec"><h3>出し先</h3>
      <div class="f"><label class="tog"><input type="checkbox" id="d-yt" ${rt.youtube ? "checked" : ""} ${rt.youtube_possible ? "" : "disabled"}> YouTube に上げる（限定公開）</label>
        ${r.youtube ? '<p class="hint">YouTube に上がっています。</p>' : rt.youtube_possible ? "" : '<p class="hint">YouTube へ上げられるのは、11/02 以降に Zoom で録った録画だけです。</p>'}</div>
      <div class="f"><label class="tog"><input type="checkbox" id="d-in" ${rt.site ? "checked" : ""} ${r.issues.includes(ISSUE_ORDER[2]) ? "disabled" : ""}> 会員サイトに入れる（下書き）</label></div>
      ${rt.site ? `<div class="f"><label for="d-course">入れるコース</label><select id="d-course"><option value="">会の種類の決まり（${esc(def ? courseName(def) || "見つからないコース" : "未設定")}）</option>${RC.course_list.map((c) => `<option value="${esc(c.id)}" ${rt.course_id === c.id ? "selected" : ""}>${esc(c.path)}</option>`).join("")}</select></div>` : ""}
      ${state}
      <p class="hint">${rt.auto ? `会の種類から決めた値です（${esc(RC.from || "")} 以降に録ったセミナーは両方オン・ほかはオフ）。` : '手で変えた値です。<button type="button" class="mini-link" id="d-rt-reset">会の種類の決まりに戻す</button>'}</p>
    </div>`;
  }
  async function setRoute(id, body, label) {
    const r = await call("/route", "POST", { id, ...body });
    if (!r.ok) { undo(errText(r), null); return; }
    await load();
    undo(label, null);
  }
  function openRoute() {
    rtFrom = root.activeElement;
    const kais = RC.kais || Object.keys(KAI);
    $("#mslot").innerHTML = `<div class="scrim" id="rt-scrim"></div><div class="modal" id="rt" role="dialog" aria-modal="true" aria-labelledby="rt-t">
      <div class="dh"><h2 id="rt-t">出し先の決まり</h2><button class="x" type="button" id="rt-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        <p class="hint">「会員サイトに入れる」がオンの録画を、会の種類ごとに決めたコースへ下書きで入れます。録画ごとに別のコースも選べます。</p>
        ${kais.map((k) => `<div class="f"><label for="rt-${esc(k)}">${esc(k)}</label><select id="rt-${esc(k)}" data-rtk="${esc(k)}"><option value="">決めない</option>${RC.course_list.map((c) => `<option value="${esc(c.id)}" ${RC.courses[k] === c.id ? "selected" : ""}>${esc(c.path)}</option>`).join("")}</select></div>`).join("")}
        <p class="hint">${esc(RC.from || "")} 以降に録ったセミナーは、最初から YouTube も会員サイトもオンです。ほかの会と、それより前の録画はオフから始まります。</p>
        <div class="row2"><button class="btn" type="button" id="rt-cancel">キャンセル</button><button class="btn pri" type="button" id="rt-save">保存</button></div>
      </div></div>`;
    setTimeout(() => $("#rt select")?.focus(), 30);
  }
  function closeRoute() { $("#mslot").innerHTML = ""; rtFrom?.focus?.(); rtFrom = null; }

  // ---------- 詳細 ----------
  function drawer() {
    const r = D && D.rows.find((x) => x.id === sel);
    if (!r) { $("#drawer").hidden = true; $("#scrim").hidden = true; return; }
    const s = r.share;
    $("#drawer").innerHTML = `<div class="dh"><h2 id="d-title">${esc(r.title)}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
    <div class="db">
      ${routeSec(r)}
      <div class="sec"><h3>共有リンク</h3>
      ${s ? `<div class="link"><code>${esc(s.link)}</code><button class="btn sm" type="button" data-copy="${esc(r.id)}">コピー</button></div>
        <div class="row2" style="margin-top:10px">${stLabel(s)}<span class="why">開かれた数 ${s.views}${s.last_viewed_at ? `・最後に開かれた ${esc(s.last_viewed_at.slice(0, 10))}` : ""}</span></div>
        <div class="f" style="margin-top:12px"><label class="tog"><input type="checkbox" id="d-stop" ${s.state === "stop" ? "checked" : ""}> 共有を止める</label></div>
        <div class="f"><label for="d-exp">共有の期限（この日の終わりまで・空で期限なし）</label><input type="date" id="d-exp" value="${esc(s.expires || "")}"></div>
        <a class="btn" href="${esc(s.link)}" target="_blank" rel="noopener">見る画面を別タブで開く ↗</a>`
      : r.issues.includes(ISSUE_ORDER[2]) ? `<div class="issue"><p>画面つきの動画が無いので、リンクを出せません（音声だけなど）。</p></div>`
      : `<div class="issue"><p>まだリンクはありません。発行すると、リンクを知っている人は誰でも見られます（検索には出ません）。</p><button class="btn pri" type="button" data-issue="${esc(r.id)}">リンクを発行してコピー</button></div>`}
      </div>
      <div class="sec"><h3>会員サイト</h3>
        ${placedOf(r.id).map((p) => `<div class="site-in"><span>${esc(p.path)} › ${esc(p.title)}</span><span class="st ${p.status === "published" ? "on" : ""}">${p.status === "published" ? "● 公開中" : "下書き"}</span>${p.status === "published" ? "" : `<button class="btn sm pri" type="button" data-pub="${esc(p.content_id)}" aria-label="「${esc(p.title)}」を公開する">公開する</button>`}</div>`).join("") || '<p class="why" style="margin:0 0 8px">まだどのコースにも入っていません。</p>'}
        ${r.issues.includes(ISSUE_ORDER[2]) ? "" : `<button class="btn ${placedOf(r.id).length ? "" : "pri"}" type="button" id="d-site">${placedOf(r.id).length ? "別のコースにも入れる" : "会員サイトに入れる"}</button>`}
        <p class="hint">会員サイトでは、会員のログインと権利を確かめてから流します。共有リンクとは別で、外へ持ち出せるリンクは作りません。</p>
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
  async function openSite() {
    const r = D.rows.find((x) => x.id === sel); if (!r) return;
    smFrom = root.activeElement;
    const m = await call("/member?id=" + encodeURIComponent(r.id));
    if (!m.ok) { undo(errText(m), null); return; }
    if (!m.courses.length) { undo("会員サイトにコースがありません。先に会員サイトの画面でコースを作ってください", null); return; }
    smData = m;
    const pathNote = (c) => `${esc(c.path)}${c.rights.length ? `（見られる権利：${c.rights.map(esc).join("・")}）` : "（見られる権利がまだありません）"}`;
    $("#mslot").innerHTML = `<div class="scrim" id="sm-scrim"></div><div class="modal" id="sm" role="dialog" aria-modal="true" aria-labelledby="sm-t">
      <div class="dh"><h2 id="sm-t">会員サイトに入れる</h2><button class="x" type="button" id="sm-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        <div class="f"><label for="sm-course">入れるコース</label><select id="sm-course">${m.courses.map((c) => `<option value="${esc(c.id)}">${esc(c.path.split(" › ").pop())}</option>`).join("")}</select><p class="hint" id="sm-path">${pathNote(m.courses[0])}</p></div>
        <div class="sm-rec"><b>入れる録画</b><span>${esc(r.date)}・${esc(r.kai)}${r.minutes != null ? "・" + hm(r.minutes) : ""}</span></div>
        ${r.issues.includes(ISSUE_ORDER[3]) ? `<p class="warn">同じ名前の録画がほかにもあります。収録日と会の種類がこの回で合っているか確かめてください。</p>` : ""}
        <div class="f"><label for="sm-title">コンテンツの名前（生徒に見える名前）</label><input id="sm-title" value="${esc(m.info.title)}"></div>
        <div class="f"><label for="sm-pub">公開</label><select id="sm-pub"><option value="draft">下書きで入れる（会員サイトの画面で確かめてから公開）</option><option value="published">すぐ公開する</option></select></div>
        <p class="hint">要約と目次は録画からコピーします（会員サイトの画面であとから編集できます）。話者の名前は伏せたまま出します。</p>
        <div class="row2"><button class="btn" type="button" id="sm-cancel">キャンセル</button><button class="btn pri" type="button" id="sm-go">入れる</button></div>
      </div></div>`;
    $("#sm-course").addEventListener("change", (e) => { const c = smData.courses.find((x) => x.id === e.target.value); $("#sm-path").innerHTML = pathNote(c); });
    setTimeout(() => $("#sm-course")?.focus(), 30);
  }
  function closeSite() { $("#mslot").innerHTML = ""; smData = null; (root.getElementById("d-site") || smFrom)?.focus?.(); smFrom = null; }
  async function putSite() {
    if (busy || !sel) return;
    const title = $("#sm-title").value.trim();
    if (!title) { undo("コンテンツの名前を入れてください", null); $("#sm-title").focus(); return; }
    const status = $("#sm-pub").value, course = $("#sm-course").selectedOptions[0].textContent;
    busy = true; $("#sm-go").disabled = true;
    const r = await call("/member", "POST", { id: sel, course_id: $("#sm-course").value, title, status });
    busy = false;
    if (!r.ok) { $("#sm-go").disabled = false; undo(errText(r), null); return; }
    closeSite();
    await load();
    root.getElementById("d-site")?.focus();
    undo(status === "published" ? `「${course}」に入れて公開しました` : `「${course}」に下書きで入れました（会員サイトの画面で公開してください）`, null);
  }
  function closeManage() { $("#mslot").innerHTML = ""; mlFrom?.focus?.(); mlFrom = null; }

  // ---------- 便 C：アップロード ----------
  let upFrom = null, upFile = null, upState = null; // upState：{ id, total, done:Set, running, stop }
  const jstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const mb = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : Math.max(0.1, n / 1048576).toFixed(1) + " MB");
  function openUpload() {
    if ($("#up")) { $("#up-file")?.focus(); return; }
    upFrom = root.activeElement;
    $("#mslot").innerHTML = `<div class="scrim" id="up-scrim"></div><div class="modal" id="up" role="dialog" aria-modal="true" aria-labelledby="up-t">
      <div class="dh"><h2 id="up-t">動画・音声をアップロード</h2><button class="x" type="button" id="up-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        <div class="f"><label for="up-file">ファイル（mp4・mov・m4v・webm・m4a・mp3・wav・4GB まで）</label><input type="file" id="up-file" accept="${UP_EXT.map((e) => "." + e).join(",")},video/*,audio/*"><p class="hint" id="up-fnote">Zoom 以外で撮った動画や音声を、録画の棚に並べます。文字起こしは付きません。</p></div>
        <div class="f"><label for="up-date">収録日</label><input type="date" id="up-date"></div>
        <div class="f"><label for="up-title">名前</label><input id="up-title" placeholder="例：2026-11-05｜セミナー｜話題"></div>
        <div class="f"><label for="up-kai">会の種類</label><select id="up-kai">${Object.keys(KAI).map((k) => `<option${k === "その他" ? " selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="f"><label for="up-lab">ラベル（任意・読点で区切ると複数）</label><input id="up-lab" list="lab-u">${labDatalist("lab-u")}</div>
        <div id="up-prog" hidden><div class="prog" role="progressbar" aria-label="アップロードの進み具合" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="up-bar" style="width:0%"></div></div><p class="hint" id="up-ptext" aria-live="polite"></p></div>
        <p class="warn" id="up-err" hidden></p>
        <div class="row2"><button class="btn" type="button" id="up-cancel">キャンセル</button><button class="btn pri" type="button" id="up-go">アップロード</button></div>
      </div></div>`;
    setTimeout(() => $("#up-file")?.focus(), 30);
  }
  function upError(t) { const e = $("#up-err"); if (e) { e.hidden = !t; e.textContent = t || ""; } }
  function closeUpload() {
    if (upState && upState.running) { upError("送っている途中です。やめるときは「中止」を押してください（閉じると送るのが止まります）"); $("#up-cancel")?.focus(); return; }
    $("#mslot").innerHTML = ""; upFile = null; upState = null; window.removeEventListener("beforeunload", upLeave); upFrom?.focus?.(); upFrom = null;
  }
  function upLeave(e) { if (upState && upState.running) { e.preventDefault(); e.returnValue = ""; } }
  function upProgress() {
    if (!upState) return;
    const pct = Math.floor((upState.done.size / upState.total) * 100);
    $("#up-prog").hidden = false;
    $("#up-bar").style.width = pct + "%";
    root.querySelector("#up-prog .prog").setAttribute("aria-valuenow", String(pct));
    $("#up-ptext").textContent = `${pct}%（${upState.done.size} / ${upState.total} 片・${mb(upFile.size)}）。画面を閉じずにお待ちください`;
  }
  async function putPart(n) {
    const start = (n - 1) * UP_PART, blob = upFile.slice(start, Math.min(upFile.size, start + UP_PART));
    for (let tries = 0; tries < 3; tries++) {
      try {
        const res = await fetch(`/api/admin/recordings/upload/part?id=${encodeURIComponent(upState.id)}&n=${n}`, { method: "PUT", headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/octet-stream" }, body: blob });
        const d = await res.json().catch(() => ({ ok: false, error: "bad_response" }));
        if (d.ok) return true;
        if (["not_found", "already_done", "bad_part", "bad_length"].includes(d.error)) throw Object.assign(new Error(d.note || d.error), { fatal: true });
      } catch (e) { if (e.fatal) throw e; }
      await new Promise((r) => setTimeout(r, 1500 * (tries + 1)));
    }
    return false;
  }
  async function startUpload() {
    if (upState && upState.running) return;
    upError("");
    if (!upFile) { upError("ファイルを選んでください"); $("#up-file").focus(); return; }
    const date = $("#up-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { upError("収録日を入れてください"); $("#up-date").focus(); return; }
    const labels = $("#up-lab").value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    const r = await call("/upload/start", "POST", { file_name: upFile.name, size: upFile.size, date, title: $("#up-title").value.trim(), kai: $("#up-kai").value, labels });
    if (!r.ok) { upError(errText(r)); return; }
    upState = { id: r.id, total: r.parts_total, done: new Set(r.parts_done || []), running: true, stop: false };
    window.addEventListener("beforeunload", upLeave);
    $("#up-go").textContent = "送っています…"; $("#up-cancel").textContent = "中止";
    upProgress();
    if (r.resumed && r.parts_done?.length) say(`前に送った続き（${r.parts_done.length} 片）から送ります`);
    for (let n = 1; n <= upState.total; n++) {
      if (upState.stop) break;
      if (upState.done.has(n)) continue;
      let ok = false;
      try { ok = await putPart(n); } catch (e) { upState.running = false; upError("送れませんでした：" + e.message); $("#up-go").textContent = "続きから送る"; return; }
      if (!ok) { upState.running = false; upError("回線が切れたようです。「続きから送る」で、送れたところの続きから送ります"); $("#up-go").textContent = "続きから送る"; $("#up-go").focus(); return; }
      upState.done.add(n); upProgress();
    }
    if (upState.stop) return;
    const c = await call("/upload/complete", "POST", { id: upState.id });
    upState.running = false;
    if (!c.ok) { upError(errText(c)); $("#up-go").textContent = "続きから送る"; return; }
    const title = $("#up-title").value.trim() || upFile.name;
    upState = null; closeUpload();
    shelf = "all"; filters.add("up");
    await load();
    undo(`「${title}」をアップロードしました（棚に「アップロード」で並びます）`, null);
  }
  async function abortUpload() {
    if (!upState || !upState.running) return closeUpload();
    upState.stop = true; upState.running = false;
    await call("/upload/abort", "POST", { id: upState.id });
    upState = null; closeUpload();
    undo("アップロードを中止しました（送った分は捨てました）", null);
  }
  root.addEventListener("change", (e) => {
    if (e.target.id !== "up-file") return;
    upFile = e.target.files?.[0] || null; upError("");
    if (!upFile) return;
    const ext = (upFile.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
    if (!UP_EXT.includes(ext)) { upError(ERR.bad_type); upFile = null; return; }
    if (upFile.size > 4 * 1073741824) { upError(ERR.too_big); upFile = null; return; }
    $("#up-fnote").textContent = `${upFile.name}（${mb(upFile.size)}）`;
    if (!$("#up-date").value) $("#up-date").value = jstDate(upFile.lastModified || Date.now());
    if (!$("#up-title").value) $("#up-title").value = upFile.name.replace(/\.[^.]+$/, "");
  });

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
    if (t.id === "d-site") return openSite();
    if (t.id === "rt-open") return openRoute();
    if (t.id === "rt-close" || t.id === "rt-cancel" || t.id === "rt-scrim") return closeRoute();
    if (t.id === "rt-save") {
      const courses = {}; $$("#rt [data-rtk]").forEach((x) => (courses[x.dataset.rtk] = x.value || null));
      const r = await call("/route-config", "POST", { courses });
      if (!r.ok) { undo(errText(r), null); return; }
      closeRoute(); await load(); undo("出し先の決まりを保存しました", null); return;
    }
    if (t.id === "d-rt-reset") return setRoute(sel, { reset: true }, "会の種類の決まりに戻しました");
    if (t.id === "d-rt-run") {
      if (busy) return; busy = true; t.disabled = true;
      const r = await call("/route-run", "POST", {});
      busy = false;
      if (!r.ok) { t.disabled = false; undo(errText(r), null); return; }
      await load();
      undo(r.put ? `会員サイトに ${r.put} 本入れて、メールで知らせました` : r.already ? "すでに入っていました（印を付けました）" : "いま入れられる録画はありませんでした", null); return;
    }
    const pb = t.closest("[data-pub]");
    if (pb) {
      const r = await call("/publish", "POST", { content_id: pb.dataset.pub });
      if (!r.ok) { undo(errText(r), null); return; }
      await load();
      undo("公開しました（生徒の画面に出ます）", async () => { await call("/publish", "POST", { content_id: pb.dataset.pub, status: "draft" }); }); return;
    }
    if (t.id === "sm-close" || t.id === "sm-cancel" || t.id === "sm-scrim") return closeSite();
    if (t.id === "sm-go") return putSite();
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
    if (t.id === "to-ai") { const ok = await copy("マーケくんの録画の点検にある「1 分未満・ほぼ空」の録画を zoom_archive__search で一覧にして、削除候補の下見を出して。削除するのは私が決める"); undo(ok ? "AI に渡す文をコピーしました" : "コピーできませんでした", null); return; }
    const ck = t.closest("[data-ck]"); if (ck) { e.stopPropagation(); ck.checked ? checked.add(ck.dataset.ck) : checked.delete(ck.dataset.ck); render(); return; }
    if (t.id === "ck-all") { rows().slice(0, shown).forEach((r) => (t.checked ? checked.add(r.id) : checked.delete(r.id))); render(); return; }
    if (t.id === "bulk-clear") { checked.clear(); render(); return; }
    if (t.id === "bulk-kai") {
      // 2026-11-06：文字起こしの無い「その他」は AI の案が出ないので、棚でまとめて変える（Naoki OK 18:15）
      const k = $("#bulk-k").value;
      const items = [...checked].filter((id) => D.rows.find((r) => r.id === id)?.kai !== k).map((id) => ({ id, kai: k }));
      if (!items.length) { undo(`選んだ録画はもう「${k}」です`, null); return; }
      checked.clear();
      return setMeta(items, `会の種類を「${k}」に変えました`);
    }
    if (t.id === "bulk-add") return addBulk();
    if (t.id === "d-lab-add") return addOne();
    const rl = t.closest("[data-rmlab]"); if (rl) { const l = rl.dataset.rmlab; return setMeta([{ id: sel, labels_remove: [l] }], `ラベル「${l}」を外しました`, [{ id: sel, labels_add: [l] }]); }
    if (t.id === "manage-l") { e.stopPropagation(); return manage(); }
    const mr = t.closest("[data-mlren]"); if (mr) { const from = mr.dataset.mlren, to = root.getElementById("ren-" + mr.dataset.i).value.trim(); if (!to || to === from) return; return editLabel({ action: "rename", from, to }, `「${from}」の名前を変えました`, { action: "rename", from: to, to: from }); }
    const md = t.closest("[data-mldel]"); if (md) { const l = md.dataset.mldel; const had = D.rows.filter((r) => (r.labels || []).includes(l)).map((r) => r.id); return editLabel({ action: "delete", from: l }, `ラベル「${l}」を削除しました`, null, had); }
    if (t.id === "ml-close" || t.id === "ml-scrim") return closeManage();
    if (t.id === "up-open") return openUpload();
    if (t.id === "up-close" || t.id === "up-scrim") return closeUpload();
    if (t.id === "up-cancel") return upState && upState.running ? abortUpload() : closeUpload();
    if (t.id === "up-go") return startUpload();
    const op = t.closest("[data-open]"); if (op) { e.stopPropagation(); return openDetail(op.dataset.open); }
    const tr = t.closest("tr.rw[data-id]"); if (tr) return openDetail(tr.dataset.id);
    if (!t.closest(".pop")) { const m = $("#fmenu"); if (m && !m.hidden) { m.hidden = true; $("#fbtn").setAttribute("aria-expanded", "false"); } }
  });

  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "intx") { inTx = t.checked; txIds = null; render(); $("#q")?.focus(); return; }
    const r = D.rows.find((x) => x.id === sel);
    if (r && t.id === "d-yt") return setRoute(r.id, { youtube: t.checked }, t.checked ? "YouTube に上げるをオンにしました（5 分以内に上げます）" : "YouTube に上げるをオフにしました");
    if (r && t.id === "d-in") return setRoute(r.id, { site: t.checked }, t.checked ? "会員サイトに入れるをオンにしました" : "会員サイトに入れるをオフにしました");
    if (r && t.id === "d-course") return setRoute(r.id, { course_id: t.value || null }, "入れるコースを変えました");
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
    if ($("#rt")) { closeRoute(); return; }
    if ($("#sm")) { closeSite(); return; }
    if ($("#up")) { closeUpload(); return; }
    const m = $("#fmenu");
    if (m && !m.hidden) { m.hidden = true; $("#fbtn").setAttribute("aria-expanded", "false"); return; }
    if (sel) closeDetail();
  });
  root.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.id === "d-lab") { e.preventDefault(); return addOne(); }
    if (e.key === "Enter" && e.target.id === "bulk-l") { e.preventDefault(); return addBulk(); }
    if (e.key === "Escape" && $("#ml")) { e.stopPropagation(); return closeManage(); }
    if (e.key === "Escape" && $("#sm")) { e.stopPropagation(); return closeSite(); }
    if (e.key === "Escape" && $("#rt")) { e.stopPropagation(); return closeRoute(); }
    if (e.key === "Escape" && $("#up")) { e.stopPropagation(); return closeUpload(); }
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
    // アップロードの窓の中で Tab を回す（便 C）
    if (e.key === "Tab" && $("#up")) {
      const f = [...$("#up").querySelectorAll("button,input,select")].filter((x) => !x.disabled);
      const first = f[0], last = f[f.length - 1], cur = root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
      return;
    }
    // 詳細の窓の中で Tab を回す
    if (e.key === "Tab" && sel) {
      const f = [...$("#drawer").querySelectorAll("button,input,select,a[href]")].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
  });

  return {
    open: () => { if (!D) load(); else render(); },
    // 出し先のスイッチ：メールの住所（/admin#recording/<id>）から、その録画の詳細を開く
    openRec: async (id) => { if (!D) await load(); if (D && D.rows.some((x) => x.id === id)) openDetail(id); },
  };
}

// 教材を見る画面（便 B2・2026-11-06 Naoki OK 19:05・デモ https://claude.ai/artifact/1aPQsUyksechsXzyBJzg9c ）
//  ・上の帯：コースの名前・進み（視聴済みの数）・前へ／次へ。左：同じプログラムの教材（コースごと・たためる・絞り込み）
//  ・真ん中：動画と、その下の操作（お気に入り・視聴済み・ラベル・会員用リンク）・要約・資料・次に見る・質問
//  ・右：文字起こし／目次／メモ（右の枠の中だけが動く。ページ全体は動かさない）
//  ・録画の棚の録画は R2 から（/api/me/rec/<id> でログインと権利を確かめてから）。YouTube の教材は今までどおりの枠
//  ・印（お気に入り・視聴済み・自分のラベル）は本人だけが見る。/api/lesson/mark・/api/lesson/labels
import { api, esc, fmtTime } from "/js/common.js";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const lkey = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(x).padStart(2, "0"); };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 覚えられなくても動く */ } } };
const ICON = {
  nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.5 2.5 4.9-5"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6V5.5a1 1 0 0 1 1-1h7.1l7 7a1 1 0 0 1 0 1.4l-5.7 5.7a1 1 0 0 1-1.4 0z"/><circle cx="8.6" cy="8.6" r="1.3"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  back10: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7"/></svg>',
  fwd10: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v3.7h-3.7"/></svg>',
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 10.3a2.2 2.2 0 1 0 0 3.4M16.5 10.3a2.2 2.2 0 1 0 0 3.4"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
};

// 便 B2-5（2026-11-06）：メモの行き先。開けるアプリ（app_catalog の open）にだけ出す。「開くだけ」もある（Naoki 19:24）
const DEST = [
  { target: "mindmap", name: "思考整理くん", mark: "思", color: "#7c3aed", send: "マップにして開く", note: "メモの箇条書きがそのまま枝になります" },
  { target: "content-os", name: "コンテンツくん", mark: "コ", color: "#ea580c", send: "ネタにして開く", note: "アイデアメモに入ります（題名はこの教材）" },
];
const b64u = (str) => { const b = new TextEncoder().encode(str); let s = ""; b.forEach((x) => (s += String.fromCharCode(x))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

/**
 * ctx = { root, token, flat, lessons, marks, apps: [{ target, name, url, open }], onBack(), onViewed(id) }
 * 返すもの：{ open(id, startSec), close() }
 */
export function makeWatch(ctx) {
  const root = ctx.root, token = ctx.token;
  const marks = ctx.marks || {};
  const $ = (id) => root.querySelector("#" + id);
  let cur = null, curL = null, rec = null, video = null, navOpen = matchMedia("(min-width: 861px)").matches, filter = "all", labF = null;
  let tab = "memo", follow = true, capOn = store.get("lab:cc") === "1", rate = Number(store.get("lab:rate")) || 1, autoDone = false;
  let undoT = 0, popFrom = null, memoSaved = "", openSeq = 0;
  const open = {}; // コースのたたみ
  const markOf = (id) => marks[id] || { star: false, done: false, labels: [] };
  const allLabels = () => { const m = new Map(); Object.values(marks).forEach((x) => (x.labels || []).forEach((l) => m.set(l, (m.get(l) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")); };

  root.innerHTML = `<div class="wt">
    <header class="wt-top">
      <button class="wt-ib" type="button" id="wt-navbtn" aria-controls="wt-nav" aria-label="教材の一覧を開く・閉じる">${ICON.nav}</button>
      <button class="wt-ib wt-txt" type="button" id="wt-back">${ICON.back}<span>教材</span></button>
      <div class="wt-crumb"><small id="wt-path"></small><b id="wt-ttl"></b></div>
      <div class="wt-prog" id="wt-prog"></div>
      <button class="wt-ib wt-txt" type="button" id="wt-prev" aria-label="前の教材">${ICON.prev}<span>前へ</span></button>
      <button class="wt-ib wt-txt" type="button" id="wt-next" aria-label="次の教材"><span>次へ</span>${ICON.next}</button>
    </header>
    <div class="wt-body" id="wt-body">
      <nav class="wt-nav" id="wt-nav" aria-label="このプログラムの教材">
        <div class="wt-nh"><h2 id="wt-prog-name"></h2>
          <div class="wt-chips" role="group" aria-label="絞り込み">
            <button type="button" data-f="all" aria-pressed="true">すべて</button><button type="button" data-f="todo" aria-pressed="false">未視聴</button><button type="button" data-f="star" aria-pressed="false">お気に入り</button><button type="button" data-f="lab" aria-pressed="false" id="wt-labf">ラベル</button>
          </div></div>
        <div id="wt-tree"></div>
      </nav>
      <div class="wt-main">
        <section class="wt-watch" id="wt-watch" aria-label="再生">
          <div class="wt-stage" id="wt-stage"></div>
          <div class="wt-tools" id="wt-tools" hidden>
            <button type="button" class="wt-tl" id="wt-b10" aria-label="10 秒戻る">${ICON.back10}<span>10</span></button>
            <button type="button" class="wt-tl" id="wt-f10" aria-label="10 秒進む">${ICON.fwd10}<span>10</span></button>
            <span class="wt-grow"></span>
            <button type="button" class="wt-tl" id="wt-cc" aria-pressed="false" aria-label="字幕">${ICON.cc}<span>字幕</span></button>
            <label class="wt-rate"><span class="sr">再生速度</span><select id="wt-rate">${RATES.map((r) => `<option value="${r}">${r}×</option>`).join("")}</select></label>
          </div>
          <h1 class="wt-h1" id="wt-h1"></h1>
          <p class="wt-meta" id="wt-meta"></p>
          <div class="wt-acts" id="wt-acts">
            <button type="button" class="wt-pill" id="wt-star" aria-pressed="false">${ICON.star}<span>お気に入り</span></button>
            <button type="button" class="wt-pill" id="wt-done" aria-pressed="false">${ICON.check}<span>視聴済み</span></button>
            <button type="button" class="wt-pill" id="wt-lab">${ICON.tag}<span>ラベル</span></button>
            <button type="button" class="wt-pill" id="wt-link">${ICON.link}<span>会員用リンクをコピー</span></button>
          </div>
          <div class="wt-labs" id="wt-labs"></div>
          <div id="wt-cards"></div>
          <section class="wt-card" id="wt-qa" hidden>
            <h3>この教材について質問する</h3>
            <p class="wt-note">シアニンに届きます。答えはここと「添削」に出ます。</p>
            <div id="wt-qlist" class="wt-qlist"></div>
            <label for="wt-q" class="sr">質問</label><textarea id="wt-q" rows="3" maxlength="4000" placeholder="わからなかったところ・試してみたこと"></textarea>
            <div class="wt-row"><label class="wt-chk" id="wt-qat-box" hidden><input type="checkbox" id="wt-qat" checked> 今の時間（<span class="wt-now">00:00</span>）を付ける</label><span class="wt-grow"></span><span class="wt-note" id="wt-qst" role="status"></span><button type="button" class="wt-btn pri" id="wt-ask">質問を送る</button></div>
          </section>
        </section>
        <aside class="wt-side" aria-label="文字起こし・目次・メモ">
          <div class="wt-tabs" role="tablist" id="wt-tabs"></div>
          <div class="wt-pane" id="wt-p-tx" role="tabpanel" hidden>
            <div class="wt-find"><span class="wt-si">${ICON.search}</span><input id="wt-tq" type="search" placeholder="文字起こしの中を探す" aria-label="文字起こしの中を探す" autocomplete="off"><label class="wt-chk"><input type="checkbox" id="wt-follow" checked> 自動で追う</label></div>
            <div id="wt-cues"></div>
          </div>
          <div class="wt-pane" id="wt-p-toc" role="tabpanel" hidden></div>
          <div class="wt-pane" id="wt-p-memo" role="tabpanel" hidden>
            <div class="wt-memo">
              <label for="wt-memo" class="sr">メモ</label>
              <textarea id="wt-memo" maxlength="4000" placeholder="- 気づいたこと&#10;  - Tab で一段下げる"></textarea>
              <div class="wt-row"><button type="button" class="wt-btn" id="wt-stamp" hidden>＋ 今の時間（<span class="wt-now">00:00</span>）</button><span class="wt-grow"></span><button type="button" class="wt-btn pri" id="wt-msave">保存</button></div>
              <p class="wt-note" id="wt-mst" role="status">⌘／Ctrl＋Enter でも保存。あなただけが見られます</p>
              <div id="wt-dest"></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <div id="wt-pop"></div>
    <div class="wt-toast" id="wt-toast" role="status" aria-live="polite" hidden><span id="wt-toast-t"></span><button type="button" id="wt-toast-u" hidden>元に戻す</button></div>
  </div>`;

  // ---------- 一覧（左） ----------
  const sameProgram = () => ctx.flat.filter((x) => x.programId === curL.programId);
  const courseOf = (l) => l.courseId;
  function drawNav() {
    const all = sameProgram();
    const show = (x) => { const m = markOf(x.id); return filter === "all" || (filter === "todo" && !m.done) || (filter === "star" && m.star) || (filter === "lab" && (m.labels || []).some((l) => lkey(l) === lkey(labF))); };
    const groups = [];
    all.forEach((x) => { let g = groups.find((y) => y.id === x.courseId); if (!g) groups.push(g = { id: x.courseId, title: x.course, items: [] }); g.items.push(x); });
    $("wt-prog-name").textContent = curL.program || "";
    $("wt-tree").innerHTML = groups.map((g) => {
      const vis = g.items.filter(show), dn = g.items.filter((x) => markOf(x.id).done).length;
      if (!vis.length && filter !== "all") return "";
      const op = filter !== "all" || (open[g.id] ?? g.id === courseOf(curL));
      return `<div class="wt-grp"><button type="button" class="wt-gh" data-g="${esc(g.id)}" aria-expanded="${op}"><span class="wt-car">${op ? "▾" : "▸"}</span><span class="wt-gt">${esc(g.title)}</span><span class="wt-gc">${dn}/${g.items.length}</span></button>
        ${op ? vis.map((x) => { const m = markOf(x.id), on = x.id === cur;
          return `<a class="wt-les${on ? " on" : ""}" href="#lesson/${encodeURIComponent(x.id)}" data-l="${esc(x.id)}"${on ? ' aria-current="true"' : ""}>
            <span class="wt-ck${m.done ? " done" : ""}" role="img" aria-label="${m.done ? "視聴済み" : "未視聴"}">${m.done ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12.5l3.2 3.2L17 9"/></svg>' : ""}</span>
            <span class="wt-lt"><span class="wt-lname">${esc(x.title)}</span><span class="wt-lmeta">${x.minutes ? x.minutes + " 分" : x.youtube_id || x.rec ? "動画" : "文章"}${on ? "・再生中" : ""}${(m.labels || []).map((l) => `<span class="wt-tag">${esc(l)}</span>`).join("")}</span></span>
            ${m.star ? `<span class="wt-st" role="img" aria-label="お気に入り">${ICON.star}</span>` : ""}</a>`; }).join("") : ""}</div>`;
    }).join("") || '<p class="wt-note" style="padding:16px">合う教材がありません</p>';
    const doneN = all.filter((x) => markOf(x.id).done).length;
    $("wt-prog").innerHTML = `<span>${doneN} / ${all.length} 視聴済み</span><span class="wt-bar"><i style="width:${all.length ? Math.round(doneN / all.length * 100) : 0}%"></i></span>`;
    $("wt-labf").textContent = filter === "lab" && labF ? `ラベル：${labF}` : "ラベル";
    root.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
  }
  function setNav(on) {
    navOpen = on;
    $("wt-body").classList.toggle("nonav", !on);
    $("wt-navbtn").setAttribute("aria-pressed", String(on));
    if (!matchMedia("(min-width: 861px)").matches && on) setTimeout(() => (root.querySelector(".wt-les.on") || root.querySelector(".wt-les"))?.focus(), 30);
  }

  // ---------- 印 ----------
  async function saveMark(id, patch, label, back) {
    const before = { ...markOf(id), labels: [...markOf(id).labels] };
    marks[id] = { ...before, ...patch };
    paintMark(); drawNav();
    const r = await api("/api/lesson/mark", { method: "POST", token, body: { lesson_id: id, ...patch } });
    if (!r.ok) { marks[id] = before; paintMark(); drawNav(); toast("保存できませんでした。もう一度押してください"); return false; }
    marks[id] = r.mark; paintMark(); drawNav();
    if (label) toast(label, back === false ? null : () => saveMark(id, { star: before.star, done: before.done, labels: before.labels }, "元に戻しました", false));
    return true;
  }
  function paintMark() {
    const m = markOf(cur);
    const sb = $("wt-star"), db = $("wt-done");
    sb.setAttribute("aria-pressed", String(m.star)); sb.querySelector("span").textContent = m.star ? "お気に入り済み" : "お気に入り";
    db.setAttribute("aria-pressed", String(m.done)); db.querySelector("span").textContent = m.done ? "視聴済み" : "視聴済みにする";
    $("wt-labs").innerHTML = (m.labels || []).map((l) => `<span class="wt-tag lg">${esc(l)}</span>`).join("");
  }

  // ---------- 小さな窓（ラベル・ラベルで絞る） ----------
  function closePop() { if (!$("wt-pop").innerHTML) return; $("wt-pop").innerHTML = ""; popFrom?.focus?.(); popFrom = null; }
  function labelWin(keepFocus) {
    if (!keepFocus) popFrom = document.activeElement;
    // 描き直しても、さわっていた所へ戻る（5b）
    const ae = keepFocus && root.contains(document.activeElement) ? document.activeElement : null;
    const back = ae ? (["data-lab", "data-ren", "data-del"].map((k) => ae.getAttribute(k) != null ? `[${k}="${CSS.escape(ae.getAttribute(k))}"]` : "").find(Boolean) || (ae.id ? "#" + ae.id : "")) : "";
    const m = markOf(cur), ls = allLabels();
    $("wt-pop").innerHTML = `<div class="wt-scrim" data-close="1"></div><div class="wt-modal" role="dialog" aria-modal="true" aria-labelledby="wt-lt">
      <div class="wt-mh"><h2 id="wt-lt">ラベル</h2><button type="button" class="wt-ib" data-close="1" aria-label="閉じる">✕</button></div>
      <div class="wt-mb">
        <p class="wt-note" style="margin:0 0 6px">あなただけが見られます。この教材に付けるものにチェックを入れます。</p>
        ${ls.map(([l, n], i) => `<div class="wt-lrow"><input type="checkbox" id="wt-lb${i}" data-lab="${esc(l)}" ${(m.labels || []).includes(l) ? "checked" : ""}><label for="wt-lb${i}">${esc(l)}</label><span class="wt-note">${n} 本</span>
          <button type="button" class="wt-mini" data-ren="${esc(l)}" aria-label="ラベル「${esc(l)}」の名前を編集">編集</button><button type="button" class="wt-mini" data-del="${esc(l)}" aria-label="ラベル「${esc(l)}」を削除">削除</button></div>`).join("") || '<p class="wt-note">まだラベルがありません。下で作れます（例：あとで見直す・X投稿）。</p>'}
        <div class="wt-add"><label for="wt-newlab" class="sr">新しいラベル</label><input id="wt-newlab" maxlength="30" placeholder="新しいラベル"><button type="button" class="wt-btn" id="wt-addlab">追加</button></div>
        <p class="wt-note">全角半角・空白・大文字小文字だけ違うものは、同じラベルにまとめます。</p>
      </div></div>`;
    if (!keepFocus) setTimeout(() => ($("wt-pop").querySelector("input[type=checkbox]") || $("wt-newlab"))?.focus(), 30);
    else ((back && $("wt-pop").querySelector(back)) || $("wt-newlab"))?.focus();
  }
  function labelMenu() {
    popFrom = document.activeElement;
    const ls = allLabels();
    if (!ls.length) { toast("まだラベルがありません。教材の下の「ラベル」から作れます"); return; }
    const r = $("wt-labf").getBoundingClientRect();
    $("wt-pop").innerHTML = `<div class="wt-scrim clear" data-close="1"></div><div class="wt-menu" role="menu" aria-label="ラベルで絞る" style="top:${Math.round(r.bottom + 6)}px;left:${Math.round(r.left)}px">
      ${ls.map(([l, n]) => `<button type="button" role="menuitem" data-pick="${esc(l)}">${esc(l)}<span>${n}</span></button>`).join("")}</div>`;
    setTimeout(() => $("wt-pop").querySelector("[data-pick]")?.focus(), 20);
  }
  async function addLabel() {
    const v = $("wt-newlab").value.trim();
    if (!v) { toast("ラベルの名前を入れてください"); $("wt-newlab").focus(); return; }
    const m = markOf(cur), same = allLabels().map(([l]) => l).find((l) => lkey(l) === lkey(v));
    const name = same || v;
    if ((m.labels || []).some((l) => lkey(l) === lkey(name))) { toast(`「${name}」はもう付いています`); return; }
    await saveMark(cur, { labels: [...(m.labels || []), name] }, same && same !== v ? `「${same}」にまとめて付けました` : `ラベル「${name}」を付けました`);
    labelWin(true); $("wt-newlab").focus();
  }
  function renameRow(btn) {
    const row = btn.closest(".wt-lrow"), from = btn.dataset.ren;
    row.innerHTML = `<label class="sr" for="wt-ren">「${esc(from)}」の新しい名前</label><input id="wt-ren" maxlength="30" value="${esc(from)}"><button type="button" class="wt-mini pri" id="wt-ren-ok" data-from="${esc(from)}">保存</button><button type="button" class="wt-mini" id="wt-ren-no">キャンセル</button>`;
    const i = $("wt-ren"); i.focus(); i.select();
  }
  async function editLabel(action, from, to, quiet) {
    if (action === "rename") { to = String(to || "").trim(); if (!to || to === from) { labelWin(true); return; } }
    const had = action === "delete" ? Object.entries(marks).filter(([, m]) => (m.labels || []).some((l) => lkey(l) === lkey(from))).map(([id]) => id) : [];
    const r = await api("/api/lesson/labels", { method: "POST", token, body: { action, from, to } });
    if (!r.ok) { toast("できませんでした。もう一度お試しください"); return; }
    for (const [id, m] of Object.entries(marks)) {
      if (!(m.labels || []).some((l) => lkey(l) === lkey(from))) continue;
      const next = []; (m.labels || []).forEach((l) => { const x = lkey(l) === lkey(from) ? r.to : l; if (x && !next.some((y) => lkey(y) === lkey(x))) next.push(x); });
      marks[id] = { ...m, labels: next };
    }
    if (labF && lkey(labF) === lkey(from)) labF = r.to || null, filter = r.to ? filter : "all";
    paintMark(); drawNav(); labelWin(true);
    if (quiet) return;
    const undo = action === "rename" ? () => editLabel("rename", r.to, from, true).then(() => toast("元に戻しました"))
      : async () => { for (const id of had) { const m = markOf(id); await api("/api/lesson/mark", { method: "POST", token, body: { lesson_id: id, labels: [...(m.labels || []), from] } }).then((x) => x.ok && (marks[id] = x.mark)); } paintMark(); drawNav(); if ($("wt-pop").innerHTML) labelWin(true); toast("元に戻しました"); };
    toast(action === "rename" ? `「${from}」を「${r.to}」にしました（${r.changed} 本）` : `ラベル「${from}」を削除しました（${r.changed} 本）`, undo);
  }

  // ---------- 知らせ ----------
  function toast(text, undo) {
    $("wt-toast-t").textContent = text;
    $("wt-toast-u").hidden = !undo;
    $("wt-toast-u").onclick = () => { $("wt-toast").hidden = true; undo && undo(); };
    $("wt-toast").hidden = false;
    clearTimeout(undoT); undoT = setTimeout(() => ($("wt-toast").hidden = true), undo ? 6000 : 3500);
  }

  // ---------- 右の枠 ----------
  function drawTabs() {
    const tabs = [];
    if (rec && rec.cues.length) tabs.push(["tx", "文字起こし"]);
    if (rec && rec.chapters.length >= 2) tabs.push(["toc", "目次"]);
    tabs.push(["memo", "メモ"]);
    if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
    $("wt-tabs").innerHTML = tabs.map(([k, n]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${k === tab}" aria-controls="wt-p-${k}">${n}</button>`).join("");
    ["tx", "toc", "memo"].forEach((k) => ($("wt-p-" + k).hidden = k !== tab));
  }
  function setTab(k) { tab = k; drawTabs(); if (k === "tx") scrollCue(true); }
  function drawCues() {
    if (!rec) { $("wt-cues").innerHTML = ""; return; }
    const q = $("wt-tq").value.trim();
    const hit = (s) => q ? esc(s).split(esc(q)).join(`<mark>${esc(q)}</mark>`) : esc(s);
    const list = rec.cues.map((c, i) => [c, i]).filter(([c]) => !q || c.x.includes(q));
    $("wt-cues").innerHTML = list.map(([c, i]) => `<button type="button" class="wt-cue" data-at="${c.t}" data-i="${i}"><span class="wt-at">${fmt(c.t)}</span><span class="wt-cx">${c.w ? `<span class="wt-who">${esc(c.w)}</span>` : ""}${hit(c.x)}</span></button>`).join("")
      || `<p class="wt-note" style="padding:16px">「${esc(q)}」は見つかりませんでした</p>`;
    lastCue = -1; onTime();
  }
  function drawToc() {
    if (!rec) { $("wt-p-toc").innerHTML = ""; return; }
    $("wt-p-toc").innerHTML = rec.chapters.map((c, i) => `<button type="button" class="wt-ch" data-at="${c.t}" data-c="${i}"><span class="wt-at">${fmt(c.t)}</span><span>${esc(c.name)}</span></button>`).join("");
  }
  let lastCue = -1, lastCh = -1, userScroll = 0;
  function scrollCue(force) {
    const el = $("wt-cues").querySelector(".wt-cue.now");
    if (!el || $("wt-p-tx").hidden) return;
    if (!force && (!follow || Date.now() - userScroll < 4000)) return;
    const p = $("wt-p-tx"), top = el.offsetTop - p.clientHeight / 3;
    p.scrollTo({ top: Math.max(0, top), behavior: force ? "auto" : "smooth" });
  }
  function onTime() {
    if (!video || !rec) return;
    const t = video.currentTime;
    root.querySelectorAll(".wt-now").forEach((e) => (e.textContent = fmt(t)));
    let ci = -1; for (let i = 0; i < rec.cues.length; i++) { if (rec.cues[i].t <= t) ci = i; else break; }
    if (ci !== lastCue) {
      lastCue = ci;
      $("wt-cues").querySelectorAll(".wt-cue.now").forEach((e) => e.classList.remove("now"));
      const el = $("wt-cues").querySelector(`.wt-cue[data-i="${ci}"]`); if (el) { el.classList.add("now"); scrollCue(false); }
      const cap = $("wt-cap"); if (cap) { cap.textContent = ci >= 0 ? rec.cues[ci].x : ""; cap.hidden = !capOn || ci < 0; }
    }
    let hi = -1; rec.chapters.forEach((c, i) => { if (c.t <= t) hi = i; });
    if (hi !== lastCh) { lastCh = hi; $("wt-p-toc").querySelectorAll(".wt-ch").forEach((e) => e.classList.toggle("now", Number(e.dataset.c) === hi)); }
    if (video.duration && t > 0) store.set("lab:pos:" + cur, String(Math.floor(t)));
    // 9 割まで見たら視聴済みにする（1 回だけ・自分で外したものは付け直さない）
    if (!autoDone && video.duration && t / video.duration >= 0.9) { autoDone = true; if (!markOf(cur).done) saveMark(cur, { done: true }, "最後まで見たので、視聴済みにしました"); }
  }
  function seek(s) {
    if (video) { video.currentTime = Math.max(0, s); video.play().catch(() => {}); return; }
    if (curL && curL.youtube_id) $("wt-stage").innerHTML = ytFrame(curL, s, true);
  }

  // ---------- 動画 ----------
  const ytFrame = (l, start, auto) => `<div class="wt-frame"><iframe src="https://www.youtube-nocookie.com/embed/${esc(l.youtube_id)}${start || auto ? `?start=${Math.floor(start || 0)}&autoplay=1` : ""}" title="${esc(l.title)} の動画" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  async function loadRec(l, start, seq) {
    $("wt-stage").innerHTML = '<div class="wt-frame wt-wait">読み込んでいます…</div>';
    const r = await api("/api/me/rec/" + encodeURIComponent(l.id), { token }).catch(() => ({ ok: false }));
    if (seq !== openSeq) return;
    if (!r || !r.ok || !r.video) {
      rec = null;
      $("wt-stage").innerHTML = l.youtube_id ? ytFrame(l, start) : '<div class="wt-frame wt-wait">いまは再生できません。読み込み直してください</div>';
      drawTabs(); return;
    }
    rec = { cues: Array.isArray(r.cues) ? r.cues : [], chapters: Array.isArray(r.chapters) ? r.chapters : [], summary: r.summary || "", date: r.date || "" };
    $("wt-stage").innerHTML = `<div class="wt-frame"><video id="wt-v" playsinline preload="metadata" controls controlsList="nodownload" src="${esc(r.video)}"></video><div class="wt-cap" id="wt-cap" hidden></div></div>`;
    video = $("wt-v");
    video.playbackRate = rate;
    const saved = Number(store.get("lab:pos:" + l.id)) || 0;
    const at = start != null ? start : saved;
    const go = () => { if (at > 3 && (!video.duration || at < video.duration - 5)) video.currentTime = at; video.playbackRate = rate; };
    if (video.readyState >= 1) go(); else video.addEventListener("loadedmetadata", go, { once: true });
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ratechange", () => { rate = video.playbackRate; $("wt-rate").value = String(rate); store.set("lab:rate", String(rate)); });
    $("wt-tools").hidden = false; $("wt-stamp").hidden = false; $("wt-qat-box").hidden = false;
    if (rec.date || l.minutes) $("wt-meta").textContent = [rec.date ? "収録日 " + rec.date : "", l.minutes ? l.minutes + " 分" : "", l.kind || ""].filter(Boolean).join("・");
    if (!l.summary && rec.summary) drawCards();
    if (start != null) video.play().catch(() => {});
    if (tab === "memo" && rec.cues.length && !memoSaved) tab = "tx";
    drawTabs(); drawCues(); drawToc();
  }

  // ---------- 要約・資料・次に見る ----------
  const ordered = () => sameProgram();
  function neighbor(d) { const all = ordered(), i = all.findIndex((x) => x.id === cur); return i < 0 ? null : all[i + d] || null; }
  function drawCards() {
    const sum = curL.summary || (rec && rec.summary) || "";
    const files = Array.isArray(curL.files) ? curL.files : [];
    const nx = neighbor(1);
    $("wt-cards").innerHTML = (sum ? `<section class="wt-card"><h3>この回の要約</h3><p class="wt-pre">${esc(sum)}</p></section>` : "")
      + (curL.mindmap_url || files.length ? `<section class="wt-card"><h3>資料</h3><div class="wt-files">${curL.mindmap_url ? `<a class="wt-btn" href="${esc(curL.mindmap_url)}" target="_blank" rel="noopener">マインドマップ ↗</a>` : ""}${files.map((f) => `<a class="wt-btn" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label)} ↗</a>`).join("")}</div></section>` : "")
      + (nx ? `<section class="wt-card wt-nextc"><div><span class="wt-note">次に見る</span><b>${esc(nx.title)}</b></div><button type="button" class="wt-btn pri" data-l="${esc(nx.id)}">次へ</button></section>` : "");
  }

  // ---------- 質問とメモ ----------
  async function loadNotes(id) {
    $("wt-q").value = ""; $("wt-qst").textContent = "";
    const n = await api("/api/lesson/notes?lesson_id=" + encodeURIComponent(id), { token });
    if (cur !== id) return;
    $("wt-qa").hidden = !n.ok;
    if (!n.ok) { $("wt-memo").value = ""; memoSaved = ""; return; }
    const canAsk = curL.can_ask !== false;
    ["wt-q", "wt-ask"].forEach((k) => ($(k).hidden = !canAsk));
    $("wt-qat-box").hidden = !canAsk || !video;
    $("wt-qst").textContent = canAsk ? "" : "この教材は質問を受け付けていません";
    $("wt-qlist").innerHTML = n.questions.map((q) => `<div class="wt-qa1"><div class="wt-qme"><p class="wt-pre">${esc(q.text)}</p><time>${esc(fmtTime(q.at))}</time></div>
      ${q.answers.length ? q.answers.map((a) => `<div class="wt-qans"><span class="wt-who">シアニンの回答</span><p class="wt-pre">${esc(a.text)}</p><time>${esc(fmtTime(a.at))}</time></div>`).join("") : '<p class="wt-note">回答を待っています</p>'}</div>`).join("");
    memoSaved = n.memo ? n.memo.text : "";
    $("wt-memo").value = memoSaved;
    if (memoSaved && !(rec && rec.cues.length)) tab = "memo";
  }
  async function ask() {
    let text = $("wt-q").value.trim();
    if (!text) { $("wt-qst").textContent = "質問を入れてください"; $("wt-q").focus(); return; }
    if (video && $("wt-qat").checked) text = `[${fmt(video.currentTime)}] ` + text;
    $("wt-ask").disabled = true;
    const r = await api("/api/room", { method: "POST", token, body: { kind: "chat", lesson_id: cur, text } });
    $("wt-ask").disabled = false;
    if (!r.ok) { $("wt-qst").textContent = "送れませんでした。もう一度お試しください"; return; }
    await loadNotes(cur);
    $("wt-qst").textContent = "送りました";
  }
  async function saveMemo() {
    const text = $("wt-memo").value.replace(/^\s*-\s*$/, "");
    const r = await api("/api/lesson/memo", { method: "POST", token, body: { lesson_id: cur, text } });
    if (!r.ok) { $("wt-mst").textContent = "保存できませんでした。もう一度お試しください"; return; }
    memoSaved = text; $("wt-mst").textContent = "メモを保存しました";
  }
  function memoKeys(e) {
    const ta = e.target;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveMemo(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1;
      if (e.shiftKey) { if (ta.value.slice(ls, ls + 2) === "  ") { ta.setRangeText("", ls, ls + 2, "preserve"); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 2); } }
      else { ta.setRangeText("  ", ls, ls, "preserve"); ta.selectionStart = ta.selectionEnd = s + 2; }
      return;
    }
    if (e.key === "Enter" && !e.isComposing && !e.shiftKey) {
      const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1, m = ta.value.slice(ls, s).match(/^(\s*)- (.*)$/);
      if (!m) return;
      e.preventDefault();
      if (!m[2].trim()) { ta.setRangeText("", ls, s, "end"); return; } // 空の行で Enter：箇条書きを終える
      ta.setRangeText("\n" + m[1] + "- ", s, ta.selectionEnd, "end");
    }
  }

  // ---------- 開く ----------
  function openLesson(id, start) {
    const l = ctx.lessons[id]; if (!l) return false;
    if (cur && cur !== id && $("wt-memo").value !== memoSaved && $("wt-memo").value.trim() && $("wt-memo").value.trim() !== "-") {
      if (!confirm("保存していないメモがあります。保存せずにほかの教材へ移りますか？")) return false;
    }
    const seq = ++openSeq;
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    cur = id; curL = ctx.flat.find((x) => x.id === id) || { ...l, program: "", course: "", programId: null, courseId: null };
    rec = null; video = null; autoDone = false; lastCue = -1; lastCh = -1; tab = "memo";
    $("wt-tools").hidden = true; $("wt-stamp").hidden = true; $("wt-qat-box").hidden = true;
    $("wt-path").textContent = [curL.program, curL.course].filter(Boolean).join(" › ");
    $("wt-ttl").textContent = l.title; $("wt-h1").textContent = l.title;
    $("wt-meta").textContent = [l.minutes ? l.minutes + " 分" : "", curL.kind || ""].filter(Boolean).join("・");
    $("wt-tq").value = "";
    $("wt-prev").disabled = !neighbor(-1); $("wt-next").disabled = !neighbor(1);
    if (l.rec) loadRec(l, start, seq);
    else $("wt-stage").innerHTML = l.youtube_id ? ytFrame(l, start, start != null) : '<div class="wt-frame wt-wait">この教材は文章です。下の要約と資料を見てください</div>';
    drawTabs(); drawCues(); drawToc(); drawCards(); paintMark(); drawNav();
    root.querySelector(".wt-les.on")?.scrollIntoView({ block: "nearest" });
    $("wt-watch").scrollTop = 0;
    loadNotes(id);
    ctx.onViewed && ctx.onViewed(id);
    if (!matchMedia("(min-width: 861px)").matches) setNav(false);
    return true;
  }
  function go(id) { history.pushState(null, "", "#lesson/" + encodeURIComponent(id)); openLesson(id); }

  // ---------- 操作 ----------
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-close]")) { closePop(); return; }
    const at = t.closest("[data-at]"); if (at) { seek(Number(at.dataset.at)); return; }
    const l = t.closest("[data-l]"); if (l && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (l.dataset.l !== cur) go(l.dataset.l); else if (!matchMedia("(min-width: 861px)").matches) setNav(false); return; }
    const g = t.closest("[data-g]"); if (g) { const op = g.getAttribute("aria-expanded") === "true"; open[g.dataset.g] = !op; drawNav(); root.querySelector(`[data-g="${CSS.escape(g.dataset.g)}"]`)?.focus(); return; }
    const f = t.closest("[data-f]"); if (f) { if (f.dataset.f === "lab") { labelMenu(); return; } filter = f.dataset.f; labF = null; drawNav(); f.focus(); return; }
    const pk = t.closest("[data-pick]"); if (pk) { filter = "lab"; labF = pk.dataset.pick; $("wt-pop").innerHTML = ""; drawNav(); $("wt-labf").focus(); popFrom = null; return; }
    const tb = t.closest("[data-t]"); if (tb) { setTab(tb.dataset.t); tb.focus(); return; }
    const rn = t.closest("[data-ren]"); if (rn) { renameRow(rn); return; }
    if (t.id === "wt-ren-ok") { editLabel("rename", t.dataset.from, $("wt-ren").value); return; }
    if (t.id === "wt-ren-no") { labelWin(true); return; }
    const dl = t.closest("[data-del]"); if (dl) { editLabel("delete", dl.dataset.del); return; }
  });
  root.addEventListener("change", (e) => {
    const c = e.target.closest("[data-lab]"); if (!c) return;
    const m = markOf(cur), name = c.dataset.lab;
    const labels = c.checked ? [...(m.labels || []), name] : (m.labels || []).filter((x) => x !== name);
    saveMark(cur, { labels }, c.checked ? `ラベル「${name}」を付けました` : `ラベル「${name}」を外しました`).then(() => labelWin(true));
  });
  $("wt-navbtn").onclick = () => setNav(!navOpen);
  $("wt-back").onclick = () => ctx.onBack();
  $("wt-prev").onclick = () => { const n = neighbor(-1); if (n) go(n.id); };
  $("wt-next").onclick = () => { const n = neighbor(1); if (n) go(n.id); };
  $("wt-star").onclick = () => { const m = markOf(cur); saveMark(cur, { star: !m.star }, m.star ? "お気に入りから外しました" : "お気に入りに入れました"); };
  $("wt-done").onclick = () => { const m = markOf(cur); saveMark(cur, { done: !m.done }, m.done ? "未視聴に戻しました" : "視聴済みにしました"); };
  $("wt-lab").onclick = () => labelWin(false);
  $("wt-link").onclick = async () => {
    const t = video ? Math.floor(video.currentTime) : 0;
    const link = `${location.origin}/app#lesson/${encodeURIComponent(cur)}${t > 0 ? "/t" + t : ""}`;
    let ok = true; try { await navigator.clipboard.writeText(link); } catch { ok = false; }
    toast(ok ? `${t > 0 ? fmt(t) + " から始まる" : ""}会員用リンクをコピーしました。開けるのは、この教材を見られる会員だけです` : link);
  };
  $("wt-b10").onclick = () => video && (video.currentTime = Math.max(0, video.currentTime - 10));
  $("wt-f10").onclick = () => video && (video.currentTime = video.currentTime + 10);
  $("wt-cc").setAttribute("aria-pressed", String(capOn));
  $("wt-cc").onclick = () => { capOn = !capOn; store.set("lab:cc", capOn ? "1" : "0"); $("wt-cc").setAttribute("aria-pressed", String(capOn)); lastCue = -1; onTime(); };
  $("wt-rate").value = String(rate);
  $("wt-rate").onchange = (e) => { rate = Number(e.target.value) || 1; store.set("lab:rate", String(rate)); if (video) video.playbackRate = rate; };
  $("wt-tq").oninput = drawCues;
  $("wt-follow").onchange = (e) => { follow = e.target.checked; if (follow) scrollCue(true); };
  $("wt-p-tx").addEventListener("wheel", () => (userScroll = Date.now()), { passive: true });
  $("wt-p-tx").addEventListener("touchmove", () => (userScroll = Date.now()), { passive: true });
  $("wt-memo").addEventListener("keydown", memoKeys);
  $("wt-memo").addEventListener("focus", () => { if (!$("wt-memo").value) $("wt-memo").value = "- "; });
  $("wt-msave").onclick = saveMemo;
  // 今の時間は、いる行の頭（「- 」のあと）に入れる。行が埋まっていれば、下に新しい行を作って入れる
  $("wt-stamp").onclick = () => {
    const ta = $("wt-memo"), stamp = `[${fmt(video ? video.currentTime : 0)}] `;
    ta.focus();
    if (!ta.value.trim()) ta.value = "- ";
    const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1, le = ta.value.indexOf("\n", s) < 0 ? ta.value.length : ta.value.indexOf("\n", s);
    const line = ta.value.slice(ls, le), m = line.match(/^(\s*- )(.*)$/);
    if (m && !m[2].trim()) ta.setRangeText(stamp, ls + m[1].length, le, "end");
    else ta.setRangeText("\n" + (m ? m[1] : "- ") + stamp, le, le, "end");
  };
  $("wt-ask").onclick = ask;
  // メモの行き先（別タブ）。押した瞬間に開く（あとから開くと窓を止められるため）。書きかけのメモは裏で保存する
  const apps = (ctx.apps || []).filter((a) => a.open && a.url);
  $("wt-dest").innerHTML = DEST.filter((d) => apps.some((a) => a.target === d.target)).map((d) => `<div class="wt-dest">
      <span class="wt-dm" style="background:${d.color}" aria-hidden="true">${d.mark}</span>
      <span class="wt-dt"><b>${esc(d.name)}</b><small>${esc(d.note)}</small></span>
      <span class="wt-da"><button type="button" class="wt-btn" data-send="${d.target}">${esc(d.send)} ↗</button><button type="button" class="wt-mini" data-openapp="${d.target}" aria-label="${esc(d.name)}を別タブで開く">開くだけ ↗</button></span></div>`).join("");
  if ($("wt-dest").innerHTML) $("wt-dest").insertAdjacentHTML("afterbegin", '<p class="wt-dh">メモを続きのアプリで育てる</p>');
  $("wt-dest").addEventListener("click", (e) => {
    const sd = e.target.closest("[data-send]"), op = e.target.closest("[data-openapp]");
    const a = apps.find((x) => x.target === (sd || op || {}).dataset?.[sd ? "send" : "openapp"]);
    if (!a) return;
    if (op) { window.open(a.url, "_blank", "noopener"); return; }
    const text = $("wt-memo").value.replace(/^\s*-\s*$/, "").trim();
    if (!text) { toast("メモが空です。書いてから送ってください"); $("wt-memo").focus(); return; }
    const t = video ? Math.floor(video.currentTime) : 0;
    const src = `${location.origin}/app#lesson/${encodeURIComponent(cur)}${t > 0 ? "/t" + t : ""}`;
    const url = new URL("/new", a.url).href + "#d=" + b64u(JSON.stringify({ title: curL.title, text, src }));
    window.open(url, "_blank", "noopener");
    if (text !== memoSaved.trim()) saveMemo();
    toast(`${DEST.find((d) => d.target === a.target).name}を別タブで開きました`);
  });
  $("wt-q").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); ask(); } });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "wt-newlab") { e.preventDefault(); addLabel(); return; }
    if (e.key === "Enter" && e.target.id === "wt-ren") { e.preventDefault(); $("wt-ren-ok").click(); return; }
    if (e.key === "Escape" && e.target.id === "wt-ren") { e.preventDefault(); labelWin(true); return; }
    if (e.key === "Escape") {
      if ($("wt-pop").innerHTML) { e.preventDefault(); closePop(); return; }
      if (!matchMedia("(min-width: 861px)").matches && navOpen) { setNav(false); $("wt-navbtn").focus(); return; }
    }
    // 窓の中で Tab を回す
    if (e.key === "Tab" && $("wt-pop").querySelector(".wt-modal")) {
      const f = [...$("wt-pop").querySelectorAll("button, input")].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey || !video) return;
    if (e.key === "j") video.currentTime = Math.max(0, video.currentTime - 10);
    else if (e.key === "l") video.currentTime += 10;
    else if (e.key === "k") { video.paused ? video.play() : video.pause(); }
  });
  root.addEventListener("click", (e) => { if (e.target.id === "wt-addlab") addLabel(); });
  setNav(navOpen);

  return {
    open: openLesson,
    leave() { if (video) video.pause(); closePop(); },
  };
}

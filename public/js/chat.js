// チャットの便 C1（2026-11-07 Naoki OK 10:55・デモ https://claude.ai/artifact/CqUVZrEMegXbRk385fkZ2J）
//  ・左＝要返信／後で／すべて と人の一覧（探す欄は全員のやり取りとメモを言葉で探す）。真ん中＝やり取りとメモ。右＝顧客のカードと「履歴」
//  ・メッセージはホバーの帯・右クリック（スマホは長押し）・選んで 1 キー（T タスク・F 転送・C コピー）で操作する
//  ・メモ（自分だけ）は生徒には見えない。転送は「メモとして」だけ（別の生徒に中身が届かないように）
//  ・添削の 3 欄と教材の質問への答えは、今までどおり添削ルームで（ここからは「添削ルームで開く →」で移る）
//  ・⌘／Ctrl＋K で人を探して開く（部屋の無い人も）・] で右を開閉・? でキーの一覧。右の幅は左端を引いて変えられる（このブラウザに覚える）
//  ・C2a（2026-11-07）：左のフォルダ（作る・名前・並べ替え・消す・入れる）とフォルダの中で探す・右の「資料」タブ（リンクと画像を自動で集める・資料に入れたもの・探す）
//    ・右クリックの「資料に入れる」（S）と「連携」（タスクへ）。グループは C2b、「AI」タブは C3
//  ・C3（2026-11-07）：右の「AI」タブ（要約・返信の下書き・見落とし・自由な質問）・右クリックの「AI で分析」・「AI で言い換えて探す」。中身は src/chatai.js（Workers AI）
//  ・C2b（2026-11-07）：左に「グループ」（新規作成・メンバーを招待／削除・グループ設定・アーカイブ）。グループは本流＋スレッド・スタンプ 6 つ・既読の人数・吹き出しの右クリック
//    文言は一般の呼び名にそろえる（2026-11-07 13:12 Naoki「人を入れる→招待など一般的な名称に統一」「既読は人数だけ」）
//    （スタンプ・スレッドで返信・コピー・タスクへ・その人の 1 対 1・顧客管理・Claude に聞く）。右は スレッド／メンバー／資料。中身は src/groups.js
//  ・C2a-2：見出しの「顧客管理で開く」（詳細へ飛ぶだけ）と「サイト｜LINE」の切り替え。LINE は結ばれた人だけ読めて返せる。結ばれていなければ友だちから選んで結ぶ
import { api, esc, fmtTime, authImage, EVENT_LABEL } from "/js/common.js";

const COL = ["#b45309", "#7c3aed", "#0f766e", "#be123c", "#1d4ed8", "#4d7c0f", "#0369a1", "#a21caf"];
const CATCOL = { 購入: "#2563eb", 予約: "#7c3aed", セミナー: "#0369a1", 学習: "#0f766e", メール: "#a21caf", LINE: "#15803d", 添削: "#be123c", フォーム: "#b45309", ページ: "#4d7c0f", 権利: "#334155", 登録とログイン: "#57534e", マーケ: "#9f1239", そのほか: "#6b6259" };
// 共通の呼び名（common.js の EVENT_LABEL）に無い出来事の呼び名。履歴に中の名前を出さないため
const LABEL_MORE = { email_opened: "メールを開いた", line_sent: "LINE を送った", line_keyword: "LINE でキーワードを送った", line_linked: "LINE とつないだ", lesson_mark: "教材に印を付けた", lesson_memo: "教材にメモを書いた",
  consult_reminded: "予約の前の知らせ", field_set: "項目を書き換えた", goal_review_submitted: "週の振り返りを出した", invite_accepted: "招待を受けた", sales_marked: "売上に記録した", step_entered: "コネクタに入った", workspace_left: "ワークスペースを抜けた", workspace_restored: "ワークスペースに戻った",
  utage_imported: "UTAGE から取り込んだ", report_saved: "日報・週報を出した", goal_draft_started: "目標の下書きを始めた", admin_notified: "シアニンへ知らせた", admin_notify_failed: "シアニンへの知らせに失敗", connector_skipped: "コネクタを飛ばした", label_removed: "ラベルを外した" };
const labelOf = (t) => EVENT_LABEL[t] || LABEL_MORE[t] || "そのほかの出来事";
const KEY_LABEL = { shiarabo_basic: "しあらぼ", shiarabo_next_premium: "NEXT プレミアム", shiarabo_next_standard: "NEXT スタンダード", shiarabo_trial: "しあらぼ体験", shiarabo_monitor: "モニター", note_membership: "note メンシプ", shiarabo_paused: "休止", shiarabo_pilot: "先行で試す", guest: "ゲスト" };
const ERR = {
  empty: "空です。中身を書いてください", too_long: "長すぎます（8000 字まで）", bad_until: "後で見る日時が正しくありません（これから先・90 日まで）",
  same_chat: "同じチャットには転送できません", message_not_found: "元のメッセージが見つかりませんでした", no_taskmaster: "TaskMaster につながっていません（設定の確認が要ります）",
  bad_name: "フォルダの名前は 1〜20 字です", name_taken: "同じ名前のフォルダがあります", folders_full: "フォルダがいっぱいです（使っていないものを削除か、名前を短く）", folder_not_found: "そのフォルダは消されています",
  linked_to_other: "その LINE の友だちは、ほかの人に結ばれています", bad_user: "LINE の友だちの番号が正しくありません", blocked: "ブロックされているので送れません", need_text: "文が空です", no_token: "LINE の鍵がありません（設定の確認が要ります）",
  need_title: "タスクの名前を入れてください", title_too_long: "タスクの名前が長すぎます（300 字まで）", bad_deadline: "期限の形が違います", bad_link_url: "元のメッセージの住所を作れませんでした",
};
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function mountChat(host, { getToken, openPerson, openRoom }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/chat.css">
  <div class="app" id="app" data-v="list">
    <aside class="left" aria-label="チャットの一覧"><div class="lsearch"><label class="sr" for="q">やり取りとメモを探す</label><input id="q" type="search" placeholder="やり取りとメモを探す（Enter）"><div class="hint"><span class="kbd">⌘K</span> で人を探して開く・<button class="lk" id="aiSearch" type="button">AI で言い換えて探す</button></div></div><div class="list" id="list"></div></aside>
    <main class="mid" id="mid"><div class="welcome">左の一覧からチャットを選んでください。<br><span class="kbd">⌘K</span> で名前から開けます。</div></main>
    <aside class="right" id="right" aria-label="顧客と履歴"></aside>
  </div><div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s, r = root) => r.querySelector(s), $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const call = (path, method = "GET", body) => api(path, { method, body, token: getToken() });
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;
  const app = $("#app");
  const live = (t) => { $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const narrow = () => matchMedia("(max-width:900px)").matches;

  let L = null, D = null, cur = null, filter = "all", sideOpen = true, noteMode = false, evOff = new Set(), hits = null, lastFocus = null, menuAt = 0;
  let fsel = null, tab = "hist", vk = "all", vq = "", chan = "site", LN = null;
  let G = null, gTab = "mem", gThread = null;
  const fname = (id) => { const f = L && L.folders.find((x) => x.id === id); return f ? f.name : ""; };
  try { const w = localStorage.getItem("chat-rw"); if (w) app.style.setProperty("--rw", w + "px"); } catch (_) {}
  const av = (id, name) => `<span class="av" style="background:${COL[hash(id) % COL.length]}" aria-hidden="true">${esc(String(name || "？").slice(0, 1))}</span>`;
  const nameOf = (c) => c.name || c.email || "（名前なし）";
  const setView = (v) => { app.dataset.v = v; };

  // ---------- 左 ----------
  async function loadList() {
    const r = await call("/api/admin/chat");
    if (!r.ok) { $("#list").innerHTML = `<p class="empty">読めませんでした（${esc(r.error || r.status)}）</p>`; return; }
    L = r; drawLeft();
  }
  function drawLeft() {
    if (!L) return;
    if (fsel && !L.folders.some((f) => f.id === fsel)) fsel = null;
    const inF = fsel ? L.chats.filter((c) => c.folder_id === fsel) : L.chats;
    const pick = filter === "need" ? inF.filter((c) => c.need) : filter === "later" ? inF.filter((c) => c.later_until) : inF;
    const btn = (k, label, n) => `<button class="sv" data-f="${k}" aria-pressed="${filter === k}">${label}<span class="n">${n}</span></button>`;
    const fbtn = (id, label, n, need) => `<button class="fd" data-fd="${id}" aria-pressed="${fsel === (id || null)}"><span class="fi" aria-hidden="true">${id ? "▸" : "•"}</span>${esc(label)}<span class="n">${n}${need ? `・<b>${need}</b>` : ""}</span></button>`;
    $("#q").placeholder = fsel ? `「${fname(fsel)}」の中を探す（Enter）` : "やり取りとメモを探す（Enter）";
    $("#list").innerHTML = `<div role="group" aria-label="絞り込み">${btn("need", "要返信", inF.filter((c) => c.need).length)}${btn("later", "後で", inF.filter((c) => c.later_until).length)}${btn("all", "すべて", inF.length)}</div>
      ${fsel ? "" : `<div class="fh"><span>グループ</span><button class="lk" id="gnew">＋ 新規作成</button></div>${(L.groups || []).filter((g) => filter !== "later" && (filter !== "need" || g.need)).map((g) => `<button class="ci" data-gr="${g.id}" aria-current="${cur === "group:" + g.id && !hits}">${av(g.id, g.name).replace('class="av"', 'class="av sq"')}<span class="t"><b>${esc(g.name)}<span class="gtag">${g.members} 人</span></b><small>${g.last_text ? esc(g.last_name) + "：" + esc(g.last_text) : "まだメッセージはありません"}</small></span>${g.unread_for_admin ? `<span class="badge" aria-label="未読 ${g.unread_for_admin}">${g.unread_for_admin}</span>` : ""}</button>`).join("") || (L.groups_note === "need_sql" ? '<p class="fnone">グループの表を作る前です</p>' : (L.groups || []).length ? "" : '<p class="fnone">「＋ 新規作成」でグループを作れます</p>')}`}
      <div class="fh"><span>フォルダ</span><button class="lk" id="fedit">編集</button></div>
      <div role="group" aria-label="フォルダ" class="fds">${fbtn("", "すべてのチャット", L.count, 0)}${L.folders.map((f) => fbtn(f.id, f.name, f.count, f.need)).join("")}${L.folders.length ? "" : '<p class="fnone">「編集」からフォルダを作れます</p>'}</div>
      <div class="lh">${fsel ? esc(fname(fsel)) + "・" : ""}${filter === "need" ? "要返信" : filter === "later" ? "後で" : "すべて"}</div>
      ${pick.map((c) => `<button class="ci" data-c="${c.person_id}" aria-current="${cur === c.person_id && !hits}">${av(c.person_id, nameOf(c))}<span class="t"><b>${esc(nameOf(c))}</b><small>${c.last_from === "cyanin" ? "返した：" : ""}${esc(c.last_text || "")}</small></span>
        ${c.later_until ? `<span class="lt">後で ${esc(dayOf(c.later_until))}</span>` : c.need ? `<span class="flag">要返信</span>` : ""}${c.unread_for_admin ? `<span class="badge" aria-label="未読 ${c.unread_for_admin}">${c.unread_for_admin}</span>` : ""}</button>`).join("")
        || `<p class="empty">${filter === "need" ? "要返信はありません" : filter === "later" ? "後でにしたチャットはありません" : fsel ? "このフォルダにはまだチャットがありません。チャットを開いて「フォルダ」から入れられます" : "チャットはまだありません。⌘K で人を探して始められます"}</p>`}`;
    $$("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; drawLeft(); $(`[data-f="${filter}"]`).focus(); }));
    $$("[data-fd]").forEach((b) => (b.onclick = () => { fsel = b.dataset.fd || null; drawLeft(); $(`[data-fd="${fsel || ""}"]`).focus(); }));
    $$(".ci", $("#list")).forEach((b) => (b.oncontextmenu = (e) => { e.preventDefault(); folderDlg(b.dataset.c, b); }));
    $("#fedit").onclick = (e) => foldersDlg(e.currentTarget);
    $$("[data-gr]").forEach((b) => (b.onclick = () => openGroup(b.dataset.gr)));
    if ($("#gnew")) $("#gnew").onclick = (e) => newGroupDlg(e.currentTarget);
    $$("[data-c]", $("#list")).forEach((b) => (b.onclick = () => openChat(b.dataset.c)));
  }

  // ---------- 1 人を開く ----------
  async function openChat(id, focusId) {
    if (String(id).startsWith("group:")) return openGroup(String(id).slice(6), focusId);
    G = null;
    app.classList.remove("leftopen");
    if (id !== cur) { chan = "site"; LN = null; }
    if (focusId === "line") { chan = "line"; focusId = null; }
    cur = id; hits = null; drawLeft();
    try { history.replaceState(null, "", `#chat/${id}${focusId ? "/" + focusId : ""}`); } catch (_) {}
    const r = await call("/api/admin/chat/" + id);
    if (!r.ok || !r.found) { $("#mid").innerHTML = `<div class="welcome">読めませんでした（${esc(r.error || "見つかりません")}）</div>`; return; }
    D = r; D.id = id;
    const row = L && L.chats.find((c) => c.person_id === id); if (row) row.unread_for_admin = 0;
    drawLeft(); if (chan === "line") await openLineChan(); else drawMid(focusId); drawRight(); setView("chat");
    if (!focusId && !narrow()) $("#comp")?.focus();
    live(`「${D.card.name || D.person.email}」のチャットを開きました`);
  }

  // ---------- 真ん中 ----------
  function items() {
    const done = new Set(D.tasks.map((t) => String(t.event_id)));
    const kept = new Set(D.vault.filter((v) => v.kind === "saved").map((v) => String(v.event_id)));
    const its = [];
    for (const m of D.messages) {
      if (m.kind === "chat") its.push({ id: m.id, at: m.at, me: m.from === "cyanin", who: m.from === "cyanin" ? "シアニン" + (m.actor === "mcp" ? "（AI から）" : "") : (D.card.name || "生徒"), text: m.text, images: m.images || [], lesson: m.lesson, reply_to: m.reply_to, task: done.has(String(m.id)) });
      else if (m.from === "student") its.push({ id: m.id, at: m.at, me: false, line: true, who: D.card.name || "生徒", text: "添削の依頼：" + (m.text || "（画像）").slice(0, 80), corr: true, replied: m.replied, task: done.has(String(m.id)) });
      else its.push({ id: m.id, at: m.at, me: true, line: true, who: "シアニン", text: "添削を返した" + (m.comment ? "：" + m.comment.slice(0, 80) : ""), corr: true, task: done.has(String(m.id)) });
    }
    for (const n of D.notes) its.push({ id: n.id, at: n.at, me: true, note: true, who: "シアニン・メモ（自分だけ）", text: n.text, fwd: n.forwarded_from, task: done.has(String(n.id)) });
    for (const m of its) m.kept = kept.has(String(m.id));
    return its.sort((a, b) => a.id - b.id);
  }
  function msgHtml(m) {
    const link = (t) => esc(t).replace(/https?:[/][/][^\s　<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    const tags = [
      m.lesson ? `<span class="tag">${m.me ? "答え：" : "教材の質問："}${esc(m.lesson.title)}</span>` : "",
      m.corr && !m.me ? `<span class="tag ${m.replied ? "" : "warn"}">${m.replied ? "返信済み" : "未返信"}</span>` : "",
      m.fwd ? `<span class="tag">転送：${esc(m.fwd.name || "")}から</span>` : "",
      m.task ? `<span class="tag">タスク済</span>` : "",
      m.kept ? `<span class="tag">資料</span>` : "",
    ].join("");
    const corrBtn = m.corr || (m.lesson && !m.me) ? `<button class="btn" style="margin-top:4px" data-room="${m.corr ? "corr" : "chat"}">添削ルームで開く →</button>` : "";
    return `<div class="msg ${m.me ? "me" : ""} ${m.note ? "note" : ""} ${m.line ? "line" : ""}" tabindex="0" data-i="${m.id}" aria-label="${esc(m.who)} ${esc(fmtTime(m.at))}：${esc(String(m.text).slice(0, 60))}。選んで T でタスク、F で転送、C でコピー、S で資料、Enter で操作の一覧">
      <span class="hb" role="toolbar" aria-label="このメッセージの操作"><button data-h="task">タスクへ</button><button data-h="keep">${m.kept ? "資料から外す" : "資料へ"}</button><button data-h="fwd">転送</button><button data-h="copy">コピー</button><button data-h="more" aria-label="ほかの操作">…</button></span>
      <div><div class="meta">${esc(m.who)}・${hm(m.at)}</div><div class="bub">${link(m.text)}${m.images && m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="送られた画像">`).join("")}</div>` : ""}</div>${tags ? `<div class="tags">${tags}</div>` : ""}${corrBtn}</div></div>`;
  }
  // 見出し（サイトと LINE で共通）
  function headHtml() {
    const isLater = !!D.later_until, lk = D.line && D.line.links.length;
    return `<div class="mh"><button class="btn back" id="toList" aria-label="一覧へ戻る">←</button><button class="btn md" id="leftBtn" aria-expanded="${app.classList.contains("leftopen")}">一覧</button>${av(D.id, D.card.name)}
      <div style="min-width:0"><h1>${esc(D.card.name || D.person.email)}</h1><small>${esc(D.card.email)}${isLater ? `・後で（${esc(fmtTime(D.later_until))} まで）` : ""}・<a href="#person/${D.id}" id="toPerson">顧客一覧で開く →</a></small></div>
      <span class="seg" role="tablist" aria-label="やりとりの場所"><button role="tab" data-ch="site" aria-selected="${chan === "site"}">サイト</button><button role="tab" data-ch="line" aria-selected="${chan === "line"}">LINE${lk ? "" : '<span class="un">未接続</span>'}</button></span><span class="g"></span>
      <button class="btn" id="fbtn" aria-label="フォルダ：${esc(fname(D.folder_id) || "なし")}">${D.folder_id ? "▸ " + esc(fname(D.folder_id)) : "フォルダへ"}</button>
      <button class="btn" id="later">${isLater ? "後でを外す" : "後で"}</button>
      <button class="btn" id="sideBtn" aria-expanded="${sideOpen}"><span class="lg">${sideOpen ? "右を閉じる" : "右を開く"}</span><span class="sm">顧客と履歴</span></button></div>`;
  }
  function wireHead() {
    const isLater = !!D.later_until;
    $("#toList").onclick = () => setView("list");
    $("#toPerson").onclick = (e) => { e.preventDefault(); openPerson(D.id); };
    $$("[data-ch]").forEach((b) => {
      b.tabIndex = b.dataset.ch === chan ? 0 : -1;
      b.onclick = () => switchChan(b.dataset.ch);
      b.onkeydown = (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); switchChan(chan === "site" ? "line" : "site"); } };
    });
    $("#leftBtn").onclick = () => { const o = app.classList.toggle("leftopen"); $("#leftBtn").setAttribute("aria-expanded", o); if (o) ($(".left .ci[aria-current=true]") || $(".left .sv")).focus(); };
    $("#fbtn").onclick = (e) => folderDlg(D.id, e.currentTarget);
    $("#later").onclick = (e) => isLater ? setLater(null, e.currentTarget) : laterDlg(e.currentTarget);
    $("#sideBtn").onclick = () => {
      if (narrow()) { if (app.dataset.v === "side") { setView("chat"); return; } setView("side"); $("#t-hist")?.focus(); return; }
      sideOpen = !sideOpen; app.classList.toggle("noside", !sideOpen); chan === "line" ? drawLine() : drawMid(); $("#sideBtn").focus();
    };
  }
  async function switchChan(c) {
    if (c === chan) return;
    chan = c;
    try { history.replaceState(null, "", `#chat/${D.id}${c === "line" ? "/line" : ""}`); } catch (_) {}
    if (c === "line") await openLineChan(); else drawMid();
    $(`[data-ch="${c}"]`)?.focus();
  }

  // ---------- LINE（C2a-2）：結ばれた人のやりとりを読む・返す。結ばれていなければ友だちから選んで結ぶ ----------
  async function openLineChan() {
    $("#mid").innerHTML = headHtml() + '<div class="msgs"><p class="welcome">LINE を読んでいます…</p></div>'; wireHead();
    LN = await call(`/api/admin/chat/${D.id}/line`);
    if (chan === "line") drawLine();
  }
  function drawLine() {
    if (!LN || !LN.ok) { $("#mid").innerHTML = headHtml() + `<div class="msgs"><p class="welcome">LINE を読めませんでした（${esc((LN && (LN.error || LN.status)) || "")}）</p></div>`; wireHead(); return; }
    if (!LN.linked) { drawLinkPick(); return; }
    let last = "";
    const row = (m) => {
      if (m.kind === "notice") return `<div class="day">${esc(m.text)}・${hm(m.at)}</div>`;
      const me = m.from === "me";
      return `<div class="msg ${me ? "me" : ""} lmsg" tabindex="0" data-lt="${esc(m.text)}"><div><div class="meta">${me ? "シアニン（LINE）" + (m.by === "AI" ? "・AI から" : "") : esc(LN.name || D.card.name || "相手") + "（LINE）"}・${hm(m.at)}</div><div class="bub">${esc(m.text)}</div>${m.ok === false ? '<div class="tags"><span class="tag warn">送れなかった</span></div>' : ""}</div></div>`;
    };
    $("#mid").innerHTML = headHtml() + `<div class="lbar"><span class="lg2" aria-hidden="true">LINE</span>アカウント「${esc(LN.account)}」の友だち「${esc(LN.name || "（名前を読めない）")}」と結ばれています<button class="lk" id="unlink">結びを外す</button></div>
      <div class="msgs" id="msgs">${LN.messages.map((m) => { const d = dayOf(m.at); const h = d !== last ? `<div class="day">${d}</div>` : ""; last = d; return h + row(m); }).join("") || '<p class="welcome">マーケくんが受けた LINE のやりとりはまだありません。<br>（UTAGE にある前のやりとりは出ません）</p>'}</div>
      ${LN.blocked ? '<div class="comp"><p class="empty">ブロックされているので送れません</p></div>' : `<div class="comp linemode"><label class="sr" for="lcomp">LINE で返す文</label><textarea id="lcomp" maxlength="2000" placeholder="LINE で返す（今月の送信数を 1 通使う）"></textarea>
      <div class="row"><span class="g">⌘／Ctrl＋Enter で送信・相手の LINE に届きます</span><button class="btn pri line" id="lsend">LINE で送る</button></div></div>`}`;
    wireHead();
    $("#unlink").onclick = (e) => {
      lastFocus = e.currentTarget;
      dialog(`<h2>LINE の結びを外す</h2><p style="margin:0;font-size:13px">「${esc(D.card.name || D.card.email)}」と LINE の友だち「${esc(LN.name || "")}」の結びを外します。やりとりは消えません。あとで結び直せます。</p><p class="err" id="uerr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>外す</button></div>`, async (d) => {
        const r = await call(`/api/admin/chat/${D.id}/line`, "POST", { account: LN.account, unlink: true });
        if (!r.ok) { $("#uerr", d).textContent = errText(r); return false; }
        await reload(); await openLineChan(); toast("LINE の結びを外しました");
      });
    };
    $$(".lmsg").forEach((el) => (el.oncontextmenu = (e) => { e.preventDefault(); navigator.clipboard.writeText(el.dataset.lt).then(() => toast("コピーしました"), () => toast("コピーできませんでした")); }));
    if ($("#lsend")) {
      const send = async () => {
        const t = $("#lcomp").value.trim();
        if (!t) { toast("文が空です"); $("#lcomp").focus(); return; }
        $("#lsend").disabled = true;
        const r = await call("/api/admin/line/reply", "POST", { account: LN.account, user: LN.user, text: t });
        $("#lsend").disabled = false;
        if (!r.ok) { toast(errText(r)); return; }
        await openLineChan(); $("#lcomp")?.focus(); toast("LINE で送りました");
      };
      $("#lsend").onclick = send;
      $("#lcomp").onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } };
    }
    const box = $("#msgs"); if (box) box.scrollTop = box.scrollHeight;
  }
  async function drawLinkPick(account) {
    const accs = LN.accounts || [];
    const acc = account || (accs.includes("shianin") ? "shianin" : accs[0]); // シアニンの LINE を先に
    $("#mid").innerHTML = headHtml() + `<div class="msgs"><div class="pick"><h2>「${esc(D.card.name || D.card.email)}」はまだ LINE と結ばれていません</h2>
      <p>結ぶと、ここで LINE のやりとりを読んで返せます。この人の LINE の友だちを選んでください。人違いで結ぶと別の人に LINE が届くので、名前とやりとりを見て選んでください。</p>
      ${accs.length > 1 ? `<label for="lacc">LINE のアカウント</label><select id="lacc">${accs.map((a) => `<option ${a === acc ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>` : ""}
      <label for="lq">友だちを探す</label><input id="lq" type="search" placeholder="LINE の名前で絞る"><div id="lfr"><p class="empty">友だちを読んでいます…</p></div></div></div>`;
    wireHead();
    if ($("#lacc")) $("#lacc").onchange = () => drawLinkPick($("#lacc").value);
    if (!acc) { $("#lfr").innerHTML = '<p class="empty">LINE のアカウントがつながっていません</p>'; return; }
    const r = await call("/api/admin/line?account=" + encodeURIComponent(acc));
    if (!$("#lfr")) return;
    if (!r.ok) { $("#lfr").innerHTML = `<p class="empty">読めませんでした（${esc(r.error || r.status)}）</p>`; return; }
    const free = (r.friends || []).filter((f) => !f.linked && !f.blocked);
    const draw = () => {
      const q = $("#lq").value.trim();
      $("#lfr").innerHTML = free.filter((f) => !q || String(f.name || "").includes(q)).slice(0, 40).map((f) => `<button class="opt" data-u="${esc(f.user)}">${av(f.user, f.name)}<span style="min-width:0"><b>${esc(f.name || "（名前を読めない）")}</b><small>${f.last_from === "me" ? "送った：" : ""}${esc(f.last_text || "やりとりなし")}${f.last_at ? "・" + esc(fmtTime(f.last_at)) : ""}</small></span></button>`).join("")
        || `<p class="empty">${free.length ? "合う友だちがいません" : "まだ結ばれていない友だちがいません"}</p>`;
      $$("[data-u]", $("#lfr")).forEach((b) => (b.onclick = () => {
        const f = free.find((x) => x.user === b.dataset.u); lastFocus = b;
        dialog(`<h2>LINE と結ぶ</h2><p style="margin:0;font-size:13px">「${esc(D.card.name || D.card.email)}」（${esc(D.card.email)}）と、LINE の友だち「${esc(f.name || "（名前を読めない）")}」を結びます。このあと、ここから送る LINE はこの友だちに届きます。</p><p class="err" id="lerr2" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>結ぶ</button></div>`, async (d) => {
          const x = await call(`/api/admin/chat/${D.id}/line`, "POST", { account: acc, user: f.user });
          if (!x.ok) { $("#lerr2", d).textContent = errText(x) + (x.other && x.other.name ? `（${x.other.name}）` : ""); return false; }
          await reload(); await openLineChan(); toast("LINE と結びました");
        });
      }));
    };
    $("#lq").oninput = draw; draw();
  }

  function drawMid(focusId) {
    const its = items(); let last = "";
    $("#mid").innerHTML = headHtml() + `
    <div class="msgs" id="msgs">${its.map((m) => { const d = dayOf(m.at); const h = d !== last ? `<div class="day">${d}</div>` : ""; last = d; return h + msgHtml(m); }).join("") || '<p class="welcome">やり取りはまだありません。下から最初のメッセージを送れます。</p>'}</div>
    <div class="comp ${noteMode ? "notemode" : ""}"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap"><span class="mode" role="group" aria-label="書くもの"><button aria-pressed="${!noteMode}" data-m="reply">返信</button><button aria-pressed="${noteMode}" data-m="note">メモ（自分だけ）</button></span><span style="font-size:12px;color:var(--muted)">${noteMode ? "メモは生徒には見えません" : "生徒の画面とスマホに届きます"}</span></div>
      <label class="sr" for="comp">${noteMode ? "メモ" : "メッセージ"}</label><textarea id="comp" maxlength="8000" placeholder="${noteMode ? "自分だけのメモを書く（生徒には見えない）" : "メッセージを書く"}"></textarea>
      <div class="row"><span class="g">⌘／Ctrl＋Enter で${noteMode ? "メモを残す" : "送信"}・Enter は改行・<span class="kbd">?</span> でキーの一覧</span><button class="btn pri" id="send">${noteMode ? "メモを残す" : "送信"}</button></div></div>`;
    wireHead();
    $$("[data-m]").forEach((b) => (b.onclick = () => { const keep = $("#comp").value; noteMode = b.dataset.m === "note"; drawMid(); $("#comp").value = keep; $(`[data-m="${b.dataset.m}"]`).focus(); }));
    $("#send").onclick = send;
    $("#comp").onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } };
    $$(".imgs img[data-key]").forEach(async (img) => { try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), getToken()); } catch (_) { img.alt = "画像を読めませんでした"; } });
    $$("[data-room]").forEach((b) => (b.onclick = () => openRoom(D.id, b.dataset.room)));
    $$("[data-h]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const el = b.closest(".msg"); lastFocus = el; const m = its.find((x) => String(x.id) === el.dataset.i);
      if (b.dataset.h === "more") { const r = b.getBoundingClientRect(); menu(m, r.left, r.bottom + 4, el); } else act(b.dataset.h, m); }));
    $$(".msg").forEach((el) => {
      const m = its.find((x) => String(x.id) === el.dataset.i);
      el.oncontextmenu = (e) => { e.preventDefault(); menu(m, e.clientX, e.clientY, el); };
      el.onkeydown = (e) => {
        if (e.target !== el) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const all = $$(".msg"); const k = all.indexOf(el) + (e.key === "ArrowDown" ? 1 : -1); if (all[k]) all[k].focus(); return; }
        const one = { t: "task", f: "fwd", c: "copy", s: "keep" }[e.key.toLowerCase()];
        if (one && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); lastFocus = el; act(one, m); return; }
        if (e.key === "Enter" || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = el.getBoundingClientRect(); menu(m, r.left + 40, r.bottom - 4, el); }
      };
      let t; el.ontouchstart = (e) => { t = setTimeout(() => { const p = e.touches[0]; menu(m, p.clientX, p.clientY, el); }, 550); }; el.ontouchend = el.ontouchmove = () => clearTimeout(t);
    });
    const box = $("#msgs"); box.scrollTop = box.scrollHeight;
    if (focusId) { const el = $(`.msg[data-i="${focusId}"]`); if (el) { el.classList.add("hit"); el.scrollIntoView({ block: "center" }); el.focus(); } }
  }
  async function send() {
    const box = $("#comp"), t = box.value.trim();
    if (!t) { toast(noteMode ? "メモが空です" : "メッセージが空です"); box.focus(); return; }
    $("#send").disabled = true;
    const r = noteMode ? await call(`/api/admin/chat/${D.id}/note`, "POST", { text: t }) : await call(`/api/admin/rooms/${D.id}/message`, "POST", { text: t });
    $("#send").disabled = false;
    if (!r.ok || r.found === false) { toast(errText(r)); box.focus(); return; }
    const wasNote = noteMode;
    await openChat(D.id); await loadList();
    $("#comp")?.focus(); toast(wasNote ? "メモを残しました（生徒には見えません）" : "送信しました");
  }

  // ---------- 右 ----------
  function cardHtml() {
    const c = D.card;
    const N = D.names || { real: c.name, nickname: "", line: [] };
    return `<div class="card"><div class="h"><b>${esc(c.name || c.email)}</b><a href="#person/${D.id}" id="cust">顧客一覧へ移動 →</a></div><dl>
      <dt>本名</dt><dd>${esc(N.real || "—")}</dd>
      <dt>ニックネーム</dt><dd>${N.nickname ? esc(N.nickname) : '<span style="color:var(--muted)">まだ無い</span>'} <button class="lk" id="nickEdit">編集</button></dd>
      ${N.line.length ? `<dt>LINE 名</dt><dd>${N.line.map((l) => esc(l.name || "（読めない）")).join("、")}</dd>` : ""}
      <dt>段階</dt><dd>${esc(c.stage || "—")}</dd>
      <dt>権利</dt><dd>${c.entitlements.length ? c.entitlements.map((x) => `<span class="ent">${esc(KEY_LABEL[x.key] || x.key)}${x.expires_at ? "（" + esc(fmtTime(x.expires_at).slice(0, 10)) + " まで）" : ""}</span>`).join("") : "なし"}</dd>
      <dt>次の予約</dt><dd>${c.next_booking ? `${esc(c.next_booking.title)} ${esc(fmtTime(c.next_booking.slot))}` : "—"}</dd>
      <dt>最後の面談</dt><dd>${c.last_meeting ? esc(fmtTime(c.last_meeting).slice(0, 10)) : "—"}</dd>
      ${(D.groups || []).length ? `<dt>グループ</dt><dd>${D.groups.map((g) => `<button class="lk" data-og="${g.id}">${esc(g.name)}</button>`).join("")}</dd>` : ""}
      <dt>最後の購入</dt><dd>${c.last_purchase ? `${esc(c.last_purchase.name)}（${esc(fmtTime(c.last_purchase.at).slice(0, 10))}）` : "—"}</dd></dl></div>`;
  }
  function evDetail(h) {
    const p = h.payload || {};
    const bits = [p.product_name, p.type_title, p.title, p.subject, p.form_title, p.key, p.label, p.lesson_title, p.slot ? fmtTime(p.slot) : "", p.amount != null && /purchase|subscription/.test(h.type) ? Number(p.amount).toLocaleString() + " 円" : "", p.mode === "test" ? "試し" : ""].filter(Boolean);
    return bits.map((x) => esc(String(x).slice(0, 60))).join("・");
  }
  function drawRight() {
    if (!D) { $("#right").innerHTML = ""; return; }
    const full = app.classList.contains("full");
    $("#right").innerHTML = `<button class="split" id="split" role="separator" aria-orientation="vertical" aria-label="右の幅" aria-valuemin="300" aria-valuemax="640" aria-valuenow="${parseInt(getComputedStyle(app).getPropertyValue("--rw")) || 360}"></button>
      <button class="grab" id="grab" aria-label="${full ? "縮める" : "広げる"}"><i></i>${full ? "縮める" : "広げる"}</button>${cardHtml()}
      <div class="tabs" role="tablist"><button class="btn back" id="toChat" aria-label="チャットへ戻る">←</button><button role="tab" id="t-hist" aria-selected="${tab === "hist"}" aria-controls="pane" data-tab="hist">履歴</button><button role="tab" id="t-vault" aria-selected="${tab === "vault"}" aria-controls="pane" data-tab="vault">資料 <span class="n">${D.vault.length}</span></button><button role="tab" id="t-ai" aria-selected="${tab === "ai"}" aria-controls="pane" data-tab="ai">AI</button><span class="g"></span></div>
      <div class="pane" id="pane" role="tabpanel" tabindex="-1"></div>`;
    $("#cust").onclick = (e) => { e.preventDefault(); openPerson(D.id); };
    $$("[data-og]").forEach((b) => (b.onclick = () => openGroup(b.dataset.og)));
    $("#nickEdit").onclick = (e) => { lastFocus = e.currentTarget; const now = (D.names || {}).nickname || "";
      dialog(`<h2>ニックネーム</h2><p style="margin:0;color:var(--muted);font-size:13px">グループでは、ほかの生徒にこの名前だけが出ます（本名は出ません）。生徒も自分で変えられます。空にすると消します。</p><label for="nk">ニックネーム（20 字まで）</label><input id="nk" maxlength="20" value="${esc(now)}"><p class="err" id="nkerr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>保存</button></div>`, async (d) => {
        const r = await call(`/api/admin/chat/${D.id}/nickname`, "POST", { nickname: $("#nk", d).value });
        if (!r.ok) { $("#nkerr", d).textContent = r.error === "bad_nickname" ? "20 字まで・メールや < > は使えません" : errText(r); return false; }
        D.names = { ...(D.names || {}), nickname: r.nickname }; drawRight(); toast(r.nickname ? "ニックネームを保存しました" : "ニックネームを削除しました"); }); };
    $("#toChat").onclick = () => { app.classList.remove("full"); setView("chat"); };
    $("#grab").onclick = () => { const f = app.classList.toggle("full"); app.style.setProperty("--sh", f ? "86vh" : "52vh"); drawRight(); $("#grab").focus(); };
    const sp = $("#split");
    const setW = (w) => { w = Math.max(300, Math.min(640, Math.round(w))); app.style.setProperty("--rw", w + "px"); sp.setAttribute("aria-valuenow", w); try { localStorage.setItem("chat-rw", w); } catch (_) {} };
    sp.onpointerdown = (e) => { e.preventDefault(); sp.setPointerCapture(e.pointerId); const right = app.getBoundingClientRect().right; sp.onpointermove = (ev) => setW(right - ev.clientX); sp.onpointerup = () => { sp.onpointermove = null; }; };
    sp.onkeydown = (e) => { const w = parseInt(sp.getAttribute("aria-valuenow")); if (e.key === "ArrowLeft") { e.preventDefault(); setW(w + 24); } if (e.key === "ArrowRight") { e.preventDefault(); setW(w - 24); } };
    const tabs = $$("[data-tab]");
    tabs.forEach((b) => { b.tabIndex = b.dataset.tab === tab ? 0 : -1; b.onclick = () => { tab = b.dataset.tab; drawRight(); $(`[data-tab="${tab}"]`).focus(); };
      b.onkeydown = (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const T = ["hist", "vault", "ai"]; tab = T[(T.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3]; drawRight(); $(`[data-tab="${tab}"]`).focus(); } }; });
    tab === "vault" ? drawVault() : tab === "ai" ? drawAi($("#pane")) : drawHist();
  }
  // 右の「資料」：入れたもの・リンク・画像。言葉で絞る（この人の中）
  function drawVault() {
    const all = D.vault, K = [["all", "すべて"], ["saved", "入れたもの"], ["link", "リンク"], ["image", "画像"]];
    const q = vq.trim();
    const hay = (v) => [v.text, v.url, v.from].filter(Boolean).join(" ");
    const shown = all.filter((v) => (vk === "all" || v.kind === vk) && (!q || hay(v).includes(q)));
    const row = (v) => {
      const go = `<button class="lk" data-go="${v.event_id}">メッセージへ</button>`;
      if (v.kind === "image") return `<div class="vi"><img data-key="${esc(v.key)}" alt="${esc(v.from)}が送った画像"><div><small>${esc(v.from)}・${esc(fmtTime(v.at))}</small>${go}</div></div>`;
      if (v.kind === "link") return `<div class="vi"><span class="vic" aria-hidden="true">↗</span><div><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url.replace(/^https?:[/][/]/, "").slice(0, 70))}</a><small>${esc(v.from)}・${esc(fmtTime(v.at))}</small>${go}</div></div>`;
      return `<div class="vi saved"><span class="vic" aria-hidden="true">★</span><div><p>${esc(v.text.slice(0, 200))}</p><small>${esc(v.from)}・${esc(fmtTime(v.at))}</small>${go}<button class="lk" data-off="${v.event_id}">資料から外す</button></div></div>`;
    };
    $("#pane").innerHTML = `<p class="who">送られたリンクと画像は自動で集まります。メッセージは右クリックの「資料に入れる」（S）で残せます</p>
      <label class="sr" for="vq">資料を探す</label><input id="vq" type="search" placeholder="資料の中を探す" value="${esc(vq)}">
      <div class="chips" role="group" aria-label="出す種類">${K.map(([k, t]) => `<button class="chip" aria-pressed="${vk === k}" data-vk="${k}">${t} ${k === "all" ? all.length : all.filter((v) => v.kind === k).length}</button>`).join("")}</div>
      ${shown.map(row).join("") || `<p class="empty">${all.length ? "合う資料がありません" : "まだ資料はありません"}</p>`}`;
    $("#vq").oninput = () => { vq = $("#vq").value; const p = $("#vq").selectionStart; drawVault(); const i = $("#vq"); i.focus(); i.setSelectionRange(p, p); };
    $$("[data-vk]").forEach((b) => (b.onclick = () => { vk = b.dataset.vk; drawVault(); $(`[data-vk="${vk}"]`).focus(); }));
    $$("[data-go]", $("#pane")).forEach((b) => (b.onclick = () => { const el = $(`.msg[data-i="${b.dataset.go}"]`); if (narrow()) setView("chat"); if (el) { $$(".msg.hit").forEach((x) => x.classList.remove("hit")); el.classList.add("hit"); el.scrollIntoView({ block: "center" }); el.focus(); } }));
    $$("[data-off]", $("#pane")).forEach((b) => (b.onclick = () => keep({ id: Number(b.dataset.off), kept: true })));
    $$("#pane img[data-key]").forEach(async (img) => { try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), getToken()); } catch (_) { img.alt = "画像を読めませんでした"; } });
  }
  function drawHist() {
    const rows = D.history, cats = D.cats.filter((k) => rows.some((r) => r.cat === k));
    const shown = rows.filter((r) => !evOff.has(r.cat));
    $("#pane").innerHTML = `<p class="who">${esc(D.card.name || "この人")} が各サービスでしたこと（新しい順）</p>
      <div class="chips" role="group" aria-label="出す種類">${cats.map((k) => `<button class="chip" aria-pressed="${!evOff.has(k)}" data-k="${esc(k)}">${esc(k)} ${rows.filter((r) => r.cat === k).length}</button>`).join("")}</div>
      ${shown.map((h) => `<div class="ev"><span class="ic" style="background:${CATCOL[h.cat] || "#6b6259"}" aria-hidden="true">${esc(h.cat.slice(0, 1))}</span><div><b>${esc(labelOf(h.type))}</b><small>${evDetail(h) ? evDetail(h) + "・" : ""}${esc(fmtTime(h.at))}${h.actor === "admin" ? "・シアニン" : h.actor === "mcp" ? "・AI" : ""}</small></div></div>`).join("") || `<p class="empty">${rows.length ? "出す種類が選ばれていません。上のチップで選んでください" : "まだ出来事はありません"}</p>`}`;
    $$("[data-k]", $("#pane")).forEach((b) => (b.onclick = () => { const k = b.dataset.k; evOff.has(k) ? evOff.delete(k) : evOff.add(k); drawHist(); $(`[data-k="${CSS.escape(k)}"]`, $("#pane")).focus(); }));
  }

  // ---------- 右クリックのメニュー・操作 ----------
  function menu(m, x, y, from) {
    closeMenu(); lastFocus = from; menuAt = Date.now();
    const el = document.createElement("div"); el.className = "menu"; el.setAttribute("role", "menu"); el.setAttribute("aria-label", "メッセージの操作");
    el.innerHTML = `<button role="menuitem" data-a="copy">コピー<small>C</small></button><button role="menuitem" data-a="fwd">転送（メモとして）…<small>F</small></button><button role="menuitem" data-a="keep">${m.kept ? "資料から外す" : "資料に入れる"}<small>S</small></button><hr>
      <div class="mh2" aria-hidden="true">連携</div><button role="menuitem" data-a="task">タスクへ追加（TaskMaster）…<small>T</small></button><button role="menuitem" data-a="person">顧客一覧で開く →</button><hr>
      <button role="menuitem" data-a="ai">AI で分析</button><button role="menuitem" data-a="claude">Claude に聞く（依頼文をコピー）</button><button role="menuitem" data-a="later">このチャットを後で見る…</button>${m.corr || (m.lesson && !m.me) ? '<button role="menuitem" data-a="room">添削ルームで開く →</button>' : ""}`;
    root.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight; el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px"; el.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
    const its = $$("[role=menuitem]", el); its[0].focus();
    el.onkeydown = (e) => { const k = its.indexOf(root.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); its[(k + 1) % its.length].focus(); } if (e.key === "ArrowUp") { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
      if (e.key === "Escape") { e.preventDefault(); closeMenu(true); } if (e.key === "Tab") e.preventDefault(); };
    its.forEach((b) => (b.onclick = () => { closeMenu(); act(b.dataset.a, m); }));
  }
  function closeMenu(back) { const o = $(".menu"); if (o) o.remove(); if (back && lastFocus && lastFocus.isConnected) lastFocus.focus(); }
  root.addEventListener("mousedown", (e) => { if (!e.target.closest(".menu")) closeMenu(); });
  root.addEventListener("scroll", () => { if (Date.now() - menuAt > 300) closeMenu(); }, true);

  function act(a, m) {
    if (a === "copy") { navigator.clipboard.writeText(m.text).then(() => toast("コピーしました"), () => toast("コピーできませんでした。文を選んでコピーしてください")); if (lastFocus) lastFocus.focus(); return; }
    if (a === "room") return openRoom(D.id, m.corr ? "corr" : "chat");
    if (a === "later") return laterDlg(lastFocus);
    if (a === "ai") return askAi("message", { message_id: m.id });
    if (a === "claude") {
      const t = `マーケくんのチャット（person_id: ${D.id}・${D.card.name || D.card.email}）を get_chat で読み、次のメッセージ（event_id: ${m.id}）について、やり取りと履歴を踏まえて分析し、返し方の案を出してください。\n\n「${m.text.slice(0, 300)}」`;
      navigator.clipboard.writeText(t).then(() => toast("Claude に貼る依頼文をコピーしました"), () => dialog(`<h2>Claude に貼る依頼文</h2><textarea rows="7" readonly>${esc(t)}</textarea><div class="acts"><button class="btn pri" data-x>閉じる</button></div>`));
      if (lastFocus) lastFocus.focus(); return;
    }
    if (a === "fwd") return fwdDlg(m);
    if (a === "task") return taskDlg(m);
    if (a === "keep") return keep(m);
    if (a === "person") return openPerson(D.id);
  }
  async function keep(m) {
    const off = !!m.kept;
    const r = await call(`/api/admin/chat/${D.id}/keep`, "POST", { event_id: m.id, off });
    if (!r.ok) { toast(errText(r)); return; }
    await reload(m.id);
    toast(off ? "資料から外しました" : "資料に入れました（右の「資料」）", off ? null : () => keep({ id: m.id, kept: true }));
  }
  // 1 人分を読み直して、真ん中と右を描き直す（読んだ印は付く）
  async function reload(focusId) {
    const r = await call("/api/admin/chat/" + D.id); if (!r.ok || !r.found) return;
    const id = D.id; D = r; D.id = id; if (chan === "site") drawMid(focusId); drawRight();
  }

  // ---------- フォルダ ----------
  function folderDlg(pid, opener) {
    const c = L && L.chats.find((x) => x.person_id === pid); const curF = D && D.id === pid ? D.folder_id : c ? c.folder_id : null;
    lastFocus = opener || lastFocus;
    const name = c ? nameOf(c) : D ? D.card.name || D.card.email : "";
    dialog(`<h2>「${esc(name)}」をフォルダに入れる</h2>${(L ? L.folders : []).map((f) => `<button class="opt" data-pf="${f.id}" aria-pressed="${curF === f.id}">▸ ${esc(f.name)}${curF === f.id ? "（いま）" : ""}</button>`).join("")}
      <button class="opt" data-pf="" aria-pressed="${!curF}">フォルダなし${!curF ? "（いま）" : ""}</button>
      <label for="nf">新しいフォルダを作って入れる</label><div style="display:flex;gap:6px"><input id="nf" maxlength="20" placeholder="例 NEXT 受講生"><button class="btn" id="nfb">作る</button></div>
      <p class="err" id="perr" role="alert"></p><div class="acts"><button class="btn" data-x>閉じる</button></div>`, null, (d, close) => {
      const put = async (fid) => { const r = await call(`/api/admin/chat/${pid}/folder`, "POST", { folder_id: fid || null }); if (!r.ok) { $("#perr", d).textContent = errText(r); return; }
        close(); await loadList(); if (D && D.id === pid) { D.folder_id = r.folder_id; chan === "line" ? drawLine() : drawMid(); } toast(fid ? `「${fname(fid)}」に入れました` : "フォルダから外しました"); };
      $$("[data-pf]", d).forEach((b) => (b.onclick = () => put(b.dataset.pf)));
      $("#nfb", d).onclick = async () => { const r = await call("/api/admin/chat/folders", "POST", { name: $("#nf", d).value }); if (!r.ok) { $("#perr", d).textContent = errText(r); $("#nf", d).focus(); return; } await loadList(); put(r.folder.id); };
      $("#nf", d).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#nfb", d).click(); } };
    });
  }
  function foldersDlg(opener) {
    lastFocus = opener || lastFocus;
    dialog(`<h2>フォルダを編集</h2><p style="margin:0;color:var(--muted);font-size:13px">削除しても中のチャットは消えません（「フォルダなし」に戻ります）。</p><div id="fl2"></div>
      <label for="nf2">新しいフォルダ</label><div style="display:flex;gap:6px"><input id="nf2" maxlength="20" placeholder="例 NEXT 受講生"><button class="btn" id="nfb2">作る</button></div>
      <p class="err" id="ferr2" role="alert"></p><div class="acts"><button class="btn pri" data-x>閉じる</button></div>`, null, (d) => {
      const err = (r) => { $("#ferr2", d).textContent = errText(r); };
      const done = async (focusSel) => { await loadList(); draw(); const el = focusSel && $(focusSel, d); if (el) el.focus(); };
      const draw = () => {
        const fs = L.folders;
        $("#fl2", d).innerHTML = fs.map((f, k) => `<div class="frow" data-row="${f.id}"><label class="sr" for="fn-${f.id}">${esc(f.name)} の名前</label><input id="fn-${f.id}" maxlength="20" value="${esc(f.name)}"><small>${f.count}</small>
          <button class="btn" data-up="${f.id}" aria-label="${esc(f.name)} を上へ" ${k === 0 ? "disabled" : ""}>↑</button><button class="btn" data-dn="${f.id}" aria-label="${esc(f.name)} を下へ" ${k === fs.length - 1 ? "disabled" : ""}>↓</button><button class="btn" data-rm="${f.id}" aria-label="${esc(f.name)} を削除">削除</button></div>`).join("") || '<p class="empty">フォルダはまだありません</p>';
        $$("[id^=fn-]", d).forEach((i) => { const id = i.id.slice(3); const save = async () => { const f = L.folders.find((x) => x.id === id); if (!f || i.value.trim() === f.name) return; const r = await call("/api/admin/chat/folders", "POST", { id, name: i.value }); if (!r.ok) { err(r); i.value = f.name; return; } $("#ferr2", d).textContent = ""; await loadList(); toast("名前を変えました"); };
          i.onchange = save; i.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); i.blur(); } }; });
        $$("[data-up],[data-dn]", d).forEach((b) => (b.onclick = async () => { const id = b.dataset.up || b.dataset.dn, mv = b.dataset.up ? "up" : "down"; const r = await call("/api/admin/chat/folders", "POST", { id, move: mv }); if (!r.ok) return err(r); await done(`[data-${b.dataset.up ? "up" : "dn"}="${id}"]:not([disabled])`); }));
        $$("[data-rm]", d).forEach((b) => (b.onclick = async () => { const f = L.folders.find((x) => x.id === b.dataset.rm); if (!f) return;
          if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "本当に削除"; b.classList.add("danger"); return; }
          const r = await call("/api/admin/chat/folders", "POST", { id: f.id, remove: true }); if (!r.ok) return err(r); if (fsel === f.id) fsel = null; await done("#nf2"); toast(`「${f.name}」を削除しました（中のチャットは「フォルダなし」に）`); }));
      };
      $("#nfb2", d).onclick = async () => { const r = await call("/api/admin/chat/folders", "POST", { name: $("#nf2", d).value }); if (!r.ok) { err(r); $("#nf2", d).focus(); return; } $("#nf2", d).value = ""; $("#ferr2", d).textContent = ""; await done("#nf2"); toast(`「${r.folder.name}」を作りました`); };
      $("#nf2", d).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#nfb2", d).click(); } };
      draw();
    });
  }
  function fwdDlg(m) {
    const others = (L ? L.chats : []).filter((c) => c.person_id !== D.id);
    dialog(`<h2>転送（メモとして）</h2><p style="margin:0;color:var(--muted);font-size:13px">選んだチャットに、この文をシアニンだけのメモとしてコピーします。相手の生徒には見えません。</p>
      <label for="fq">チャットを探す</label><input id="fq" type="search" placeholder="名前で絞る"><div id="fl"></div><p class="err" id="ferr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button></div>`, null, (d, close) => {
      const draw = () => { const q = $("#fq", d).value.trim(); $("#fl", d).innerHTML = others.filter((c) => !q || nameOf(c).includes(q)).slice(0, 30).map((c) => `<button class="opt" data-to="${c.person_id}">${av(c.person_id, nameOf(c))}${esc(nameOf(c))}</button>`).join("") || '<p class="empty">合うチャットがありません</p>';
        $$("[data-to]", d).forEach((b) => (b.onclick = async () => { const r = await call(`/api/admin/chat/${D.id}/forward`, "POST", { event_id: m.id, to_person_id: b.dataset.to });
          if (!r.ok) { $("#ferr", d).textContent = errText(r); return; } close(); toast(`「${b.textContent.trim()}」のチャットにメモとして転送しました`); })); };
      $("#fq", d).oninput = draw; draw();
    });
  }
  function taskDlg(m) {
    const tm = new Date(Date.now() + 864e5);
    dialog(`<h2>タスクへ追加（TaskMaster）</h2><label for="tt">タスクの名前</label><input id="tt" maxlength="300" value="${esc((D.card.name ? D.card.name + "さん：" : "") + m.text.replace(/\s+/g, " ").slice(0, 40))}">
      <label for="td">期限</label><input id="td" type="date" value="${ymd(tm)}"><p style="font-size:12px;color:var(--muted);margin:6px 0 0">タスクのリンクに、このメッセージへ戻る住所が付きます。プロジェクトは TaskMaster で振り分けてください。</p>
      <p class="err" id="terr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>追加</button></div>`, async (d) => {
      const title = $("#tt", d).value.trim();
      if (!title) { $("#terr", d).textContent = ERR.need_title; $("#tt", d).focus(); return false; }
      $("[data-ok]", d).disabled = true;
      const r = await call(`/api/admin/chat/${D.id}/task`, "POST", { event_id: m.id, title, deadline: $("#td", d).value || null });
      $("[data-ok]", d).disabled = false;
      if (!r.ok) { $("#terr", d).textContent = errText(r); return false; }
      D.tasks.push({ event_id: m.id, task_id: r.task_id, url: r.url }); drawMid(m.id);
      toast("TaskMaster にタスクを追加しました", null, r.url);
    });
  }
  function laterDlg(opener) {
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
    const now = new Date(), opts = [];
    if (now.getHours() < 17) opts.push(["今日の 18:00", at(now, 18)]);
    opts.push(["明日の 9:00", at(new Date(Date.now() + 864e5), 9)]);
    const mon = new Date(now); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); opts.push(["次の月曜の 9:00", at(mon, 9)]);
    opts.push(["1 週間後の 9:00", at(new Date(Date.now() + 7 * 864e5), 9)]);
    lastFocus = opener || lastFocus;
    dialog(`<h2>「${esc(D.card.name || D.card.email)}」を後で見る</h2><p style="margin:0;color:var(--muted);font-size:13px">選んだ時刻まで「要返信」から外します。時刻が来たら戻ります。</p>${opts.map(([t, d], k) => `<button class="opt" data-lt="${k}">${t}</button>`).join("")}<p class="err" id="lerr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button></div>`, null, (d, close) =>
      $$("[data-lt]", d).forEach((b) => (b.onclick = async () => { const r = await setLater(opts[+b.dataset.lt][1].toISOString()); if (r && r.ok) { close(); toast(`後でにしました（${opts[+b.dataset.lt][0]}）`, () => setLater(null)); } else if (r) $("#lerr", d).textContent = errText(r); })));
  }
  async function setLater(until, focusEl) {
    const r = await call(`/api/admin/chat/${D.id}/later`, "POST", { until });
    if (!r.ok) { toast(errText(r)); return r; }
    D.later_until = r.later_until; await loadList(); chan === "line" ? drawLine() : drawMid(); if (until === null) toast("「後で」から外しました");
    (focusEl && focusEl.isConnected ? focusEl : $("#later"))?.focus();
    return r;
  }

  // ---------- グループ（C2b） ----------
  const EMO = ["👍", "❤️", "😂", "🙏", "🔥", "👀"];
  const GERR = { not_found: "グループが見つかりません（アーカイブされたかもしれません）", need_sql: "グループの表がまだありません（SQL を流す前です）", bad_name: "グループの名前は 1〜40 字です", bad_thread: "スレッドの元のメッセージが見つかりません", bad_emoji: "そのスタンプは使えません" };
  const gErr = (r) => GERR[r.error] || errText(r);
  const mini = (who, name) => who === "cyanin" ? '<span class="av mini" style="background:#b45309" aria-hidden="true">シ</span>' : av(who, name).replace('class="av"', 'class="av mini"');
  async function openGroup(gid, focusId) {
    app.classList.remove("leftopen");
    cur = "group:" + gid; hits = null; D = null; chan = "site";
    try { history.replaceState(null, "", `#chat/group/${gid}${focusId ? "/" + focusId : ""}`); } catch (_) {}
    drawLeft();
    const r = await call("/api/admin/chat/groups/" + gid);
    if (!r.ok || !r.found) { $("#mid").innerHTML = `<div class="welcome">読めませんでした（${esc(gErr(r))}）</div>`; $("#right").innerHTML = ""; return; }
    G = r; G.id = gid;
    if (gTab === "thread" && !G.messages.some((m) => m.id === gThread)) gTab = "mem";
    const row = L && (L.groups || []).find((x) => x.id === gid); if (row) { row.unread_for_admin = 0; row.need = false; }
    drawLeft(); drawGroupMid(focusId); drawGroupRight(); setView("chat");
    live(`グループ「${G.group.name}」を開きました`);
  }
  function reactsHtml(m) { return (m.reactions || []).map((x) => `<button class="rc" data-re="${x.emoji}" aria-pressed="${x.mine}" title="${esc(x.names.join("、"))}" aria-label="${x.emoji} ${x.count}（${esc(x.names.join("、"))}）">${x.emoji} ${x.count}</button>`).join(""); }
  function gMsgHtml(m, inThread) {
    const imgs = m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="${esc(m.name)}が送った画像">`).join("")}</div>` : "";
    const th = !inThread && m.reply_count ? `<button class="th" data-th="${m.id}">${m.repliers.map((x) => mini(x.who, x.name)).join("")}<b>返信 ${m.reply_count} 件</b><span>最後 ${esc(fmtTime(m.last_reply_at))}</span></button>` : "";
    return `<div class="msg ${m.mine ? "me" : ""}" tabindex="0" data-g="${m.id}" aria-label="${esc(m.name)} ${esc(fmtTime(m.at))}：${esc(m.text.slice(0, 60))}。Enter で操作の一覧">
      ${inThread ? "" : `<span class="hb" role="toolbar" aria-label="このメッセージの操作"><button data-gh="react" aria-label="スタンプ">😊</button><button data-gh="thread">スレッドで返信</button><button data-gh="copy">コピー</button><button data-gh="more" aria-label="ほかの操作">…</button></span>`}
      ${m.mine ? "" : av(m.who, m.name)}<div style="min-width:0"><div class="meta">${esc(m.name)}・${hm(m.at)}</div><div class="bub">${esc(m.text)}${imgs}</div>
      <div class="rcs">${reactsHtml(m)}</div>${th}${m.mine && !inThread ? `<div class="read">既読 ${m.read}</div>` : ""}</div></div>`;
  }
  function drawGroupMid(focusId) {
    let last = "";
    $("#mid").innerHTML = `<div class="mh"><button class="btn back" id="toList" aria-label="一覧へ戻る">←</button><button class="btn md" id="leftBtn" aria-expanded="${app.classList.contains("leftopen")}">一覧</button>${av(G.id, G.group.name).replace('class="av"', 'class="av sq"')}
      <div style="min-width:0"><h1>${esc(G.group.name)}</h1><small>グループ・メンバー ${G.members.length} 人・生徒の画面とスマホに届きます</small></div><span class="g"></span>
      <button class="btn" id="gAdd">＋ メンバーを招待</button><button class="btn" id="gEdit">グループ設定</button>
      <button class="btn" id="sideBtn" aria-expanded="${sideOpen}"><span class="lg">${sideOpen ? "右を閉じる" : "右を開く"}</span><span class="sm">メンバーと資料</span></button></div>
      <div class="msgs" id="msgs">${G.messages.map((m) => { const d = dayOf(m.at); const h = d !== last ? `<div class="day">${d}</div>` : ""; last = d; return h + gMsgHtml(m); }).join("") || '<p class="welcome">まだメッセージはありません。最初のメッセージを送ると、入っている人の画面とスマホに届きます。</p>'}</div>
      <div class="comp"><label class="sr" for="gcomp">グループに送る</label><textarea id="gcomp" maxlength="8000" placeholder="「${esc(G.group.name)}」の全員に送る"></textarea>
      <div class="row"><span class="g">⌘／Ctrl＋Enter で送信・${G.members.length} 人の画面とスマホに届きます</span><button class="btn pri" id="gsend">送信</button></div></div>`;
    $("#toList").onclick = () => setView("list");
    $("#leftBtn").onclick = () => { const o = app.classList.toggle("leftopen"); $("#leftBtn").setAttribute("aria-expanded", o); };
    $("#sideBtn").onclick = () => { if (narrow()) { setView(app.dataset.v === "side" ? "chat" : "side"); return; } sideOpen = !sideOpen; app.classList.toggle("noside", !sideOpen); drawGroupMid(); $("#sideBtn").focus(); };
    $("#gAdd").onclick = (e) => memberDlg(e.currentTarget);
    $("#gEdit").onclick = (e) => groupEditDlg(e.currentTarget);
    const send = async () => { const t = $("#gcomp").value.trim(); if (!t) { toast("文が空です"); $("#gcomp").focus(); return; }
      $("#gsend").disabled = true; const r = await call(`/api/admin/chat/groups/${G.id}/message`, "POST", { text: t }); $("#gsend").disabled = false;
      if (!r.ok) { toast(gErr(r)); return; } await openGroup(G.id); $("#gcomp")?.focus(); toast(`送りました（${r.notified} 人に通知）`); };
    $("#gsend").onclick = send; $("#gcomp").onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } };
    wireGroupMsgs($("#msgs"), false);
    $$(".imgs img[data-key]", $("#mid")).forEach(async (img) => { try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), getToken()); } catch (_) { img.alt = "画像を読めませんでした"; } });
    const box = $("#msgs"); box.scrollTop = box.scrollHeight;
    if (focusId) { const el = $(`.msg[data-g="${focusId}"]`) || null; if (el) { el.classList.add("hit"); el.scrollIntoView({ block: "center" }); el.focus(); } else { const p = G.messages.find((m) => m.replies.some((x) => x.id === focusId)); if (p) { gThread = p.id; gTab = "thread"; } } }
  }
  const findG = (id) => { for (const m of G.messages) { if (m.id === id) return m; const r = m.replies.find((x) => x.id === id); if (r) return r; } return null; };
  function wireGroupMsgs(box, inThread) {
    $$("[data-re]", box).forEach((b) => (b.onclick = () => react(Number(b.closest(".msg").dataset.g), b.dataset.re)));
    $$("[data-th]", box).forEach((b) => (b.onclick = () => openThread(Number(b.dataset.th))));
    $$("[data-gh]", box).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const el = b.closest(".msg"); lastFocus = el; const m = findG(Number(el.dataset.g));
      if (b.dataset.gh === "react") return picker(b, (k) => react(m.id, k));
      if (b.dataset.gh === "more") { const r = b.getBoundingClientRect(); return gMenu(m, r.left, r.bottom + 4, el, inThread); }
      gAct(b.dataset.gh, m); }));
    $$(".msg", box).forEach((el) => {
      const m = findG(Number(el.dataset.g));
      el.oncontextmenu = (e) => { e.preventDefault(); gMenu(m, e.clientX, e.clientY, el, inThread); };
      el.onkeydown = (e) => { if (e.target !== el) return; if (e.key === "Enter" || e.key === "ContextMenu") { e.preventDefault(); const r = el.getBoundingClientRect(); gMenu(m, r.left + 40, r.bottom - 4, el, inThread); } };
      let t; el.ontouchstart = (e) => { t = setTimeout(() => { const p = e.touches[0]; gMenu(m, p.clientX, p.clientY, el, inThread); }, 550); }; el.ontouchend = el.ontouchmove = () => clearTimeout(t);
    });
  }
  // 吹き出しの右クリック：スタンプ・スレッドで返信・コピー・タスクへ・その人の 1 対 1・顧客管理・Claude に聞く
  function gMenu(m, x, y, from, inThread) {
    closeMenu(); lastFocus = from; menuAt = Date.now();
    const el = document.createElement("div"); el.className = "menu"; el.setAttribute("role", "menu"); el.setAttribute("aria-label", "メッセージの操作");
    const student = m.from === "student";
    el.innerHTML = `<div class="erow" role="group" aria-label="スタンプ">${EMO.map((k) => `<button role="menuitem" data-e="${k}" aria-label="スタンプ ${k}">${k}</button>`).join("")}</div>
      ${inThread ? "" : '<button role="menuitem" data-a="thread">スレッドで返信</button>'}<button role="menuitem" data-a="copy">コピー<small>C</small></button><hr>
      <div class="mh2" aria-hidden="true">連携</div><button role="menuitem" data-a="task">タスクへ追加（TaskMaster）…</button>
      ${student ? `<button role="menuitem" data-a="dm">${esc(m.name)}との 1 対 1 を開く</button><button role="menuitem" data-a="person">${esc(m.name)}を顧客一覧で開く →</button>` : ""}<hr>
      <button role="menuitem" data-a="ai">AI で分析</button><button role="menuitem" data-a="claude">Claude に聞く（依頼文をコピー）</button>`;
    root.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight; el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px"; el.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
    const its = $$("[role=menuitem]", el); its[0].focus();
    el.onkeydown = (e) => { const k = its.indexOf(root.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); its[(k + 1) % its.length].focus(); } if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); }
      if (e.key === "Escape") { e.preventDefault(); closeMenu(true); } if (e.key === "Tab") e.preventDefault(); };
    its.forEach((b) => (b.onclick = () => { closeMenu(); if (b.dataset.e) react(m.id, b.dataset.e); else gAct(b.dataset.a, m); }));
  }
  function gAct(a, m) {
    if (a === "copy") { navigator.clipboard.writeText(m.text).then(() => toast("コピーしました"), () => toast("コピーできませんでした")); if (lastFocus) lastFocus.focus(); return; }
    if (a === "thread") return openThread(m.id);
    if (a === "dm") return openChat(m.who);
    if (a === "person") return openPerson(m.who);
    if (a === "ai") return askAi("message", { message_id: m.id });
    if (a === "claude") {
      const t = `マーケくんのグループ「${G.group.name}」（group_id: ${G.id}）を get_chat_group で読み、次のメッセージ（id: ${m.id}・${m.name}）について、流れとスレッドを踏まえて分析し、返し方の案を出してください。\n\n「${m.text.slice(0, 300)}」`;
      navigator.clipboard.writeText(t).then(() => toast("Claude に貼る依頼文をコピーしました"), () => dialog(`<h2>Claude に貼る依頼文</h2><textarea rows="7" readonly>${esc(t)}</textarea><div class="acts"><button class="btn pri" data-x>閉じる</button></div>`));
      return;
    }
    if (a === "task") {
      const tm = new Date(Date.now() + 864e5);
      dialog(`<h2>タスクへ追加（TaskMaster）</h2><label for="tt">タスクの名前</label><input id="tt" maxlength="300" value="${esc(G.group.name + "・" + m.name + "：" + m.text.replace(/\s+/g, " ").slice(0, 30))}">
        <label for="td">期限</label><input id="td" type="date" value="${ymd(tm)}"><p style="font-size:12px;color:var(--muted);margin:6px 0 0">タスクのリンクに、このメッセージへ戻る住所が付きます。</p>
        <p class="err" id="terr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>追加</button></div>`, async (d) => {
        const title = $("#tt", d).value.trim(); if (!title) { $("#terr", d).textContent = ERR.need_title; return false; }
        const r = await call(`/api/admin/chat/groups/${G.id}/task`, "POST", { message_id: m.id, title, deadline: $("#td", d).value || null });
        if (!r.ok) { $("#terr", d).textContent = errText(r); return false; }
        toast("TaskMaster にタスクを追加しました", null, r.url);
      });
    }
  }
  async function react(mid, emoji) {
    const r = await call(`/api/admin/chat/groups/${G.id}/react`, "POST", { message_id: mid, emoji });
    if (!r.ok) { toast(gErr(r)); return; }
    await openGroup(G.id); const el = $(`.msg[data-g="${mid}"]`); if (el) el.focus();
  }
  function picker(anchor, on) {
    closeMenu(); menuAt = Date.now();
    const el = document.createElement("div"); el.className = "menu pk"; el.setAttribute("role", "menu"); el.setAttribute("aria-label", "スタンプ");
    el.innerHTML = EMO.map((k) => `<button role="menuitem" data-k="${k}" aria-label="スタンプ ${k}">${k}</button>`).join("");
    root.appendChild(el); const r = anchor.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(r.left, innerWidth - 260)) + "px"; el.style.top = (r.bottom + 4) + "px";
    const its = $$("button", el); its[0].focus();
    el.onkeydown = (e) => { const k = its.indexOf(root.activeElement); if (e.key === "ArrowRight") { e.preventDefault(); its[(k + 1) % its.length].focus(); } if (e.key === "ArrowLeft") { e.preventDefault(); its[(k - 1 + its.length) % its.length].focus(); } if (e.key === "Escape") { e.preventDefault(); closeMenu(true); } };
    its.forEach((b) => (b.onclick = () => { closeMenu(); on(b.dataset.k); }));
  }
  function openThread(id) { gThread = id; gTab = "thread"; if (!sideOpen) { sideOpen = true; app.classList.remove("noside"); drawGroupMid(); } drawGroupRight(); if (narrow()) setView("side"); $("#tcomp")?.focus(); }

  function drawGroupRight() {
    const tm = gThread && G.messages.find((m) => m.id === gThread);
    if (!tm && gTab === "thread") gTab = "mem";
    const vault = [];
    for (const m of G.messages.flatMap((x) => [x, ...x.replies]).sort((a, b) => b.id - a.id)) {
      for (const u of m.text.match(/https?:[/][/][^\s　<>"'）」]+/g) || []) if (!vault.some((v) => v.url === u)) vault.push({ kind: "link", url: u, m });
      for (const k of m.images) vault.push({ kind: "image", key: k, m });
    }
    const tabs = [tm ? ["thread", "スレッド"] : null, ["mem", `メンバー <span class="n">${G.members.length}</span>`], ["vault", `資料 <span class="n">${vault.length}</span>`], ["ai", "AI"]].filter(Boolean);
    $("#right").innerHTML = `<div class="tabs" role="tablist" style="margin-top:0"><button class="btn back" id="toChat" aria-label="グループへ戻る">←</button>${tabs.map(([k, t]) => `<button role="tab" data-gt="${k}" aria-selected="${gTab === k}" tabindex="${gTab === k ? 0 : -1}">${t}</button>`).join("")}<span class="g"></span></div><div class="pane" id="pane" role="tabpanel"></div>`;
    $("#toChat").onclick = () => setView("chat");
    $$("[data-gt]").forEach((b) => (b.onclick = () => { gTab = b.dataset.gt; drawGroupRight(); $(`[data-gt="${gTab}"]`).focus(); }));
    const pane = $("#pane");
    if (gTab === "thread") {
      pane.innerHTML = `${gMsgHtml(tm, true)}<div class="tsep">返信 ${tm.reply_count} 件</div>${tm.replies.map((x) => gMsgHtml(x, true)).join("")}
        <label class="sr" for="tcomp">スレッドに返信</label><textarea id="tcomp" class="tcomp" maxlength="8000" placeholder="スレッドに返信"></textarea>
        <div class="trow"><label class="chk2"><input type="checkbox" id="tall">グループにも流す</label><span class="g"></span><button class="btn pri" id="tsend">返信</button></div><button class="lk" id="tclose">スレッドを閉じる</button>`;
      wireGroupMsgs(pane, true);
      const send = async () => { const t = $("#tcomp").value.trim(); if (!t) { toast("文が空です"); return; }
        const r = await call(`/api/admin/chat/groups/${G.id}/message`, "POST", { text: t, thread_of: tm.id, also_main: $("#tall").checked });
        if (!r.ok) { toast(gErr(r)); return; } await openGroup(G.id); $("#tcomp")?.focus(); toast(`スレッドに返信しました（${r.notified} 人に通知）`); };
      $("#tsend").onclick = send; $("#tcomp").onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } };
      $("#tclose").onclick = () => { gThread = null; gTab = "mem"; drawGroupRight(); };
    } else if (gTab === "ai") {
      drawAi(pane);
    } else if (gTab === "mem") {
      const last = G.messages.flatMap((x) => [x, ...x.replies]).reduce((s, m) => Math.max(s, m.id), 0);
      pane.innerHTML = `<p class="who">名前を押すと、その人との 1 対 1 のチャットへ移ります</p>${G.members.map((x) => `<div class="mem">${av(x.id, x.name)}<button class="lk mn" data-dm="${x.id}">${esc(x.name)}</button><small></small><button class="lk" data-rm="${x.id}" aria-label="${esc(x.name)}をメンバーから削除">削除</button></div>`).join("") || '<p class="empty">まだメンバーがいません。上の「＋ メンバーを招待」から招待できます</p>'}`;
      $$("[data-dm]", pane).forEach((b) => (b.onclick = () => openChat(b.dataset.dm)));
      $$("[data-rm]", pane).forEach((b) => (b.onclick = async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "本当に削除"; return; }
        const r = await call(`/api/admin/chat/groups/${G.id}`, "POST", { remove_ids: [b.dataset.rm] }); if (!r.ok) { toast(gErr(r)); return; }
        await openGroup(G.id); toast("メンバーから削除しました（やり取りは残ります）"); }));
    } else {
      pane.innerHTML = `<p class="who">グループで送られたリンクと画像が集まります</p>${vault.map((v) => v.kind === "image" ? `<div class="vi"><img data-key="${esc(v.key)}" alt="${esc(v.m.name)}が送った画像"><div><small>${esc(v.m.name)}・${esc(fmtTime(v.m.at))}</small><button class="lk" data-go="${v.m.id}">メッセージへ</button></div></div>`
        : `<div class="vi"><span class="vic" aria-hidden="true">↗</span><div><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url.replace(/^https?:[/][/]/, "").slice(0, 70))}</a><small>${esc(v.m.name)}・${esc(fmtTime(v.m.at))}</small><button class="lk" data-go="${v.m.id}">メッセージへ</button></div></div>`).join("") || '<p class="empty">まだ資料はありません</p>'}`;
      $$("[data-go]", pane).forEach((b) => (b.onclick = () => { const id = Number(b.dataset.go); const el = $(`.msg[data-g="${id}"]`, $("#mid")); if (narrow()) setView("chat"); if (el) { el.classList.add("hit"); el.scrollIntoView({ block: "center" }); el.focus(); } else { const p = G.messages.find((m) => m.replies.some((x) => x.id === id)); if (p) openThread(p.id); } }));
      $$("img[data-key]", pane).forEach(async (img) => { try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), getToken()); } catch (_) { img.alt = "画像を読めませんでした"; } });
    }
  }

  // 人を選ぶ窓（フォルダからまとめて・名前で探す）。新規作成と招待で使う
  function pickPeople(d, already) {
    const sel = new Set();
    const chats = (L ? L.chats : []).filter((c) => !already.has(c.person_id));
    let found = [];
    const draw = () => {
      const q = $("#pq", d).value.trim();
      const f = $("#pf", d).value;
      const base = f ? chats.filter((c) => c.folder_id === f) : chats;
      const list = [...base.filter((c) => !q || (nameOf(c) + c.email).includes(q)).map((c) => ({ id: c.person_id, name: nameOf(c) })), ...found.filter((p) => !already.has(p.id) && !base.some((c) => c.person_id === p.id)).map((p) => ({ id: p.id, name: p.name || p.email }))];
      $("#pl", d).innerHTML = list.slice(0, 60).map((p) => `<label class="chk"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? "checked" : ""}>${av(p.id, p.name)}${esc(p.name)}</label>`).join("") || '<p class="empty">合う人がいません</p>';
      $$("#pl input", d).forEach((i) => (i.onchange = () => { i.checked ? sel.add(i.value) : sel.delete(i.value); $("#pn", d).textContent = `${sel.size} 人を選んでいます`; }));
    };
    let timer = 0;
    $("#pf", d).onchange = () => { const f = $("#pf", d).value; if (f) chats.filter((c) => c.folder_id === f).forEach((c) => sel.add(c.person_id)); $("#pn", d).textContent = `${sel.size} 人を選んでいます`; draw(); };
    $("#pq", d).oninput = () => { draw(); clearTimeout(timer); const q = $("#pq", d).value.trim(); if (q) timer = setTimeout(async () => { const r = await call("/api/admin/chat/people?q=" + encodeURIComponent(q)); if (r.ok && d.isConnected) { found = r.people; draw(); } }, 300); };
    draw();
    return sel;
  }
  const pickHtml = () => `<label for="pf">フォルダからまとめて選ぶ</label><select id="pf"><option value="">フォルダを選ばない</option>${(L ? L.folders : []).map((f) => `<option value="${f.id}">${esc(f.name)}（${f.count} 人）</option>`).join("")}</select>
    <label for="pq">名前で探す（チャットの無い人も）</label><input id="pq" type="search" placeholder="名前かメール"><div id="pl" class="plist"></div><p class="who" id="pn" aria-live="polite">0 人を選んでいます</p>`;
  function newGroupDlg(opener) {
    lastFocus = opener || lastFocus;
    let sel = null;
    dialog(`<h2>グループを新規作成</h2><label for="gn">グループの名前</label><input id="gn" maxlength="40" placeholder="例 NEXT 受講生（12月）">${pickHtml()}
      <p style="font-size:12px;color:var(--muted);margin:6px 0 0">作成しただけでは生徒には知らせません。最初のメッセージを送ると、招待した人の画面とスマホに届きます。</p><p class="err" id="gerr" role="alert"></p>
      <div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>作成</button></div>`, async (d) => {
      const r = await call("/api/admin/chat/groups", "POST", { name: $("#gn", d).value, member_ids: [...sel] });
      if (!r.ok) { $("#gerr", d).textContent = gErr(r); return false; }
      await loadList(); openGroup(r.group.id); toast(`「${r.group.name}」を作成しました（メンバー ${r.members} 人）`);
    }, (d) => { sel = pickPeople(d, new Set()); });
  }
  function memberDlg(opener) {
    lastFocus = opener || lastFocus;
    let sel = null;
    dialog(`<h2>「${esc(G.group.name)}」にメンバーを招待</h2>${pickHtml()}<p style="font-size:12px;color:var(--muted);margin:6px 0 0">招待した人には、それまでのやり取りも見えます。</p><p class="err" id="gerr" role="alert"></p>
      <div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>招待</button></div>`, async (d) => {
      if (!sel.size) { $("#gerr", d).textContent = "招待する人を選んでください"; return false; }
      const r = await call(`/api/admin/chat/groups/${G.id}`, "POST", { add_ids: [...sel] });
      if (!r.ok) { $("#gerr", d).textContent = gErr(r); return false; }
      await openGroup(G.id); toast(`${r.added} 人を招待しました`);
    }, (d) => { sel = pickPeople(d, new Set(G.members.map((x) => x.id))); });
  }
  function groupEditDlg(opener) {
    lastFocus = opener || lastFocus;
    dialog(`<h2>グループ設定</h2><label for="gn2">グループの名前</label><input id="gn2" maxlength="40" value="${esc(G.group.name)}">
      <p style="font-size:12px;color:var(--muted);margin:10px 0 4px">アーカイブすると、生徒の画面からグループが消えます（やり取りは残り、AI からは読めます）。</p><button class="btn" id="gclose">グループをアーカイブ</button>
      <p class="err" id="gerr" role="alert"></p><div class="acts"><button class="btn" data-x>キャンセル</button><button class="btn pri" data-ok>名前を保存</button></div>`, async (d) => {
      const r = await call(`/api/admin/chat/groups/${G.id}`, "POST", { name: $("#gn2", d).value });
      if (!r.ok) { $("#gerr", d).textContent = gErr(r); return false; }
      await loadList(); await openGroup(G.id); toast("名前を変えました");
    }, (d, close) => {
      $("#gclose", d).onclick = async (e) => { const b = e.currentTarget; if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "本当にアーカイブ"; b.classList.add("danger"); return; }
        const r = await call(`/api/admin/chat/groups/${G.id}`, "POST", { close: true }); if (!r.ok) { $("#gerr", d).textContent = gErr(r); return; }
        close(); G = null; cur = null; await loadList(); $("#mid").innerHTML = '<div class="welcome">グループをアーカイブしました。</div>'; $("#right").innerHTML = ""; toast("グループをアーカイブしました"); };
    });
  }

  // ---------- AI（C3） ----------
  // 右の「AI」タブ。要約・返信の下書き・見落とし・自由な質問・メッセージの分析。答えは「入力欄に入れる」「コピー」「メモに残す」まで（送らない）
  const AIERR = { no_ai: "AI がつながっていません（設定の確認が要ります）", ai_failed: "AI が答えられませんでした。少し待ってもう一度", ai_empty: "AI の答えが空でした。もう一度押してください", need_question: "聞きたいことを入れてください", message_not_found: "元のメッセージが見つかりません" };
  const aiErr = (r) => AIERR[r.error] || errText(r);
  const AIMODE = { summary: "要約", draft: "返信の下書き", gaps: "見落とし", free: "質問", message: "メッセージの分析" };
  const aiLogs = {};
  const aiKey = () => (G ? "g:" + G.id : D ? "p:" + D.id : "");
  function drawAi(pane) {
    const key = aiKey(), logs = aiLogs[key] || [];
    pane.innerHTML = `<p class="who">${G ? `グループ「${esc(G.group.name)}」` : `${esc(D.card.name || "この人")}とのやり取り`}を AI（Workers AI）が読みます。送るのは Naoki が押したときだけです</p>
      <div class="aibtns" role="group" aria-label="AI に頼む"><button class="btn" data-ai="summary">要約</button><button class="btn" data-ai="draft">返信の下書き</button><button class="btn" data-ai="gaps">見落とし</button></div>
      <label class="sr" for="aiq">AI に聞く</label><textarea id="aiq" class="tcomp" maxlength="1000" placeholder="自由に聞く（例 この人が最近止まっている理由は？）"></textarea>
      <div class="trow"><span class="g">⌘／Ctrl＋Enter で聞く</span><button class="btn pri" id="aiask">聞く</button></div>
      <div id="ailog" aria-live="polite">${logs.map((x, i) => `<div class="aiout${x.err ? " err" : ""}"><div class="aih"><b>${esc(AIMODE[x.mode] || "")}</b>${x.q ? `<span>：${esc(x.q.slice(0, 40))}</span>` : ""}<small>${esc(hm(x.at))}</small></div>
        ${x.wait ? '<p class="aiw">AI が読んでいます…</p>' : `<div class="ait">${esc(x.text)}</div>${x.err ? "" : `<div class="aia"><button class="lk" data-ins="${i}">入力欄に入れる</button><button class="lk" data-cp="${i}">コピー</button>${G ? "" : `<button class="lk" data-memo="${i}">メモに残す</button>`}</div>`}`}</div>`).join("") || '<p class="empty">まだ何も聞いていません。上のボタンか、自由に聞く欄から始められます</p>'}</div>`;
    $$("[data-ai]", pane).forEach((b) => (b.onclick = () => askAi(b.dataset.ai)));
    const go = () => { const q = $("#aiq", pane).value.trim(); if (!q) { toast(AIERR.need_question); $("#aiq", pane).focus(); return; } askAi("free", { question: q }); };
    $("#aiask", pane).onclick = go;
    $("#aiq", pane).onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); go(); } };
    $$("[data-ins]", pane).forEach((b) => (b.onclick = () => { const t = logs[+b.dataset.ins].text; const box = $(G ? "#gcomp" : "#comp"); if (!box) { toast("入力欄がありません（サイトのやり取りに切り替えてください）"); return; } if (!G && noteMode) { noteMode = false; drawMid(); } const bx = $(G ? "#gcomp" : "#comp"); bx.value = t; bx.focus(); if (narrow()) setView("chat"); toast("入力欄に入れました。編集してから送ってください"); }));
    $$("[data-cp]", pane).forEach((b) => (b.onclick = () => navigator.clipboard.writeText(logs[+b.dataset.cp].text).then(() => toast("コピーしました"), () => toast("コピーできませんでした"))));
    $$("[data-memo]", pane).forEach((b) => (b.onclick = async () => { const x = logs[+b.dataset.memo]; const r = await call(`/api/admin/chat/${D.id}/note`, "POST", { text: `【AI の${AIMODE[x.mode]}】\n${x.text}` }); if (!r.ok) { toast(errText(r)); return; } await reload(); toast("メモに残しました（生徒には見えません）"); }));
  }
  async function askAi(mode, extra = {}) {
    const key = aiKey(); if (!key) return;
    const logs = (aiLogs[key] = aiLogs[key] || []);
    const item = { mode, q: extra.question || (extra.message_id ? "#" + extra.message_id : ""), at: new Date().toISOString(), wait: true };
    logs.unshift(item); if (logs.length > 10) logs.pop();
    openAiTab();
    const body = G ? { group_id: G.id, mode, ...extra } : { person_id: D.id, mode, ...extra };
    const r = await call("/api/admin/chat/ai", "POST", body);
    item.wait = false;
    if (r.ok) item.text = r.text; else { item.text = aiErr(r); item.err = true; }
    if (aiKey() === key) { openAiTab(); live(r.ok ? "AI の答えが出ました" : item.text); }
  }
  function openAiTab() {
    if (!sideOpen) { sideOpen = true; app.classList.remove("noside"); G ? drawGroupMid() : chan === "line" ? drawLine() : drawMid(); }
    if (G) { gTab = "ai"; drawGroupRight(); } else { tab = "ai"; drawRight(); }
    if (narrow()) setView("side");
  }
  // 探す：AI で言い換えて探す
  async function aiSearch() {
    const q = $("#q").value.trim();
    if (!q) { toast("探す言葉を入れてください"); $("#q").focus(); return; }
    $("#mid").innerHTML = '<div class="welcome">AI が言葉を広げて探しています…</div>'; setView("chat");
    const r = await call("/api/admin/chat/ai-search", "POST", { q });
    if (!r.ok) { $("#mid").innerHTML = `<div class="welcome">${esc(aiErr(r))}</div>`; return; }
    showHits(r, `「${q}」を AI で言い換えて探した結果`, `探した言葉：${r.words.join("・")}${r.note ? "（AI が使えず、元の言葉だけで探しました）" : ""}`);
  }

  // ---------- 探す ----------
  function showHits(r, title, sub) {
    hits = r.hits; drawLeft();
    const words = r.words || [String($("#q").value || "").trim()];
    const mark = (t) => { let x = esc(t); for (const w of words.filter(Boolean)) x = x.split(esc(w)).join(`<mark>${esc(w)}</mark>`); return x; };
    $("#mid").innerHTML = `<div class="mh"><button class="btn back" id="toList">←</button><div><h1>${esc(title)}</h1><small>${esc(sub)}</small></div><span class="g"></span><button class="btn" id="clr">探すのをやめる</button></div>
      <div class="results">${hits.map((h, k) => `<button class="res" data-k="${k}"><small>${esc(h.name)}・${esc(h.kind)}・${esc(h.from)}・${esc(fmtTime(h.at))}${h.word ? "・言葉「" + esc(h.word) + "」" : ""}</small>${mark(h.text)}</button>`).join("") || '<p class="empty">見つかりませんでした。言葉を変えるか、「AI で言い換えて探す」を試してください</p>'}</div>`;
    $("#toList").onclick = () => setView("list");
    $("#clr").onclick = () => { $("#q").value = ""; hits = null; drawLeft(); if (G) drawGroupMid(); else if (D) chan === "line" ? drawLine() : drawMid(); else $("#mid").innerHTML = ""; $("#q").focus(); };
    $$("[data-k]", $("#mid")).forEach((b) => (b.onclick = () => { const h = hits[+b.dataset.k]; h.group_id ? openGroup(h.group_id, h.event_id) : openChat(h.person_id, h.event_id); }));
    setView("chat"); live(`${r.count} 件見つかりました`);
  }
  $("#q").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const q = $("#q").value.trim();
    if (!q) { hits = null; drawLeft(); if (G) drawGroupMid(); else if (D) chan === "line" ? drawLine() : drawMid(); return; }
    const r = await call("/api/admin/chat/search?q=" + encodeURIComponent(q) + (fsel ? "&folder_id=" + fsel : ""));
    if (!r.ok) { toast(errText(r)); return; }
    showHits(r, `「${q}」を探した結果`, `${fsel ? "フォルダ「" + fname(fsel) + "」の中・" : ""}${r.count} 件（やり取り・添削・メモ・グループ）`);
  };
  $("#aiSearch").onclick = aiSearch;

  // ---------- ⌘K ----------
  function quick() {
    if ($(".ks")) return;
    const opener = root.activeElement || document.activeElement;
    const el = document.createElement("div"); el.className = "ks";
    el.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="チャットを開く"><input id="ksq" placeholder="名前かメールで探す" role="combobox" aria-expanded="true" aria-controls="ksl" autocomplete="off"><ul id="ksl" role="listbox"></ul></div>`;
    root.appendChild(el);
    let sel = 0, list = [], people = [], timer = 0;
    const close = (go) => { el.remove(); if (go) openChat(go); else if (opener && opener.isConnected) opener.focus(); };
    const draw = () => {
      const q = $("#ksq", el).value.trim();
      const chats = (L ? L.chats : []).filter((c) => !q || (nameOf(c) + c.email).includes(q)).sort((a, b) => (b.need - a.need) || (b.unread_for_admin - a.unread_for_admin)).map((c) => ({ id: c.person_id, name: nameOf(c), sub: c.need ? "要返信" : "チャット" }));
      const have = new Set(chats.map((c) => c.id));
      list = [...chats, ...people.filter((p) => !have.has(p.id)).map((p) => ({ id: p.id, name: p.name || p.email, sub: "顧客（新しいチャット）" }))].slice(0, 30);
      sel = Math.min(sel, Math.max(0, list.length - 1));
      $("#ksl", el).innerHTML = list.map((c, k) => `<li role="option" aria-selected="${k === sel}" data-q="${c.id}">${av(c.id, c.name)}<span>${esc(c.name)}</span><small>${esc(c.sub)}</small></li>`).join("") || '<li>見つかりません</li>';
      $$("[data-q]", el).forEach((li) => (li.onclick = () => close(li.dataset.q)));
    };
    $("#ksq", el).oninput = () => { sel = 0; draw(); clearTimeout(timer); const q = $("#ksq", el).value.trim(); if (q.length >= 1) timer = setTimeout(async () => { const r = await call("/api/admin/chat/people?q=" + encodeURIComponent(q)); if (r.ok && el.isConnected) { people = r.people; draw(); } }, 300); };
    $("#ksq", el).onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); draw(); }
      if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      if (e.key === "Enter" && list[sel]) { e.preventDefault(); close(list[sel].id); }
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") e.preventDefault();
    };
    el.onclick = (e) => { if (e.target === el) close(); };
    draw(); $("#ksq", el).focus();
  }
  const visible = () => host.offsetParent !== null;
  document.addEventListener("keydown", (e) => {
    if (!visible()) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); quick(); return; }
    const a = root.activeElement, typing = a && /INPUT|TEXTAREA/.test(a.tagName) || /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement !== host;
    if (typing || $(".dlgbg") || $(".ks")) return;
    if (e.key === "?") { e.preventDefault(); keysDlg(); }
    if (e.key === "]" && (D || G)) { e.preventDefault(); $("#sideBtn")?.click(); }
  });
  function keysDlg() {
    const K = [["⌘／Ctrl＋K", "名前で探してチャットを開く"], ["⌘／Ctrl＋Enter", "送信・メモを残す"], ["↑ ↓", "メッセージを移る（メッセージを選んでいるとき）"], ["T", "タスクへ追加"], ["F", "転送（メモとして）"], ["C", "コピー"], ["S", "資料に入れる・外す"], ["Enter・右クリック", "操作の一覧"], ["]", "右を開く・閉じる"], ["Esc", "閉じる"]];
    dialog(`<h2>キーの一覧</h2><table style="width:100%;font-size:13px;border-collapse:collapse">${K.map(([k, v]) => `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap"><span class="kbd">${k}</span></td><td>${v}</td></tr>`).join("")}</table><div class="acts"><button class="btn pri" data-x>閉じる</button></div>`);
  }

  // ---------- 窓と通知 ----------
  function dialog(html, onOk, wire) {
    const opener = lastFocus && lastFocus.isConnected ? lastFocus : root.activeElement;
    const bg = document.createElement("div"); bg.className = "dlgbg"; bg.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`; root.appendChild(bg);
    const d = $(".dlg", bg); const close = () => { bg.remove(); if (opener && opener.isConnected) opener.focus(); };
    const f = () => $$("button,input,textarea", d).filter((x) => !x.disabled);
    (f().find((x) => x.tagName !== "BUTTON") || f()[0]).focus();
    bg.onclick = (e) => { if (e.target === bg) close(); };
    d.onkeydown = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") { const a = f(), k = a.indexOf(root.activeElement); if (e.shiftKey && k <= 0) { e.preventDefault(); a[a.length - 1].focus(); } else if (!e.shiftKey && k === a.length - 1) { e.preventDefault(); a[0].focus(); } }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { const ok = $("[data-ok]", d); if (ok) { e.preventDefault(); ok.click(); } } };
    $$("[data-x]", d).forEach((b) => (b.onclick = close));
    const ok = $("[data-ok]", d); if (ok) ok.onclick = async () => { if ((await onOk(d)) !== false) close(); };
    if (wire) wire(d, close);
  }
  let tt;
  function toast(t, undo, href) {
    const o = $(".toast"); if (o) o.remove(); clearTimeout(tt);
    const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(t)}</span>${undo ? "<button>元に戻す</button>" : ""}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:#f59e0b;font-weight:700">別タブで開く ↗</a>` : ""}`;
    root.appendChild(el); if (undo) $("button", el).onclick = () => { el.remove(); undo(); };
    tt = setTimeout(() => el.remove(), undo || href ? 7000 : 2800); live(t);
  }

  let poll = 0;
  return {
    async open(id, focusId) {
      await loadList();
      if (id) await openChat(id, focusId); else if (!narrow() && !cur && L && L.chats.length) { filter = L.need_count ? "need" : "all"; drawLeft(); }
      clearInterval(poll); poll = setInterval(() => { if (visible() && document.visibilityState === "visible") loadList(); }, 60000);
    },
    needCount: () => (L ? L.need_count : 0),
  };
}

// チャットの便 C1（2026-11-07 Naoki OK 10:55・デモ https://claude.ai/artifact/CqUVZrEMegXbRk385fkZ2J）
//  ・左＝要返信／後で／すべて と人の一覧（探す欄は全員のやり取りとメモを言葉で探す）。真ん中＝やり取りとメモ。右＝顧客のカードと「履歴」
//  ・メッセージはホバーの帯・右クリック（スマホは長押し）・選んで 1 キー（T タスク・F 転送・C コピー）で操作する
//  ・メモ（自分だけ）は生徒には見えない。転送は「メモとして」だけ（別の生徒に中身が届かないように）
//  ・添削の 3 欄と教材の質問への答えは、今までどおり添削ルームで（ここからは「添削ルームで開く →」で移る）
//  ・⌘／Ctrl＋K で人を探して開く（部屋の無い人も）・] で右を開閉・? でキーの一覧。右の幅は左端を引いて変えられる（このブラウザに覚える）
//  ・グループとフォルダと「資料」は C2、「AI」タブは C3
import { api, esc, fmtTime, authImage, EVENT_LABEL } from "/js/common.js";

const COL = ["#b45309", "#7c3aed", "#0f766e", "#be123c", "#1d4ed8", "#4d7c0f", "#0369a1", "#a21caf"];
const CATCOL = { 購入: "#2563eb", 予約: "#7c3aed", セミナー: "#0369a1", 学習: "#0f766e", メール: "#a21caf", LINE: "#15803d", 添削: "#be123c", フォーム: "#b45309", ページ: "#4d7c0f", 権利: "#334155", 登録とログイン: "#57534e", マーケ: "#9f1239", そのほか: "#6b6259" };
// 共通の呼び名（common.js の EVENT_LABEL）に無い出来事の呼び名。履歴に中の名前を出さないため
const LABEL_MORE = { email_opened: "メールを開いた", line_sent: "LINE を送った", line_keyword: "LINE でキーワードを送った", line_linked: "LINE とつないだ", lesson_mark: "教材に印を付けた", lesson_memo: "教材にメモを書いた",
  consult_reminded: "予約の前の知らせ", field_set: "項目を書き換えた", goal_review_submitted: "週の振り返りを出した", invite_accepted: "招待を受けた", sales_marked: "売上に記録した", step_entered: "コネクタに入った", workspace_left: "ワークスペースを抜けた", workspace_restored: "ワークスペースに戻った" };
const labelOf = (t) => EVENT_LABEL[t] || LABEL_MORE[t] || "そのほかの出来事";
const KEY_LABEL = { shiarabo_basic: "しあらぼ", shiarabo_next_premium: "NEXT プレミアム", shiarabo_next_standard: "NEXT スタンダード", shiarabo_trial: "しあらぼ体験", shiarabo_monitor: "モニター", note_membership: "note メンシプ", shiarabo_paused: "休止", shiarabo_pilot: "先行で試す", guest: "ゲスト" };
const ERR = {
  empty: "空です。中身を書いてください", too_long: "長すぎます（8000 字まで）", bad_until: "後で見る日時が正しくありません（これから先・90 日まで）",
  same_chat: "同じチャットには転送できません", message_not_found: "元のメッセージが見つかりませんでした", no_taskmaster: "TaskMaster につながっていません（設定の確認が要ります）",
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
    <aside class="left" aria-label="チャットの一覧"><div class="lsearch"><label class="sr" for="q">やり取りとメモを探す</label><input id="q" type="search" placeholder="やり取りとメモを探す（Enter）"><div class="hint"><span class="kbd">⌘K</span> で人を探して開く</div></div><div class="list" id="list"></div></aside>
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
    const pick = filter === "need" ? L.chats.filter((c) => c.need) : filter === "later" ? L.chats.filter((c) => c.later_until) : L.chats;
    const btn = (k, label, n) => `<button class="sv" data-f="${k}" aria-pressed="${filter === k}">${label}<span class="n">${n}</span></button>`;
    $("#list").innerHTML = `<div role="group" aria-label="絞り込み">${btn("need", "要返信", L.need_count)}${btn("later", "後で", L.later_count)}${btn("all", "すべて", L.count)}</div>
      <div class="lh">${filter === "need" ? "要返信" : filter === "later" ? "後で" : "すべて"}</div>
      ${pick.map((c) => `<button class="ci" data-c="${c.person_id}" aria-current="${cur === c.person_id && !hits}">${av(c.person_id, nameOf(c))}<span class="t"><b>${esc(nameOf(c))}</b><small>${c.last_from === "cyanin" ? "返した：" : ""}${esc(c.last_text || "")}</small></span>
        ${c.later_until ? `<span class="lt">後で ${esc(dayOf(c.later_until))}</span>` : c.need ? `<span class="flag">要返信</span>` : ""}${c.unread_for_admin ? `<span class="badge" aria-label="未読 ${c.unread_for_admin}">${c.unread_for_admin}</span>` : ""}</button>`).join("")
        || `<p class="empty">${filter === "need" ? "要返信はありません" : filter === "later" ? "後でにしたチャットはありません" : "チャットはまだありません。⌘K で人を探して始められます"}</p>`}`;
    $$("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; drawLeft(); $(`[data-f="${filter}"]`).focus(); }));
    $$("[data-c]", $("#list")).forEach((b) => (b.onclick = () => openChat(b.dataset.c)));
  }

  // ---------- 1 人を開く ----------
  async function openChat(id, focusId) {
    app.classList.remove("leftopen");
    cur = id; hits = null; drawLeft();
    try { history.replaceState(null, "", `#chat/${id}${focusId ? "/" + focusId : ""}`); } catch (_) {}
    const r = await call("/api/admin/chat/" + id);
    if (!r.ok || !r.found) { $("#mid").innerHTML = `<div class="welcome">読めませんでした（${esc(r.error || "見つかりません")}）</div>`; return; }
    D = r; D.id = id;
    const row = L && L.chats.find((c) => c.person_id === id); if (row) row.unread_for_admin = 0;
    drawLeft(); drawMid(focusId); drawRight(); setView("chat");
    if (!focusId && !narrow()) $("#comp")?.focus();
    live(`「${D.card.name || D.person.email}」のチャットを開きました`);
  }

  // ---------- 真ん中 ----------
  function items() {
    const done = new Set(D.tasks.map((t) => String(t.event_id)));
    const its = [];
    for (const m of D.messages) {
      if (m.kind === "chat") its.push({ id: m.id, at: m.at, me: m.from === "cyanin", who: m.from === "cyanin" ? "シアニン" + (m.actor === "mcp" ? "（AI から）" : "") : (D.card.name || "生徒"), text: m.text, images: m.images || [], lesson: m.lesson, reply_to: m.reply_to, task: done.has(String(m.id)) });
      else if (m.from === "student") its.push({ id: m.id, at: m.at, me: false, line: true, who: D.card.name || "生徒", text: "添削の依頼：" + (m.text || "（画像）").slice(0, 80), corr: true, replied: m.replied, task: done.has(String(m.id)) });
      else its.push({ id: m.id, at: m.at, me: true, line: true, who: "シアニン", text: "添削を返した" + (m.comment ? "：" + m.comment.slice(0, 80) : ""), corr: true, task: done.has(String(m.id)) });
    }
    for (const n of D.notes) its.push({ id: n.id, at: n.at, me: true, note: true, who: "シアニン・メモ（自分だけ）", text: n.text, fwd: n.forwarded_from, task: done.has(String(n.id)) });
    return its.sort((a, b) => a.id - b.id);
  }
  function msgHtml(m) {
    const link = (t) => esc(t).replace(/https?:[/][/][^\s　<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    const tags = [
      m.lesson ? `<span class="tag">${m.me ? "答え：" : "教材の質問："}${esc(m.lesson.title)}</span>` : "",
      m.corr && !m.me ? `<span class="tag ${m.replied ? "" : "warn"}">${m.replied ? "返信済み" : "未返信"}</span>` : "",
      m.fwd ? `<span class="tag">転送：${esc(m.fwd.name || "")}から</span>` : "",
      m.task ? `<span class="tag">タスク済</span>` : "",
    ].join("");
    const corrBtn = m.corr || (m.lesson && !m.me) ? `<button class="btn" style="margin-top:4px" data-room="${m.corr ? "corr" : "chat"}">添削ルームで開く →</button>` : "";
    return `<div class="msg ${m.me ? "me" : ""} ${m.note ? "note" : ""} ${m.line ? "line" : ""}" tabindex="0" data-i="${m.id}" aria-label="${esc(m.who)} ${esc(fmtTime(m.at))}：${esc(String(m.text).slice(0, 60))}。選んで T でタスク、F で転送、C でコピー、Enter で操作の一覧">
      <span class="hb" role="toolbar" aria-label="このメッセージの操作"><button data-h="task">タスクへ</button><button data-h="fwd">転送</button><button data-h="copy">コピー</button><button data-h="more" aria-label="ほかの操作">…</button></span>
      <div><div class="meta">${esc(m.who)}・${hm(m.at)}</div><div class="bub">${link(m.text)}${m.images && m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="送られた画像">`).join("")}</div>` : ""}</div>${tags ? `<div class="tags">${tags}</div>` : ""}${corrBtn}</div></div>`;
  }
  function drawMid(focusId) {
    const its = items(); let last = "";
    const isLater = !!D.later_until;
    $("#mid").innerHTML = `<div class="mh"><button class="btn back" id="toList" aria-label="一覧へ戻る">←</button><button class="btn md" id="leftBtn" aria-expanded="${app.classList.contains("leftopen")}">一覧</button>${av(D.id, D.card.name)}
      <div style="min-width:0"><h1>${esc(D.card.name || D.person.email)}</h1><small>${esc(D.card.email)}${isLater ? `・後で（${esc(fmtTime(D.later_until))} まで）` : ""}</small></div><span class="g"></span>
      <button class="btn" id="later">${isLater ? "後でを外す" : "後で"}</button>
      <button class="btn" id="sideBtn" aria-expanded="${sideOpen}"><span class="lg">${sideOpen ? "右を閉じる" : "右を開く"}</span><span class="sm">顧客と履歴</span></button></div>
    <div class="msgs" id="msgs">${its.map((m) => { const d = dayOf(m.at); const h = d !== last ? `<div class="day">${d}</div>` : ""; last = d; return h + msgHtml(m); }).join("") || '<p class="welcome">やり取りはまだありません。下から最初のメッセージを送れます。</p>'}</div>
    <div class="comp ${noteMode ? "notemode" : ""}"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap"><span class="mode" role="group" aria-label="書くもの"><button aria-pressed="${!noteMode}" data-m="reply">返信</button><button aria-pressed="${noteMode}" data-m="note">メモ（自分だけ）</button></span><span style="font-size:12px;color:var(--muted)">${noteMode ? "メモは生徒には見えません" : "生徒の画面とスマホに届きます"}</span></div>
      <label class="sr" for="comp">${noteMode ? "メモ" : "メッセージ"}</label><textarea id="comp" maxlength="8000" placeholder="${noteMode ? "自分だけのメモを書く（生徒には見えない）" : "メッセージを書く"}"></textarea>
      <div class="row"><span class="g">⌘／Ctrl＋Enter で${noteMode ? "メモを残す" : "送信"}・Enter は改行・<span class="kbd">?</span> でキーの一覧</span><button class="btn pri" id="send">${noteMode ? "メモを残す" : "送信"}</button></div></div>`;
    $("#toList").onclick = () => setView("list");
    $("#leftBtn").onclick = () => { const o = app.classList.toggle("leftopen"); $("#leftBtn").setAttribute("aria-expanded", o); if (o) ($(".left .ci[aria-current=true]") || $(".left .sv")).focus(); };
    $("#later").onclick = (e) => isLater ? setLater(null, e.currentTarget) : laterDlg(e.currentTarget);
    $("#sideBtn").onclick = () => {
      if (narrow()) { if (app.dataset.v === "side") { setView("chat"); return; } setView("side"); $("#t-hist")?.focus(); return; }
      sideOpen = !sideOpen; app.classList.toggle("noside", !sideOpen); drawMid(); $("#sideBtn").focus();
    };
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
        const one = { t: "task", f: "fwd", c: "copy" }[e.key.toLowerCase()];
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
    return `<div class="card"><div class="h"><b>${esc(c.name || c.email)}</b><a href="#person/${D.id}" id="cust">顧客管理へ移動 →</a></div><dl>
      <dt>段階</dt><dd>${esc(c.stage || "—")}</dd>
      <dt>権利</dt><dd>${c.entitlements.length ? c.entitlements.map((x) => `<span class="ent">${esc(KEY_LABEL[x.key] || x.key)}${x.expires_at ? "（" + esc(fmtTime(x.expires_at).slice(0, 10)) + " まで）" : ""}</span>`).join("") : "なし"}</dd>
      <dt>次の予約</dt><dd>${c.next_booking ? `${esc(c.next_booking.title)} ${esc(fmtTime(c.next_booking.slot))}` : "—"}</dd>
      <dt>最後の面談</dt><dd>${c.last_meeting ? esc(fmtTime(c.last_meeting).slice(0, 10)) : "—"}</dd>
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
      <div class="tabs" role="tablist"><button class="btn back" id="toChat" aria-label="チャットへ戻る">←</button><button role="tab" id="t-hist" aria-selected="true" aria-controls="pane">履歴</button><span class="g"></span></div>
      <div class="pane" id="pane" role="tabpanel" tabindex="-1"></div>`;
    $("#cust").onclick = (e) => { e.preventDefault(); openPerson(D.id); };
    $("#toChat").onclick = () => { app.classList.remove("full"); setView("chat"); };
    $("#grab").onclick = () => { const f = app.classList.toggle("full"); app.style.setProperty("--sh", f ? "86vh" : "52vh"); drawRight(); $("#grab").focus(); };
    const sp = $("#split");
    const setW = (w) => { w = Math.max(300, Math.min(640, Math.round(w))); app.style.setProperty("--rw", w + "px"); sp.setAttribute("aria-valuenow", w); try { localStorage.setItem("chat-rw", w); } catch (_) {} };
    sp.onpointerdown = (e) => { e.preventDefault(); sp.setPointerCapture(e.pointerId); const right = app.getBoundingClientRect().right; sp.onpointermove = (ev) => setW(right - ev.clientX); sp.onpointerup = () => { sp.onpointermove = null; }; };
    sp.onkeydown = (e) => { const w = parseInt(sp.getAttribute("aria-valuenow")); if (e.key === "ArrowLeft") { e.preventDefault(); setW(w + 24); } if (e.key === "ArrowRight") { e.preventDefault(); setW(w - 24); } };
    drawHist();
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
    el.innerHTML = `<button role="menuitem" data-a="copy">コピー<small>C</small></button><button role="menuitem" data-a="fwd">転送（メモとして）…<small>F</small></button><button role="menuitem" data-a="task">タスクへ追加…<small>T</small></button><hr>
      <button role="menuitem" data-a="claude">Claude に聞く（依頼文をコピー）</button><button role="menuitem" data-a="later">このチャットを後で見る…</button>${m.corr || (m.lesson && !m.me) ? '<button role="menuitem" data-a="room">添削ルームで開く →</button>' : ""}`;
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
    if (a === "claude") {
      const t = `マーケくんのチャット（person_id: ${D.id}・${D.card.name || D.card.email}）を get_chat で読み、次のメッセージ（event_id: ${m.id}）について、やり取りと履歴を踏まえて分析し、返し方の案を出してください。\n\n「${m.text.slice(0, 300)}」`;
      navigator.clipboard.writeText(t).then(() => toast("Claude に貼る依頼文をコピーしました"), () => dialog(`<h2>Claude に貼る依頼文</h2><textarea rows="7" readonly>${esc(t)}</textarea><div class="acts"><button class="btn pri" data-x>閉じる</button></div>`));
      if (lastFocus) lastFocus.focus(); return;
    }
    if (a === "fwd") return fwdDlg(m);
    if (a === "task") return taskDlg(m);
  }
  function fwdDlg(m) {
    const others = (L ? L.chats : []).filter((c) => c.person_id !== D.id);
    dialog(`<h2>転送（メモとして）</h2><p style="margin:0;color:var(--muted);font-size:13px">選んだチャットに、この文をシアニンだけのメモとして写します。相手の生徒には見えません。</p>
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
    D.later_until = r.later_until; await loadList(); drawMid(); if (until === null) toast("「後で」から外しました");
    (focusEl && focusEl.isConnected ? focusEl : $("#later"))?.focus();
    return r;
  }

  // ---------- 探す ----------
  $("#q").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const q = $("#q").value.trim();
    if (!q) { hits = null; drawLeft(); if (D) drawMid(); return; }
    const r = await call("/api/admin/chat/search?q=" + encodeURIComponent(q));
    if (!r.ok) { toast(errText(r)); return; }
    hits = r.hits; drawLeft();
    $("#mid").innerHTML = `<div class="mh"><button class="btn back" id="toList">←</button><div><h1>「${esc(q)}」を探した結果</h1><small>${r.count} 件（やり取り・添削・メモ）</small></div><span class="g"></span><button class="btn" id="clr">探すのをやめる</button></div>
      <div class="results">${hits.map((h, k) => `<button class="res" data-k="${k}"><small>${esc(h.name)}・${esc(h.kind)}・${esc(h.from)}・${esc(fmtTime(h.at))}</small>${esc(h.text).split(esc(q)).join(`<mark>${esc(q)}</mark>`)}</button>`).join("") || '<p class="empty">見つかりませんでした。言葉を変えてみてください</p>'}</div>`;
    $("#toList").onclick = () => setView("list");
    $("#clr").onclick = () => { $("#q").value = ""; hits = null; drawLeft(); if (D) drawMid(); else $("#mid").innerHTML = ""; $("#q").focus(); };
    $$("[data-k]", $("#mid")).forEach((b) => (b.onclick = () => { const h = hits[+b.dataset.k]; openChat(h.person_id, h.event_id); }));
    setView("chat"); live(`${r.count} 件見つかりました`);
  };

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
    if (e.key === "]" && D) { e.preventDefault(); $("#sideBtn")?.click(); }
  });
  function keysDlg() {
    const K = [["⌘／Ctrl＋K", "名前で探してチャットを開く"], ["⌘／Ctrl＋Enter", "送信・メモを残す"], ["↑ ↓", "メッセージを移る（メッセージを選んでいるとき）"], ["T", "タスクへ追加"], ["F", "転送（メモとして）"], ["C", "コピー"], ["Enter・右クリック", "操作の一覧"], ["]", "右を開く・閉じる"], ["Esc", "閉じる"]];
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

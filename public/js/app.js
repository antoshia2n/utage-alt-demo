import { getClient, api, esc, fmtTime, authImage, shrinkImage, noticeHtml } from "/js/common.js";
import { correctionHtml, wireNotes } from "/js/correction.js";
import { setupStudentPush } from "/js/pushclient.js";
import { flatten, homeHtml, libraryHtml, searchHtml } from "/js/home.js";
import { planHtml, chainHtml, popHtml, homeCardHtml, tacHtml, recHtml, reviewHtml, growHtml, reportFor, applyAction, applyField, applyWeek, applyNext, carryTry, setPath, weekNo, weekInfo, WEEKS, draftHtml } from "/js/goalplan.js";



const $ = (id) => document.getElementById(id);
// 便 8g-1：確認コードで入ったときは /app?fresh=1 で来る（リンクのときは住所の # に access_token）
const fresh = /access_token=/.test(location.hash) || new URLSearchParams(location.search).get("fresh") === "1";
const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });

// 5b：スマホの上の帯の右端まで送ったら、続きの印（右端を薄く）を外す
// 失敗の言葉（ムダ 4・2026-10-30）：生徒には日本語だけを出し、開発の言葉は裏の記録（console）にだけ残す
const ERR_TEXT = {
  not_found: "見つかりませんでした。画面を読み直してください",
  not_registered: "このメールアドレスは台帳にありません",
  unauthorized: "ログインが切れました。もう一度ログインしてください",
  too_long: "文が長すぎます。短くしてもう一度お試しください",
  empty: "中身が空です",
  too_many_images: "画像が多すぎます",
  too_large: "画像が大きすぎます",
  no_image_store: "いまは画像を送れません",
  not_ready: "準備中です",
};
function errText(x) {
  const code = x && (x.error || x.status);
  if (code) console.warn("error:", code);
  return ERR_TEXT[x && x.error] || "時間をおいてもう一度お試しください";
}
function watchSideEnd() {
  const side = document.querySelector(".side");
  if (!side) return;
  const mark = () => side.classList.toggle("at-end", side.scrollLeft + side.clientWidth >= side.scrollWidth - 4);
  side.addEventListener("scroll", mark, { passive: true });
  window.addEventListener("resize", mark);
  mark();
}



function fail(text) {
  $("loading").classList.add("hidden");
  $("err").textContent = text;
  $("err").classList.remove("hidden");
}

async function main() {
  let sb;
  try { sb = await getClient(); } catch (e) { return fail(e.message); }
  if (hashErr) return fail("ログインのリンクが使えませんでした：" + hashErr + "　もう一度ログイン画面からリンクを受け取ってください。");
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return location.replace("/login");
  const token = session.access_token;
  if (fresh) history.replaceState(null, "", "/app");

  const mpWait = api("/api/mypage", { token }); // マイページ（2026-10-29）：教材と並べて読む
  const r = await api("/api/me" + (fresh ? "?fresh=1" : ""), { token });
  if (!r.ok) {
    if (r.error === "not_registered") return fail("このメールアドレスは台帳にありません。無料登録からやり直してください。");
    return fail("読み込めませんでした。" + errText(r));
  }
  $("loading").classList.add("hidden");
  $("main").classList.remove("hidden");
  watchSideEnd();
  $("who").textContent = r.me.name || r.me.email;
  $("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace("/"); });
  // 便 2（関門 5）：共通の外枠（？・アプリ一覧・アカウント）。読めなかったときは今までの名前とログアウトのまま
  {
    try {
      const { mountStudentShell } = await import("/js/student-shell.js");
      mountStudentShell($("shell-slot"), { me: r, sb, session, onContract: () => { location.hash = "#contract"; } });
      $("shell-slot").classList.remove("hidden");
      $("who-line").classList.add("hidden");
      $("logout").classList.add("hidden");
    } catch (e) { console.warn("shell", e); }
  }
  // 関門 1（2026-10-29）：会員でない人（無料の登録・会員でない買い手）は「ご契約」だけ。ほかのタブは出さない
  if (r.access === "contract") {
    // 2026-11-05：個別相談の予約は、ご契約だけの画面でも権利が合えば出す
    const bkOn = r.booking_ready === true;
    document.querySelectorAll(".side [data-tab]").forEach((b) => b.classList.toggle("hidden", !(b.dataset.tab === "contract" || (bkOn && b.dataset.tab === "booking"))));
    if (bkOn) {
      const pick = (name) => {
        ["contract", "booking"].forEach((t) => { $("tab-" + t).classList.toggle("hidden", t !== name); document.querySelector(`.side [data-tab="${t}"]`).setAttribute("aria-selected", String(t === name)); });
        $("crumb").textContent = name === "booking" ? "予約" : "ご契約";
        if (name === "booking") loadBooking(session.access_token);
      };
      document.querySelector('.side [data-tab="booking"]').addEventListener("click", () => pick("booking"));
      document.querySelector('.side [data-tab="contract"]').addEventListener("click", () => pick("contract"));
      if (location.hash === "#booking") setTimeout(() => pick("booking"), 0);
    }
    const cb = document.querySelector('.side [data-tab="contract"]'); cb.innerHTML = '<span class="lbl">ご契約</span>'; cb.removeAttribute("data-quiet");
    $("news-btn").classList.add("hidden");
    ["mypage", "goals", "lessons", "lesson", "news", "room", "review", "booking", "apps"].forEach((t) => $("tab-" + t).classList.add("hidden"));
    $("tab-contract").classList.remove("hidden");
    $("tab-contract").insertAdjacentHTML("afterbegin", r.member_waiting
      ? '<div class="card"><h3>マイページは準備中です</h3><p class="note" style="margin:0">教材は今までどおり <a href="https://manabu.shia2n.jp/" target="_blank" rel="noopener">学ぶくん ↗</a> で見られます。ご契約の内容と、定期の停止はここからできます。</p></div>'
      : '<div class="card"><h3>この画面はご契約の確認用です</h3><p class="note" style="margin:0">教材・添削ルーム・マイページは、しあらぼの会員向けです。ご契約の内容と、定期の停止はここからできます。</p></div>');
    $("crumb").textContent = "ご契約";
    document.querySelector('.side [data-tab="contract"]').setAttribute("aria-selected", "true");
    document.querySelector('.side [data-tab="contract"]').addEventListener("click", () => loadContract(session.access_token));
    loadContract(session.access_token);
    return;
  }

  const viewed = new Set(r.viewed);
  const views = Array.isArray(r.views) ? r.views : r.viewed.map((id) => ({ id, at: "1970-01-01T00:00:00Z" }));
  let flat = [], libKind = "すべて";
  const lib = r.library || { source: "demo", member: true, programs: [] };
  // 便 6a：学ぶくんの本物の教材（プログラム → コース → 教材）
  const lessons = {};
  const pill = (id) => viewed.has(id) ? ' <span class="pill">視聴済み</span>' : "";
  const lessonRow = (l, i) => {
    lessons[l.id] = l;
    return `<div class="card lesson" data-id="${esc(l.id)}" data-q="${esc(String(l.title).toLowerCase())}" tabindex="0" role="button">
      <div class="num">${String(i + 1).padStart(2, "0")}</div>
      <div style="flex:1;min-width:0"><h3>${esc(l.title)}</h3><div class="meta">${l.youtube_id ? "動画" : "文章"}${l.mindmap_url ? "・マインドマップ" : ""}${l.minutes ? "・" + l.minutes + " 分" : ""}${pill(l.id)}</div></div>
    </div>`;
  };
  if (lib.source === "manabu" && !lib.member) {
    $("tab-lessons").innerHTML = '<div class="card"><h3>教材は会員向けです</h3><p class="note" style="margin:0">しあらぼの会員になると、セミナーのアーカイブと講座の教材がここで見られます。</p></div>';
  } else if (lib.source === "manabu") {
    // 生徒のホームと教材の図書館（2026-11-04）：種類ごとの棚・絞り込み・探す
    flat = flatten(lib.programs);
    flat.forEach((x) => { lessons[x.id] = x; });
    const drawLib = (kind) => {
      libKind = kind || "すべて";
      $("tab-lessons").innerHTML = libraryHtml(flat, views, libKind);
      $("tab-lessons").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { drawLib(b.dataset.kind); $("tab-lessons").scrollIntoView({ block: "start" }); }));
      $("lib-q").addEventListener("input", (e) => {
        const q = e.target.value;
        $("lib-body").classList.toggle("hidden", !!q.trim());
        $("lib-found").classList.toggle("hidden", !q.trim());
        if (q.trim()) $("lib-found").innerHTML = searchHtml(flat, views, q, libKind);
      });
    };
    drawLib("すべて");
  } else {
    $("tab-lessons").innerHTML = r.lessons.map(lessonRow).join("") || '<p class="note">教材はまだありません。</p>';
  }

  $("tab-news").innerHTML = r.announcements.map((a) => `
    <div class="card"><time class="note">${fmtTime(a.published_at)}</time><h3>${esc(a.title)}</h3><p class="note" style="margin:0">${esc(a.body)}</p></div>`).join("")
    || '<p class="note">お知らせはまだありません。</p>';
  // 便 8g-2：自分の紹介のリンク（このリンクから登録した人の数だけを出す）
  if (r.referral && r.referral.link) {
    const rf = r.referral;
    $("tab-news").insertAdjacentHTML("afterbegin", `<div class="card" id="referral"><h3>紹介のリンク</h3>
      <p class="note">このリンクから登録した人は、あなたの紹介として記録されます。</p>
      <p class="note" style="word-break:break-all;margin:0"><code>${esc(rf.link)}</code></p>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn ghost small" id="rf-copy" type="button">リンクを写す</button><span class="note">紹介で登録 ${rf.referred} 人${rf.reward_total ? "・報酬 " + Number(rf.reward_total).toLocaleString() + " 円（払い済み " + Number(rf.paid_total).toLocaleString() + " 円）" : ""}</span></div></div>`);
    $("rf-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(rf.link); $("rf-copy").textContent = "写しました"; } catch (_) { $("rf-copy").textContent = "写せませんでした"; } });
  }

  // 個別相談の予約（2026-11-05）：予約できる種類が 1 つでもあれば、左のメニューとホームの 1 行に出す
  const bookingReady = r.booking_ready === true;
  const sections = ["home", "mypage", "goals", "lessons", "lesson", "news", "room", "review", "booking", "contract", "apps"];
  const showTab = (name) => {
    sections.forEach((s) => $("tab-" + s).classList.toggle("hidden", s !== name));
    if (name === "room") room.open();
    if (name === "review") loadReview(token);
    if (name === "goals") loadGoals(token);
    if (name === "booking") loadBooking(token);
    if (name === "contract") loadContract(token);
    if (name === "apps") renderApps(r);
    if (name === "home") drawHome();
    if (name === "news") markNewsSeen(r);
    // 便 8c：左のメニューの印と、上のナビの名前
    document.querySelectorAll(".side [data-tab]").forEach((b) => {
      const on = b.dataset.tab === name || (name === "lesson" && b.dataset.tab === "lessons") || (name === "mypage" && b.dataset.tab === "home");
      b.setAttribute("aria-selected", String(on));
      if (on) $("crumb").textContent = b.dataset.label || b.textContent.trim();
      // 5b：スマホの上の帯では、今いるタブを見える位置へ送る
      if (on && window.matchMedia("(max-width: 860px)").matches) b.scrollIntoView({ block: "nearest", inline: "center" });
    });
  };
  document.querySelectorAll(".side [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("back").addEventListener("click", (e) => { e.preventDefault(); showTab("lessons"); });
  // ホーム：版ごとの段。テーマはこのブラウザに覚える
  const THEME_KEY = "lab:theme";
  const drawHome = () => {
    if (!flat.length) { $("tab-home").innerHTML = $("tab-lessons").innerHTML; return; }
    let theme = null; try { theme = localStorage.getItem(THEME_KEY); } catch { /* 覚えられなくても動く */ }
    $("tab-home").innerHTML = homeHtml({ tier: r.tier || "lab", rows: r.home_rows, flat, views, seed: r.me.email || "", theme });
    paintBookingLine(bookingReady);
    paintGoalCard();
    const sel = $("home-theme");
    if (sel) sel.addEventListener("change", () => { try { localStorage.setItem(THEME_KEY, sel.value); } catch { /* 覚えられなくても今は変わる */ } drawHome(); $("home-theme") && $("home-theme").focus(); });
  };
  // 絵を押したら、その教材を開く（同じ教材をもう一度押したときも開くように、住所の変化を待たない）
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("#tab-home a.v[data-id], #tab-lessons a.v[data-id]");
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    history.pushState(null, "", "#lesson/" + encodeURIComponent(a.dataset.id));
    openLesson(a.dataset.id);
  });

  const openLesson = async (id) => {
    const l = lessons[id]; if (!l) return;
    $("l-title").textContent = l.title;
    $("l-summary").textContent = l.summary || "";
    $("l-mindmap").innerHTML = l.mindmap_url ? `<a class="btn ghost small" href="${esc(l.mindmap_url)}" target="_blank" rel="noopener">マインドマップを開く</a>` : "";
    $("l-player").classList.toggle("hidden", !l.youtube_id && lib.source === "manabu");
    const frame = (start) => `<iframe src="https://www.youtube-nocookie.com/embed/${esc(l.youtube_id)}${start ? `?start=${start}&autoplay=1` : ""}" title="${esc(l.title)} の動画" style="width:100%;height:100%;border:0;border-radius:10px" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    $("l-player").innerHTML = l.youtube_id ? frame(0) : "この教材には動画がありません";
    // 会員サイトの管理（便 22）：目次（押すとその時間から再生）と資料
    const secs = (t) => String(t).split(":").reduce((a, x) => a * 60 + (Number(x) || 0), 0);
    const toc = Array.isArray(l.toc) ? l.toc : [], files = Array.isArray(l.files) ? l.files : [];
    // 目次は一旦出さない（2026-10-29 11:31 Naoki「うまくいかない、一旦なくていい」）。資料だけ出す
    $("l-extra").innerHTML = (false && toc.length ? `<section class="card stack"><h3 style="margin:0">目次</h3><div class="stack" style="gap:4px">${toc.map((x) => l.youtube_id
      ? `<button type="button" class="btn ghost small" style="justify-content:flex-start;text-align:left" data-at="${secs(x.at)}"><b style="font-variant-numeric:tabular-nums;margin-right:8px">${esc(x.at)}</b>${esc(x.label)}</button>`
      : `<div><b style="font-variant-numeric:tabular-nums;margin-right:8px">${esc(x.at)}</b>${esc(x.label)}</div>`).join("")}</div></section>` : "")
      + (files.length ? `<section class="card stack"><h3 style="margin:0">資料</h3>${files.map((f) => `<a class="btn ghost small" style="justify-content:flex-start" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label)}</a>`).join("")}</section>` : "");
    $("l-extra").querySelectorAll("[data-at]").forEach((b) => b.addEventListener("click", () => {
      $("l-player").innerHTML = frame(Number(b.dataset.at));
      $("l-player").scrollIntoView({ block: "nearest" });
    }));
    showTab("lesson");
    window.scrollTo(0, 0);
    loadLessonNotes(id);
    const res = await api("/api/events", { method: "POST", token, body: { type: "lesson_viewed", lesson_id: id } });
    // 記録できたら一覧の印をその場で付ける（読み直さなくても見える）
    if (res.ok && !viewed.has(id)) {
      viewed.add(id);
      document.querySelectorAll(`.lesson[data-id="${CSS.escape(id)}"] .meta`).forEach((meta) => meta.insertAdjacentHTML("beforeend", ' <span class="pill">視聴済み</span>'));
    }
  };
  // 便 15：教材の下の質問と答え・自分のメモ
  let qaLesson = null;
  const fmtQa = (t) => `<time class="note">${esc(fmtTime(t))}</time>`;
  async function loadLessonNotes(id) {
    qaLesson = id;
    $("l-q").value = ""; $("l-q-status").textContent = ""; $("l-memo-status").textContent = "";
    const n = await api("/api/lesson/notes?lesson_id=" + encodeURIComponent(id), { token });
    if (qaLesson !== id) return; // 読み込みの間に別の教材を開いた
    $("l-qa").classList.toggle("hidden", !n.ok);
    $("l-memo-box").classList.toggle("hidden", !n.ok);
    if (!n.ok) return;
    // 便 22：質問を受け付けないコンテンツは、送る欄を出さない（前の質問と答えは見える）
    const canAsk = !lessons[id] || lessons[id].can_ask !== false;
    ["l-q", "l-ask"].forEach((k) => $(k).classList.toggle("hidden", !canAsk));
    $("l-q-status").textContent = canAsk ? "" : "このコンテンツは質問を受け付けていません";
    $("l-questions").innerHTML = n.questions.map((q) => `<div class="qa">
      <div class="msg-me"><div class="bubble chat mine"><div class="pre">${esc(q.text)}</div></div><div class="meta">${fmtQa(q.at)}</div></div>
      ${q.answers.length ? q.answers.map((a) => `<div class="msg-them"><div class="bubble chat"><div class="pre">${esc(a.text)}</div></div><div class="meta">${fmtQa(a.at)}<span class="pill gray">シアニンの答え</span></div></div>`).join("")
        : '<p class="note" style="margin:4px 0 0">答えを待っています</p>'}
    </div>`).join("");
    $("l-memo").value = n.memo ? n.memo.text : "";
  }
  $("l-ask").addEventListener("click", async () => {
    const text = $("l-q").value.trim();
    if (!qaLesson || !text) { $("l-q-status").textContent = "質問を入れてください"; return; }
    $("l-ask").disabled = true;
    const r2 = await api("/api/room", { method: "POST", token, body: { kind: "chat", lesson_id: qaLesson, text } });
    $("l-ask").disabled = false;
    if (!r2.ok) { $("l-q-status").textContent = "送れませんでした。" + errText(r2); return; }
    await loadLessonNotes(qaLesson);
    $("l-q-status").textContent = "送りました";
  });
  $("l-memo-save").addEventListener("click", async () => {
    if (!qaLesson) return;
    const r2 = await api("/api/lesson/memo", { method: "POST", token, body: { lesson_id: qaLesson, text: $("l-memo").value } });
    $("l-memo-status").textContent = r2.ok ? "保存しました" : "保存できませんでした。" + errText(r2);
  });
  document.querySelectorAll(".lesson").forEach((el) => {
    el.addEventListener("click", () => openLesson(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openLesson(el.dataset.id); });
  });

  setupMember(r.entitlement, r.me.email);
  const room = setupRoom(token, r.community_url, r.community);
  room.setBadge(r.room_unread);
  // 便 15b：#room/chat・#room/corr は、部屋のその枠を開く
  if (location.hash.startsWith("#room")) { room.setPane(location.hash.split("/")[1]); showTab("room"); }
  // マイページ：公開中の版があれば左の一番上に出し、住所に # が無ければ最初に開く。枠の高さは枠の中から知らせてもらう
  const mp = await mpWait;
  if (mp.ok && mp.html) {
    const fr = $("mypage-frame");
    window.addEventListener("message", (e) => {
      if (e.source !== fr.contentWindow || !e.data || typeof e.data.labMypageHeight !== "number") return;
      fr.style.height = Math.min(Math.max(e.data.labMypageHeight, 200), 20000) + "px";
    });
    fr.srcdoc = mp.html;
    // 前のマイページ（HTML の版）は、住所 #mypage で開いたときだけ出す（最初の画面はホーム・2026-11-04）
  }
  // マイページの枠の中のリンク：#lesson/<番号> はそのコンテンツ、#news はお知らせ
  const routeLesson = () => {
    const m = location.hash.match(/^#lesson[/](.+)$/); if (m) { openLesson(decodeURIComponent(m[1])); return true; }
    // #program/<番号>：教材の一覧で、そのプログラムを開いて見えるところまで動かす。#lessons：教材の一覧
    const pg = location.hash.match(/^#program[/](.+)$/);
    if (pg || location.hash === "#lessons") {
      showTab("lessons");
      const d = pg && document.querySelector(`details.prog[data-pid="${CSS.escape(decodeURIComponent(pg[1]))}"]`);
      if (d) { d.open = true; d.scrollIntoView({ block: "start" }); d.querySelector("summary").focus(); }
      return true;
    }
    return false;
  };
  routeLesson();
  $("news-btn").addEventListener("click", () => { location.hash = "#news"; showTab("news"); });
  paintNewsDot(r);
  if (location.hash === "#news") showTab("news");
  if (location.hash === "#apps") showTab("apps");
  if (location.hash === "#lessons") showTab("lessons");
  if (!location.hash || location.hash === "#home") showTab("home");
  if (location.hash === "#review") showTab("review");
  // ムダ 2（2026-10-30）：予約は、サーバーが準備できたと返すまで左のメニューに出さない
  document.querySelector('.side [data-tab="booking"]').classList.toggle("hidden", !bookingReady);
  if (location.hash === "#booking" && bookingReady) showTab("booking");
  // 目標タブ（2026-10-30）：しあらぼの生徒だけ
  const goalsReady = r.goals_ready === true;
  document.querySelector('.side [data-tab="goals"]').classList.toggle("hidden", !goalsReady);
  if (goalsReady) { wireGoals(token); gReady = true; paintGoalCard(); }
  if (location.hash === "#goals" && goalsReady) showTab("goals");
  if (location.hash === "#contract") showTab("contract");
  // 便 8g-1：通知を押して開いた画面がもう出ているとき、住所の # だけが変わるので、ここで部屋へ移る
  window.addEventListener("hashchange", () => {
    const [h, pane] = location.hash.slice(1).split("/");
    if (h === "room") room.setPane(pane);
    if (["home", "lessons", "room", "review", "contract", "news", "mypage", "apps"].includes(h) || (h === "booking" && bookingReady) || (h === "goals" && goalsReady)) showTab(h);
    routeLesson();
  });
  setupStudentPush({ box: $("push-box"), status: $("push-status"), on: $("push-on"), off: $("push-off") }, token);


  if (fresh) maybeShowA2hs();
}

// ---------- 添削の振り返り（便 6a）：返ってきた添削だけを新しい順に。出した文章の日付と並べる ----------
// ムダ 3（2026-10-30）：添削の画面は、見回りが直近 30 秒以内に読んだ部屋を使い回す。古いときだけ読み直す
let roomCache = null;
async function roomData(token) {
  if (roomCache && Date.now() - roomCache.at < 30000) return roomCache.r;
  const r = await api("/api/room", { token });
  if (r.ok) roomCache = { r, at: Date.now() };
  return r;
}
async function loadReview(token) {
  const box = $("review-list");
  const r = await roomData(token);
  if (!r.ok) { box.innerHTML = `<div class="msg err">読めませんでした。${esc(errText(r))}</div>`; return; }
  const subs = Object.fromEntries(r.messages.filter((m) => m.from === "student").map((m) => [String(m.id), m]));
  const back = r.messages.filter((m) => m.from === "cyanin" && m.kind !== "chat").reverse();
  $("review-count").textContent = back.length ? `これまでに返ってきた添削 ${back.length} 件（新しい順）` : "";
  box.innerHTML = back.map((m, i) => {
    const sub = subs[String(m.reply_to)];
    return `<details class="card review"${i === 0 ? " open" : ""}>
      <summary><time>${fmtTime(m.at).slice(0, 10)}</time><span class="review-t">${esc(String(m.comment || m.corrected || "").replace(/\s+/g, " ").slice(0, 40))}</span>${(m.notes || []).length ? `<span class="pill gray">指摘 ${m.notes.length}</span>` : ""}</summary>
      ${sub ? `<div class="note" style="margin:8px 0">出した日：${fmtTime(sub.at)}</div>` : ""}
      ${correctionHtml(m)}
    </details>`;
  }).join("") || '<div class="empty note card">まだ返ってきた添削はありません。添削ルームから文章を出すと、ここに積み上がります。</div>';
  wireNotes(box);
}

// ---------- 便 R3：ご契約（自分の定期と分割。定期は自分で止められる） ----------
const day = (iso) => iso ? fmtTime(iso).slice(0, 10) : "";
async function loadContract(token) {
  const box = $("ct-list");
  const r = await api("/api/me/subscriptions", { token });
  if (!r.ok) { box.innerHTML = `<div class="msg err">読めませんでした。${esc(errText(r))}</div>`; return; }
  box.innerHTML = r.subscriptions.map((s) => {
    const lines = [esc(s.price)];
    if (s.since) lines.push(day(s.since) + " から");
    if (s.kind === "installment") lines.push(`全 ${s.installments} 回のうち ${s.payments} 回お支払い済み${s.remaining ? "・残り " + s.remaining + " 回" : ""}`);
    if (s.next_charge_at) lines.push("次のお支払い " + day(s.next_charge_at));
    if (s.status === "ending" && s.keep_until) lines.push(day(s.keep_until) + " までお使いいただけます");
    return `<div class="card"><div class="member-row"><div><b>${esc(s.product_name)}</b>${s.test ? ' <span class="pill gray">試し</span>' : ""}
        <div class="note">${lines.join("・")}</div></div>
        <span class="pill${s.status === "active" ? "" : " gray"}">${esc(s.status_label)}</span></div>
      ${s.can_cancel ? `<div class="ct-stop" style="margin-top:8px"><button class="btn ghost small" type="button" data-stop="${esc(s.subscription_id)}">この定期を止める</button></div>` : ""}
    </div>`;
  }).join("") || '<div class="card note">続いている契約はありません。</div>';
  box.querySelectorAll("[data-stop]").forEach((b) => b.addEventListener("click", () => {
    const s = r.subscriptions.find((x) => x.subscription_id === b.dataset.stop);
    const wrap = b.parentElement;
    // 押し間違いを防ぐため、確かめの 1 段を挟む
    wrap.innerHTML = `<div class="msg"><b>${esc(s.product_name)} を止めますか？</b>
      <div class="note">次のお支払い（${day(s.next_charge_at)}）から請求されなくなります。${day(s.next_charge_at)} まではこれまでどおりお使いいただけます。止めたあとに続けるときは、もう一度お申し込みください。</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" type="button" data-yes>止める</button><button class="btn ghost small" type="button" data-no>やめておく</button></div></div>`;
    wrap.querySelector("[data-no]").addEventListener("click", () => loadContract(token));
    wrap.querySelector("[data-yes]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const res = await api("/api/me/subscriptions/cancel", { method: "POST", token, body: { subscription_id: s.subscription_id } });
      const why = { installment_not_cancelable: "分割のお支払いはここからは止められません", univapay_cancel_failed: "決済の会社で止められませんでした。時間をおいてもう一度お試しください", no_paid_until: "次のお支払いの日が分からないため止められませんでした。メールでご連絡ください" };
      $("ct-status").textContent = res.ok ? `止めました。${res.keep_until ? day(res.keep_until) + " までお使いいただけます。" : ""}` : (why[res.error] || "止められませんでした。" + errText(res));
      loadContract(token);
    });
  }));
}

// ---------- 個別相談の予約（2026-11-05）：マーケくんの予約の種類（audience=member） ----------
// ホームの上に小さく 1 行（学びの記録の上・目標のカードの下）
function paintBookingLine(ready) {
  const home = $("tab-home") && $("tab-home").querySelector(".home"); if (!home || !ready) return;
  const old = home.querySelector(".bk-line"); if (old) old.remove();
  home.insertAdjacentHTML("afterbegin", `<div class="bk-line"><span>シアニンに相談したいときは</span><a class="btn small" href="#booking">相談を予約する →</a></div>`);
}
const BK_WHY = { slot_taken: "その時間はちょうど埋まりました。ほかの時間を選んでください", already_booked: "この相談は、すでに予約があります", bad_slot: "その時間は選べません", answer_required: "書いていない欄があります", not_found: "この予約はいま受け付けていません" };
let bkPick = null; // { slug, slot, label }
async function loadBooking(token) {
  const r = await api("/api/booking", { token });
  if (!r.ok) { $("bk-status").textContent = "読めませんでした。" + errText(r); return; }
  $("bk-status").textContent = "";
  $("bk-mine").innerHTML = (r.mine || []).map((b) => `<div class="card bk-mine"><div><div class="note" style="margin:0">予約中</div><b>${esc(b.label)}</b>・${esc(b.title)}${/分/.test(b.title) ? "" : `（${esc(b.minutes)} 分）`}</div>
    <button class="btn ghost small" type="button" data-cancel="${esc(b.slot)}" aria-label="${esc(b.label + " の予約を取り消す")}">取り消す</button></div>`).join("");
  if (!r.ready) { $("bk-types").innerHTML = `<p class="note">${esc(r.note || "いま予約できる個別相談はありません")}</p>`; wireCancel(token); return; }
  $("bk-types").innerHTML = r.types.map((t) => {
    const head = `<h2 class="bk-h">${esc(t.title)}${t.paused ? ' <span class="pill gray">止めている（管理者だけに見えています）</span>' : ""}</h2><p class="note" style="margin:0">${/分/.test(t.title) ? "" : esc(t.minutes) + " 分・"}ご都合のよい時間を 1 つ選んでください</p>`;
    if (t.booked) return `<section class="card stack">${head}<p class="note" style="margin:0">この相談は予約済みです。別の日時にするときは、上の予約を取り消してから選んでください。</p></section>`;
    if (!t.slots.length) return `<section class="card stack">${head}<p class="note" style="margin:0">いま予約できる空き時間がありません。少し時間をおいてもう一度ご覧ください。</p></section>`;
    const days = [];
    for (const s of t.slots) { let d = days.find((x) => x.day === s.day); if (!d) days.push(d = { day: s.day, items: [] }); d.items.push(s); }
    const qs = (t.questions || []).map((q) => `<div><label for="bkq-${esc(t.slug)}-${esc(q.key)}">${esc(q.label)}${q.required ? '<span class="req">（必須）</span>' : ""}</label>
      ${q.kind === "text" ? `<input type="text" id="bkq-${esc(t.slug)}-${esc(q.key)}" data-q="${esc(q.key)}" maxlength="200" value="${esc(q.hint)}">`
        : `<textarea id="bkq-${esc(t.slug)}-${esc(q.key)}" data-q="${esc(q.key)}" rows="${q.hint ? Math.min(8, q.hint.split("\n").length + 1) : 3}" maxlength="4000">${esc(q.hint)}</textarea>`}</div>`).join("");
    return `<section class="card stack" data-type="${esc(t.slug)}">${head}
      <div class="slots">${days.map((d) => `<div class="slot-day"><div class="slot-date">${esc(d.day)}</div><div class="slot-row">${d.items.map((s) => `<button type="button" class="slot" aria-pressed="false" data-slot="${esc(s.slot)}" data-label="${esc(s.label)}">${esc(s.label.split("）")[1] || s.label)}</button>`).join("")}</div></div>`).join("")}</div>
      <div class="bk-form stack hidden"><div class="note" data-picked></div>${qs}
        <div><button class="btn" type="button" data-go>この日時で予約する</button></div><div class="note" data-msg aria-live="polite"></div></div></section>`;
  }).join("");
  document.querySelectorAll("#bk-types [data-type]").forEach((sec) => {
    const slug = sec.dataset.type, form = sec.querySelector(".bk-form");
    sec.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => {
      sec.querySelectorAll("[data-slot]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      bkPick = { slug, slot: b.dataset.slot, label: b.dataset.label };
      form.querySelector("[data-picked]").textContent = "選んだ日時：" + b.dataset.label;
      form.classList.remove("hidden");
    }));
    sec.querySelector("[data-go]").addEventListener("click", async (ev) => {
      const go = ev.currentTarget, msg = sec.querySelector("[data-msg]");
      if (!bkPick || bkPick.slug !== slug) { msg.textContent = "日時を 1 つ選んでください"; sec.querySelector("[data-slot]").focus(); return; }
      const answers = Object.fromEntries([...sec.querySelectorAll("[data-q]")].map((x) => [x.dataset.q, x.value]));
      go.disabled = true; msg.textContent = "予約しています…";
      const res = await api("/api/booking", { method: "POST", token, body: { slug, slot: bkPick.slot, answers } });
      go.disabled = false;
      if (!res.ok) {
        msg.textContent = (res.error === "answer_required" ? `「${res.label}」を書いてください` : BK_WHY[res.error]) || "予約できませんでした。" + errText(res);
        const f = res.key && sec.querySelector(`[data-q="${CSS.escape(res.key)}"]`); if (f) f.focus();
        if (res.error === "slot_taken") loadBooking(token);
        return;
      }
      bkPick = null;
      await loadBooking(token);
      $("bk-status").textContent = `${res.label} で予約しました。確認のメールをお送りしました`;
    });
  });
  wireCancel(token);
}
function wireCancel(token) {
  document.querySelectorAll("#bk-mine [data-cancel]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    const res = await api("/api/booking/cancel", { method: "POST", token, body: { slot: b.dataset.cancel } });
    await loadBooking(token);
    $("bk-status").textContent = res.ok ? "予約を取り消しました。もう一度予約するときは、下から日時を選べます" : "取り消せませんでした。" + errText(res);
  }));
}

// ---------- 会員の権利（便 3）と、商品を買う（B の便 4） ----------
function setupMember(ent, email) {
  const box = $("member");
  box.classList.remove("hidden");
  const owned = (ent && ent.items ? ent.items : []).filter((x) => x.status === "active");
  const ownedHtml = owned.map((x) => `<div class="member-row"><span class="pill">${x.kind === "subscription" ? "会員" : "購入済み"}</span><span class="note">${esc(x.name || "")}・${x.since ? fmtTime(x.since).slice(0, 10) + " から" : ""}${x.until ? "・" + fmtTime(x.until).slice(0, 10) + " まで" : ""}</span></div>`).join("");
  box.innerHTML = ownedHtml + `<div id="m-shop"></div><div id="m-msg" class="note" style="margin-top:8px"></div>`;
  fetch("/api/config").then((x) => x.json()).then(async (cfg) => {
    if (!cfg.univapayAppId) { if (!owned.length) $("m-msg").textContent = "決済の設定がまだ入っていません"; return; }
    const r = await fetch("/api/products").then((x) => x.json()).catch(() => ({ products: [] }));
    const { priceLabel } = await import("/js/pay.js");
    const list = (r.products || []).filter((p) => !owned.some((o) => o.product_id === p.id && o.kind === "subscription"));
    if (!list.length) { if (!owned.length) $("m-msg").textContent = "いまお申し込みを受け付けている商品はありません"; return; }
    $("m-shop").innerHTML = list.map((p) => `<div class="member-row"><div><b>${esc(p.name)}</b><div class="note">${esc(priceLabel(p))}${p.description ? "・" + esc(p.description) : ""}</div></div><button class="btn" data-buy="${esc(p.id)}" type="button">申し込む</button></div>`).join("");
    box.querySelectorAll("[data-buy]").forEach((btn) => btn.addEventListener("click", async () => {
      box.querySelectorAll("[data-buy]").forEach((x) => { x.disabled = true; });
      try {
        const { startCheckout } = await import("/js/pay.js");
        const res = await startCheckout({ email, product: btn.dataset.buy || null, onStatus: (t) => { $("m-msg").textContent = t; } });
        setupMember(res.entitlement, email);
      } catch (err) {
        $("m-msg").textContent = err.message;
        box.querySelectorAll("[data-buy]").forEach((x) => { x.disabled = false; });
      }
    }));
  });
}

// ---------- 添削ルーム ----------
function setupRoom(token, communityUrl, communityState) {
  let opened = false, pending = [], timer = null, lastCount = -1, lastSig = "";
  // 便 15b：今の枠（corr 添削／chat やり取り）と、まだ開いていない枠の新着の数（部屋を開くと全部既読になるので、枠を見るまでここで覚える）
  let pane = null, last = { messages: [], notices: [] };
  const seen = { corr: 0, chat: 0 };
  try { const p = localStorage.getItem("room_pane"); if (p === "corr" || p === "chat") pane = p; } catch (_) {}

  // 便 7a：招待リンクは会員にだけ届く（会員でない人には URL そのものが返らない）
  $("community").innerHTML = communityUrl
    ? `<h3>生徒同士の場</h3><p class="note">ほかの受講生と話せるオープンチャットです（こことはつながっていません）。</p><a class="btn ghost" href="${esc(communityUrl)}" target="_blank" rel="noopener">開く</a>`
    : communityState === "locked"
      ? `<h3>生徒同士の場</h3><p class="note">会員になると、ほかの受講生と話せるオープンチャットの招待リンクがここに出ます。</p>`
      : `<h3>生徒同士の場</h3><p class="note">オープンチャットの招待リンクを準備中です。</p>`;

  const setBadge = (n) => {
    const b = $("room-badge");
    b.textContent = n > 0 ? String(n) : "";
    b.classList.toggle("hidden", !(n > 0));
    try { if (navigator.setAppBadge) n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (_) {}
  };

  const block = (label, text, cls = "") => `<div class="rb ${cls}"><div class="rb-l">${label}</div><div class="rb-t">${esc(text) || '<span class="note">（なし）</span>'}</div></div>`;

  const imgs = (m, alt) => m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="${alt}">`).join("")}</div>` : "";
  const corrHtml = (m) => m.from === "student"
    ? `<div class="msg-me"><div class="bubble">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${imgs(m, "出した画像")}</div>
        <div class="meta"><time>${fmtTime(m.at)}</time>${m.replied ? '<span class="pill">返信済み</span>' : m.read_by_cyanin ? '<span class="pill gray">既読</span>' : ""}</div></div>`
    : `<div class="msg-them"><div class="reply card">
        <div class="reply-h">シアニンからの添削</div>
        ${correctionHtml(m)}
      </div><div class="meta"><time>${fmtTime(m.at)}</time></div></div>`;
  const chatHtml = (m) => m.from === "student"
    ? `<div class="msg-me"><div class="bubble chat mine">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${imgs(m, "出した画像")}</div>
        <div class="meta"><time>${fmtTime(m.at)}</time>${m.lesson ? `<span class="pill gray">教材の質問：${esc(m.lesson.title)}</span>` : ""}${m.read_by_cyanin ? '<span class="pill gray">既読</span>' : ""}</div></div>`
    : `<div class="msg-them"><div class="bubble chat"><div class="reply-h">シアニン</div><div class="pre">${esc(m.text)}</div></div><div class="meta"><time>${fmtTime(m.at)}</time>${m.lesson ? `<span class="pill gray">「${esc(m.lesson.title)}」への答え</span>` : ""}</div></div>`;
  // 添削の動きは、やり取りの枠では 1 行の知らせにして、押すと添削の枠へ移る
  const corrLine = (m) => `<div class="notice"><span class="pill gray">${m.from === "student" ? "添削を頼んだ" : "添削が返ってきた"}</span><button class="link" type="button" data-go="corr">添削の枠で見る</button><time>${fmtTime(m.at)}</time></div>`;

  const unreadOf = (msgs) => ({
    corr: msgs.filter((m) => m.kind !== "chat" && m.from === "cyanin" && !m.read_by_student).length,
    chat: msgs.filter((m) => m.kind === "chat" && m.from === "cyanin" && !m.read_by_student).length,
  });
  const drawPaneBadges = () => {
    document.querySelectorAll("#tab-room [data-pane-n]").forEach((b) => {
      const n = b.dataset.paneN === pane ? 0 : seen[b.dataset.paneN];
      b.textContent = n > 0 ? String(n) : "";
      b.classList.toggle("hidden", !(n > 0));
    });
  };

  const render = () => {
    const list = $("room-list");
    const { messages: msgs, notices } = last;
    document.querySelectorAll("#tab-room [data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === pane)));
    if (pane === "chat") {
      const items = [
        ...msgs.filter((m) => m.kind === "chat").map((m) => ({ id: m.id, html: chatHtml(m) })),
        ...msgs.filter((m) => m.kind !== "chat").map((m) => ({ id: m.id, html: corrLine(m) })),
        ...notices.map((n) => ({ id: n.id, html: noticeHtml(n) })),
      ].sort((a, b) => a.id - b.id);
      list.innerHTML = items.length ? items.map((x) => x.html).join("") : '<div class="empty note">まだやり取りはありません。質問や連絡は下の欄から送れます。</div>';
    } else {
      const corr = msgs.filter((m) => m.kind !== "chat");
      list.innerHTML = corr.length ? corr.map(corrHtml).join("") : '<div class="empty note">まだ添削はありません。下の欄から最初の文章を出してください。</div>';
    }
    wireNotes(list);
    list.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.go)));
    list.querySelectorAll("img[data-key]").forEach(async (img) => {
      try { img.src = await authImage("/api/room/image?key=" + encodeURIComponent(img.dataset.key), token); }
      catch (_) { img.alt = "画像を読めませんでした"; img.classList.add("broken"); }
    });
  };

  // 枠を替える。出す欄の案内とボタンも、その枠の出し方に替える
  const showPane = (p) => {
    pane = p === "chat" ? "chat" : "corr";
    seen[pane] = 0;
    try { localStorage.setItem("room_pane", pane); } catch (_) {}
    const chat = pane === "chat";
    $("c-text").placeholder = chat ? "シアニンへのメッセージ（質問・連絡など）" : "添削してほしい文章を貼ってください";
    $("c-send").textContent = chat ? "送る" : "出す";
    render();
    drawPaneBadges();
  };
  document.querySelectorAll("#tab-room [data-pane]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));

  const load = async (markRead) => {
    const r = await api("/api/room", { token });
    if (r.ok) roomCache = { r, at: Date.now() };
    if (!r.ok) { $("room-list").innerHTML = `<div class="msg err">読めませんでした。${esc(errText(r))}</div>`; return; }
    const notices = r.notices || [];
    const un = unreadOf(r.messages);
    seen.corr = Math.max(seen.corr, un.corr); seen.chat = Math.max(seen.chat, un.chat);
    // 初めて開くとき：新着がやり取りだけならやり取り、それ以外は前に見ていた枠（無ければ添削）
    if (!pane) pane = un.chat > 0 && un.corr === 0 ? "chat" : "corr";
    const sig = JSON.stringify([r.messages.map((m) => [m.id, m.replied, m.read_by_cyanin, m.read_by_student]), notices.map((n) => n.id)]);
    if (sig !== lastSig) {
      last = { messages: r.messages, notices };
      showPane(pane);
      if (opened && lastCount !== -1 && r.count > lastCount) $("room-list").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
      lastSig = sig; lastCount = r.count;
    }
    $("c-pick-label").classList.toggle("hidden", !r.images_enabled);
    drawPaneBadges();
    if (markRead && r.unread > 0) { await api("/api/room/read", { method: "POST", token }); setBadge(0); }
    else setBadge(markRead ? 0 : r.unread);
  };

  const status = (t) => { $("c-status").textContent = t; };
  const drawThumbs = () => {
    $("c-thumbs").innerHTML = pending.map((p, i) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" data-i="${i}" aria-label="外す">×</button></div>`).join("");
    $("c-thumbs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { pending.splice(Number(b.dataset.i), 1); drawThumbs(); }));
  };
  $("c-pick").addEventListener("change", async (e) => {
    for (const f of [...e.target.files].slice(0, 4 - pending.length)) {
      const blob = await shrinkImage(f);
      pending.push({ blob, url: URL.createObjectURL(blob) });
    }
    e.target.value = "";
    drawThumbs();
  });

  // 便 15b：出し方は今の枠で決まる（添削の枠＝添削を頼む、やり取りの枠＝メッセージ）
  const kindOf = () => pane === "chat" ? "chat" : "correction";

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("c-text").value.trim();
    if (!text && !pending.length) return status("文章か画像を入れてください");
    $("c-send").disabled = true;
    try {
      const keys = [];
      for (const [i, p] of pending.entries()) {
        status(`画像を送っています（${i + 1}/${pending.length}）`);
        const res = await fetch("/api/room/images", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": p.blob.type || "image/jpeg" }, body: p.blob });
        const d = await res.json().catch(() => ({}));
        if (!d.ok) throw new Error("画像を送れませんでした。" + errText(d));
        keys.push(d.key);
      }
      status("出しています…");
      const kind = kindOf();
      const r = await api("/api/room", { method: "POST", token, body: { text, images: keys, kind } });
      roomCache = null;
      if (!r.ok) throw new Error("出せませんでした。" + errText(r));
      $("c-text").value = ""; pending = []; drawThumbs();
      status(kind === "chat" ? "送りました。返事が来たらこの部屋とタブの数字でお知らせします" : "出しました。返ってきたらこの部屋とタブの数字でお知らせします");
      await load(true);
    } catch (err) {
      status(err.message);
    } finally {
      $("c-send").disabled = false;
    }
  });

  // 開いている間は 30 秒ごとに新着を見る（画面が隠れている間は見ない）
  const poll = () => { if (!document.hidden) load(opened && !$("tab-room").classList.contains("hidden")); };
  timer = setInterval(poll, 30000);
  document.addEventListener("visibilitychange", poll);

  return {
    setBadge,
    open: () => { opened = true; load(true); },
    setPane: (p) => { if (p === "chat" || p === "corr") { pane = p; seen[p] = 0; } },
  };
}

// ログインの直後に 1 画面だけ。既にアプリとして開いている・案内済みなら出さない
function maybeShowA2hs() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let shown = false;
  try { shown = localStorage.getItem("a2hs_shown") === "1"; } catch (_) {}
  if (standalone || shown) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $(ios ? "a2hs-ios" : deferredPrompt ? "a2hs-android" : "a2hs-other").classList.remove("hidden");
  $("a2hs").classList.remove("hidden");
  try { localStorage.setItem("a2hs_shown", "1"); } catch (_) {}
  $("a2hs-close").addEventListener("click", () => $("a2hs").classList.add("hidden"));
  $("a2hs-install").addEventListener("click", async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); }
    $("a2hs").classList.add("hidden");
  });
}

main().catch((e) => fail("読み込めませんでした：" + e.message));


// ---------- 目標（2026-10-30・2026-11-05 に目標達成くんへ）：目標はしあらぼ管理が正本（読むだけ）。日報・週報はここで書く ----------
const G_ERR = { empty: "数字か文のどちらかを入れてください", bad_number: "数字の欄に数でないものが入っています", body_too_long: "2000 字までです", day_out_of_range: "その日はもう直せません（7 日前まで）", bad_plan: "送った中身が読めませんでした。画面を読み直してください", plan_too_large: "書いた量が多すぎます。少し短くしてください", not_student: "この画面はしあらぼの生徒向けです", report_incomplete: "理由と来週の進め方を選んでください", week_out_of_range: "その週はまだ出せません", plan_not_saved: "先に設計を保存してください", no_draft: "下書きが見つかりませんでした。画面を読み直してください", draft_closed: "この下書きはもう使いました。画面を読み直してください", bad_report: "送った中身が読めませんでした。画面を読み直してください" };
const gErr = (r) => G_ERR[r && r.error] || errText(r);
let gData = null, gToken = null;
function gDraw() { drawPlan(); }
async function loadGoals(token) {
  gToken = token;
  const r = await api("/api/me/goals", { token });
  if (!r.ok) { $("gk-v-plan").innerHTML = `<p class="note" style="margin:0">読めませんでした。${esc(gErr(r))}</p>`; return; }
  if (gData && gPlanBusy()) r.plan = gData.plan; // 保存の途中なら、手元の設計を残す
  gData = r; gDraw();
}
// ---------- 目標達成くん（2026-11-05）：設計（①理想 ②条件 ③戦略）。直したら少し待ってまとめて保存する ----------
let gReady = false, gSaveTimer = null, gSaving = false, gAgain = false;
const gPlanBusy = () => !!gSaveTimer || gSaving;
const gNow = () => weekNo(gData.plan, gData.today);
function gToast(t) { const e = $("gk-toast"); e.textContent = t; e.classList.add("on"); clearTimeout(gToast.t); gToast.t = setTimeout(() => e.classList.remove("on"), 1800); }
let gDraftOpen = false, gDraftDone = ""; // 6 便目：下書きの中を開いているか・直前に押したもの（start / keep）
let gSel = null, gView = "plan", gWeek = null; // ④ で開いている状態の番号・いま見ている画面・記録と振り返りの週
const gWk = () => gWeek || Math.max(1, Math.min(WEEKS, gNow()));
const gRev = (n) => (gData.reviews || []).find((x) => x.week_no === n) || null;
function drawPlan() {
  if (!gData || !gData.plan) return;
  $("gk-chain").innerHTML = chainHtml(gData.plan, gData.today);
  $("gk-draft").innerHTML = draftHtml(gData.draft, gDraftOpen, gDraftDone);
  $("gk-v-plan").innerHTML = planHtml(gData.plan, gData.today);
  $("gk-v-tac").innerHTML = tacHtml(gData.plan, gData.today, gSel);
  $("gk-v-rec").innerHTML = recHtml(gData.plan, gData.today, gWk());
  $("gk-v-rev").innerHTML = reviewHtml(gData.plan, gData.today, gWk(), gRev(gWk()));
  $("gk-v-grow").innerHTML = growHtml(gData.plan, gData.today, gData.reviews);
}
function gShow(v) {
  gView = v;
  document.querySelectorAll("#tab-goals .gk-seg [data-gv]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.gv === v)));
  for (const x of ["plan", "tac", "rec", "rev", "grow"]) $("gk-v-" + x).classList.toggle("hidden", x !== v);
}
function openTac(i) { gSel = i; drawPlan(); gShow("tac"); $("s4").scrollIntoView({ behavior: "smooth", block: "start" }); }
function planChanged(msg) { drawPlan(); paintGoalCard(); gSavedLine("保存を待っています…"); clearTimeout(gSaveTimer); gSaveTimer = setTimeout(gSavePlan, 700); if (msg) gToast(msg); }
function gSavedLine(t, err) { const e = $("gk-saved"); e.textContent = t; e.classList.toggle("err", !!err); }
async function gSavePlan() {
  gSaveTimer = null;
  if (gSaving) { gAgain = true; return; }
  gSaving = true;
  const { saved_at: _drop, ...plan } = gData.plan;
  const r = await api("/api/me/goals/plan", { method: "PUT", token: gToken, body: { plan } });
  gSaving = false;
  if (!r.ok) { gSavedLine("保存できませんでした。" + gErr(r) + "（もう一度直すと、保存し直します）", true); }
  else { gData.plan.saved_at = r.plan.saved_at; gSavedLine(`保存しました（${new Date(r.plan.saved_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}）`); }
  if (gAgain) { gAgain = false; gSavePlan(); }
}
function showPop(c) {
  const pop = $("gk-pop"); if (!pop) return;
  pop.innerHTML = popHtml(gData.plan, +c.dataset.wk, gNow()); pop.hidden = false;
  const r = c.getBoundingClientRect(), pr = pop.offsetParent.getBoundingClientRect();
  pop.style.left = Math.max(0, Math.min(r.left - pr.left + r.width / 2 - pop.offsetWidth / 2, pr.width - pop.offsetWidth)) + "px";
  pop.style.top = (r.bottom - pr.top + 8) + "px";
}
// 6 便目：シアニンと決めた下書き。start＝この設計で始める・keep＝今のままにする・undo＝元に戻す・open＝中を見る
async function gDraft(action, btn) {
  if (action === "open") { gDraftOpen = !gDraftOpen; drawPlan(); const b = document.querySelector('#gk-draft [data-draft="open"]'); if (b) b.focus(); return; }
  btn.disabled = true;
  const pending = !!gSaveTimer; clearTimeout(gSaveTimer); gSaveTimer = null;
  if (pending) await gSavePlan(); // 保存を待っている書きかけを先に出し切る（元に戻すとき、その時点の設計に戻るように）
  const r = await api("/api/me/goals/draft", { method: "POST", token: gToken, body: { action } });
  if (!r.ok) { btn.disabled = false; gToast("できませんでした。" + gErr(r)); return; }
  if (action === "start") { gData.plan = r.plan; gDraftDone = "start"; gToast("下書きで ①〜③ を入れて保存しました"); }
  else if (action === "keep") { gDraftDone = "keep"; gToast("下書きはしまいました"); }
  else { gData.plan = r.plan; gData.draft = r.draft; gDraftDone = ""; gToast("元に戻しました"); }
  gSel = null; gWeek = null; drawPlan(); paintGoalCard(); gShow("plan");
  const next = document.querySelector("#gk-draft button"); if (next) next.focus();
}
// 週報を出す：手元の設計を先に保存してから、その週の控えを送る
async function gSubmit(btn) {
  const n = gWk();
  btn.disabled = true;
  clearTimeout(gSaveTimer); gSaveTimer = null;
  await gSavePlan();
  if (!gData.plan.saved_at) { btn.disabled = false; return; }
  const r = await api("/api/me/goals/review", { method: "POST", token: gToken, body: { week_no: n, report: reportFor(gData.plan, n) } });
  if (!r.ok) { btn.disabled = false; gToast("出せませんでした。" + gErr(r)); return; }
  gData.reviews = [r.review, ...(gData.reviews || []).filter((x) => x.week_no !== n)];
  if (carryTry(gData.plan, n)) planChanged("週報を出しました。来週変えることを ④ に入れました");
  else { drawPlan(); gToast("週報を出しました。シアニンが読みます"); }
}
const hoverOK = () => window.matchMedia("(hover: hover)").matches;
function wirePlan() {
  const root = $("tab-goals");
  root.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!(t.dataset && t.dataset.ed && gData && setPath(gData.plan, t.dataset.ed, t.textContent))) return;
    const next = e.relatedTarget && e.relatedTarget.dataset && e.relatedTarget.dataset.ed; // 次に押した欄へ、描き直したあとも戻る
    planChanged(t.dataset.ed.startsWith("kgi") && !gData.plan.goal13Own ? "13 週の目標も直りました" : "");
    if (next) { const el = root.querySelector(`[data-ed="${next}"]`); if (el) el.focus(); }
  });
  root.addEventListener("keydown", (e) => { const t = e.target; if (t.dataset && t.dataset.ed && e.key === "Enter" && !e.isComposing) { e.preventDefault(); t.blur(); } });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!gData) return;
    if (t.dataset && t.dataset.sel != null) { gSel = +t.value; drawPlan(); return; }
    if (t.dataset && t.dataset.wsel != null) { gWeek = +t.value; drawPlan(); return; }
    if (t.name === "gk-nx") { if (applyNext(gData.plan, gWk(), t.value)) planChanged(t.value === "cont" ? `第 ${gWk() + 1} 週も同じ状態を続けます。③ に反映しました` : "来週は次の状態へ進みます"); return; }
    if (applyWeek(gData.plan, gWk(), t)) { planChanged(""); return; }
    if (applyField(gData.plan, t)) { planChanged(""); return; }
    if (t.dataset && t.dataset.start != null && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { const d = new Date(t.value + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); gData.plan.start = d.toISOString().slice(0, 10); planChanged("始めた週を直しました"); }
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button, a[data-to]"); if (!t || !gData) return;
    const d = t.dataset;
    if (d.gv) { gShow(d.gv); return; }
    if (d.draft) { gDraft(d.draft, t); return; }
    if (d.to) { e.preventDefault(); if (d.to === "s4") { openTac(gSel); return; } gShow({ s5: "rec", s6: "rec", s7: "rev", s8: "rev" }[d.to] || "plan"); $(d.to).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (d.kv || d.rs) { if (applyWeek(gData.plan, gWk(), t)) planChanged(""); return; }
    if (d.copy != null) { const txt = reportFor(gData.plan, gWk()).text; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => gToast("コピーしました。LINE にそのまま貼れます"), () => gToast("コピーできませんでした")); return; }
    if (d.submit != null) { gSubmit(t); return; }
    if (d.wk) { // マウスなら押すとその状態の戦術へ。指なら 1 回目は中身、2 回目で戦術へ
      if (!hoverOK() && !t.classList.contains("pinned")) { root.querySelectorAll(".gk-road .pinned").forEach((x) => x.classList.remove("pinned")); t.classList.add("pinned"); showPop(t); return; }
      const f = weekInfo(gData.plan, +d.wk, gNow()); if (f.i != null) openTac(f.i); return;
    }
    if (d.ms != null) { openTac(+d.ms); return; }
    if (d.back != null) { gShow("plan"); const o = root.querySelector(".gk-overview"); if (o) o.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (applyAction(gData.plan, d, gNow())) {
      const msg = d.add === "ms" ? "状態を足しました。空いている週に並びます" : d.del ? "消しました" : d.spare ? (gData.plan.spare.includes(+d.spare) ? `第 ${d.spare} 週を予備にしました` : `第 ${d.spare} 週に状態を戻しました`) : d.bmv != null ? "時間の置き場所を移しました" : "";
      planChanged(msg);
      if (d.add) { const sel = { kgi: "kgi", ms: "ms", bud: "bud" }[d.add]; const els = root.querySelectorAll(`[data-ed^="${sel}.${gData.plan[sel].length - 1}."]`); if (els[0]) els[0].focus(); }
      if (d.addk != null) { const el = root.querySelector(`[data-kf="${d.addk}.${gData.plan.ms[d.addk].kpi.length - 1}.n"]`); if (el) el.focus(); }
      if (d.addt != null) { const el = root.querySelector(`[data-ed="ms.${d.addt}.tasks.${gData.plan.ms[d.addt].tasks.length - 1}.t"]`); if (el) el.focus(); }
    }
  });
  root.addEventListener("mouseover", (e) => { const c = e.target.closest && e.target.closest(".gk-road .c.big"); if (c && hoverOK()) showPop(c); });
  root.addEventListener("mouseout", (e) => {
    const c = e.target.closest && e.target.closest(".gk-road .c.big, #gk-pop"); if (!c || !hoverOK()) return;
    const to = e.relatedTarget; if (to && to.closest && to.closest("#gk-pop, .gk-road .c.big")) return;
    const p = $("gk-pop"); if (p) p.hidden = true;
  });
}
// ホームの「今週の目標の進み」カード（目標達成くんを使う生徒だけ）
async function paintGoalCard() {
  if (!gReady) return;
  const home = $("tab-home") && $("tab-home").querySelector(".home"); if (!home) return;
  if (!gData) { const r = await api("/api/me/goals", { token: gToken }); if (!r.ok || gData) { if (gData) paintGoalCard(); return; } gData = r; }
  const old = home.querySelector("a.gk"); if (old) old.remove();
  home.insertAdjacentHTML("afterbegin", homeCardHtml(gData.plan, gData.today));
}
let gWired = false;
function wireGoals(token) {
  gToken = token;
  if (gWired) return; gWired = true;
  wirePlan();
}

// ---------- 生徒の画面の枠（2026-11-04）：アプリの一覧・お知らせのベル ----------
// アプリ：使えるもの（権利で開けるもの）と、シアラボ会員で使えるもの（開けないものは案内として枠だけ）
const APP_DESC = {
  "x-koryaku": "X の投稿を分析して、次の一手を決める", "note-koryaku": "note の記事の伸びを見て、計画を立てる",
  "content-os": "ネタをためて、投稿の予定を組む", "swipe-file": "参考にしたいポストを集めて分ける", mindmap: "マップと箇条書きで考えを広げる",
};
function renderApps(r) {
  const box = $("tab-apps");
  const list = Array.isArray(r.app_catalog) ? r.app_catalog : [];
  const icon = (url) => { try { return `<img class="ap-ic" alt="" src="https://${new URL(url).host}/favicon.svg" onerror="this.style.visibility='hidden'">`; } catch { return ""; } };
  const tile = (a) => a.open
    ? `<a class="ap" href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.url)}<span class="an"><b>${esc(a.name)}</b><small>${esc(APP_DESC[a.target] || "")}</small></span><span class="ao">別タブで開く ↗</span></a>`
    : `<div class="ap off">${icon(a.url)}<span class="an"><b>${esc(a.name)}</b><small>${esc(APP_DESC[a.target] || "")}</small><em>シアラボ会員で使えます</em></span></div>`;
  const mine = list.filter((a) => a.open), rest = list.filter((a) => !a.open);
  box.innerHTML = `<h1 class="lt">アプリ</h1>`
    + (mine.length ? `<section><h2 class="ah">使えるアプリ<span class="cnt">${mine.length}</span></h2><div class="apg">${mine.map(tile).join("")}</div></section>` : `<p class="note">いま使えるアプリはありません。</p>`)
    + (rest.length ? `<section><h2 class="ah">シアラボ会員で使えるアプリ</h2><div class="apg">${rest.map(tile).join("")}</div></section>` : "");
}
const NEWS_SEEN = "lab:news-seen";
function paintNewsDot(r) {
  const top = (r.announcements || [])[0];
  let seen = ""; try { seen = localStorage.getItem(NEWS_SEEN) || ""; } catch { /* 覚えられないブラウザでは点を出さない */ return; }
  const on = !!top && String(top.published_at || "") > seen;
  $("news-dot").classList.toggle("hidden", !on);
  $("news-btn").setAttribute("aria-label", on ? "お知らせ（新しいお知らせがあります）" : "お知らせ");
}
function markNewsSeen(r) {
  const top = (r.announcements || [])[0];
  if (top) { try { localStorage.setItem(NEWS_SEEN, String(top.published_at || "")); } catch { /* 覚えられなくても見られる */ } }
  paintNewsDot(r);
}

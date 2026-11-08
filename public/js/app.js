import { getClient, api, esc, fmtTime, authImage, shrinkImage, noticeHtml } from "/js/common.js";
import { correctionHtml, wireNotes } from "/js/correction.js";
import { setupStudentPush } from "/js/pushclient.js";
import { setupGroups } from "/js/studentgroups.js";
import { flatten, homeHtml, libraryHtml, searchHtml } from "/js/home.js";
import { makeWatch } from "/js/watch.js";
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
  window.__labMe = r.me; // 予約の入力画面で「予約者」を出す
  $("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace("/"); });
  // 便 2（関門 5）：共通の外枠（？・アプリ一覧・アカウント）。読めなかったときは今までの名前とログアウトのまま
  {
    try {
      const { mountStudentShell } = await import("/js/student-shell.js");
      mountStudentShell($("shell-slot"), { me: r, sb, session, onContract: () => { location.hash = "#contract"; } });
      $("shell-slot").classList.remove("hidden");
      try { const { initStudentGuide } = await import("/js/student-guide.js"); initStudentGuide(r.access === "contract" ? "contract" : "home", r.access === "contract" ? "ご契約" : "ホーム"); } catch (e) { console.warn("guide", e); }
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
        window.__labGuide && window.__labGuide(name, $("crumb").textContent);
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
      <div style="flex:1;min-width:0"><h3>${esc(l.title)}</h3><div class="meta">${l.youtube_id || l.rec ? "動画" : "文章"}${l.mindmap_url ? "・マインドマップ" : ""}${l.minutes ? "・" + l.minutes + " 分" : ""}${pill(l.id)}</div></div>
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
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn ghost small" id="rf-copy" type="button">リンクをコピー</button><span class="note">紹介で登録 ${rf.referred} 人${rf.reward_total ? "・報酬 " + Number(rf.reward_total).toLocaleString() + " 円（払い済み " + Number(rf.paid_total).toLocaleString() + " 円）" : ""}</span></div></div>`);
    $("rf-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(rf.link); $("rf-copy").textContent = "コピーしました"; } catch (_) { $("rf-copy").textContent = "コピーできませんでした"; } });
  }

  // 個別相談の予約（2026-11-05）：予約できる種類が 1 つでもあれば、左のメニューとホームの 1 行に出す
  const bookingReady = r.booking_ready === true;
  const sections = ["home", "mypage", "goals", "lessons", "lesson", "news", "room", "review", "booking", "contract", "apps"];
  let watch = null;
  const showTab = (name) => {
    if (name !== "lesson" && watch) watch.leave();
    document.body.classList.toggle("watching", name === "lesson"); // 便 B2：教材を見ている間は、画面いっぱいに使う
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
      if (on) { $("crumb").textContent = b.dataset.label || b.textContent.trim(); window.__labGuide && window.__labGuide(name, $("crumb").textContent); }
      // 5b：スマホの上の帯では、今いるタブを見える位置へ送る
      if (on && window.matchMedia("(max-width: 860px)").matches) b.scrollIntoView({ block: "nearest", inline: "center" });
    });
  };
  document.querySelectorAll(".side [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
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

  // 教材を見る画面（便 B2・2026-11-06）：public/js/watch.js。印（お気に入り・視聴済み・ラベル）は本人だけ
  const watchFlat = flat.length ? flat : Object.values(lessons).map((x, i) => ({ ...x, program: "教材", programId: "all", course: "教材", courseId: "all", order: [0, 0, i] }));
  watch = makeWatch({
    root: $("tab-lesson"), token, flat: watchFlat, lessons, marks: r.marks || {}, apps: r.app_catalog || [],
    onBack: () => { history.pushState(null, "", "#lessons"); showTab("lessons"); },
    onViewed: async (id) => {
      const res = await api("/api/events", { method: "POST", token, body: { type: "lesson_viewed", lesson_id: id } });
      // 記録できたら一覧の印をその場で付ける（読み直さなくても見える）
      if (res.ok && !viewed.has(id)) {
        viewed.add(id);
        document.querySelectorAll(`.lesson[data-id="${CSS.escape(id)}"] .meta`).forEach((meta) => meta.insertAdjacentHTML("beforeend", ' <span class="pill">視聴済み</span>'));
      }
    },
  });
  const openLesson = (id, start) => {
    if (!lessons[id]) return;
    showTab("lesson");
    window.scrollTo(0, 0);
    watch.open(id, start);
  };
  document.querySelectorAll(".lesson").forEach((el) => {
    el.addEventListener("click", () => openLesson(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openLesson(el.dataset.id); });
  });

  setupMember(r.entitlement, r.me.email);
  const room = setupRoom(token, r.community_url, r.community);
  room.setBadge(r.room_unread);
  // 便 15b：#room/chat・#room/corr は、部屋のその枠を開く
  if (location.hash.startsWith("#room")) { room.setPane(location.hash.split("/")[1], location.hash.split("/")[2]); showTab("room"); }
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
    // #lesson/<番号>/t<秒>：会員用リンク（その時間から）
    const m = location.hash.match(/^#lesson[/]([^/]+)(?:[/]t(\d{1,6}))?$/); if (m) { openLesson(decodeURIComponent(m[1]), m[2] != null ? Number(m[2]) : undefined); return true; }
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
    const [h, pane, gid] = location.hash.slice(1).split("/");
    if (h === "room") room.setPane(pane, gid);
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
const BK_WHY = { bad_answer: "選択肢から選んでください", bad_number: "数字で入力してください", slot_taken: "その時間はちょうど埋まりました。ほかの時間を選択してください", already_booked: "このメニューは、すでに予約があります", bad_slot: "その時間は選択できません", answer_required: "入力されていない項目があります", not_found: "この予約はいま受け付けていません", too_late: "変更・キャンセルの期限を過ぎています。ご連絡ください", bad_minutes: "その所要時間は選択できません" };
const BK_WD = ["日", "月", "火", "水", "木", "金", "土"];
// 状態：bk.data＝サーバーの答え・bk.menu＝選んでいるメニュー・bk.day＝選んだ日（YYYY-MM-DD・日本時間）・bk.slot＝選んだ枠・bk.ym＝表示中の月・bk.moving＝日時を変更している予約・bk.draft＝書きかけ
const bk = { token: null, data: null, menu: null, day: null, slot: null, ym: null, moving: null, draft: {}, step: "pick", len: null };
// 所要時間を選べるメニューは、選んだ長さの空き時間を使う
const bkLen = (t) => (t.options && t.options.some((o) => o.minutes === bk.len) ? bk.len : t.minutes);
const bkSlots = (t) => (t.options ? (t.options.find((o) => o.minutes === bkLen(t)) || t.options[0]).slots : t.slots);
const jstKey = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const bkDayLabel = (key) => { const [y, m, d] = key.split("-").map(Number); return `${m}月${d}日（${BK_WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`; };
const bkTime = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16);
const bkSpan = (s) => `${bkTime(s.slot)}〜${s.end}`;
let bkToastTimer = null;
function bkToast(text, undo) {
  $("bk-toast-t").textContent = text; $("bk-toast-u").classList.toggle("hidden", !undo);
  $("bk-toast-u").onclick = async () => { $("bk-toast").classList.add("hidden"); if (undo) await undo(); };
  $("bk-toast").classList.remove("hidden"); clearTimeout(bkToastTimer); bkToastTimer = setTimeout(() => $("bk-toast").classList.add("hidden"), 8000);
}
async function loadBooking(token) {
  bk.token = token;
  const r = await api("/api/booking", { token });
  if (!r.ok) { $("bk-main").innerHTML = `<p class="note">読み込めませんでした。${esc(errText(r))}</p>`; return; }
  bk.data = r;
  drawMine();
  if (!r.ready) { $("bk-menus").innerHTML = ""; $("bk-main").innerHTML = `<div class="card"><p class="note" style="margin:0">${esc(r.note || "いま予約できる個別相談はありません")}</p></div>`; return; }
  if (!bk.menu || !r.types.some((t) => t.slug === bk.menu)) bk.menu = (r.types.find((t) => !t.booked) || r.types[0]).slug;
  drawMenus(); startPick();
}
function bkMenu() { return bk.data.types.find((t) => t.slug === bk.menu); }
function drawMine() {
  $("bk-mine").innerHTML = (bk.data.mine || []).map((b) => { const k = jstKey(b.slot), [, m, d] = k.split("-").map(Number);
    return `<div class="bk-mine"><div class="dt" aria-hidden="true"><small>${m}月</small><b>${d}</b></div><div class="tx"><b>${esc(bkDayLabel(k))} ${esc(bkTime(b.slot))}〜${esc(b.end)}</b><span>${esc(b.title)}・予約済み</span></div>
      ${b.locked ? `<span class="lock">変更・キャンセルは開始の ${esc(b.cancel_hours)} 時間前まで。変更はご連絡ください</span>` : `${b.slug ? `<button class="lnk" type="button" data-move="${esc(b.slot)}" aria-label="${esc(bkDayLabel(k) + " の予約の日時を変更")}">日時を変更</button>` : ""}<button class="lnk" type="button" data-cancel="${esc(b.slot)}" aria-label="${esc(bkDayLabel(k) + " の予約をキャンセル")}">キャンセル</button>`}</div>`; }).join("");
  $("bk-mine").querySelectorAll("[data-move]").forEach((x) => x.addEventListener("click", () => {
    const b = bk.data.mine.find((y) => y.slot === x.dataset.move); bk.moving = b; bk.menu = b.slug; bk.len = b.minutes;
    bk.draft = Object.fromEntries((b.answers || []).map((a) => [a.key, a.values || a.value]));
    drawMenus(); startPick(); bkToast("新しい日時を選ぶと、現在の予約と入れ替わります");
    $("bk-main").scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  $("bk-mine").querySelectorAll("[data-cancel]").forEach((x) => x.addEventListener("click", async () => {
    x.disabled = true;
    const res = await api("/api/booking/cancel", { method: "POST", token: bk.token, body: { slot: x.dataset.cancel } });
    if (!res.ok) { x.disabled = false; bkToast("キャンセルできませんでした。" + errText(res)); return; }
    await loadBooking(bk.token);
    bkToast("予約をキャンセルしました", async () => {
      const again = await api("/api/booking", { method: "POST", token: bk.token, body: { slug: res.slug, slot: res.slot, minutes: res.minutes, answers: res.answers } });
      await loadBooking(bk.token);
      bkToast(again.ok ? "予約を元に戻しました" : "元に戻せませんでした（その時間は埋まりました）");
    });
  }));
}
function drawMenus() {
  const ts = bk.data.types;
  $("bk-menus").innerHTML = ts.length > 1 ? `<div class="bk-menus" role="group" aria-label="メニュー">${ts.map((t) => `<button type="button" aria-pressed="${t.slug === bk.menu}" data-menu="${esc(t.slug)}"><span class="cdot" style="background:${esc(t.color || "var(--accent)")}"></span>${esc(t.title)}</button>`).join("")}</div>` : "";
  $("bk-menus").querySelectorAll("[data-menu]").forEach((x) => x.addEventListener("click", () => { bk.menu = x.dataset.menu; bk.moving = null; bk.len = null; drawMenus(); startPick(); }));
}
function startPick() {
  const t = bkMenu(); bk.step = "pick"; bk.slot = null; bk.len = bkLen(t);
  const slots = bkSlots(t), days = [...new Set(slots.map((s) => jstKey(s.slot)))];
  bk.day = days[0] || null;
  bk.ym = (bk.day || jstKey(new Date().toISOString())).slice(0, 7);
  if (t.booked && !bk.moving) {
    const lockedAll = (bk.data.mine || []).filter((b) => b.slug === t.slug).every((b) => b.locked);
    $("bk-main").innerHTML = `<div class="card"><p style="margin:0"><b>${esc(t.title)}</b> は予約済みです。${lockedAll ? "変更の期限を過ぎているため、日時を変えるときはご連絡ください。" : "日時を変えるときは、上の「日時を変更」から選んでください。"}</p></div>`; bkBar(); return;
  }
  $("bk-main").innerHTML = `<div class="booker" id="booker">
    <aside class="info"><div class="host"><div class="av" aria-hidden="true">シ</div><div><b>シアニン</b><br><span>シアラボ</span></div></div>
      <h2>${esc(t.title)}</h2>
      <ul class="meta"><li><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${t.options ? `<span class="lens" role="group" aria-label="所要時間">${t.options.map((o) => `<button type="button" data-len="${o.minutes}" aria-pressed="${o.minutes === bk.len}">${o.minutes} 分</button>`).join("")}</span>` : esc(t.minutes) + " 分"}</li>
        ${t.zoom ? '<li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>Zoom（URL は予約後にメールで届きます）</li>' : ""}
        <li class="picked hidden" id="bk-picked"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg><span id="bk-picked-t"></span></li>
        ${bk.moving ? `<li class="moving">変更前：${esc(bkDayLabel(jstKey(bk.moving.slot)))} ${esc(bkTime(bk.moving.slot))}〜${esc(bk.moving.end)}</li>` : ""}</ul>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ""}${t.paused ? '<p class="desc"><span class="pill gray">停止中（管理者だけに表示）</span></p>' : ""}</aside>
    <div class="calbox" id="bk-calbox"><div class="cal-h"><b id="bk-ym" aria-live="polite"></b><button class="nav" type="button" id="bk-prev" aria-label="前の月">‹</button><button class="nav" type="button" id="bk-next" aria-label="次の月">›</button></div>
      <div class="cal" id="bk-cal"></div><div class="tz">タイムゾーン：日本時間（GMT+9）</div></div>
    <div class="times" id="bk-times"><h3 id="bk-t-h"></h3><div class="tlist" id="bk-tlist"></div>
      <div class="pick wait" id="bk-pick"><div class="pk-t" id="bk-pk-t">時間を選択すると次へ進めます</div><button class="btn" type="button" id="bk-pk-go">次へ</button></div></div>
    <form class="formbox hidden" id="bk-form" novalidate></form>
  </div>`;
  $("bk-main").querySelectorAll("[data-len]").forEach((x) => x.addEventListener("click", () => { bk.len = Number(x.dataset.len); const keep = bk.day; startPick(); if (keep && bkSlots(t).some((s) => jstKey(s.slot) === keep)) { bk.day = keep; bk.ym = keep.slice(0, 7); drawCal(); drawTimes(); } const f = $("bk-main").querySelector(`[data-len="${bk.len}"]`); if (f) f.focus(); }));
  if (!slots.length) { $("bk-cal").innerHTML = ""; $("bk-tlist").innerHTML = '<p class="note">いま予約できる空き時間がありません。少し時間をおいてもう一度ご覧ください。</p>'; }
  $("bk-prev").onclick = () => { bk.ym = bkShift(bk.ym, -1); drawCal(); };
  $("bk-next").onclick = () => { bk.ym = bkShift(bk.ym, 1); drawCal(); };
  $("bk-pk-go").onclick = () => { if (!bk.slot) { $("bk-pk-t").innerHTML = '<b class="err-t">時間を選択してください</b>'; const f = $("bk-tlist").querySelector(".t"); if (f) f.focus(); return; } bkForm(); };
  $("bk-bar-go").onclick = () => bkForm();
  drawCal(); drawTimes();
}
const bkShift = (ym, n) => { const [y, m] = ym.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
function drawCal() {
  const t = bkMenu(), [y, m] = bk.ym.split("-").map(Number);
  const open = new Map(); for (const s of bkSlots(t)) { const k = jstKey(s.slot); open.set(k, (open.get(k) || 0) + 1); }
  const months = [...new Set([...open.keys()].map((k) => k.slice(0, 7)))].sort();
  $("bk-ym").textContent = `${y}年${m}月`;
  $("bk-prev").disabled = !months.length || bk.ym <= months[0];
  $("bk-next").disabled = !months.length || bk.ym >= months[months.length - 1];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = jstKey(new Date().toISOString());
  let h = BK_WD.map((w) => `<div class="wd">${w}</div>`).join("") + "<div></div>".repeat(first);
  for (let d = 1; d <= n; d++) {
    const k = `${bk.ym}-${String(d).padStart(2, "0")}`, c = open.get(k) || 0, cls = (k === today ? " today" : "");
    h += c ? `<button type="button" class="d open${cls}" data-day="${k}" aria-pressed="${k === bk.day}" aria-label="${bkDayLabel(k)}・空き ${c} 枠">${d}</button>` : `<div class="d${cls}" aria-hidden="true">${d}</div>`;
  }
  $("bk-cal").innerHTML = h;
  $("bk-cal").querySelectorAll("[data-day]").forEach((x) => x.addEventListener("click", () => { bk.day = x.dataset.day; bk.slot = null; drawCal(); drawTimes(); if (matchMedia("(max-width: 860px)").matches) $("bk-times").scrollIntoView({ block: "start", behavior: "smooth" }); }));
}
function drawTimes() {
  const t = bkMenu();
  if (!bk.day) { $("bk-t-h").textContent = ""; return; }
  $("bk-t-h").textContent = bkDayLabel(bk.day);
  const list = bkSlots(t).filter((s) => jstKey(s.slot) === bk.day);
  $("bk-tlist").innerHTML = list.map((s) => `<button type="button" class="t" data-slot="${esc(s.slot)}" aria-pressed="${bk.slot === s.slot}" aria-label="${esc(bkSpan(s))}">${esc(bkTime(s.slot))}<small> – ${esc(s.end)}</small></button>`).join("");
  $("bk-tlist").querySelectorAll("[data-slot]").forEach((x) => x.addEventListener("click", () => { bk.slot = x.dataset.slot; drawTimes(); const f = $("bk-tlist").querySelector(`[data-slot="${CSS.escape(bk.slot)}"]`); if (f) f.focus(); }));
  const sel = list.find((s) => s.slot === bk.slot);
  $("bk-pick").classList.toggle("wait", !sel);
  $("bk-pk-t").innerHTML = sel ? `選択中の日時<b>${esc(bkDayLabel(bk.day))} ${esc(bkSpan(sel))}</b>` : "時間を選択すると次へ進めます";
  bkBar();
}
function bkBar() {
  const t = bk.data && bk.menu && bkMenu(), sel = t && bkSlots(t).find((s) => s.slot === bk.slot);
  const show = !!sel && bk.step === "pick" && matchMedia("(max-width: 860px)").matches && !$("tab-booking").classList.contains("hidden");
  $("bk-bar").classList.toggle("hidden", !show);
  if (show) $("bk-bar-t").innerHTML = `<b>${esc(bkDayLabel(bk.day))} ${esc(bkSpan(sel))}</b>${esc(bkLen(t))} 分`;
}
addEventListener("resize", () => { if (bk.data) bkBar(); });
function bkQ(q) {
  const v = bk.draft[q.key] ?? (q.kind === "check" ? [] : q.hint ?? ""), id = "bkq-" + q.key, req = q.required ? ' aria-required="true"' : "";
  const head = `<div class="f" data-key="${esc(q.key)}" data-kind="${esc(q.kind)}">`;
  if (q.kind === "radio" || q.kind === "check") {
    const on = new Set(Array.isArray(v) ? v : [v]);
    return `${head}<fieldset class="opts"><legend>${esc(q.label)}<span class="req">${q.required ? "必須" : "任意"}</span></legend>${(q.options || []).map((o, j) => `<label class="opt"><input type="${q.kind === "radio" ? "radio" : "checkbox"}" name="${id}" data-q="${esc(q.key)}" value="${esc(o)}"${on.has(o) ? " checked" : ""}${j === 0 ? req : ""}><span>${esc(o)}</span></label>`).join("")}</fieldset><div class="f-msg hidden"></div></div>`;
  }
  return `${head}<label for="${id}">${esc(q.label)}<span class="req">${q.required ? "必須" : "任意"}</span></label>${q.kind === "text" || q.kind === "number"
    ? `<input type="text" id="${id}" data-q="${esc(q.key)}" maxlength="200" value="${esc(v)}"${q.kind === "number" ? ' inputmode="decimal" autocomplete="off" placeholder="数字で入力（例 120000）"' : ""}${req}>`
    : `<textarea id="${id}" data-q="${esc(q.key)}" rows="${Math.max(3, Math.min(8, String(v).split("\n").length + 1))}" maxlength="4000"${req}>${esc(v)}</textarea>`}<div class="f-msg hidden"></div></div>`;
}
// 質問ごとの答え（複数選択は配列）
function bkAnswer(key) {
  const f = $("bk-form").querySelector(`.f[data-key="${CSS.escape(key)}"]`); if (!f) return "";
  const k = f.dataset.kind;
  if (k === "check") return [...f.querySelectorAll("input:checked")].map((x) => x.value);
  if (k === "radio") { const c = f.querySelector("input:checked"); return c ? c.value : ""; }
  return f.querySelector("input,textarea").value;
}
function bkForm() {
  const t = bkMenu(), sel = bkSlots(t).find((s) => s.slot === bk.slot); if (!sel) return;
  bk.step = "form";
  $("booker").classList.add("form-mode"); $("bk-calbox").classList.add("hidden"); $("bk-times").classList.add("hidden");
  $("bk-picked").classList.remove("hidden"); $("bk-picked-t").textContent = `${bkDayLabel(bk.day)} ${bkSpan(sel)}`;
  const me = (window.__labMe || {});
  $("bk-form").innerHTML = `<button class="back" type="button" id="bk-back">‹ 戻る</button><h3>予約内容の入力</h3>
    <div class="who">予約者：<b>${esc(me.name || "")}</b>${me.email ? `（${esc(me.email)}）` : ""}・ログイン中のアカウントで予約します</div>
    ${(t.questions || []).map(bkQ).join("") || bkQ({ key: "topic", label: "相談したいこと", kind: "textarea", required: false, hint: "" })}
    <div class="saved" id="bk-saved">入力内容は自動で下書き保存されます</div>
    <div class="err-t" id="bk-err" aria-live="polite"></div>
    <div class="cta"><button class="btn" type="submit">${bk.moving ? "この日時に変更" : "予約を確定"}</button></div>`;
  $("bk-form").classList.remove("hidden"); bkBar();
  const firstField = $("bk-form").querySelector("input,textarea"); if (firstField) firstField.focus();
  $("booker").scrollIntoView({ block: "start", behavior: "smooth" });
  $("bk-back").onclick = () => { bk.step = "pick"; $("booker").classList.remove("form-mode"); $("bk-calbox").classList.remove("hidden"); $("bk-times").classList.remove("hidden"); $("bk-form").classList.add("hidden"); $("bk-picked").classList.add("hidden"); drawTimes(); const f = $("bk-tlist").querySelector('[aria-pressed="true"]'); if (f) f.focus(); };
  $("bk-form").oninput = (e) => { const k = e.target.dataset.q; if (!k) return; bk.draft[k] = bkAnswer(k); const f = e.target.closest(".f"); f.classList.remove("bad"); f.querySelector(".f-msg").classList.add("hidden"); $("bk-saved").textContent = "下書き保存しました"; };
  $("bk-form").onsubmit = async (e) => {
    e.preventDefault();
    let first = null;
    for (const q of t.questions || []) {
      const f = $("bk-form").querySelector(`.f[data-key="${CSS.escape(q.key)}"]`), el = f.querySelector("input,textarea"), v = bkAnswer(q.key);
      const empty = Array.isArray(v) ? !v.length : !String(v).trim();
      const msg = q.required && empty ? (q.kind === "radio" || q.kind === "check" ? "選択してください" : "入力してください")
        : q.kind === "number" && !empty && !/^-?[\d０-９,，.．]+$/.test(String(v).trim()) ? "数字で入力してください" : "";
      f.classList.toggle("bad", !!msg); const m = f.querySelector(".f-msg"); m.classList.toggle("hidden", !msg); m.textContent = msg; if (msg && !first) first = el;
    }
    if (first) { first.focus(); return; }
    const answers = (t.questions || []).length ? Object.fromEntries(t.questions.map((q) => [q.key, bkAnswer(q.key)])) : { topic: bkAnswer("topic") };
    const go = $("bk-form").querySelector("[type=submit]"); go.disabled = true; $("bk-err").textContent = "予約しています…";
    const res = await api("/api/booking", { method: "POST", token: bk.token, body: { slug: t.slug, slot: bk.slot, minutes: bkLen(t), answers, ...(bk.moving ? { from: bk.moving.slot } : {}) } });
    go.disabled = false;
    if (!res.ok) {
      $("bk-err").textContent = (res.error === "answer_required" ? `「${res.label}」を入力してください` : res.label && BK_WHY[res.error] ? `「${res.label}」：${BK_WHY[res.error]}` : BK_WHY[res.error]) || "予約できませんでした。" + errText(res);
      if (res.error === "slot_taken") { const keep = bk.draft; await loadBooking(bk.token); bk.draft = keep; }
      return;
    }
    const moved = !!bk.moving;
    bk.moving = null; bk.len = null; bk.draft = {}; bk.step = "done";
    $("bk-main").innerHTML = `<div class="bk-done" id="bk-done" tabindex="-1"><div class="ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h2>${moved ? "日時を変更しました" : "予約が完了しました"}</h2><p>確認メールを送信しました。前日にリマインドをお送りします。</p>
      <dl class="sum"><dt>日時</dt><dd>${esc(bkDayLabel(jstKey(res.slot)))} ${esc(bkTime(res.slot))}〜${esc(res.end)}（日本時間）</dd><dt>メニュー</dt><dd>${esc(t.title)}${t.options ? `（${esc(res.minutes)} 分）` : ""}</dd>${t.zoom ? "<dt>場所</dt><dd>Zoom（URL は確認メールに記載）</dd>" : ""}</dl>
      <div class="addcal"><a class="btn ghost small" target="_blank" rel="noopener" href="${esc(bkGcal(t, res))}">Google カレンダーに追加 ↗</a></div>
      <div class="cta" style="justify-content:center"><button class="btn small" type="button" id="bk-again">予約画面に戻る</button></div>
      <p class="note">日時の変更・キャンセルは「予約」画面からいつでもできます</p></div>`;
    $("bk-done").focus(); bkBar();
    $("bk-again").onclick = () => loadBooking(bk.token);
    api("/api/booking", { token: bk.token }).then((r) => { if (r.ok) { bk.data = r; drawMine(); } });
  };
}
// Google カレンダーの「予定を作成」の住所（予約した人が自分のカレンダーに入れる）
function bkGcal(t, res) {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(Date.parse(res.slot) + (res.minutes || t.minutes) * 60e3).toISOString();
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(t.title)}&dates=${f(res.slot)}/${f(end)}&details=${encodeURIComponent("参加の URL は確認メールに記載しています")}`;
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
  const seen = { corr: 0, chat: 0, group: 0 };
  try { const p = localStorage.getItem("room_pane"); if (p === "corr" || p === "chat" || p === "group") pane = p; } catch (_) {}
  // チャットの便 C2b：グループの枠（入っているグループがある人だけに出す）
  let groupOpen = null, roomUnread = 0, groupUnread = 0;
  const groupsUi = setupGroups(token, { onUnread: (n) => { groupUnread = n; seen.group = pane === "group" ? 0 : n; drawPaneBadges(); setBadge(roomUnread + groupUnread, true); } });

  // 便 7a：招待リンクは会員にだけ届く（会員でない人には URL そのものが返らない）
  $("community").innerHTML = communityUrl
    ? `<h3>生徒同士の場</h3><p class="note">ほかの受講生と話せるオープンチャットです（こことはつながっていません）。</p><a class="btn ghost" href="${esc(communityUrl)}" target="_blank" rel="noopener">開く</a>`
    : communityState === "locked"
      ? `<h3>生徒同士の場</h3><p class="note">会員になると、ほかの受講生と話せるオープンチャットの招待リンクがここに出ます。</p>`
      : `<h3>生徒同士の場</h3><p class="note">オープンチャットの招待リンクを準備中です。</p>`;

  const setBadge = (n, total) => {
    if (!total) { roomUnread = n; n = n + groupUnread; }
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
    pane = p === "chat" ? "chat" : p === "group" && !$("pane-group").classList.contains("hidden") ? "group" : "corr";
    seen[pane] = 0;
    try { localStorage.setItem("room_pane", pane); } catch (_) {}
    const grp = pane === "group";
    ["room-list", "composer"].forEach((id) => $(id).classList.toggle("hidden", grp));
    $("group-box").classList.toggle("hidden", !grp);
    if (grp) { document.querySelectorAll("#tab-room [data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === "group"))); drawPaneBadges(); groupsUi.open(groupOpen); groupOpen = null; return; }
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
    // C2b：グループに入っていればグループの枠を出す
    const hasGroups = (r.groups || []).length > 0;
    $("pane-group").classList.toggle("hidden", !hasGroups);
    groupUnread = r.groups_unread || 0; if (pane !== "group") seen.group = groupUnread;
    if (pane === "group" && !hasGroups) pane = null;
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
    setPane: (p, id) => { if (p === "chat" || p === "corr" || p === "group") { pane = p; seen[p] = 0; } if (p === "group" && id) groupOpen = id; if (opened && p === "group") showPane("group"); },
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
const G_ERR = { empty: "数字か文のどちらかを入れてください", bad_number: "数字の欄に数でないものが入っています", body_too_long: "2000 字までです", day_out_of_range: "その日はもう編集できません（7 日前まで）", bad_plan: "送った中身が読めませんでした。画面を読み直してください", plan_too_large: "書いた量が多すぎます。少し短くしてください", not_student: "この画面はしあらぼの生徒向けです", report_incomplete: "理由と来週の進め方を選んでください", week_out_of_range: "その週はまだ出せません", plan_not_saved: "先に設計を保存してください", no_draft: "下書きが見つかりませんでした。画面を読み直してください", draft_closed: "この下書きはもう使いました。画面を読み直してください", bad_report: "送った中身が読めませんでした。画面を読み直してください" };
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
  if (!r.ok) { gSavedLine("保存できませんでした。" + gErr(r) + "（もう一度編集すると、保存し直します）", true); }
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
    if (t.dataset && t.dataset.start != null && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { const d = new Date(t.value + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); gData.plan.start = d.toISOString().slice(0, 10); planChanged("始めた週を変更しました"); }
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
      const msg = d.add === "ms" ? "状態を追加しました。空いている週に並びます" : d.del ? "削除しました" : d.spare ? (gData.plan.spare.includes(+d.spare) ? `第 ${d.spare} 週を予備にしました` : `第 ${d.spare} 週に状態を戻しました`) : d.bmv != null ? "時間の置き場所を移しました" : "";
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

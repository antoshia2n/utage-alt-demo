import { getClient, api, esc, fmtTime, authImage, shrinkImage } from "/js/common.js";

const $ = (id) => document.getElementById(id);
const fresh = /access_token=/.test(location.hash);
const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });

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

  const r = await api("/api/me" + (fresh ? "?fresh=1" : ""), { token });
  if (!r.ok) {
    if (r.error === "not_registered") return fail("このメールアドレスは台帳にありません。無料登録からやり直してください。");
    return fail("読み込めませんでした（" + (r.error || r.status) + "）");
  }
  $("loading").classList.add("hidden");
  $("main").classList.remove("hidden");
  $("who").textContent = r.me.name || r.me.email;

  const viewed = new Set(r.viewed);
  $("tab-lessons").innerHTML = r.lessons.map((l, i) => `
    <div class="card lesson" data-id="${esc(l.id)}" tabindex="0" role="button">
      <div class="num">${String(i + 1).padStart(2, "0")}</div>
      <div style="flex:1"><h3>${esc(l.title)}</h3><div class="meta">${l.minutes} 分 ${viewed.has(l.id) ? '<span class="pill">視聴済み</span>' : ""}</div></div>
    </div>`).join("") || '<p class="note">教材はまだありません。</p>';

  $("tab-news").innerHTML = r.announcements.map((a) => `
    <div class="card"><time class="note">${fmtTime(a.published_at)}</time><h3>${esc(a.title)}</h3><p class="note" style="margin:0">${esc(a.body)}</p></div>`).join("")
    || '<p class="note">お知らせはまだありません。</p>';

  const lessons = Object.fromEntries(r.lessons.map((l) => [l.id, l]));
  const sections = ["lessons", "lesson", "news", "room"];
  const showTab = (name) => {
    sections.forEach((s) => $("tab-" + s).classList.toggle("hidden", s !== name));
    if (name === "room") room.open();
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name || (name === "lesson" && b.dataset.tab === "lessons"))));
  };
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("back").addEventListener("click", (e) => { e.preventDefault(); showTab("lessons"); });

  const openLesson = async (id) => {
    const l = lessons[id]; if (!l) return;
    $("l-title").textContent = l.title;
    $("l-summary").textContent = l.summary;
    $("l-player").innerHTML = l.youtube_id
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(l.youtube_id)}" style="width:100%;height:100%;border:0;border-radius:10px" allowfullscreen></iframe>`
      : "動画の場所（本番は YouTube の限定公開を埋め込みます。デモでは架空の教材のため動画はありません）";
    showTab("lesson");
    window.scrollTo(0, 0);
    const res = await api("/api/events", { method: "POST", token, body: { type: "lesson_viewed", lesson_id: id } });
    // 記録できたら一覧の印をその場で付ける（読み直さなくても見える）
    if (res.ok && !viewed.has(id)) {
      viewed.add(id);
      const meta = document.querySelector(`.lesson[data-id="${CSS.escape(id)}"] .meta`);
      if (meta) meta.insertAdjacentHTML("beforeend", ' <span class="pill">視聴済み</span>');
    }
  };
  document.querySelectorAll(".lesson").forEach((el) => {
    el.addEventListener("click", () => openLesson(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openLesson(el.dataset.id); });
  });

  const room = setupRoom(token, r.community_url);
  room.setBadge(r.room_unread);
  if (location.hash === "#room") showTab("room");

  $("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace("/"); });

  if (fresh) maybeShowA2hs();
}

// ---------- 添削ルーム ----------
function setupRoom(token, communityUrl) {
  let opened = false, pending = [], timer = null, lastCount = -1, lastSig = "";

  $("community").innerHTML = communityUrl
    ? `<h3>生徒同士の場</h3><p class="note">ほかの受講生と話せる場所です（こことはつながっていません）。</p><a class="btn ghost" href="${esc(communityUrl)}" target="_blank" rel="noopener">開く</a>`
    : `<h3>生徒同士の場</h3><p class="note">Discord かオープンチャットの招待リンクをここに置きます（デモでは準備中）。</p>`;

  const setBadge = (n) => {
    const b = $("room-badge");
    b.textContent = n > 0 ? String(n) : "";
    b.classList.toggle("hidden", !(n > 0));
    try { if (navigator.setAppBadge) n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (_) {}
  };

  const block = (label, text, cls = "") => `<div class="rb ${cls}"><div class="rb-l">${label}</div><div class="rb-t">${esc(text) || '<span class="note">（なし）</span>'}</div></div>`;

  const render = (msgs) => {
    const list = $("room-list");
    if (!msgs.length) {
      list.innerHTML = '<div class="empty note">まだやりとりはありません。下の欄から最初の文章を出してください。</div>';
      return;
    }
    list.innerHTML = msgs.map((m) => m.from === "student"
      ? `<div class="msg-me"><div class="bubble">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="出した画像">`).join("")}</div>` : ""}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.replied ? '<span class="pill">返信済み</span>' : m.read_by_cyanin ? '<span class="pill gray">既読</span>' : ""}</div></div>`
      : `<div class="msg-them"><div class="reply card">
          <div class="reply-h">シアニンからの添削</div>
          ${block("原文", m.original, "orig")}${block("添削後", m.corrected, "corr")}${block("コメント", m.comment)}
        </div><div class="meta"><time>${fmtTime(m.at)}</time></div></div>`).join("");
    list.querySelectorAll("img[data-key]").forEach(async (img) => {
      try { img.src = await authImage("/api/room/image?key=" + encodeURIComponent(img.dataset.key), token); }
      catch (_) { img.alt = "画像を読めませんでした"; img.classList.add("broken"); }
    });
  };

  const load = async (markRead) => {
    const r = await api("/api/room", { token });
    if (!r.ok) { $("room-list").innerHTML = `<div class="msg err">読めませんでした（${esc(r.error || r.status)}）</div>`; return; }
    const sig = JSON.stringify(r.messages.map((m) => [m.id, m.replied, m.read_by_cyanin]));
    if (sig !== lastSig) {
      render(r.messages);
      if (opened && lastCount !== -1 && r.count > lastCount) $("room-list").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
      lastSig = sig; lastCount = r.count;
    }
    $("c-pick-label").classList.toggle("hidden", !r.images_enabled);
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
        if (!d.ok) throw new Error("画像を送れませんでした（" + (d.error || res.status) + "）");
        keys.push(d.key);
      }
      status("出しています…");
      const r = await api("/api/room", { method: "POST", token, body: { text, images: keys } });
      if (!r.ok) throw new Error("出せませんでした（" + (r.error || r.status) + "）");
      $("c-text").value = ""; pending = []; drawThumbs();
      status("出しました。返ってきたらこの部屋とタブの数字でお知らせします");
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

import { getClient, api, esc, fmtTime } from "/js/common.js";

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

  $("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace("/"); });

  if (fresh) maybeShowA2hs();
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

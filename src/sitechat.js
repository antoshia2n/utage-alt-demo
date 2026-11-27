// 公式サイトの作り直し 便 5（2026-11-25 Naoki OK）：公式サイト（lp.shia2n.jp/chat）のチャット
// - 見分け方：公式サイトのログイン（cookie lab_site）か、登録したその端末の印（lab_u）。会員サイトのログインは使わない
// - 1 対 1：会員サイトの「やり取り」と同じ部屋（出来事 room_chat）。Naoki は今までどおり /admin のチャットで読んで返す
// - グループ：入っているグループだけ（今までのグループチャットと同じ中身）。送る前にニックネームを決める
// - はじめて開いた人（部屋にまだ何も無い人）には、自動メッセージを 1 回だけ置く（中身は /admin のホームのタブ「チャット」）
// - 自分がまだ 1 回も送っていない間は、「選ぶだけで送れる文」を出す
export const CHAT_TEXT_MAX = 2000;

// h：{ db, addEvent, roomEvents, roomState, groups, nicks, push, logInbound, siteHome }
export function makeSiteChat(h) {
  const { addEvent, roomEvents, roomState, groups, nicks, push, logInbound, siteHome } = h;
  const chatOf = (e) => e.type === "room_chat";
  const fromOf = (e) => (e.payload && e.payload.from === "student" ? "student" : "cyanin");

  async function state(env, person) {
    const home = await siteHome.read(env);
    const cfg = home.chat || {};
    let evs = await roomEvents(env, person.id);
    // はじめて開いた人へ、自動メッセージを 1 回だけ（会員サイトで前からやり取りしている人には置かない）
    if (!evs.some((e) => e.type !== "room_read") && cfg.welcome) {
      await addEvent(env, person.id, "room_chat", { from: "cyanin", text: cfg.welcome, auto: "welcome" }, "auto");
      evs = await roomEvents(env, person.id);
    }
    const s = roomState(evs);
    const messages = evs.filter(chatOf).map((e) => ({
      id: e.id, from: fromOf(e), at: e.occurred_at, text: (e.payload && e.payload.text) || "",
      auto: !!(e.payload && e.payload.auto), read: fromOf(e) === "student" ? e.id <= s.adminReadUpto : true,
    }));
    const sent = messages.some((m) => m.from === "student");
    const gs = await groups.mine(env, person.id).catch(() => ({ groups: [], unread: 0 }));
    const nickname = nicks ? await nicks.nickname(env, person.id).catch(() => "") : "";
    return {
      ok: true, name: person.name || "", eta: cfg.eta || "", messages,
      unread: messages.filter((m) => m.from === "cyanin" && m.id > s.studentReadUpto).length,
      chips: sent ? [] : (cfg.chips || []),
      groups: (gs.groups || []).map((g) => ({ id: g.id, name: g.name, unread: g.unread || 0 })),
      nickname,
    };
  }

  async function send(env, person, { text } = {}) {
    const t = String(text || "").replace(/\r/g, "").trim();
    if (!t) return { ok: false, error: "empty" };
    if (t.length > CHAT_TEXT_MAX) return { ok: false, error: "too_long", max: CHAT_TEXT_MAX };
    const ev = await addEvent(env, person.id, "room_chat", { from: "student", text: t, via: "site" }, "site");
    await logInbound(env, "room", { customer_id: person.id, kind: "chat", via: "site", chars: t.length }, { ok: true, id: ev.id }, 200);
    if (push) await push.send(env, { title: `メッセージ（公式サイト）：${person.name || person.email}`, body: t.replace(/\s+/g, " ").slice(0, 120), url: `/admin#room/${person.id}/chat`, tag: `room-${person.id}` }).catch(() => {});
    return { ok: true, id: ev.id };
  }

  async function read(env, person) {
    const evs = await roomEvents(env, person.id);
    const s = roomState(evs);
    if (s.lastMessageId > s.studentReadUpto) await addEvent(env, person.id, "room_read", { by: "student", upto: s.lastMessageId }, "site");
    return { ok: true, upto: s.lastMessageId };
  }

  return { state, send, read };
}

// 公式サイトのチャットの画面（/chat）。中身はこの画面の中の動き（chatClient）が /api/p/chat から読んで描く
export function chatPageHtml({ siteName = "シアニン", join = "/xmas-gift" } = {}) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>チャット｜${esc(siteName)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kurenaido&display=swap">
<style>${CHAT_CSS}</style></head><body>
<a class="skip" href="#main">本文へ移動</a>
<header class="sh"><div><a class="logo" href="/">${esc(siteName)}</a><nav aria-label="サイトの案内"><a href="/#start">はじめての方へ</a><a href="/gift">会員限定コンテンツ</a><a href="/chat" aria-current="page">チャット</a><a href="/#consult">個別相談</a><a href="/blog">記事一覧</a></nav>
<div data-lab-part="account"></div></div></header>
<main id="main" tabindex="-1" class="cw">
<h1 class="sr">チャット</h1>
<section id="c-out" class="c-out" hidden><h2>チャットは無料会員の方がご利用いただけます</h2><p>ご登録いただくと、シアニンに直接質問できます。</p>
<p class="c-btns"><a class="go" href="${esc(join)}">無料会員登録</a><a class="sub" href="/login?next=%2Fchat">登録済みの方はログイン</a></p></section>
<div id="c-in" class="c-in" hidden>
<nav class="c-list" aria-label="会話の一覧"><h2>個別チャット</h2><ul id="c-one"></ul><h2>グループチャット</h2><ul id="c-groups"></ul></nav>
<section class="c-main" aria-labelledby="c-title"><div class="c-head"><h2 id="c-title">シアニン</h2><span id="c-eta"></span></div>
<div id="c-log" class="c-log" role="log" aria-live="polite" aria-labelledby="c-title" tabindex="0"></div>
<div id="c-chips" class="c-chips" hidden><p class="hand" aria-hidden="true">まずは1つ選ぶだけでOK ↓</p><div id="c-chip-btns" role="group" aria-label="選ぶだけで送れる文"></div><p class="c-note">選ぶだけで送信できます。自由に入力することもできます。</p></div>
<div id="c-nick" class="c-nick" hidden><label for="c-nick-in">グループで使うニックネーム</label><div class="c-row"><input id="c-nick-in" maxlength="20" autocomplete="nickname"><button type="button" id="c-nick-go">決める</button></div><p class="c-note">グループでは本名ではなく、この名前が出ます。</p></div>
<form id="c-form" class="c-form"><label for="c-text">メッセージ</label><div class="c-row"><textarea id="c-text" rows="2" maxlength="${CHAT_TEXT_MAX}" aria-describedby="c-msg"></textarea><button type="submit">送信</button></div><p id="c-msg" class="c-msg" role="alert"></p></form>
</section>
<aside class="c-side" aria-label="ご案内" id="c-side"></aside>
</div>
</main>
<footer class="bf"><div><span style="font-weight:700;color:#1a1a1a">${esc(siteName)}</span><a href="https://lab.shia2n.jp/legal/terms">利用規約</a><a href="https://lab.shia2n.jp/legal/privacy">プライバシーポリシー</a><a href="https://lab.shia2n.jp/legal/tokushoho">特定商取引法に基づく表記</a><span>© 株式会社Best Life Consulting</span></div></footer>
<script src="/_lab/embed.js" defer data-kind="site"></script>
<script>var __name=window.__name||function(f){return f};(${chatClient.toString()})();</script>
</body></html>`;
}

const CHAT_CSS = `[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:#fcfbf8;color:#1a1a1a;font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8;font-size:16px}
a{color:#1a1a1a}:focus-visible{outline:3px solid #1a1a1a;outline-offset:3px}@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:8px;top:-60px;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;z-index:30}.skip:focus{top:8px}
.sh{border-bottom:1px solid #d9d6cf}.sh>div{max-width:1360px;margin:0 auto;padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:16px 32px}
.sh .logo{font-weight:700;font-size:24px;letter-spacing:.04em;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.sh nav{display:flex;flex-wrap:wrap;gap:8px 24px;flex:1 1 auto}.sh nav a{padding:8px 0;text-decoration:none}.sh nav a[aria-current=page]{font-weight:700;text-decoration:underline}
.cw{max-width:1360px;margin:0 auto;padding:24px 24px 64px}
.c-out{max-width:640px;margin:48px auto;background:#f3f1eb;border-radius:8px;padding:32px}.c-out h2{margin:0 0 8px;font-size:24px}.c-out p{margin:0 0 16px}
.c-btns{display:flex;flex-wrap:wrap;gap:16px;align-items:center}.go{display:inline-flex;align-items:center;min-height:52px;padding:0 32px;background:#c8102e;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}.sub{min-height:44px;display:inline-flex;align-items:center}
.c-in{display:flex;flex-wrap:wrap;gap:24px;align-items:stretch}
.c-list{flex:1 1 240px;min-width:0;border:1px solid #d9d6cf;border-radius:8px;padding:16px;background:#fff}.c-list h2{margin:8px 8px 8px;font-size:14px;color:#555}.c-list ul{list-style:none;margin:0 0 8px;padding:0}
.c-list button{width:100%;display:flex;gap:12px;align-items:center;min-height:56px;padding:8px;border:0;border-radius:8px;background:none;font:inherit;text-align:left;cursor:pointer;color:#1a1a1a}
.c-list button[aria-current=true]{background:#f3f1eb}.c-list .av{flex:none;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;background:#f3f1eb}.c-list .av.cy{background:#c8102e;color:#fff}
.c-list .nm{flex:1 1 auto;font-weight:700}.c-list .un{flex:none;font-size:14px;font-weight:700;color:#c8102e}
.c-main{flex:999 1 520px;min-width:0;border:1px solid #d9d6cf;border-radius:8px;display:flex;flex-direction:column;background:#fff;min-height:560px}
.c-head{padding:16px 24px;border-bottom:1px solid #d9d6cf;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline}.c-head h2{margin:0;font-size:18px}.c-head span{font-size:14px;color:#555}
.c-log{flex:1 1 auto;overflow-y:auto;max-height:62vh;padding:24px;display:flex;flex-direction:column;gap:16px;background:#fcfbf8}
.c-day{margin:0 auto;font-size:14px;color:#555}.m{max-width:78%;display:flex;flex-direction:column;gap:4px}.m.me{align-self:flex-end;align-items:flex-end}
.m .b{background:#fff;border:1px solid #d9d6cf;border-radius:8px;padding:12px 16px;white-space:pre-wrap;word-break:break-word}.m.me .b{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
.m small{font-size:14px;color:#555}
.c-chips{padding:0 24px 16px;background:#fcfbf8}.hand{margin:0;font-family:"Zen Kurenaido","Noto Sans JP",sans-serif;font-size:24px;color:#c8102e;transform:rotate(-2deg);display:inline-block}
#c-chip-btns{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}#c-chip-btns button{min-height:44px;padding:0 16px;border:1px solid #8a867d;border-radius:8px;background:#fff;font:inherit;cursor:pointer;color:#1a1a1a}
.c-note{margin:0;font-size:14px;color:#555}
.c-nick,.c-form{padding:16px 24px;border-top:1px solid #d9d6cf}.c-nick label,.c-form label{display:block;font-weight:700;margin:0 0 8px}
.c-row{display:flex;gap:8px;align-items:stretch}.c-row input,.c-row textarea{flex:1 1 auto;min-width:0;font:inherit;font-size:16px;padding:12px 16px;border:1px solid #8a867d;border-radius:8px;min-height:52px;resize:vertical}
.c-row button{flex:none;min-height:52px;min-width:88px;padding:0 20px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font:inherit;font-weight:700;cursor:pointer}.c-row button:disabled{background:#8a867d}
.c-msg{margin:8px 0 0;font-size:14px;font-weight:700;color:#c8102e}.c-msg:empty{display:none}
.c-side{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:16px}
.c-card{border:2px solid #1a1a1a;border-radius:8px;padding:24px;background:#fff}.c-card .k{margin:0 0 8px;font-size:14px;font-weight:700}.c-card h2{margin:0 0 8px;font-size:18px;line-height:1.5}.c-card p{margin:0 0 16px}
.c-card a{display:flex;align-items:center;justify-content:center;min-height:48px;background:#c8102e;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}
.bf{border-top:1px solid #d9d6cf}.bf>div{max-width:1360px;margin:0 auto;padding:24px;display:flex;flex-wrap:wrap;align-items:center;gap:0 24px;font-size:14px;color:#555}.bf a{color:#555;padding:12px 0}.bf span:last-child{margin-left:auto}
@media (max-width:600px){.c-log{padding:16px;max-height:60vh}.m{max-width:92%}.c-out{padding:24px}}`;

// 画面の動き（ブラウザで動く。外の変数は使わない）
export function chatClient() {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } } };
  const hdr = () => { const u = store.get("lab_u"); return u ? { "x-lab-u": u, "content-type": "application/json" } : { "content-type": "application/json" }; };
  const api = (path, body) => fetch(path, body === undefined ? { headers: hdr() } : { method: "POST", headers: hdr(), body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
  const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  let st = null, cur = "one", room = null, sending = false;
  const msgEl = $("#c-msg");

  function drawList() {
    const one = $("#c-one"), gs = $("#c-groups");
    one.innerHTML = '<li><button type="button" data-room="one" aria-current="' + (cur === "one") + '"><span class="av cy" aria-hidden="true">シ</span><span class="nm">シアニン</span>' + (st.unread && cur !== "one" ? '<span class="un">未読 ' + st.unread + "</span>" : "") + "</button></li>";
    gs.innerHTML = st.groups.length ? st.groups.map((g) => '<li><button type="button" data-room="' + esc(g.id) + '" aria-current="' + (cur === g.id) + '"><span class="av" aria-hidden="true">#</span><span class="nm">' + esc(g.name) + "</span>" + (g.unread && cur !== g.id ? '<span class="un">未読 ' + g.unread + "</span>" : "") + "</button></li>").join("") : '<li class="c-note" style="padding:0 8px">入っているグループはまだありません</li>';
  }
  function drawLog(list, mineOf) {
    const log = $("#c-log");
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = list.length ? list.map((m) => '<div class="m' + (mineOf(m) ? " me" : "") + '"><small>' + esc(m.name || (mineOf(m) ? "あなた" : "シアニン")) + (m.auto ? " ・ 登録時の自動メッセージ" : "") + "</small><div class=\"b\">" + esc(m.text) + "</div><small>" + esc(hhmm(m.at)) + "</small></div>").join("") : '<p class="c-day">まだメッセージはありません</p>';
    if (atEnd || !log.dataset.drawn) log.scrollTop = log.scrollHeight;
    log.dataset.drawn = "1";
  }
  function drawRoom() {
    drawList();
    if (cur === "one") {
      $("#c-title").textContent = "シアニン";
      $("#c-eta").textContent = st.eta ? "返信の目安：" + st.eta : "";
      drawLog(st.messages, (m) => m.from === "student");
      const chips = $("#c-chips");
      chips.hidden = !st.chips.length;
      $("#c-chip-btns").innerHTML = st.chips.map((c) => '<button type="button" data-chip="' + esc(c) + '">' + esc(c) + "</button>").join("");
      $("#c-nick").hidden = true; $("#c-form").hidden = false;
    } else if (room) {
      $("#c-title").textContent = room.group.name;
      $("#c-eta").textContent = "メンバー " + room.members + " 人";
      drawLog(room.messages || [], (m) => m.mine);
      $("#c-chips").hidden = true;
      const needNick = !st.nickname;
      $("#c-nick").hidden = !needNick; $("#c-form").hidden = needNick;
    }
  }
  async function load() {
    const r = await api("/api/p/chat");
    if (!r.ok) { if (r.error === "need_login") { $("#c-out").hidden = false; $("#c-in").hidden = true; } else msgEl.textContent = "読み込めませんでした。時間をおいて開き直してください"; return; }
    st = r; $("#c-in").hidden = false; $("#c-out").hidden = true;
    if (cur !== "one") room = await api("/api/p/chat/groups/" + cur);
    drawRoom();
    if (cur === "one" && st.unread) { await api("/api/p/chat/read", {}); st.unread = 0; drawList(); }
    if (cur !== "one" && room && room.ok) api("/api/p/chat/groups/" + cur + "/read", {});
  }
  async function send(text) {
    if (sending) return;
    const t = String(text || "").trim();
    msgEl.textContent = "";
    if (!t) { msgEl.textContent = "メッセージを入力してください"; $("#c-text").focus(); return; }
    sending = true; $("#c-form button").disabled = true;
    const r = cur === "one" ? await api("/api/p/chat", { text: t }) : await api("/api/p/chat/groups/" + cur, { text: t });
    sending = false; $("#c-form button").disabled = false;
    if (!r.ok) { msgEl.textContent = r.error === "too_long" ? "長すぎます（" + r.max + " 字まで）" : r.error === "need_nickname" ? "先にニックネームを決めてください" : "送れませんでした。時間をおいてもう一度お試しください"; return; }
    $("#c-text").value = "";
    await load();
    $("#c-text").focus();
  }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-room],[data-chip],#c-nick-go");
    if (!b) return;
    if (b.dataset.room) { cur = b.dataset.room; room = null; $("#c-log").dataset.drawn = ""; await load(); const again = document.querySelector('[data-room="' + cur + '"]'); if (again) again.focus(); return; }
    if (b.dataset.chip) { await send(b.dataset.chip); return; }
    if (b.id === "c-nick-go") {
      const v = $("#c-nick-in").value.trim();
      const r = await api("/api/p/chat/nickname", { nickname: v });
      if (!r.ok) { msgEl.textContent = "ニックネームを確かめてください（1〜20 字）"; $("#c-nick-in").focus(); return; }
      await load(); $("#c-text").focus();
    }
  });
  $("#c-form").addEventListener("submit", (ev) => { ev.preventDefault(); send($("#c-text").value); });
  $("#c-text").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); send($("#c-text").value); } });
  // 横：個別相談の残り枠（ホームの中身から）
  fetch("/api/p/home").then((r) => r.json()).then((h) => {
    const c = (h && h.sidebar && h.sidebar.consult) || {};
    if (!c.title) return;
    const href = /^#/.test(c.href || "") ? "/" + c.href : (c.href || "/#consult");
    $("#c-side").innerHTML = '<section class="c-card" aria-labelledby="cc-h"><p class="k">人数限定</p><h2 id="cc-h">' + esc(c.title) + "</h2>" + (typeof c.left === "number" ? "<p>" + (c.left > 0 ? "今月の募集枠：残り " + c.left + " 名" : "今月の募集枠は埋まりました") + "</p>" : "") + (c.left === 0 ? "" : '<a href="' + esc(href) + '">' + esc(c.cta || "予約する") + "</a>") + "</section>";
  }).catch(() => {});
  load();
  // 開いている間は 20 秒ごとに新しいメッセージを読む（入力中・裏に回っている間は読まない）
  setInterval(() => { if (!document.hidden && !$("#c-text").value && st) load(); }, 20000);
}

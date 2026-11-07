// チャットの便 C2b（2026-11-07 Naoki OK 12:48・見本 https://claude.ai/artifact/Rpu6FQZSs76gixu6VDeQ2w）：生徒の画面の「グループ」。
//  ・部屋（添削の画面）の 3 つ目の枠。入っているグループの一覧 → 1 つのグループ → スレッド、の 3 段（← で戻る）
//  ・送れるのは文と画像（4 枚まで）。メッセージを長押し（パソコンは右クリック）でスタンプ・スレッドで返信・コピー
//  ・見えるのは入っているグループだけ。ほかの人はニックネームだけ（本名もメールも出ない）
//  ・C2b-2：初めて送るときにニックネームを決める（あとで「ニックネーム」から変えられる）
import { api, esc, fmtTime, authImage, shrinkImage } from "/js/common.js";

const EMO = ["👍", "❤️", "😂", "🙏", "🔥", "👀"];
const COL = ["#b45309", "#7c3aed", "#0f766e", "#be123c", "#1d4ed8", "#4d7c0f", "#0369a1", "#a21caf"];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const pad = (n) => String(n).padStart(2, "0");
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ERR = { need_nickname: "先にニックネームを決めてください", bad_nickname: "ニックネームは 20 字までです（メールや < > は使えません）", not_found: "グループが見つかりませんでした（アーカイブされたかもしれません）", not_member: "このグループのメンバーではありません", empty: "文か画像を入れてください", too_long: "長すぎます（8000 字まで）", bad_image: "画像を送れませんでした", bad_thread: "元のメッセージが見つかりません" };

const CSS = `
#group-box{--g:#0f766e}
#group-box .g-row{display:flex;align-items:center;gap:12px;width:100%;border:0;background:none;padding:12px 4px;border-bottom:1px solid var(--line);cursor:pointer;text-align:left;font:inherit;color:inherit;min-height:64px}
#group-box .g-av{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}
#group-box .p-av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:12px;flex:none}
#group-box .g-t{flex:1;min-width:0}#group-box .g-t b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#group-box .g-t small{display:block;color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#group-box .g-r{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;color:var(--muted)}
#group-box .g-n{background:#b91c1c;color:#fff;border-radius:99px;min-width:20px;height:20px;display:grid;place-items:center;font-size:12px;font-weight:700;padding:0 6px}
#group-box .g-head{display:flex;align-items:center;gap:8px;margin:0 0 8px}
#group-box .g-head h3{margin:0;font-size:17px;flex:1;min-width:0}#group-box .g-head small{display:block;font-size:12px;color:var(--muted);font-weight:400}
#group-box .g-back{min-width:44px;min-height:44px;border:1px solid var(--line);background:var(--surface,#fff);border-radius:10px;font-size:20px;cursor:pointer}
#group-box .g-room{background:#f3ede6;border-radius:14px;padding:10px 8px;max-height:62vh;overflow:auto}
#group-box .g-m{display:flex;gap:6px;margin:8px 0;align-items:flex-end}
#group-box .g-m.me{flex-direction:row-reverse}
#group-box .g-m>div{min-width:0;max-width:78%}
#group-box .g-who{font-size:11.5px;color:var(--muted);margin:0 0 2px 2px}
#group-box .g-b{background:#fff;border-radius:16px;padding:8px 12px;white-space:pre-wrap;word-break:break-word;font-size:15px}
#group-box .g-m.me .g-b{background:#fde7b0}
#group-box .g-ts{font-size:11px;color:var(--muted);white-space:nowrap;text-align:right}
#group-box .g-imgs{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}#group-box .g-imgs img{max-width:200px;max-height:200px;border-radius:10px;object-fit:cover}
#group-box .g-rcs{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}#group-box .g-m.me .g-rcs{justify-content:flex-end}
#group-box .g-rc{border:1px solid var(--line);background:#fff;border-radius:99px;padding:0 9px;font-size:13px;min-height:30px;cursor:pointer}
#group-box .g-rc[aria-pressed=true]{border-color:#b45309;background:#fef3c7;color:#b45309;font-weight:700}
#group-box .g-th{border:0;background:#fff;border-radius:99px;padding:4px 12px;margin-top:4px;font-size:13px;color:#1d4ed8;font-weight:600;cursor:pointer;min-height:32px}
#group-box .g-sep{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin:10px 0}#group-box .g-sep::after{content:"";flex:1;border-top:1px solid var(--line)}
#group-box .g-day{text-align:center;font-size:12px;color:var(--muted);margin:10px 0}
#group-box .g-comp{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
#group-box .g-comp textarea{flex:1;border:1px solid var(--line);border-radius:18px;padding:10px 14px;resize:none;min-height:44px;font:inherit;font-size:16px}
#group-box .g-ib{width:44px;height:44px;border-radius:50%;border:0;background:#f3ede6;cursor:pointer;font-size:18px;flex:none;display:grid;place-items:center}
#group-box .g-ib.send{background:#b45309;color:#fff}
#group-box .g-thumbs{display:flex;gap:6px;margin-top:6px}#group-box .g-thumbs img{width:56px;height:56px;object-fit:cover;border-radius:8px}
.g-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:60;display:flex;align-items:flex-end;justify-content:center}
.g-sheet{background:#fff;border-radius:18px 18px 0 0;width:min(520px,100%);padding:10px 0 calc(16px + env(safe-area-inset-bottom))}
.g-sheet .g-er{display:flex;justify-content:space-around;padding:4px 10px 10px;border-bottom:1px solid #eee}
.g-sheet .g-er button{border:0;background:none;font-size:28px;min-width:48px;min-height:48px;border-radius:12px;cursor:pointer}
.g-sheet .g-er button[aria-pressed=true]{background:#fef3c7}
.g-sheet .g-a{display:block;width:100%;border:0;background:none;text-align:left;padding:14px 22px;font:inherit;font-size:16px;cursor:pointer;min-height:48px}
`;

export function setupGroups(token, { onUnread } = {}) {
  const box = document.getElementById("group-box");
  if (!document.getElementById("group-css")) { const st = document.createElement("style"); st.id = "group-css"; st.textContent = CSS; document.head.appendChild(st); }
  let view = "list", gid = null, thread = null, data = null, list = [], pending = [], timer = null, busy = false;
  const errText = (r) => ERR[r && r.error] || "うまくいきませんでした。画面を読み直してください";
  const avP = (id, name) => `<span class="p-av" style="background:${id === "cyanin" ? "#b45309" : COL[hash(id) % COL.length]}" aria-hidden="true">${esc(String(name || "？").slice(0, 1))}</span>`;
  const say = (t) => { const s = document.getElementById("g-status"); if (s) s.textContent = t; };

  async function loadList() {
    const r = await api("/api/room/groups", { token });
    if (!r.ok) { box.innerHTML = `<p class="msg err">${esc(errText(r))}</p>`; return; }
    list = r.groups; if (onUnread) onUnread(r.unread || 0);
    if (view !== "list") return;
    box.innerHTML = list.length ? list.map((g) => `<button class="g-row" type="button" data-g="${g.id}"><span class="g-av" style="background:#0f766e" aria-hidden="true">${esc(g.name.slice(0, 1))}</span>
      <span class="g-t"><b>${esc(g.name)} <span class="note" style="font-weight:400;font-size:12px">（${g.members} 人）</span></b><small>${g.last_text ? esc(g.last_name) + "：" + esc(g.last_text) : "まだメッセージはありません"}</small></span>
      <span class="g-r"><time>${g.last_at ? esc(hm(g.last_at)) : ""}</time>${g.unread ? `<span class="g-n" aria-label="新着 ${g.unread}">${g.unread}</span>` : ""}</span></button>`).join("")
      : '<div class="empty note">まだグループに参加していません。シアニンから招待されると、ここに出ます。</div>';
    box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => openGroup(b.dataset.g)));
  }

  async function openGroup(id, keepThread) {
    gid = id; view = "group"; if (!keepThread) thread = null;
    const r = await api(`/api/room/groups/${id}`, { token });
    if (!r.ok) { view = "list"; await loadList(); return; }
    data = r;
    await api(`/api/room/groups/${id}/read`, { method: "POST", token });
    draw();
    loadList();
  }

  const mHtml = (m, root) => `<div class="g-m ${m.mine ? "me" : ""}" data-m="${m.id}" tabindex="0" aria-label="${esc(m.name)} ${esc(fmtTime(m.at))}：${esc(m.text.slice(0, 60))}。長押しかメニューキーで操作">
    ${m.mine ? "" : avP(m.who, m.name)}<div>${m.mine ? "" : `<div class="g-who">${esc(m.name)}</div>`}<div class="g-b">${esc(m.text)}${m.images.length ? `<div class="g-imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="${esc(m.name)}が送った画像">`).join("")}</div>` : ""}</div>
    <div class="g-rcs">${(m.reactions || []).map((x) => `<button class="g-rc" type="button" data-re="${x.emoji}" aria-pressed="${x.mine}" aria-label="${x.emoji} ${x.count}（${esc(x.names.join("、"))}）">${x.emoji} ${x.count}</button>`).join("")}</div>
    ${root && m.reply_count ? `<button class="g-th" type="button" data-th="${m.id}">💬 返信 ${m.reply_count} 件 ›</button>` : ""}</div>
    <span class="g-ts">${m.mine && root ? `既読 ${m.read}<br>` : ""}${hm(m.at)}</span></div>`;

  function draw() {
    const tm = thread && data.messages.find((m) => m.id === thread);
    if (thread && !tm) thread = null;
    let last = "";
    const body = tm
      ? mHtml(tm, false) + `<div class="g-sep">返信 ${tm.reply_count} 件</div>` + tm.replies.map((x) => mHtml(x, false)).join("")
      : data.messages.map((m) => { const d = new Date(m.at), k = `${d.getMonth() + 1}/${d.getDate()}`; const h = k !== last ? `<div class="g-day">${k}</div>` : ""; last = k; return h + mHtml(m, true); }).join("") || '<div class="empty note">まだメッセージはありません。</div>';
    box.innerHTML = `<div class="g-head"><button class="g-back" type="button" id="g-back" aria-label="${tm ? "グループへ戻る" : "グループの一覧へ戻る"}">‹</button>
      <h3>${tm ? "スレッド" : esc(data.group.name)}<small>${tm ? esc(data.group.name) : `メンバー ${data.members} 人`}・<button class="link" type="button" id="g-nick">ニックネーム：${esc(data.me.nickname || "未設定")}</button></small></h3></div>
      <div class="g-room" id="g-room">${body}</div>
      <div class="g-thumbs" id="g-thumbs"></div>
      <form class="g-comp" id="g-comp">${tm ? "" : '<label class="g-ib" aria-label="画像を足す">📷<input id="g-pick" type="file" accept="image/*" multiple hidden></label>'}
        <label for="g-text" class="sr">${tm ? "スレッドに返信" : "メッセージ"}</label><textarea id="g-text" rows="1" maxlength="8000" placeholder="${tm ? "スレッドに返信" : "メッセージ"}"></textarea>
        <button class="g-ib send" type="submit" aria-label="送る">➤</button></form><p class="note" id="g-status" aria-live="polite"></p>`;
    document.getElementById("g-nick").addEventListener("click", () => nickDlg());
    document.getElementById("g-back").addEventListener("click", () => { if (tm) { thread = null; draw(); } else { view = "list"; gid = null; data = null; pending = []; loadList(); } });
    const room = document.getElementById("g-room");
    room.querySelectorAll("[data-th]").forEach((b) => b.addEventListener("click", () => { thread = Number(b.dataset.th); draw(); document.getElementById("g-text").focus(); }));
    room.querySelectorAll("[data-re]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); react(Number(b.closest(".g-m").dataset.m), b.dataset.re); }));
    room.querySelectorAll(".g-m").forEach((el) => {
      const id = Number(el.dataset.m), m = (tm ? [tm, ...tm.replies] : data.messages).find((x) => x.id === id);
      const open = (e) => { if (e) e.preventDefault(); sheet(m, !tm); };
      el.addEventListener("contextmenu", open);
      el.addEventListener("keydown", (e) => { if (e.target === el && (e.key === "Enter" || e.key === "ContextMenu")) open(e); });
      let t; el.addEventListener("touchstart", () => { t = setTimeout(() => open(), 500); }, { passive: true }); el.addEventListener("touchend", () => clearTimeout(t)); el.addEventListener("touchmove", () => clearTimeout(t));
    });
    room.querySelectorAll("img[data-key]").forEach(async (img) => { try { img.src = await authImage(`/api/room/groups/${gid}/image?key=` + encodeURIComponent(img.dataset.key), token); } catch (_) { img.alt = "画像を読めませんでした"; } });
    const pick = document.getElementById("g-pick");
    if (pick) pick.addEventListener("change", async (e) => { for (const f of [...e.target.files].slice(0, 4 - pending.length)) { const blob = await shrinkImage(f); pending.push({ blob, url: URL.createObjectURL(blob) }); } e.target.value = ""; thumbs(); });
    thumbs();
    document.getElementById("g-comp").addEventListener("submit", send);
    room.scrollTop = room.scrollHeight;
  }
  function thumbs() {
    const t = document.getElementById("g-thumbs"); if (!t) return;
    t.innerHTML = pending.map((p, i) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" data-i="${i}" aria-label="外す">×</button></div>`).join("");
    t.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { pending.splice(Number(b.dataset.i), 1); thumbs(); }));
  }
  async function send(e) {
    e.preventDefault();
    if (busy) return;
    const text = document.getElementById("g-text").value.trim();
    if (!text && !pending.length) { say("文か画像を入れてください"); return; }
    if (!data.me.nickname) { const ok = await nickDlg(true); if (!ok) return; }
    busy = true;
    try {
      const keys = [];
      for (const [i, p] of pending.entries()) {
        say(`画像を送っています（${i + 1}/${pending.length}）`);
        const res = await fetch("/api/room/images", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": p.blob.type || "image/jpeg" }, body: p.blob });
        const d = await res.json().catch(() => ({}));
        if (!d.ok) throw new Error(errText({ error: "bad_image" }));
        keys.push(d.key);
      }
      const r = await api(`/api/room/groups/${gid}`, { method: "POST", token, body: { text, images: keys, thread_of: thread || null } });
      if (!r.ok) throw new Error(errText(r));
      pending = [];
      await openGroup(gid, true);
      document.getElementById("g-text").focus();
    } catch (err) { say(err.message); } finally { busy = false; }
  }
  // ニックネームを決める窓（初めて送るとき・ヘッダーから）。決めたら true
  function nickDlg(first) {
    return new Promise((done) => {
      const opener = document.activeElement;
      const bg = document.createElement("div"); bg.className = "g-sheet-bg";
      bg.innerHTML = `<div class="g-sheet" role="dialog" aria-modal="true" aria-labelledby="g-nk-h" style="padding:18px 20px calc(18px + env(safe-area-inset-bottom))">
        <h3 id="g-nk-h" style="margin:0 0 6px">${first ? "グループで使うニックネームを決めてください" : "ニックネームを変える"}</h3>
        <p class="note" style="margin:0 0 10px">グループのほかのメンバーには、この名前だけが表示されます（本名は表示されません）。あとで変えられます。</p>
        <label for="g-nk" class="sr">ニックネーム</label><input id="g-nk" maxlength="20" value="${esc(data.me.nickname || "")}" placeholder="例 みさき" style="width:100%;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px">
        <p class="note" id="g-nk-err" role="alert" style="color:#b91c1c"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" type="button" data-x>キャンセル</button><button class="btn" type="button" data-ok>決める</button></div></div>`;
      document.body.appendChild(bg);
      const close = (v) => { bg.remove(); if (opener && opener.isConnected) opener.focus(); done(v); };
      bg.querySelector("[data-x]").addEventListener("click", () => close(false));
      bg.addEventListener("click", (e) => { if (e.target === bg) close(false); });
      bg.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); if (e.key === "Enter" && e.target.id === "g-nk") { e.preventDefault(); bg.querySelector("[data-ok]").click(); } });
      bg.querySelector("[data-ok]").addEventListener("click", async () => {
        const v = bg.querySelector("#g-nk").value.trim();
        if (!v) { bg.querySelector("#g-nk-err").textContent = "ニックネームを入れてください"; return; }
        const r = await api("/api/room/nickname", { method: "POST", token, body: { nickname: v } });
        if (!r.ok) { bg.querySelector("#g-nk-err").textContent = errText(r); return; }
        data.me.nickname = r.nickname;
        const b = document.getElementById("g-nick"); if (b) b.textContent = "ニックネーム：" + r.nickname;
        close(true);
      });
      bg.querySelector("#g-nk").focus();
    });
  }
  async function react(id, emoji) {
    const r = await api(`/api/room/groups/${gid}/react`, { method: "POST", token, body: { message_id: id, emoji } });
    if (!r.ok) { say(errText(r)); return; }
    await openGroup(gid, true);
    const el = box.querySelector(`.g-m[data-m="${id}"]`); if (el) el.focus();
  }
  function sheet(m, root) {
    const opener = document.activeElement;
    const bg = document.createElement("div"); bg.className = "g-sheet-bg";
    const mine = new Set((m.reactions || []).filter((x) => x.mine).map((x) => x.emoji));
    bg.innerHTML = `<div class="g-sheet" role="dialog" aria-modal="true" aria-label="メッセージの操作"><div class="g-er" role="group" aria-label="スタンプ">${EMO.map((k) => `<button type="button" data-e="${k}" aria-pressed="${mine.has(k)}" aria-label="スタンプ ${k}">${k}</button>`).join("")}</div>
      ${root ? '<button class="g-a" type="button" data-a="th">スレッドで返信</button>' : ""}<button class="g-a" type="button" data-a="copy">コピー</button><button class="g-a" type="button" data-a="x">閉じる</button></div>`;
    document.body.appendChild(bg);
    const close = () => { bg.remove(); if (opener && opener.isConnected) opener.focus(); };
    bg.addEventListener("click", (e) => {
      if (e.target === bg) return close();
      const b = e.target.closest("button"); if (!b) return;
      bg.remove();
      if (b.dataset.e) return react(m.id, b.dataset.e);
      if (b.dataset.a === "th") { thread = m.id; draw(); document.getElementById("g-text").focus(); return; }
      if (b.dataset.a === "copy") navigator.clipboard.writeText(m.text).then(() => say("コピーしました"), () => say("コピーできませんでした"));
      if (opener && opener.isConnected) opener.focus();
    });
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    bg.querySelector("button").focus();
  }

  const poll = () => { if (document.hidden || box.offsetParent === null) return; if (view === "list") loadList(); else if (gid && !busy && !document.querySelector(".g-sheet-bg") && !document.getElementById("g-text").value) openGroup(gid, true); };
  return {
    open: (id) => { clearInterval(timer); timer = setInterval(poll, 30000); if (id) openGroup(id); else { view = "list"; loadList(); } },
    refreshCount: loadList,
  };
}

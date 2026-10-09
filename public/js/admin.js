import { getClient, api, esc, fmtTime, SOURCE_LABEL, EVENT_LABEL, authImage } from "/js/common.js";
import { correctionHtml, wireNotes } from "/js/correction.js";
import { makeBlueprint } from "/js/blueprint.js";

const $ = (id) => document.getElementById(id);
const steps = ["step-login", "step-enroll", "step-mfa", "console"];
const show = (id) => {
  steps.forEach((s) => $(s).classList.toggle("hidden", s !== id));
  $("auth-wrap").classList.toggle("hidden", id === "console");
};
// 画面の中にいるときは上の欄、ログインの前はログインの欄に出す
const errBox = () => ($("console").classList.contains("hidden") ? $("err") : $("err2"));
const fail = (t) => { const b = errBox(); b.textContent = t; b.classList.remove("hidden"); };
const clearErr = () => { $("err").classList.add("hidden"); $("err2").classList.add("hidden"); };
let sb, token;

async function start() {
  try { sb = await getClient(); } catch (e) { return fail(e.message); }
  const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
  if (hashErr) fail("リンクが使えませんでした：" + hashErr);
  const { data } = await sb.auth.getSession();
  if (location.hash.includes("access_token")) history.replaceState(null, "", "/admin");
  if (!data.session) return show("step-login");
  // 2026-10-08 Naoki の指示で認証アプリの 6 桁を外した。メールのリンクで入ったらそのまま一覧を開く
  await openConsole();
}

async function secondFactor() {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.currentLevel === "aal2") return openConsole();
  const { data: f } = await sb.auth.mfa.listFactors();
  const verified = (f.totp || []).find((x) => x.status === "verified");
  if (verified) {
    show("step-mfa");
    $("verify2").onclick = () => verify(verified.id, $("code2").value);
    return;
  }
  for (const x of f.all || []) if (x.status === "unverified") await sb.auth.mfa.unenroll({ factorId: x.id });
  const { data: en, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "demo-admin-" + Date.now() });
  if (error) return fail("2 段目の準備ができませんでした：" + error.message);
  $("qr").src = en.totp.qr_code;
  $("secret").textContent = en.totp.secret;
  show("step-enroll");
  $("verify1").onclick = () => verify(en.id, $("code1").value);
}

async function verify(factorId, code) {
  clearErr();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  if (error) return fail("6 桁が合いませんでした：" + error.message);
  await openConsole();
}

async function openConsole() {
  const { data } = await sb.auth.getSession();
  token = data.session.access_token;
  const who = await api("/api/admin/whoami", { token });
  if (!who.ok) {
    return fail(who.error === "not_admin" ? "このメールアドレスはシアニン用の画面に入れません。" : "入れませんでした（" + (who.error || who.status) + "）");
  }
  show("console");
  $("who-admin").textContent = who.email;
  loadStats();
  search();
  setupViews();
  loadRooms();
  loadSetup();
  setupCommunity();
  setupMail();
  setupCalendar();
  setupPush();
  loadApprovalBadge();
  // AI から渡された承認の URL（/admin#approval/<番号>）で開いたときは、AI と承認のタブを開く
  // 便 8f-3：通知から開いたとき（#room/<人の番号>）は、その人の部屋を開く。開いたままの画面で通知を押したときも同じ
  if (!routeHash()) loadHome();
  window.addEventListener("hashchange", routeHash);
  setInterval(() => { if (!document.hidden) loadRooms(); }, 30000);
  let t;
  $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 250); });
  $("src").addEventListener("change", search);
}

function routeHash() {
  const h = location.hash;
  if (h.startsWith("#approval/")) { document.querySelector('[data-view="ai"]').click(); return true; }
  const rm = h.match(/^#room[/]([0-9a-f-]{36})$/i);
  if (rm) { openView("rooms"); openRoom(rm[1]); return true; }
  return false;
}

async function loadStats() {
  const s = await api("/api/admin/stats", { token });
  if (!s.ok) return;
  const box = (label, n) => `<div class="stat"><b>${n}</b>${esc(label)}</div>`;
  $("stats").innerHTML = box("人", s.customers)
    + Object.entries(s.by_stage).map(([k, v]) => box(k, v)).join("")
    + Object.entries(s.by_source).map(([k, v]) => box("流入元 " + (SOURCE_LABEL[k] || k), v)).join("");
}

let current = null;
async function search() {
  const q = encodeURIComponent($("q").value.trim());
  const r = await api(`/api/admin/people?q=${q}&source=${$("src").value}`, { token });
  if (!r.ok) { $("count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; $("people").innerHTML = ""; return; }
  $("count").textContent = r.count === 0 ? "当てはまる人は 0 人です" : r.count + " 人";
  $("people").innerHTML = r.people.map((p) => `
    <li data-id="${p.id}" ${p.id === current ? 'aria-current="true"' : ""}>
      <div><div>${esc(p.name || "（名前なし）")}</div><div class="sub">${esc(p.email)}</div></div>
      <div style="text-align:right">${p.deal_stage && p.deal_stage !== "none" ? `<span class="pill warn">${esc(STAGE[p.deal_stage])}</span> ` : ""}${p.member ? '<span class="pill">会員</span> ' : ""}<span class="pill gray">${esc(p.stage)}</span><div class="sub">${SOURCE_LABEL[p.source] || esc(p.source)}${p.note_member ? "・note" : ""}</div></div>
    </li>`).join("");
  document.querySelectorAll("#people li").forEach((li) => li.addEventListener("click", () => detail(li.dataset.id)));
}

async function detail(id) {
  current = id;
  document.querySelectorAll("#people li").forEach((li) => li.toggleAttribute("aria-current", li.dataset.id === id));
  const r = await api("/api/admin/people/" + id, { token });
  if (!r.ok || !r.found) { $("detail").innerHTML = '<p class="note">読めませんでした。</p>'; return; }
  const p = r.person;
  $("detail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(p.name || "（名前なし）")}</h2>
    <div class="note">${esc(p.email)}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 16px">
      ${r.stage ? `<span class="pill">段階 ${esc(r.stage.label)}</span>` : ""}
      <span class="pill gray">${esc(p.stage)}</span>
      <span class="pill gray">流入元 ${SOURCE_LABEL[p.source] || esc(p.source)}</span>
      <span class="pill gray">出来事 ${p.event_count} 件</span>
      ${p.entitlement && p.entitlement.member ? `<span class="pill">会員（${esc(p.entitlement.plan || "定期課金")}）</span>` : `<span class="pill gray">権利 ${esc(p.entitlement ? p.entitlement.status : "none")}</span>`}
    </div>
    ${p.entitlement && (p.entitlement.gate_keys || []).length ? `<div class="note" style="margin:-8px 0 12px">門番の権利：${p.entitlement.gate_keys.map(esc).join("・")}</div>` : ""}
    <div class="note" style="margin:-4px 0 4px">ラベル（自動で付く。手で付けたものは「手」）</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 6px" id="labels">${(r.labels || []).map((x) => `<span class="pill ${x.auto ? "gray" : "warn"}">${esc(x.label)}${x.auto ? "" : ` ・手 <a href="#" data-unlabel="${esc(x.label)}" aria-label="外す">×</a>`}</span>`).join("") || '<span class="note">（無し）</span>'}</div>
    ${r.room ? `<div class="card chat-entry" style="margin:0 0 12px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><b>チャット</b> <span class="note">${r.room.messages ? `シアニンが読んでいない ${r.room.unread_for_admin}・添削の未返信 ${r.room.unreplied}・相手が読んでいない ${r.room.unread_for_student}` : "まだやりとりはありません"}</span></div>
      <button class="btn small" type="button" id="open-chat">チャットを開く</button></div>` : ""}
    ${r.purchases && r.purchases.length ? `<div class="note" style="margin:0 0 4px">買ったもの</div><ul class="plain" style="margin:0 0 12px;padding-left:18px">${r.purchases.map((x) => `<li>${esc(x.name)}${x.amount != null ? "・" + Number(x.amount).toLocaleString() + " 円" : ""}${x.mode === "test" ? "（テスト）" : ""} <span class="note">${fmtTime(x.at)}</span></li>`).join("")}</ul>` : ""}
    <form id="lb" style="display:flex;gap:6px;align-items:center;margin:0 0 16px"><input id="lb-name" type="text" maxlength="40" placeholder="ラベルを手で付ける" style="max-width:220px;min-height:36px"><button class="btn ghost small" type="submit">付ける</button><span class="note" id="lb-status"></span></form>
    <div class="deal-box">
      <h4>商談 ${p.deal && p.deal.stage !== "none" ? `<span class="pill warn">${esc(STAGE[p.deal.stage])}</span>` : '<span class="note">（まだ無し）</span>'}</h4>
      <dl>
        ${p.deal && p.deal.booking ? `<dt>予約</dt><dd>${fmtTime(p.deal.booking)}</dd>` : ""}
        ${p.deal && p.deal.memo ? `<dt>メモ</dt><dd class="pre">${esc(p.deal.memo)}</dd>` : ""}
        ${p.deal && p.deal.amount != null ? `<dt>成約額</dt><dd>${Number(p.deal.amount).toLocaleString()} 円</dd>` : ""}
      </dl>
      <form id="deal" class="stack" style="margin-top:10px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="d-stage" class="inline"><option value="done">面談した</option><option value="won">成約</option><option value="lost">失注</option></select>
          <input id="d-amount" type="text" inputmode="numeric" placeholder="成約額（円・成約のとき）" style="max-width:220px;min-height:40px">
        </div>
        <textarea id="d-memo" rows="2" placeholder="面談のメモ"></textarea>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">段階を進める</button><span class="note" id="d-status"></span></div>
      </form>
      ${p.contract ? `<h4 style="margin-top:14px">コンサルの契約と入金 <span class="note">（見本・sales-manager の形）</span></h4>
      <dl><dt>プラン</dt><dd>${esc(p.contract.plan)}・${Number(p.contract.amount).toLocaleString()} 円</dd><dt>状態</dt><dd>${esc(p.contract.status)}</dd>
      <dt>入金</dt><dd>${p.contract.paid.map((x) => esc(x.month) + " " + esc(x.state)).join("・")}</dd></dl>` : ""}
      <details class="setup" id="meet-box"><summary>面談の記録（consult-manager）</summary><div id="meet" class="note" style="margin-top:8px">開くと読みます</div></details>
    </div>
    <details class="setup" style="margin:0 0 16px"><summary>メールを送る（テスト宛てだけに届く）</summary>
      <form id="mail" class="stack" style="margin-top:8px">
        <div><label for="m-sub">件名</label><input id="m-sub" type="text" maxlength="200"></div>
        <div><label for="m-body">本文</label><textarea id="m-body" rows="4"></textarea></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">送る</button><span class="note" id="m-status"></span></div>
      </form>
    </details>
    <label class="check" style="margin-bottom:16px"><input type="checkbox" id="nm" ${p.note_member ? "checked" : ""}> <span>note のメンバー（手で付ける印）</span></label>
    <ol class="timeline">${r.events.map((e) => `
      <li><time>${fmtTime(e.occurred_at)}</time>${esc(EVENT_LABEL[e.type] || e.type)}${detailText(e)}<span class="note"> · ${esc(e.actor)}</span></li>`).join("")}
    </ol>`;
  // 便 8f-3：人の 1 枚からその人の部屋へ
  if ($("open-chat")) $("open-chat").addEventListener("click", () => { openView("rooms"); openRoom(id); });
  // 便 8e：ラベルを手で付ける・外す（画面からは承認なし。AI からは承認が要る）
  $("lb").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const label = $("lb-name").value.trim();
    if (!label) return;
    const lr = await api("/api/admin/labels", { method: "POST", token, body: { person_id: id, label } });
    if (!lr.ok) { $("lb-status").textContent = "付けられませんでした（" + (lr.error || lr.status) + "）"; return; }
    detail(id);
  });
  document.querySelectorAll("[data-unlabel]").forEach((x) => x.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const lr = await api("/api/admin/labels", { method: "POST", token, body: { person_id: id, label: x.dataset.unlabel, remove: true } });
    if (!lr.ok) { fail("外せませんでした（" + (lr.error || lr.status) + "）"); return; }
    detail(id);
  }));
  // 便 6b：面談の記録は開いたときだけ読む（表をまたいで探すので重い）
  $("meet-box").addEventListener("toggle", async () => {
    if (!$("meet-box").open || $("meet").dataset.loaded) return;
    const mr = await api(`/api/admin/people/${id}/meetings`, { token });
    $("meet").dataset.loaded = "1";
    if (!mr.ok) { $("meet").textContent = "読めませんでした（" + (mr.error || mr.status) + "）"; return; }
    if (!mr.count) { $("meet").textContent = `この人の行は見つかりませんでした（見た表：${(mr.looked || []).map((t) => t.table + " " + t.rows + " 行").join("・") || "なし"}）`; return; }
    $("meet").innerHTML = mr.records.map((x) => `<div class="card" style="margin-top:8px"><div class="reply-h">${esc(x.table)}</div><dl>${Object.entries(x.row).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd class="pre">${esc(typeof v === "object" ? JSON.stringify(v) : String(v))}</dd>`).join("")}</dl></div>`).join("");
  });
  $("deal").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const res = await api(`/api/admin/people/${id}/deal`, { method: "POST", token, body: { stage: $("d-stage").value, memo: $("d-memo").value, amount: $("d-amount").value.replace(/[^0-9]/g, "") || null } });
    if (!res.ok) { $("d-status").textContent = "進められませんでした（" + (res.error || res.status) + "）"; return; }
    await detail(id); search();
  });
  $("mail").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("m-status").textContent = "送っています…";
    const res = await api(`/api/admin/people/${id}/email`, { method: "POST", token, body: { subject: $("m-sub").value, body: $("m-body").value } });
    const why = { not_test_recipient: "テスト宛てではないので送りませんでした", unsubscribed: "配信を止めている人なので送りませんでした" };
    const msg = res.result === "sent" ? "送りました"
      : res.result === "blocked" ? (why[res.reason] || "送りませんでした") + "（記録には残しました）"
      : "送れませんでした（" + (res.error || res.status) + "）";
    await detail(id);
    $("mail").closest("details").open = true;
    $("m-status").textContent = msg;
  });
  $("nm").addEventListener("change", async (ev) => {
    const res = await api("/api/admin/people/" + id, { method: "PATCH", token, body: { note_member: ev.target.checked } });
    if (!res.ok) { ev.target.checked = !ev.target.checked; return fail("変えられませんでした（" + (res.error || res.status) + "）"); }
    detail(id); search();
  });
}

// ---------- 添削ルーム ----------
let currentRoom = null;
// 便 8c：左のメニュー。押した項目の画面だけを出し、上のナビにその名前を出す
const VIEWS = ["home", "blueprint", "people", "rooms", "deals", "ai", "products", "deliver", "settings"];
function openView(name) {
  const b = document.querySelector(`.side [data-view="${name}"]`);
  if (b) b.click();
}
function setupViews() {
  document.querySelectorAll(".side [data-view]").forEach((b) => b.addEventListener("click", () => {
    clearErr();
    document.querySelectorAll(".side [data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    for (const v of VIEWS) $("view-" + v).style.display = b.dataset.view === v ? "" : "none";
    $("view-people-wrap").style.display = b.dataset.view === "people" ? "" : "none";
    $("crumb").textContent = b.firstChild.textContent.trim();
    if (b.dataset.view === "home") loadHome();
    if (b.dataset.view === "blueprint") bp.load();
    if (b.dataset.view === "deliver") loadDeliver();
    if (b.dataset.view === "products") loadProducts();
    if (b.dataset.view === "deals") loadDeals();
    if (b.dataset.view === "ai") loadAi();
  }));
  $("only-unreplied").addEventListener("change", loadRooms);
}

async function loadRooms() {
  const r = await api("/api/admin/rooms" + ($("only-unreplied").checked ? "?only_unreplied=1" : ""), { token });
  if (!r.ok) { $("rooms-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  const badge = $("rooms-badge");
  badge.textContent = r.unreplied_total > 0 ? String(r.unreplied_total) : "";
  badge.classList.toggle("hidden", !(r.unreplied_total > 0));
  $("rooms-count").textContent = r.count === 0 ? "部屋は 0 件です" : `${r.count} 部屋・未返信 ${r.unreplied_total} 件`;
  $("rooms").innerHTML = r.rooms.map((x) => `
    <li data-id="${x.person_id}" ${x.person_id === currentRoom ? 'aria-current="true"' : ""}>
      <div style="min-width:0"><div>${esc(x.name || x.email)}</div><div class="sub ellip">${x.last_from === "cyanin" ? "返した：" : ""}${esc(x.last_text)}</div></div>
      <div style="text-align:right;flex-shrink:0">${x.unreplied > 0 ? `<span class="pill warn">未返信 ${x.unreplied}</span>` : x.unread_for_admin > 0 ? `<span class="pill warn">未読 ${x.unread_for_admin}</span>` : '<span class="pill gray">読んだ</span>'}<div class="sub">${fmtTime(x.last_at)}</div></div>
    </li>`).join("");
  document.querySelectorAll("#rooms li").forEach((li) => li.addEventListener("click", () => openRoom(li.dataset.id)));
}

async function openRoom(id, focusId) {
  currentRoom = id;
  document.querySelectorAll("#rooms li").forEach((li) => li.toggleAttribute("aria-current", li.dataset.id === id));
  const r = await api("/api/admin/rooms/" + id, { token });
  if (!r.ok || !r.found) { $("room-detail").innerHTML = '<p class="note">読めませんでした。</p>'; return; }
  const subs = Object.fromEntries(r.messages.filter((m) => m.from === "student" && m.kind !== "chat").map((m) => [m.id, m]));
  const target = focusId && subs[focusId] && !subs[focusId].replied ? subs[focusId] : subs[r.unreplied[0]];
  const block = (label, text) => `<div class="rb"><div class="rb-l">${label}</div><div class="rb-t">${esc(text) || '<span class="note">（なし）</span>'}</div></div>`;
  $("room-detail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(r.person.name || "（名前なし）")}</h2>
    <div class="note" style="margin-bottom:12px">${esc(r.person.email)}</div>
    <div class="room">${r.messages.map((m) => m.kind === "chat"
      ? (m.from === "student"
        ? `<div class="msg-them"><div class="bubble chat">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="生徒の画像">`).join("")}</div>` : ""}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time><span class="pill gray">メッセージ</span></div></div>`
        : `<div class="msg-me"><div class="bubble chat mine"><div class="pre">${esc(m.text)}</div></div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.actor === "mcp" ? '<span class="pill gray">AI から</span>' : ""}${m.read_by_student ? '<span class="pill gray">既読</span>' : ""}</div></div>`)
      : m.from === "student"
      ? `<div class="msg-them"><div class="bubble">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="生徒の画像">`).join("")}</div>` : ""}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.replied ? '<span class="pill gray">返信済み</span>' : `<button class="link" data-reply="${m.id}">${target && target.id === m.id ? "この投稿に返す（選択中）" : "この投稿に返す"}</button>`}</div></div>`
      : `<div class="msg-me"><div class="reply card"><div class="reply-h">返した添削${m.actor === "mcp" ? "（AI から）" : ""}</div>${correctionHtml(m)}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.read_by_student ? '<span class="pill gray">既読</span>' : ""}</div></div>`).join("") || '<p class="note">やりとりはまだありません。</p>'}</div>
    ${target ? `
    <form id="reply" class="stack reply-form">
      <h3>3 欄で返す</h3>
      <div><label for="r-orig">原文</label><textarea id="r-orig" rows="4">${esc(target.text)}</textarea></div>
      <div><label for="r-corr">添削後</label><textarea id="r-corr" rows="5">${esc(target.text)}</textarea></div>
      <div><label for="r-com">コメント</label><textarea id="r-com" rows="3" placeholder="どこを、なぜ直したか"></textarea></div>
      <details class="notes-edit" id="r-notes-box"><summary class="note">長文の指摘を足す（原文の範囲に番号を付けて、生徒の画面で左右に並べる）</summary>
        <p class="note">原文の欄で範囲を選んでから「選んだ部分を引用にする」を押すか、引用の欄に原文の一部をそのまま写してください。</p>
        <div id="r-notes"></div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn ghost small" type="button" id="r-quote">選んだ部分を引用にする</button><button class="btn ghost small" type="button" id="r-addnote">指摘を 1 つ足す</button></div>
      </details>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit" id="r-send">返す</button><span class="note" id="r-status"></span></div>
    </form>` : '<p class="note" style="margin-top:12px">この部屋に添削の未返信はありません。</p>'}
    <form id="chat" class="stack reply-form">
      <h3>メッセージを送る</h3>
      <label for="ch-text" class="sr">メッセージ</label><textarea id="ch-text" rows="3" maxlength="8000" placeholder="添削以外のやりとり（質問への答え・連絡など）"></textarea>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit" id="ch-send">送る</button><span class="note" id="ch-status"></span></div>
    </form>`;
  $("chat").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("ch-text").value.trim();
    if (!text) { $("ch-status").textContent = "メッセージを入れてください"; return; }
    $("ch-send").disabled = true;
    const res = await api(`/api/admin/rooms/${id}/message`, { method: "POST", token, body: { text } });
    if (!res.ok) { $("ch-send").disabled = false; $("ch-status").textContent = "送れませんでした（" + (res.error || res.status) + "）"; return; }
    await openRoom(id); if (current === id) detail(id);
  });
  $("room-detail").querySelectorAll("img[data-key]").forEach(async (img) => {
    try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), token); }
    catch (_) { img.alt = "画像を読めませんでした"; img.classList.add("broken"); }
  });
  $("room-detail").querySelectorAll("[data-reply]").forEach((b) => b.addEventListener("click", () => openRoom(id, Number(b.dataset.reply))));
  wireNotes($("room-detail"));
  if (target) {
    // 便 6a：長文の指摘の行（引用・指摘・外す）
    const addNote = (quote = "") => {
      const row = document.createElement("div");
      row.className = "nrow";
      row.innerHTML = `<textarea class="n-q" placeholder="引用（原文の一部）"></textarea><textarea class="n-t" placeholder="指摘"></textarea><button class="btn ghost small" type="button" aria-label="この指摘を外す">×</button>`;
      row.querySelector(".n-q").value = quote;
      row.querySelector("button").addEventListener("click", () => row.remove());
      $("r-notes").appendChild(row);
      $("r-notes-box").open = true;
      row.querySelector(quote ? ".n-t" : ".n-q").focus();
    };
    $("r-addnote").addEventListener("click", () => addNote());
    $("r-quote").addEventListener("click", () => {
      const ta = $("r-orig");
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (!sel) { $("r-status").textContent = "原文の欄で範囲を選んでから押してください"; return; }
      addNote(sel);
    });
  }
  if (target) $("reply").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$("r-corr").value.trim()) { $("r-status").textContent = "添削後を入れてください"; return; }
    $("r-send").disabled = true;
    const res = await api(`/api/admin/rooms/${id}/reply`, { method: "POST", token, body: {
      reply_to: target.id, original: $("r-orig").value, corrected: $("r-corr").value, comment: $("r-com").value,
      notes: [...document.querySelectorAll("#r-notes .nrow")].map((r) => ({ quote: r.querySelector(".n-q").value, text: r.querySelector(".n-t").value })),
    } });
    const why = { quote_not_in_original: "引用が原文に見つかりません", note_without_text: "指摘が空の行があります", too_many_notes: "指摘は 30 件までです" };
    if (!res.ok) { $("r-send").disabled = false; $("r-status").textContent = (why[res.error] ? why[res.error] + (res.index !== undefined ? `（上から ${res.index + 1} つ目）` : "") : "返せませんでした（" + (res.error || res.status) + "）"); return; }
    await openRoom(id); loadRooms(); if (current === id) detail(id);
  });
  loadRooms();
}

// ---------- 予約と商談（便 4） ----------
const STAGE = { booked: "相談予約", done: "面談済", won: "成約", lost: "失注", none: "" };
async function loadDeals() {
  const c = await api("/api/admin/consults", { token });
  if (!c.ok) { $("consults-count").textContent = "読めませんでした（" + (c.error || c.status) + "）"; }
  else {
    $("consults-count").textContent = c.count === 0 ? "これからの予約は 0 件です" : `これからの予約 ${c.count} 件`;
    $("consults").innerHTML = c.consults.map((x) => `
      <li data-id="${x.person_id}">
        <div style="min-width:0"><div>${esc(x.label)}　${esc(x.name || x.email)}</div><div class="sub ellip">${esc(x.topic || "（相談したいことは未記入）")}</div></div>
        <div style="text-align:right;flex-shrink:0"><span class="pill warn">${esc(STAGE[x.stage] || x.stage)}</span></div>
      </li>`).join("");
    document.querySelectorAll("#consults li").forEach((li) => li.addEventListener("click", () => {
      document.querySelector('[data-view="people"]').click();
      detail(li.dataset.id);
    }));
  }
  const s = await api("/api/admin/seminars", { token });
  if (!s.ok) { $("seminars").textContent = "読めませんでした"; return; }
  $("seminars").innerHTML = s.seminars.map((x) => `
    <div class="deal-box">
      <div class="note">${esc(x.label)}${x.past ? "・終了" : ""}</div>
      <h4>${esc(x.title)}</h4>
      <div class="note">申込 ${x.registrants} 人・前日の知らせ ${x.reminded} 人・アーカイブ ${x.archive_sent} 人</div>
      <div class="stage-btns" style="margin-top:8px">
        ${x.past ? `<button class="btn small" data-arc="${esc(x.id)}" type="button">アーカイブを配る</button>` : `<button class="btn ghost small" data-rem="${esc(x.id)}" type="button">前日の知らせを今送る（試し）</button>`}
      </div>
    </div>`).join("");
  const run = async (idv, kind) => {
    $("sem-status").textContent = "送っています…";
    const r = await api(`/api/admin/seminars/${idv}/${kind}`, { method: "POST", token });
    $("sem-status").textContent = r.ok ? `送った ${r.sent}・テスト宛てでないので送らなかった ${r.blocked}・失敗 ${r.failed}${r.skipped ? "・送り済み " + r.skipped : ""}` : "送れませんでした（" + (r.error || r.status) + "）";
    loadDeals();
  };
  document.querySelectorAll("[data-arc]").forEach((b) => b.addEventListener("click", () => run(b.dataset.arc, "archive")));
  document.querySelectorAll("[data-rem]").forEach((b) => b.addEventListener("click", () => run(b.dataset.rem, "remind")));
}

// ---------- B の便 3：AI と承認 ----------
const MODE_LABEL = { auto: "自動", approve: "承認", deny: "禁止" };
const AP_LABEL = { pending: "承認待ち", approved: "承認して実行した", rejected: "却下した", expired: "期限切れ", failed: "実行に失敗" };

async function loadApprovalBadge() {
  const r = await api("/api/admin/approvals?status=pending", { token });
  const n = r.ok ? r.count : 0;
  $("ai-badge").textContent = n > 0 ? String(n) : "";
  $("ai-badge").classList.toggle("hidden", !(n > 0));
}

async function loadAi() {
  const focus = location.hash.startsWith("#approval/") ? location.hash.slice(10) : "";
  const r = await api("/api/admin/approvals?status=all", { token });
  if (!r.ok) { $("ap-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; }
  else {
    const pending = r.approvals.filter((x) => x.status === "pending");
    $("ap-count").textContent = pending.length === 0 ? "承認待ちは 0 件です" : `承認待ち ${pending.length} 件（頼まれてから 24 時間で期限切れ）`;
    $("approvals").innerHTML = r.approvals.slice(0, 20).map((x) => `
      <div class="deal-box" ${x.id === focus ? 'style="outline:2px solid var(--accent)"' : ""}>
        <div class="note">${fmtTime(x.created_at)}・AI が頼んだ・<span class="pill ${x.status === "pending" ? "warn" : "gray"}">${esc(AP_LABEL[x.status] || x.status)}</span></div>
        <h4 style="margin:4px 0">${esc(x.tool)}</h4>
        <pre class="note" style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(x.args, null, 2))}</pre>
        ${x.status === "pending" ? `<div class="stage-btns" style="margin-top:8px">
          <button class="btn small" data-ap="${x.id}" data-d="approve" type="button">承認して実行</button>
          <button class="btn ghost small" data-ap="${x.id}" data-d="reject" type="button">却下</button></div>`
        : (x.decided_by ? `<div class="note">${esc(x.decided_by)}・${fmtTime(x.decided_at)}</div>` : "")}
      </div>`).join("");
    document.querySelectorAll("[data-ap]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const d = await api(`/api/admin/approvals/${b.dataset.ap}`, { method: "POST", token, body: { decision: b.dataset.d } });
      if (!d.ok) fail("できませんでした（" + (d.error || d.status) + "）");
      loadAi(); loadApprovalBadge();
    }));
  }
  const p = await api("/api/admin/permissions", { token });
  if (p.ok) {
    $("perms").innerHTML = p.permissions.map((x) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="min-width:0"><div>${esc(x.tool)}</div><div class="sub">${esc(x.note || "")}</div></div>
        <select data-tool="${esc(x.tool)}" style="min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)">
          ${["auto", "approve", "deny"].map((m) => `<option value="${m}" ${m === x.mode ? "selected" : ""}>${MODE_LABEL[m]}</option>`).join("")}
        </select>
      </div>`).join("") || '<p class="note">権限の表がまだありません</p>';
    document.querySelectorAll("[data-tool]").forEach((sel) => sel.addEventListener("change", async () => {
      const r2 = await api("/api/admin/permissions", { method: "POST", token, body: { tool: sel.dataset.tool, mode: sel.value } });
      if (!r2.ok) fail("変えられませんでした（" + (r2.error || r2.status) + "）");
      loadAi();
    }));
  }
  const l = await api("/api/admin/ai-log", { token });
  if (l.ok) {
    $("ailog").innerHTML = l.items.slice(0, 50).map((x) => {
      const q = x.request || {};
      const what = x.channel === "mcp" ? `AI：${q.tool || ""}${q.approved_by ? "（承認して実行）" : ""}`
        : x.channel === "approval" ? `承認：${q.action === "requested" ? "頼まれた" : q.action === "approve" ? "承認した" : "却下した"}・${q.tool || ""}`
        : `権限：${q.tool || ""} を ${MODE_LABEL[q.from] || "なし"} → ${MODE_LABEL[q.to] || q.to}`;
      return `<li><div style="min-width:0"><div>${esc(what)}</div><div class="sub">${esc(q.by || q.approved_by || (x.channel === "mcp" ? "AI" : ""))}</div></div>
        <div class="sub" style="flex-shrink:0">${fmtTime(x.at)}${x.status >= 400 ? "・失敗" : ""}</div></li>`;
    }).join("") || '<li class="note">まだありません</li>';
  }
}

// ---------- 配信（B の便 5） ----------
const BC_LABEL = { draft: "下書き", queued: "送る列", sending: "送っている", done: "送り終えた", canceled: "止めた" };
let stepsCache = [];
function bfFilter() {
  const f = {};
  const src = [...document.querySelectorAll("#bf-src input:checked")].map((x) => x.value);
  if (src.length) f.source = src;
  const bought = $("bf-bought").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (bought.length) f.purchased = bought;
  if ($("bf-member").value) f.member = $("bf-member").value === "true";
  const emails = $("bf-emails").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (emails.length) f.emails = emails;
  const labels = splitList($("bf-labels").value), notLabels = splitList($("bf-nolabels").value);
  if (labels.length) f.labels = labels;
  if (notLabels.length) f.not_labels = notLabels;
  return f;
}
const splitList = (v) => String(v || "").split(/[,、]/).map((x) => x.trim()).filter(Boolean);
let triggerNames = {}, actionNames = {};
function showConnectorFields() {
  const tr = $("sf-trigger").value, ac = $("sf-action").value;
  document.querySelectorAll("[data-tr]").forEach((x) => x.classList.toggle("hidden", x.dataset.tr !== tr));
  document.querySelectorAll("[data-ac]").forEach((x) => x.classList.toggle("hidden", !x.dataset.ac.split(" ").includes(ac)));
}
function connectorText(s) {
  const ta = s.trigger_args || {};
  const when = (triggerNames[s.trigger] || s.trigger) + (s.product_id ? "（" + s.product_id + "）" : "") + (ta.label ? "「" + ta.label + "」" : "") + (ta.url ? "（" + String(ta.url).slice(0, 30) + "）" : "") + (s.delay_hours ? `・${s.delay_hours} 時間後` : "");
  const who = filterText(s.selector || {});
  const what = (actionNames[s.action] || s.action) + (s.action === "add_label" && s.action_args && s.action_args.label ? "「" + s.action_args.label + "」" : "");
  return { when, who, what };
}
function filterText(f) {
  const parts = [];
  if (f.source) parts.push("流入元 " + f.source.map((x) => SOURCE_LABEL[x] || x).join("・"));
  if (f.purchased) parts.push("買った " + f.purchased.join("・"));
  if ("member" in f) parts.push(f.member ? "会員だけ" : "会員でない人");
  if (f.emails) parts.push("メール指定 " + f.emails.length + " 件");
  if (f.labels) parts.push("ラベル " + f.labels.join("・"));
  if (f.not_labels) parts.push("ラベルなし " + f.not_labels.join("・"));
  return parts.join("／") || "全員";
}
let deliverReady = false;
async function loadDeliver() {
  if (!deliverReady) {
    deliverReady = true;
    $("bf-src").innerHTML = ["x", "note", "youtube", "direct", "other"].map((s) => `<label class="check" style="margin:0"><input type="checkbox" value="${s}"> <span>${esc(SOURCE_LABEL[s] || s)}</span></label>`).join("");
    $("bf-count").addEventListener("click", async () => {
      const r = await api("/api/admin/audience", { method: "POST", token, body: { filter: bfFilter() } });
      $("bf-status").textContent = r.ok ? `宛先 ${r.count} 人（配信を止めている人 ${r.unsubscribed}）${r.open_to_all ? "" : "・いまはテスト宛てにだけ届く"}` : "数えられませんでした（" + (r.error || r.status) + "）";
    });
    $("bf").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const r = await api("/api/admin/broadcasts", { method: "POST", token, body: { subject: $("bf-subject").value, body: $("bf-body").value, filter: bfFilter() } });
      $("bf-status").textContent = r.ok ? `下書きにしました（宛先 ${r.audience.count} 人）。下の一覧の「送る」で送ります` : "保存できませんでした（" + (r.error || r.status) + "）";
      if (r.ok) loadDeliver();
    });
    $("dv-run").addEventListener("click", async () => {
      $("dv-run").disabled = true;
      const r = await api("/api/admin/deliver/run", { method: "POST", token });
      $("dv-run").disabled = false;
      $("dv-run-status").textContent = r.ok ? `コネクタ：送った ${r.steps.sent}・知らせた ${r.steps.notified || 0}・ラベル ${r.steps.labeled || 0}・条件外 ${r.steps.skipped || 0}・送らなかった ${r.steps.blocked}・失敗 ${r.steps.failed}／一斉：送った ${r.broadcasts.sent}・送らなかった ${r.broadcasts.blocked}・失敗 ${r.broadcasts.failed}` : "動かせませんでした（" + (r.error || r.status) + "）";
      loadDeliver();
    });
    $("sf").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const tr = $("sf-trigger").value, ac = $("sf-action").value;
      const selector = {};
      const sl = splitList($("sf-labels").value), sn = splitList($("sf-nolabels").value);
      if (sl.length) selector.labels = sl;
      if (sn.length) selector.not_labels = sn;
      const body = {
        name: $("sf-name").value, trigger: tr, product_id: tr === "purchase" ? ($("sf-product").value.trim() || null) : null,
        trigger_args: tr === "label_added" ? { label: $("sf-tlabel").value.trim() } : tr === "clicked" && $("sf-turl").value.trim() ? { url: $("sf-turl").value.trim() } : {},
        delay_hours: Number($("sf-delay").value.replace(/[^0-9]/g, "") || 0), selector,
        action: ac, action_args: ac === "add_label" ? { label: $("sf-alabel").value.trim() } : {},
        subject: $("sf-subject").value, body: $("sf-body").value,
        active: $("sf-active").checked,
      };
      if ($("sf-id").value) body.id = Number($("sf-id").value);
      const r = await api("/api/admin/steps", { method: "POST", token, body });
      $("sf-status").textContent = r.ok ? "保存しました" : "保存できませんでした（" + (r.error || r.status) + "）";
      if (r.ok) { $("sf-id").value = r.step.id; loadDeliver(); }
    });
    $("sf-new").addEventListener("click", () => { $("sf").reset(); $("sf-id").value = ""; $("sf-status").textContent = ""; showConnectorFields(); });
    $("sf-trigger").addEventListener("change", showConnectorFields);
    $("sf-action").addEventListener("change", showConnectorFields);
  }
  const r = await api("/api/admin/deliver", { token });
  if (!r.ok) { $("dv-warm").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  $("dv-warm").textContent = (r.warm ? `今日の上限 ${r.warm.cap} 通（送り始めて ${r.warm.day + 1} 日目・今日 ${r.warm.sent_today} 通）` : "デモの置き場") + (r.open_to_all ? "" : "・いまはテスト宛てにだけ届く");
  $("broadcasts").innerHTML = r.broadcasts.map((b) => `
    <div class="deal-box">
      <div class="note">${fmtTime(b.created_at)}・<span class="pill ${b.status === "draft" ? "gray" : "warn"}">${esc(BC_LABEL[b.status] || b.status)}</span>・${esc(filterText(b.filter || {}))}</div>
      <h4 style="margin:4px 0">${esc(b.subject)}</h4>
      <div class="note">宛先 ${b.target_count ?? "-"}・送った ${b.sent}・送らなかった ${b.blocked}・失敗 ${b.failed}・リンクを押した ${b.clicked_people} 人（${b.clicks} 回）</div>
      <div class="stage-btns" style="margin-top:6px">
        ${b.status === "draft" ? `<button class="btn small" data-bq="${b.id}" type="button">送る</button>` : ""}
        ${["draft", "queued", "sending"].includes(b.status) ? `<button class="btn ghost small" data-bc="${b.id}" type="button">止める</button>` : ""}
      </div>
    </div>`).join("") || '<p class="note">まだありません</p>';
  document.querySelectorAll("[data-bq]").forEach((x) => x.addEventListener("click", async () => {
    if (!confirm("この一斉配信を送る列に入れます。毎時の定時の処理で、今日の上限の中から送ります。")) return;
    const q = await api(`/api/admin/broadcasts/${x.dataset.bq}/queue`, { method: "POST", token });
    if (!q.ok) fail("送る列に入れられませんでした（" + (q.error || q.status) + "）");
    loadDeliver();
  }));
  document.querySelectorAll("[data-bc]").forEach((x) => x.addEventListener("click", async () => {
    const q = await api(`/api/admin/broadcasts/${x.dataset.bc}/cancel`, { method: "POST", token });
    if (!q.ok) fail("止められませんでした（" + (q.error || q.status) + "）");
    loadDeliver();
  }));
  stepsCache = r.steps;
  if (r.triggers && !$("sf-trigger").options.length) {
    triggerNames = r.triggers; actionNames = r.actions || {};
    $("sf-trigger").innerHTML = Object.entries(triggerNames).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    $("sf-action").innerHTML = Object.entries(actionNames).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    showConnectorFields();
  }
  loadLabelNames();
  $("steps").innerHTML = r.steps.map((s) => {
    const c = connectorText(s);
    const result = s.action === "notify_admin" ? `知らせた ${s.notified || 0}` : s.action === "add_label" ? `付けた ${s.labeled || 0}` : `送った ${s.sent}・リンクを押した ${s.clicks} 回`;
    return `
    <div class="deal-box" data-step="${s.id}" style="cursor:pointer">
      <div class="note">${s.active ? '<span class="pill">動いている</span>' : '<span class="pill gray">止めている</span>'}</div>
      <h4 style="margin:4px 0">${esc(s.name)}</h4>
      <div class="note"><b>${esc(c.when)}</b> → ${esc(c.who)} → <b>${esc(c.what)}</b></div>
      <div class="note">${result}${s.skipped ? `・条件に当たらなかった ${s.skipped}` : ""}</div>
    </div>`;
  }).join("") || '<p class="note">まだありません</p>';
  document.querySelectorAll("[data-step]").forEach((x) => x.addEventListener("click", () => {
    const s = stepsCache.find((y) => String(y.id) === x.dataset.step);
    const ta = s.trigger_args || {}, sel = s.selector || {};
    $("sf-id").value = s.id; $("sf-name").value = s.name; $("sf-trigger").value = s.trigger; $("sf-product").value = s.product_id || "";
    $("sf-tlabel").value = ta.label || ""; $("sf-turl").value = ta.url || "";
    $("sf-labels").value = (sel.labels || []).join(","); $("sf-nolabels").value = (sel.not_labels || []).join(",");
    $("sf-action").value = s.action || "send_email"; $("sf-alabel").value = (s.action_args || {}).label || "";
    $("sf-delay").value = s.delay_hours; $("sf-subject").value = s.subject; $("sf-body").value = s.body; $("sf-active").checked = s.active;
    $("sf-status").textContent = "直しています：" + s.name;
    showConnectorFields();
  }));
}

// 便 8e：ラベルの名前の候補（入力欄の下に出す）
let labelNamesAt = 0;
async function loadLabelNames() {
  if (Date.now() - labelNamesAt < 60e3) return;
  labelNamesAt = Date.now();
  const r = await api("/api/admin/labels", { token });
  if (!r.ok) return;
  $("label-names").innerHTML = r.labels.map((x) => `<option value="${esc(x.label)}">${x.people} 人${x.auto ? "" : "・手"}</option>`).join("");
}

// ---------- 商品（B の便 4） ----------
const KIND_LABEL = { one_time: "単発", subscription: "定期", installment: "分割" };
let productsCache = [];
function priceOf(p) {
  const yen = Number(p.amount).toLocaleString() + " 円";
  if (p.kind === "subscription") return (p.period === "annually" ? "年 " : "月 ") + yen;
  if (p.kind === "installment") return yen + " × " + p.installments + " 回";
  return yen + (p.grant_days ? "（" + p.grant_days + " 日）" : "");
}
async function loadProducts(focusId) {
  const r = await api("/api/admin/products", { token });
  if (!r.ok) { $("pr-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  productsCache = r.products;
  const sellable = r.products.filter((p) => p.active).length, shown = r.products.filter((p) => p.public).length;
  $("pr-count").textContent = `${r.count} 件・売っている ${sellable}・サイトに出している ${shown}${r.store === "demo" ? "（デモの置き場：見本だけ）" : ""}`;
  $("products").innerHTML = r.products.map((p) => `
    <li data-pid="${esc(p.id)}"><div style="min-width:0"><div>${esc(p.name)}</div><div class="sub">${esc(KIND_LABEL[p.kind] || p.kind)}・${esc(priceOf(p))}・売れた ${p.sold}</div></div>
      <div style="flex-shrink:0;display:flex;gap:4px">${p.active ? '<span class="pill">売る</span>' : '<span class="pill gray">売らない</span>'}${p.public ? '<span class="pill">サイト</span>' : ""}</div></li>`).join("");
  document.querySelectorAll("#products li").forEach((li) => li.addEventListener("click", () => productDetail(li.dataset.pid)));
  if (focusId) productDetail(focusId);
}
function productDetail(id) {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  document.querySelectorAll("#products li").forEach((li) => li.toggleAttribute("aria-current", li.dataset.pid === id));
  const link = location.origin + "/register?product=" + encodeURIComponent(p.id);
  const ro = p.kind === "installment" ? "disabled" : "";
  $("product-detail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(p.name)}</h2>
    <div class="note">${esc(p.id)}・${esc(KIND_LABEL[p.kind] || p.kind)}・売れた ${p.sold}${p.list_price_of ? "・紹介用（元：" + esc(p.list_price_of) + "）" : ""}</div>
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}
    <form id="pf" class="stack" style="margin-top:12px">
      <div><label for="pf-name">名前</label><input id="pf-name" type="text" maxlength="120" value="${esc(p.name)}"></div>
      <div><label for="pf-amount">金額（円）</label><input id="pf-amount" type="text" inputmode="numeric" value="${p.amount}"></div>
      ${p.kind === "subscription" ? `<div><label for="pf-period">周期</label><select id="pf-period" class="inline"><option value="monthly" ${p.period === "monthly" ? "selected" : ""}>毎月</option><option value="annually" ${p.period === "annually" ? "selected" : ""}>毎年</option></select></div>` : ""}
      ${p.kind === "one_time" ? `<div><label for="pf-days">権利の日数（空なら期限なし）</label><input id="pf-days" type="text" inputmode="numeric" value="${p.grant_days ?? ""}"></div>` : ""}
      <div><label for="pf-limit">販売数の上限（空なら無し）</label><input id="pf-limit" type="text" inputmode="numeric" value="${p.sales_limit ?? ""}"></div>
      <div><label for="pf-grants">権利の印（カンマ区切り。例 shiarabo_basic）</label><input id="pf-grants" type="text" value="${esc((p.grants || []).join(","))}"></div>
      <div><label for="pf-desc">説明（生徒に見える）</label><textarea id="pf-desc" rows="2">${esc(p.description || "")}</textarea></div>
      <label class="check"><input type="checkbox" id="pf-multi" ${p.deny_multiple ? "checked" : ""}> <span>重ねて買えない</span></label>
      <label class="check"><input type="checkbox" id="pf-active" ${p.active ? "checked" : ""} ${ro}> <span>売る</span></label>
      <label class="check"><input type="checkbox" id="pf-public" ${p.public ? "checked" : ""} ${ro}> <span>サイトの一覧に出す（出さなくても、下のリンクを渡した人は買える）</span></label>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit" ${ro}>変える</button><span class="note" id="pf-status"></span></div>
    </form>
    <h4 style="margin-top:16px">申し込みのリンク</h4>
    <p class="note" style="word-break:break-all;margin:0"><code>${esc(link)}</code></p>
    <button class="btn ghost small" id="pf-copy" type="button" style="margin-top:8px">リンクを写す</button>`;
  $("pf-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); $("pf-copy").textContent = "写しました"; } catch (_) { $("pf-copy").textContent = "写せませんでした"; } });
  $("pf").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const num = (v) => { const t = String(v || "").replace(/[^0-9]/g, ""); return t ? Number(t) : null; };
    const body = {
      id: p.id, name: $("pf-name").value, amount: num($("pf-amount").value),
      sales_limit: num($("pf-limit").value), description: $("pf-desc").value,
      grants: $("pf-grants").value.split(",").map((x) => x.trim()).filter(Boolean),
      deny_multiple: $("pf-multi").checked, active: $("pf-active").checked, public: $("pf-public").checked,
    };
    if ($("pf-period")) body.period = $("pf-period").value;
    if ($("pf-days")) body.grant_days = num($("pf-days").value);
    $("pf-status").textContent = "変えています…";
    const r = await api("/api/admin/products", { method: "POST", token, body });
    if (!r.ok) { $("pf-status").textContent = "変えられませんでした（" + (r.error || r.status) + "）"; return; }
    await loadProducts(p.id);
    $("pf-status").textContent = r.changed && Object.keys(r.changed).length ? "変えました：" + Object.keys(r.changed).join("・") : "変わったところはありません";
  });
}

// 便 7a：オプチャの招待リンク。表 b_settings の 1 行を読み、差し替える（AI の set_community_link と同じ処理）
function communityStatus(r) {
  if (!r.url) return "いまはリンクが入っていません（会員の画面は「準備中」）";
  const when = r.updated_at ? new Date(r.updated_at).toLocaleString("ja-JP") : "";
  return "会員にだけ見えています" + (when ? "。最後に変えたのは " + esc(when) + (r.updated_by ? "（" + esc(r.updated_by) + "）" : "") : "");
}
async function loadCommunity() {
  const r = await api("/api/admin/community", { token });
  if (!r.ok) { $("cm-status").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  $("cm-url").value = r.url || "";
  $("cm-status").innerHTML = communityStatus(r);
}
function setupCommunity() {
  const save = async (url) => {
    $("cm-status").textContent = "変えています…";
    const r = await api("/api/admin/community", { method: "PUT", token, body: { url } });
    if (!r.ok) { $("cm-status").textContent = r.error === "bad_url" ? "https:// で始まるリンクを入れてください" : "変えられませんでした（" + (r.error || r.status) + "）"; return; }
    $("cm-url").value = r.url || "";
    $("cm-status").innerHTML = (r.changed ? (r.cleared ? "外しました。" : "差し替えました。") : "前と同じリンクです。") + communityStatus(r);
  };
  $("cm-save").addEventListener("click", () => save($("cm-url").value));
  $("cm-clear").addEventListener("click", () => { if (confirm("招待リンクを外します。会員の画面からも消えます。")) save(""); });
  loadCommunity();
}

// ---------- 便 8f-1：ホームの今日の 1 枚と段階のボード ----------
const fmtHm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const TOOL_LABEL = { apply_tidy: "片付け案を当てる", add_label: "ラベルを付ける", remove_label: "ラベルを外す", set_step: "コネクタを変える", queue_broadcast: "一斉配信を送る", set_mail_settings: "メールの送り方を変える", set_community_link: "オプチャのリンクを変える", set_calendar_url: "カレンダーを変える", return_correction: "添削を返す", send_email: "メールを送る", send_chat: "メッセージを送る" };
async function loadHome() {
  const [r, b] = await Promise.all([api("/api/admin/today", { token }), api("/api/admin/board", { token })]);
  if (!r.ok) { $("hm-cal").textContent = "読めませんでした（" + (r.error || r.status) + "）"; $("hm-todo").textContent = ""; }
  else {
    $("hm-day").textContent = r.day;
    const c = r.calendar;
    $("hm-cal").innerHTML = c.state === "unset"
      ? `カレンダーがまだつながっていません。<a href="#" id="hm-cal-set">決済・メール・オプチャ</a> の「Google カレンダー」に非公開 URL を貼ると、ここに今日の予定が出ます`
      : c.state === "error" ? `カレンダーを読めませんでした（${esc(c.error)}）`
      : (c.events.length ? `<ul class="home-list">${c.events.map((e) => `<li><span class="tm">${e.all_day ? "終日" : esc(fmtHm(e.start)) + "–" + esc(fmtHm(e.end))}</span><span>${e.source === "utage" ? `<span class="src-tag">UTAGE</span>` : ""}${esc(e.title)}${e.location ? `<span class="sub">${esc(e.location)}</span>` : ""}</span></li>`).join("")}</ul>` : "今日の予定はありません")
        + (c.sources || []).filter((x) => x.state === "error").map((x) => `<p class="note">${esc(x.label)}を読めませんでした（${esc(x.error)}）</p>`).join("")
        + (c.sources || []).filter((x) => x.state === "unset").map((x) => `<p class="note">${esc(x.label)}はまだつながっていません</p>`).join("")
        + (c.not_expanded ? `<p class="note">広げられない繰り返しの予定が ${c.not_expanded} 件あります（${esc((c.not_expanded_shapes || []).join("・"))}）</p>` : "");
    const a = $("hm-cal-set"); if (a) a.addEventListener("click", (ev) => { ev.preventDefault(); openView("settings"); $("calendar-box").open = true; });
    const t = r.todo;
    const row = (n, label, view, items) => `<li class="todo"><button type="button" class="todo-h" data-open="${view}"><b>${n}</b> ${label}</button>${items}</li>`;
    $("hm-todo").innerHTML = `<ul class="home-list">`
      + row(t.approvals.count, "承認待ち", "ai", t.approvals.items.length ? `<span class="sub">${t.approvals.items.map((x) => esc(TOOL_LABEL[x.tool] || x.tool)).join("・")}</span>` : "")
      + row(t.rooms.count, "未返信の添削", "rooms", t.rooms.items.length ? `<span class="sub">${t.rooms.items.map((x) => esc(x.name)).join("・")}</span>` : "")
      + row(t.consults.count, "今日の個別相談", "deals", t.consults.items.length ? `<span class="sub">${t.consults.items.map((x) => esc(fmtHm(x.slot)) + " " + esc(x.name)).join("・")}</span>` : "")
      + row(t.notices.count, "今日の知らせ", "deliver", t.notices.items.length ? `<span class="sub">${t.notices.items.map((x) => esc(x.connector) + "：" + esc(x.name)).join("・")}</span>` : "")
      + `</ul>`;
    document.querySelectorAll("#hm-todo [data-open]").forEach((x) => x.addEventListener("click", () => openView(x.dataset.open)));
    // 便 8f-2：タスクマスターの今日の分（期限が今日・過ぎている未完了）。中身は shia2n-mcp から読む
    const k = r.tasks || { state: "unset" };
    const PRI = { high: "高", medium: "中", low: "低" };
    const taskLi = (x, late) => `<li><span class="tm">${late ? esc(x.deadline || "") : PRI[x.priority] || ""}</span><span>${esc(x.title)}${x.project ? `<span class="sub">${esc(x.project)}</span>` : ""}</span></li>`;
    $("hm-task-n").textContent = k.state === "ok" ? `今日 ${k.due_count} 件・過ぎている ${k.overdue_count} 件` : "";
    $("hm-tasks").innerHTML = k.state === "unset" ? "タスクマスターとまだつながっていません"
      : k.state === "error" ? `タスクマスターを読めませんでした（${esc(k.error)}）`
      : (k.due.length ? `<ul class="home-list">${k.due.map((x) => taskLi(x, false)).join("")}</ul>` : "期限が今日のタスクはありません")
        + (k.overdue.length ? `<details class="tasks-late"><summary>期限が過ぎている ${k.overdue_count} 件</summary><ul class="home-list">${k.overdue.map((x) => taskLi(x, true)).join("")}</ul></details>` : "")
        + (k.due_count > k.due.length ? `<p class="note">ほか ${k.due_count - k.due.length} 件はタスクマスターで</p>` : "");
  }
  if (!b.ok) { $("hm-board").innerHTML = `<p class="note">読めませんでした（${esc(b.error || b.status)}）</p>`; return; }
  $("hm-total").textContent = `${b.total} 人`;
  $("hm-board").innerHTML = b.lanes.map((l) => `<div class="stage-col"><h4>${esc(l.label)} <span class="n">${l.count}</span></h4>${l.people.map((p) => `<button type="button" class="stage-card" data-person="${p.id}"><span class="nm">${esc(p.name || p.email)}</span>${p.name ? `<span class="sub">${esc(p.email)}</span>` : ""}</button>`).join("") || `<p class="note">${l.id === "meet" ? "まだ登録していない人は記録が無い" : l.id === "refer" ? "紹介は 8g で足す" : "0 人"}</p>`}</div>`).join("");
  document.querySelectorAll("#hm-board [data-person]").forEach((x) => x.addEventListener("click", () => { openView("people"); detail(x.dataset.person); }));
}
async function loadCalendar() {
  const r = await api("/api/admin/calendar", { token });
  for (const w of ["main", "utage"]) {
    const st = $("cal-status-" + w);
    if (!r.ok) { st.textContent = "読めませんでした（" + (r.error || r.status) + "）"; continue; }
    const c = (r.calendars || []).find((x) => x.which === w) || {};
    $("cal-url-" + w).value = "";
    st.textContent = c.set ? `つながっています（${c.shown}）` + (c.updated_at ? "。最後に変えたのは " + new Date(c.updated_at).toLocaleString("ja-JP") : "") : "まだつながっていません";
  }
}
function setupCalendar() {
  const ERR = { bad_url: "「iCal 形式の非公開アドレス」（https://calendar.google.com/calendar/ical/ で始まり .ics で終わる）を貼ってください" };
  const save = async (which, url) => {
    const st = $("cal-status-" + which);
    st.textContent = "変えています…";
    const r = await api("/api/admin/calendar", { method: "PUT", token, body: { url, which } });
    if (!r.ok) { st.textContent = ERR[r.error] || r.note || "変えられませんでした（" + (r.error || r.status) + "）"; return; }
    await loadCalendar();
  };
  document.querySelectorAll("[data-cal-save]").forEach((b) => b.addEventListener("click", () => save(b.dataset.calSave, $("cal-url-" + b.dataset.calSave).value.trim())));
  document.querySelectorAll("[data-cal-clear]").forEach((b) => b.addEventListener("click", () => { if (confirm("このカレンダーを外します。ホームにこのカレンダーの予定が出なくなります。")) save(b.dataset.calClear, ""); }));
  loadCalendar();
}

// 便 7c-1：メールの送り方。表 b_settings の 4 行を読み、変える（AI の set_mail_settings と同じ処理）
const SCOPE_LABEL = { test: "テスト宛てだけ", login: "ログインと手続きは誰にでも・お知らせはテスト宛てだけ", all: "お知らせも誰にでも" };
function mailStatus(m) {
  const when = m.updated_at ? new Date(m.updated_at).toLocaleString("ja-JP") : "";
  return "いま：" + esc(SCOPE_LABEL[m.scope] || m.scope) + "。送り元 " + (m.from ? "<code>" + esc(m.from) + "</code>" : "まだ")
    + (m.reply_to ? "・返信先 <code>" + esc(m.reply_to) + "</code>" : "・返信先なし")
    + (when ? "。最後に変えたのは " + esc(when) + (m.updated_by ? "（" + esc(m.updated_by) + "）" : "") : "");
}
let mailShown = null; // 画面に出した値。保存のときは、ここから変えた欄だけを送る
function fillMail(m) {
  mailShown = { from: m.from || "", from_name: m.from_name || "", reply_to: m.reply_to || "", scope: m.scope || "test" };
  $("ml-from").value = mailShown.from; $("ml-name").value = mailShown.from_name; $("ml-reply").value = mailShown.reply_to; $("ml-scope").value = mailShown.scope;
  $("ml-status").innerHTML = mailStatus(m);
}
// 便 7c-1 の続き：承認や AI で値が変わっても、開いたままの欄は古いまま。開き直したとき・画面に戻ったときに読み直す
async function reloadMail() {
  const r = await api("/api/admin/mail", { token });
  if (!r.ok) { $("ml-status").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  fillMail(r.settings);
}
function setupMail() {
  reloadMail();
  $("mail-box").addEventListener("toggle", () => { if ($("mail-box").open) reloadMail(); });
  window.addEventListener("focus", () => { if ($("mail-box").open) reloadMail(); });
  $("ml-save").addEventListener("click", async () => {
    const scope = $("ml-scope").value;
    const now = { from: $("ml-from").value.trim(), from_name: $("ml-name").value.trim(), reply_to: $("ml-reply").value.trim(), scope };
    const body = {};
    for (const k of Object.keys(now)) if (!mailShown || now[k] !== mailShown[k]) body[k] = now[k];
    if (!Object.keys(body).length) { $("ml-status").innerHTML = "前と同じです。" + mailStatus({ ...mailShown }); return; }
    if (body.scope === "all" && !confirm("お知らせ（一斉配信・ステップ）を誰にでも送る形にします。")) return;
    $("ml-status").textContent = "保存しています…";
    const r = await api("/api/admin/mail", { method: "PUT", token, body });
    const why = { sender_domain_not_allowed: "送り元は mail.shia2n.jp か demo.shia2n.jp の住所にしてください", bad_from: "送り元のメールの形が違います", bad_reply_to: "返信先のメールの形が違います", bad_from_name: "表示名は 40 文字まで、< > \" は使えません" };
    if (!r.ok) { $("ml-status").textContent = why[r.error] || "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    fillMail(r.settings);
    $("ml-status").innerHTML = (r.changed.length ? "保存しました。" : "前と同じです。") + mailStatus(r.settings);
  });
}

// ---------- スマホの通知（便 8f-3） ----------
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const pushDevice = () => {
  const ua = navigator.userAgent;
  const os = /iphone|ipad|ipod/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "端末";
  const br = /edg[/]/i.test(ua) ? "Edge" : /crios|chrome[/]/i.test(ua) ? "Chrome" : /fxios|firefox[/]/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
  const app = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "・ホーム画面" : "";
  return `${os}${br ? " " + br : ""}${app}`;
};
const keyBytes = (b64) => { const t = b64.replace(/-/g, "+").replace(/_/g, "/"); const s = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
// 画面の裏の仕組み（sw.js）が 5 秒で用意できなければ、使えないものとして扱う（「読み込んでいます」のまま止まらないため）
async function pushSub() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("sw_not_ready")), 5000))]);
  return { reg, sub: await reg.pushManager.getSubscription() };
}
async function loadPush() {
  const st = $("push-status");
  const r = await api("/api/admin/push", { token });
  if (!r.ok) { st.textContent = "読めませんでした（" + (r.error || r.status) + "）"; return null; }
  let here = "この端末では使えません（ブラウザが通知に対応していない）";
  if (pushSupported()) {
    const ps = await pushSub().catch(() => null);
    const sub = ps && ps.sub;
    const on = sub && r.devices.some((d) => sub.endpoint.endsWith(d.endpoint_tail));
    here = !ps ? "この端末では通知の準備ができませんでした（画面を開き直すと直ることがあります）" : on ? "この端末は受け取っています" : Notification.permission === "denied" ? "この端末は通知を止めています（端末の設定で Lab OS の通知を許可すると押せます）" : "この端末はまだ受け取っていません";
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) {
    here = "iPhone は、共有ボタン →「ホーム画面に追加」で Lab OS を足し、そこから開くと押せます";
  }
  st.innerHTML = `${esc(here)}<br>受け取る端末 ${r.count} 台${r.devices.length ? "：" + r.devices.map((d) => esc(d.device || d.service)).join("・") : ""}`;
  return r;
}
function setupPush() {
  loadPush();
  $("push-on").addEventListener("click", async () => {
    clearErr();
    if (!pushSupported()) return loadPush();
    const r = await api("/api/admin/push", { token });
    if (!r.ok) return fail("鍵を読めませんでした（" + (r.error || r.status) + "）");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { $("push-status").textContent = "許可されなかったので受け取れません"; return; }
    const ps = await pushSub().catch(() => null);
    if (!ps) return loadPush();
    const { reg, sub: old } = ps;
    let sub = old;
    if (sub && sub.options && sub.options.applicationServerKey) {
      const k = new Uint8Array(sub.options.applicationServerKey);
      if (k.join() !== keyBytes(r.public_key).join()) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(r.public_key) });
    const j = sub.toJSON();
    const res = await api("/api/admin/push", { method: "POST", token, body: { endpoint: j.endpoint, keys: j.keys, device: pushDevice() } });
    if (!res.ok) return fail("登録できませんでした（" + (res.error || res.status) + "）");
    await loadPush();
  });
  $("push-test").addEventListener("click", async () => {
    const r = await api("/api/admin/push/test", { method: "POST", token });
    $("push-status").textContent = r.ok ? `${r.devices} 台に送り、届けた ${r.sent}・失敗 ${r.failed}${r.gone ? "・使えなくなった " + r.gone : ""}` : "送れませんでした（" + (r.error || r.status) + "）";
  });
  $("push-off").addEventListener("click", async () => {
    if (!pushSupported()) return;
    const ps = await pushSub().catch(() => null);
    const sub = ps && ps.sub;
    if (!sub) { $("push-status").textContent = "この端末は受け取っていません"; return; }
    await api("/api/admin/push", { method: "DELETE", token, body: { endpoint: sub.endpoint } });
    await sub.unsubscribe().catch(() => {});
    await loadPush();
  });
}

async function loadSetup() {
  const s = await api("/api/admin/setup", { token });
  if (!s.ok) { $("setup-body").textContent = "読めませんでした（" + (s.error || s.status) + "）"; return; }
  const yes = (b) => (b ? "入っている" : "まだ");
  $("setup-body").innerHTML = `<dl>
    <dt>UnivaPay の鍵</dt><dd>${yes(s.univapay.configured)}${s.univapay.mode ? "（" + esc(s.univapay.mode) + "）" : ""}</dd>
    <dt>Webhook の URL</dt><dd><code>${esc(s.webhook.url)}</code></dd>
    <dt>Webhook の認証</dt><dd><code>${esc(s.webhook.auth_token)}</code></dd>
    <dt>メールの送り口</dt><dd>${yes(s.mail.binding)}</dd>
    <dt>送信元</dt><dd>${s.mail.from ? "<code>" + esc(s.mail.from) + "</code>" : "まだ"}</dd>
  </dl>`;
}

function detailText(e) {
  const p = e.payload || {};
  if (e.type === "consult_booked" || e.type === "consult_canceled") return `<span class="note">（${p.slot ? esc(fmtTime(p.slot)) : ""}${p.topic ? "・" + esc(String(p.topic).slice(0, 30)) : ""}）</span>`;
  if (e.type === "consult_done" || e.type === "deal_won" || e.type === "deal_lost") return `<span class="note">（${p.amount != null ? Number(p.amount).toLocaleString() + " 円・" : ""}${esc(String(p.memo || "").slice(0, 30))}）</span>`;
  if (e.type.startsWith("seminar_")) return `<span class="note">（${esc(p.seminar_id || "")}${p.mail ? "・メール " + esc(p.mail) : ""}）</span>`;
  if (e.type === "purchase_completed") return `<span class="note">（${esc(p.product_name || p.product_id || "")}・${Number(p.amount || 0).toLocaleString()} 円${p.grant_until ? "・" + esc(fmtTime(p.grant_until).slice(0, 10)) + " まで" : ""}${p.over_limit ? "・上限を超えた：" + esc(p.over_limit) : ""}）</span>`;
  if (e.type.startsWith("subscription_")) return `<span class="note">（${esc(p.status || "")}${p.amount ? "・" + Number(p.amount).toLocaleString() + " 円" : ""}）</span>`;
  if (e.type === "email_clicked") return `<span class="note">（${esc(String(p.url || "").slice(0, 60))}）</span>`;
  if (e.type.startsWith("email_") && e.type !== "email_unsubscribed") return `<span class="note">（${esc(p.subject || "")}${p.reason ? "・" + esc(p.reason) : ""}${p.error ? "・" + esc(p.error) : ""}）</span>`;
  if (e.type === "correction_submitted") return `<span class="note">（${esc(String(p.text || "").slice(0, 30))}${(p.images || []).length ? " 画像" + p.images.length : ""}）</span>`;
  if (e.type === "correction_returned") return `<span class="note">（${esc(String(p.comment || p.corrected || "").slice(0, 30))}）</span>`;
  if (e.type === "room_chat") return `<span class="note">（${p.from === "student" ? "生徒から" : "シアニンから"}・${esc(String(p.text || "").slice(0, 30))}${(p.images || []).length ? " 画像" + p.images.length : ""}）</span>`;
  if (e.type === "push_subscribed" || e.type === "push_unsubscribed") return `<span class="note">（${esc(p.device || "")}${p.reason ? "・" + esc(p.reason) : ""}）</span>`;
  if (e.type === "room_read") return `<span class="note">（${p.by === "admin" ? "シアニン" : "生徒"}）</span>`;
  if (e.type === "label_added" || e.type === "label_removed") return `<span class="note">（${esc(p.label || "")}${p.step_id != null ? "・コネクタ " + esc(p.step_id) : ""}）</span>`;
  if (e.type === "admin_notified" || e.type === "admin_notify_failed" || e.type === "connector_skipped") return `<span class="note">（コネクタ ${esc(p.step_id)}${p.reason ? "・" + esc(p.reason) : ""}${p.error ? "・" + esc(p.error) : ""}）</span>`;
  if (p.lesson_id) return `<span class="note">（${esc(p.lesson_id)}）</span>`;
  if (p.source) return `<span class="note">（${esc(SOURCE_LABEL[p.source] || p.source)}）</span>`;
  if ("value" in p) return `<span class="note">（${p.value ? "付けた" : "外した"}）</span>`;
  return "";
}

$("send").addEventListener("click", async () => {
  clearErr();
  const email = $("email").value.trim();
  if (!email) return fail("メールアドレスを入れてください。");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/admin", shouldCreateUser: true } });
  if (error) return fail("送れませんでした：" + error.message);
  $("sent").textContent = email + " にリンクを送りました。";
  $("sent").classList.remove("hidden");
});
$("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.reload(); });

const bp = makeBlueprint({ $, api, esc, getToken: () => token, fail, openView });

start().catch((e) => fail(e.message));

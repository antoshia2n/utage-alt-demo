import { getClient, api, esc, fmtTime, SOURCE_LABEL, EVENT_LABEL, authImage } from "/js/common.js";

const $ = (id) => document.getElementById(id);
const steps = ["step-login", "step-enroll", "step-mfa", "console"];
const show = (id) => steps.forEach((s) => $(s).classList.toggle("hidden", s !== id));
const fail = (t) => { $("err").textContent = t; $("err").classList.remove("hidden"); };
const clearErr = () => $("err").classList.add("hidden");
let sb, token;

async function start() {
  try { sb = await getClient(); } catch (e) { return fail(e.message); }
  const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
  if (hashErr) fail("リンクが使えませんでした：" + hashErr);
  const { data } = await sb.auth.getSession();
  if (location.hash.includes("access_token")) history.replaceState(null, "", "/admin");
  if (!data.session) return show("step-login");
  $("logout").classList.remove("hidden");
  await secondFactor();
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
  loadStats();
  search();
  setupViews();
  loadRooms();
  loadSetup();
  setInterval(() => { if (!document.hidden) loadRooms(); }, 30000);
  let t;
  $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 250); });
  $("src").addEventListener("change", search);
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
      <span class="pill">${esc(p.stage)}</span>
      <span class="pill gray">流入元 ${SOURCE_LABEL[p.source] || esc(p.source)}</span>
      <span class="pill gray">出来事 ${p.event_count} 件</span>
      ${p.entitlement && p.entitlement.member ? '<span class="pill">会員（定期課金）</span>' : `<span class="pill gray">権利 ${esc(p.entitlement ? p.entitlement.status : "none")}</span>`}
    </div>
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
function setupViews() {
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("view-people").style.display = b.dataset.view === "people" ? "" : "none";
    $("view-rooms").style.display = b.dataset.view === "rooms" ? "" : "none";
    $("view-deals").style.display = b.dataset.view === "deals" ? "" : "none";
    if (b.dataset.view === "deals") loadDeals();
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
      <div style="text-align:right;flex-shrink:0">${x.unreplied > 0 ? `<span class="pill warn">未返信 ${x.unreplied}</span>` : '<span class="pill gray">返信済み</span>'}<div class="sub">${fmtTime(x.last_at)}</div></div>
    </li>`).join("");
  document.querySelectorAll("#rooms li").forEach((li) => li.addEventListener("click", () => openRoom(li.dataset.id)));
}

async function openRoom(id, focusId) {
  currentRoom = id;
  document.querySelectorAll("#rooms li").forEach((li) => li.toggleAttribute("aria-current", li.dataset.id === id));
  const r = await api("/api/admin/rooms/" + id, { token });
  if (!r.ok || !r.found) { $("room-detail").innerHTML = '<p class="note">読めませんでした。</p>'; return; }
  const subs = Object.fromEntries(r.messages.filter((m) => m.from === "student").map((m) => [m.id, m]));
  const target = focusId && subs[focusId] && !subs[focusId].replied ? subs[focusId] : subs[r.unreplied[0]];
  const block = (label, text) => `<div class="rb"><div class="rb-l">${label}</div><div class="rb-t">${esc(text) || '<span class="note">（なし）</span>'}</div></div>`;
  $("room-detail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(r.person.name || "（名前なし）")}</h2>
    <div class="note" style="margin-bottom:12px">${esc(r.person.email)}</div>
    <div class="room">${r.messages.map((m) => m.from === "student"
      ? `<div class="msg-them"><div class="bubble">${m.text ? `<div class="pre">${esc(m.text)}</div>` : ""}${m.images.length ? `<div class="imgs">${m.images.map((k) => `<img data-key="${esc(k)}" alt="生徒の画像">`).join("")}</div>` : ""}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.replied ? '<span class="pill gray">返信済み</span>' : `<button class="link" data-reply="${m.id}">${target && target.id === m.id ? "この投稿に返す（選択中）" : "この投稿に返す"}</button>`}</div></div>`
      : `<div class="msg-me"><div class="reply card"><div class="reply-h">返した添削${m.actor === "mcp" ? "（AI から）" : ""}</div>${block("原文", m.original)}${block("添削後", m.corrected)}${block("コメント", m.comment)}</div>
          <div class="meta"><time>${fmtTime(m.at)}</time>${m.read_by_student ? '<span class="pill gray">既読</span>' : ""}</div></div>`).join("") || '<p class="note">やりとりはまだありません。</p>'}</div>
    ${target ? `
    <form id="reply" class="stack reply-form">
      <h3>3 欄で返す</h3>
      <div><label for="r-orig">原文</label><textarea id="r-orig" rows="4">${esc(target.text)}</textarea></div>
      <div><label for="r-corr">添削後</label><textarea id="r-corr" rows="5">${esc(target.text)}</textarea></div>
      <div><label for="r-com">コメント</label><textarea id="r-com" rows="3" placeholder="どこを、なぜ直したか"></textarea></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn" type="submit" id="r-send">返す</button><span class="note" id="r-status"></span></div>
    </form>` : '<p class="note" style="margin-top:12px">この部屋に未返信はありません。</p>'}`;
  $("room-detail").querySelectorAll("img[data-key]").forEach(async (img) => {
    try { img.src = await authImage("/api/admin/image?key=" + encodeURIComponent(img.dataset.key), token); }
    catch (_) { img.alt = "画像を読めませんでした"; img.classList.add("broken"); }
  });
  $("room-detail").querySelectorAll("[data-reply]").forEach((b) => b.addEventListener("click", () => openRoom(id, Number(b.dataset.reply))));
  if (target) $("reply").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$("r-corr").value.trim()) { $("r-status").textContent = "添削後を入れてください"; return; }
    $("r-send").disabled = true;
    const res = await api(`/api/admin/rooms/${id}/reply`, { method: "POST", token, body: {
      reply_to: target.id, original: $("r-orig").value, corrected: $("r-corr").value, comment: $("r-com").value,
    } });
    if (!res.ok) { $("r-send").disabled = false; $("r-status").textContent = "返せませんでした（" + (res.error || res.status) + "）"; return; }
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
  if (e.type.startsWith("subscription_")) return `<span class="note">（${esc(p.status || "")}${p.amount ? "・" + Number(p.amount).toLocaleString() + " 円" : ""}）</span>`;
  if (e.type.startsWith("email_") && e.type !== "email_unsubscribed") return `<span class="note">（${esc(p.subject || "")}${p.reason ? "・" + esc(p.reason) : ""}${p.error ? "・" + esc(p.error) : ""}）</span>`;
  if (e.type === "correction_submitted") return `<span class="note">（${esc(String(p.text || "").slice(0, 30))}${(p.images || []).length ? " 画像" + p.images.length : ""}）</span>`;
  if (e.type === "correction_returned") return `<span class="note">（${esc(String(p.comment || p.corrected || "").slice(0, 30))}）</span>`;
  if (e.type === "room_read") return `<span class="note">（${p.by === "admin" ? "シアニン" : "生徒"}）</span>`;
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

start().catch((e) => fail(e.message));

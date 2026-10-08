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
  loadStats();
  search();
  setupViews();
  loadRooms();
  loadSetup();
  loadApprovalBadge();
  // AI から渡された承認の URL（/admin#approval/<番号>）で開いたときは、AI と承認のタブを開く
  if (location.hash.startsWith("#approval/")) document.querySelector('[data-view="ai"]').click();
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
      ${p.entitlement && p.entitlement.member ? `<span class="pill">会員（${esc(p.entitlement.plan || "定期課金")}）</span>` : `<span class="pill gray">権利 ${esc(p.entitlement ? p.entitlement.status : "none")}</span>`}
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
    $("view-ai").style.display = b.dataset.view === "ai" ? "" : "none";
    $("view-products").style.display = b.dataset.view === "products" ? "" : "none";
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

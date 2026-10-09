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
  // 便 12a：Claude が下書きを置いたときに返す住所（/admin#page/番号）
  const pm = h.match(/^#page[/]([0-9a-f-]{36})$/i);
  if (pm) { openView("pages"); openPage(pm[1]); return true; }
  return false;
}

async function loadStats() {
  const s = await api("/api/admin/stats", { token });
  if (!s.ok) return;
  const box = (label, n) => `<div class="stat"><b>${n}</b>${esc(label)}</div>`;
  $("stats").innerHTML = box("顧客", s.customers)
    + Object.entries(s.by_stage).map(([k, v]) => box(k, v)).join("")
    + Object.entries(s.by_source).map(([k, v]) => box("流入元 " + (SOURCE_LABEL[k] || k), v)).join("");
}

// ---------- 顧客管理（便 17：一覧の表 → 1 人の詳細。詳細は上に要点、下にタブ） ----------
let current = null;
let custRows = [], custSort = { key: "last_event_at", dir: -1 }, custTab = "overview";
const dayOf = (iso) => (iso ? fmtTime(iso).slice(0, 10) : "—");
function ago(iso) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "今日" : d === 1 ? "昨日" : d < 31 ? d + " 日前" : dayOf(iso);
}
const stageText = (p) => (p.member ? "会員" : p.stage || "");

function custList() {
  current = null;
  $("cust-list").classList.remove("hidden");
  $("cust-detail").classList.add("hidden");
  $("view-people-wrap").style.display = "";
  setCrumbSub("");
}

async function search() {
  const q = encodeURIComponent($("q").value.trim());
  const r = await api(`/api/admin/people?q=${q}&source=${$("src").value}&limit=200`, { token });
  if (!r.ok) { $("count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; $("people").innerHTML = ""; return; }
  custRows = r.people;
  renderCustomers();
}

function renderCustomers() {
  const mem = $("mem").value;
  let rows = custRows.filter((p) => mem === "" || String(p.member ? 1 : 0) === mem);
  const { key, dir } = custSort;
  const val = (p) => key === "stage" ? stageText(p) : key === "source" ? (SOURCE_LABEL[p.source] || p.source || "") : (p[key] || "");
  rows = rows.slice().sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  $("count").textContent = rows.length === 0 ? "当てはまる顧客は 0 人です" : `${rows.length} 人${custRows.length >= 200 ? "（新しく動いた順に 200 人まで。名前かメールで探すと全員から探します）" : ""}`;
  document.querySelectorAll(".cust-table [data-sort]").forEach((b) => b.dataset.dir = b.dataset.sort === key ? (dir > 0 ? "asc" : "desc") : "");
  $("people").innerHTML = rows.map((p) => `
    <tr data-id="${p.id}" tabindex="0">
      <td><div class="c-name">${esc(p.name || "（名前なし）")}</div><div class="sub">${esc(p.email)}</div></td>
      <td><span class="pill ${p.member ? "" : "gray"}">${esc(stageText(p))}</span>${p.deal_stage && p.deal_stage !== "none" ? ` <span class="pill warn">${esc(STAGE[p.deal_stage])}</span>` : ""}</td>
      <td class="c-src">${esc(SOURCE_LABEL[p.source] || p.source || "")}${p.note_member ? "・note" : ""}</td>
      <td>${esc(ago(p.last_event_at))}</td>
      <td class="c-reg">${esc(dayOf(p.created_at))}</td>
    </tr>`).join("");
  document.querySelectorAll("#people tr").forEach((tr) => {
    tr.addEventListener("click", () => detail(tr.dataset.id));
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") detail(tr.dataset.id); });
  });
}

const CUST_TABS = [["overview", "概要"], ["values", "項目と回答"], ["events", "出来事"], ["deal", "商談と面談"], ["mail", "メール"]];
async function detail(id) {
  if (current !== id) custTab = "overview";
  current = id;
  $("cust-list").classList.add("hidden");
  $("cust-detail").classList.remove("hidden");
  $("view-people-wrap").style.display = "none";
  const r = await api("/api/admin/people/" + id, { token });
  if (current !== id) return;
  if (!r.ok || !r.found) { $("detail").innerHTML = '<p class="note">読めませんでした。</p>'; return; }
  const p = r.person;
  setCrumbSub(p.name || p.email);
  const member = p.entitlement && p.entitlement.member;
  $("detail").innerHTML = `
    <div class="card cust-head">
      <div class="cust-head-top">
        <div style="min-width:0">
          <h2 style="margin:0 0 2px">${esc(p.name || "（名前なし）")}</h2>
          <div class="note ellip">${esc(p.email)}</div>
        </div>
        <div class="cust-actions">
          ${r.room ? `<button class="btn small" type="button" id="open-chat">チャットを開く</button>` : ""}
          <button class="btn ghost small" type="button" data-tabgo="mail">メールを送る</button>
        </div>
      </div>
      <div class="pill-row">
        ${r.stage ? `<span class="pill">段階 ${esc(r.stage.label)}</span>` : ""}
        ${member ? `<span class="pill">会員（${esc(p.entitlement.plan || "定期課金")}）</span>` : ""}
        ${p.deal && p.deal.stage !== "none" ? `<span class="pill warn">${esc(STAGE[p.deal.stage])}</span>` : ""}
        ${r.room && r.room.unreplied ? `<span class="pill warn">添削の未返信 ${r.room.unreplied}</span>` : ""}
      </div>
      <div class="pill-row" id="labels">${(r.labels || []).map((x) => `<span class="pill ${x.auto ? "gray" : "warn"}" title="${x.auto ? "自動で付いた" : "手で付けた"}">${esc(x.label)}${x.auto ? "" : ` <a href="#" data-unlabel="${esc(x.label)}" aria-label="外す">×</a>`}</span>`).join("") || '<span class="note">ラベルは無し</span>'}
        <form id="lb" class="lb-inline"><input id="lb-name" type="text" maxlength="40" placeholder="＋ ラベル" list="label-names" aria-label="ラベルを手で付ける"><button class="btn ghost small" type="submit">付ける</button><span class="note" id="lb-status"></span></form>
      </div>
    </div>
    <div class="tabs cust-tabs" role="tablist">${CUST_TABS.map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === custTab}">${v}${k === "events" ? ` <span class="note">${p.event_count}</span>` : ""}</button>`).join("")}</div>
    <section class="card" data-pane="overview">
      <dl class="kv">
        <dt>登録した日</dt><dd>${esc(dayOf(p.created_at))}・流入元 ${esc(SOURCE_LABEL[p.source] || p.source)}</dd>
        <dt>最後に動いた</dt><dd>${esc(ago(p.last_event_at))}</dd>
        <dt>ログイン</dt><dd>${p.login_count || 0} 回・教材を開いた ${p.lesson_view_count || 0} 回</dd>
        <dt>チャット</dt><dd>${r.room && r.room.messages ? `シアニンが読んでいない ${r.room.unread_for_admin}・添削の未返信 ${r.room.unreplied}・相手が読んでいない ${r.room.unread_for_student}` : "まだやりとりはありません"}</dd>
        ${p.entitlement && (p.entitlement.gate_keys || []).length ? `<dt>門番の権利</dt><dd>${p.entitlement.gate_keys.map(esc).join("・")}</dd>` : ""}
        <dt>買ったもの</dt><dd>${r.purchases && r.purchases.length ? `<ul class="plain" style="margin:0;padding-left:18px">${r.purchases.map((x) => `<li>${esc(x.name)}${x.amount != null ? "・" + Number(x.amount).toLocaleString() + " 円" : ""}${x.mode === "test" ? "（テスト）" : ""} <span class="note">${fmtTime(x.at)}</span></li>`).join("")}</ul>` : "まだ無し"}</dd>
      </dl>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="nm" ${p.note_member ? "checked" : ""}> <span>note のメンバー（手で付ける印）</span></label>
    </section>
    <section class="card" data-pane="values"><div id="pv-box" class="note">読み込んでいます…</div></section>
    <section class="card" data-pane="events">
      <ol class="timeline">${r.events.map((e) => `
        <li><time>${fmtTime(e.occurred_at)}</time>${esc(EVENT_LABEL[e.type] || e.type)}${detailText(e)}<span class="note"> · ${esc(ACTOR_LABEL[e.actor] || e.actor)}</span></li>`).join("") || '<li class="note">まだありません</li>'}
      </ol>
    </section>
    <section class="card" data-pane="deal">
      <h4 style="margin-top:0">商談 ${p.deal && p.deal.stage !== "none" ? `<span class="pill warn">${esc(STAGE[p.deal.stage])}</span>` : '<span class="note">（まだ無し）</span>'}</h4>
      <dl class="kv">
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
      <dl class="kv"><dt>プラン</dt><dd>${esc(p.contract.plan)}・${Number(p.contract.amount).toLocaleString()} 円</dd><dt>状態</dt><dd>${esc(p.contract.status)}</dd>
      <dt>入金</dt><dd>${p.contract.paid.map((x) => esc(x.month) + " " + esc(x.state)).join("・")}</dd></dl>` : ""}
      <details class="setup" id="meet-box"><summary>面談の記録（consult-manager）</summary><div id="meet" class="note" style="margin-top:8px">開くと読みます</div></details>
    </section>
    <section class="card" data-pane="mail">
      <h4 style="margin-top:0">メールを送る <span class="note">（いまはテスト宛てだけに届く）</span></h4>
      <form id="mail" class="stack">
        <div><label for="m-sub">件名</label><input id="m-sub" type="text" maxlength="200"></div>
        <div><label for="m-body">本文</label><textarea id="m-body" rows="5"></textarea></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">送る</button><span class="note" id="m-status"></span></div>
      </form>
    </section>`;
  const showTab = (k) => {
    custTab = k;
    document.querySelectorAll(".cust-tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    document.querySelectorAll("#detail [data-pane]").forEach((s) => s.classList.toggle("hidden", s.dataset.pane !== k));
  };
  document.querySelectorAll(".cust-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.querySelectorAll("[data-tabgo]").forEach((b) => b.addEventListener("click", () => { showTab(b.dataset.tabgo); $("m-sub").focus(); }));
  showTab(custTab);
  loadPersonValues(id);
  loadLabelNames();
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
    $("m-status").textContent = msg;
  });
  $("nm").addEventListener("change", async (ev) => {
    const res = await api("/api/admin/people/" + id, { method: "PATCH", token, body: { note_member: ev.target.checked } });
    if (!res.ok) { ev.target.checked = !ev.target.checked; return fail("変えられませんでした（" + (res.error || res.status) + "）"); }
    detail(id); search();
  });
}
const ACTOR_LABEL = { site: "サイト", admin: "画面", mcp: "AI", system: "自動", cron: "定時", connector: "コネクタ", student: "本人", univapay: "決済" };

// 上の帯：いまの場所の続き（顧客の名前など）
function setCrumbSub(t) { $("crumb-sub").textContent = t ? " › " + t : ""; }

// 便 17：左のメニューのまとまりを開閉する。開閉はこのブラウザに覚える（読めなくても全部開いた形で動く）
function setupGroups() {
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem("labos-closed-groups") || "[]"); } catch { closed = []; }
  const save = () => { try { localStorage.setItem("labos-closed-groups", JSON.stringify(closed)); } catch { /* 覚えられなくても動く */ } };
  document.querySelectorAll(".side .grp-box").forEach((box) => {
    const btn = box.querySelector(".grp");
    const set = (open) => { box.classList.toggle("closed", !open); btn.setAttribute("aria-expanded", String(open)); };
    set(!closed.includes(box.dataset.grp) || !!box.querySelector('[aria-selected="true"]'));
    btn.addEventListener("click", () => {
      const open = box.classList.contains("closed");
      set(open);
      closed = closed.filter((g) => g !== box.dataset.grp).concat(open ? [] : [box.dataset.grp]);
      save();
    });
  });
}

// 便 17：上の帯の検索と、待っているものの数
function setupTopbar() {
  $("gsearch").addEventListener("submit", (ev) => {
    ev.preventDefault();
    $("q").value = $("gq").value.trim();
    openView("people");
    search();
  });
  $("chip-ai").addEventListener("click", () => openView("ai"));
  $("chip-rooms").addEventListener("click", () => { $("only-unreplied").checked = true; openView("rooms"); loadRooms(); });
}
function setChip(id, n) {
  $(id + "-n").textContent = n > 0 ? String(n) : "";
  $(id).classList.toggle("hidden", !(n > 0));
}

// ---------- 便 18：一覧 → 詳細の共通部品（顧客管理と同じ形をほかの画面でも使う） ----------
// 表：cols = [{ key, label, html(row), cls?, sortVal?(row), nosort? }]。見出しを押すと並べ替え、行を押すと onRow
const tableSort = {};
function table(hostId, cols, rows, onRow, empty) {
  const s = tableSort[hostId] || (tableSort[hostId] = { key: null, dir: 1 });
  let list = rows.slice();
  if (s.key) {
    const c = cols.find((x) => x.key === s.key) || {};
    const v = c.sortVal || ((r) => r[s.key] ?? "");
    list.sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * s.dir);
  }
  if (!rows.length) { $(hostId).innerHTML = `<p class="note" style="margin:8px 0 0">${esc(empty)}</p>`; return; }
  $(hostId).innerHTML = `<table class="cust-table"><thead><tr>${cols.map((c) => `<th class="${c.cls || ""}">${c.nosort ? esc(c.label) : `<button type="button" data-tsort="${c.key}" data-dir="${s.key === c.key ? (s.dir > 0 ? "asc" : "desc") : ""}">${esc(c.label)}</button>`}</th>`).join("")}</tr></thead>
    <tbody>${list.map((r) => `<tr tabindex="0" data-ti="${rows.indexOf(r)}">${cols.map((c) => `<td class="${c.cls || ""}">${c.html(r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $(hostId).querySelectorAll("[data-tsort]").forEach((b) => b.addEventListener("click", () => {
    s.dir = s.key === b.dataset.tsort ? -s.dir : 1; s.key = b.dataset.tsort;
    table(hostId, cols, rows, onRow, empty);
  }));
  if (onRow) $(hostId).querySelectorAll("tbody tr").forEach((tr) => {
    const go = (ev) => { if (ev.target.closest("button, a, input, select")) return; onRow(rows[Number(tr.dataset.ti)]); };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(ev); });
  });
}
// 一覧と詳細を入れ替える。詳細のときは上の帯に名前を足し、戻る道の文字を合わせる
function showPane(view, mode, sub, backText) {
  $(view + "-list").classList.toggle("hidden", mode !== "list");
  $(view + "-detail").classList.toggle("hidden", mode !== "detail");
  if (backText) $(view + "-detail").querySelector(".back-link").textContent = "← " + backText;
  setCrumbSub(mode === "detail" ? sub : "");
  if (mode === "detail") window.scrollTo(0, 0);
}
// 詳細の上の帯（名前・状態・よく使う操作）
function headHtml({ title, sub = "", pills = [], actions = "", foot = "" }) {
  return `<div class="card cust-head"><div class="cust-head-top"><div style="min-width:0"><h2 style="margin:0 0 2px">${esc(title)}</h2>${sub ? `<div class="note">${sub}</div>` : ""}</div><div class="cust-actions">${actions}</div></div>${pills.filter(Boolean).length ? `<div class="pill-row">${pills.filter(Boolean).join("")}</div>` : ""}${foot}</div>`;
}

// ---------- 便 19：企画（フォルダの代わり）。パーツの一覧を企画で絞り、詳細の上の帯で企画を変えられる ----------
// 企画を作る・しまうのは設計図の画面。ここでは選ぶだけ
let campData = { campaigns: [], owners: [] }, campAt = 0;
const campFilterVal = {};
async function loadCampaigns(force) {
  if (!force && Date.now() - campAt < 20e3) return campData;
  const r = await api("/api/admin/campaigns/owners", { token });
  if (r.ok) { campData = { campaigns: r.campaigns || [], owners: r.owners || [] }; campAt = Date.now(); }
  return campData;
}
function campOf(type, id) {
  const o = campData.owners.find((x) => x.part_type === type && String(x.part_id) === String(id));
  return o ? campData.campaigns.find((c) => c.id === o.campaign_id) || null : null;
}
const liveCamps = () => campData.campaigns.filter((c) => !c.archived_at);
// 一覧の上の「企画で絞る」を置き、選んだ企画の行だけを返す。選び直すと rerender を呼ぶ
function campRows(key, type, rows, idOf, rerender) {
  const slot = document.querySelector(`[data-camp-slot="${key}"]`);
  const v = campFilterVal[key] || "";
  if (slot) {
    slot.innerHTML = `<select class="inline camp-filter" aria-label="企画で絞る"><option value="">企画：すべて</option><option value="none" ${v === "none" ? "selected" : ""}>企画に入っていない</option>${liveCamps().map((c) => `<option value="${c.id}" ${v === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
    slot.querySelector("select").addEventListener("change", (ev) => { campFilterVal[key] = ev.target.value; rerender(); });
  }
  if (!v) return rows;
  return rows.filter((r) => { const c = campOf(type, idOf(r)); return v === "none" ? !c : c && c.id === v; });
}
// 表の「企画」の列
const campCol = (type, idOf) => ({ key: "_camp", label: "企画", cls: "c-src", sortVal: (r) => (campOf(type, idOf(r)) || {}).name || "", html: (r) => { const c = campOf(type, idOf(r)); return c ? esc(c.name) : '<span class="sub">—</span>'; } });
// 詳細の上の帯の下に置く「企画」の選び直し
function campPicker(type, id) {
  const cur = campOf(type, id);
  return `<div class="camp-pick"><label>企画<select class="inline camp-set" data-part="${esc(type)}|${esc(String(id))}"><option value="">（企画に入っていない）</option>${liveCamps().map((c) => `<option value="${c.id}" ${cur && cur.id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><span class="note camp-status"></span></div>`;
}
function wireCampPicker(root, after) {
  const sel = root.querySelector(".camp-set"), st = root.querySelector(".camp-status");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    const [part_type, part_id] = sel.dataset.part.split("|");
    st.textContent = "変えています…";
    const r = await api("/api/admin/campaigns/assign", { method: "POST", token, body: { part_type, part_id, campaign_id: sel.value || null } });
    if (!r.ok) {
      st.textContent = r.error === "part_not_found" ? "設計図に出ていない物（止めている商品など）は企画に入れられません" : "変えられませんでした（" + (r.error || r.status) + "）";
      return;
    }
    await loadCampaigns(true);
    st.textContent = sel.value ? "企画を変えました" : "企画から外しました";
    if (after) after();
  });
}
function tabsHtml(tabs, cur) {
  return `<div class="tabs cust-tabs" role="tablist">${tabs.map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === cur}">${v}</button>`).join("")}</div>`;
}
// root の中のタブ（data-tab）と中身（data-pane）を結ぶ。戻り値は表示を切り替える関数
function wireTabs(root, cur) {
  const show = (k) => {
    root.querySelectorAll(".cust-tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    root.querySelectorAll("[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== k));
  };
  root.querySelectorAll(".cust-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(cur);
  return show;
}
// 一覧の中のタブ（フォーム／人の項目 など、一覧の種類を切り替える）
function setupViewTabs() {
  document.querySelectorAll("[data-vtabs]").forEach((bar) => {
    const box = bar.parentElement;
    bar.querySelectorAll("[data-vtab]").forEach((b) => b.addEventListener("click", () => {
      bar.querySelectorAll("[data-vtab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      box.querySelectorAll(":scope > [data-vpane]").forEach((p) => p.classList.toggle("hidden", p.dataset.vpane !== b.dataset.vtab));
    }));
  });
}
// 一覧のタブを外から選ぶ（ファネル構築の「自動の動き」など）
function selectVtab(view, key) {
  const b = document.querySelector(`#view-${view} [data-vtab="${key}"]`);
  if (b && b.getAttribute("aria-selected") !== "true") b.click();
}
const PANE_VIEWS = ["forms", "deliver", "blueprint", "products", "refer", "deals", "pages"];
const pill = (t, kind = "") => `<span class="pill ${kind}">${esc(t)}</span>`;

// ---------- 添削ルーム ----------
let currentRoom = null;
// 便 8c：左のメニュー。押した項目の画面だけを出し、上のナビにその名前を出す
const VIEWS = ["home", "blueprint", "people", "rooms", "deals", "ai", "products", "deliver", "settings", "refer", "guide", "forms", "pages"];
// 便 20：コネクタだけの画面は無くした。"connect" は行き先の名前としてだけ残す。
// メールを送るコネクタ（ステップ配信）は メール、送らないもの（自動の動き）は ファネル構築 のタブで開く。part を渡すとその 1 件を開く
function openView(name, part) {
  if (name === "connect") {
    const mail = !!part && isMailStep(part);
    const home = mail ? "deliver" : "blueprint";
    openView(home);
    selectVtab(home, mail ? "step" : "auto");
    if (part && part.id != null) openStepById(part.id);
    return;
  }
  const b = document.querySelector(`.side [data-view="${name}"]`);
  if (b) b.click();
  // 便 12a：設計図のページの箱から開いたときは、その 1 枚を開く
  if (name === "pages" && part && part.lp && part.id) openPage(part.id);
}
function setupViews() {
  document.querySelectorAll(".side [data-view]").forEach((b) => b.addEventListener("click", () => {
    clearErr();
    document.querySelectorAll(".side [data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    for (const v of VIEWS) $("view-" + v).style.display = b.dataset.view === v ? "" : "none";
    $("view-people-wrap").style.display = b.dataset.view === "people" ? "" : "none";
    $("crumb").textContent = b.firstChild.textContent.trim();
    setCrumbSub("");
    // 便 17：顧客管理はメニューから開くと一覧に戻る。開いた画面のまとまりは閉じない
    if (b.dataset.view === "people") custList();
    // 便 18：一覧 → 詳細の画面は、メニューから開くと一覧に戻る
    if (PANE_VIEWS.includes(b.dataset.view)) showPane(b.dataset.view, "list");
    const box = b.closest(".grp-box");
    if (box && box.classList.contains("closed")) box.querySelector(".grp").click();
    if (b.dataset.view === "home") loadHome();
    if (b.dataset.view === "blueprint") bp.load();
    if (b.dataset.view === "deliver" || b.dataset.view === "blueprint") loadDeliver();
    if (b.dataset.view === "products") loadProducts();
    if (b.dataset.view === "deals") loadDeals();
    if (b.dataset.view === "ai") loadAi();
    if (b.dataset.view === "refer") loadReferrals();
    if (b.dataset.view === "guide") loadGuide();
    if (b.dataset.view === "forms") loadForms();
    if (b.dataset.view === "pages") loadPages();
  }));
  $("hm-guide").addEventListener("click", () => openView("guide"));
  $("cust-back").addEventListener("click", custList);
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.back, "list")));
  setupViewTabs();
  document.querySelectorAll(".cust-table [data-sort]").forEach((b) => b.addEventListener("click", () => {
    custSort = { key: b.dataset.sort, dir: custSort.key === b.dataset.sort ? -custSort.dir : (b.dataset.sort === "name" ? 1 : -1) };
    renderCustomers();
  }));
  $("mem").addEventListener("change", renderCustomers);
  setupGroups();
  setupTopbar();
  $("only-unreplied").addEventListener("change", loadRooms);
}

async function loadRooms() {
  const r = await api("/api/admin/rooms" + ($("only-unreplied").checked ? "?only_unreplied=1" : ""), { token });
  if (!r.ok) { $("rooms-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  const badge = $("rooms-badge");
  badge.textContent = r.unreplied_total > 0 ? String(r.unreplied_total) : "";
  badge.classList.toggle("hidden", !(r.unreplied_total > 0));
  setChip("chip-rooms", r.unreplied_total);
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

// ---------- 予約と商談（便 4・便 18 で一覧の表 → 詳細） ----------
const STAGE = { booked: "相談予約", done: "面談済", won: "成約", lost: "失注", none: "" };
let seminarsCache = [];
async function loadDeals(focusId, msg) {
  const c = await api("/api/admin/consults", { token });
  if (!c.ok) { $("consults-count").textContent = "読めませんでした（" + (c.error || c.status) + "）"; }
  else {
    $("consults-count").textContent = c.count === 0 ? "これからの予約は 0 件です。予約が入ると、ここに日時の順で並びます" : `これからの予約 ${c.count} 件。行を押すと顧客管理でその人の詳細が開きます`;
    table("consults", [
      { key: "slot", label: "日時", html: (x) => esc(x.label) },
      { key: "name", label: "名前", sortVal: (x) => x.name || x.email, html: (x) => `<div class="c-name">${esc(x.name || x.email)}</div>` },
      { key: "topic", label: "相談したいこと", nosort: true, cls: "c-src", html: (x) => `<span class="sub">${esc(x.topic || "（未記入）")}</span>` },
      { key: "stage", label: "段階", html: (x) => pill(STAGE[x.stage] || x.stage, "warn") },
    ], c.consults, (x) => { openView("people"); detail(x.person_id); }, "これからの予約はありません");
  }
  const s = await api("/api/admin/seminars", { token });
  if (!s.ok) { $("sem-count").textContent = "読めませんでした"; return; }
  seminarsCache = s.seminars;
  semStore = s.store === "production";
  $("sem-new").classList.toggle("hidden", !semStore);
  if (semStore && !semNewWired) { semNewWired = true; $("sem-new").addEventListener("click", () => seminarEditor(null)); }
  $("sem-count").textContent = `${s.seminars.length} 件・これから ${s.seminars.filter((x) => !x.past).length}`;
  await loadCampaigns();
  const smRows = campRows("seminars", "seminar", s.seminars, (x) => x.id, () => loadDeals());
  table("seminars", [
    { key: "starts_at", label: "日時", html: (x) => esc(x.label) },
    { key: "title", label: "題名", html: (x) => `<div class="c-name">${esc(x.title)}</div>` },
    { key: "registrants", label: "申込", html: (x) => `${x.registrants} 人` + (x.capacity ? `<div class="sub">定員 ${x.capacity}</div>` : "") },
    campCol("seminar", (x) => x.id),
    { key: "past", label: "状態", sortVal: (x) => (x.past ? 1 : 0), html: (x) => x.past ? pill("終了", "gray") : pill("これから") },
  ], smRows, (x) => (semStore ? openSeminar(x.id) : seminarDetail(x.id)), s.seminars.length ? "この企画のセミナーはありません" : (semStore ? "まだありません。「新しく作る」から回を作ります" : "セミナーはまだありません"));
  if (focusId) (semStore ? openSeminar(focusId, { msg }) : seminarDetail(focusId, msg));
}
// デモの置き場（架空の 2 回）
function seminarDetail(id, msg) {
  const x = seminarsCache.find((y) => y.id === id);
  if (!x) return;
  showPane("deals", "detail", x.title, "セミナーの一覧へ");
  $("seminar-detail").innerHTML = headHtml({
    title: x.title,
    sub: esc(x.label),
    pills: [x.past ? pill("終了", "gray") : pill("これから"), pill(`申込 ${x.registrants} 人`, "gray")],
    actions: x.past ? `<button class="btn small" type="button" id="sem-run" data-kind="archive">アーカイブを配る</button>` : `<button class="btn ghost small" type="button" id="sem-run" data-kind="remind">前日の知らせを今送る（試し）</button>`,
    foot: campPicker("seminar", x.id),
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}
    <section class="card" style="margin-top:16px"><dl class="kv">
      <dt>申込</dt><dd>${x.registrants} 人</dd>
      <dt>前日の知らせ</dt><dd>${x.reminded} 人に送った</dd>
      <dt>アーカイブ</dt><dd>${x.archive_sent} 人に配った</dd>
    </dl><p class="note" id="sem-status" style="margin:12px 0 0"></p></section>`;
  wireCampPicker($("seminar-detail"), () => loadDeals());
  $("sem-run").addEventListener("click", async () => {
    $("sem-status").textContent = "送っています…";
    const r = await api(`/api/admin/seminars/${x.id}/${$("sem-run").dataset.kind}`, { method: "POST", token });
    if (!r.ok) { $("sem-status").textContent = "送れませんでした（" + (r.error || r.status) + "）"; return; }
    await loadDeals(x.id, `送った ${r.sent}・テスト宛てでないので送らなかった ${r.blocked}・失敗 ${r.failed}${r.skipped ? "・送り済み " + r.skipped : ""}`);
  });
}

// ---------- 便 13：セミナーの回（本番の置き場）。一覧 → 詳細（中身・知らせ・申込者）。作るは一覧の「新しく作る」 ----------
let semStore = false, semNewWired = false, currentSeminar = null;
const SEM_WHY = {
  bad_title: "題名を入れてください（80 字まで）", bad_starts_at: "日時は「2026-11-01 21:00」の形で入れてください", bad_minutes: "長さは 10〜600 分",
  bad_capacity: "定員は 1 以上の数（空なら無制限）", bad_zoom_url: "Zoom の住所は https:// から", bad_archive_url: "アーカイブの住所は https:// から",
  form_not_found: "そのフォームが見つかりません", form_used_by_another_seminar: "そのフォームは別の回に結んであります", thanks_page_not_found: "そのページが見つかりません",
  bad_key: "知らせの名前は英小文字・数字・ハイフン（例 three-days-before）", bad_offset_minutes: "いつ送るかの数を確かめてください", bad_subject: "件名を入れてください", bad_body: "本文を入れてください",
};
// 日本時間の「2026-11-01T21:00」（日時の欄に入れる形）
const jstInput = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return d.toISOString().slice(0, 16); };
// 開催の何分前を「1 日前」「2 時間あと」などに。欄は「数・単位・前／あと」の 3 つ
function offsetParts(m) {
  if (m == null) return { n: "", unit: "now", dir: "before" };
  const a = Math.abs(m), dir = m < 0 ? "after" : "before";
  if (a % 1440 === 0 && a) return { n: a / 1440, unit: "day", dir };
  if (a % 60 === 0 && a) return { n: a / 60, unit: "hour", dir };
  return { n: a, unit: "min", dir };
}
function offsetFrom(n, unit, dir) {
  if (unit === "now") return null;
  const k = { day: 1440, hour: 60, min: 1 }[unit] || 1;
  const v = Math.round(Number(n) * k);
  return dir === "after" ? -v : v;
}
async function openSeminar(id, opts = {}) {
  currentSeminar = id;
  showPane("deals", "detail", "読んでいます…", "セミナーの一覧へ");
  $("seminar-detail").innerHTML = '<p class="note">読んでいます…</p>';
  await Promise.all([loadCampaigns(true), loadFieldOptions(), loadPagesCache()]);
  const r = await api("/api/admin/seminars/" + id, { token });
  if (currentSeminar !== id) return;
  if (!r.ok || !r.found) { $("seminar-detail").innerHTML = `<p class="note">読めませんでした（${esc(r.error || "見つかりません")}）</p>`; return; }
  renderSeminar(r, opts);
}
function renderSeminar(r, { tab = "notices", msg } = {}) {
  const x = r.seminar;
  showPane("deals", "detail", x.title, "セミナーの一覧へ");
  $("seminar-detail").innerHTML = headHtml({
    title: x.title,
    sub: esc(`${x.label}（${x.minutes} 分）`),
    pills: [x.past ? pill("終了", "gray") : pill("これから"), pill(`申込 ${x.registrants} 人` + (x.capacity ? ` / 定員 ${x.capacity}` : ""), "gray"), x.form_slug ? pill("申込のフォームあり", "gray") : pill("申込のフォームが無い", "warn")],
    foot: campPicker("seminar", x.id),
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}`
    + tabsHtml([["notices", `知らせ ${r.notices.length}`], ["people", `申込者 ${r.registrants.length}`], ["edit", "中身"]], tab)
    + `<section class="card" data-pane="notices">
      <p class="note" style="margin-top:0">申込者に届く順に並びます。名前を押すと直せます。定時の処理（毎時 7 分）で送るので、送る時刻から最大 1 時間遅れます。送る時刻より後に申し込んだ人には、その知らせは送りません。</p>
      <div id="sn-table" class="table-wrap"></div>
      <div style="margin-top:12px"><button class="btn small" type="button" id="sn-new">知らせを足す</button></div>
      <div id="sn-edit"></div>
      <p class="note" style="margin:12px 0 0">この回の申込者には自動のラベル「${esc(x.label_name)}」が付きます。一斉配信やステップ配信の宛先でこのラベルを選ぶと、あとからこの回の申込者だけに送れます。</p>
    </section>
    <section class="card" data-pane="people"><div id="sp-table" class="table-wrap"></div></section>
    <section class="card" data-pane="edit">${seminarForm(x)}</section>`;
  wireTabs($("seminar-detail"), tab);
  wireCampPicker($("seminar-detail"), () => loadDeals());
  wireSeminarForm(x);
  const sorted = r.notices.slice().sort((a, b) => (a.send_at || "0") < (b.send_at || "0") ? -1 : 1);
  table("sn-table", [
    { key: "when", label: "いつ", sortVal: (n) => n.send_at || "0", html: (n) => esc(n.when) + (n.send_at ? `<div class="sub">${esc(fmtTime(n.send_at))}</div>` : "") },
    { key: "subject", label: "件名", html: (n) => `<div class="c-name">${esc(n.subject)}</div>` },
    { key: "active", label: "状態", cls: "c-src", sortVal: (n) => (n.active ? 1 : 0), html: (n) => n.active ? pill("使う") : pill("止めている", "gray") },
    { key: "sent", label: "送った", html: (n) => `${n.sent} 人` },
  ], sorted, (n) => noticeEditor(x, n, r.placeholders), "まだありません。「知らせを足す」から足します");
  $("sn-new").addEventListener("click", () => noticeEditor(x, null, r.placeholders));
  table("sp-table", [
    { key: "name", label: "名前", sortVal: (p) => p.name || p.email, html: (p) => `<div class="c-name">${esc(p.name || p.email)}</div><div class="sub">${esc(p.email)}</div>` },
    { key: "registered_at", label: "申込", html: (p) => esc(fmtTime(p.registered_at)) },
  ], r.registrants, (p) => { openView("people"); detail(p.person_id); }, "まだ申込はありません。申込のフォームに答えた人がここに並びます");
}
function seminarForm(x) {
  const formOpts = formsCache.map((f) => `<option value="${esc(f.slug)}" ${x && x.form_slug === f.slug ? "selected" : ""}>${esc(f.title)}${f.active ? "" : "（公開していない）"}</option>`).join("");
  const thanksOpts = pagesCache.map((p) => `<option value="${esc(p.slug)}" ${x && x.thanks_page_slug === p.slug ? "selected" : ""}>${esc(p.title)}${p.status === "published" ? "" : "（公開していない）"}</option>`).join("");
  return `<form id="se" class="stack">
      <div><label for="se-title">題名（申込者に届くメールに出る名前）</label><input id="se-title" type="text" maxlength="80" placeholder="例 2026年11月 図解セミナー" value="${esc(x ? x.title : "")}"></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:2 1 200px"><label for="se-start">日時（日本時間）</label><input id="se-start" type="datetime-local" value="${x ? esc(jstInput(x.starts_at)) : ""}"></div>
        <div style="flex:1 1 100px"><label for="se-min">長さ（分）</label><input id="se-min" type="number" min="10" max="600" value="${x ? x.minutes : 60}"></div>
        <div style="flex:1 1 100px"><label for="se-cap">定員（空なら無制限）</label><input id="se-cap" type="number" min="1" value="${x && x.capacity ? x.capacity : ""}"></div>
      </div>
      <div><label for="se-zoom">参加の URL（Zoom）</label><input id="se-zoom" type="url" inputmode="url" maxlength="500" placeholder="https://zoom.us/j/..." value="${esc(x ? x.zoom_url : "")}"></div>
      <div><label for="se-form">申込のフォーム（答えた人がこの回の申込者になる）</label><select id="se-form" class="inline"><option value="">（まだ結ばない）</option>${formOpts}</select></div>
      <div><label for="se-thanks">サンクスページ（答えたあとに移るページ。公開中のときだけ移る）</label><select id="se-thanks" class="inline"><option value="">（移さない・フォームの「送ったあとに出す文」を出す）</option>${thanksOpts}</select></div>
      <div><label for="se-arc">アーカイブの URL（開催のあとの知らせで使う）</label><input id="se-arc" type="url" inputmode="url" maxlength="500" placeholder="https://www.youtube.com/watch?v=..." value="${esc(x ? x.archive_url : "")}"></div>
      ${x ? "" : `<div><label for="se-camp">企画</label><select id="se-camp" class="inline"><option value="">（あとで決める）</option>${liveCamps().map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>`}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small" type="submit">${x ? "保存" : "作る"}</button>${x ? `<button class="btn ghost small" type="button" id="se-arch">${x.archived ? "戻す" : "しまう"}</button>` : ""}<span class="note" id="se-status"></span></div>
      ${x ? "" : '<p class="note" style="margin:0">作ると、知らせ 3 本（申込の直後・前日・1 時間前）が入ります。あとで直す・足すことができます。</p>'}
    </form>`;
}
function wireSeminarForm(x) {
  $("se").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const start = $("se-start").value;
    const body = {
      title: $("se-title").value.trim(), starts_at: start ? start.replace("T", " ") : "", minutes: Number($("se-min").value || 60),
      capacity: $("se-cap").value ? Number($("se-cap").value) : null, zoom_url: $("se-zoom").value.trim(), archive_url: $("se-arc").value.trim(),
      form_slug: $("se-form").value, thanks_page_slug: $("se-thanks").value,
    };
    if (x) body.id = x.id; else if ($("se-camp") && $("se-camp").value) body.campaign_id = $("se-camp").value;
    const r = await api("/api/admin/seminars", { method: "POST", token, body });
    if (!r.ok) { $("se-status").textContent = SEM_WHY[r.error] || "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadDeals();
    openSeminar(r.seminar.id, { tab: x ? "edit" : "notices", msg: x ? "保存しました" : "作りました。知らせ 3 本が入っています" });
  });
  if ($("se-arch")) $("se-arch").addEventListener("click", async () => {
    const r = await api("/api/admin/seminars", { method: "POST", token, body: { id: x.id, archived: !x.archived } });
    if (!r.ok) { $("se-status").textContent = "変えられませんでした（" + (r.error || r.status) + "）"; return; }
    await loadDeals();
    openSeminar(x.id, { tab: "edit", msg: r.seminar.archived ? "しまいました。知らせは送りません" : "戻しました" });
  });
}
// 新しく作る（一覧の上のボタン）
async function seminarEditor() {
  currentSeminar = null;
  await Promise.all([loadCampaigns(true), loadFieldOptions(), loadPagesCache()]);
  showPane("deals", "detail", "新しいセミナー", "セミナーの一覧へ");
  $("seminar-detail").innerHTML = headHtml({ title: "新しいセミナー", sub: "題名と日時を入れて「作る」を押します。申込のフォームを結ぶと、そのフォームに答えた人がこの回の申込者になります" })
    + `<section class="card" style="margin-top:16px">${seminarForm(null)}</section>`;
  wireSeminarForm(null);
}
async function loadPagesCache() {
  if (pagesCache.length) return;
  const l = await api("/api/admin/pages", { token });
  if (l.ok) { pagesCache = l.pages; pagesOrigin = l.pages_origin || ""; }
}
// 知らせを足す・直す（名前は自動で付ける。画面に英字を出さないため）
function noticeEditor(x, n, placeholders) {
  const o = offsetParts(n ? n.offset_minutes : 1440);
  $("sn-edit").innerHTML = `<div class="card" style="margin-top:12px"><form id="sn" class="stack">
      <b>${n ? "知らせを直す" : "知らせを足す"}</b>
      <div class="note" style="margin:0">いつ送るか</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="sn-unit" class="sr">いつ</label>
        <input id="sn-n" type="number" min="1" style="width:90px" value="${esc(o.n)}" aria-label="数">
        <select id="sn-unit" class="inline"><option value="day" ${o.unit === "day" ? "selected" : ""}>日</option><option value="hour" ${o.unit === "hour" ? "selected" : ""}>時間</option><option value="min" ${o.unit === "min" ? "selected" : ""}>分</option><option value="now" ${o.unit === "now" ? "selected" : ""}>（申込の直後に送る）</option></select>
        <select id="sn-dir" class="inline" aria-label="前かあとか"><option value="before" ${o.dir === "before" ? "selected" : ""}>開催の前</option><option value="after" ${o.dir === "after" ? "selected" : ""}>開催のあと</option></select></div>
      <div><label for="sn-sub">件名</label><input id="sn-sub" type="text" maxlength="200" value="${esc(n ? n.subject : "")}"></div>
      <div><label for="sn-body">本文</label><textarea id="sn-body" rows="8" maxlength="8000">${esc(n ? n.body : "")}</textarea></div>
      <p class="note" style="margin:0">差し込み：${esc((placeholders || []).join("　"))}（名前・題名・日時・長さ・参加の URL・アーカイブの URL）</p>
      <label class="check"><input type="checkbox" id="sn-active" ${!n || n.active ? "checked" : ""}> <span>使う（外すと送らない）</span></label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small" type="submit">${n ? "保存" : "足す"}</button>${n ? `<button class="btn ghost small" type="button" id="sn-send">まだ受け取っていない申込者へいま送る</button>` : ""}<span class="note" id="sn-status"></span></div>
    </form></div>`;
  const sync = () => { const now = $("sn-unit").value === "now"; $("sn-n").classList.toggle("hidden", now); $("sn-dir").classList.toggle("hidden", now); };
  $("sn-unit").addEventListener("change", sync); sync();
  $("sn-edit").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("sn").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const unit = $("sn-unit").value;
    if (unit !== "now" && !(Number($("sn-n").value) > 0)) { $("sn-status").textContent = "いつ送るかの数を入れてください"; return; }
    const body = { key: n ? n.key : "n-" + Date.now().toString(36), offset_minutes: offsetFrom($("sn-n").value, unit, $("sn-dir").value), subject: $("sn-sub").value.trim(), body: $("sn-body").value, active: $("sn-active").checked };
    const r = await api(`/api/admin/seminars/${x.id}/notices`, { method: "POST", token, body });
    if (!r.ok) { $("sn-status").textContent = SEM_WHY[r.error] || "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    openSeminar(x.id, { tab: "notices", msg: (r.created ? "足しました" : "保存しました") + (r.warnings && r.warnings.length ? "。" + r.warnings.join("。") : "") });
  });
  if ($("sn-send")) $("sn-send").addEventListener("click", async () => {
    if (!confirm(`「${n.subject}」を、まだ受け取っていない申込者へいま送ります。よいですか`)) return;
    $("sn-status").textContent = "送っています…";
    const r = await api(`/api/admin/seminars/${x.id}/send`, { method: "POST", token, body: { key: n.key } });
    if (!r.ok) { $("sn-status").textContent = "送れませんでした（" + (r.error || r.status) + "）"; return; }
    openSeminar(x.id, { tab: "notices", msg: `送った ${r.sent}・送らなかった ${r.blocked}・失敗 ${r.failed}・受け取り済み ${r.skipped}` });
  });
}

// ---------- B の便 3：AI と承認 ----------
const MODE_LABEL = { auto: "自動", approve: "承認", deny: "禁止" };
const AP_LABEL = { pending: "承認待ち", approved: "承認して実行した", rejected: "却下した", expired: "期限切れ", failed: "実行に失敗" };

async function loadApprovalBadge() {
  const r = await api("/api/admin/approvals?status=pending", { token });
  const n = r.ok ? r.count : 0;
  $("ai-badge").textContent = n > 0 ? String(n) : "";
  $("ai-badge").classList.toggle("hidden", !(n > 0));
  setChip("chip-ai", n);
}

// 便 8g-4：承認の中身。まとめて動かす（publish_block）は、動かす部品の一覧（種類・名前・宛先の人数）を表で並べる
function approvalBody(x) {
  const args = x.args || {};
  if (Array.isArray(args._preview)) {
    const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !["_preview", "step_ids"].includes(k)));
    return `<div class="note" style="margin:0 0 4px">${esc(args.campaign_name || "")}・ブロック「${esc(args.block_name || "")}」の下書き ${args._preview.length} 個を動かします（承認した時点でこの番号のものだけが動く）</div>
      <div class="bp-table-wrap"><table class="bp-table" style="min-width:0"><thead><tr><th>種類</th><th>名前</th><th>きっかけ → する</th><th class="r">宛先の人数</th></tr></thead>
      <tbody>${args._preview.map((p) => `<tr><td>${esc(p.type)}</td><td>${esc(p.name)}</td><td>${esc(p.trigger)} → ${esc(p.action)}</td><td class="r num">${p.audience == null ? "—" : p.audience}</td></tr>`).join("")}</tbody></table></div>
      <p class="note" style="margin:4px 0 0">宛先の人数は、いまセレクタに当たる人の数。動かした時刻より後のきっかけだけが対象。</p>
      <details style="margin-top:4px"><summary class="note">中身（そのまま）</summary><pre class="note" style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(rest, null, 2))}</pre></details>`;
  }
  return `<details><summary class="note">中身（そのまま）</summary><pre class="note" style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(args, null, 2))}</pre></details>`;
}

// 便 9：承認の中身を読める言葉で並べる（誰に・件名・宛先・本文など）。番号のままの中身は下の「中身（そのまま）」に残す
function approvalRef(x) {
  const a = x.args || {}, ref = x.ref || {};
  const rows = [];
  if (ref.person) rows.push(["誰に", `${ref.person.name || "（名前なし）"}・${ref.person.email}`]);
  else if (a.person_id) rows.push(["誰に", "（この人は見つかりませんでした）"]);
  if (ref.broadcast) {
    rows.push(["件名", ref.broadcast.subject]);
    rows.push(["宛先", filterText(ref.broadcast.filter || {}) + (ref.broadcast.target_count != null ? `・${ref.broadcast.target_count} 人` : "")]);
  }
  if (a.subject && !ref.broadcast) rows.push(["件名", a.subject]);
  if (a.filter) rows.push(["宛先", filterText(a.filter)]);
  if (a.label) rows.push(["ラベル", a.label]);
  if (a.text) rows.push(["本文", a.text]);
  if (a.body) rows.push(["本文", a.body]);
  if (a.corrected) rows.push(["添削後", a.corrected]);
  if (a.comment) rows.push(["コメント", a.comment]);
  if (a.url !== undefined) rows.push(["住所", a.url === "" ? "（外す）" : "入れる（住所は画面に出しません）"]);
  if (a.amount !== undefined) rows.push(["金額", Number(a.amount).toLocaleString("ja-JP") + " 円"]);
  if (a.decision) rows.push(["決めること", a.decision]);
  // 便 13：セミナーの回と知らせ
  if (a.title) rows.push(["題名", a.title]);
  if (a.starts_at) rows.push(["日時", a.starts_at]);
  if (a.zoom_url !== undefined) rows.push(["参加の URL", a.zoom_url || "（空）"]);
  if (a.form_slug !== undefined) rows.push(["申込のフォーム", a.form_slug || "（結ばない）"]);
  if (a.thanks_page_slug !== undefined) rows.push(["サンクスページ", a.thanks_page_slug || "（移さない）"]);
  if (a.key && a.seminar_id) rows.push(["知らせ", a.key + (a.offset_minutes === undefined ? "" : a.offset_minutes === null ? "・申込の直後" : a.offset_minutes >= 0 ? `・開催の ${a.offset_minutes} 分前` : `・開催の ${-a.offset_minutes} 分あと`)]);
  if (!rows.length) return "";
  return `<dl class="ap-ref">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="pre">${esc(v)}</dd>`).join("")}</dl>`;
}

async function loadAi() {
  const focus = location.hash.startsWith("#approval/") ? location.hash.slice(10) : "";
  const [r] = await Promise.all([api("/api/admin/approvals?status=all", { token }), ensureSay()]);
  if (!r.ok) { $("ap-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; }
  else {
    const pending = r.approvals.filter((x) => x.status === "pending");
    $("ap-count").textContent = pending.length === 0 ? "承認待ちは 0 件です" : `承認待ち ${pending.length} 件（頼まれてから 24 時間で期限切れ）`;
    $("approvals").innerHTML = r.approvals.slice(0, 20).map((x) => `
      <div class="deal-box" ${x.id === focus ? 'style="outline:2px solid var(--accent)"' : ""}>
        <div class="note">${fmtTime(x.created_at)}・AI が頼んだ・<span class="pill ${x.status === "pending" ? "warn" : "gray"}">${esc(AP_LABEL[x.status] || x.status)}</span></div>
        <h4 style="margin:4px 0">${esc(sayOf(x.tool))}</h4>
        ${approvalRef(x)}
        ${approvalBody(x)}
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
        <div style="min-width:0"><div>${esc(sayOf(x.tool))}</div><div class="sub">${esc(x.note || "")}</div></div>
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
  // 便 11a：人の項目で絞る（1 つ）
  const fk = $("bf-fkey").value, fop = $("bf-fop").value, fv = $("bf-fval").value.trim();
  if (fk && (fv || fop === "empty" || fop === "not_empty")) f.fields = [{ key: fk, op: fop, value: fv }];
  return f;
}
const splitList = (v) => String(v || "").split(/[,、]/).map((x) => x.trim()).filter(Boolean);
let triggerNames = {}, actionNames = {};
function showConnectorFields() {
  const tr = $("sf-trigger").value, ac = $("sf-action").value;
  document.querySelectorAll("[data-tr]").forEach((x) => x.classList.toggle("hidden", !x.dataset.tr.split(" ").includes(tr)));
  document.querySelectorAll("[data-ac]").forEach((x) => x.classList.toggle("hidden", !x.dataset.ac.split(" ").includes(ac)));
}
function connectorText(s) {
  const ta = s.trigger_args || {};
  const when = (triggerNames[s.trigger] || s.trigger) + (s.product_id ? "（" + s.product_id + "）" : "") + (ta.label ? "「" + ta.label + "」" : "") + (ta.url ? "（" + String(ta.url).slice(0, 30) + "）" : "") + (ta.form ? "「" + (formNames[ta.form] || ta.form) + "」" : "") + (ta.page ? "「" + (pageNames[ta.page] || ta.page) + "」" : "") + (ta.button ? "のボタン " + ta.button : "") + (s.delay_hours ? `・${s.delay_hours} 時間後` : "");
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
  for (const c of f.fields || []) parts.push("項目 " + (fieldNames[c.key] || c.key) + " " + (OP_LABEL[c.op] || c.op) + (["empty", "not_empty"].includes(c.op) ? "" : " " + c.value));
  return parts.join("／") || "全員";
}
let deliverReady = false, deliverData = null, bfTabs = null, sfTabs = null;
async function loadDeliver() {
  loadFieldOptions();
  if (!deliverReady) {
    deliverReady = true;
    $("bf-src").innerHTML = ["x", "note", "youtube", "direct", "other"].map((s) => `<label class="check" style="margin:0"><input type="checkbox" value="${s}"> <span>${esc(SOURCE_LABEL[s] || s)}</span></label>`).join("");
    bfTabs = wireTabs($("bf"), "body");
    sfTabs = wireTabs($("sf"), "tr");
    $("bf-count").addEventListener("click", async () => {
      const r = await api("/api/admin/audience", { method: "POST", token, body: { filter: bfFilter() } });
      $("bf-status").textContent = r.ok ? `宛先 ${r.count} 人（配信を止めている人 ${r.unsubscribed}）${r.open_to_all ? "" : "・いまはテスト宛てにだけ届く"}` : "数えられませんでした（" + (r.error || r.status) + "）";
    });
    $("bf").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const r = await api("/api/admin/broadcasts", { method: "POST", token, body: { subject: $("bf-subject").value, body: $("bf-body").value, filter: bfFilter() } });
      if (!r.ok) { $("bf-status").textContent = "保存できませんでした（" + (r.error || r.status) + "）"; return; }
      await loadDeliver();
      const b = (deliverData.broadcasts || []).find((x) => x.id === (r.broadcast && r.broadcast.id)) || deliverData.broadcasts[0];
      if (b) openBroadcast(b, `下書きにしました（宛先 ${r.audience.count} 人）。送るときは上の「送る」を押します`);
    });
    $("bc-new").addEventListener("click", () => {
      $("bf").reset(); $("bf-status").textContent = ""; bfTabs("body");
      $("bc-detail").innerHTML = ""; $("bf-wrap").classList.remove("hidden"); $("sf-wrap").classList.add("hidden");
      showPane("deliver", "detail", "新しい一斉配信", "メールの一覧へ");
    });
    $("dv-run").addEventListener("click", async () => {
      $("dv-run").disabled = true;
      const r = await api("/api/admin/deliver/run", { method: "POST", token });
      $("dv-run").disabled = false;
      $("dv-run-status").classList.remove("hidden");
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
        trigger_args: tr === "label_added" ? { label: $("sf-tlabel").value.trim() } : tr === "clicked" && $("sf-turl").value.trim() ? { url: $("sf-turl").value.trim() } : tr === "form_submitted" && $("sf-tform").value ? { form: $("sf-tform").value }
          : tr === "page_viewed" || tr === "page_clicked" ? { ...($("sf-tpage").value ? { page: $("sf-tpage").value } : {}), ...(tr === "page_clicked" && $("sf-tbutton").value.trim() ? { button: $("sf-tbutton").value.trim() } : {}) } : {},
        delay_hours: Number($("sf-delay").value.replace(/[^0-9]/g, "") || 0), selector,
        action: ac, action_args: ac === "add_label" ? { label: $("sf-alabel").value.trim() } : {},
        subject: $("sf-subject").value, body: $("sf-body").value,
        active: $("sf-active").checked,
      };
      if ($("sf-id").value) body.id = Number($("sf-id").value);
      const r = await api("/api/admin/steps", { method: "POST", token, body });
      if (!r.ok) { $("sf-status").textContent = "保存できませんでした（" + (r.error || r.status) + "）"; return; }
      await loadDeliver();
      const s = stepsCache.find((x) => x.id === r.step.id);
      if (s) openConnector(s, true);
      $("sf-status").textContent = "保存しました";
    });
    $("sf-new").addEventListener("click", () => openConnector(null, false, "auto"));
    $("ms-new").addEventListener("click", () => openConnector(null, false, "mail"));
    $("sf-trigger").addEventListener("change", showConnectorFields);
    $("sf-action").addEventListener("change", showConnectorFields);
  }
  const r = await api("/api/admin/deliver", { token });
  if (!r.ok) { $("dv-warm").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  deliverData = r;
  $("dv-warm").textContent = (r.warm ? `今日の上限 ${r.warm.cap} 通（送り始めて ${r.warm.day + 1} 日目・今日 ${r.warm.sent_today} 通）` : "デモの置き場") + (r.open_to_all ? "" : "・いまはテスト宛てにだけ届く");
  await loadCampaigns();
  const bcRows = campRows("deliver", "broadcast", r.broadcasts, (b) => b.id, () => loadDeliver());
  // 便 20：メールを送るコネクタはステップ配信（メールの画面）、送らないものは自動の動き（ファネル構築の画面）
  const mailSteps = r.steps.filter(isMailStep), autoSteps = r.steps.filter((s) => !isMailStep(s));
  const msRows = campRows("mailsteps", "step", mailSteps, (s) => s.id, () => loadDeliver());
  const stRows = campRows("connect", "step", autoSteps, (s) => s.id, () => loadDeliver());
  table("broadcasts", [
    { key: "subject", label: "件名", html: (b) => `<div class="c-name">${esc(b.subject)}</div><div class="sub">${esc(filterText(b.filter || {}))}</div>` },
    { key: "status", label: "状態", html: (b) => pill(BC_LABEL[b.status] || b.status, b.status === "draft" || b.status === "canceled" ? "gray" : b.status === "done" ? "" : "warn") },
    { key: "sent", label: "送った", sortVal: (b) => b.sent || 0, html: (b) => `${b.sent}${b.target_count != null ? ` <span class="sub">／${b.target_count}</span>` : ""}` },
    { key: "clicked_people", label: "押した人", cls: "c-src", sortVal: (b) => b.clicked_people || 0, html: (b) => String(b.clicked_people || 0) },
    campCol("broadcast", (b) => b.id),
    { key: "created_at", label: "作った日", cls: "c-reg", html: (b) => esc(dayOf(b.created_at)) },
  ], bcRows, (b) => openBroadcast(b), r.broadcasts.length ? "この企画のメールはありません" : "まだありません。「新しく作る」から作ります");
  stepsCache = r.steps;
  if (r.triggers && !$("sf-trigger").options.length) {
    triggerNames = r.triggers; actionNames = r.actions || {};
    $("sf-trigger").innerHTML = Object.entries(triggerNames).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    $("sf-action").innerHTML = Object.entries(actionNames).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    showConnectorFields();
  }
  loadLabelNames();
  table("mail-steps", [
    { key: "subject", label: "件名", html: (s) => { const c = connectorText(s); return `<div class="c-name">${esc(s.subject || s.name)}</div><div class="sub">${esc(c.when)} → ${esc(c.who)}</div>`; } },
    { key: "active", label: "状態", sortVal: (s) => (s.active ? 1 : 0), html: (s) => s.active ? pill("動いている") : pill("止めている", "gray") },
    { key: "delay_hours", label: "何時間後", cls: "c-src", sortVal: (s) => s.delay_hours || 0, html: (s) => String(s.delay_hours || 0) },
    { key: "sent", label: "送った", sortVal: (s) => s.sent || 0, html: (s) => `${s.sent || 0} <span class="sub">押した ${s.clicks || 0}</span>` },
    campCol("step", (s) => s.id),
  ], msRows, (s) => openConnector(s), mailSteps.length ? "この企画のステップ配信はありません" : "まだありません。「新しく作る」から作ります");
  table("steps", [
    { key: "name", label: "名前", html: (s) => { const c = connectorText(s); return `<div class="c-name">${esc(s.name)}</div><div class="sub">${esc(c.when)} → ${esc(c.who)} → ${esc(c.what)}</div>`; } },
    { key: "active", label: "状態", sortVal: (s) => (s.active ? 1 : 0), html: (s) => s.active ? pill("動いている") : pill("止めている", "gray") },
    campCol("step", (s) => s.id),
    { key: "result", label: "結果", nosort: true, cls: "c-reg", html: (s) => esc(stepResult(s)) },
  ], stRows, (s) => openConnector(s), autoSteps.length ? "この企画の自動の動きはありません" : "まだありません。「新しく作る」から作ります");
}
const isMailStep = (s) => !s.action || s.action === "send_email";
async function openStepById(id) {
  await loadDeliver();
  const s = stepsCache.find((x) => String(x.id) === String(id));
  if (s) openConnector(s);
}
const stepResult = (s) => (s.action === "notify_admin" ? `知らせた ${s.notified || 0}` : s.action === "add_label" ? `付けた ${s.labeled || 0}` : `送った ${s.sent}・押した ${s.clicks} 回`) + (s.skipped ? `・条件外 ${s.skipped}` : "");

function openBroadcast(b, msg) {
  const r = deliverData || {};
  $("bf-wrap").classList.add("hidden"); $("sf-wrap").classList.add("hidden");
  showPane("deliver", "detail", b.subject, "メールの一覧へ");
  $("bc-detail").innerHTML = headHtml({
    title: b.subject,
    sub: `作った日 ${esc(dayOf(b.created_at))}`,
    pills: [pill(BC_LABEL[b.status] || b.status, b.status === "draft" || b.status === "canceled" ? "gray" : b.status === "done" ? "" : "warn"), r.open_to_all ? pill("誰にでも届く", "warn") : pill("いまはテスト宛てにだけ届く", "gray")],
    actions: `${b.status === "draft" ? `<button class="btn small" type="button" id="bc-queue">送る</button>` : ""}${["draft", "queued", "sending"].includes(b.status) ? `<button class="btn ghost small" type="button" id="bc-cancel">止める</button>` : ""}`,
    foot: campPicker("broadcast", b.id),
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}`
    + tabsHtml([["result", "結果"], ["body", "中身"], ["who", "宛先"]], "result")
    + `<section class="card" data-pane="result"><dl class="kv">
        <dt>宛先</dt><dd>${b.target_count ?? "送る列に入れたときに数える"}${b.target_count != null ? " 人" : ""}</dd>
        <dt>送った</dt><dd>${b.sent}・送らなかった ${b.blocked}・失敗 ${b.failed}</dd>
        <dt>リンクを押した</dt><dd>${b.clicked_people} 人（${b.clicks} 回）</dd>
      </dl></section>
      <section class="card" data-pane="body"><div class="note" style="margin-bottom:6px">件名：${esc(b.subject)}</div><div class="pre">${esc(b.body || "")}</div></section>
      <section class="card" data-pane="who"><p style="margin:0">${esc(filterText(b.filter || {}))}</p><p class="note" style="margin:8px 0 0">${r.open_to_all ? "いまは条件に当たった人に本当に届きます" : "いまはテスト宛てにだけ届きます"}</p></section>`;
  wireTabs($("bc-detail"), "result");
  wireCampPicker($("bc-detail"), () => loadDeliver());
  if ($("bc-queue")) $("bc-queue").addEventListener("click", async () => {
    // 便 9：確認の文に、件名・宛先・いま誰に届くかを出す（「使い方」の送る前に見ることと同じ中身）
    if (!confirm(`この一斉配信を送る列に入れます。\n\n件名：${b.subject || ""}\n宛先：${filterText(b.filter || {})}\n${r.open_to_all ? "いまは誰にでも届きます" : "いまはテスト宛てにだけ届きます"}\n\n毎時の定時の処理で、今日の上限の中から送ります。`)) return;
    const q = await api(`/api/admin/broadcasts/${b.id}/queue`, { method: "POST", token });
    if (!q.ok) return fail("送る列に入れられませんでした（" + (q.error || q.status) + "）");
    await loadDeliver();
    const nb = deliverData.broadcasts.find((x) => x.id === b.id); if (nb) openBroadcast(nb, "送る列に入れました。毎時の定時の処理で送ります");
  });
  if ($("bc-cancel")) $("bc-cancel").addEventListener("click", async () => {
    const q = await api(`/api/admin/broadcasts/${b.id}/cancel`, { method: "POST", token });
    if (!q.ok) return fail("止められませんでした（" + (q.error || q.status) + "）");
    await loadDeliver();
    const nb = deliverData.broadcasts.find((x) => x.id === b.id); if (nb) openBroadcast(nb, "止めました");
  });
}

// 便 20：同じ欄（#sf-wrap）を、メールを送るものはメールの画面、送らないものはファネル構築の画面の詳細へ移して出す
function openConnector(s, keepStatus, kind) {
  const mail = s ? isMailStep(s) : kind === "mail";
  const home = mail ? "deliver" : "blueprint";
  const cur = document.querySelector('.side [data-view][aria-selected="true"]');
  if (!cur || cur.dataset.view !== home) openView(home);
  selectVtab(home, mail ? "step" : "auto");
  $(home + "-detail").appendChild($("sf-wrap"));
  $("sf-wrap").classList.remove("hidden");
  if (mail) { $("bc-detail").innerHTML = ""; $("bf-wrap").classList.add("hidden"); }
  const what = mail ? "ステップ配信" : "自動の動き";
  showPane(home, "detail", s ? (mail ? s.subject || s.name : s.name) : "新しい" + what, what + "の一覧へ");
  if (!s) {
    $("sf").reset(); $("sf-id").value = "";
    const ac = mail ? "send_email" : ([...$("sf-action").options].find((o) => o.value !== "send_email") || {}).value;
    if (ac) $("sf-action").value = ac;
    $("sf-head").innerHTML = headHtml({ title: "新しい" + what, sub: mail ? "① 何をした人に → ② 誰に → ③ 何時間後にこのメールを送る、の順に決めて保存します。「動かす」に印を付けると、その時刻より後のきっかけから動きます" : "① 〜したら → ② 誰に → ③ 〜する の順に決めて保存します。「動かす」に印を付けると、その時刻より後のきっかけから動きます" });
  } else {
    const ta = s.trigger_args || {}, sel = s.selector || {}, c = connectorText(s);
    $("sf-id").value = s.id; $("sf-name").value = s.name; $("sf-trigger").value = s.trigger; $("sf-product").value = s.product_id || "";
    $("sf-tlabel").value = ta.label || ""; $("sf-turl").value = ta.url || ""; $("sf-tform").value = ta.form || ""; $("sf-tpage").value = ta.page || ""; $("sf-tbutton").value = ta.button || "";
    $("sf-labels").value = (sel.labels || []).join(","); $("sf-nolabels").value = (sel.not_labels || []).join(",");
    $("sf-action").value = s.action || "send_email"; $("sf-alabel").value = (s.action_args || {}).label || "";
    $("sf-delay").value = s.delay_hours; $("sf-subject").value = s.subject; $("sf-body").value = s.body; $("sf-active").checked = s.active;
    $("sf-head").innerHTML = headHtml({ title: s.name, sub: `${esc(c.when)} → ${esc(c.who)} → ${esc(c.what)}`, pills: [s.active ? pill("動いている") : pill("止めている", "gray"), pill(stepResult(s), "gray")], foot: campPicker("step", s.id) });
    wireCampPicker($("sf-head"), () => loadDeliver());
  }
  if (!keepStatus) $("sf-status").textContent = "";
  sfTabs("tr");
  showConnectorFields();
}

// ---------- フォームと人の項目（便 11a） ----------
const OP_LABEL = { eq: "＝", contains: "を含む", gte: "以上", lte: "以下", empty: "答えがない", not_empty: "答えがある" };
const TYPE_LABEL = { text: "1 行の文字", textarea: "長い文", number: "数", date: "日付", select: "選ぶ" };
let fieldNames = {}, formNames = {}, fieldsCache = [], formsCache = [], fieldsAt = 0, pageNames = {};
async function loadFieldOptions(force) {
  if (!force && Date.now() - fieldsAt < 30e3) return;
  fieldsAt = Date.now();
  const [fr, fo, pg] = await Promise.all([api("/api/admin/fields", { token }), api("/api/admin/forms", { token }), api("/api/admin/pages", { token })]);
  // 便 12a：コネクタのきっかけ「ページを見た／ボタンを押した」で選ぶページ
  if (pg.ok) {
    pageNames = Object.fromEntries(pg.pages.map((x) => [x.slug, x.title]));
    const keep = $("sf-tpage").value;
    $("sf-tpage").innerHTML = '<option value="">どれでも</option>' + pg.pages.map((x) => `<option value="${esc(x.slug)}">${esc(x.title)}</option>`).join("");
    $("sf-tpage").value = keep;
  }
  if (fr.ok) {
    fieldsCache = fr.fields; fieldNames = Object.fromEntries(fr.fields.map((f) => [f.key, f.label]));
    const keep = $("bf-fkey").value;
    $("bf-fkey").innerHTML = '<option value="">（使わない）</option>' + fr.fields.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join("");
    $("bf-fkey").value = keep;
  }
  if (fo.ok) {
    formsCache = fo.forms; formNames = Object.fromEntries(fo.forms.map((f) => [f.slug, f.title]));
    const keep = $("sf-tform").value;
    $("sf-tform").innerHTML = '<option value="">どれでも</option>' + fo.forms.map((f) => `<option value="${esc(f.slug)}">${esc(f.title)}</option>`).join("");
    $("sf-tform").value = keep;
  }
}

async function loadPersonValues(id) {
  const r = await api(`/api/admin/people/${id}/values`, { token });
  if (current !== id || !$("pv-box")) return;
  if (!r.ok) { $("pv-box").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  if (!r.values.length && !r.answers.length) { $("pv-box").textContent = "フォームの答えはまだありません。答えると、ここに項目と回答の履歴が並びます。"; return; }
  $("pv-box").classList.remove("note");
  $("pv-box").innerHTML = `
    <div class="note" style="margin:0 0 8px">項目（フォームの答えの新しい方）</div>
    <dl class="kv" style="margin:0 0 12px">${r.values.map((v) => `<dt>${esc(v.label)}</dt><dd class="pre">${esc(v.value)}</dd>`).join("") || "<dd class=\"note\">（無し）</dd>"}</dl>
    <details class="setup"><summary>回答の履歴 ${r.answers.length} 件</summary>
      ${r.answers.map((a) => `<div class="card" style="margin-top:8px"><div class="reply-h">${esc(a.form.title)}・${fmtTime(a.submitted_at)}</div><dl>${a.items.map((i) => `<dt>${esc(i.label)}</dt><dd class="pre">${esc(i.value) || '<span class="note">（空）</span>'}</dd>`).join("")}</dl></div>`).join("")}
    </details>`;
}

let formsReady = false, currentForm = null, fieldsAll = [];
async function loadForms() {
  if (!formsReady) {
    formsReady = true;
    $("fm-new").addEventListener("click", () => formEditor(null));
    $("fd-new").addEventListener("click", () => fieldEditor(null));
  }
  const [fr, fo] = await Promise.all([api("/api/admin/fields?all=1", { token }), api("/api/admin/forms", { token })]);
  if (!fr.ok || !fo.ok) { $("fm-count").textContent = "読めませんでした（" + ((fr.ok ? fo : fr).error || "") + "）"; return; }
  fieldsAt = 0;
  fieldsAll = fr.fields;
  fieldsCache = fr.fields.filter((f) => !f.archived_at);
  fieldNames = Object.fromEntries(fr.fields.map((f) => [f.key, f.label]));
  formsCache = fo.forms;
  $("fm-count").textContent = fo.store === "demo" ? "デモの置き場ではフォームは作れません" : `${fo.count} 件・公開中 ${fo.forms.filter((f) => f.active).length}`;
  await loadCampaigns();
  const fmRows = campRows("forms", "form", fo.forms, (f) => f.id, () => loadForms());
  table("forms-table", [
    { key: "title", label: "題名", html: (f) => `<div class="c-name">${esc(f.title)}</div><div class="sub">/form?f=${esc(f.slug)}</div>` },
    { key: "active", label: "状態", sortVal: (f) => (f.active ? 1 : 0), html: (f) => f.active ? pill("公開中") : pill("止めている", "gray") },
    { key: "answers", label: "回答", html: (f) => String(f.answers) },
    campCol("form", (f) => f.id),
    { key: "last_answer_at", label: "最後の回答", cls: "c-reg", html: (f) => esc(f.last_answer_at ? ago(f.last_answer_at) : "—") },
  ], fmRows, (f) => formEditor(f), fo.forms.length ? "この企画のフォームはありません" : "まだありません。「新しく作る」から作ります");
  table("fields-table", [
    { key: "label", label: "項目の名前", html: (f) => `<div class="c-name">${esc(f.label)}</div>${f.type === "select" ? `<div class="sub">${esc((f.options || []).join("・"))}</div>` : ""}` },
    { key: "type", label: "型", html: (f) => esc(TYPE_LABEL[f.type] || f.type) },
    { key: "archived_at", label: "状態", sortVal: (f) => (f.archived_at ? 1 : 0), html: (f) => f.archived_at ? pill("しまった", "gray") : pill("使っている") },
  ], fr.fields, (f) => fieldEditor(f), "まだありません。「新しく作る」から足します");
}

// 人の項目の詳細（足す・名前や選択肢を直す・しまう）。中の名前は自動で付ける（画面に英字を出さないため）
function fieldEditor(f, msg) {
  showPane("forms", "detail", f ? f.label : "新しい項目", "人の項目の一覧へ");
  $("form-detail").innerHTML = headHtml({
    title: f ? f.label : "新しい項目",
    sub: f ? esc(TYPE_LABEL[f.type] || f.type) : "フォームで聞く欄を足します。型（文字・数・日付・選ぶ）はあとから変えられません",
    pills: f ? [f.archived_at ? pill("しまった", "gray") : pill("使っている")] : [],
    actions: f ? `<button class="btn ghost small" type="button" id="fd-arch">${f.archived_at ? "戻す" : "しまう"}</button>` : "",
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}
    <section class="card" style="margin-top:16px"><form id="fd" class="stack">
      <div><label for="fd-label">項目の名前</label><input id="fd-label" type="text" maxlength="40" placeholder="例 X アカウント名" value="${esc(f ? f.label : "")}"></div>
      <div><label for="fd-type">型</label><select id="fd-type" class="inline" ${f ? "disabled" : ""}>${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${f && f.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div id="fd-opts-wrap" class="${f && f.type === "select" ? "" : "hidden"}"><label for="fd-opts">選択肢（カンマ区切り）</label><input id="fd-opts" type="text" placeholder="例 はい,いいえ" value="${esc(f ? (f.options || []).join(",") : "")}"></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">${f ? "保存" : "足す"}</button><span class="note" id="fd-status"></span></div>
    </form></section>`;
  $("fd-type").addEventListener("change", () => $("fd-opts-wrap").classList.toggle("hidden", $("fd-type").value !== "select"));
  $("fd").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const type = f ? f.type : $("fd-type").value;
    const body = { key: f ? f.key : "f_" + Date.now().toString(36), label: $("fd-label").value.trim() };
    if (!f) body.type = type;
    if (type === "select") body.options = $("fd-opts").value;
    const r = await api("/api/admin/fields", { method: "POST", token, body });
    const why = { bad_label: "項目の名前を入れてください（40 字まで）", need_options: "選択肢を入れてください", bad_options: "選択肢は 30 個・各 60 字まで" };
    if (!r.ok) { $("fd-status").textContent = why[r.error] || "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadForms();
    fieldEditor(r.field, r.created ? "足しました。フォームの詳細の「聞く項目」に出ます" : "保存しました");
  });
  if ($("fd-arch")) $("fd-arch").addEventListener("click", async () => {
    const r = await api("/api/admin/fields", { method: "POST", token, body: { key: f.key, archived: !f.archived_at } });
    if (!r.ok) return fail("変えられませんでした（" + (r.error || r.status) + "）");
    await loadForms();
    fieldEditor(r.field, r.field.archived_at ? "しまいました。フォームには出ません（これまでの答えは残ります）" : "戻しました");
  });
}

function formEditor(f, msg) {
  currentForm = f ? f.id : null;
  showPane("forms", "detail", f ? f.title : "新しいフォーム", "フォームの一覧へ");
  const items = new Map(((f && f.items) || []).map((it) => [it.key, it]));
  const url = f ? location.origin + "/form?f=" + f.slug : "";
  $("form-detail").innerHTML = headHtml({
    title: f ? f.title : "新しいフォーム",
    sub: f ? `/form?f=${esc(f.slug)}` : "題名と聞く項目を決めて保存します。「公開する」に印を付けると住所が開きます",
    pills: f ? [f.active ? pill("公開中") : pill("止めている", "gray"), pill(`回答 ${f.answers}`, "gray")] : [],
    actions: f && f.active ? `<a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener">公開のページを開く</a><button class="btn ghost small" type="button" id="fe-copy">住所を写す</button>` : "",
    foot: f ? campPicker("form", f.id) : "",
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}`
    + (f ? tabsHtml([["edit", "中身"], ["answers", `回答 ${f.answers}`]], "edit") : `<div style="height:16px"></div>`)
    + `<section class="card" data-pane="edit"><form id="fe" class="stack">
      <div><label for="fe-title">題名</label><input id="fe-title" type="text" maxlength="80" value="${esc(f ? f.title : "")}"></div>
      <div><label for="fe-slug">住所の名前（英小文字・数字・ハイフン。/form?f= のあと）</label><input id="fe-slug" type="text" maxlength="41" autocapitalize="off" autocomplete="off" placeholder="例 monthly" value="${esc(f ? f.slug : "")}"></div>
      <div><label for="fe-intro">最初の説明</label><textarea id="fe-intro" rows="3">${esc(f ? f.intro : "")}</textarea></div>
      <div><label for="fe-thanks">送ったあとに出す文</label><textarea id="fe-thanks" rows="2" placeholder="空なら「受け取りました。ありがとうございます。」">${esc(f ? f.thanks : "")}</textarea></div>
      <div class="note">聞く項目（上から並ぶ）</div>
      <div class="fm-items">${fieldsCache.map((x) => `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label class="check"><input type="checkbox" data-item="${esc(x.key)}" ${items.has(x.key) ? "checked" : ""}> <span>${esc(x.label)} <span class="note">${esc(TYPE_LABEL[x.type] || x.type)}</span></span></label>
        <label class="check"><input type="checkbox" data-req="${esc(x.key)}" ${items.get(x.key) && items.get(x.key).required ? "checked" : ""}> <span class="note">必須</span></label></div>`).join("") || '<p class="note">人の項目がまだありません。一覧の「人の項目」のタブで先に足します</p>'}</div>
      <label class="check"><input type="checkbox" id="fe-askname" ${!f || f.ask_name ? "checked" : ""}> <span>お名前も聞く</span></label>
      <label class="check"><input type="checkbox" id="fe-active" ${f && f.active ? "checked" : ""}> <span>公開する（外すと住所を開いても「開いていません」と出る）</span></label>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">保存</button><span class="note" id="fe-status"></span></div>
    </form></section>`
    + (f ? `<section class="card" data-pane="answers"><div id="fe-answers" class="note">読んでいます…</div></section>` : "");
  if (f) wireTabs($("form-detail"), "edit");
  wireCampPicker($("form-detail"), () => loadForms());
  if ($("fe-copy")) $("fe-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(url); $("fe-copy").textContent = "写しました"; } catch { $("fe-copy").textContent = "写せませんでした"; } });
  $("fe").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const order = fieldsCache.map((x) => x.key);
    const picked = [...document.querySelectorAll("[data-item]:checked")].map((x) => x.dataset.item);
    const body = {
      title: $("fe-title").value.trim(), slug: $("fe-slug").value.trim().toLowerCase(), intro: $("fe-intro").value, thanks: $("fe-thanks").value,
      items: order.filter((k) => picked.includes(k)).map((k) => ({ key: k, required: !!document.querySelector(`[data-req="${k}"]:checked`) })),
      ask_name: $("fe-askname").checked, active: $("fe-active").checked,
    };
    if (f) body.id = f.id;
    const r = await api("/api/admin/forms", { method: "POST", token, body });
    const why = { bad_title: "題名を入れてください", bad_slug: "住所の名前は英小文字・数字・ハイフンの 2〜41 字", slug_taken: "その住所の名前はほかのフォームで使っています", need_items: "聞く項目を 1 つ以上選んでください" };
    if (!r.ok) { $("fe-status").textContent = why[r.error] || "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadForms();
    const nf = formsCache.find((x) => x.id === r.form.id);
    if (nf) formEditor(nf, body.active ? "保存しました（公開中）" : "保存しました（まだ公開していません）");
  });
  if (f) loadFormAnswers(f.id);
}

async function loadFormAnswers(id) {
  const r = await api(`/api/admin/forms/${id}/answers`, { token });
  if (currentForm !== id || !$("fe-answers")) return;
  if (!r.ok) { $("fe-answers").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  $("fe-answers").innerHTML = r.answers.map((a) => `<div class="card" style="margin-top:8px">
    <div class="reply-h"><a href="#" data-pp="${esc(a.person.id)}">${esc(a.person.name || a.person.email || "（名前なし）")}</a>・${fmtTime(a.submitted_at)}</div>
    <dl>${a.items.map((i) => `<dt>${esc(i.label)}</dt><dd class="pre">${esc(i.value) || '<span class="note">（空）</span>'}</dd>`).join("")}</dl></div>`).join("") || "まだありません";
  document.querySelectorAll("[data-pp]").forEach((x) => x.addEventListener("click", (ev) => { ev.preventDefault(); openView("people"); detail(x.dataset.pp); }));
}

// ---------- 便 12a：ページ。中身は Claude が書く。ここでは依頼文を出す・見る・公開する・数を見る ----------
const PAGE_PURPOSE = { signup: "無料登録", seminar: "セミナーの申込", sale: "販売", news: "お知らせ", thanks: "サンクス（申込のあとに出す）" };
const PAGE_STATE = { draft: ["下書き", "gray"], published: ["公開中", ""], stopped: ["止めている", "gray"] };
const ROUTE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_\-ー・]{0,39}$/u;
const pageState = (p) => { const [t, k] = PAGE_STATE[p.status] || [p.status, "gray"]; return pill(t, k); };
const madeBy = (by) => (by === "mcp" ? "Claude" : String(by || "").includes("@") ? "Naoki" : by || "—");
let pagesReady = false, pagesCache = [], pagesOrigin = "", currentPage = null;
// 依頼文の箱（コピーのボタンつき）
function promptBox(prompt, id) {
  return `<section class="card stack" style="margin-top:16px">
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap"><b>依頼文</b><button class="btn small" type="button" id="${id}-copy">写す</button></div>
    <textarea id="${id}" rows="12" readonly style="font-size:13px">${esc(prompt)}</textarea>
    <p class="note" style="margin:0">Claude のチャット（claude.ai）に貼ります。下書きが届くと、このページの「版」に出ます</p></section>`;
}
function wirePromptBox(id) {
  const b = $(id + "-copy");
  if (!b) return;
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($(id).value); b.textContent = "写しました"; }
    catch { $(id).select(); b.textContent = "選びました（⌘C で写す）"; }
  });
}
async function loadPages() {
  if (!pagesReady) {
    pagesReady = true;
    $("pg-new").addEventListener("click", () => newPageRequest());
    $("rt-make").addEventListener("submit", (ev) => { ev.preventDefault(); makeRouteUrl("rt"); });
    $("rt-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("rt-url").textContent); $("rt-copy").textContent = "写しました"; } catch { $("rt-copy").textContent = "写せませんでした"; } });
  }
  const r = await api("/api/admin/pages", { token });
  if (!r.ok) { $("pg-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  pagesCache = r.pages; pagesOrigin = r.pages_origin || "";
  $("pg-count").textContent = r.store === "demo" ? "デモの置き場ではページは作れません"
    : `${r.count} 枚・公開中 ${r.pages.filter((p) => p.status === "published").length}` + (r.open_new_requests ? `・下書き待ちの新しい依頼 ${r.open_new_requests}` : "");
  await loadCampaigns();
  const rows = campRows("pages", "page", r.pages, (p) => p.id, () => loadPages());
  table("pages-table", [
    { key: "title", label: "ページ", html: (p) => `<div class="c-name">${esc(p.title)}</div><div class="sub">${esc(p.purpose_label)}・/${esc(p.slug)}</div>` },
    { key: "status", label: "状態", html: (p) => pageState(p) + (p.open_requests ? " " + pill(`依頼 ${p.open_requests}`, "gray") : "") },
    { key: "week_viewers", label: "先週見た人", html: (p) => String(p.week_viewers) },
    { key: "latest_version", label: "版", html: (p) => `最新 ${p.latest_version}${p.published_version ? `<div class="sub">公開 ${p.published_version}</div>` : ""}` },
    campCol("page", (p) => p.id),
  ], rows, (p) => openPage(p.id), r.pages.length ? "この企画のページはありません" : "まだありません。「新しく作る」から依頼文を出します");
  $("rt-page").innerHTML = r.pages.map((p) => `<option value="${esc(p.slug)}">${esc(p.title)}</option>`).join("") || '<option value="">（ページがまだありません）</option>';
  loadRoutes();
}
// 経路の住所を作る（prefix は一覧の rt か詳細の pd）
function makeRouteUrl(prefix, slugFixed) {
  const slug = slugFixed || $(prefix + "-page").value, name = $(prefix + "-name").value.trim();
  $(prefix + "-msg").textContent = "";
  if (!slug) { $(prefix + "-msg").textContent = "先にページを作ります"; return; }
  if (!ROUTE_NAME_RE.test(name)) { $(prefix + "-msg").textContent = "経路の名前は 1〜40 字（空白・記号は使えません。例 x-固定ポスト）"; return; }
  $(prefix + "-url").textContent = `${pagesOrigin}/${slug}?r=${encodeURIComponent(name)}`;
  $(prefix + "-out").classList.remove("hidden");
  $(prefix + "-copy").textContent = "写す";
}
async function loadRoutes() {
  const r = await api("/api/admin/pages/routes?days=30", { token });
  if (!r.ok) { $("rt-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  $("rt-count").textContent = `直近 30 日・経路 ${r.count} 本`;
  table("routes-table", [
    { key: "route", label: "経路", html: (x) => `<div class="c-name">${esc(x.route)}</div>` },
    { key: "viewers", label: "見た人", html: (x) => String(x.viewers) },
    { key: "registered", label: "登録", html: (x) => String(x.registered) },
    { key: "bought", label: "買った", html: (x) => String(x.bought) },
  ], r.routes, null, "まだありません。上でページと経路の名前を選んで住所を作り、X などに貼ります");
}
// 新しく作る：依頼の欄を埋めて依頼文を出す
function newPageRequest() {
  showPane("pages", "detail", "新しいページ", "ページの一覧へ");
  $("page-detail").innerHTML = headHtml({ title: "新しいページ", sub: "目的と材料を書いて「依頼文を出す」を押します。出た依頼文を Claude に貼ると、下書きがこの一覧に届きます" })
    + `<section class="card" style="margin-top:16px"><form id="pr" class="stack">
      <div><label for="pr-purpose">目的</label><select id="pr-purpose" class="inline">${Object.entries(PAGE_PURPOSE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="pr-title">ページの名前（お客さんに見える名前）</label><input id="pr-title" type="text" maxlength="80" placeholder="例 図解セミナー 11 月の申込"></div>
      <div><label for="pr-camp">企画</label><select id="pr-camp" class="inline"><option value="">（あとで決める）</option>${liveCamps().map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
      <div><label for="pr-ref">参考にする構成（ページの住所や、どのページの作りを真似るか）</label><textarea id="pr-ref" rows="2" placeholder="例 UTAGE の「シアラボ4~2ヶ月LPファネル」のページ"></textarea></div>
      <div><label for="pr-mat">材料（Google ドライブのファイル名・フォルダ名・中身のメモ）</label><textarea id="pr-mat" rows="3" placeholder="例 ドライブの「図解セミナー 構成メモ」と「受講者の声 2026」"></textarea></div>
      <div><label for="pr-com">ほかに伝えたいこと</label><textarea id="pr-com" rows="3" placeholder="例 申込の枠は図解セミナーのフォームを使う。ボタンを押したら知らせてほしい"></textarea></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">依頼文を出す</button><span class="note" id="pr-status"></span></div>
    </form></section><div id="pr-out"></div>`;
  $("pr").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = { purpose: $("pr-purpose").value, title: $("pr-title").value.trim(), campaign_id: $("pr-camp").value || null, reference: $("pr-ref").value, materials: $("pr-mat").value, comment: $("pr-com").value };
    const r = await api("/api/admin/pages/requests", { method: "POST", token, body });
    const why = { bad_title: "ページの名前を入れてください（80 字まで）", too_long: "長すぎる欄があります（2,000 字まで）" };
    if (!r.ok) { $("pr-status").textContent = why[r.error] || "出せませんでした（" + (r.error || r.status) + "）"; return; }
    $("pr-status").textContent = `依頼番号 ${r.request.id} で残しました`;
    $("pr-out").innerHTML = promptBox(r.prompt, "pr-prompt");
    wirePromptBox("pr-prompt");
    loadPages();
  });
}
async function openPage(id, opts = {}) {
  currentPage = id;
  showPane("pages", "detail", "読んでいます…", "ページの一覧へ");
  $("page-detail").innerHTML = '<p class="note">読んでいます…</p>';
  if (!pagesOrigin) { const l = await api("/api/admin/pages", { token }); if (l.ok) { pagesOrigin = l.pages_origin || ""; pagesCache = l.pages; } }
  // Claude が下書きを置いたときに依頼の企画へ入れるので、企画の持ち主は毎回読み直す
  await loadCampaigns(true);
  const r = await api("/api/admin/pages/" + id, { token });
  if (currentPage !== id) return;
  if (!r.ok || !r.found) { $("page-detail").innerHTML = `<p class="note">読めませんでした（${esc(r.error || "見つかりません")}）</p>`; return; }
  renderPage(r, opts);
}
function renderPage(r, { tab = "view", version: wantV, msg } = {}) {
  const p = r.page, vers = r.versions || [];
  let curV = wantV || p.latest_version || null;
  showPane("pages", "detail", p.title, "ページの一覧へ");
  const live = p.status === "published";
  $("page-detail").innerHTML = headHtml({
    title: p.title,
    sub: `${esc(p.purpose_label)}・<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https:[/][/]/, ""))}</a>`,
    pills: [pageState(p), p.latest_version ? pill(`最新 版 ${p.latest_version}`, "gray") : pill("下書きはまだ", "gray"), live ? pill(`公開中 版 ${p.published_version}`) : ""],
    actions: (curV ? `<button class="btn small" type="button" id="pd-pub">版 ${curV} を公開する</button>` : "")
      + (live ? `<a class="btn ghost small" href="${esc(p.url)}" target="_blank" rel="noopener">公開のページを開く</a><button class="btn ghost small" type="button" id="pd-stop">公開を止める</button>` : ""),
    foot: campPicker("page", p.id),
  }) + (msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : "")
    + tabsHtml([["view", "見た目"], ["versions", `版 ${vers.length}`], ["requests", "依頼とコメント"], ["numbers", "数と経路"]], tab)
    + `<section class="card stack" data-pane="view">${curV ? `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="pd-ver" class="inline">${vers.map((v) => `<option value="${v.version}" ${v.version === curV ? "selected" : ""}>版 ${v.version}${v.version === p.published_version && live ? "（公開中）" : ""}・${esc(fmtTime(v.created_at))}</option>`).join("")}</select>
          <div class="tabs" role="tablist" style="margin:0"><button type="button" data-w="100%" aria-selected="true">パソコン</button><button type="button" data-w="390px" aria-selected="false">スマホ</button></div>
          <a class="btn ghost small" id="pd-open" href="#" target="_blank" rel="noopener">別の窓で見る</a>
        </div>
        <p class="note" id="pd-vnote" style="margin:0"></p>
        <div style="border:1px solid var(--line, #ddd);border-radius:8px;overflow:hidden;background:#fff"><iframe id="pd-frame" title="ページの見た目" style="display:block;width:100%;height:70vh;border:0;margin:0 auto" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe></div>
        <p class="note" style="margin:0">見本では申込の枠から送れず、見た数にも入りません</p>`
      : `<p class="note">まだ下書きが届いていません。「依頼とコメント」の依頼文を Claude に貼ると、ここに出ます</p>`}</section>
      <section class="card" data-pane="versions"><div id="pd-versions" class="table-wrap"></div></section>
      <section class="card stack" data-pane="requests">
        <div><label for="pd-com">直してほしいところ</label><textarea id="pd-com" rows="4" placeholder="例 1 つ目のボタンの文を「無料で申し込む」に。実績の段を上へ"></textarea></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="button" id="pd-fix" ${curV ? "" : "disabled"}>直しの依頼文を出す</button><span class="note" id="pd-fix-status"></span></div>
        <div id="pd-prompt-out"></div>
        <div id="pd-requests" class="table-wrap"></div>
      </section>
      <section class="card stack" data-pane="numbers">
        <div class="stats" style="display:flex;gap:12px;flex-wrap:wrap">
          <div class="stat"><b>${r.stats.viewers}</b>先週見た人</div><div class="stat"><b>${r.stats.views}</b>見た回数</div><div class="stat"><b>${r.stats.form_people}</b>このページから答えた人</div>
        </div>
        <div><b>ボタン</b><div id="pd-clicks" class="table-wrap"></div></div>
        <div><b>経路（先週の見た人）</b><div id="pd-routes" class="table-wrap"></div></div>
        <form id="pd-rt" class="stack" style="margin:0">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div style="flex:1 1 200px"><label for="pd-name">経路の名前</label><input id="pd-name" type="text" maxlength="40" placeholder="例 x-固定ポスト"></div><button class="btn small" type="submit">このページの住所を作る</button></div>
          <div id="pd-out" class="hidden" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><code id="pd-url" style="word-break:break-all"></code><button class="btn ghost small" type="button" id="pd-copy">写す</button></div>
          <p class="note" id="pd-msg" style="margin:0"></p>
        </form>
      </section>`;
  const root = $("page-detail");
  const showTab = wireTabs(root, tab);
  wireCampPicker(root, () => loadPages());
  // 見た目：版を選ぶと見本の住所を差し替える
  const setV = (v) => {
    curV = Number(v);
    const src = (r.previews || {})[curV];
    if ($("pd-frame")) { $("pd-frame").src = src || "about:blank"; $("pd-open").href = src || "#"; }
    const meta = vers.find((x) => x.version === curV) || {};
    if ($("pd-vnote")) $("pd-vnote").textContent = [meta.note, meta.made_by ? `作った：${madeBy(meta.made_by)}` : "", meta.request_id ? `依頼 ${meta.request_id}` : "",
      meta.parts && (meta.parts.forms || []).length ? `申込の枠 ${(meta.parts.forms || []).join("・")}` : "", meta.parts && (meta.parts.buttons || []).length ? `ボタン ${(meta.parts.buttons || []).join("・")}` : ""].filter(Boolean).join("　");
    if ($("pd-pub")) $("pd-pub").textContent = live && curV === p.published_version ? `版 ${curV} を公開中` : `版 ${curV} を公開する`;
    if ($("pd-pub")) $("pd-pub").disabled = live && curV === p.published_version;
    if ($("pd-fix")) $("pd-fix").textContent = `版 ${curV} の直しの依頼文を出す`;
  };
  if (curV && $("pd-ver")) {
    $("pd-ver").addEventListener("change", (ev) => setV(ev.target.value));
    root.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-w]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $("pd-frame").style.width = b.dataset.w;
    }));
    setV(curV);
  }
  table("pd-versions", [
    { key: "version", label: "版", html: (v) => `版 ${v.version}${live && v.version === p.published_version ? " " + pill("公開中") : ""}` },
    { key: "created_at", label: "いつ", cls: "c-reg", html: (v) => esc(fmtTime(v.created_at)) },
    { key: "made_by", label: "作った", html: (v) => esc(madeBy(v.made_by)) },
    { key: "note", label: "メモ", html: (v) => `<span class="sub">${esc(v.note || "—")}</span>` },
  ], vers, (v) => { showTab("view"); if ($("pd-ver")) { $("pd-ver").value = String(v.version); setV(v.version); } }, "まだありません");
  table("pd-requests", [
    { key: "id", label: "依頼", html: (q) => `${q.kind === "fix" ? "直す" : "新しく作る"}<div class="sub">番号 ${q.id}${q.base_version ? `・版 ${q.base_version} から` : ""}</div>` },
    { key: "created_at", label: "いつ", cls: "c-reg", html: (q) => esc(fmtTime(q.created_at)) },
    { key: "comment", label: "中身", html: (q) => `<span class="sub">${esc(String(q.comment || "—").slice(0, 80))}</span>` },
    { key: "done_version", label: "状態", sortVal: (q) => q.done_version || 0, html: (q) => q.done_version ? pill(`版 ${q.done_version} ができた`) : pill("下書き待ち", "gray") },
  ], r.requests || [], null, "まだありません");
  table("pd-clicks", [
    { key: "button", label: "ボタン", html: (x) => esc(x.button.startsWith("checkout:") ? "申し込む（" + x.button.slice(9) + "）" : x.button) },
    { key: "n", label: "先週押した数", html: (x) => String(x.n) },
  ], r.stats.clicks || [], null, "先週はまだ押されていません");
  table("pd-routes", [
    { key: "route", label: "経路", html: (x) => esc(x.route) },
    { key: "viewers", label: "見た人", html: (x) => String(x.viewers) },
  ], r.stats.routes || [], null, "先週はまだ見られていません");
  $("pd-rt").addEventListener("submit", (ev) => { ev.preventDefault(); makeRouteUrl("pd", p.slug); });
  $("pd-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("pd-url").textContent); $("pd-copy").textContent = "写しました"; } catch { $("pd-copy").textContent = "写せませんでした"; } });
  $("pd-fix").addEventListener("click", async () => {
    const comment = $("pd-com").value.trim();
    if (!comment) { $("pd-fix-status").textContent = "直してほしいところを書いてください"; return; }
    const q = await api("/api/admin/pages/requests", { method: "POST", token, body: { page_id: p.id, comment, base_version: curV } });
    if (!q.ok) { $("pd-fix-status").textContent = "出せませんでした（" + (q.error || q.status) + "）"; return; }
    $("pd-fix-status").textContent = `依頼番号 ${q.request.id} で残しました`;
    $("pd-prompt-out").innerHTML = promptBox(q.prompt, "pd-prompt");
    wirePromptBox("pd-prompt");
  });
  if ($("pd-pub")) $("pd-pub").addEventListener("click", async () => {
    $("pd-pub").disabled = true;
    const q = await api(`/api/admin/pages/${p.id}/publish`, { method: "POST", token, body: { version: curV } });
    if (!q.ok) { $("pd-pub").disabled = false; return fail("公開できませんでした（" + (q.error || q.status) + "）"); }
    await loadPages();
    openPage(p.id, { version: curV, msg: `版 ${curV} を公開しました。住所 ${p.url}` });
  });
  if ($("pd-stop")) $("pd-stop").addEventListener("click", async () => {
    if (!confirm("公開を止めますか？　住所を開くと「ページが見つかりません」と出ます")) return;
    const q = await api(`/api/admin/pages/${p.id}/publish`, { method: "POST", token, body: { stop: true } });
    if (!q.ok) return fail("止められませんでした（" + (q.error || q.status) + "）");
    await loadPages();
    openPage(p.id, { msg: "公開を止めました" });
  });
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

// ---------- 紹介（便 8g-2・便 18 で一覧の表 → 詳細） ----------
let referCache = [];
const yen = (n) => Number(n || 0).toLocaleString() + " 円";
async function loadReferrals(focusId, msg) {
  const r = await api("/api/admin/referrals", { token });
  if (!r.ok) { $("rf-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  referCache = r.referrers;
  $("rf-count").textContent = r.count ? `紹介した人 ${r.count} 人・まだ払っていない報酬 ${yen(r.unpaid_total)}（紹介から ${r.days} 日以内の購入だけ）` : "紹介のリンクから登録した人はまだいません";
  table("referrers", [
    { key: "name", label: "紹介した人", sortVal: (x) => x.name || x.email, html: (x) => `<div class="c-name">${esc(x.name || x.email)}</div><div class="sub">${esc(x.email)}</div>` },
    { key: "referred", label: "紹介で登録", html: (x) => `${x.referred} 人` },
    { key: "purchases", label: "購入", cls: "c-src", html: (x) => `${x.purchases} 件` },
    { key: "reward_total", label: "報酬", cls: "c-reg", html: (x) => esc(yen(x.reward_total)) },
    { key: "unpaid", label: "未払い", html: (x) => x.unpaid ? pill(yen(x.unpaid), "warn") : pill("0 円", "gray") },
  ], r.referrers, (x) => referrerDetail(x.referrer_id), "紹介のリンクから登録した人はまだいません");
  if (focusId) referrerDetail(focusId, msg);
}
function referrerDetail(id, msg) {
  const x = referCache.find((y) => y.referrer_id === id);
  if (!x) return;
  showPane("refer", "detail", x.name || x.email, "紹介の一覧へ");
  $("referrer-detail").innerHTML = headHtml({
    title: x.name || x.email,
    sub: `${esc(x.email)}・紹介の番号 ${esc(x.code)}`,
    pills: [pill(`報酬 ${yen(x.reward_total)}`, "gray"), pill(`払った ${yen(x.paid_total)}`, "gray"), x.unpaid ? pill(`まだ払っていない ${yen(x.unpaid)}`, "warn") : ""],
    actions: `<button class="btn ghost small" type="button" id="rf-copy">紹介のリンクを写す</button>`,
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}`
    + tabsHtml([["people", `紹介で来た人 ${x.people.length}`], ["pay", "払った記録"]], "people")
    + `<section class="card" data-pane="people">
        <p class="note" style="word-break:break-all;margin:0 0 8px">紹介のリンク：<code>${esc(x.link)}</code></p>
        <div id="rf-people" class="table-wrap"></div>
      </section>
      <section class="card" data-pane="pay">
        ${x.unpaid ? `<form id="rf-pay" class="stack">
          <div><label for="rf-amount">払った金額（円）</label><input id="rf-amount" type="text" inputmode="numeric" value="${x.unpaid}"></div>
          <div><label for="rf-note">メモ（任意・例 10/31 振込）</label><input id="rf-note" type="text" maxlength="200"></div>
          <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">払ったことを記録する</button><span class="note" id="rf-status"></span></div>
          <p class="note" style="margin:0">払う作業（振込など）は B の外で行い、ここには記録だけを残します</p>
        </form>` : `<p class="note" style="margin:0">まだ払っていない報酬はありません。紹介で来た人が報酬の付く商品を買うと、ここで払った記録を付けられます</p>`}
      </section>`;
  wireTabs($("referrer-detail"), "people");
  table("rf-people", [
    { key: "name", label: "名前", sortVal: (q) => q.name || q.email || "", html: (q) => `<div class="c-name">${esc(q.name || q.email || "（名前なし）")}</div>` },
    { key: "at", label: "登録した日", html: (q) => esc(dayOf(q.at)) },
    { key: "bought", label: "購入", html: (q) => `${q.bought} 件` },
    { key: "reward", label: "報酬", html: (q) => esc(q.reward ? yen(q.reward) : "—") },
  ], x.people, (q) => { if (q.id) { openView("people"); detail(q.id); } }, "まだいません");
  $("rf-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(x.link); $("rf-copy").textContent = "写しました"; } catch { $("rf-copy").textContent = "写せませんでした"; } });
  if (!x.unpaid) return;
  $("rf-pay").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const amount = Number(String($("rf-amount").value).replace(/[^0-9]/g, ""));
    $("rf-status").textContent = "記録しています…";
    const r = await api("/api/admin/referrals/paid", { method: "POST", token, body: { referrer_id: x.referrer_id, amount, note: $("rf-note").value } });
    if (!r.ok) { $("rf-status").textContent = r.error === "over_unpaid" ? "まだ払っていない分（" + yen(r.unpaid) + "）を超えています" : "記録できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadReferrals(x.referrer_id, "払ったことを記録しました");
  });
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
async function loadProducts(focusId, msg) {
  const r = await api("/api/admin/products", { token });
  if (!r.ok) { $("pr-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  productsCache = r.products;
  const sellable = r.products.filter((p) => p.active).length, shown = r.products.filter((p) => p.public).length;
  $("pr-count").textContent = `${r.count} 件・売っている ${sellable}・サイトに出している ${shown}${r.store === "demo" ? "（デモの置き場：見本だけ）" : ""}`;
  await loadCampaigns();
  const prRows = campRows("products", "product", r.products, (p) => p.id, () => loadProducts());
  table("products", [
    { key: "name", label: "名前", html: (p) => `<div class="c-name">${esc(p.name)}</div>${p.list_price_of ? `<div class="sub">紹介用の価格</div>` : ""}` },
    { key: "kind", label: "種類", cls: "c-src", sortVal: (p) => KIND_LABEL[p.kind] || p.kind, html: (p) => esc(KIND_LABEL[p.kind] || p.kind) },
    { key: "amount", label: "値段", sortVal: (p) => Number(p.amount) || 0, html: (p) => esc(priceOf(p)) },
    { key: "sold", label: "売れた", sortVal: (p) => p.sold || 0, html: (p) => String(p.sold) },
    campCol("product", (p) => p.id),
    { key: "active", label: "状態", sortVal: (p) => (p.active ? 2 : 0) + (p.public ? 1 : 0), html: (p) => (p.active ? pill("売る") : pill("売らない", "gray")) + (p.public ? " " + pill("サイト") : "") },
  ], prRows, (p) => productDetail(p.id), r.products.length ? "この企画の商品はありません" : "まだありません");
  if (focusId) productDetail(focusId, msg);
}
function productDetail(id, msg) {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  showPane("products", "detail", p.name, "商品の一覧へ");
  const link = location.origin + "/register?product=" + encodeURIComponent(p.id);
  const ro = p.kind === "installment" ? "disabled" : "";
  $("product-detail").innerHTML = headHtml({
    title: p.name,
    sub: `${esc(KIND_LABEL[p.kind] || p.kind)}・${esc(priceOf(p))}・売れた ${p.sold}${p.list_price_of ? "・紹介用（元：" + esc(p.list_price_of) + "）" : ""}`,
    pills: [p.active ? pill("売る") : pill("売らない", "gray"), p.public ? pill("サイトに出す") : pill("サイトに出さない", "gray")],
    actions: `<button class="btn ghost small" id="pf-copy" type="button">申し込みのリンクを写す</button>`,
    foot: campPicker("product", p.id),
  }) + `${msg ? `<p class="msg ok" style="margin:12px 0 0">${esc(msg)}</p>` : ""}`
    + tabsHtml([["edit", "設定"], ["link", "申し込みのリンク"]], "edit")
    + `<section class="card" data-pane="edit">
      ${p.note ? `<p class="note" style="margin-top:0">${esc(p.note)}</p>` : ""}
      <form id="pf" class="stack">
      <div><label for="pf-name">名前</label><input id="pf-name" type="text" maxlength="120" value="${esc(p.name)}"></div>
      <div><label for="pf-amount">金額（円）</label><input id="pf-amount" type="text" inputmode="numeric" value="${p.amount}"></div>
      ${p.kind === "subscription" ? `<div><label for="pf-period">周期</label><select id="pf-period" class="inline"><option value="monthly" ${p.period === "monthly" ? "selected" : ""}>毎月</option><option value="annually" ${p.period === "annually" ? "selected" : ""}>毎年</option></select></div>` : ""}
      ${p.kind === "one_time" ? `<div><label for="pf-days">権利の日数（空なら期限なし）</label><input id="pf-days" type="text" inputmode="numeric" value="${p.grant_days ?? ""}"></div>` : ""}
      <div><label for="pf-limit">販売数の上限（空なら無し）</label><input id="pf-limit" type="text" inputmode="numeric" value="${p.sales_limit ?? ""}"></div>
      <div><label for="pf-rate">紹介の報酬（%・空なら払わない）</label><input id="pf-rate" type="text" inputmode="numeric" value="${p.affiliate_rate ?? ""}"></div>
      <div><label for="pf-grants">権利の印（カンマ区切り。例 shiarabo_basic）</label><input id="pf-grants" type="text" value="${esc((p.grants || []).join(","))}"></div>
      <div><label for="pf-desc">説明（生徒に見える）</label><textarea id="pf-desc" rows="2">${esc(p.description || "")}</textarea></div>
      <label class="check"><input type="checkbox" id="pf-multi" ${p.deny_multiple ? "checked" : ""}> <span>重ねて買えない</span></label>
      <label class="check"><input type="checkbox" id="pf-active" ${p.active ? "checked" : ""} ${ro}> <span>売る</span></label>
      <label class="check"><input type="checkbox" id="pf-public" ${p.public ? "checked" : ""} ${ro}> <span>サイトの一覧に出す（出さなくても、申し込みのリンクを渡した人は買える）</span></label>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit" ${ro}>保存</button><span class="note" id="pf-status"></span></div>
    </form></section>
    <section class="card" data-pane="link">
      <p class="note" style="margin-top:0">このリンクを開くと、登録のあとにこの商品の申し込みに進みます</p>
      <p style="word-break:break-all;margin:0"><code>${esc(link)}</code></p>
    </section>`;
  wireTabs($("product-detail"), "edit");
  wireCampPicker($("product-detail"), () => loadProducts());
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
    // 便 8g-2：紹介の報酬の率は、変えたときだけ送る
    if (num($("pf-rate").value) !== (p.affiliate_rate ?? null)) body.affiliate_rate = num($("pf-rate").value);
    if ($("pf-period")) body.period = $("pf-period").value;
    if ($("pf-days")) body.grant_days = num($("pf-days").value);
    $("pf-status").textContent = "保存しています…";
    const r = await api("/api/admin/products", { method: "POST", token, body });
    if (!r.ok) { $("pf-status").textContent = "保存できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadProducts(p.id, r.changed && Object.keys(r.changed).length ? "保存しました（変えたところ：" + Object.keys(r.changed).map((k) => PF_LABEL[k] || k).join("・") + "）" : "変わったところはありません");
  });
}
const PF_LABEL = { name: "名前", amount: "金額", period: "周期", grant_days: "権利の日数", sales_limit: "販売数の上限", affiliate_rate: "紹介の報酬", grants: "権利の印", description: "説明", deny_multiple: "重ねて買えない", active: "売る", public: "サイトに出す" };

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
async function loadHome() {
  const [r, b] = await Promise.all([api("/api/admin/today", { token }), api("/api/admin/board", { token }), ensureSay()]);
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
      + row(t.approvals.count, "承認待ち", "ai", t.approvals.items.length ? `<span class="sub">${t.approvals.items.map((x) => esc(sayOf(x.tool))).join("・")}</span>` : "")
      + row(t.rooms.count, "未返信の添削", "rooms", t.rooms.items.length ? `<span class="sub">${t.rooms.items.map((x) => esc(x.name)).join("・")}</span>` : "")
      + row(t.consults.count, "今日の個別相談", "deals", t.consults.items.length ? `<span class="sub">${t.consults.items.map((x) => esc(fmtHm(x.slot)) + " " + esc(x.name)).join("・")}</span>` : "")
      + row(t.notices.count, "今日の知らせ", "connect", t.notices.items.length ? `<span class="sub">${t.notices.items.map((x) => esc(x.connector) + "：" + esc(x.name)).join("・")}</span>` : "")
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
  $("hm-board").innerHTML = b.lanes.map((l) => `<div class="stage-col"><h4>${esc(l.label)} <span class="n">${l.count}</span></h4>${l.people.map((p) => `<button type="button" class="stage-card" data-person="${p.id}"><span class="nm">${esc(p.name || p.email)}</span>${p.name ? `<span class="sub">${esc(p.email)}</span>` : ""}</button>`).join("") || `<p class="note">${l.id === "meet" ? "まだ登録していない人は記録が無い" : l.id === "refer" ? "紹介した人はまだいない" : "0 人"}</p>`}</div>`).join("");
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
// iPhone（Safari）は、ボタンを押した直後に間に通信を挟まず購読を頼まないと、許可の確認を出さない。
// そのため鍵と画面の裏の仕組み（sw.js）は開いたときに先に用意しておき、押したら最初に subscribe を呼ぶ
let pushReady = null;
async function loadPush() {
  const st = $("push-status");
  const r = await api("/api/admin/push", { token });
  if (!r.ok) { st.textContent = "読めませんでした（" + (r.error || r.status) + "）"; return null; }
  let here = "この端末では使えません（ブラウザが通知に対応していない）";
  if (pushSupported()) {
    const ps = await pushSub().catch(() => null);
    let sub = ps && ps.sub;
    // 前の鍵で購読したままなら先に外す（違う鍵のままでは新しく購読できない）
    if (sub && sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== keyBytes(r.public_key).join()) {
      await sub.unsubscribe().catch(() => {}); sub = null;
    }
    pushReady = ps ? { reg: ps.reg, key: keyBytes(r.public_key) } : null;
    const on = sub && r.devices.some((d) => sub.endpoint.endsWith(d.endpoint_tail));
    here = !ps ? "この端末では通知の準備ができませんでした（画面を開き直すと直ることがあります）" : on ? "この端末は受け取っています" : Notification.permission === "denied" ? "この端末は通知を止めています（端末の設定 → 通知 → Lab OS で許可にすると押せます）" : "この端末はまだ受け取っていません";
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) {
    here = "iPhone は、共有ボタン →「ホーム画面に追加」で Lab OS を足し、そこから開くと押せます";
  }
  st.innerHTML = `${esc(here)}<br>受け取る端末 ${r.count} 台${r.devices.length ? "：" + r.devices.map((d) => esc(d.device || d.service)).join("・") : ""}`;
  return r;
}
function setupPush() {
  loadPush();
  $("push-on").addEventListener("click", () => {
    clearErr();
    const st = $("push-status");
    if (!pushSupported()) { loadPush(); return; }
    if (!pushReady) { st.textContent = "準備中です。数秒おいて、もう一度押してください"; loadPush(); return; }
    // 押した直後にここを呼ぶ（この前に await を置かない）
    let p;
    try { p = pushReady.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushReady.key }); }
    catch (e) { p = Promise.reject(e); }
    st.textContent = "許可の確認を待っています…";
    p.then(async (sub) => {
      const j = sub.toJSON();
      const res = await api("/api/admin/push", { method: "POST", token, body: { endpoint: j.endpoint, keys: j.keys, device: pushDevice() } });
      if (!res.ok) { st.textContent = "登録できませんでした（" + (res.error || res.status) + "）"; return; }
      await loadPush();
    }).catch((e) => {
      st.textContent = Notification.permission === "denied"
        ? "許可されなかったので受け取れません（端末の設定 → 通知 → Lab OS で許可にすると押せます）"
        : "受け取りの登録ができませんでした（" + String(e && (e.name || e.message) || e) + "）";
    });
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
  if (e.type.startsWith("seminar_")) return `<span class="note">（${esc(p.title || p.seminar_id || "")}${p.key ? "・" + esc(p.key) : ""}${p.mail ? "・メール " + esc(p.mail) : ""}）</span>`;
  if (e.type === "purchase_completed") return `<span class="note">（${esc(p.product_name || p.product_id || "")}・${Number(p.amount || 0).toLocaleString()} 円${p.grant_until ? "・" + esc(fmtTime(p.grant_until).slice(0, 10)) + " まで" : ""}${p.over_limit ? "・上限を超えた：" + esc(p.over_limit) : ""}）</span>`;
  if (e.type.startsWith("subscription_")) return `<span class="note">（${esc(p.status || "")}${p.amount ? "・" + Number(p.amount).toLocaleString() + " 円" : ""}）</span>`;
  if (e.type === "email_clicked") return `<span class="note">（${esc(String(p.url || "").slice(0, 60))}）</span>`;
  if (e.type.startsWith("email_") && e.type !== "email_unsubscribed") return `<span class="note">（${esc(p.subject || "")}${p.reason ? "・" + esc(p.reason) : ""}${p.error ? "・" + esc(p.error) : ""}）</span>`;
  if (e.type === "correction_submitted") return `<span class="note">（${esc(String(p.text || "").slice(0, 30))}${(p.images || []).length ? " 画像" + p.images.length : ""}）</span>`;
  if (e.type === "correction_returned") return `<span class="note">（${esc(String(p.comment || p.corrected || "").slice(0, 30))}）</span>`;
  if (e.type === "room_chat") return `<span class="note">（${p.from === "student" ? "生徒から" : "シアニンから"}・${esc(String(p.text || "").slice(0, 30))}${(p.images || []).length ? " 画像" + p.images.length : ""}）</span>`;
  if (e.type === "push_subscribed" || e.type === "push_unsubscribed") return `<span class="note">（${esc(p.device || "")}${p.reason ? "・" + esc(p.reason) : ""}）</span>`;
  if (e.type === "referred") return `<span class="note">（紹介の番号 ${esc(p.code || "")}）</span>`;
  if (e.type === "referral_reward") return `<span class="note">（${esc(p.product_name || p.product_id || "")}・${Number(p.amount || 0).toLocaleString()} 円の ${esc(p.rate)}%＝${Number(p.reward || 0).toLocaleString()} 円）</span>`;
  if (e.type === "referral_paid") return `<span class="note">（${Number(p.amount || 0).toLocaleString()} 円${p.note ? "・" + esc(p.note) : ""}）</span>`;
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
  $("sent").textContent = email + " にリンクを送りました。この画面で入るときは、メールの確認コードを下に入れてください。";
  $("sent").classList.remove("hidden");
  $("code-box").classList.remove("hidden");
});
// 便 8f-3：確認コードで入る（ホーム画面に足した Lab OS では、メールのリンクがこの画面ではなくブラウザで開くため）
$("otp-go").addEventListener("click", async () => {
  clearErr();
  const email = $("email").value.trim(), token = $("otp").value.replace(/\s/g, "");
  if (!email || !/^[0-9]{6,10}$/.test(token)) return fail("メールアドレスと、メールにある数字の確認コードを入れてください。");
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) return fail("確認コードが合いませんでした：" + error.message);
  await openConsole();
});
$("logout").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.reload(); });

const bp = makeBlueprint({ $, api, esc, getToken: () => token, fail, openView });

start().catch((e) => fail(e.message));

// ---------- 便 9：使い方 ----------
// できることリストは /api/admin/guide（道具の一覧の 2 欄と権限の表）から毎回組み立てる。画面の名前は左のメニューの文字を使う
let guideCache = null;
async function ensureSay(force) {
  if (guideCache && !force) return guideCache;
  const g = await api("/api/admin/guide", { token });
  if (g.ok) guideCache = g;
  return guideCache;
}
function sayOf(name) {
  const row = guideCache && guideCache.rows.find((x) => x.name === name);
  return row ? row.say : "（説明がまだ無い操作）";
}
const AI_SAY = { auto: ["そのまま動く", "gray"], approve: ["承認が要る", "warn"], deny: ["頼めない", "gray"], none: ["頼めない", "gray"] };
async function loadGuide() {
  const g = await ensureSay(true);
  if (!g) { $("gd-list").innerHTML = '<p class="note">読めませんでした。画面を開き直してください</p>'; return; }
  const order = [...document.querySelectorAll(".side [data-view]")].map((b) => b.dataset.view).filter((v) => v !== "guide");
  const title = (v) => v === "ai_only" ? "AI に頼むときだけ（画面には無い）" : (document.querySelector(`.side [data-view="${v}"]`)?.firstChild.textContent.trim() || "（どこにも無い画面）");
  const groups = [...order, "ai_only"].map((v) => [v, g.rows.filter((x) => x.screen === v)]).filter(([, rows]) => rows.length);
  $("gd-list").innerHTML = (g.missing ? `<p class="msg err">説明がまだ無い操作が ${g.missing} つあります。開発部に知らせてください</p>` : "")
    + groups.map(([v, rows]) => `
    <details class="gd-group">
      <summary class="gd-head"><span class="guide-h3">${esc(title(v))}</span><span class="note">${rows.length} 件${rows.some((x) => x.ai === "approve") ? `・AI に頼むと承認が要るもの ${rows.filter((x) => x.ai === "approve").length}` : ""}</span></summary>
      ${v === "ai_only" ? "" : `<div style="margin:6px 0"><button class="btn ghost small" type="button" data-gd-open="${esc(v)}">この画面を開く</button></div>`}
      <table class="gd-table"><thead><tr><th>できること</th><th class="gd-ai">AI に頼むと</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${esc(x.say)}</td><td class="gd-ai"><span class="pill ${AI_SAY[x.ai][1]}">${esc(AI_SAY[x.ai][0])}</span></td></tr>`).join("")}</tbody></table>
    </details>`).join("");
  document.querySelectorAll("[data-gd-open]").forEach((b) => b.addEventListener("click", () => openView(b.dataset.gdOpen)));
}

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

// ---------- 添削ルーム ----------
let currentRoom = null;
// 便 8c：左のメニュー。押した項目の画面だけを出し、上のナビにその名前を出す
const VIEWS = ["home", "blueprint", "people", "rooms", "deals", "ai", "products", "deliver", "settings", "refer", "guide", "forms"];
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
    setCrumbSub("");
    // 便 17：顧客管理はメニューから開くと一覧に戻る。開いた画面のまとまりは閉じない
    if (b.dataset.view === "people") custList();
    const box = b.closest(".grp-box");
    if (box && box.classList.contains("closed")) box.querySelector(".grp").click();
    if (b.dataset.view === "home") loadHome();
    if (b.dataset.view === "blueprint") bp.load();
    if (b.dataset.view === "deliver") loadDeliver();
    if (b.dataset.view === "products") loadProducts();
    if (b.dataset.view === "deals") loadDeals();
    if (b.dataset.view === "ai") loadAi();
    if (b.dataset.view === "refer") loadReferrals();
    if (b.dataset.view === "guide") loadGuide();
    if (b.dataset.view === "forms") loadForms();
  }));
  $("hm-guide").addEventListener("click", () => openView("guide"));
  $("cust-back").addEventListener("click", custList);
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
      openView("people");
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
  document.querySelectorAll("[data-tr]").forEach((x) => x.classList.toggle("hidden", x.dataset.tr !== tr));
  document.querySelectorAll("[data-ac]").forEach((x) => x.classList.toggle("hidden", !x.dataset.ac.split(" ").includes(ac)));
}
function connectorText(s) {
  const ta = s.trigger_args || {};
  const when = (triggerNames[s.trigger] || s.trigger) + (s.product_id ? "（" + s.product_id + "）" : "") + (ta.label ? "「" + ta.label + "」" : "") + (ta.url ? "（" + String(ta.url).slice(0, 30) + "）" : "") + (ta.form ? "「" + (formNames[ta.form] || ta.form) + "」" : "") + (s.delay_hours ? `・${s.delay_hours} 時間後` : "");
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
let deliverReady = false;
async function loadDeliver() {
  loadFieldOptions();
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
        trigger_args: tr === "label_added" ? { label: $("sf-tlabel").value.trim() } : tr === "clicked" && $("sf-turl").value.trim() ? { url: $("sf-turl").value.trim() } : tr === "form_submitted" && $("sf-tform").value ? { form: $("sf-tform").value } : {},
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
  const bcById = Object.fromEntries(r.broadcasts.map((b) => [b.id, b]));
  document.querySelectorAll("[data-bq]").forEach((x) => x.addEventListener("click", async () => {
    // 便 9：確認の文に、件名・宛先・いま誰に届くかを出す（「使い方」の送る前に見ることと同じ中身）
    const b = bcById[x.dataset.bq] || {};
    if (!confirm(`この一斉配信を送る列に入れます。\n\n件名：${b.subject || ""}\n宛先：${filterText(b.filter || {})}\n${r.open_to_all ? "いまは誰にでも届きます" : "いまはテスト宛てにだけ届きます"}\n\n毎時の定時の処理で、今日の上限の中から送ります。`)) return;
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
    $("sf-tlabel").value = ta.label || ""; $("sf-turl").value = ta.url || ""; $("sf-tform").value = ta.form || "";
    $("sf-labels").value = (sel.labels || []).join(","); $("sf-nolabels").value = (sel.not_labels || []).join(",");
    $("sf-action").value = s.action || "send_email"; $("sf-alabel").value = (s.action_args || {}).label || "";
    $("sf-delay").value = s.delay_hours; $("sf-subject").value = s.subject; $("sf-body").value = s.body; $("sf-active").checked = s.active;
    $("sf-status").textContent = "直しています：" + s.name;
    showConnectorFields();
  }));
}

// ---------- フォームと人の項目（便 11a） ----------
const OP_LABEL = { eq: "＝", contains: "を含む", gte: "以上", lte: "以下", empty: "答えがない", not_empty: "答えがある" };
const TYPE_LABEL = { text: "1 行の文字", textarea: "長い文", number: "数", date: "日付", select: "選ぶ" };
let fieldNames = {}, formNames = {}, fieldsCache = [], formsCache = [], fieldsAt = 0;
async function loadFieldOptions(force) {
  if (!force && Date.now() - fieldsAt < 30e3) return;
  fieldsAt = Date.now();
  const [fr, fo] = await Promise.all([api("/api/admin/fields", { token }), api("/api/admin/forms", { token })]);
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

let formsReady = false, currentForm = null;
async function loadForms() {
  if (!formsReady) {
    formsReady = true;
    $("fm-new").addEventListener("click", () => formEditor(null));
    $("fd-type").addEventListener("change", () => $("fd-opts-wrap").classList.toggle("hidden", $("fd-type").value !== "select"));
    $("fd").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = { key: $("fd-key").value.trim(), label: $("fd-label").value.trim(), type: $("fd-type").value };
      if (body.type === "select") body.options = $("fd-opts").value;
      const r = await api("/api/admin/fields", { method: "POST", token, body });
      const why = { bad_key: "中の名前は英小文字で始め、英小文字・数字・下線の 2〜31 字", bad_label: "項目の名前を入れてください", need_options: "選択肢を入れてください", type_locked: "その中の名前は別の型で使っています" };
      $("fd-status").textContent = r.ok ? (r.created ? "足しました" : "直しました") : (why[r.error] || "足せませんでした（" + (r.error || r.status) + "）");
      if (r.ok) { $("fd").reset(); $("fd-opts-wrap").classList.add("hidden"); await loadForms(); }
    });
  }
  const [fr, fo] = await Promise.all([api("/api/admin/fields?all=1", { token }), api("/api/admin/forms", { token })]);
  if (!fr.ok || !fo.ok) { $("fm-count").textContent = "読めませんでした（" + ((fr.ok ? fo : fr).error || "") + "）"; return; }
  fieldsAt = 0;
  fieldsCache = fr.fields.filter((f) => !f.archived_at);
  fieldNames = Object.fromEntries(fr.fields.map((f) => [f.key, f.label]));
  formsCache = fo.forms;
  $("fm-count").textContent = fo.store === "demo" ? "デモの置き場ではフォームは作れません" : `フォーム ${fo.count}・項目 ${fieldsCache.length}`;
  $("forms-list").innerHTML = fo.forms.map((f) => `
    <li data-form="${f.id}" ${f.id === currentForm ? 'aria-current="true"' : ""}>
      <div><div>${esc(f.title)}</div><div class="sub">/form?f=${esc(f.slug)}</div></div>
      <div style="text-align:right">${f.active ? '<span class="pill">公開中</span>' : '<span class="pill gray">止めている</span>'}<div class="sub">回答 ${f.answers}</div></div>
    </li>`).join("") || '<li class="note">まだありません</li>';
  document.querySelectorAll("[data-form]").forEach((li) => li.addEventListener("click", () => formEditor(formsCache.find((x) => x.id === li.dataset.form))));
  $("fields-list").innerHTML = fr.fields.map((f) => `
    <li><div><div>${esc(f.label)}${f.archived_at ? ' <span class="pill gray">しまった</span>' : ""}</div><div class="sub">${esc(TYPE_LABEL[f.type] || f.type)}${f.type === "select" ? "：" + esc((f.options || []).join("・")) : ""}</div></div>
      <div><button class="btn ghost small" type="button" data-farch="${esc(f.key)}" data-to="${f.archived_at ? "0" : "1"}">${f.archived_at ? "戻す" : "しまう"}</button></div></li>`).join("") || '<li class="note">まだありません。下で足します</li>';
  document.querySelectorAll("[data-farch]").forEach((b) => b.addEventListener("click", async () => {
    const r = await api("/api/admin/fields", { method: "POST", token, body: { key: b.dataset.farch, archived: b.dataset.to === "1" } });
    if (!r.ok) fail("変えられませんでした（" + (r.error || r.status) + "）");
    loadForms();
  }));
  if (currentForm) { const f = formsCache.find((x) => x.id === currentForm); if (f) formEditor(f, true); }
}

function formEditor(f, keepStatus) {
  currentForm = f ? f.id : null;
  document.querySelectorAll("[data-form]").forEach((li) => li.toggleAttribute("aria-current", li.dataset.form === currentForm));
  const items = new Map(((f && f.items) || []).map((it) => [it.key, it]));
  const url = f ? location.origin + "/form?f=" + f.slug : "";
  const prevStatus = keepStatus && $("fe-status") ? $("fe-status").textContent : "";
  $("form-detail").innerHTML = `
    <h3 style="margin-top:0">${f ? "フォームを直す" : "新しいフォーム"}</h3>
    ${f && f.active ? `<div class="note" style="margin:0 0 10px">公開の住所：<a href="${esc(url)}" target="_blank">${esc(url)}</a> <button class="btn ghost small" type="button" id="fe-copy">写す</button></div>` : ""}
    <form id="fe" class="stack">
      <div><label for="fe-title">題名</label><input id="fe-title" type="text" maxlength="80" value="${esc(f ? f.title : "")}"></div>
      <div><label for="fe-slug">住所の名前（英小文字・数字・ハイフン。/form?f= のあと）</label><input id="fe-slug" type="text" maxlength="41" autocapitalize="off" autocomplete="off" placeholder="例 monthly" value="${esc(f ? f.slug : "")}"></div>
      <div><label for="fe-intro">最初の説明</label><textarea id="fe-intro" rows="3">${esc(f ? f.intro : "")}</textarea></div>
      <div><label for="fe-thanks">送ったあとに出す文</label><textarea id="fe-thanks" rows="2" placeholder="空なら「受け取りました。ありがとうございます。」">${esc(f ? f.thanks : "")}</textarea></div>
      <div class="note">聞く項目（上から並ぶ。項目は「人の項目」の欄で足す）</div>
      <div class="fm-items">${fieldsCache.map((x) => `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label class="check"><input type="checkbox" data-item="${esc(x.key)}" ${items.has(x.key) ? "checked" : ""}> <span>${esc(x.label)} <span class="note">${esc(TYPE_LABEL[x.type] || x.type)}</span></span></label>
        <label class="check"><input type="checkbox" data-req="${esc(x.key)}" ${items.get(x.key) && items.get(x.key).required ? "checked" : ""}> <span class="note">必須</span></label></div>`).join("") || '<p class="note">項目がまだありません</p>'}</div>
      <label class="check"><input type="checkbox" id="fe-askname" ${!f || f.ask_name ? "checked" : ""}> <span>お名前も聞く</span></label>
      <label class="check"><input type="checkbox" id="fe-active" ${f && f.active ? "checked" : ""}> <span>公開する（外すと住所を開いても「開いていません」と出る）</span></label>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">保存</button><span class="note" id="fe-status">${esc(prevStatus)}</span></div>
    </form>
    ${f ? `<h3 style="margin-top:20px">回答 <span class="note">${f.answers} 件</span></h3><div id="fe-answers" class="note">読んでいます…</div>` : ""}`;
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
    $("fe-status").textContent = r.ok ? (body.active ? "保存しました（公開中）" : "保存しました（まだ公開していません）") : (why[r.error] || "保存できませんでした（" + (r.error || r.status) + "）");
    if (r.ok) { currentForm = r.form.id; loadForms(); }
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

// 便 8e：ラベルの名前の候補（入力欄の下に出す）
let labelNamesAt = 0;
async function loadLabelNames() {
  if (Date.now() - labelNamesAt < 60e3) return;
  labelNamesAt = Date.now();
  const r = await api("/api/admin/labels", { token });
  if (!r.ok) return;
  $("label-names").innerHTML = r.labels.map((x) => `<option value="${esc(x.label)}">${x.people} 人${x.auto ? "" : "・手"}</option>`).join("");
}

// ---------- 紹介（便 8g-2） ----------
let referCache = [];
const yen = (n) => Number(n || 0).toLocaleString() + " 円";
async function loadReferrals(focusId) {
  const r = await api("/api/admin/referrals", { token });
  if (!r.ok) { $("rf-count").textContent = "読めませんでした（" + (r.error || r.status) + "）"; return; }
  referCache = r.referrers;
  $("rf-count").textContent = r.count ? `紹介した人 ${r.count} 人・まだ払っていない報酬 ${yen(r.unpaid_total)}（紹介から ${r.days} 日以内の購入だけ）` : "紹介のリンクから登録した人はまだいません";
  $("referrers").innerHTML = r.referrers.map((x) => `
    <li data-rid="${esc(x.referrer_id)}"><div style="min-width:0"><div>${esc(x.name || x.email)}</div><div class="sub">紹介で登録 ${x.referred} 人・購入 ${x.purchases} 件</div></div>
      <div style="flex-shrink:0">${x.unpaid ? `<span class="pill warn">未払い ${esc(yen(x.unpaid))}</span>` : '<span class="pill gray">未払い 0</span>'}</div></li>`).join("");
  document.querySelectorAll("#referrers li").forEach((li) => li.addEventListener("click", () => referrerDetail(li.dataset.rid)));
  if (focusId) referrerDetail(focusId);
}
function referrerDetail(id) {
  const x = referCache.find((y) => y.referrer_id === id);
  if (!x) return;
  document.querySelectorAll("#referrers li").forEach((li) => li.toggleAttribute("aria-current", li.dataset.rid === id));
  $("referrer-detail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(x.name || x.email)}</h2>
    <div class="note">${esc(x.email)}・紹介の番号 ${esc(x.code)}</div>
    <p class="note" style="word-break:break-all"><code>${esc(x.link)}</code></p>
    <p>報酬 ${esc(yen(x.reward_total))}・払った ${esc(yen(x.paid_total))}・<b>まだ払っていない ${esc(yen(x.unpaid))}</b></p>
    <h4>紹介で来た人</h4>
    <ul class="people">${x.people.map((q) => `<li><div style="min-width:0"><div>${esc(q.name || q.email || q.id)}</div><div class="sub">${esc(fmtTime(q.at))}・購入 ${q.bought} 件${q.reward ? "・報酬 " + esc(yen(q.reward)) : ""}</div></div></li>`).join("") || '<li class="note">（まだいない）</li>'}</ul>
    ${x.unpaid ? `<form id="rf-pay" class="stack" style="margin-top:12px">
      <div><label for="rf-amount">払った金額（円）</label><input id="rf-amount" type="text" inputmode="numeric" value="${x.unpaid}"></div>
      <div><label for="rf-note">メモ（任意・例 10/31 振込）</label><input id="rf-note" type="text" maxlength="200"></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="submit">払ったことを記録する</button><span class="note" id="rf-status"></span></div>
      <p class="note" style="margin:0">払う作業（振込など）は B の外で行い、ここには記録だけを残します。</p>
    </form>` : ""}`;
  if (!x.unpaid) return;
  $("rf-pay").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const amount = Number(String($("rf-amount").value).replace(/[^0-9]/g, ""));
    $("rf-status").textContent = "記録しています…";
    const r = await api("/api/admin/referrals/paid", { method: "POST", token, body: { referrer_id: x.referrer_id, amount, note: $("rf-note").value } });
    if (!r.ok) { $("rf-status").textContent = r.error === "over_unpaid" ? "まだ払っていない分（" + yen(r.unpaid) + "）を超えています" : "記録できませんでした（" + (r.error || r.status) + "）"; return; }
    await loadReferrals(x.referrer_id);
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
      <div><label for="pf-rate">紹介の報酬（%・空なら払わない）</label><input id="pf-rate" type="text" inputmode="numeric" value="${p.affiliate_rate ?? ""}"></div>
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
    // 便 8g-2：紹介の報酬の率は、変えたときだけ送る
    if (num($("pf-rate").value) !== (p.affiliate_rate ?? null)) body.affiliate_rate = num($("pf-rate").value);
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
  if (e.type.startsWith("seminar_")) return `<span class="note">（${esc(p.seminar_id || "")}${p.mail ? "・メール " + esc(p.mail) : ""}）</span>`;
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

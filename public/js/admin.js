import { getClient, api, esc, fmtTime, SOURCE_LABEL, EVENT_LABEL } from "/js/common.js";

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
      <div style="text-align:right"><span class="pill">${esc(p.stage)}</span><div class="sub">${SOURCE_LABEL[p.source] || esc(p.source)}${p.note_member ? "・note" : ""}</div></div>
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
    </div>
    <label class="check" style="margin-bottom:16px"><input type="checkbox" id="nm" ${p.note_member ? "checked" : ""}> <span>note のメンバー（手で付ける印）</span></label>
    <ol class="timeline">${r.events.map((e) => `
      <li><time>${fmtTime(e.occurred_at)}</time>${esc(EVENT_LABEL[e.type] || e.type)}${detailText(e)}<span class="note"> · ${esc(e.actor)}</span></li>`).join("")}
    </ol>`;
  $("nm").addEventListener("change", async (ev) => {
    const res = await api("/api/admin/people/" + id, { method: "PATCH", token, body: { note_member: ev.target.checked } });
    if (!res.ok) { ev.target.checked = !ev.target.checked; return fail("変えられませんでした（" + (res.error || res.status) + "）"); }
    detail(id); search();
  });
}

function detailText(e) {
  const p = e.payload || {};
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

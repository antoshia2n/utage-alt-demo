// シアニンパネルの細い画面（/panel・2026-11-02 開発部）。今日の 5 種類の動き（名前なし）と、やることの数。
// 読むだけ。返事や書き換えはアプリ（/admin）で行う。人の行を押すと /admin#person/番号 が別タブで開く
import { getClient, api } from "./common.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORDER = [["registered", "登録"], ["purchase_completed", "購入"], ["form_submitted", "フォーム"], ["consult_booked", "予約"], ["seminar_registered", "セミナー"]];
const DOT = { registered: "#2563eb", purchase_completed: "#047857", form_submitted: "#7c3aed", consult_booked: "#b45309", seminar_registered: "#0e7490" };
const TODO = [["approvals", "承認待ち", "/admin#approval/"], ["rooms", "未返信の添削", "/admin"], ["consults", "今日の個別相談", "/admin"], ["notices", "今日の知らせ", "/admin"]];
let data = null, filter = "", loading = false;

function dayLabel(day) {
  const d = new Date(day + "T00:00:00+09:00");
  return `今日 ${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
}

function render() {
  $("mp-day").textContent = data ? dayLabel(data.day) : "今日";
  $("mp-counts").innerHTML = ORDER.map(([k, l]) => {
    const n = data.counts[k] || 0;
    const on = filter === k;
    return `<button type="button" role="tab" aria-selected="${on}" class="mp-cnt${on ? " on" : ""}${n ? "" : " zero"}" data-f="${k}"><b>${n}</b><span><i style="background:${DOT[k]}"></i>${l}</span></button>`;
  }).join("");
  const t = data.todo || {};
  $("mp-todo").innerHTML = TODO.map(([k, l]) => `<span class="${t[k] ? "hot" : ""}">${l} <b>${t[k] || 0}</b></span>`).join('<span class="mp-sep">·</span>');
  const items = data.items.filter((i) => !filter || i.type === filter);
  $("mp-lt").textContent = filter ? `今日の${ORDER.find((o) => o[0] === filter)[1]}` : "今日の動き";
  $("mp-list").innerHTML = items.length ? items.map((i) => `<a class="mp-row" href="/admin#person/${encodeURIComponent(i.person_id)}" target="_blank" rel="noopener">
      <i style="background:${DOT[i.type] || "#736a62"}"></i>
      <span class="mp-main"><b>${esc(i.label)}</b>${i.detail ? `<span>${esc(i.detail)}</span>` : ""}</span>
      <span class="mp-time">${esc(i.time)}</span><span class="mp-go-i" aria-hidden="true">↗</span></a>`).join("")
    : `<p class="mp-empty">${filter ? "この種類の動きは、今日はまだありません。" : "今日の動きはまだありません。"}</p>`;
}

async function load() {
  if (loading) return;
  loading = true;
  $("mp-re").disabled = true;
  try {
    const sb = await getClient();
    const { data: s } = await sb.auth.getSession();
    if (!s.session) { $("mp-login").hidden = false; $("mp-body").hidden = true; return; }
    const r = await api("/api/admin/moves", { token: s.session.access_token });
    if (r.status === 401 || r.status === 403) { $("mp-login").hidden = false; $("mp-body").hidden = true; return; }
    if (!r.ok) throw new Error("読めませんでした。「↻ 読み直す」を押してください");
    data = r; $("mp-login").hidden = true; $("mp-body").hidden = false; $("mp-err").hidden = true;
    render();
  } catch (e) {
    $("mp-err").textContent = e.message || "読めませんでした"; $("mp-err").hidden = false;
  } finally { loading = false; $("mp-re").disabled = false; }
}

document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-f]");
  if (f && data) { filter = filter === f.dataset.f ? "" : f.dataset.f; render(); }
});
$("mp-re").addEventListener("click", load);
// パネルへ戻ってきたら読み直す（アプリで返事をしたあと、数が古いまま残らないように）
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load();

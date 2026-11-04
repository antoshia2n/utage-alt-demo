// シアニンパネルの細い画面（/panel・2026-11-02 開発部）。今日の 5 種類の動き（名前なし）と、やることの数。
// 読むだけ。返事や書き換えはアプリ（/admin）で行う。人の行を押すと /admin#person/番号 が別タブで開く
import { getClient, api } from "./common.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORDER = [["registered", "登録"], ["purchase_completed", "購入"], ["form_submitted", "フォーム"], ["consult_booked", "予約"], ["seminar_registered", "セミナー"]];
const DOT = { registered: "#2563eb", purchase_completed: "#047857", form_submitted: "#7c3aed", consult_booked: "#b45309", seminar_registered: "#0e7490" };
// 知らせの形（2026-11-02 Naoki「通知的に見せるといいかもね。売れてるな的な」）：種類ごとの印と一言
const ICON = {
  purchase_completed: '<path d="M7 4.5l5 6.5 5-6.5M12 11v8.5M8 13.5h8M8 16.5h8"/>',
  registered: '<circle cx="10" cy="8.5" r="3.2"/><path d="M4.5 19c.6-3 2.8-4.8 5.5-4.8M17.5 13v6M14.5 16h6"/>',
  form_submitted: '<rect x="5" y="4" width="14" height="16.5" rx="2"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  consult_booked: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16M9 14.5l2 2 4-4"/>',
  seminar_registered: '<path d="M4 6.5h16v10H4z"/><path d="M9 20h6M12 16.5V20M9.5 9.5l5 1.8-5 1.8z"/>',
};
const SAY = { purchase_completed: "売れました", registered: "登録がありました", form_submitted: "フォームの回答がありました", consult_booked: "個別相談の予約が入りました", seminar_registered: "セミナーの申し込みがありました" };
const SEEN = "marke.panel.seen";
const getSeen = () => { try { return localStorage.getItem(SEEN) || ""; } catch { return ""; } };
const putSeen = (v) => { try { localStorage.setItem(SEEN, v); } catch { /* 覚えられなくても動く */ } };
let seenBefore = getSeen();
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "いま" : m < 60 ? `${m}分前` : `${Math.floor(m / 60)}時間前`;
}
const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");

const TODO = [["approvals", "承認待ち", "/admin#approval/"], ["rooms", "未返信の添削", "/admin"], ["consults", "今日の個別相談", "/admin"], ["notices", "今日の知らせ", "/admin"]];
let data = null, filter = "", loading = false;

function dayLabel(day) {
  const d = new Date(day + "T00:00:00+09:00");
  return `今日 ${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
}

function render() {
  $("mp-day").textContent = data ? dayLabel(data.day) : "今日";
  const nBuy = data.counts.purchase_completed || 0;
  const fresh = data.items.filter((i) => seenBefore && i.at > seenBefore).length;
  $("mp-hero").className = "mp-hero" + (nBuy ? " sold" : "");
  $("mp-hero").innerHTML = `<span class="mp-hl">今日の売上</span><b>${yen(data.sales)}</b><span class="mp-hs">${nBuy ? `${nBuy} 件売れました` : "今日はまだ売れていません"}${fresh ? `<span class="mp-new">新着 ${fresh}</span>` : ""}</span>`;
  $("mp-counts").innerHTML = ORDER.map(([k, l]) => {
    const n = data.counts[k] || 0;
    const on = filter === k;
    return `<button type="button" role="tab" aria-selected="${on}" class="mp-cnt${on ? " on" : ""}${n ? "" : " zero"}" data-f="${k}"><b>${n}</b><span><i style="background:${DOT[k]}"></i>${l}</span></button>`;
  }).join("");
  const t = data.todo || {};
  $("mp-todo").innerHTML = TODO.map(([k, l]) => `<span class="${t[k] ? "hot" : ""}">${l} <b>${t[k] || 0}</b></span>`).join('<span class="mp-sep">·</span>');
  const items = data.items.filter((i) => !filter || i.type === filter);
  $("mp-lt").textContent = filter ? `今日の${ORDER.find((o) => o[0] === filter)[1]}` : "今日の動き";
  $("mp-list").innerHTML = items.length ? items.map((i) => {
    const isNew = seenBefore && i.at > seenBefore;
    return `<a class="mp-note-c t-${i.type}${isNew ? " new" : ""}" href="/admin#person/${encodeURIComponent(i.person_id)}" target="_blank" rel="noopener">
      <span class="mp-ic" style="--c:${DOT[i.type] || "#736a62"}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[i.type] || ""}</svg></span>
      <span class="mp-nb"><span class="mp-nt"><b>${esc(SAY[i.type] || i.label)}</b>${isNew ? '<span class="mp-dot" aria-label="新着"></span>' : ""}<span class="mp-ago" title="${esc(i.time)}">${ago(i.at)}</span></span>
      ${i.detail ? `<span class="mp-nd">${esc(i.detail)}</span>` : ""}</span></a>`;
  }).join("")
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
    // 見た時点の一番新しい知らせを覚える（次に開いたとき、それより新しいものに「新着」を付ける）
    const newest = data.items[0] && data.items[0].at;
    if (newest && newest > getSeen()) putSeen(newest);
    if (!seenBefore && newest) seenBefore = newest; // 初めて開いたときは全部を新着にしない
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

// 契約（2026-11-12 契約の便 1・ShiaSign）：契約の台帳と書類の保管
//  ・メディア（media.js）と同じ見た目（recordings.css）と影の DOM。中身は /api/admin/contracts*
//  ・一覧 → 詳細 → 新規作成。左＝状態、真ん中＝表。探すのは言葉（取引先）・日付の範囲・金額の範囲の組み合わせ
//  ・顧客の詳細の「契約」タブにも同じ部品を出す（personId を渡すと、その人の契約だけ・新規作成はその人に結ぶ）
//  ・書類は開く（ログインの印つきで読み、画面の中だけの住所 blob: にする）・改ざんチェック（ハッシュ値を計算し直して比べる）
//  ・消すボタンは無い。「しまう」だけ（元に戻すの帯を出す）
//  ・便 2：詳細の「署名の依頼」から相手へ署名のリンクを送る（public/sign.html）
import { api } from "/js/common.js";

const ST = { draft: "下書き", ready: "署名依頼前", waiting: "署名待ち", signed: "締結済み", ended: "終了・解約" };
const ROLE = { draft: "下書き", signed: "署名済み", certificate: "締結完了証明書", other: "そのほか" };
const SRC = { upload: "アップロード", docusign: "DocuSign から移した", google_docs: "Google ドキュメント", shiasign: "署名ページ", other: "そのほか" };
const ERR = {
  need_title: "契約内容を入れてください", bad_amount: "金額は数字で入れてください（例：300000）", bad_date: "日付を選び直してください",
  end_before_start: "終了日が開始日より前になっています", bad_email: "メールアドレスの形を確かめてください", bad_status: "状態を選び直してください",
  too_big: "30MB までのファイルにしてください", empty: "空のファイルは入れられません", bad_role: "書類の種類を選んでください",
  bad_doc_url: "Google ドキュメントの住所（https://docs.google.com/document/d/…）を入れてください", not_found: "見つかりませんでした",
  no_store: "置き場につながっていません", bad_sales_contract: "売上管理の契約番号は数字で入れてください", need_name: "ファイル名がありません",
};
const MAX = 30 * 1024 * 1024;
const yen = (n) => n == null ? "" : Number(n).toLocaleString() + " 円";
const day = (s) => { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); return `${y}/${Number(m)}/${Number(d)}`; };
const size = (n) => !n ? "" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

export function mountContracts(host, { getToken, personId = null, personName = "", personEmail = "" }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  const inPerson = !!personId;
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <style>
    .fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px;margin:8px 0 12px}
    .fgrid label{display:block;font-size:12px;color:var(--muted,#6b6259);margin-bottom:3px}
    .fgrid input,.fgrid select,.fgrid textarea,.fbar input,.addf select,.addf input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--field,#a39a90);border-radius:8px;background:var(--panel,#fff);color:inherit;font:inherit}
    .fgrid .wide{grid-column:1/-1}
    .fbar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:6px 0 12px}
    .fbar>div{min-width:120px;flex:1}.fbar>div.q{flex:2;min-width:200px}
    .fbar label{display:block;font-size:12px;color:var(--muted,#6b6259);margin-bottom:3px}
    .segs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .segs button{border:1px solid var(--field,#a39a90);background:var(--panel,#fff);color:inherit;border-radius:999px;padding:6px 12px;font:inherit;cursor:pointer;min-height:36px}
    .segs button[aria-pressed=true]{background:#b45309;border-color:#b45309;color:#fff}
    .hash{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
    .ok{color:#166534}.bad{color:#b91c1c;font-weight:700}
    .addf{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;align-items:end;margin-top:10px}
    .addf label{display:block;font-size:12px;color:var(--muted,#6b6259);margin-bottom:3px}
    .soon{color:#b45309;font-weight:700}
    @media (max-width:700px){.addf{grid-template-columns:1fr}.fbar>div{min-width:45%}}
  </style>
  <div class="top"><span class="tab" aria-current="page" style="cursor:default">${inPerson ? "この人の契約" : "契約"}</span><span class="grow"></span><span class="note-top" id="note-top"></span>
    ${inPerson ? "" : '<button class="btn sm" type="button" id="zip">まとめてダウンロード（ZIP）</button>'}
    <button class="btn sm pri" type="button" id="new">新規作成</button></div>
  <div class="wrap">${inPerson ? "" : '<nav class="side" id="side" aria-label="状態"></nav>'}<main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div class="undo" id="undo" hidden><span id="undo-t"></span><button type="button" id="undo-b">元に戻す</button></div>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#note-top").textContent = t; $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;
  const tok = () => getToken();

  let S = null, F = { q: "", status: "", from: "", to: "", min: "", max: "" }, curId = null, undoFn = null, checks = {};

  // ---------- 一覧 ----------
  async function load() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(F)) if (v !== "" && v != null) p.set(k, v);
    if (inPerson) p.set("person_id", personId);
    const r = await api("/api/admin/contracts?" + p, { token: tok() });
    if (!r.ok) { $("#main").innerHTML = `<p class="lead">${esc(errText(r))}</p>`; return; }
    S = r; curId = null; drawList();
  }
  function drawSide() {
    if (inPerson) return;
    const c = S.counts || {};
    const btn = (label, n, cur, v) => `<button type="button" data-st="${v}" ${cur ? 'aria-current="page"' : ""}><span>${esc(label)}</span><span class="c">${n || 0}</span></button>`;
    $("#side").innerHTML = `<h4>状態</h4>${btn("すべて", S.total, !F.status, "")}${Object.keys(ST).map((k) => btn(ST[k], c[k], F.status === k, k)).join("")}`;
    $("#side").querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { F.status = b.dataset.st; load(); }));
  }
  function drawList() {
    drawSide();
    const rows = S.items.map((x) => {
      const left = x.days_left;
      const soon = x.status === "signed" && left != null && left >= 0 && left <= 30 ? ` <small class="soon">残り ${left} 日</small>` : "";
      return `<tr class="rw" data-id="${esc(x.id)}" tabindex="0" aria-label="「${esc(x.title)}」の詳細を開く">
        <td class="nm">${esc(x.company || x.signer_name || "（契約先なし）")}<small>${esc(x.company && x.signer_name ? x.signer_name : x.signer_email)}</small></td>
        <td>${esc(x.title)}${x.kind ? `<small>${esc(x.kind)}</small>` : ""}</td>
        <td class="num">${yen(x.amount)}</td>
        <td class="date">${day(x.signed_on)}</td>
        <td class="date">${day(x.end_date)}${soon}${x.auto_renew ? "<small>自動更新</small>" : ""}</td>
        <td><span class="st ${x.status === "signed" ? "on" : "off"}">${esc(ST[x.status])}</span>${x.status === "signed" && !x.signed_file ? '<small class="soon">署名済みの書類がまだ</small>' : ""}</td></tr>`;
    }).join("");
    const filtered = Object.entries(F).some(([k, v]) => k !== "status" && v);
    $("#main").innerHTML = `${inPerson ? "" : '<h1>契約</h1>'}
      <p class="lead">契約 1 件に、書類（下書き・署名済み・締結完了証明書）をまとめて保管します。署名済みの書類は加工せずに保管し、入れたときの指紋（ハッシュ値）で書き換えがないか確かめられます。消さずに「しまう」だけです。</p>
      <form class="fbar" id="fbar">
        <div class="q"><label for="f-q">取引先・契約内容</label><input type="search" id="f-q" value="${esc(F.q)}" placeholder="会社名・氏名・メール・言葉"></div>
        <div><label for="f-from">日付（から）</label><input type="date" id="f-from" value="${esc(F.from)}"></div>
        <div><label for="f-to">日付（まで）</label><input type="date" id="f-to" value="${esc(F.to)}"></div>
        <div><label for="f-min">金額（以上）</label><input inputmode="numeric" id="f-min" value="${esc(F.min)}" placeholder="円"></div>
        <div><label for="f-max">金額（以下）</label><input inputmode="numeric" id="f-max" value="${esc(F.max)}" placeholder="円"></div>
        <button class="btn sm pri" type="submit">探す</button>${filtered ? '<button class="btn sm" type="button" id="f-clear">条件をクリア</button>' : ""}
      </form>
      <p class="lead" style="margin-top:0">日付は締結日（まだ無ければ開始日）で探します。${S.count} 件</p>
      ${S.items.length ? `<div class="tbl list"><table><thead><tr><th>契約先</th><th>契約内容</th><th class="num">金額</th><th>締結日</th><th>終了日</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="lead">${filtered || F.status ? "条件に合う契約はありません。" : "まだ契約はありません。右上の「新規作成」から入れられます。"}</p>`}`;
    $("#fbar").addEventListener("submit", (e) => {
      e.preventDefault();
      const num = (v) => String(v || "").replace(/[,，円\s]/g, "");
      F = { ...F, q: $("#f-q").value.trim(), from: $("#f-from").value, to: $("#f-to").value, min: num($("#f-min").value), max: num($("#f-max").value) };
      load();
    });
    const cl = $("#f-clear"); if (cl) cl.addEventListener("click", () => { F = { q: "", status: F.status, from: "", to: "", min: "", max: "" }; load(); });
    $("#main").querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(tr.dataset.id); });
    });
  }

  // ---------- 入力欄（新規作成と編集で同じ） ----------
  function fields(x = {}) {
    const v = (k) => esc(x[k] ?? "");
    return `<div class="fgrid">
      <div class="wide"><label for="c-title">契約内容（必須）</label><input id="c-title" maxlength="200" value="${v("title")}" placeholder="例：X 運用コンサルティング契約"></div>
      <div><label for="c-company">会社名</label><input id="c-company" maxlength="120" value="${v("company")}"></div>
      <div><label for="c-signer">相手の氏名</label><input id="c-signer" maxlength="80" value="${inPerson && !x.id ? esc(personName) : v("signer_name")}"></div>
      <div><label for="c-email">相手のメール</label><input id="c-email" type="email" maxlength="200" value="${inPerson && !x.id ? esc(personEmail) : v("signer_email")}"></div>
      <div><label for="c-kind">種別</label><input id="c-kind" maxlength="40" list="c-kinds" value="${v("kind")}" placeholder="例：コンサル・業務委託"></div>
      <div><label for="c-amount">金額（円）</label><input id="c-amount" inputmode="numeric" value="${x.amount ?? ""}"></div>
      <div><label for="c-signed">締結日</label><input id="c-signed" type="date" value="${v("signed_on")}"></div>
      <div><label for="c-start">開始日</label><input id="c-start" type="date" value="${v("start_date")}"></div>
      <div><label for="c-end">終了日</label><input id="c-end" type="date" value="${v("end_date")}"></div>
      <div><label for="c-sales">売上管理の契約番号</label><input id="c-sales" inputmode="numeric" value="${x.sales_contract_id ?? ""}" placeholder="結ぶときだけ"></div>
      <div style="align-self:end"><label class="check" style="display:flex;gap:6px;align-items:center;font-size:14px;color:inherit"><input type="checkbox" id="c-auto" style="width:auto" ${x.auto_renew ? "checked" : ""}> 自動更新あり</label></div>
      <div class="wide"><label for="c-note">メモ</label><textarea id="c-note" rows="2" maxlength="2000">${v("note")}</textarea></div>
      <datalist id="c-kinds">${((S && S.kinds) || []).map((k) => `<option value="${esc(k)}">`).join("")}</datalist>
    </div>`;
  }
  function readFields() {
    return { title: $("#c-title").value, company: $("#c-company").value, signer_name: $("#c-signer").value, signer_email: $("#c-email").value.trim(), kind: $("#c-kind").value,
      amount: $("#c-amount").value, signed_on: $("#c-signed").value, start_date: $("#c-start").value, end_date: $("#c-end").value,
      sales_contract_id: $("#c-sales").value.trim(), auto_renew: $("#c-auto").checked, note: $("#c-note").value };
  }
  const FIELD_OF = { need_title: "#c-title", bad_amount: "#c-amount", end_before_start: "#c-end", bad_email: "#c-email", bad_sales_contract: "#c-sales" };
  const focusErr = (r) => { const f = FIELD_OF[r.error] || (r.field ? { signed_on: "#c-signed", start_date: "#c-start", end_date: "#c-end" }[r.field] : null); if (f && $(f)) $(f).focus(); };

  function openNew() {
    curId = null;
    $("#main").innerHTML = `<p><button class="btn sm" type="button" id="back">← 一覧へ</button></p><h1>新規作成</h1>
      <p class="lead">${inPerson ? `${esc(personName || personEmail)} さんの契約として入れます。` : ""}DocuSign で結んだ契約を移すときは、状態を「締結済み」にしてから、詳細で署名済みの PDF と証明書を入れてください。</p>
      <form id="cf">${fields({})}
        <div class="bar"><label for="c-status">最初の状態</label><select id="c-status" style="max-width:220px">${Object.keys(ST).map((k) => `<option value="${k}">${ST[k]}</option>`).join("")}</select>
        <button class="btn sm pri" type="submit">作成</button></div></form>`;
    $("#back").addEventListener("click", load);
    $("#c-title").focus();
    $("#cf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { ...readFields(), status: $("#c-status").value };
      if (inPerson) body.person_id = personId;
      const r = await api("/api/admin/contracts", { method: "POST", token: tok(), body });
      if (!r.ok) { say(errText(r)); focusErr(r); return; }
      say("契約を作成しました"); openDetail(r.id);
    });
  }

  // ---------- 詳細 ----------
  async function openDetail(id) {
    const r = await api("/api/admin/contracts/one?id=" + encodeURIComponent(id), { token: tok() });
    if (!r.ok) { say(errText(r)); return; }
    curId = id; drawDetail(r.contract);
  }
  function drawDetail(x) {
    const files = x.files.map((f) => {
      const c = checks[f.id];
      const res = !c ? "" : c.match ? '<small class="ok">✓ 書き換えなし</small>' : `<small class="bad">${c.missing ? "✕ 置き場に見つかりません" : "✕ 入れたときと中身が違います"}</small>`;
      return `<tr><td><span class="st ${f.role === "signed" ? "on" : "off"}">${esc(ROLE[f.role])}</span></td>
        <td class="nm">${esc(f.name)}<small>${esc(SRC[f.source] || f.source)}・${day(f.created_at)}${f.size ? "・" + size(f.size) : ""}</small></td>
        <td>${f.sha256 ? `<span class="hash" title="${esc(f.sha256)}">${esc(f.sha256.slice(0, 16))}…</span>${res}` : ""}</td>
        <td style="white-space:nowrap;text-align:right">${f.has_file ? `<button class="btn sm" type="button" data-open="${esc(f.id)}" aria-label="「${esc(f.name)}」を別タブで開く">開く ↗</button> <button class="btn sm" type="button" data-check="${esc(f.id)}" aria-label="「${esc(f.name)}」の改ざんチェック">改ざんチェック</button>` : f.url ? `<a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener">開く ↗</a>` : ""}</td></tr>`;
    }).join("");
    $("#main").innerHTML = `<p><button class="btn sm" type="button" id="back">← 一覧へ</button></p>
      <h1>${esc(x.title)}</h1>
      <p class="lead">${esc(x.company || x.signer_name || "")}${x.archived ? "・<b>しまってあります</b>" : ""}${x.requested_at ? `・署名を依頼した日 ${day(x.requested_at)}（${esc(x.requested_to)}）` : ""}</p>
      <h3>状態</h3>
      <div class="segs" role="group" aria-label="状態">${Object.keys(ST).map((k) => `<button type="button" data-set="${k}" aria-pressed="${x.status === k}">${x.status === k ? "✓ " : ""}${ST[k]}</button>`).join("")}</div>
      ${x.status === "signed" && !x.signed_file ? '<p class="lead soon">締結済みですが、署名済みの書類がまだ入っていません。下の「書類」から入れてください。</p>' : ""}
      <h3>署名の依頼</h3>
      ${signBox(x)}
      ${x.status === "signed" || x.status === "ended" ? `<h3>更新・解約</h3>${lifeBox(x)}` : ""}
      <h3>書類</h3>
      ${x.files.length ? `<div class="tbl"><table><thead><tr><th>種類</th><th>名前</th><th>指紋（SHA-256）</th><th></th></tr></thead><tbody>${files}</tbody></table></div>` : '<p class="lead">まだ書類はありません。</p>'}
      <form class="addf" id="addf">
        <div><label for="a-role">書類の種類</label><select id="a-role">${Object.keys(ROLE).map((k) => `<option value="${k}" ${k === (x.status === "signed" ? "signed" : "draft") ? "selected" : ""}>${ROLE[k]}</option>`).join("")}</select></div>
        <div><label for="a-src">どこから</label><select id="a-src"><option value="upload">アップロード</option><option value="docusign">DocuSign から移した</option><option value="other">そのほか</option></select></div>
        <div><label for="a-file">ファイル（30MB まで）</label><input type="file" id="a-file" accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.json,.zip"></div>
        <button class="btn sm pri" type="submit">追加</button>
      </form>
      <form class="addf" id="addg" style="grid-template-columns:3fr 1fr auto">
        <div><label for="g-url">Google ドキュメントの契約書（下書き）</label><input id="g-url" placeholder="https://docs.google.com/document/d/…"></div>
        <div><label for="g-name">名前</label><input id="g-name" maxlength="200"></div>
        <button class="btn sm" type="submit">リンクを追加</button>
      </form>
      <h3>中身</h3>
      <form id="cf">${fields(x)}<div class="bar"><button class="btn sm pri" type="submit">保存</button><span class="grow"></span>
        <button class="btn sm" type="button" id="arch">${x.archived ? "しまったのを戻す" : "しまう"}</button></div></form>`;
    $("#back").addEventListener("click", load);
    $("#main").querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => setStatus(x, b.dataset.set)));
    $("#main").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openFile(b.dataset.open)));
    $("#main").querySelectorAll("[data-check]").forEach((b) => b.addEventListener("click", () => check(x, b.dataset.check)));
    const rg = $("#rn-go"); if (rg) rg.addEventListener("click", () => renew(x));
    const cg = $("#cn-go"); if (cg) cg.addEventListener("click", () => cancelContract(x));
    loadHist(x);
    const sr = $("#sig-req"); if (sr) sr.addEventListener("click", () => requestSign(x));
    $("#main").querySelectorAll("[data-sigcancel]").forEach((b) => b.addEventListener("click", () => cancelSign(x, b.dataset.sigcancel)));
    $("#addf").addEventListener("submit", (e) => { e.preventDefault(); addFile(x); });
    $("#addg").addEventListener("submit", (e) => { e.preventDefault(); addDoc(x); });
    $("#cf").addEventListener("submit", (e) => { e.preventDefault(); save(x); });
    $("#arch").addEventListener("click", () => archive(x, !x.archived));
  }
  function lifeBox(x) {
    const left = x.days_left;
    const head = x.end_date ? `終了日 ${day(x.end_date)}${x.status === "signed" && left != null ? (left >= 0 ? `（あと ${left} 日）` : "（過ぎています）") : ""}・自動更新 ${x.auto_renew ? "あり" : "なし"}` : "終了日が入っていません（「中身」で入れると、30 日前に通知します）";
    return `<p class="lead" style="margin:4px 0">${head}。終了日の 30 日前に Naoki へメールとスマホで通知します。${x.auto_renew ? "何もしなければ、終了日の翌日に同じ長さで延びます。" : "何もしなければ、終了日の翌日に「終了・解約」になります。"}</p>
      ${x.status === "signed" && x.end_date ? `<div class="addf" style="grid-template-columns:1fr auto 1fr auto">
        <div><label for="rn-to">新しい終了日（空なら同じ長さだけ延ばす）</label><input type="date" id="rn-to"></div><button class="btn sm pri" type="button" id="rn-go">更新する</button>
        <div><label for="cn-on">解約の日（空なら今の終了日）</label><input type="date" id="cn-on"></div><button class="btn sm" type="button" id="cn-go">解約する</button></div>` : ""}
      <div id="hist" class="lead" style="margin-top:8px">履歴を読み込んでいます…</div>`;
  }
  async function loadHist(x) {
    const box = $("#hist"); if (!box) return;
    const r = await api("/api/admin/contracts/history?id=" + encodeURIComponent(x.id), { token: tok() });
    if (!r.ok) { box.textContent = "履歴を読めませんでした"; return; }
    box.innerHTML = r.items.length ? `<ul style="list-style:none;margin:0;padding:0">${r.items.map((h) => `<li style="padding:4px 0;border-top:1px solid var(--line,#e6dfd6)">${day(h.at)}・<b>${esc(h.label)}</b>${h.from_end && h.to_end && h.from_end !== h.to_end ? `・終了日 ${day(h.from_end)} → ${day(h.to_end)}` : h.to_end ? `・${day(h.to_end)}` : ""}${h.note ? `・${esc(h.note)}` : ""}${h.by_who === "auto" ? "（自動）" : ""}</li>`).join("")}</ul>` : "まだ更新・解約の履歴はありません";
  }
  async function renew(x) {
    const r = await api("/api/admin/contracts/renew", { method: "POST", token: tok(), body: { id: x.id, to_end: $("#rn-to").value || undefined } });
    if (!r.ok) { say(r.error === "bad_date" ? "今の終了日より後の日付にしてください" : errText(r)); $("#rn-to").focus(); return; }
    await openDetail(x.id); say(`更新しました。終了日 ${day(r.from_end)} → ${day(r.to_end)}`); refocus("#rn-go");
  }
  async function cancelContract(x) {
    const on = $("#cn-on").value || x.end_date;
    if (!confirm(`${day(on)} で解約します。状態は「終了・解約」になり、自動更新は外れます。よろしいですか？`)) return;
    const r = await api("/api/admin/contracts/cancel", { method: "POST", token: tok(), body: { id: x.id, on } });
    if (!r.ok) { say(r.error === "bad_date" ? "開始日より後の日付にしてください" : errText(r)); return; }
    await openDetail(x.id); say(`${day(r.end_date)} で解約しました`);
  }
  async function downloadZip() {
    say("まとめています…（書類が多いと少しかかります）");
    const res = await fetch("/api/admin/contracts/export", { headers: { authorization: "Bearer " + tok() } });
    if (!res.ok) { const j = await res.json().catch(() => ({})); say(j.error === "too_big" ? "書類が多すぎて 1 つにまとめられません。開発部へ知らせてください" : "ダウンロードできませんでした"); return; }
    const cd = res.headers.get("content-disposition") || ""; const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const a = document.createElement("a"); a.href = URL.createObjectURL(await res.blob()); a.download = m ? decodeURIComponent(m[1]) : "契約.zip"; a.click();
    say("ダウンロードしました。Google Drive などへ置いて保管してください");
  }
  const SIGN_ST = { open: "署名待ち", signed: "署名済み", cancelled: "取り消し" };
  function signBox(x) {
    const signs = x.signs || [];
    const pdf = x.files.some((f) => f.has_file && f.role === "draft" && /pdf/.test(f.content_type));
    const open = signs.find((s) => s.status === "open");
    const rows = signs.map((s) => `<li style="padding:6px 0;border-top:1px solid var(--line,#e6dfd6)"><span class="st ${s.status === "signed" ? "on" : "off"}">${SIGN_ST[s.status] || s.status}</span>
      ${esc(s.email)}・依頼 ${day(s.created_at)}${s.status === "open" ? `・期限 ${day(s.expires_at)}${s.code_sends ? `・コード ${s.code_sends} 回（${s.code_channel === "line" ? "LINE" : "メール"}）` : "・まだ開いていない"}` : ""}
      ${s.status === "signed" ? `・${esc(s.signer_name)} が ${day(s.signed_at)} に署名${s.tsa_file_id ? "・時刻の証明あり" : s.tsa_error ? "・時刻の証明は取れず" : ""}` : ""}
      ${s.status === "open" ? ` <button class="btn sm" type="button" data-sigcancel="${esc(s.id)}">キャンセル</button>` : ""}</li>`).join("");
    const can = x.status !== "signed" && x.status !== "ended";
    return `${can ? `<div class="bar" style="flex-wrap:wrap;gap:8px"><button class="btn sm pri" type="button" id="sig-req">${open ? "署名を依頼し直す" : "署名を依頼"}</button>
      <span class="lead" style="margin:0">${pdf ? `${esc(x.signer_email || "相手のメール未入力")} へ署名のリンク（7 日）を送ります。相手は確認コード（LINE でつながっていれば LINE、ほかはメール）を入れてから署名します。` : "先に下の「書類」で、下書きの PDF を入れてください。"}</span></div>` : ""}
      ${signs.length ? `<ul style="list-style:none;margin:6px 0 0;padding:0">${rows}</ul>` : ""}`;
  }
  async function requestSign(x) {
    const pdf = x.files.some((f) => f.has_file && f.role === "draft" && /pdf/.test(f.content_type));
    if (!pdf) { say("先に「書類」で、種類を「下書き」にして契約書の PDF を入れてください"); const r = $("#a-role"); if (r) { r.value = "draft"; r.focus(); } return; }
    if (!x.signer_email) { say("「中身」で相手のメールを入れて保存してください"); $("#c-email").focus(); return; }
    if (!confirm(`${x.signer_email} へ署名のお願いのメールを送ります。よろしいですか？`)) return;
    const r = await api("/api/admin/contracts/sign-request", { method: "POST", token: tok(), body: { contract_id: x.id } });
    if (!r.ok) { say(SIGN_ERR[r.error] || errText(r)); return; }
    await openDetail(x.id); say(`${r.to} へ署名のお願いを送りました（期限 ${day(r.expires_at)}）`); refocus("#sig-req");
  }
  const SIGN_ERR = { need_pdf: "下書きの PDF がありません", need_email: "相手のメールが入っていません", already_signed: "締結済みの契約です", mail_failed: "メールを送れませんでした。時間をおいてお試しください" };
  async function cancelSign(x, id) {
    const r = await api("/api/admin/contracts/sign-cancel", { method: "POST", token: tok(), body: { id } });
    if (!r.ok) { say(errText(r)); return; }
    await openDetail(x.id); say("署名の依頼をキャンセルしました。リンクは使えなくなりました");
  }
  const refocus = (sel) => { const b = $("#main").querySelector(sel); if (b) b.focus(); };

  async function setStatus(x, status) {
    if (status === x.status) return;
    const body = { id: x.id, status };
    if (status === "signed" && !x.signed_on) body.signed_on = $("#c-signed").value || undefined;
    const r = await api("/api/admin/contracts/status", { method: "POST", token: tok(), body });
    if (!r.ok) { say(errText(r)); return; }
    await openDetail(x.id);
    say(`状態を「${ST[status]}」にしました` + ((r.warnings || []).includes("no_signed_file") ? "。署名済みの書類を入れてください" : ""));
    refocus(`[data-set="${status}"]`);
  }
  async function save(x) {
    const r = await api("/api/admin/contracts/save", { method: "POST", token: tok(), body: { id: x.id, ...readFields() } });
    if (!r.ok) { say(errText(r)); focusErr(r); return; }
    await openDetail(x.id); say(r.changed && r.changed.length ? "中身を保存しました" : "変わったところはありませんでした");
  }
  async function archive(x, on) {
    const r = await api("/api/admin/contracts/archive", { method: "POST", token: tok(), body: { id: x.id, archived: on } });
    if (!r.ok) { say(errText(r)); return; }
    if (on) {
      showUndo(`「${x.title}」をしまいました`, async () => { await api("/api/admin/contracts/archive", { method: "POST", token: tok(), body: { id: x.id, archived: false } }); await openDetail(x.id); say("戻しました"); });
      await load();
    } else { await openDetail(x.id); say("戻しました"); }
  }
  function showUndo(t, fn) {
    undoFn = fn; $("#undo-t").textContent = t; $("#undo").hidden = false; say(t);
    clearTimeout(showUndo.tm); showUndo.tm = setTimeout(() => { $("#undo").hidden = true; undoFn = null; }, 8000);
  }
  $("#undo-b").addEventListener("click", async () => { const f = undoFn; $("#undo").hidden = true; undoFn = null; if (f) await f(); });

  async function addFile(x) {
    const f = $("#a-file").files[0];
    if (!f) { say("ファイルを選んでください"); $("#a-file").focus(); return; }
    if (f.size > MAX) { say(ERR.too_big); return; }
    say(`「${f.name}」を入れています…`);
    const q = new URLSearchParams({ contract_id: x.id, role: $("#a-role").value, source: $("#a-src").value, name: f.name });
    const res = await fetch("/api/admin/contracts/file?" + q, { method: "POST", headers: { authorization: "Bearer " + tok(), "content-type": f.type || "application/octet-stream" }, body: f });
    const r = await res.json().catch(() => ({ ok: false, error: res.status }));
    if (!r.ok) { say(`「${f.name}」を入れられませんでした：${errText(r)}`); return; }
    checks[r.id] = { match: true };
    await openDetail(x.id); say(`「${f.name}」を入れました。指紋 ${r.sha256.slice(0, 16)}…`);
  }
  async function addDoc(x) {
    const r = await api("/api/admin/contracts/doclink", { method: "POST", token: tok(), body: { contract_id: x.id, url: $("#g-url").value.trim(), name: $("#g-name").value.trim() } });
    if (!r.ok) { say(errText(r)); $("#g-url").focus(); return; }
    await openDetail(x.id); say("Google ドキュメントのリンクを追加しました");
  }
  async function openFile(id) {
    const w = window.open("", "_blank");
    const res = await fetch("/api/admin/contracts/file?id=" + encodeURIComponent(id), { headers: { authorization: "Bearer " + tok() } });
    if (!res.ok) { if (w) w.close(); say("開けませんでした"); return; }
    const u = URL.createObjectURL(await res.blob());
    if (w) w.location = u; else window.open(u, "_blank");
  }
  async function check(x, id) {
    say("確かめています…");
    const r = await api("/api/admin/contracts/verify?id=" + encodeURIComponent(id), { token: tok() });
    if (!r.ok) { say(errText(r)); return; }
    checks[id] = r; drawDetail((await api("/api/admin/contracts/one?id=" + encodeURIComponent(x.id), { token: tok() })).contract);
    say(r.match ? "書き換えはありません（入れたときと同じ中身です）" : r.missing ? "置き場にファイルが見つかりません" : "入れたときと中身が違います。開発部へ知らせてください");
    refocus(`[data-check="${id}"]`);
  }

  $("#new").addEventListener("click", openNew);
  const zb = $("#zip"); if (zb) zb.addEventListener("click", downloadZip);
  return { open: () => (curId ? openDetail(curId) : load()) };
}

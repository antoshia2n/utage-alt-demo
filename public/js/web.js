// 公開サイト（2026-11-07 便 S1・S2・デモに Naoki OK 15:54）：ブログとファネルページの見た目と部品
//  ・見た目：テーマ（シンプル・マガジン・ノート風）・2 色・本文の幅。全部の公開ページに効く（lp の /_lab/look.css）
//  ・部品：1 か所で作り、ページに印を置いて差し込む。中身は読者の段階（まだ登録していない・登録済み・個別相談まで・会員）で変わる
//  ・中身は /api/admin/web*。見た目は録画・メディアと同じ（recordings.css）と影の DOM
import { api } from "/js/common.js";

const ERR = {
  bad_id: "名前（印）は英小文字・数字・ハイフンの 2〜31 字にしてください",
  bad_name: "部品の名前を 60 字までで入れてください",
  need_rule: "どれか 1 つの段に中身を入れてください",
  need_title: "題を入れてください",
  need_action: "押した先の住所か、申込の枠のフォームを選んでください",
  bad_href: "住所は https:// から入れてください",
  form_not_found: "そのフォームは公開中ではありません",
  too_long: "長すぎる欄があります",
  bad_color: "色を選び直してください",
  not_found: "見つかりませんでした（削除されたかもしれません）",
  bad_slug: "住所の名前は英小文字・数字・ハイフンの 2〜61 字にしてください",
  slug_taken: "その住所の名前はもう使われています",
  slug_locked: "公開中は住所の名前を変えられません（公開を止めてから）",
  bad_members_from: "会員限定にする所を選び直してください",
  no_such_heading: "その番号の見出しが本文にありません",
  not_for_membership: "メンシプ記事には会員限定の所を付けられません（続きは note で読む形のため）",
  already_copied: "この記事はもうコピーしてあります",
  source_not_found: "コンテンツくんの記事が見つかりません",
  source_not_published: "公開済みの記事だけ写せます",
  source_empty: "本文が空の記事はコピーできません",
  bad_title: "題を 120 字までで入れてください",
  bad_thumb: "サムネの住所は https:// から入れてください", bad_link_url: "note の記事の住所は https:// から入れてください", need_link_url: "メンシプ記事は note の記事の住所を入れてから公開してください", not_membership: "note の住所はメンシプ記事にだけ入れられます",
  part_not_found: "その部品は使えません（止めたか消されました）",
  unpublish_first: "公開中の記事は削除できません。先に公開を止めてください",
  nothing_to_change: "変えたところがありません",
};
const V_ORDER = ["new", "list", "consult", "member", "_default"];

export function mountWeb(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <style>
    .tabs{display:flex;gap:4px;margin:0 0 14px}
    .tabs button{border:1px solid var(--line,#e6dfd6);background:var(--panel,#fff);border-radius:8px;padding:6px 14px;font-weight:700;min-height:36px;cursor:pointer;font:inherit}
    .tabs button[aria-selected=true]{background:#fef3c7;border-color:#fcd34d;color:#b45309}
    .themes{display:flex;gap:8px;flex-wrap:wrap}
    .themes button{border:2px solid var(--line,#e6dfd6);background:var(--panel,#fff);border-radius:10px;padding:8px 10px;min-width:120px;text-align:left;cursor:pointer;font:inherit}
    .themes button[aria-pressed=true]{border-color:#b45309}
    .themes i{display:block;height:24px;border-radius:6px;margin-bottom:4px}
    .fld{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
    .fld>label:first-child,.fld>span:first-child{min-width:8em;font-weight:700;font-size:13px}
    .in{padding:6px 8px;border:1px solid var(--field,#a39a90);border-radius:8px;background:var(--panel,#fff);font:inherit}
    .pv{border:1px solid var(--line,#e6dfd6);border-radius:12px;padding:16px;margin-top:8px}
    .pv h2{font-size:18px;margin:0 0 10px}
    .pill{display:inline-block;font-size:12px;font-weight:700;border-radius:6px;padding:0 7px;margin:0 4px 4px 0;background:#fdf4ff;border:1px solid #f0abfc;color:#86198f}
    .pill.off{background:var(--soft,#f7f3ee);border-color:var(--line,#e6dfd6);color:#6b6259}
    .vrow{border-top:1px solid var(--line,#e6dfd6);padding:10px 0}
    .vrow .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px}
    .vrow .grid label{display:block;font-size:12px;font-weight:700;color:#6b6259;margin-bottom:3px}
    .vrow .grid .in{width:100%;box-sizing:border-box}
    .snip{font-family:ui-monospace,monospace;font-size:12px;background:var(--soft,#f7f3ee);border-radius:6px;padding:2px 6px;word-break:break-all}
    tr.sel td{background:#fffbf5}
  </style>
  <div class="top"><span class="tab" aria-current="page" style="cursor:default">ブログ・公開ページ</span><span class="grow"></span><span class="note-top" id="note-top"></span></div>
  <div class="wrap" style="display:block"><main id="main" tabindex="-1" style="max-width:1080px;margin:0 auto"><p class="lead">読み込んでいます…</p></main></div>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#note-top").textContent = t; $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;
  const vLabel = (id) => (S && (S.variants || []).find((v) => v.id === id) || {}).label || id;

  let S = null, tab = "parts", look = null, edit = null, armDel = false, back = null;
  let B = null, pick = null, bed = null; // 便 S3：ブログ（B＝一覧、pick＝写す記事を選ぶ、bed＝記事の編集）
  let H = null, hd = null; // 公式サイトの作り直し 便 2：ホーム（H＝読んだ中身と選べる記事、hd＝編集中の写し）

  async function load() {
    const r = await api("/api/admin/web", { token: getToken() });
    if (!r.ok) { $("#main").innerHTML = `<p class="lead">${esc(errText(r))}</p>`; return; }
    S = r; if (!look) look = { ...r.look };
    if (tab === "blog") await loadBlog(); else if (tab === "home") await loadHome(); else draw();
  }
  async function loadHome() {
    const r = await api("/api/admin/site/home", { token: getToken() });
    if (!r.ok) { say(errText(r)); return; }
    H = r; hd = JSON.parse(JSON.stringify(r.home)); delete hd.is_default; draw();
  }
  async function loadBlog() {
    const r = await api("/api/admin/blog", { token: getToken() });
    if (!r.ok) { say(errText(r)); return; }
    B = r; draw();
  }

  function head() {
    return `<h1>ブログ・公開ページ</h1><p class="lead">ブログとファネルページの見た目と部品です。1 か所を編集すると、差し込んだ全ページが変わります。</p>
      <div class="tabs" role="tablist">${[["look", "見た目"], ["parts", "部品"], ["blog", "ブログ"], ["home", "ホーム"]].map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
  }

  // ---------- 見た目 ----------
  function drawLook() {
    const t = S.themes.find((x) => x.id === look.theme) || S.themes[0];
    const changed = JSON.stringify(look) !== JSON.stringify(S.look);
    return `<div class="tbl" style="padding:16px">
      <div class="fld"><span>テーマ</span><div class="themes">${S.themes.map((x) => `<button type="button" data-theme="${x.id}" aria-pressed="${look.theme === x.id}"><i style="background:linear-gradient(90deg,${x.c} 60%,${x.c2} 60%)"></i>${esc(x.label)}</button>`).join("")}</div></div>
      <div class="fld"><label for="c1">主の色</label><input type="color" id="c1" value="${esc(look.c)}"><label for="c2" style="min-width:auto;font-weight:700;font-size:13px">差し色</label><input type="color" id="c2" value="${esc(look.c2)}"><span class="hint">差し色は見出しの線・目次・ボックスの枠に使う</span></div>
      <div class="fld"><label for="sname">ブログの名前</label><input class="in" id="sname" maxlength="40" value="${esc(look.name || "")}" placeholder="ブログ" style="min-width:240px"><span class="hint">ブログの上の帯と、記事の題の後ろに出る</span></div>
      <div class="fld"><label for="wd">本文の幅</label><select id="wd" class="in">${S.widths.map((w) => `<option value="${w}" ${look.width === w ? "selected" : ""}>${w === 660 ? "狭め（読みやすさ重視）" : w === 720 ? "ふつう" : "広め"}</option>`).join("")}</select></div>
      <div class="fld"><span></span><button class="btn sm pri" type="button" id="look-save" ${changed ? "" : 'aria-disabled="true"'}>保存</button>${changed ? '<button class="btn sm" type="button" id="look-reset">キャンセル</button><span class="hint">保存すると全部の公開ページに効きます</span>' : '<span class="hint">いまの見た目です</span>'}</div>
      <div class="pv" style="--c:${esc(look.c)};--c2:${esc(look.c2)};max-width:${look.width}px">
        <span class="hint">見え方（${esc(t.label)}）</span>
        <h2 style="${look.theme === "magazine" ? "border-bottom:3px solid var(--c);padding:.2em 0" : look.theme === "note" ? "text-align:center" : "border-left:5px solid var(--c2);padding:.3em 0 .3em .7em"}">見出しの見え方</h2>
        <div style="border:2px solid var(--c2);border-radius:10px;padding:10px 14px;margin:0 0 12px"><b style="color:var(--c2);font-size:13px">ボックス</b><div>この章のポイント</div></div>
        <div style="border:2px solid var(--c);border-radius:12px;padding:14px"><b style="display:block">部品の見え方</b><span class="hint">ボタンは主の色</span><div><span style="display:inline-block;margin-top:8px;background:var(--c);color:#fff;border-radius:9px;padding:6px 14px;font-weight:800">詳しく見る →</span></div></div>
      </div></div>`;
  }
  function wireLook() {
    $("#main").querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => {
      const t = S.themes.find((x) => x.id === b.dataset.theme);
      look = { ...look, theme: t.id, c: t.c, c2: t.c2 }; draw(); const f = $(`[data-theme="${t.id}"]`); if (f) f.focus();
    }));
    $("#c1").addEventListener("change", (e) => { look.c = e.target.value; draw(); });
    $("#c2").addEventListener("change", (e) => { look.c2 = e.target.value; draw(); });
    $("#wd").addEventListener("change", (e) => { look.width = Number(e.target.value); draw(); $("#wd").focus(); });
    $("#sname").addEventListener("change", (e) => { look.name = e.target.value.trim(); draw(); $("#sname").focus(); });
    const rs = $("#look-reset"); if (rs) rs.addEventListener("click", () => { look = { ...S.look }; draw(); });
    $("#look-save").addEventListener("click", async () => {
      if (JSON.stringify(look) === JSON.stringify(S.look)) { say("変えたところがありません"); return; }
      const r = await api("/api/admin/web/look", { method: "POST", token: getToken(), body: look });
      if (!r.ok) { say(errText(r)); return; }
      S.look = { ...r.look }; look = { ...r.look }; draw(); say("見た目を保存しました（全部の公開ページに効きます）");
    });
  }

  // ---------- 部品 ----------
  const blankRule = () => ({ title: "", text: "", btn: "", href: "", form: "" });
  function drawParts() {
    const rows = S.parts.map((p) => `<tr class="${edit && edit.id === p.id ? "sel" : ""}"><td class="nm">${esc(p.name)}<small><span class="snip">${esc(p.snippet)}</span></small></td>
      <td>${esc(p.place_label)}</td><td>${V_ORDER.filter((v) => p.rules[v]).map((v) => `<span class="pill ${v === "_default" ? "off" : ""}">${esc(vLabel(v))}</span>`).join("")}</td>
      <td class="num">${p.week.view}</td><td class="num">${p.week.click}</td><td class="num">${p.week.signup}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm" type="button" data-copy="${esc(p.snippet)}" aria-label="「${esc(p.name)}」の印をコピー">印をコピー</button> <button class="btn sm" type="button" data-edit="${esc(p.id)}" aria-label="「${esc(p.name)}」を編集">編集</button></td></tr>`).join("");
    return `<div class="bar"><span class="hint">ページに印（<span class="snip">&lt;div data-lab-part="part:名前"&gt;&lt;/div&gt;</span>）を置くと、そこに部品が出ます。数は先週 7 日分</span><span class="grow" style="flex:1"></span><button class="btn sm pri" type="button" id="new-part">＋ 部品を作る</button></div>
      ${S.parts.length ? `<div class="tbl"><table><thead><tr><th>部品</th><th>差し込む場所</th><th>出し分け</th><th class="num">見た人</th><th class="num">押した</th><th class="num">登録</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="lead">まだ部品がありません。「＋ 部品を作る」から作れます。</p>'}
      ${edit ? drawEdit() : ""}`;
  }
  function drawEdit() {
    const isNew = !edit.id;
    const v = (k) => edit.rules[k];
    const formOpts = (cur) => `<option value="">（使わない：下の住所へ移る）</option>` + S.forms.map((f) => `<option value="${esc(f.slug)}" ${cur === f.slug ? "selected" : ""}>${esc(f.title)}</option>`).join("");
    const vrow = (k) => {
      const r = v(k), on = !!r;
      return `<div class="vrow"><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" data-use="${k}" ${on ? "checked" : ""}>${esc(vLabel(k))}${k === "_default" ? '<span class="hint" style="font-weight:400">ほかの段に当たらない人に出す。使わないと、当たらない人には何も出さない</span>' : ""}</label>
        ${on ? `<div class="grid">
          <div><label for="t-${k}">題（80 字）</label><input class="in" id="t-${k}" data-f="title" data-v="${k}" maxlength="80" value="${esc(r.title)}"></div>
          <div><label for="b-${k}">ボタンの字（30 字）</label><input class="in" id="b-${k}" data-f="btn" data-v="${k}" maxlength="30" value="${esc(r.btn)}" placeholder="詳しく見る"></div>
          <div style="grid-column:1/-1"><label for="x-${k}">文（400 字）</label><textarea class="in" id="x-${k}" data-f="text" data-v="${k}" rows="2" maxlength="400">${esc(r.text)}</textarea></div>
          <div><label for="f-${k}">申込の枠（フォーム）</label><select class="in" id="f-${k}" data-f="form" data-v="${k}">${formOpts(r.form)}</select></div>
          <div><label for="h-${k}">押した先の住所</label><input class="in" id="h-${k}" data-f="href" data-v="${k}" maxlength="500" value="${esc(r.href)}" placeholder="https://"></div>
        </div>` : ""}</div>`;
    };
    return `<div class="tbl" style="padding:16px;margin-top:14px" id="editor"><h2 style="font-size:16px;margin:0 0 12px">${isNew ? "部品を作る" : `「${esc(edit.name)}」を編集`}</h2>
      ${isNew ? `<div class="fld"><label for="pid">印の名前</label><input class="in" id="pid" maxlength="31" value="${esc(edit.slug || "")}" placeholder="例：gift-gengoka"><span class="hint">英小文字・数字・ハイフン。ページに書く印になる（あとから変えられない）</span></div>` : `<div class="fld"><span>印</span><span class="snip">${esc(`<div data-lab-part="part:${edit.id}"></div>`)}</span></div>`}
      <div class="fld"><label for="pname">部品の名前</label><input class="in" id="pname" maxlength="60" value="${esc(edit.name)}" style="flex:1;min-width:220px"></div>
      <div class="fld"><label for="pplace">差し込む場所</label><select class="in" id="pplace">${S.places.map((p) => `<option value="${p.id}" ${edit.place === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select><span class="hint">ブログは場所で自動で差し込む（ブログの便から）。ファネルページは印を置いた所に出る</span></div>
      <div style="margin:6px 0 4px;font-weight:700;font-size:13px">読者の段階ごとの中身</div>${V_ORDER.map(vrow).join("")}
      <div class="fld" style="margin-top:12px"><button class="btn sm pri" type="button" id="p-save">保存</button><button class="btn sm" type="button" id="p-cancel">キャンセル</button>${isNew ? "" : `<button class="btn sm" type="button" id="p-del" style="color:#b91c1c">${armDel ? "もう一度押すと削除" : "削除"}</button>`}<span class="hint">保存すると、差し込んだ全ページですぐ変わります</span></div></div>`;
  }
  function readEdit() {
    const pid = $("#pid"); if (pid) edit.slug = pid.value.trim();
    edit.name = $("#pname").value.trim(); edit.place = $("#pplace").value;
    root.querySelectorAll("[data-f]").forEach((x) => { const r = edit.rules[x.dataset.v]; if (r) r[x.dataset.f] = x.value; });
  }
  function wireParts() {
    $("#new-part").addEventListener("click", () => { back = "#new-part"; armDel = false; edit = { id: "", slug: "", name: "", place: "mid", rules: { new: blankRule() } }; draw(); $("#pid").focus(); });
    $("#main").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const p = S.parts.find((x) => x.id === b.dataset.edit); back = `[data-edit="${p.id}"]`; armDel = false;
      edit = { id: p.id, name: p.name, place: p.place, rules: JSON.parse(JSON.stringify(p.rules)) };
      for (const k of V_ORDER) if (edit.rules[k]) edit.rules[k] = { ...blankRule(), ...edit.rules[k] };
      draw(); $("#pname").focus();
    }));
    $("#main").querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); say("印をコピーしました。ページの HTML の出したい所に貼ってください"); } catch (_) { say("コピーできませんでした。表の印を選んでコピーしてください"); }
    }));
    if (!edit) return;
    root.querySelectorAll("[data-use]").forEach((c) => c.addEventListener("change", () => {
      readEdit(); const k = c.dataset.use;
      if (c.checked) edit.rules[k] = edit.rules[k] || blankRule(); else delete edit.rules[k];
      draw(); const f = c.checked ? $(`#t-${k}`) : root.querySelector(`[data-use="${k}"]`); if (f) f.focus();
    }));
    const close = () => { edit = null; armDel = false; draw(); const b = back && $("#main").querySelector(back); if (b) b.focus(); };
    $("#p-cancel").addEventListener("click", close);
    $("#editor").addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    $("#p-save").addEventListener("click", async () => {
      readEdit();
      const missing = V_ORDER.find((k) => edit.rules[k] && !edit.rules[k].title.trim());
      if (missing) { say(`「${vLabel(missing)}」の題を入れてください`); const f = $(`#t-${missing}`); if (f) f.focus(); return; }
      const body = { name: edit.name, place: edit.place, rules: edit.rules };
      if (edit.id) body.id = edit.id; else body.slug = edit.slug;
      const r = await api("/api/admin/web/part", { method: "POST", token: getToken(), body });
      if (!r.ok) {
        say(errText(r) + (r.variant ? `（${vLabel(r.variant)}）` : ""));
        const map = { bad_id: "#pid", bad_name: "#pname" }; const f = map[r.error] ? $(map[r.error]) : r.variant ? $(`#t-${r.variant}`) : null; if (f) f.focus();
        return;
      }
      const name = edit.name; edit = null; await load(); say(`「${name}」を保存しました`);
      const b = $("#main").querySelector(`[data-edit="${r.part.id}"]`); if (b) b.focus();
    });
    const del = $("#p-del");
    if (del) del.addEventListener("click", async () => {
      if (!armDel) { armDel = true; draw(); $("#p-del").focus(); return; }
      const r = await api("/api/admin/web/part", { method: "POST", token: getToken(), body: { id: edit.id, remove: true } });
      if (!r.ok) { say(errText(r)); return; }
      const name = edit.name; edit = null; armDel = false; await load(); say(`「${name}」を削除しました。印を置いたページでは何も出なくなります`); $("#new-part").focus();
    });
  }

  // ---------- ブログ（便 S3） ----------
  const jd = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
  const partName = (id) => { const p = (B.parts || []).find((x) => x.id === id); return p ? p.name : ""; };
  const defMid = () => (B.parts || []).find((x) => x.place === "mid");
  function drawBlog() {
    if (!B) return '<p class="lead">読み込んでいます…</p>';
    const rows = B.posts.map((p) => `<tr class="${bed && bed.id === p.id ? "sel" : ""}"><td class="nm">${esc(p.title)}<small><span class="snip">/blog/${esc(p.slug)}</span></small></td>
      <td><span class="pill ${p.status === "published" ? "" : "off"}">${p.status === "published" ? "公開中" : "下書き"}</span></td>
      <td>${p.gift_part ? esc(partName(p.gift_part) || p.gift_part) : `<span class="hint">${defMid() ? "既定（" + esc(defMid().name) + "）" : "なし"}</span>`}</td>
      <td class="num">${p.week_viewers}</td><td class="num">${esc(jd(p.copied_at))}</td>
      <td style="white-space:nowrap;text-align:right"><a class="btn sm" href="${esc(p.status === "published" ? p.url : p.preview_url)}" target="_blank" rel="noopener" aria-label="「${esc(p.title)}」の見え方を開く">見え方</a> <button class="btn sm" type="button" data-bedit="${esc(p.id)}" aria-label="「${esc(p.title)}」を編集">編集</button></td></tr>`).join("");
    return `<div class="bar"><span class="hint">コンテンツくんの記事をコピーして <a href="${esc(B.index_url)}" target="_blank" rel="noopener">${esc(B.index_url.replace(/^https:[/][/]/, ""))}</a> に出します。公開するまで外には出ません。見た人は先週 7 日分</span><span class="grow" style="flex:1"></span><button class="btn sm pri" type="button" id="b-pick">＋ コンテンツくんからコピー</button></div>
      ${pick ? drawPick() : ""}
      ${B.posts.length ? `<div class="tbl"><table><thead><tr><th>記事</th><th>状態</th><th>特典（本文の途中）</th><th class="num">見た人</th><th class="num">コピーした日</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="lead">まだ記事がありません。「＋ コンテンツくんからコピー」から始めます。</p>'}
      ${bed ? drawBed() : ""}`;
  }
  function drawPick() {
    const list = pick.rows ? pick.rows.map((r) => `<tr><td class="nm">${esc(r.title)}<small>${esc(r.type === "note" ? "note" : "X記事")}・${esc(String(r.date || "").slice(0, 10))}</small></td>
      <td style="white-space:nowrap;text-align:right">${r.blog_id ? `<span class="hint">コピー済み（${r.blog_status === "published" ? "公開中" : "下書き"}・/blog/${esc(r.blog_slug)}）</span>` : `<label class="sr" for="sl-${esc(r.id)}">「${esc(r.title)}」の住所の名前</label><input class="in" id="sl-${esc(r.id)}" maxlength="61" placeholder="住所の名前（例：gengoka-skills）" style="width:230px"> <button class="btn sm pri" type="button" data-copy-src="${esc(r.id)}">コピー</button>`}</td></tr>`).join("") : "";
    return `<div class="tbl" style="padding:16px;margin:0 0 14px" id="picker"><h2 style="font-size:16px;margin:0 0 10px">コピーする記事を選ぶ</h2>
      <div class="fld"><label for="pk-acc">アカウント</label><select class="in" id="pk-acc">${(B.accounts || []).map((a) => `<option value="${esc(a.id)}" ${pick.account === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      <label for="pk-q" style="min-width:auto">題で探す</label><input class="in" id="pk-q" value="${esc(pick.q)}" placeholder="例：言語化" style="min-width:200px"><button class="btn sm" type="button" id="pk-go">探す</button><button class="btn sm" type="button" id="pk-close">閉じる</button></div>
      <p class="hint" style="margin:0 0 8px">公開済みの X記事と note の新しい順 40 本。住所の名前は lp.shia2n.jp/blog/○○ の ○○（英小文字・数字・ハイフン）</p>
      ${pick.rows ? (pick.rows.length ? `<table><tbody>${list}</tbody></table>` : '<p class="lead">当てはまる記事がありません。</p>') : '<p class="lead">読み込んでいます…</p>'}</div>`;
  }
  function drawBed() {
    const p = B.posts.find((x) => x.id === bed.id); if (!p) return "";
    const pub = p.status === "published";
    return `<div class="tbl" style="padding:16px;margin-top:14px" id="beditor"><h2 style="font-size:16px;margin:0 0 12px">「${esc(p.title)}」を編集</h2>
      <div class="fld"><label for="be-title">題</label><input class="in" id="be-title" maxlength="120" value="${esc(bed.title)}" style="flex:1;min-width:260px"></div>
      <div class="fld"><label for="be-slug">住所の名前</label><input class="in" id="be-slug" maxlength="61" value="${esc(bed.slug)}" ${pub ? "disabled" : ""}><span class="hint">${pub ? "公開中は変えられません" : "lp.shia2n.jp/blog/" + esc(bed.slug)}</span></div>
      <div class="fld"><label for="be-desc">説明（200 字）</label><textarea class="in" id="be-desc" rows="2" maxlength="200" style="flex:1;min-width:260px">${esc(bed.description)}</textarea></div>
      ${bed.kind === "membership" ? `<div class="fld"><label for="be-link">note の記事の住所（メンシプ記事）</label><input class="in" id="be-link" maxlength="500" value="${esc(bed.link_url || "")}" placeholder="https://note.com/…" style="flex:1;min-width:260px"><span class="hint">本文は写さず、このボタンだけを出す。住所を入れるまで公開できない</span></div>` : ""}
      <div class="fld"><label for="be-cat">カテゴリ</label><input class="in" id="be-cat" maxlength="20" value="${esc(bed.category || "")}" placeholder="例：SNS攻略（空なら付けない）" style="flex:1;min-width:200px"><span class="hint">公式サイトのカテゴリの一覧に出る。20 字まで</span></div>
      ${bed.kind === "membership" ? "" : `<div class="fld"><label for="be-mem">会員限定にする所</label><select class="in" id="be-mem"><option value="0">なし（全部だれでも読める）</option>${(p.headings || []).map((h, i) => `<option value="${i + 1}" ${Number(bed.members_from) === i + 1 ? "selected" : ""}>${i + 1} 番目の見出し「${esc(h.slice(0, 30))}」から後ろ</option>`).join("")}</select><span class="hint">${(p.headings || []).length ? "選んだ見出しから後ろは、無料会員登録かログインをした人だけに出る（その場で開く）" : "本文に見出しが無いため選べません"}</span></div>`}
      <div class="fld"><label for="be-thumb">サムネの住所</label><input class="in" id="be-thumb" maxlength="500" value="${esc(bed.thumb_url)}" placeholder="https://（空なら本文の最初の画像）" style="flex:1;min-width:260px"></div>
      <div class="fld"><label for="be-gift">特典（本文の途中）</label><select class="in" id="be-gift"><option value="">${defMid() ? "既定（" + esc(defMid().name) + "）" : "既定（本文の途中の部品なし）"}</option>${(B.parts || []).map((x) => `<option value="${esc(x.id)}" ${bed.gift_part === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><span class="hint">2 つ目の見出しの前に出る。中身は読者の段階で変わる（部品のタブで作る）</span></div>
      <div class="fld" style="margin-top:12px"><button class="btn sm pri" type="button" id="be-save">保存</button>
        <button class="btn sm" type="button" id="be-pub">${pub ? "公開を止める" : "公開する"}</button>
        <button class="btn sm" type="button" id="be-refresh">コンテンツくんから写し直す</button>
        <a class="btn sm" href="${esc(pub ? p.url : p.preview_url)}" target="_blank" rel="noopener">見え方を開く</a>
        <button class="btn sm" type="button" id="be-cancel">閉じる</button>
        ${pub ? "" : `<button class="btn sm" type="button" id="be-del" style="color:#b91c1c">${armDel ? "もう一度押すと削除" : "削除"}</button>`}</div>
      <p class="hint" style="margin:0">本文はここでは直しません。コンテンツくんで編集して「写し直す」を押すと入れ替わります（コピーした日 ${esc(jd(p.copied_at))}）</p></div>`;
  }
  async function loadPick() {
    const q = new URLSearchParams({ account: pick.account, q: pick.q });
    const r = await api(`/api/admin/blog/sources?${q}`, { token: getToken() });
    pick.rows = r.ok ? r.posts : []; if (!r.ok) say(errText(r)); draw();
  }
  function readBed() {
    bed.title = $("#be-title").value.trim(); bed.slug = $("#be-slug").value.trim();
    bed.description = $("#be-desc").value.trim(); bed.thumb_url = $("#be-thumb").value.trim(); bed.category = $("#be-cat").value.trim(); bed.gift_part = $("#be-gift").value;
    if ($("#be-mem")) bed.members_from = Number($("#be-mem").value) || 0;
    if ($("#be-link")) bed.link_url = $("#be-link").value.trim();
  }
  async function saveBlog(body, done) {
    const r = await api("/api/admin/blog/post", { method: "POST", token: getToken(), body });
    if (!r.ok) { say(errText(r)); return null; }
    await loadBlog(); say(done); return r;
  }
  function wireBlog() {
    if (!B) return;
    $("#b-pick").addEventListener("click", async () => { pick = { account: (B.accounts.find((a) => a.id === "acc_1") || B.accounts[0] || {}).id || "acc_1", q: "", rows: null }; draw(); $("#pk-q").focus(); await loadPick(); const f = $("#pk-q"); if (f) f.focus(); });
    $("#main").querySelectorAll("[data-bedit]").forEach((b) => b.addEventListener("click", () => {
      const p = B.posts.find((x) => x.id === b.dataset.bedit); armDel = false; back = `[data-bedit="${p.id}"]`;
      bed = { id: p.id, title: p.title, slug: p.slug, description: p.description || "", thumb_url: p.thumb_url || "", category: p.category || "", gift_part: p.gift_part || "", members_from: p.members_from || 0, kind: p.kind || "", link_url: p.link_url || "" };
      draw(); $("#be-title").focus();
    }));
    if (pick) {
      const go = () => { pick.account = $("#pk-acc").value; pick.q = $("#pk-q").value.trim(); pick.rows = null; draw(); loadPick(); };
      $("#pk-go").addEventListener("click", go);
      $("#pk-q").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      $("#pk-acc").addEventListener("change", go);
      $("#pk-close").addEventListener("click", () => { pick = null; draw(); $("#b-pick").focus(); });
      $("#picker").addEventListener("keydown", (e) => { if (e.key === "Escape") { pick = null; draw(); $("#b-pick").focus(); } });
      root.querySelectorAll("[data-copy-src]").forEach((b) => b.addEventListener("click", async () => {
        const id = b.dataset.copySrc, inp = $(`#sl-${id}`), slug = inp.value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) { say(ERR.bad_slug); inp.focus(); return; }
        const r = await api("/api/admin/blog/copy", { method: "POST", token: getToken(), body: { post_id: id, slug } });
        if (!r.ok) { say(errText(r)); inp.focus(); return; }
        pick = null; await loadBlog();
        const p = r.post; bed = { id: p.id, title: p.title, slug: p.slug, description: p.description || "", thumb_url: p.thumb_url || "", category: p.category || "", gift_part: "", members_from: 0, kind: p.kind || "", link_url: p.link_url || "" }; back = `[data-bedit="${p.id}"]`;
        draw(); say(`「${p.title}」を下書きにコピーしました。説明と特典を決めて公開してください`); $("#be-title").focus();
      }));
    }
    if (!bed) return;
    const close = () => { bed = null; armDel = false; draw(); const b = back && $("#main").querySelector(back); if (b) b.focus(); };
    $("#be-cancel").addEventListener("click", close);
    $("#beditor").addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const p = () => B.posts.find((x) => x.id === bed.id);
    $("#be-save").addEventListener("click", async () => {
      readBed(); const cur = p(); const body = { id: bed.id };
      for (const k of ["title", "description", "thumb_url", "category", "gift_part"]) if ((cur[k] || "") !== bed[k]) body[k] = bed[k];
      if (bed.kind === "membership" && (cur.link_url || "") !== (bed.link_url || "")) body.link_url = bed.link_url || "";
      if (bed.kind !== "membership" && (Number(cur.members_from) || 0) !== (Number(bed.members_from) || 0)) body.members_from = Number(bed.members_from) || 0;
      if (cur.status !== "published" && bed.slug !== cur.slug) body.slug = bed.slug;
      if (Object.keys(body).length === 1) { say(ERR.nothing_to_change); return; }
      if (await saveBlog(body, "保存しました")) { const f = $("#be-save"); if (f) f.focus(); }
    });
    $("#be-pub").addEventListener("click", async () => {
      const pub = p().status === "published";
      if (await saveBlog({ id: bed.id, action: pub ? "unpublish" : "publish" }, pub ? "公開を止めました（住所を開くと「見つかりません」になります）" : "公開しました")) { const f = $("#be-pub"); if (f) f.focus(); }
    });
    $("#be-refresh").addEventListener("click", async () => {
      if (await saveBlog({ id: bed.id, action: "refresh" }, "コンテンツくんの今の本文に入れ替えました")) { const f = $("#be-refresh"); if (f) f.focus(); }
    });
    const del = $("#be-del");
    if (del) del.addEventListener("click", async () => {
      if (!armDel) { armDel = true; draw(); $("#be-del").focus(); return; }
      const id = bed.id, title = bed.title;
      const r = await api("/api/admin/blog/post", { method: "POST", token: getToken(), body: { id, action: "remove" } });
      if (!r.ok) { say(errText(r)); return; }
      bed = null; armDel = false; await loadBlog(); say(`「${title}」を削除しました`); $("#b-pick").focus();
    });
  }

  // ---------- 公式サイトの作り直し 便 2：ホーム（スライダー・本棚・サイドバー）----------
  const HOME_ERR = { need_title: "題を入れてください", need_name: "棚の名前を入れてください", need_alt: "画像を入れたときは、画像の説明（読み上げ用）も入れてください", bad_href: "押した先は / か # か https:// から入れてください", bad_img: "画像の住所は https:// から入れてください", bad_post: "記事を選び直してください", bad_form: "フォームの住所の名前は英小文字・数字・ハイフンで入れてください", bad_booking: "予約のメニューの住所の名前は英小文字・数字・ハイフンで入れてください", too_many: "数が多すぎます", no_storage: "保存先が使えません" };
  const hf = (id, label, val, max, hint = "", wide = true) => `<div class="fld"><label for="${id}">${label}</label><input class="in" id="${id}" maxlength="${max}" value="${esc(val || "")}" style="flex:1;min-width:${wide ? 260 : 160}px">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  function drawHome() {
    if (!hd) return `<p class="lead">読み込み中です…</p>`;
    const title = (slug) => ((H.posts || []).find((p) => p.slug === slug) || {}).title || slug;
    const pub = (H.posts || []).filter((p) => p.published);
    const changed = JSON.stringify(hd) !== JSON.stringify((({ is_default, ...x }) => x)(H.home));
    return `<div class="tbl" style="padding:16px">
      <p class="hint" style="margin:0 0 12px">公式サイトのホーム（ページ home）に出る中身です。ページの印（slider:home・shelf:home・sidebar:home）の所に入ります。${H.home.is_default ? "まだ一度も保存していません（今は仮の中身です）。" : ""}</p>
      <h2 style="font-size:18px">スライダー（${hd.slides.length} 枚・8 枚まで）</h2>
      ${hd.slides.map((sl, i) => `<fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px"><legend><b>${i + 1} 枚目</b></legend>
        ${hf(`hs-${i}-label`, "小見出し", sl.label, 60)}${hf(`hs-${i}-title`, "題（必須）", sl.title, 80)}${hf(`hs-${i}-body`, "本文", sl.body, 200)}
        ${hf(`hs-${i}-cta`, "ボタンの文字", sl.cta, 20, "", false)}${hf(`hs-${i}-href`, "押した先", sl.href, 400, "/ で始める（例 /xmas-gift）か # か https://")}
        ${hf(`hs-${i}-img`, "画像の住所", sl.img, 400, "空なら仮の枠。メディアの棚の住所を貼る")}${hf(`hs-${i}-alt`, "画像の説明", sl.alt, 200, "読み上げ用。画像を入れたら必須")}${hf(`hs-${i}-note`, "赤ペンの一言", sl.note, 30, "", false)}
        <div class="fld"><span></span><button class="btn sm" type="button" data-hs-up="${i}" ${i ? "" : 'aria-disabled="true"'}>上へ</button><button class="btn sm" type="button" data-hs-down="${i}" ${i < hd.slides.length - 1 ? "" : 'aria-disabled="true"'}>下へ</button><button class="btn sm" type="button" data-hs-del="${i}">「${esc(sl.title || (i + 1) + " 枚目")}」を削除</button></div></fieldset>`).join("")}
      <p><button class="btn sm" type="button" id="hs-add" ${hd.slides.length >= 8 ? 'aria-disabled="true"' : ""}>スライドを追加</button></p>
      <h2 style="font-size:18px">本棚（3 つまで・1 つに 12 本まで）</h2>
      ${hd.shelves.map((sh, i) => `<fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px"><legend><b>棚 ${i + 1}</b></legend>
        ${hf(`hh-${i}-name`, "棚の名前", sh.name, 20, "", false)}${hf(`hh-${i}-who`, "一言", sh.who, 30)}
        <ol style="margin:8px 0">${sh.posts.map((p, j) => `<li style="margin:4px 0">${esc(title(p))} <button class="btn sm" type="button" data-hp-up="${i}:${j}" ${j ? "" : 'aria-disabled="true"'}>上へ</button><button class="btn sm" type="button" data-hp-down="${i}:${j}" ${j < sh.posts.length - 1 ? "" : 'aria-disabled="true"'}>下へ</button><button class="btn sm" type="button" data-hp-del="${i}:${j}">「${esc(title(p))}」を外す</button></li>`).join("") || '<li class="hint">まだ記事がありません</li>'}</ol>
        <div class="fld"><label for="hh-${i}-add">記事を追加</label><select class="in" id="hh-${i}-add"><option value="">公開中の記事から選ぶ</option>${pub.filter((p) => !sh.posts.includes(p.slug)).map((p) => `<option value="${esc(p.slug)}">${esc(p.title)}</option>`).join("")}</select><button class="btn sm" type="button" data-hp-add="${i}" ${sh.posts.length >= 12 ? 'aria-disabled="true"' : ""}>追加</button></div></fieldset>`).join("")}
      <h2 style="font-size:18px">サイドバー</h2>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px"><legend><b>無料会員登録</b></legend>
        ${hf("hb-join-title", "題", hd.sidebar.join.title, 40)}${hf("hb-join-body", "本文", hd.sidebar.join.body, 120)}${hf("hb-join-form", "フォーム", hd.sidebar.join.form, 41, "フォームの住所の名前。入れるとその場で登録できる。空ならボタン", false)}${hf("hb-join-cta", "ボタンの文字", hd.sidebar.join.cta, 20, "", false)}${hf("hb-join-href", "押した先", hd.sidebar.join.href, 400)}</fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px"><legend><b>個別相談</b></legend>
        ${hf("hb-consult-title", "題", hd.sidebar.consult.title, 40)}${hf("hb-consult-body", "本文", hd.sidebar.consult.body, 120)}${hf("hb-consult-booking", "予約のメニュー", hd.sidebar.consult.booking, 41, "住所の名前。先着の数があれば「残り N 名」が自動で出る", false)}${hf("hb-consult-cta", "ボタンの文字", hd.sidebar.consult.cta, 20, "", false)}${hf("hb-consult-href", "押した先", hd.sidebar.consult.href, 400)}</fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px"><legend><b>メンバーシップ</b></legend>
        ${hf("hb-membership-title", "題", hd.sidebar.membership.title, 40)}${hf("hb-membership-body", "本文", hd.sidebar.membership.body, 120)}${hf("hb-membership-cta", "ボタンの文字", hd.sidebar.membership.cta, 20, "", false)}${hf("hb-membership-href", "押した先", hd.sidebar.membership.href, 400, "note のメンバーシップの住所")}</fieldset>
      <div class="fld"><span></span><button class="btn sm pri" type="button" id="hm-save" ${changed ? "" : 'aria-disabled="true"'}>保存</button>${changed ? '<button class="btn sm" type="button" id="hm-reset">キャンセル</button><span class="hint">保存していない変更があります</span>' : ""}</div>
    </div>`;
  }
  function readHome() {
    const v = (id) => { const e = $("#" + id); return e ? e.value.trim() : ""; };
    hd.slides.forEach((sl, i) => { for (const k of ["label", "title", "body", "cta", "href", "img", "alt", "note"]) sl[k] = v(`hs-${i}-${k}`); });
    hd.shelves.forEach((sh, i) => { sh.name = v(`hh-${i}-name`); sh.who = v(`hh-${i}-who`); });
    for (const k of ["join", "consult", "membership"]) for (const f of ["title", "body", "cta", "href", "form", "booking"]) if ($(`#hb-${k}-${f}`)) hd.sidebar[k][f] = v(`hb-${k}-${f}`);
  }
  function wireHome() {
    if (!hd) { loadHome(); return; }
    const redraw = (focusSel) => { draw(); const f = focusSel && $(focusSel); if (f) f.focus(); };
    const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
    $("#main").addEventListener("input", () => { if (tab !== "home") return; readHome(); const b = $("#hm-save"); if (b) b.removeAttribute("aria-disabled"); }, { once: true });
    $("#main").querySelectorAll("[data-hs-up],[data-hs-down],[data-hs-del]").forEach((b) => b.addEventListener("click", () => {
      readHome();
      if (b.dataset.hsDel != null) { const i = Number(b.dataset.hsDel); const t = hd.slides[i].title; hd.slides.splice(i, 1); redraw("#hs-add"); say(`「${t || "スライド"}」を削除しました（保存するまで公式サイトは変わりません）`); return; }
      const i = Number(b.dataset.hsUp ?? b.dataset.hsDown), d = b.dataset.hsUp != null ? -1 : 1;
      if (move(hd.slides, i, d)) redraw(`[data-hs-${d < 0 ? "up" : "down"}="${i + d}"]`);
    }));
    const add = $("#hs-add"); if (add) add.addEventListener("click", () => {
      readHome(); if (hd.slides.length >= 8) { say("スライドは 8 枚までです"); return; }
      hd.slides.push({ label: "", title: "", body: "", cta: "", href: "", img: "", alt: "", note: "" }); redraw(`#hs-${hd.slides.length - 1}-title`);
    });
    $("#main").querySelectorAll("[data-hp-up],[data-hp-down],[data-hp-del]").forEach((b) => b.addEventListener("click", () => {
      readHome();
      const [i, j] = String(b.dataset.hpUp ?? b.dataset.hpDown ?? b.dataset.hpDel).split(":").map(Number);
      const posts = hd.shelves[i].posts;
      if (b.dataset.hpDel != null) { posts.splice(j, 1); redraw(`#hh-${i}-add`); return; }
      const d = b.dataset.hpUp != null ? -1 : 1;
      if (move(posts, j, d)) redraw(`[data-hp-${d < 0 ? "up" : "down"}="${i}:${j + d}"]`);
    }));
    $("#main").querySelectorAll("[data-hp-add]").forEach((b) => b.addEventListener("click", () => {
      readHome(); const i = Number(b.dataset.hpAdd); const sel = $(`#hh-${i}-add`);
      if (!sel.value) { say("追加する記事を選んでください"); sel.focus(); return; }
      if (hd.shelves[i].posts.length >= 12) { say("1 つの棚は 12 本までです"); return; }
      hd.shelves[i].posts.push(sel.value); redraw(`#hh-${i}-add`);
    }));
    const reset = $("#hm-reset"); if (reset) reset.addEventListener("click", () => { hd = JSON.parse(JSON.stringify(H.home)); delete hd.is_default; redraw("#hm-save"); say("変更を取り消しました"); });
    $("#hm-save").addEventListener("click", async () => {
      readHome();
      const r = await api("/api/admin/site/home", { method: "POST", token: getToken(), body: hd });
      if (!r.ok) {
        const m = String(r.field || "").match(/^(slides|shelves)\.(\d+)\.(\w+)$/) || String(r.field || "").match(/^sidebar\.(\w+)\.(\w+)$/);
        say((HOME_ERR[r.error] || errText(r)) + (r.field ? `（${r.field}）` : ""));
        const id = !m ? null : m[1] === "slides" ? `#hs-${m[2]}-${m[3]}` : m[1] === "shelves" ? (m[3] === "posts" ? `#hh-${m[2]}-add` : `#hh-${m[2]}-${m[3]}`) : `#hb-${m[1]}-${m[2]}`;
        const f = id && $(id); if (f) f.focus();
        return;
      }
      H.home = r.home; hd = JSON.parse(JSON.stringify(r.home)); redraw("#hm-save"); say("ホームの中身を保存しました");
    });
  }

  function draw() {
    $("#main").innerHTML = head() + (tab === "look" ? drawLook() : tab === "blog" ? drawBlog() : tab === "home" ? drawHome() : drawParts());
    $("#main").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      tab = b.dataset.tab; draw(); $(`[data-tab="${tab}"]`).focus();
      if (tab === "blog" && !B) { await loadBlog(); $(`[data-tab="blog"]`).focus(); }
      if (tab === "home" && !H) { await loadHome(); $(`[data-tab="home"]`).focus(); }
    }));
    if (tab === "look") wireLook(); else if (tab === "blog") wireBlog(); else if (tab === "home") { if (hd) wireHome(); } else wireParts();
  }

  return { open: () => load() };
}

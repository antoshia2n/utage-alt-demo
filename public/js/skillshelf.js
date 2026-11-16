// スキルの棚（2026-11-16 スキルの棚の便 1・Naoki OK 00:36）：シアニンのスキル・レシピ・仮説を 1 か所で見て、レシピと仮説を書き足す
//  ・正本は GitHub の shia2n-skills のまま。この画面は読んで見せる・書き足す口（中身は shia2n-mcp の SkillsReader・GitHub の鍵はあちらだけ）
//  ・録画・実績と同じ見た目（recordings.css）と影の DOM。上の帯＝スキル／レシピ／仮説、真ん中＝表、行を押すと右に詳細
//  ・決め（Decisions 2026-11-16）：レシピの選択スキルは版で固定。@最新 は基本スキル（いまはレビューだけ）
//  ・生徒が選ぶ画面は作らない（権利の一本化のあと）
import { api } from "/js/common.js";

const TABS = [["skills", "スキル"], ["recipes", "レシピ"], ["hypotheses", "仮説"]];
const ERR = {
  not_found: "見つかりませんでした。画面を読み直してください",
  already: "同じ名前のレシピがもうあります",
  bad_name: "名前は英小文字・数字・ハイフンで 2 文字以上にしてください（例 shia2n-kozo-light）",
  need_purpose: "「何に使うか」を入れてください",
  no_skills: "スキルを 1 本以上入れてください",
  too_many: "スキルは 12 本までです",
  need_title_words: "題と中身の両方を入れてください",
  need_status_or_note: "状態を変えるか、追記を入れてください",
  no_binding: "スキルの正本につながっていません（設定の確認が要ります）",
};
const errText = (e) => {
  const s = String(e || "");
  const k = s.split(":")[0];
  if (k === "latest_not_allowed") return `「${s.split(":")[1]}」は最新にできません（最新にできるのは基本スキルだけ）`;
  if (k === "dup_skill") return `「${s.split(":")[1]}」が 2 回入っています`;
  if (k === "step_no_title") return `手順 ${s.split(":")[1]} の題を入れてください`;
  if (k === "step_skill_not_in_recipe") return `流れで使うスキル（${s.split(":")[1]}）がレシピに入っていません`;
  if (k === "prompt_has_fence") return `手順 ${s.split(":")[1]} のプロンプトに \`\`\` は使えません`;
  if (k === "too_many_steps") return "手順は 20 個までです";
  if (k === "no_skill") return `「${s.split(":")[1]}」は正本にありません`;
  return ERR[k] || `うまくいきませんでした（${s}）`;
};
const STATUS_KIND = { 仮説: "off", 確かめ中: "stop", 確定: "on", やめた: "off" };
// 状態の欄は「仮説（2026-11-16・前は …）」や「仮説。次の版で…」の形。札には頭の語だけ出す
const statusWord = (s) => String(s || "").split(/[（。(]/)[0].trim();

export function mountSkillShelf(host, { getToken }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/recordings.css">
  <style>
    .how{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--muted);margin:0 0 14px}
    .how b{color:var(--fg)}
    .ver{font-variant-numeric:tabular-nums;white-space:nowrap}
    .ver.diff{color:var(--ink);font-weight:700}
    .uses{display:flex;gap:4px;flex-wrap:wrap}
    .use{font-size:12px;border:1px solid var(--line);background:var(--soft);border-radius:999px;padding:0 8px;line-height:22px;white-space:nowrap}
    .use.latest{border-color:var(--ink);color:var(--ink)}
    td small{display:block;color:var(--muted);font-size:12px;font-weight:400}
    .drawer.wide{width:640px}
    .ur{display:grid;grid-template-columns:28px minmax(0,1fr) 172px 84px 32px;gap:6px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:6px 8px;margin-bottom:6px;background:var(--panel)}
    .ur.drag{opacity:.5}.ur.over{border-color:var(--ink)}
    .ur select{border:1px solid var(--field);background:var(--panel);border-radius:8px;padding:4px 6px;min-height:34px;font-size:13px;width:100%}
    .grip{cursor:grab;border:0;background:none;color:var(--muted);font-size:16px;min-height:34px;padding:0;touch-action:none}
    .ur .nm{font-size:13px;overflow-wrap:anywhere;line-height:1.4}
    .ur .nm small{display:block;font-weight:400;color:var(--muted);font-size:12px}
    .ud{display:none}
    @media (pointer:coarse){.ur{grid-template-columns:28px minmax(0,1fr) 150px 80px 36px 36px}.ud{display:flex;flex-direction:column}.ud button{min-height:22px;border:0;background:none}}
    .del{border:0;background:none;color:var(--muted);cursor:pointer;min-height:34px;font-size:15px}
    .del:hover{color:var(--warn)}
    textarea.q{width:100%;min-height:72px;padding:6px 8px;border:1px solid var(--field);border-radius:8px;background:var(--panel);font:inherit;resize:vertical}
    .hy{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
    .hy h3{font-size:15px;margin:0 0 6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .hy .body{white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--fg);max-height:240px;overflow:auto;background:var(--soft);border-radius:8px;padding:8px 10px;margin:6px 0 8px}
    .hy .body.open{max-height:none}
    .hy .acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .hy select{border:1px solid var(--field);background:var(--panel);border-radius:8px;padding:4px 8px;min-height:34px}
    form[hidden],.hide{display:none!important}
    .gsec{margin:0 0 18px}.gsec h2{font-size:15px;margin:0 0 8px}.gsec h2 small{color:var(--muted);font-weight:400;font-size:12px}
    .gh{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:6px 0;font:inherit;font-size:15px;font-weight:700;color:inherit;cursor:pointer;text-align:left;min-height:44px}
    .gh small{color:var(--muted);font-weight:400;font-size:12px}.gh .cv{display:inline-block;width:14px;transition:transform .15s}.gh[aria-expanded="false"] .cv{transform:rotate(-90deg)}
    .gtools{display:flex;gap:8px;margin:0 0 8px}
    .stk{display:flex;align-items:center}.stk .sti{position:relative;display:block}.stk .sti+.sti{margin-left:-10px}.stk.big .sti+.sti{margin-left:-14px}
    .stk .ic{border-radius:10px;background:var(--panel);box-shadow:0 0 0 2px var(--panel)}.stk .noic{display:block;background:var(--line)}
    .stk .lt{position:absolute;right:-4px;bottom:-6px;font-size:10px;line-height:1;padding:2px 4px;border-radius:6px;background:var(--panel);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
    .sk .stk.big{margin-bottom:6px}.nmw{display:flex;align-items:center;gap:10px}.nmw .ic.sm{margin:0}.gsec:has(>div[hidden]){margin-bottom:4px}
    .sks{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
    .sk{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;font:inherit;color:inherit;min-height:44px}
    .sk:hover{border-color:var(--field)}.sk:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
    .sk-h{display:flex;align-items:center;gap:10px}.sk-h>span{display:flex;flex-direction:column;gap:2px;min-width:0}
    .ic{width:40px;height:40px;flex:none;display:block}.ic.sm{width:24px;height:24px;vertical-align:middle;margin-right:8px}.ic.lg{width:48px;height:48px}.dh h2{display:flex;align-items:center;gap:12px}
    .sk-t{font-size:15px;font-weight:700}.sk-id{font-size:12px;color:var(--muted);font-family:ui-monospace,monospace}
    .sk-p{font-size:13px;color:var(--fg);line-height:1.5}
    .sk .uses{margin-top:4px}.use.md{border-style:dashed}.use.ver{background:none}.use.stu{border-color:var(--ink);color:var(--ink)}
    .seg{display:inline-flex;gap:0}.seg .btn{border-radius:0}.seg .btn:first-child{border-radius:8px 0 0 8px}.seg .btn:last-child{border-radius:0 8px 8px 0;margin-left:-1px}
    .seg .btn[aria-pressed="true"]{background:var(--soft);font-weight:700}
    .fpop{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 12px;display:flex;gap:18px;flex-wrap:wrap}
    .fpop[hidden]{display:none}
    .fs{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:var(--panel)}
    .fs.drag{opacity:.5}.fs.over{border-color:var(--ink)}
    .fs-h{display:flex;align-items:center;gap:6px;margin-bottom:6px}.fs-h .grow{flex:1}
    .fs-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .fs select,.fs input{width:100%}
    .fs select{border:1px solid var(--field);background:var(--panel);border-radius:8px;padding:4px 6px;min-height:36px;font-size:13px}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
    .fg{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px}.fg legend{font-weight:700;margin-bottom:4px}
    .fg label{display:flex;gap:6px;align-items:center;min-height:28px}
    .chipx{cursor:pointer;font:inherit;font-size:12px}
  </style>
  <div class="top" role="tablist" aria-label="スキルの棚">${TABS.map(([k, l]) => `<button class="tab" type="button" role="tab" data-tab="${k}" aria-selected="false">${l}</button>`).join("")}
    <span class="grow"></span><span class="note-top" id="note-top"></span><a class="btn sm" id="repo" href="https://github.com/antoshia2n/shia2n-skills" target="_blank" rel="noopener">正本を別タブで開く ↗</a>
  </div>
  <div class="wrap"><main id="main" tabindex="-1"><p class="lead">読み込んでいます…</p></main></div>
  <div class="scrim" id="scrim" hidden></div>
  <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden></aside>
  <div id="live" class="sr" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#note-top").textContent = t; $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const call = (path, body) => api(path, body ? { method: "POST", token: getToken(), body } : { token: getToken() });

  let S = null, tab = "skills", q = "", back = null, dirty = false;

  // at：保存の直後に返ったコミット。GitHub は main を 1 分ほど前の形で返すことがあるので、保存の直後はそのコミットで読む
  async function load(at) {
    const r = await call("/api/admin/skills" + (at ? `?at=${encodeURIComponent(at)}` : ""));
    if (!r.ok) { $("#main").innerHTML = `<p class="lead">${esc(errText(r.error))}</p>`; return; }
    S = r; draw();
  }
  function setTab(k) {
    if (dirty && !confirmLeave()) return;
    tab = k; q = ""; closeDrawer(true); draw();
  }
  root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  const confirmLeave = () => { const ok = window.confirm("保存していない変更があります。破棄して移りますか？"); if (ok) dirty = false; return ok; };

  const usedBy = (skill) => S.recipes.filter((r) => (r.uses || []).some((u) => u.skill === skill)).map((r) => r.name);
  const howLine = `<p class="how"><b>スキル</b>（部品）→ <b>レシピ</b>（組み合わせ・版を固定）→ Claude・GPT が読む。<b>仮説</b>はレビューが毎回読む。中身の正本は GitHub の shia2n-skills で、ここで書いたものもそこに入ります。</p>`;

  function draw() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    $("#note-top").textContent = S ? `正本の版の印 ${S.commit}` : "";
    if (!S) return;
    if (tab === "skills") drawSkills();
    else if (tab === "recipes") drawRecipes();
    else drawHypotheses();
  }
  const searchBar = (n, ph) => `<div class="bar"><div class="search"><label for="q">探す</label><input type="search" id="q" value="${esc(q)}" placeholder="${esc(ph)}"></div><span class="lead" style="margin:0">${n} 件</span></div>`;
  const wireSearch = () => { const qi = $("#q"); if (!qi) return; qi.addEventListener("input", () => { q = qi.value.trim(); const pos = qi.selectionStart; draw(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }); };
  const hit = (...xs) => !q || xs.join(" ").toLowerCase().includes(q.toLowerCase());
  const wireRows = (fn) => $("#main").querySelectorAll("tr.rw").forEach((tr) => { tr.addEventListener("click", () => fn(tr.dataset.id)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") fn(tr.dataset.id); }); });

  // ---------- スキル ----------
  // 便 2（2026-11-16 Naoki OK 08:16）：表示名を主役に、ジャンルでまとめ、ジャンル・カテゴリ・媒体で絞る。カードと表を切り替える
  const F = { genre: new Set(), category: new Set(), media: new Set() };
  // 2026-11-16 Naoki「カードとリストで切り替え・見出しで展開とたたむ」：見せ方は カード／リスト（ジャンルごとの行）。たたんだジャンルは覚えておく
  let view = (() => { try { const v = localStorage.getItem("skills_view"); return v === "table" || v === "list" ? "list" : "card"; } catch (_) { return "card"; } })();
  const closed = (() => { try { return new Set(JSON.parse(localStorage.getItem("skills_closed") || "[]")); } catch (_) { return new Set(); } })();
  const saveClosed = () => { try { localStorage.setItem("skills_closed", JSON.stringify([...closed])); } catch (_) {} };
  // スキルのアイコン（正本の assets/icon.svg・STANDARD.md 7 節）。img の data: で見せる（同じ id の SVG を並べてもぶつからないため）。読むだけの飾りなので alt は空
  const icon = (k, size = "") => k && k.icon && /^<svg[\s>]/.test(k.icon) ? `<img class="ic ${size}" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(k.icon)}">` : "";
  const title = (n) => { const x = S.skills.find((k) => k.name === n); return (x && x.title) || n; };
  const refBy = (n) => S.skills.filter((k) => (k.refs || []).includes(n)).map((k) => k.name);
  const chips = (arr, cls) => (arr || []).map((v) => `<span class="use ${cls || ""}">${esc(v)}</span>`).join("");
  const fixPrompt = (k) => `開発部よろしく。シアニンのスキル「${k.title || k.name}」（${k.name}・版 ${k.version || ""}）を、シアニン式スキル規格（正本の STANDARD.md）にそろえて直したい。正本：${S.repo}/tree/main/skills/${k.name}\n直したいこと：`;
  function drawSkills() {
    const pass = (k) => (!F.genre.size || F.genre.has(k.genre)) && (!F.category.size || (k.category || []).some((c) => F.category.has(c))) && (!F.media.size || (k.media || []).some((c) => F.media.has(c)));
    const rows = S.skills.filter((k) => pass(k) && hit(k.title, k.name, k.purpose, k.genre, (k.category || []).join(" "), (k.media || []).join(" "), k.owner));
    const stu = S.skills.filter((k) => k.student_version).length;
    const genres = [...(S.genres || []), ...new Set(S.skills.map((k) => k.genre).filter((g) => g && !(S.genres || []).includes(g)))];
    const medias = [...new Set(S.skills.flatMap((k) => k.media || []))];
    const nf = F.genre.size + F.category.size + F.media.size;
    const fset = (key, label, vals) => `<fieldset class="fg"><legend>${label}</legend>${vals.map((v) => `<label><input type="checkbox" data-f="${key}" value="${esc(v)}" ${F[key].has(v) ? "checked" : ""}> ${esc(v)}</label>`).join("")}</fieldset>`;
    const card = (k) => `<button class="sk" type="button" data-sk="${esc(k.name)}" aria-label="${esc(k.title || k.name)} の詳細を開く">
        <span class="sk-h">${icon(k)}<span><span class="sk-t">${esc(k.title || k.name)}</span><span class="sk-id">${esc(k.name)}</span></span></span>
        <span class="sk-p">${esc(k.purpose || "")}</span>
        <span class="uses">${chips(k.category)}${chips(k.media, "md")}<span class="use ver">版 ${esc(k.version || "")}</span>${k.student_version ? `<span class="use stu">生徒 ${esc(k.student_version)}</span>` : ""}</span></button>`;
    const line = (k) => `<tr class="rw" data-id="${esc(k.name)}" tabindex="0" aria-label="${esc(k.title || k.name)} の詳細を開く">
        <td class="nm"><span class="nmw">${icon(k, "sm")}<span>${esc(k.title || k.name)}<small>${esc(k.name)}</small></span></span></td><td>${esc((k.category || []).join("・"))}</td><td>${esc((k.media || []).join("・"))}</td>
        <td class="ver">${esc(k.version || "")}</td>
        <td class="ver ${k.student_version && k.student_version !== k.version ? "diff" : ""}">${k.student_version ? esc(k.student_version) + (k.student_version !== k.version ? "（古い）" : "") : ""}</td>
        <td>${esc(k.owner || "")}</td><td class="date">${esc(k.updated || "")}</td></tr>`;
    const groups = [...genres.map((g) => [g, rows.filter((k) => k.genre === g)]), ["ジャンル未設定", rows.filter((k) => !k.genre)]].filter(([, a]) => a.length);
    $("#main").innerHTML = `<h1>スキル</h1>${howLine}
      <p class="lead">${S.skills.length} 本・生徒に出しているのは ${stu} 本。書き方の決まりは<a href="${esc(S.repo)}/blob/main/STANDARD.md" target="_blank" rel="noopener">シアニン式スキル規格を別タブで開く ↗</a></p>
      <div class="bar">
        <div class="search"><label for="q">探す</label><input type="search" id="q" value="${esc(q)}" placeholder="表示名・ID・何に使うか・ジャンル・カテゴリ・媒体"></div>
        <button class="btn sm" type="button" id="f-open" aria-expanded="false" aria-controls="f-pop">絞り込み${nf ? `（${nf}）` : ""} ▾</button>
        <span class="seg" role="group" aria-label="見せ方"><button type="button" class="btn sm" data-view="card" aria-pressed="${view === "card"}">カード</button><button type="button" class="btn sm" data-view="list" aria-pressed="${view === "list"}">リスト</button></span>
        <span class="lead" style="margin:0">${rows.length} 件</span>
      </div>
      <div class="fpop" id="f-pop" hidden>${fset("genre", "ジャンル", genres)}${fset("category", "カテゴリ", S.categories || [])}${medias.length ? fset("media", "媒体", medias) : ""}</div>
      ${nf ? `<div class="uses" style="margin:0 0 12px">${["genre", "category", "media"].flatMap((key) => [...F[key]].map((v) => `<button type="button" class="use chipx" data-x="${key}" data-v="${esc(v)}" aria-label="${esc(v)} の絞り込みを外す">${esc(v)} ✕</button>`)).join("")}<button type="button" class="use chipx" id="f-clear">すべて外す</button></div>` : ""}
      ${groups.length > 1 ? `<div class="gtools"><button type="button" class="btn sm" id="g-open">すべて開く</button><button type="button" class="btn sm" id="g-close">すべてたたむ</button></div>` : ""}
      ${groups.map(([g, a]) => { const open = !!q || !closed.has(g); const id = `g-${genres.indexOf(g) + 1 || 0}`; return `<section class="gsec">
        <h2 style="margin:0"><button type="button" class="gh" data-g="${esc(g)}" aria-expanded="${open}" aria-controls="${id}"><span class="cv" aria-hidden="true">▾</span>${esc(g)} <small>${a.length}</small></button></h2>
        <div id="${id}" ${open ? "" : "hidden"}>${view === "card" ? `<div class="sks">${a.map(card).join("")}</div>`
          : `<div class="tbl list"><table><thead><tr><th>スキル</th><th>カテゴリ</th><th>媒体</th><th>最新の版</th><th>生徒の版</th><th>担当</th><th>更新</th></tr></thead><tbody>${a.map(line).join("")}</tbody></table></div>`}</div></section>`; }).join("")}
      ${rows.length ? "" : '<p class="lead">当てはまるスキルがありません。絞り込みを外してください。</p>'}
      ${S.broken ? `<p class="hint">読めなかったもの：${esc(S.broken.join("、"))}</p>` : ""}`;
    wireSearch(); wireRows(openSkill);
    $("#main").querySelectorAll("[data-sk]").forEach((b) => b.addEventListener("click", () => openSkill(b.dataset.sk)));
    $("#main").querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => {
      const g = b.dataset.g, open = b.getAttribute("aria-expanded") !== "true";
      open ? closed.delete(g) : closed.add(g); saveClosed();
      b.setAttribute("aria-expanded", String(open)); const body = $(`#${b.getAttribute("aria-controls")}`); if (body) body.hidden = !open;
    }));
    const ga = $("#g-open"), gz = $("#g-close");
    if (ga) ga.addEventListener("click", () => { closed.clear(); saveClosed(); draw(); $("#g-open").focus(); });
    if (gz) gz.addEventListener("click", () => { for (const [g] of groups) closed.add(g); saveClosed(); draw(); $("#g-close").focus(); });
    $("#main").querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; try { localStorage.setItem("skills_view", view); } catch (_) {} draw(); const n = $(`[data-view="${view}"]`); if (n) n.focus(); }));
    const pop = $("#f-pop"), ob = $("#f-open");
    const closePop = (focus) => { pop.hidden = true; ob.setAttribute("aria-expanded", "false"); if (focus) ob.focus(); };
    ob.addEventListener("click", (e) => { e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; ob.setAttribute("aria-expanded", String(open)); if (open) { const f = pop.querySelector("input"); if (f) f.focus(); } });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(true); } });
    pop.querySelectorAll("input[data-f]").forEach((c) => c.addEventListener("change", () => {
      const set = F[c.dataset.f]; c.checked ? set.add(c.value) : set.delete(c.value);
      draw(); const p2 = $("#f-pop"); p2.hidden = false; $("#f-open").setAttribute("aria-expanded", "true");
      const back2 = p2.querySelector(`input[data-f="${c.dataset.f}"][value="${CSS.escape(c.value)}"]`); if (back2) back2.focus();
    }));
    $("#main").querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => { F[b.dataset.x].delete(b.dataset.v); draw(); $("#f-open").focus(); }));
    const fc = $("#f-clear"); if (fc) fc.addEventListener("click", () => { F.genre.clear(); F.category.clear(); F.media.clear(); draw(); $("#f-open").focus(); });
  }
  function openSkill(name) {
    const k = S.skills.find((x) => x.name === name); if (!k) return;
    back = name;
    const used = usedBy(name), by = refBy(name);
    const linkSkill = (n) => S.skills.some((x) => x.name === n) ? `<button class="btn sm" type="button" data-go-skill="${esc(n)}">${esc(title(n))} →</button>` : S.recipes.some((r) => r.name === n) ? `<button class="btn sm" type="button" data-go-recipe="${esc(n)}">レシピ ${esc(n)} →</button>` : `<span class="use">${esc(n)}（正本に無い）</span>`;
    const ask = `https://claude.ai/new?q=${encodeURIComponent(fixPrompt(k))}`;
    openDrawer(`<div class="dh"><h2 id="d-title">${icon(k, "lg")}${esc(k.title || k.name)}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        <p style="margin-top:0"><span class="use">${esc(k.genre || "ジャンル未設定")}</span> ${chips(k.category)} ${chips(k.media, "md")}</p>
        <p>${esc(k.purpose || "")}</p>
        <div class="bar"><a class="btn pri sm" href="${ask}" target="_blank" rel="noopener">Claude で直す ↗</a><button class="btn sm" type="button" id="copy-ask">依頼文をコピー</button></div>
        <p class="hint" style="margin-top:0">Claude が開き、依頼文が入った状態になります。直したいことを書き足して送ります。開発部のチャットに貼るときは「依頼文をコピー」。</p>
        <dl class="meta"><dt>ID（AI が呼ぶ名前）</dt><dd>${esc(k.name)}</dd><dt>最新の版</dt><dd>${esc(k.version || "")}</dd><dt>生徒の版</dt><dd>${esc(k.student_version || "出していない")}</dd>
          <dt>使う場所</dt><dd>${esc(k.where.join("・"))}</dd><dt>見せる相手</dt><dd>${esc(k.audience.join("・"))}</dd><dt>担当</dt><dd>${esc(k.owner || "")}</dd>
          <dt>更新</dt><dd>${esc(k.updated || "")}</dd><dt>レシピでの扱い</dt><dd>${esc(k.kind || (k.latest_ok ? "基本スキル" : "選択スキル"))}・${k.latest_ok ? "最新にできる" : "版で固定"}</dd><dt>ファイル</dt><dd>${k.files} 個</dd></dl>
        <div class="sec" style="margin-top:14px"><h3>参照している</h3>${(k.refs || []).length ? k.refs.map(linkSkill).join(" ") : '<p class="hint" style="margin:0">なし</p>'}</div>
        <div class="sec"><h3>参照されている</h3>${by.length || used.length ? [...by.map(linkSkill), ...used.map((r) => `<button class="btn sm" type="button" data-go-recipe="${esc(r)}">レシピ ${esc(r)} →</button>`)].join(" ") : '<p class="hint" style="margin:0">まだどこからも使われていません</p>'}</div>
        ${(k.conflicts || []).length ? `<div class="sec"><h3>一緒に使えない</h3>${k.conflicts.map(linkSkill).join(" ")}</div>` : ""}
        <div class="sec"><h3>説明（AI が使う場面を決める文）</h3><p style="font-size:13px;margin:0">${esc(k.description)}</p></div>
        ${k.missing.length ? `<p class="hint" style="color:var(--warn)">頭の欄が欠けています：${esc(k.missing.join("・"))}</p>` : ""}
        <p class="hint"><a href="${esc(S.repo)}/tree/main/skills/${encodeURIComponent(k.name)}" target="_blank" rel="noopener">このスキルを正本で別タブで開く ↗</a></p>
      </div>`);
    const d = $("#drawer");
    d.querySelectorAll("[data-go-recipe]").forEach((b) => b.addEventListener("click", () => { tab = "recipes"; closeDrawer(true); draw(); openRecipe(b.dataset.goRecipe); }));
    d.querySelectorAll("[data-go-skill]").forEach((b) => b.addEventListener("click", () => openSkill(b.dataset.goSkill)));
    $("#copy-ask").addEventListener("click", async () => { try { await navigator.clipboard.writeText(fixPrompt(k)); say("依頼文をコピーしました"); } catch (_) { say("コピーできませんでした。Claude で直す ↗ を使ってください"); } });
  }

  // ---------- レシピ ----------
  // 2026-11-16 Naoki OK 10:44：レシピの見た目をスキルの棚とそろえる。レシピ専用のアイコンは作らず、入っているスキルのアイコンを優先の順に重ねて顔にする
  let rview = (() => { try { return localStorage.getItem("recipes_view") === "list" ? "list" : "card"; } catch (_) { return "card"; } })();
  const skillOf = (n) => S.skills.find((k) => k.name === n) || null;
  const stack = (r, big) => `<span class="stk ${big ? "big" : ""}" aria-hidden="true">${r.uses.map((u) => { const k = skillOf(u.skill); const im = k && k.icon ? icon(k, big ? "" : "sm") : `<span class="ic ${big ? "" : "sm"} noic"></span>`; return `<span class="sti">${im}${u.pinned ? "" : '<span class="lt">最新</span>'}</span>`; }).join("")}</span>`;
  const usesText = (r) => r.uses.map((u) => `${title(u.skill)} ${u.pinned ? u.version : "最新"}`).join("、");
  const nflow = (r) => (Array.isArray(r.flow) ? r.flow.length : 0);
  function drawRecipes() {
    const rows = S.recipes.filter((r) => hit(r.name, r.title, r.purpose, (r.uses || []).map((u) => `${u.skill} ${title(u.skill)}`).join(" ")));
    const rcard = (r) => r.broken ? `<div class="sk"><span class="sk-t">${esc(r.name)}</span><span class="sk-p">頭が読めませんでした</span></div>`
      : `<button class="sk" type="button" data-rc="${esc(r.name)}" aria-label="${esc(r.title || r.name)} を編集。入っているスキル：${esc(usesText(r))}">
        ${stack(r, true)}
        <span class="sk-t">${esc(r.title || r.name)}</span><span class="sk-id">${esc(r.name)}</span>
        <span class="sk-p">${esc(r.purpose || "")}</span>
        <span class="uses">${r.uses.map((u) => `<span class="use ${u.pinned ? "" : "latest"}">${esc(title(u.skill))} ${u.pinned ? esc(u.version) : "最新"}${u.strength && u.strength !== "標準" ? `・${esc(u.strength)}` : ""}</span>`).join("")}</span>
        <span class="uses"><span class="use ver">流れ ${nflow(r)} 手順</span><span class="use ver">版 ${esc(r.version || "")}</span><span class="use ver">${esc(r.updated || "")}</span></span></button>`;
    $("#main").innerHTML = `<h1>レシピ</h1>${howLine}
      <p class="lead">スキルの組み合わせです。上の行ほど優先（ルールがぶつかったら勝つ）。保存すると版が 1 つ上がり、Claude・GPT は次に読むときからその版を使います（recipes__get）。</p>
      <div class="bar"><button class="btn pri sm" type="button" id="new-recipe">＋ レシピを新規作成</button>
        <span class="seg" role="group" aria-label="見せ方"><button type="button" class="btn sm" data-rview="card" aria-pressed="${rview === "card"}">カード</button><button type="button" class="btn sm" data-rview="list" aria-pressed="${rview === "list"}">リスト</button></span></div>
      ${searchBar(rows.length, "表示名・何に使うか・入っているスキル")}
      ${rview === "card" ? `<div class="sks">${rows.map(rcard).join("")}</div>` : `<div class="tbl list"><table><thead><tr><th>レシピ</th><th>入っているスキル（上から優先）</th><th>流れ</th><th>版</th><th>更新</th></tr></thead><tbody>
      ${rows.map((r) => r.broken ? `<tr><td class="nm">${esc(r.name)}<small>頭が読めませんでした</small></td><td></td><td></td><td></td><td></td></tr>` : `<tr class="rw" data-id="${esc(r.name)}" tabindex="0" aria-label="${esc(r.title || r.name)} を編集">
        <td class="nm">${esc(r.title || r.name)}<small>${esc(r.title ? r.name + "・" : "")}${esc(r.purpose || "")}</small></td>
        <td><div class="nmw">${stack(r)}<div class="uses">${r.uses.map((u) => `<span class="use ${u.pinned ? "" : "latest"}" title="${esc(u.skill)}">${esc(title(u.skill))} ${u.pinned ? esc(u.version) : "最新"}${u.strength && u.strength !== "標準" ? `・${esc(u.strength)}` : ""}</span>`).join("")}</div></div></td>
        <td class="ver">${nflow(r)} 手順</td><td class="ver">${esc(r.version || "")}</td>
        <td class="date">${esc(r.updated || "")}</td></tr>`).join("")}
      </tbody></table></div>`}`;
    wireSearch(); wireRows(openRecipe);
    $("#main").querySelectorAll("[data-rc]").forEach((b) => b.addEventListener("click", () => openRecipe(b.dataset.rc)));
    $("#main").querySelectorAll("[data-rview]").forEach((b) => b.addEventListener("click", () => { rview = b.dataset.rview; try { localStorage.setItem("recipes_view", rview); } catch (_) {} draw(); const n = $(`[data-rview="${rview}"]`); if (n) n.focus(); }));
    $("#new-recipe").addEventListener("click", () => openRecipe(null));
  }

  // 編集中の並び：{ skill, pin: keep|now|latest, strength, cur: { version, pinned } | null }
  let E = null;
  function openRecipe(name, sub) {
    const r = name ? S.recipes.find((x) => x.name === name) : null;
    if (name && !r) return;
    back = name;
    E = { create: !r, name: r ? r.name : "", title: r ? r.title || "" : "", purpose: r ? r.purpose || "" : "", idManual: false, sub: sub || "skills",
      uses: r ? r.uses.map((u) => ({ skill: u.skill, pin: "keep", strength: u.strength || "標準", cur: { version: u.version, pinned: u.pinned } })) : [],
      flow: r && Array.isArray(r.flow) ? r.flow.map((f) => ({ title: f.title || "", detail: f.detail || "", skill: f.skill || "", check: f.check || "", prompt: f.prompt || "" })) : [],
      flowTouched: false };
    dirty = false;
    drawRecipeDrawer(r);
  }
  const catOf = (n) => ((S.skills.find((x) => x.name === n) || {}).category || []).join("・");
  const groupLeft = (left) => {
    const gs = [...new Set([...(S.genres || []), ...left.map((x) => x.genre || "ジャンル未設定")])];
    return gs.map((g) => { const a = left.filter((x) => (x.genre || "ジャンル未設定") === g); return a.length ? `<optgroup label="${esc(g)}">${a.map((x) => `<option value="${esc(x.name)}">${esc(x.title || x.name)}（${esc((x.category || []).join("・"))}・${esc(x.version || "")}）</option>`).join("")}</optgroup>` : ""; }).join("");
  };
  const skillVer = (n) => (S.skills.find((s) => s.name === n) || {}).version || "";
  const isBase = (n) => (S.base_latest || []).includes(n);
  function pinOptions(u) {
    const now = skillVer(u.skill), o = [];
    if (u.cur) o.push(["keep", u.cur.pinned ? `固定のまま（${u.cur.version}）` : "最新のまま"]);
    if (!u.cur || !u.cur.pinned || u.cur.version !== now) o.push(["now", `いまの版で固定（${now}）`]);
    if (isBase(u.skill) && (!u.cur || u.cur.pinned)) o.push(["latest", "最新（基本スキル）"]);
    return o.map(([v, l]) => `<option value="${v}" ${u.pin === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  }
  function drawRecipeDrawer(r) {
    const left = S.skills.filter((s) => !E.uses.some((u) => u.skill === s.name));
    openDrawer(`<div class="dh"><h2 id="d-title">${E.create ? "レシピを新規作成" : esc(E.title || E.name)}</h2><button class="x" type="button" id="d-close" aria-label="閉じる">✕</button></div>
      <div class="db">
        ${E.create ? "" : `<p class="hint" style="margin-top:0">ID ${esc(E.name)}・いまの版 ${esc(r.version || "")}・保存すると ${esc(nextVer(r.version))} になります</p>`}
        <div class="f"><label for="r-title">表示名</label><input id="r-title" maxlength="60" value="${esc(E.title)}" placeholder="例 10選×小ボケ（強）"></div>
        ${E.create ? `<div class="f"><label for="r-name">ID（AI が呼ぶ名前・表示名から自動。変えてもよい）</label><input id="r-name" maxlength="80" value="${esc(E.name)}" placeholder="表示名を入れると案が入ります" spellcheck="false"></div>` : ""}
        <div class="f"><label for="r-purpose">何に使うか（1 行）</label><input id="r-purpose" maxlength="120" value="${esc(E.purpose)}"></div>
        <div class="top" role="tablist" aria-label="レシピの中身" style="margin:6px 0 10px;padding:0;border:0;background:none"><button class="tab" type="button" role="tab" data-sub="skills" aria-selected="${E.sub === "skills"}">スキル（${E.uses.length}）</button><button class="tab" type="button" role="tab" data-sub="flow" aria-selected="${E.sub === "flow"}">流れ（${E.flow.length}）</button></div>
        ${E.sub === "flow" ? flowEditor() : `<div class="sec"><h3>スキル（上から優先・左のつまみで並べ替え）</h3><div id="ul">${E.uses.map((u, i) => `<div class="ur" data-i="${i}">
            <button class="grip" type="button" aria-label="${esc(u.skill)} の並びを変える（Alt＋↑↓）">⋮⋮</button>
            <span class="nm">${esc(title(u.skill))}<small>${esc(u.skill)}・${isBase(u.skill) ? "基本スキル" : "選択スキル"}${catOf(u.skill) ? `・${esc(catOf(u.skill))}` : ""}</small></span>
            <select data-pin="${i}" aria-label="${esc(u.skill)} の版">${pinOptions(u)}</select>
            <select data-st="${i}" aria-label="${esc(u.skill)} の強さ">${(S.strengths || ["標準", "強", "弱", "無"]).map((k) => `<option ${u.strength === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
            <span class="ud"><button type="button" data-up="${i}" aria-label="上へ">▲</button><button type="button" data-dn="${i}" aria-label="下へ">▼</button></span>
            <button class="del" type="button" data-del="${i}" aria-label="${esc(u.skill)} を削除">✕</button></div>`).join("") || '<p class="hint">まだスキルがありません。下で追加します。</p>'}</div>
          <div class="bar" style="margin-top:8px"><select id="add-skill" aria-label="追加するスキル" style="flex:1;border:1px solid var(--field);border-radius:8px;padding:6px 8px;min-height:36px;background:var(--panel)"><option value="">スキルを選ぶ（ジャンルごと）</option>${groupLeft(left)}</select><button class="btn sm" type="button" id="add-btn">追加</button></div>
          <p class="hint">選択スキルは版で固定（スキルを直してもレシピは変わらない）。最新にできるのは基本スキルだけ（いまはレビュー）。強さはスキルごとの効かせ方です。</p></div>`}
        ${!E.create ? `<p class="hint">「ぶつかったとき」などほかの本文は残ります。直すのは正本で。<a href="${esc(S.repo)}/blob/main/recipes/${encodeURIComponent(E.name)}/RECIPE.md" target="_blank" rel="noopener">このレシピを正本で別タブで開く ↗</a></p>` : ""}
        <p class="err hide" id="r-err" role="alert"></p>
      </div>
      <div class="bar" style="padding:12px 16px;border-top:1px solid var(--line);margin:0"><button class="btn pri" type="button" id="r-save">${E.create ? "作成" : "保存"}</button><button class="btn" type="button" id="r-cancel">キャンセル</button></div>`, true);
    const d = $("#drawer");
    const mark = () => { dirty = true; };
    const nameIn = $("#r-name"); if (nameIn) nameIn.addEventListener("input", (e) => { E.name = e.target.value.trim(); E.idManual = !!E.name; mark(); });
    $("#r-title").addEventListener("input", (e) => { E.title = e.target.value; mark(); if (E.create && !E.idManual) suggestId(); });
    $("#r-purpose").addEventListener("input", (e) => { E.purpose = e.target.value; mark(); });
    d.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { E.sub = b.dataset.sub; redraw(r, `[data-sub="${E.sub}"]`); }));
    if (E.sub === "flow") { wireFlow(r); return; }
    d.querySelectorAll("[data-pin]").forEach((s) => s.addEventListener("change", () => { E.uses[+s.dataset.pin].pin = s.value; mark(); }));
    d.querySelectorAll("[data-st]").forEach((s) => s.addEventListener("change", () => { E.uses[+s.dataset.st].strength = s.value; mark(); }));
    d.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { E.uses.splice(+b.dataset.del, 1); mark(); redraw(r, "#add-skill"); }));
    const move = (i, to) => { if (to < 0 || to >= E.uses.length) return; const [x] = E.uses.splice(i, 1); E.uses.splice(to, 0, x); mark(); redraw(r, `.ur[data-i="${to}"] .grip`); };
    d.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
    d.querySelectorAll("[data-dn]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.dn, +b.dataset.dn + 1)));
    d.querySelectorAll(".grip").forEach((g) => {
      const i = +g.closest(".ur").dataset.i;
      g.addEventListener("keydown", (e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(i, i + (e.key === "ArrowUp" ? -1 : 1)); } });
      g.addEventListener("pointerdown", (e) => startDrag(e, i, move));
    });
    $("#add-btn").addEventListener("click", () => {
      const v = $("#add-skill").value;
      if (!v) { showErr("追加するスキルを選んでください"); $("#add-skill").focus(); return; }
      E.uses.push({ skill: v, pin: "now", strength: "標準", cur: null }); mark(); redraw(r, "#add-skill");
    });
    $("#r-save").addEventListener("click", () => saveRecipe());
    $("#r-cancel").addEventListener("click", () => { if (dirty && !confirmLeave()) return; closeDrawer(); });
  }
  // 便 3（2026-11-16）：流れ＝ワークフロー。手順ごとに 題・説明・使うスキル・人の確認・プロンプト
  function flowEditor() {
    const opts = (cur) => `<option value="">使わない</option>${E.uses.map((u) => `<option value="${esc(u.skill)}" ${cur === u.skill ? "selected" : ""}>${esc(title(u.skill))}</option>`).join("")}`;
    return `<div class="sec"><h3>流れ（上から順に進める・左のつまみで並べ替え）</h3>
      <p class="hint" style="margin-top:0">AI はこの順に進みます。プロンプトがある手順はその文で作り、「人の確認」がある手順で止まって見せます。</p>
      <div id="fl">${E.flow.map((f, i) => `<div class="fs" data-i="${i}">
        <div class="fs-h"><button class="grip" type="button" aria-label="手順 ${i + 1} の並びを変える（Alt＋↑↓）">⋮⋮</button><b>手順 ${i + 1}</b><span class="grow"></span><span class="ud"><button type="button" data-fup="${i}" aria-label="上へ">▲</button><button type="button" data-fdn="${i}" aria-label="下へ">▼</button></span><button class="del" type="button" data-fdel="${i}" aria-label="手順 ${i + 1} を削除">✕</button></div>
        <div class="f"><label for="f-t-${i}">題</label><input id="f-t-${i}" data-ff="title" data-i="${i}" maxlength="80" value="${esc(f.title)}" placeholder="例 項目と見出しを決める"></div>
        <div class="f"><label for="f-d-${i}">説明（任意）</label><textarea class="q" id="f-d-${i}" data-ff="detail" data-i="${i}" maxlength="1000" style="min-height:48px">${esc(f.detail)}</textarea></div>
        <div class="fs-2"><div class="f"><label for="f-s-${i}">使うスキル</label><select id="f-s-${i}" data-ff="skill" data-i="${i}">${opts(f.skill)}</select></div>
          <div class="f"><label for="f-c-${i}">人の確認（任意）</label><input id="f-c-${i}" data-ff="check" data-i="${i}" maxlength="200" value="${esc(f.check)}" placeholder="例 シアニンが 3 案から選ぶ"></div></div>
        <div class="f"><label for="f-p-${i}">プロンプト（任意・AI にそのまま渡す文）</label><textarea class="q mono" id="f-p-${i}" data-ff="prompt" data-i="${i}" maxlength="4000" style="min-height:96px">${esc(f.prompt)}</textarea></div>
      </div>`).join("") || '<p class="hint">まだ手順がありません。下で追加します。</p>'}</div>
      <div class="bar" style="margin-top:8px"><button class="btn sm" type="button" id="f-add">＋ 手順を追加</button><span class="hint" style="margin:0">${E.flow.length} / 20</span></div></div>`;
  }
  function wireFlow(r) {
    const d = $("#drawer");
    const touch = () => { dirty = true; E.flowTouched = true; };
    d.querySelectorAll("[data-ff]").forEach((el) => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { E.flow[+el.dataset.i][el.dataset.ff] = el.value; touch(); }));
    const move = (i, to) => { if (to < 0 || to >= E.flow.length) return; const [x] = E.flow.splice(i, 1); E.flow.splice(to, 0, x); touch(); redraw(r, `.fs[data-i="${to}"] .grip`); };
    d.querySelectorAll("[data-fup]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.fup, +b.dataset.fup - 1)));
    d.querySelectorAll("[data-fdn]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.fdn, +b.dataset.fdn + 1)));
    d.querySelectorAll("[data-fdel]").forEach((b) => b.addEventListener("click", () => { E.flow.splice(+b.dataset.fdel, 1); touch(); redraw(r, "#f-add"); }));
    d.querySelectorAll(".fs .grip").forEach((g) => {
      const i = +g.closest(".fs").dataset.i;
      g.addEventListener("keydown", (e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(i, i + (e.key === "ArrowUp" ? -1 : 1)); } });
      g.addEventListener("pointerdown", (e) => startDrag(e, i, move, "#fl", ".fs"));
    });
    $("#f-add").addEventListener("click", () => {
      if (E.flow.length >= 20) { showErr("手順は 20 個までです"); return; }
      E.flow.push({ title: "", detail: "", skill: "", check: "", prompt: "" }); touch(); redraw(r, `#f-t-${E.flow.length - 1}`);
    });
    $("#r-save").addEventListener("click", () => saveRecipe());
    $("#r-cancel").addEventListener("click", () => { if (dirty && !confirmLeave()) return; closeDrawer(); });
  }
  let idTimer = 0;
  function suggestId() {
    clearTimeout(idTimer);
    idTimer = setTimeout(async () => {
      const t = E.title.trim(); if (!t || E.idManual) return;
      const r = await call(`/api/admin/skills/slug?title=${encodeURIComponent(t)}`);
      if (!r.ok || !r.slug || E.idManual) return;
      let id = r.slug, n = 2;
      while (S.recipes.some((x) => x.name === id)) id = `${r.slug}-${n++}`;
      E.name = id; const el = $("#r-name"); if (el && root.activeElement !== el) el.value = id;
    }, 600);
  }
  function redraw(r, focusSel) {
    const scroll = $("#drawer .db") ? $("#drawer .db").scrollTop : 0;
    drawRecipeDrawer(r);
    $("#drawer .db").scrollTop = scroll;
    const f = focusSel && $("#drawer").querySelector(focusSel); if (f) f.focus();
  }
  function startDrag(e, from, move, listSel = "#ul", rowSel = ".ur") {
    const row = e.target.closest(rowSel); const list = $(listSel); if (!row || !list) return;
    e.preventDefault(); row.classList.add("drag");
    let to = from;
    const onMove = (ev) => {
      const rows = [...list.querySelectorAll(rowSel)];
      rows.forEach((x) => x.classList.remove("over"));
      const t = rows.find((x) => { const b = x.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY <= b.bottom; });
      if (t) { to = +t.dataset.i; t.classList.add("over"); }
    };
    const onUp = () => { root.host.ownerDocument.removeEventListener("pointermove", onMove); root.host.ownerDocument.removeEventListener("pointerup", onUp); row.classList.remove("drag"); if (to !== from) move(from, to); else list.querySelectorAll(rowSel).forEach((x) => x.classList.remove("over")); };
    root.host.ownerDocument.addEventListener("pointermove", onMove);
    root.host.ownerDocument.addEventListener("pointerup", onUp);
  }
  const nextVer = (v) => { const m = /^(\d+)\.(\d+)$/.exec(String(v || "")); return m ? `${m[1]}.${+m[2] + 1}` : "1.0"; };
  function showErr(t) { const e = $("#r-err") || $("#h-err"); if (e) { e.textContent = t; e.classList.remove("hide"); } say(t); }
  async function saveRecipe() {
    if (E.create && !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(E.name)) { showErr(ERR.bad_name); $("#r-name").focus(); return; }
    if (E.create && !E.purpose.trim()) { showErr(ERR.need_purpose); $("#r-purpose").focus(); return; }
    if (!E.uses.length) { E.sub = "skills"; redraw(E.create ? null : S.recipes.find((x) => x.name === E.name) || null, "#add-skill"); showErr(ERR.no_skills); return; }
    const noTitle = E.flow.findIndex((f) => !String(f.title || "").trim());
    if (E.flowTouched && noTitle >= 0) { E.sub = "flow"; redraw(S.recipes.find((x) => x.name === E.name) || null, `#f-t-${noTitle}`); showErr(`手順 ${noTitle + 1} の題を入れてください`); return; }
    const lost = E.flow.find((f) => f.skill && !E.uses.some((u) => u.skill === f.skill));
    if (E.flowTouched && lost) { E.sub = "flow"; redraw(S.recipes.find((x) => x.name === E.name) || null, "#f-add"); showErr(`流れの「${lost.title}」が、レシピから外したスキル（${title(lost.skill)}）を使っています`); return; }
    const btn = $("#r-save"); btn.disabled = true; btn.textContent = "正本に書いています…";
    const r = await call("/api/admin/skills/recipe", { name: E.name, create: E.create, purpose: E.purpose, title: E.title.trim() || null, uses: E.uses.map((u) => ({ skill: u.skill, pin: u.pin, strength: u.strength })),
      ...(E.flowTouched && (E.flow.length || !E.create) ? { flow: E.flow.map((f) => ({ title: f.title, detail: f.detail || null, skill: f.skill || null, check: f.check || null, prompt: f.prompt || null })) } : {}) });
    btn.disabled = false; btn.textContent = E.create ? "作成" : "保存";
    if (!r.ok) { showErr(errText(r.error)); return; }
    dirty = false;
    const nm = E.name;
    await load(r.at);
    say(`レシピ「${nm}」を ${r.version} で保存しました（正本 ${r.commit}）`);
    openRecipe(nm, E.sub);
  }

  // ---------- 仮説 ----------
  function drawHypotheses() {
    const rows = S.hypotheses.filter((h) => hit(h.id, h.title, h.status, h.body));
    $("#main").innerHTML = `<h1>仮説</h1>${howLine}
      <p class="lead">シアニンの仮説は言葉のまま入れます（言い換えない）。レビュー（${esc(S.hypotheses_skill)}）が毎回読みます。中身は書き換えず、状態と追記で育てます。</p>
      <div class="bar"><button class="btn pri sm" type="button" id="h-new">＋ 仮説を追加</button></div>
      <form id="h-form" class="hy" hidden>
        <div class="f"><label for="h-title">題（短く）</label><input id="h-title" maxlength="80"></div>
        <div class="f"><label for="h-words">中身（言葉のまま）</label><textarea class="q" id="h-words" maxlength="2000"></textarea></div>
        <div class="f"><label for="h-target">誰に当てるか（言ったときだけ）</label><input id="h-target" maxlength="200" placeholder="例 生徒だけ"></div>
        <p class="err hide" id="h-err" role="alert"></p>
        <div class="acts"><button class="btn pri sm" type="submit">追加</button><button class="btn sm" type="button" id="h-cancel">キャンセル</button><span class="hint" style="margin:0">⌘／Ctrl＋Enter でも追加</span></div>
      </form>
      ${searchBar(rows.length, "番号・題・中身")}
      ${S.hypotheses_error ? `<p class="lead">${esc(S.hypotheses_error)}</p>` : ""}
      ${rows.map((h) => `<article class="hy" data-h="${esc(h.id)}"><h3>${esc(h.id)} ${esc(h.title)} <span class="st ${STATUS_KIND[statusWord(h.status)] || "off"}">${esc(statusWord(h.status) || "状態なし")}</span></h3>
        <div class="body" id="b-${esc(h.id)}">${esc(h.body)}</div>
        <div class="acts"><button class="btn sm" type="button" data-more="${esc(h.id)}" aria-expanded="false">全文 ▼</button>
          <label class="sr" for="s-${esc(h.id)}">${esc(h.id)} の状態</label><select id="s-${esc(h.id)}"><option value="">状態はそのまま</option>${(S.statuses || []).map((k) => `<option>${esc(k)}</option>`).join("")}</select>
          <button class="btn sm" type="button" data-note="${esc(h.id)}">追記・状態を保存</button></div>
        <textarea class="q" id="n-${esc(h.id)}" maxlength="2000" placeholder="追記（言葉のまま・任意）" style="margin-top:8px;min-height:48px"></textarea></article>`).join("")}`;
    wireSearch();
    const form = $("#h-form");
    $("#h-new").addEventListener("click", () => { form.hidden = false; $("#h-title").focus(); });
    $("#h-cancel").addEventListener("click", () => { form.hidden = true; $("#h-new").focus(); });
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = $("#h-title").value.trim(), words = $("#h-words").value.trim();
      if (!title) { showErr("題を入れてください"); $("#h-title").focus(); return; }
      if (!words) { showErr("中身を入れてください"); $("#h-words").focus(); return; }
      const r = await call("/api/admin/skills/hypothesis", { action: "add", title, words, target: $("#h-target").value.trim() || undefined });
      if (!r.ok) { showErr(errText(r.error)); return; }
      dirty = false; await load(r.at); say(`仮説 ${r.id} を追加しました（正本 ${r.commit}）`);
    });
    $("#main").querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { const el = $(`#b-${CSS.escape(b.dataset.more)}`); const open = el.classList.toggle("open"); b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "たたむ ▲" : "全文 ▼"; }));
    $("#main").querySelectorAll("textarea[id^=n-]").forEach((t) => t.addEventListener("input", () => { dirty = true; }));
    $("#main").querySelectorAll("[data-note]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.note, status = $(`#s-${CSS.escape(id)}`).value, note = $(`#n-${CSS.escape(id)}`).value.trim();
      if (!status && !note) { say(ERR.need_status_or_note); $(`#s-${CSS.escape(id)}`).focus(); return; }
      b.disabled = true;
      const r = await call("/api/admin/skills/hypothesis", { action: "update", id, status: status || undefined, note: note || undefined });
      b.disabled = false;
      if (!r.ok) { say(errText(r.error)); return; }
      dirty = false; await load(r.at); say(`仮説 ${r.id} を保存しました（正本 ${r.commit}）`);
      const n = $(`[data-note="${CSS.escape(id)}"]`); if (n) n.focus();
    }));
  }

  // 絞り込みの窓は、外を押すと閉じる（Esc・別の物を開くでも閉じる。app-design-rules 4）
  root.host.ownerDocument.addEventListener("click", (e) => {
    const pop = $("#f-pop"), ob = $("#f-open"); if (!pop || pop.hidden) return;
    const path = e.composedPath(); if (path.includes(pop) || path.includes(ob)) return;
    pop.hidden = true; ob.setAttribute("aria-expanded", "false");
  });

  // ---------- 詳細の窓 ----------
  function openDrawer(html, wide) {
    const d = $("#drawer"); d.innerHTML = html; d.classList.toggle("wide", !!wide); d.hidden = false; $("#scrim").hidden = false;
    $("#d-close").addEventListener("click", () => { if (dirty && !confirmLeave()) return; closeDrawer(); });
    const f = d.querySelector("input,select,button.btn,a.btn,#d-close"); if (f) f.focus();
  }
  function closeDrawer(silent) {
    $("#drawer").hidden = true; $("#scrim").hidden = true; dirty = false;
    if (silent) return;
    const tr = back && $("#main").querySelector(`tr[data-id="${CSS.escape(back)}"]`); if (tr) tr.focus();
  }
  $("#scrim").addEventListener("click", () => { if (dirty && !confirmLeave()) return; closeDrawer(); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) { e.preventDefault(); if (dirty && !confirmLeave()) return; closeDrawer(); }
    if (e.key === "Tab" && !$("#drawer").hidden) { // 窓の中で回る
      const fs = [...$("#drawer").querySelectorAll("a,button,input,select,textarea")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!fs.length) return;
      const a = root.activeElement;
      if (e.shiftKey && a === fs[0]) { e.preventDefault(); fs[fs.length - 1].focus(); }
      else if (!e.shiftKey && a === fs[fs.length - 1]) { e.preventDefault(); fs[0].focus(); }
    }
  });

  return {
    open(sub) { if (sub && TABS.some(([k]) => k === sub)) tab = sub; if (!S) load(); else draw(); },
    reload: load,
  };
}

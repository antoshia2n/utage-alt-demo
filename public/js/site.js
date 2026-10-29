// 会員サイトの管理（2026-10-29 Naoki「OK」）。デモ 6 版の画面を、本物の表（/api/admin/site/*）につないだもの。
//  ・シアニン用の画面（admin.html）の「会員サイト」の中に、影の DOM で入れる（見た目と id が今の画面とぶつからないため）。
//  ・書く操作はどれも「サーバーへ送る → 表を読み直す → 描き直す」。読み直すので、画面と表がずれない。
//  ・名前は学ぶくんと同じ：サイト › カリキュラム › プログラム › コース › コンテンツ。権利はカリキュラムに付く。
import { api } from "/js/common.js";

const KEY_LABEL = {
  shiarabo_basic: "しあらぼ", shiarabo_office_hour: "オフィスアワー", consult_single: "単発の個別相談", consult_followup: "フォローアップ相談",
  seminar_recording: "セミナー録画", workbook_ai_30day: "30日AIワークブック", textbook_60day: "60日教材", vip_status: "VIP",
  shiarabo_trial: "しあらぼ体験", note_membership: "note メンシプ", shiarabo_pilot: "先行で試す", shiarabo_monitor: "モニター",
};
const ERR = {
  title_required: "名前が空です", name_required: "名前が空です", publish_at_required: "公開する日時が空です",
  bad_drip_days: "日数は 0 以上の整数で入れてください", bad_minutes: "見る時間は 0〜1440 の整数で入れてください",
  bad_video_url: "YouTube の住所ではないようです（youtube.com か youtu.be）", bad_toc_time: "目次の時間は 12:30 や 1:02:30 の形で入れてください",
  bad_file_url: "資料の住所は https:// から始まる形で入れてください", course_required: "所属するコースを 1 つ以上選んでください",
  list_mismatch: "並びが読み直す前のものでした。もう一度試してください", demo_store: "デモの置き場では使えません（本番の置き場だけ）",
  not_found: "見つかりませんでした（ほかの画面で消えたかもしれません）", bad_urls: "YouTube の住所ではない行があります",
};
const STL = { published: "公開", draft: "下書き", scheduled: "予約", drip: "入会から日数" };
const PALETTE = ["#b45309", "#7c3aed", "#0f766e", "#be123c", "#1d4ed8", "#4d7c0f", "#c2410c", "#0369a1", "#a21caf", "#15803d", "#9f1239", "#334155"];

export function mountSite(host, { getToken, openPerson }) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="/css/site.css"><div class="wrap"><nav class="side" aria-label="会員サイト" id="side"></nav><main id="main" tabindex="-1"><p class="hint">読み込んでいます…</p></main></div>
  <div id="live" class="sr" aria-live="polite"></div><div id="toast"></div><div id="mslot"></div>`;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t) => { $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = t), 30); };
  const call = (path, method = "GET", body) => api(path.startsWith("/") ? path : "/api/admin/site/" + path, { method, body, token: getToken() });
  const errText = (r) => ERR[r.error] || `うまくいきませんでした（${r.error || r.status}）`;

  let S = null, STU = null, V = { kind: "sites" }, dirty = false, lastF = null, bulk = false, busy = false;
  const picked = new Set(), sideOpen = { programs: true }, opened = new Set();
  let howOpen = true, stuF = { cur: "", stop: false, q: "", open: null };

  // ---------- 表 → 画面の形 ----------
  function build(t) {
    const lessons = new Map();
    for (const c of t.contents) {
      lessons.set(c.id, {
        id: c.id, title: c.title || "", summary: c.summary || "", status: c.status || "draft", active: c.active !== false,
        at: c.publish_at || "", days: c.drip_days ?? 7, minutes: c.minutes || 0, video: c.video_url || "",
        files: Array.isArray(c.files) ? c.files : [], qa: c.can_ask !== false, toc: null,
      });
    }
    const coursesOf = new Map();
    for (const c of t.courses) (coursesOf.get(c.program_id) || coursesOf.set(c.program_id, []).get(c.program_id)).push(c);
    const linksOf = new Map();
    for (const l of t.links) (linksOf.get(l.course_id) || linksOf.set(l.course_id, []).get(l.course_id)).push(l);
    const sites = t.sites.map((s, si) => {
      const programs = t.programs.filter((p) => p.site_id === s.id).map((p, i) => ({
        id: p.id, title: p.title, desc: p.description || "", status: p.active ? "published" : "draft", color: PALETTE[i % PALETTE.length],
        chapters: (coursesOf.get(p.id) || []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((c) => ({
          id: c.id, title: c.title, status: c.active ? "published" : "draft", open: opened.has(c.id),
          lessons: (linksOf.get(c.id) || []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((l) => lessons.get(l.content_id)).filter(Boolean),
        })),
      }));
      const curricula = t.curricula.filter((k) => k.site_id === s.id).map((k) => ({
        id: k.id, title: k.title, desc: k.description || "", status: k.active ? "published" : "draft",
        rights: t.rights.filter((r) => r.curriculum_id === k.id).map((r) => r.entitlement_key),
        programs: t.cprog.filter((x) => x.curriculum_id === k.id).sort((a, b) => a.sort - b.sort).map((x) => x.program_id),
      }));
      return { id: s.id, name: s.name, desc: s.description || "", status: s.active ? "published" : "draft", landing: s.landing || "mypage", login: s.login || {}, color: PALETTE[(si * 3) % PALETTE.length], programs, curricula, lessons };
    });
    return { sites };
  }
  async function reload() {
    const t = await call("tree");
    if (!t.ok) { $("#main").innerHTML = `<p class="err">${esc(errText(t))}</p>`; return false; }
    S = build(t);
    return true;
  }
  // 書く操作の共通の形：送る → 読み直す → 描き直す。失敗は描き直さずに知らせる
  async function act(path, body, okText, after) {
    if (busy) return null;
    busy = true; say("保存しています");
    try {
      const r = await call(path, "PUT", body);
      if (!r.ok) { toast(errText(r)); return r; }
      await reload();
      if (okText) toast(okText);
      if (after) after(r); else render();
      return r;
    } finally { busy = false; }
  }

  const site = () => S.sites.find((x) => x.id === V.sid);
  const course = () => site().programs.find((x) => x.id === V.cid);
  const curOf = (pid) => site().curricula.filter((k) => k.programs.includes(pid));
  const allCh = () => site().programs.flatMap((p) => p.chapters.map((ch) => ({ p, ch })));
  const findL = (id) => (id === "new" ? V.draft : site().lessons.get(id));
  const memOf = (l) => allCh().filter(({ ch }) => ch.lessons.includes(l));
  const allLessons = () => { const seen = new Set(), out = []; allCh().forEach(({ ch }) => ch.lessons.forEach((l) => { if (!seen.has(l)) { seen.add(l); out.push(l); } })); site().lessons.forEach((l) => { if (!seen.has(l)) { seen.add(l); out.push(l); } }); return out; };
  const nL = (ch) => ch.lessons.length;
  const rname = (k) => KEY_LABEL[k] || k;
  const live = (k) => k.status === "published";
  const stChip = (s) => { const cls = s === "published" ? "pub" : s === "draft" ? "draft" : "sch"; const mark = s === "published" ? "●" : s === "draft" ? "○" : "⏱"; return `<span class="st ${cls}">${mark} ${STL[s]}</span>`; };
  const dotCls = (s) => (s === "published" ? "pub" : s === "draft" ? "draft" : "sch");
  const localDT = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmtDT = (iso) => localDT(iso).replace("T", " ");
  const daysAgo = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null);

  function go(v) {
    if (dirty) { confirmLeave(() => { dirty = false; go(v); }); return; }
    V = v; bulk = false; picked.clear(); render(); $("#main").focus({ preventScroll: true }); host.scrollIntoView({ block: "start" });
  }
  function confirmLeave(fn) {
    modal(`<h3>保存していない書きかけがあります</h3><p>このまま移ると、書きかけは消えます。</p><div class="macts"><button class="btn" data-m="stay">戻って保存する</button><button class="btn pri" data-m="go">保存せずに移る</button></div>`,
      { stay: () => closeM(), go: async () => { closeM(true); if (MP) { mpDraft = MP.html; MPC = MP.config ? cfgCopy(MP.config) : null; } await reload(); fn(); } }); // 書きかけで画面の中の値が変わっているので、表から読み直してから移る
  }
  function crumbs() {
    const p = [["会員サイト", { kind: "sites" }]];
    if (V.sid) p.push([site().name, { kind: "curricula", sid: V.sid }]);
    if (V.kid) { p.push(["カリキュラム", { kind: "curricula", sid: V.sid }]); p.push([site().curricula.find((k) => k.id === V.kid).title, null]); }
    if (V.cid) { p.push(["プログラム", { kind: "programs", sid: V.sid }]); p.push([course().title, { kind: "course", sid: V.sid, cid: V.cid }]); }
    if (V.lid && V.cid && V.chid) { const ch = course().chapters.find((x) => x.id === V.chid); if (ch) p.push([ch.title, { kind: "course", sid: V.sid, cid: V.cid, focus: ch.id }]); }
    if (V.lid && !V.cid) p.push(["コンテンツ", { kind: "contents", sid: V.sid }]);
    if (V.lid) p.push([(findL(V.lid) || {}).title || "新しいコンテンツ", null]);
    const tail = { contents: "コンテンツ", students: "受講生", curricula: "カリキュラム", programs: "プログラム", mypage: "マイページ", news: "お知らせ", siteset: "サイトの設定" }[V.kind];
    if (tail && !V.lid && !V.kid) p.push([tail, null]);
    return `<nav class="crumbs" aria-label="いまの場所">${p.map((x, i) => i < p.length - 1 && x[1] ? `<button data-go='${esc(JSON.stringify(x[1]))}'>${esc(x[0])}</button><span aria-hidden="true">›</span>` : `<span>${esc(x[0])}</span>${i < p.length - 1 ? '<span aria-hidden="true">›</span>' : ""}`).join("")}</nav>`;
  }
  const goAttr = (v) => `data-go='${esc(JSON.stringify(v))}'`;
  function renderSide() {
    const sd = $("#side"); const cur = V.sid ? site() : null;
    const k = V.kind === "course" ? "programs" : V.kind === "lesson" ? (V.cid ? "programs" : "contents") : V.kind === "curriculum" ? "curricula" : V.kind;
    const item = (kk, n) => `<button class="sub" ${goAttr({ kind: kk, sid: cur.id })} ${k === kk ? 'aria-current="page"' : ""}>${n}</button>`;
    const tree = cur && sideOpen.programs ? `<div class="tree-sub" role="group" aria-label="プログラムとコース">${cur.programs.map((p) => `<div class="tn"><button class="tgl" data-sopen="${p.id}" aria-expanded="${!!sideOpen[p.id]}" aria-label="『${esc(p.title)}』のコースを${sideOpen[p.id] ? "たたむ" : "見る"}">${sideOpen[p.id] ? "▾" : "▸"}</button><button class="tl" ${goAttr({ kind: "course", sid: cur.id, cid: p.id })} ${V.cid === p.id && !V.chid && V.kind === "course" ? 'aria-current="page"' : ""}>${esc(p.title)}</button></div>
      ${sideOpen[p.id] ? p.chapters.map((ch) => `<button class="tl tl2" ${goAttr({ kind: "course", sid: cur.id, cid: p.id, focus: ch.id })} ${V.chid === ch.id ? 'aria-current="page"' : ""}>${esc(ch.title)} <span class="cnt">${nL(ch)}</span></button>`).join("") : ""}`).join("")}</div>` : "";
    sd.innerHTML = `<button ${goAttr({ kind: "sites" })} ${k === "sites" ? 'aria-current="page"' : ""}>サイトの一覧</button>
    ${cur ? `<div class="site-now">${esc(cur.name)}</div>${item("curricula", "カリキュラム")}
      <div class="tn"><button class="sub" style="flex:1" ${goAttr({ kind: "programs", sid: cur.id })} ${k === "programs" && V.kind === "programs" ? 'aria-current="page"' : ""}>プログラム</button><button class="tgl" data-sopen="programs" aria-expanded="${sideOpen.programs}" aria-label="プログラムの一覧を${sideOpen.programs ? "たたむ" : "開く"}">${sideOpen.programs ? "▾" : "▸"}</button></div>${tree}
      ${item("contents", "コンテンツ")}${item("students", "受講生")}${item("mypage", "マイページ")}${item("news", "お知らせ")}${item("siteset", "サイトの設定")}` : ""}`;
    $$("[data-sopen]").forEach((b) => (b.onclick = () => { const key = b.dataset.sopen; sideOpen[key] = !sideOpen[key]; renderSide(); $$("#side [data-go]").forEach((x) => (x.onclick = () => go(JSON.parse(x.dataset.go)))); $(`[data-sopen="${key}"]`).focus(); }));
  }
  function render() {
    if (!S) return;
    if (V.sid && !site()) V = { kind: "sites" };
    renderSide();
    const m = $("#main");
    ({ sites: renderSites, curricula: renderCurricula, curriculum: renderCurriculum, programs: renderPrograms, contents: renderContents, course: renderCourse, lesson: renderLesson, mypage: renderMypage, news: renderSoon, students: renderStudents, siteset: renderSiteSet })[V.kind](m);
    $$(".st-t").forEach((t) => { const hs = [...t.querySelectorAll("thead th")].map((x) => x.textContent); t.querySelectorAll("tbody tr").forEach((r) => [...r.children].forEach((td, i) => { if (!td.hasAttribute("colspan")) td.dataset.l = i === 0 ? "" : hs[i] || ""; })); });
    $$("[data-go]").forEach((b) => (b.onclick = () => go(JSON.parse(b.dataset.go))));
    try { const sd = $("#side"), cb = sd.querySelector("[aria-current]"); if (cb && sd.scrollWidth > sd.clientWidth) sd.scrollLeft = cb.offsetLeft - sd.clientWidth / 2 + cb.clientWidth / 2; } catch { /* 横に並ばない幅では何もしない */ }
  }

  // ---------- サイトの一覧（入口） ----------
  function renderSites(m) {
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>会員サイト</h1></div>
    <p class="lead">生徒がログインして教材を見る場所です。サイトを選んで、中のカリキュラム・プログラムと受講生を管理します。</p>
    <section class="scard" aria-labelledby="how-h" style="margin-bottom:16px"><div class="hrow"><h2 id="how-h" style="font-size:15px">会員サイトのしくみ</h2><span class="grow"></span><button class="btn sm ghost" id="howt" aria-expanded="${howOpen}">${howOpen ? "たたむ ▲" : "中を見る ▼"}</button></div>
    ${howOpen ? `<div class="how" style="grid-template-columns:repeat(5,minmax(0,1fr))"><div><b>① サイト</b><span>生徒が入る場所。例：しあらぼ</span></div><div><b>② カリキュラム</b><span>権利で開ける教材の一式。どの権利の人に何を見せるかを決める</span></div><div><b>③ プログラム</b><span>カリキュラムに並ぶ講座</span></div><div><b>④ コース</b><span>プログラムの中の区切り。例：2026年</span></div><div><b>⑤ コンテンツ</b><span>生徒が見る 1 回分。動画・資料</span></div></div>
    <p class="hint" style="margin:8px 0 0">名前は学ぶくんと同じです。新しいのは一番上の「サイト」だけ。サイトを増やすのは、ほかの事業者を迎えるときです</p>` : ""}</section>
    <div class="grid">${S.sites.map((s) => `<div class="ccard"><button class="thumb" ${goAttr({ kind: "curricula", sid: s.id })} style="background:linear-gradient(135deg,${s.color},${s.color}cc);border:0;cursor:pointer;text-align:left">${stChip(s.status)}<span>${esc(s.name)}</span></button>
      <div class="cbody"><div class="hint">${esc(s.desc)}</div><div class="cmeta"><span>カリキュラム ${s.curricula.length}</span><span>プログラム ${s.programs.length}</span><span>コンテンツ ${s.lessons.size}</span>${STU ? `<span>受講生 ${STU.length}</span>` : ""}</div></div>
      <div class="cord"><button class="btn sm pri" ${goAttr({ kind: "curricula", sid: s.id })}>開く</button></div></div>`).join("")}</div>`;
    $("#howt").onclick = () => { howOpen = !howOpen; render(); $("#howt").focus(); };
  }

  // ---------- カリキュラム ----------
  const nStu = (k) => (STU ? STU.filter((st) => st.rights.some((r) => k.rights.includes(r))).length : null);
  function renderCurricula(m) {
    const s = site(); const lone = s.programs.filter((p) => !curOf(p.id).length);
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>カリキュラム</h1><span class="grow"></span><button class="btn pri" id="addk">＋ カリキュラムを作る</button></div>
    <p class="lead">権利を持つ人に、カリキュラムに入れたプログラムが見えます。</p>
    <div style="overflow-x:auto"><table class="st-t"><thead><tr><th>カリキュラム</th><th>公開</th><th>プログラム</th><th>受講生</th><th>開ける権利</th><th></th></tr></thead><tbody>
    ${s.curricula.map((k) => `<tr><td><b>${esc(k.title)}</b></td><td>${stChip(k.status)}</td><td>${k.programs.length}</td><td>${nStu(k) ?? "—"}</td>
      <td>${k.rights.length ? k.rights.map((r) => `<span class="key">${esc(rname(r))}</span>`).join(" ") : '<span class="err">なし＝誰にも出ない</span>'}</td>
      <td><button class="btn sm" ${goAttr({ kind: "curriculum", sid: s.id, kid: k.id })}>編集</button></td></tr>`).join("")}</tbody></table></div>
    ${lone.length ? `<p class="note-box" style="margin-top:14px">どのカリキュラムにも入っていないプログラムが ${lone.length} 本あります（${lone.map((p) => esc(p.title)).join("・")}）。誰にも見えていません。</p>` : ""}`;
    $("#addk").onclick = () => { lastF = $("#addk"); ask("新しいカリキュラムの名前", (n) => act("curriculum", { site_id: s.id, title: n, active: false }, `カリキュラム「${n}」を作りました（いまは下書き）`, (r) => { dirty = false; V = { kind: "curriculum", sid: s.id, kid: r.id }; render(); })); };
  }
  let RIGHT_KEYS = null;
  async function rightKeys() {
    if (RIGHT_KEYS) return RIGHT_KEYS;
    const r = await api("/api/admin/entitlement-keys", { token: getToken() });
    RIGHT_KEYS = r.ok ? r.keys : Object.keys(KEY_LABEL);
    return RIGHT_KEYS;
  }
  function renderCurriculum(m) {
    const s = site(), k = s.curricula.find((x) => x.id === V.kid); if (!k) { V = { kind: "curricula", sid: s.id }; render(); return; }
    const ps = k.programs.map((id) => s.programs.find((p) => p.id === id)).filter(Boolean); const tab = V.tab || "prog";
    const n = nStu(k);
    const keys = [...new Set([...(RIGHT_KEYS || Object.keys(KEY_LABEL)), ...k.rights])];
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>${esc(k.title)}</h1>${stChip(k.status)}</div><p class="lead">カリキュラム${n == null ? "" : `・受講生 ${n} 人`}</p>
    <div class="tabs2" role="tablist">${[["prog", `プログラム（${ps.length}）`], ["rights", `開ける権利（${k.rights.length}）`], ["set", "設定"]].map(([t, nm]) => `<button role="tab" aria-selected="${tab === t}" data-tab="${t}">${nm}</button>`).join("")}</div>
    <div style="max-width:820px">${tab === "prog" ? `<div class="hrow" style="margin-bottom:10px"><span class="hint">この順で生徒の教材に並びます</span><span class="grow"></span><button class="btn" id="addp">＋ プログラムを入れる</button></div>
      ${ps.length ? `<div class="chcard">${ps.map((p, i) => `<div class="lsrow" style="grid-template-columns:auto minmax(0,1fr) auto auto"><span class="num">${i + 1}</span><div class="tt">${esc(p.title)}<small>${STL[p.status]}・コース ${p.chapters.length}</small></div>
        <span class="mv"><button data-mvp="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="『${esc(p.title)}』を上へ">▲</button><button data-mvp="${i}" data-d="1" ${i === ps.length - 1 ? "disabled" : ""} aria-label="『${esc(p.title)}』を下へ">▼</button></span>
        <span class="act"><button class="btn sm ghost" data-rmp="${p.id}" aria-label="『${esc(p.title)}』をこのカリキュラムから外す">外す</button></span></div>`).join("")}</div>` : '<div class="empty">まだプログラムが入っていません</div>'}`
      : tab === "rights" ? `<div class="sec"><p class="hint" style="margin:0 0 8px">チェックした権利を、今持っている人に、このカリキュラムが開きます。権利を人に付ける・外すのは顧客管理です</p><div class="rights">${keys.map((r) => `<label><input type="checkbox" name="kr" value="${esc(r)}" ${k.rights.includes(r) ? "checked" : ""}><span>${esc(rname(r))}<small>${esc(r)}</small></span></label>`).join("")}</div></div>
      <div class="stick"><button class="btn pri" id="rsave">保存する</button></div>`
      : `<div class="sec"><div class="f"><label for="kn">カリキュラムの名前</label><input type="text" id="kn" value="${esc(k.title)}"><span class="err" id="kne"></span></div>
      <div class="f"><label for="kd">メモ <span class="hint">Naoki だけが見る</span></label><input type="text" id="kd" value="${esc(k.desc)}"></div>
      <div class="f"><span class="lbl">公開</span><div class="radio"><label><input type="radio" name="ks" value="published" ${k.status === "published" ? "checked" : ""}>公開する</label><label><input type="radio" name="ks" value="draft" ${k.status === "draft" ? "checked" : ""}>下書き（誰にも出ない）</label></div></div></div>
      <div class="stick"><button class="btn pri" id="ksave">保存する</button></div>`}</div>`;
    $$("[data-tab]").forEach((b) => (b.onclick = () => { const g = () => { V.tab = b.dataset.tab; render(); }; if (dirty) { confirmLeave(() => { dirty = false; g(); }); return; } g(); }));
    $$("#main .sec input").forEach((x) => { x.addEventListener("input", () => (dirty = true)); x.addEventListener("change", () => (dirty = true)); });
    const base = { id: k.id, title: k.title, description: k.desc, active: live(k) };
    if (tab === "rights") {
      if (!RIGHT_KEYS) rightKeys().then(() => { if (V.kind === "curriculum" && (V.tab || "prog") === "rights" && !dirty) render(); });
      $("#rsave").onclick = () => { const rights = $$("[name=kr]:checked").map((x) => x.value); dirty = false; act("curriculum", { ...base, rights }, null, () => { const k2 = site().curricula.find((x) => x.id === k.id); const n2 = nStu(k2); toast(`開ける権利を保存しました${n2 == null ? "" : `（開ける人 ${n2} 人）`}`); render(); $("#rsave").focus(); }); };
    }
    if (tab === "set") $("#ksave").onclick = () => { const t = $("#kn").value.trim(); if (!t) { $("#kne").textContent = "名前が空です"; $("#kn").focus(); return; } dirty = false; act("curriculum", { id: k.id, title: t, description: $("#kd").value, active: $("[name=ks]:checked").value === "published" }, `「${t}」を保存しました`, () => { render(); $("#ksave").focus(); }); };
    if (tab !== "prog") return;
    const savePs = (list, text, after) => act("curriculum", { ...base, programs: list }, text, after);
    $$("[data-mvp]").forEach((b) => (b.onclick = () => { const i = +b.dataset.mvp, j = i + +b.dataset.d; const list = [...k.programs]; [list[i], list[j]] = [list[j], list[i]]; savePs(list, null, () => { render(); say(`${j + 1} 番目へ動かしました`); ($(`[data-mvp="${j}"][data-d="${b.dataset.d}"]:not([disabled])`) || $(`[data-mvp="${j}"]:not([disabled])`))?.focus(); }); }));
    $$("[data-rmp]").forEach((b) => (b.onclick = () => { const before = [...k.programs]; const p = s.programs.find((x) => x.id === b.dataset.rmp); savePs(k.programs.filter((x) => x !== b.dataset.rmp), null, () => { render(); undoToast(`「${p.title}」をこのカリキュラムから外しました（プログラムは消えていません）`, () => savePs(before, "元に戻しました")); }); }));
    $("#addp").onclick = () => {
      lastF = $("#addp"); const pool = s.programs.filter((p) => !k.programs.includes(p.id));
      modal(`<h3>プログラムを入れる</h3>${pool.length ? `<div class="rights" style="grid-template-columns:1fr">${pool.map((p) => `<label><input type="checkbox" value="${p.id}"><span>${esc(p.title)}<small>${curOf(p.id).length ? "ほかに入っている：" + curOf(p.id).map((x) => esc(x.title)).join("・") : "どのカリキュラムにも入っていない"}</small></span></label>`).join("")}</div>` : '<p class="hint">入れられるプログラムがありません</p>'}
      <p class="err" id="ape"></p><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">入れる</button></div>`,
      { x: () => closeM(), ok: () => { const ids = $$(".modal input:checked").map((x) => x.value); if (!ids.length) { $("#ape").textContent = "1 つも選ばれていません"; return; } closeM(true); savePs([...k.programs, ...ids], `${ids.length} 本を入れました`, () => { render(); $("#addp").focus(); }); } });
    };
  }

  // ---------- プログラムの一覧 ----------
  function renderPrograms(m) {
    const s = site(); const f = V.f || "all"; const cnt = (c) => new Set(c.chapters.flatMap((ch) => ch.lessons)).size;
    const F = [["all", "すべて", () => true], ["pub", "公開", (c) => c.status === "published"], ["draft", "下書き", (c) => c.status === "draft"], ["lone", "カリキュラムに未所属", (c) => !curOf(c.id).length]];
    const rows = s.programs.filter(F.find((x) => x[0] === f)[2]);
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>プログラム</h1><span class="grow"></span><button class="btn pri" id="addc">＋ プログラムを作る</button></div>
    <p class="lead">このサイトの講座の全部です。生徒に見えるのは、公開中のカリキュラムに入っているものだけです。</p>
    <div class="tabs2" role="tablist">${F.map(([k, n, fn]) => `<button role="tab" aria-selected="${f === k}" data-f="${k}">${n}（${s.programs.filter(fn).length}）</button>`).join("")}</div>
    ${rows.length ? `<div style="overflow-x:auto"><table class="st-t"><thead><tr><th>プログラム</th><th>公開</th><th>コース</th><th>コンテンツ</th><th>カリキュラム</th><th></th></tr></thead><tbody>
    ${rows.map((c) => { const ks = curOf(c.id); return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c.color};margin-right:8px" aria-hidden="true"></span><b>${esc(c.title)}</b></td><td>${stChip(c.status)}</td><td>${c.chapters.length}</td><td>${cnt(c)}</td>
      <td>${ks.length ? ks.map((k) => esc(k.title)).join("・") : '<span class="err">未所属</span>'}</td><td><button class="btn sm" data-open="${c.id}">編集</button></td></tr>`; }).join("")}</tbody></table></div>`
      : '<div class="empty">当たるプログラムがありません</div>'}`;
    $$("[data-f]").forEach((b) => (b.onclick = () => { V.f = b.dataset.f; render(); $(`[data-f="${V.f}"]`).focus(); }));
    $$("[data-open]").forEach((b) => (b.onclick = () => go({ kind: "course", sid: s.id, cid: b.dataset.open })));
    $("#addc").onclick = () => {
      lastF = $("#addc");
      modal(`<h3>プログラムを作る</h3><div class="f"><label for="nc">プログラムの名前</label><input type="text" id="nc"><span class="err" id="nce"></span></div>
      <div class="f"><span class="lbl">はじめの形</span><div class="radio">
      <label><input type="radio" name="tpl" value="blank" checked>空から作る</label>
      <label><input type="radio" name="tpl" value="std">ふつうの講座<span class="hint sub">コース 3 つ（はじめに・本編・まとめ）を先に作る</span></label>
      <label><input type="radio" name="tpl" value="seminar">セミナーのアーカイブ<span class="hint sub">今年のコースを先に作る</span></label></div></div>
      <div class="f"><label for="nck">入れるカリキュラム</label><select id="nck"><option value="">あとで決める</option>${s.curricula.map((k) => `<option value="${k.id}">${esc(k.title)}</option>`).join("")}</select></div>
      <div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">作る</button></div>`,
      { x: () => closeM(), ok: () => {
        const n = $("#nc").value.trim(); if (!n) { $("#nce").textContent = "名前が空です。名前を入れてください"; $("#nc").focus(); return; }
        const t = $("[name=tpl]:checked").value; const courses = t === "std" ? ["はじめに", "本編", "まとめ"] : t === "seminar" ? [`${new Date().getFullYear()}年`] : [];
        const kk = $("#nck").value; closeM(true);
        act("program", { site_id: s.id, title: n, active: false, courses, curriculum_id: kk || undefined }, `「${n}」を作りました（いまは下書き。生徒には出ていません）`, (r) => { V = { kind: "course", sid: s.id, cid: r.id }; render(); });
      } });
    };
  }

  // ---------- コンテンツの一覧 ----------
  function renderContents(m) {
    const s = site(); const q = V.q || "", pf = V.pf || "";
    const ls = allLessons().filter((l) => (!q || l.title.includes(q)) && (pf === "none" ? !memOf(l).length : !pf || memOf(l).some((x) => x.ch.id === pf || x.p.id === pf)));
    const loose = allLessons().filter((l) => !memOf(l).length).length;
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>コンテンツ</h1><span class="grow"></span><button class="btn pri" id="addl2">＋ コンテンツを作る</button></div>
    <p class="lead">このサイトのコンテンツの全部です。作るときに、所属するコースを選びます。同じコンテンツを複数のコースに並べられます（中身は 1 つ）。</p>
    <div class="tools"><input class="search" type="search" id="cq" placeholder="題名で探す" value="${esc(q)}" aria-label="題名で探す">
      <select id="cpf" aria-label="プログラムやコースで絞る" style="width:auto"><option value="">すべてのプログラム</option>${loose ? `<option value="none" ${pf === "none" ? "selected" : ""}>どのコースにも無いもの（${loose}）</option>` : ""}${s.programs.map((p) => `<optgroup label="${esc(p.title)}"><option value="${p.id}" ${pf === p.id ? "selected" : ""}>${esc(p.title)}（全部）</option>${p.chapters.map((ch) => `<option value="${ch.id}" ${pf === ch.id ? "selected" : ""}>› ${esc(ch.title)}</option>`).join("")}</optgroup>`).join("")}</select><span class="hint">${ls.length} 本</span></div>
    ${ls.length ? `<div style="overflow-x:auto"><table class="st-t"><thead><tr><th>コンテンツ</th><th>所属するコース</th><th>公開</th><th></th></tr></thead><tbody>
    ${ls.slice(0, 300).map((l) => `<tr><td><b>${esc(l.title || "（題名なし）")}</b></td><td>${memOf(l).map((x) => `${esc(x.p.title)} › ${esc(x.ch.title)}`).join("<br>") || '<span class="err">どのコースにも無い</span>'}</td><td>${stChip(l.status)}</td><td><button class="btn sm" data-ed="${l.id}">編集</button></td></tr>`).join("")}</tbody></table></div>${ls.length > 300 ? `<p class="hint">はじめの 300 本を出しています。題名で探すか、コースで絞ってください</p>` : ""}` : '<div class="empty">当たるコンテンツがありません</div>'}`;
    $("#cq").oninput = (e) => { V.q = e.target.value; const p = e.target.selectionStart; render(); $("#cq").focus(); $("#cq").setSelectionRange(p, p); };
    $("#cpf").onchange = (e) => { V.pf = e.target.value; render(); $("#cpf").focus(); };
    $$("[data-ed]").forEach((b) => (b.onclick = () => go({ kind: "lesson", sid: s.id, lid: b.dataset.ed })));
    $("#addl2").onclick = () => newLesson({ kind: "lesson", sid: s.id, lid: "new", isNew: true }, pf && allCh().some((x) => x.ch.id === pf) ? [pf] : []);
  }
  function newLesson(v, mem) {
    v.draft = { id: "new", title: "", summary: "", status: "draft", at: "", days: 7, minutes: 0, video: "", files: [], toc: [], qa: true };
    v.mem = mem; go(v);
  }

  // ---------- プログラム：コースとコンテンツ／プログラムの設定 ----------
  function renderCourse(m) {
    const c = course(); if (!c) { V = { kind: "programs", sid: V.sid }; render(); return; }
    const tab = V.tab || "content";
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>${esc(c.title)}</h1>${stChip(c.status)}<span class="grow"></span><a class="btn" href="/app" target="_blank" rel="noopener">生徒の画面で見る ↗</a></div>
    <div class="tabs2" role="tablist">${[["content", `コースとコンテンツ（${new Set(c.chapters.flatMap((ch) => ch.lessons)).size}）`], ["set", "プログラムの設定"]].map(([k, n]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${n}</button>`).join("")}</div><div id="tb"></div>`;
    $$("[data-tab]").forEach((b) => (b.onclick = () => { const g = () => { V.tab = b.dataset.tab; render(); }; if (dirty) { confirmLeave(() => { dirty = false; g(); }); return; } g(); }));
    tab === "content" ? renderContent(c) : renderProgramSet(c);
  }
  const setCourse = (ch, ids, text, after) => act("course-contents", { course_id: ch.id, content_ids: ids }, text, after);
  function renderContent(c) {
    const tb = $("#tb");
    if (V.focus) { opened.add(V.focus); const f = c.chapters.find((x) => x.id === V.focus); if (f) f.open = true; }
    tb.innerHTML = `<div class="hrow" style="margin-bottom:12px"><button class="btn pri" id="addch">＋ コースを足す</button><button class="btn" id="yt">動画の住所からまとめて作る</button><span class="grow"></span>
      <button class="btn" id="bulk" aria-pressed="${bulk}">${bulk ? "選ぶのをやめる" : "選んでまとめて操作"}</button><button class="btn ghost" id="openall">すべて開く</button></div>
    ${bulk ? `<div class="bulkbar" style="margin:0 0 12px"><span class="hint" id="pcount">${picked.size} 本を選択中</span><button class="btn sm" data-bk="published">公開にする</button><button class="btn sm" data-bk="draft">下書きに戻す</button><button class="btn sm" data-bk="move">別のコースへ移す</button></div>` : ""}
    <div class="chlist">${c.chapters.length ? c.chapters.map((ch, ci) => `<section class="chcard" aria-label="コース ${esc(ch.title)}" id="ch-${ch.id}">
      <div class="chtop"><button class="tg" data-tg="${ch.id}" aria-expanded="${ch.open}" aria-label="『${esc(ch.title)}』の中を${ch.open ? "たたむ" : "見る"}">${ch.open ? "▾" : "▸"}</button>
        <h3>${esc(ch.title)}</h3>${stChip(ch.status)}<span class="cnt">コンテンツ ${nL(ch)}</span>
        <span class="mv"><button data-mvch="${ci}" data-d="-1" ${ci === 0 ? "disabled" : ""} aria-label="コース『${esc(ch.title)}』を上へ">▲</button><button data-mvch="${ci}" data-d="1" ${ci === c.chapters.length - 1 ? "disabled" : ""} aria-label="コース『${esc(ch.title)}』を下へ">▼</button></span>
        <button class="btn sm" data-chset="${ch.id}" aria-label="コース『${esc(ch.title)}』を編集">編集</button><button class="btn sm" data-addl="${ch.id}">＋ コンテンツ</button></div>
      ${ch.open ? (ch.lessons.length ? ch.lessons.map((l, li) => `<div class="lsrow">${bulk ? `<input type="checkbox" data-pick="${l.id}" ${picked.has(l.id) ? "checked" : ""} aria-label="『${esc(l.title)}』を選ぶ" style="width:20px;height:20px;accent-color:var(--ink)">` : `<span class="num">${li + 1}</span>`}
        <span class="dot ${dotCls(l.status)}" title="${STL[l.status]}"></span>
        <div class="tt">${esc(l.title || "（題名なし）")}<small>${[l.status === "scheduled" ? `${fmtDT(l.at)} に公開` : l.status === "drip" ? `入会 ${l.days} 日後` : STL[l.status], l.video ? "動画あり" : "動画なし", l.minutes ? `約 ${l.minutes} 分` : "", l.files.length ? `資料 ${l.files.length}` : "", memOf(l).length > 1 ? `ほかのコースにも並ぶ（${memOf(l).length - 1}）` : ""].filter(Boolean).join("・")}</small></div>
        <span class="mv"><button data-mvl="${ch.id}|${li}" data-d="-1" ${li === 0 ? "disabled" : ""} aria-label="『${esc(l.title)}』を上へ">▲</button><button data-mvl="${ch.id}|${li}" data-d="1" ${li === ch.lessons.length - 1 ? "disabled" : ""} aria-label="『${esc(l.title)}』を下へ">▼</button></span>
        <span class="act"><button class="btn sm" data-edit="${ch.id}|${l.id}">編集</button></span></div>`).join("")
        : `<div class="lsrow" style="grid-template-columns:1fr"><span class="hint">まだコンテンツがありません。「＋ コンテンツ」から作ります</span></div>`) : ""}</section>`).join("") : '<div class="empty">まだコースがありません。「＋ コースを足す」から作ります</div>'}</div>
    <p class="hint">● 公開　○ 下書き　<span style="color:var(--sch)">●</span> 予約・入会から日数で開く</p>`;
    const toggle = (ch, on) => { ch.open = on; on ? opened.add(ch.id) : opened.delete(ch.id); };
    $$("[data-tg]").forEach((b) => (b.onclick = () => { const ch = c.chapters.find((x) => x.id === b.dataset.tg); toggle(ch, !ch.open); renderContent(c); $(`[data-tg="${ch.id}"]`).focus(); }));
    $("#openall").onclick = () => { const all = c.chapters.every((ch) => ch.open); c.chapters.forEach((ch) => toggle(ch, !all)); renderContent(c); $("#openall").focus(); };
    $("#openall").textContent = c.chapters.length && c.chapters.every((ch) => ch.open) ? "すべてたたむ" : "すべて開く";
    $$("[data-mvch]").forEach((b) => (b.onclick = () => { const i = +b.dataset.mvch, j = i + +b.dataset.d; const ids = c.chapters.map((x) => x.id); [ids[i], ids[j]] = [ids[j], ids[i]];
      act("course-order", { program_id: c.id, course_ids: ids }, null, () => { render(); say(`${j + 1} 番目へ`); ($(`[data-mvch="${j}"][data-d="${b.dataset.d}"]:not([disabled])`) || $(`[data-mvch="${j}"]:not([disabled])`))?.focus(); }); }));
    $$("[data-mvl]").forEach((b) => (b.onclick = () => { const [chid, i0] = b.dataset.mvl.split("|"); const ch = c.chapters.find((x) => x.id === chid); const i = +i0, j = i + +b.dataset.d; const ids = ch.lessons.map((l) => l.id); [ids[i], ids[j]] = [ids[j], ids[i]];
      setCourse(ch, ids, null, () => { render(); say(`${j + 1} 番目へ`); ($(`[data-mvl="${chid}|${j}"][data-d="${b.dataset.d}"]:not([disabled])`) || $(`[data-mvl="${chid}|${j}"]:not([disabled])`))?.focus(); }); }));
    $$("[data-edit]").forEach((b) => (b.onclick = () => { const [chid, lid] = b.dataset.edit.split("|"); go({ kind: "lesson", sid: V.sid, cid: c.id, chid, lid }); }));
    $$("[data-addl]").forEach((b) => (b.onclick = () => { const ch = c.chapters.find((x) => x.id === b.dataset.addl); toggle(ch, true); newLesson({ kind: "lesson", sid: V.sid, cid: c.id, chid: ch.id, lid: "new", isNew: true }, [ch.id]); }));
    $$("[data-chset]").forEach((b) => (b.onclick = () => {
      lastF = b; const ch = c.chapters.find((x) => x.id === b.dataset.chset);
      modal(`<h3>コースを編集</h3><div class="f"><label for="cht">コースの名前</label><input type="text" id="cht" value="${esc(ch.title)}"><span class="err" id="chte"></span></div>
      <div class="f"><span class="lbl">公開</span><div class="radio"><label><input type="radio" name="cst" value="published" ${ch.status === "published" ? "checked" : ""}>公開する</label><label><input type="radio" name="cst" value="draft" ${ch.status === "draft" ? "checked" : ""}>下書き（中のコンテンツごと生徒に出ない）</label></div></div>
      <div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">保存する</button></div>`,
      { x: () => closeM(), ok: () => { const t = $("#cht").value.trim(); if (!t) { $("#chte").textContent = "コースの名前が空です"; $("#cht").focus(); return; }
        const active = root.querySelector("[name=cst]:checked").value === "published"; closeM(true);
        act("course", { id: ch.id, title: t, active }, `コース「${t}」を保存しました`, () => { render(); $(`[data-chset="${ch.id}"]`)?.focus(); }); } });
    }));
    $("#bulk").onclick = () => { bulk = !bulk; picked.clear(); if (bulk) c.chapters.forEach((ch) => { if (ch.lessons.length) toggle(ch, true); }); renderContent(c); $("#bulk").focus(); };
    $$("[data-pick]").forEach((x) => (x.onchange = () => { x.checked ? picked.add(x.dataset.pick) : picked.delete(x.dataset.pick); $("#pcount").textContent = `${picked.size} 本を選択中`; }));
    $$("[data-bk]").forEach((b) => (b.onclick = () => {
      if (!picked.size) { toast("まだ 1 本も選ばれていません。コンテンツの左のチェックで選んでください"); return; }
      const all = c.chapters.flatMap((ch) => ch.lessons.map((l) => [ch, l])).filter(([, l]) => picked.has(l.id));
      if (b.dataset.bk === "move") {
        lastF = b;
        modal(`<h3>${picked.size} 本を別のコースへ移す</h3><div class="f"><label for="toch">移す先のコース</label><select id="toch">${c.chapters.map((ch) => `<option value="${ch.id}">${esc(ch.title)}</option>`).join("")}</select></div><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">移す</button></div>`,
          { x: () => closeM(), ok: () => moveTo(c, all, $("#toch").value) });
        return;
      }
      const ids = [...new Set(all.map(([, l]) => l.id))]; const prev = new Map(all.map(([, l]) => [l.id, l.status])); const to = b.dataset.bk;
      act("content-status", { ids, status: to }, null, () => { picked.clear(); render();
        undoToast(`${ids.length} 本を${to === "published" ? "公開" : "下書き"}にしました`, async () => {
          for (const st of ["published", "draft"]) { const back = ids.filter((id) => prev.get(id) === st); if (back.length) await call("content-status", "PUT", { ids: back, status: st }); }
          const others = ids.filter((id) => !["published", "draft"].includes(prev.get(id)));
          await reload(); render(); toast(others.length ? `元に戻しました（予約と入会から日数の ${others.length} 本は、1 本ずつ設定し直してください）` : "元に戻しました");
        }); });
    }));
    $("#addch").onclick = () => { lastF = $("#addch"); ask("新しいコースの名前", (n) => act("course", { program_id: c.id, title: n, active: true }, `コース「${n}」を足しました`, (r) => { opened.add(r.id); render(); $(`[data-addl="${r.id}"]`)?.focus(); })); };
    $("#yt").onclick = () => {
      lastF = $("#yt"); if (!c.chapters.length) { toast("先にコースを 1 つ作ってください（「＋ コースを足す」）"); $("#addch").focus(); return; }
      modal(`<h3>動画の住所からまとめて作る</h3><p class="hint">YouTube の住所を 1 行に 1 本ずつ貼ると、1 本ずつコンテンツができます。題名は動画の題名が入ります。下書きで入るので、見直してから公開します。</p>
      <div class="f"><label for="ytto">入れるコース</label><select id="ytto">${c.chapters.map((ch) => `<option value="${ch.id}">${esc(ch.title)}</option>`).join("")}</select></div>
      <div class="f"><label for="yturls">住所（1 行に 1 本・30 本まで）</label><textarea id="yturls" style="min-height:120px" placeholder="https://www.youtube.com/watch?v=…&#10;https://youtu.be/…"></textarea><span class="err" id="yte"></span></div>
      <div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">コンテンツを作る</button></div>`,
      { x: () => closeM(), ok: async () => {
        const ls = $("#yturls").value.split(/\n/).map((s) => s.trim()).filter(Boolean); const bad = ls.filter((s) => !/youtu\.?be/.test(s));
        if (!ls.length) { $("#yte").textContent = "住所が 1 本もありません"; $("#yturls").focus(); return; }
        if (bad.length) { $("#yte").textContent = `YouTube の住所ではない行が ${bad.length} 行あります`; $("#yturls").focus(); return; }
        if (ls.length > 30) { $("#yte").textContent = "一度に作れるのは 30 本までです"; $("#yturls").focus(); return; }
        const chid = $("#ytto").value; const ch = c.chapters.find((x) => x.id === chid); closeM(true); toast("動画の題名を読んでいます…");
        act("content-from-videos", { course_id: chid, urls: ls }, null, (r) => { opened.add(chid); render(); toast(`${r.count} 本を「${ch.title}」に下書きで作りました`); });
      } });
    };
    if (V.focus) { const el = $(`#ch-${V.focus}`); if (el) { el.scrollIntoView(); el.querySelector(".tg").focus(); } V.focus = null; }
  }
  // 選んだものを 1 つのコースへ移す：元のコースから外し、移す先の末尾に足す。元に戻すときは、さわったコースの並びを前の形に戻す
  async function moveTo(c, all, toId) {
    const to = c.chapters.find((x) => x.id === toId); closeM(true);
    const touched = [...new Set([to, ...all.map(([ch]) => ch)])]; const before = touched.map((ch) => [ch.id, ch.lessons.map((l) => l.id)]);
    const moving = new Set(all.map(([, l]) => l.id));
    if (busy) return; busy = true;
    try {
      for (const ch of touched) {
        const ids = ch === to ? [...ch.lessons.map((l) => l.id), ...[...moving].filter((id) => !ch.lessons.some((l) => l.id === id))] : ch.lessons.map((l) => l.id).filter((id) => !moving.has(id));
        const r = await call("course-contents", "PUT", { course_id: ch.id, content_ids: ids });
        if (!r.ok) { toast(errText(r)); break; }
      }
      await reload(); opened.add(to.id); picked.clear(); render();
    } finally { busy = false; }
    undoToast(`${moving.size} 本を「${to.title}」へ移しました`, async () => { for (const [course_id, content_ids] of before) await call("course-contents", "PUT", { course_id, content_ids }); await reload(); render(); toast("元に戻しました"); });
  }
  function renderProgramSet(c) {
    $("#tb").innerHTML = `<div class="ed" style="max-width:820px">
    <div class="sec"><h3>基本</h3><div class="f"><label for="ct">プログラムの名前</label><input type="text" id="ct" value="${esc(c.title)}"><span class="err" id="cte"></span></div>
      <div class="f"><label for="cd">説明 <span class="hint">生徒のプログラムの上に出る（出すのは手順 3 のマイページから）</span></label><textarea id="cd" style="min-height:90px">${esc(c.desc)}</textarea></div></div>
    <div class="sec"><h3>公開</h3><div class="radio"><label><input type="radio" name="cs" value="published" ${c.status === "published" ? "checked" : ""}>公開する</label><label><input type="radio" name="cs" value="draft" ${c.status === "draft" ? "checked" : ""}>下書き（プログラムごと生徒に出ない）</label></div></div>
    <div class="sec"><h3>入っているカリキュラム</h3><p style="margin:0">${curOf(c.id).length ? curOf(c.id).map((k) => `<span class="key">${esc(k.title)}</span>`).join(" ") : '<span class="err">どのカリキュラムにも入っていない＝誰にも見えない</span>'}</p><p class="hint" style="margin:6px 0 0">誰に見せるかは、カリキュラムの画面で決めます（権利はカリキュラムに付ける）</p></div>
    <div class="stick"><button class="btn pri" id="csave">保存する</button><span class="hint">⌘／Ctrl＋Enter でも保存</span></div></div>`;
    const e = $("#tb"); e.querySelectorAll("input,textarea").forEach((x) => { x.addEventListener("input", () => (dirty = true)); x.addEventListener("change", () => (dirty = true)); });
    const save = () => { const t = $("#ct").value.trim(); if (!t) { $("#cte").textContent = "名前が空です"; $("#ct").focus(); return; } dirty = false;
      act("program", { id: c.id, title: t, description: $("#cd").value, active: e.querySelector("[name=cs]:checked").value === "published" }, `「${t}」の設定を保存しました`, () => { render(); $("#csave").focus(); }); };
    $("#csave").onclick = save; e.querySelectorAll("input,textarea").forEach((x) => x.addEventListener("keydown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); save(); } }));
  }

  // ---------- コンテンツ（1 画面まるごと） ----------
  function renderLesson(m) {
    const l = findL(V.lid); if (!l) { V = { kind: "contents", sid: V.sid }; render(); return; }
    if (l.toc === null) { m.innerHTML = `${crumbs()}<p class="hint">読み込んでいます…</p>`; loadDetail(l); return; }
    const ms0 = memOf(l); const ctx = (V.chid && ms0.find((x) => x.ch.id === V.chid)) || ms0[0]; const c = ctx ? ctx.p : null, ch = ctx ? ctx.ch : null; const pv = V.pv || "";
    if (!V.mem) V.mem = ms0.map((x) => x.ch.id);
    const i = ch ? ch.lessons.indexOf(l) : -1; const inCtx = ch && V.cid && ch.id === V.chid; const prev = inCtx ? ch.lessons[i - 1] : null, next = inCtx ? ch.lessons[i + 1] : null;
    const memHtml = `<div class="sec"><h3>所属するコース</h3><p class="hint" style="margin:-4px 0 8px">同じコンテンツを複数のコースに並べられます（中身は 1 つ）</p>
      <div id="mems" class="rows">${V.mem.map((id) => { const x = allCh().find((y) => y.ch.id === id); return x ? `<div style="display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:4px 4px 4px 10px"><span style="flex:1;font-size:13px">${esc(x.p.title)} › <b>${esc(x.ch.title)}</b></span><button class="x" style="width:40px" data-rmm="${id}" aria-label="${esc(x.ch.title)} から外す">×</button></div>` : ""; }).join("") || '<span class="err">まだどのコースにも入っていません</span>'}</div>
      <div style="display:flex;gap:6px;margin-top:8px"><select id="addm" aria-label="所属するコースを選ぶ"><option value="">コースを選ぶ</option>${site().programs.map((p) => `<optgroup label="${esc(p.title)}">${p.chapters.filter((c2) => !V.mem.includes(c2.id)).map((c2) => `<option value="${c2.id}">${esc(c2.title)}</option>`).join("")}</optgroup>`).join("")}</select><button class="btn sm" id="addmb">足す</button></div><span class="err" id="me"></span></div>`;
    m.innerHTML = `${crumbs()}<div class="hrow"><h1 style="font-size:22px">${esc(l.title || "新しいコンテンツ")}</h1>${stChip(l.status)}</div>
    <div class="pn"><button class="btn sm" data-back>← ${V.cid ? "コースとコンテンツ" : "コンテンツ"}の一覧へ戻る</button>${inCtx ? `<span class="hint">コース「${esc(ch.title)}」の ${i + 1} / ${ch.lessons.length} 本目</span>` : ""}<span class="grow"></span>
      ${prev ? `<button class="btn sm" data-sib="${prev.id}">← 前のコンテンツ</button>` : ""}${next ? `<button class="btn sm" data-sib="${next.id}">次のコンテンツ →</button>` : ""}</div>
    <div class="tabs2" role="tablist"><button role="tab" aria-selected="${!pv}" data-pv="">編集</button><button role="tab" aria-selected="${pv === "pc"}" data-pv="pc">生徒の見え方（パソコン）</button><button role="tab" aria-selected="${pv === "sp"}" data-pv="sp">生徒の見え方（スマホ）</button></div>
    ${pv ? (ch ? preview(c, ch, l, pv) : '<div class="empty">所属するコースを決めると、生徒の見え方を出せます</div>') : `<div class="lpage"><div class="ed">
      <div class="sec"><h3>基本</h3><div class="f"><label for="t">題名</label><input type="text" id="t" value="${esc(l.title)}"><span class="err" id="te"></span></div>
        <div class="f"><label for="sm">要約 <span class="hint">生徒の画面で題名の下に出る</span></label><textarea id="sm" style="min-height:70px">${esc(l.summary)}</textarea></div>
        <div class="f" style="max-width:240px"><label for="mn">見る時間のめやす（分）</label><input type="number" id="mn" min="0" value="${l.minutes || ""}"><span class="err" id="mne"></span></div></div>
      <div class="sec"><h3>動画</h3><div class="f"><label for="v">YouTube の住所</label><input type="url" id="v" value="${esc(l.video)}" placeholder="https://www.youtube.com/watch?v=…"><span class="err" id="ve"></span></div>
</div>
      <div class="sec"><h3>資料 <span class="hint">生徒が開ける。PDF・スライド・マインドマップの住所</span></h3>
        <div class="rows" id="files">${l.files.map((x, k) => `<div class="rowx file"><input type="text" value="${esc(x.label)}" aria-label="${k + 1} つ目の資料の名前" placeholder="名前"><input type="url" value="${esc(x.url)}" aria-label="${k + 1} つ目の資料の住所" placeholder="https://"><button class="x" data-flx="${k}" aria-label="${k + 1} つ目の資料を消す">×</button></div>`).join("") || '<span class="hint">まだありません</span>'}</div>
        <span class="err" id="fle"></span><button class="btn sm ghost" id="fladd" style="align-self:flex-start;margin-top:6px;white-space:normal;text-align:left">＋ 資料を足す</button>
        ${l.hasMindmap ? '<p class="hint" style="margin:6px 0 0">学ぶくんの本文にあったマインドマップの住所は、これまでどおり生徒の画面に出ます</p>' : ""}</div></div>
    <aside class="lside" aria-label="所属と公開と保存">${memHtml}
      <div class="sec"><h3>公開</h3><div class="radio">
        <label><input type="radio" name="st" value="published" ${l.status === "published" ? "checked" : ""}>すぐ公開する</label>
        <label><input type="radio" name="st" value="draft" ${l.status === "draft" ? "checked" : ""}>下書き（生徒には出ない）</label>
        <label><input type="radio" name="st" value="scheduled" ${l.status === "scheduled" ? "checked" : ""}>日時を決めて公開<span class="sub"><input type="datetime-local" id="at" value="${esc(localDT(l.at))}" aria-label="公開する日時"></span></label>
        <label><input type="radio" name="st" value="drip" ${l.status === "drip" ? "checked" : ""}>入会から日数で開く<span class="sub" style="display:flex;gap:6px;align-items:center"><input type="number" id="days" min="0" value="${l.days ?? 7}" style="width:80px" aria-label="日数">日後</span></label></div>
        <span class="err" id="ste"></span><p class="hint" style="margin:6px 0 0">入会から日数は、カリキュラムを開ける権利を付けた日から数えます</p></div>
      <div class="sec"><h3>生徒ができること</h3>
        <label class="sw"><input type="checkbox" id="qa" ${l.qa ? "checked" : ""}><span>このコンテンツへの質問<br><span class="hint">添削ルームに届く</span></span></label></div>
      <div class="sec" style="display:flex;flex-direction:column;gap:8px"><button class="btn pri" id="save" style="justify-content:center">保存する</button><span class="hint">⌘／Ctrl＋Enter でも保存</span></div></aside></div>`}`;
    $("[data-back]").onclick = () => go(V.cid ? { kind: "course", sid: V.sid, cid: V.cid, focus: V.chid } : { kind: "contents", sid: V.sid });
    $$("[data-sib]").forEach((b) => (b.onclick = () => go({ kind: "lesson", sid: V.sid, cid: c.id, chid: ch.id, lid: b.dataset.sib })));
    $$("[data-pv]").forEach((b) => (b.onclick = () => { if (!V.pv && dirty) grab(l); V.pv = b.dataset.pv; render(); }));
    if (pv) return;
    const mk = () => (dirty = true); $("#main").querySelectorAll(".lpage input,.lpage textarea").forEach((x) => { x.addEventListener("input", mk); x.addEventListener("change", mk); });
    $$("[data-rmm]").forEach((b) => (b.onclick = () => { grab(l); V.mem = V.mem.filter((x) => x !== b.dataset.rmm); dirty = true; render(); $("#addm").focus(); }));
    $("#addmb").onclick = () => { const v = $("#addm").value; if (!v) { $("#me").textContent = "足すコースを選んでください"; $("#addm").focus(); return; } grab(l); V.mem.push(v); dirty = true; render(); $("#addm").focus(); };
    $("#at").onfocus = () => { $("[name=st][value=scheduled]").checked = true; }; $("#days").onfocus = () => { $("[name=st][value=drip]").checked = true; };
    $("#fladd").onclick = () => { grab(l); l.files.push({ label: "", url: "" }); dirty = true; render(); const r = $$("#files input"); r[r.length - 2].focus(); };
    $$("[data-flx]").forEach((b) => (b.onclick = () => { grab(l); l.files.splice(+b.dataset.flx, 1); dirty = true; render(); $("#fladd").focus(); }));
    const save = async () => {
      ["#te", "#ve", "#me", "#ste", "#fle", "#mne"].forEach((x) => ($(x).textContent = ""));
      const t = $("#t").value.trim(); if (!t) { $("#te").textContent = "題名が空です。題名を入れてから保存してください"; $("#t").focus(); return; }
      const v = $("#v").value.trim(); if (v && !/youtu\.?be/.test(v)) { $("#ve").textContent = ERR.bad_video_url; $("#v").focus(); return; }
      if (!V.mem.length) { $("#me").textContent = "所属するコースを 1 つ以上選んでください。どのコースにも無いと、生徒には出ません"; $("#addm").focus(); return; }
      const stv = $("[name=st]:checked").value;
      if (stv === "scheduled" && !$("#at").value) { $("#ste").textContent = "公開する日時が空です"; $("#at").focus(); return; }
      grab(l);
      const body = { id: l.id === "new" ? undefined : l.id, title: l.title, summary: l.summary, minutes: l.minutes || null, video_url: l.video, files: l.files, status: l.status,
        publish_at: l.status === "scheduled" ? new Date(l.at).toISOString() : null, drip_days: l.status === "drip" ? l.days : null, can_ask: l.qa, courses: V.mem };
      const wasNew = l.id === "new";
      const r = await act("content", body, null, (res) => {
        dirty = false; const nl = site().lessons.get(res.id);
        const where = nl.status === "published" ? "公開中" : nl.status === "draft" ? "下書き" : nl.status === "scheduled" ? `${fmtDT(nl.at)} に公開` : `入会 ${nl.days} 日後に開く`;
        V = { ...V, lid: res.id, isNew: false, draft: null, mem: null };
        if (V.chid && !V.mem && !memOf(nl).some((x) => x.ch.id === V.chid)) { V.chid = null; V.cid = null; }
        render(); toast(`「${nl.title}」を${wasNew ? "作りました" : "保存しました"}（${where}）`); $("#save")?.focus();
      });
      if (r && !r.ok) {
        const map = { title: "#te", video_url: "#ve", courses: "#me", publish_at: "#ste", drip_days: "#ste", files: "#fle", minutes: "#mne" };
        if (map[r.field]) { $(map[r.field]).textContent = errText(r); }
      }
    };
    $("#save").onclick = save; $("#main").querySelectorAll(".lpage input,.lpage textarea").forEach((x) => x.addEventListener("keydown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); save(); } }));
    if (V.isNew) { $("#t").focus(); V.isNew = false; }
  }
  async function loadDetail(l) {
    const r = await call("content?id=" + encodeURIComponent(l.id));
    if (!r.ok) { toast(errText(r)); go({ kind: "contents", sid: V.sid }); return; }
    l.toc = Array.isArray(r.content.toc) ? r.content.toc : [];
    l.hasMindmap = /\[マインドマップ\]\(/.test(r.content.body || "");
    if (V.kind === "lesson" && findL(V.lid) === l) render();
  }
  function grab(l) {
    if (!$("#t")) return;
    l.title = $("#t").value.trim(); l.summary = $("#sm").value; l.minutes = +$("#mn").value || 0; l.video = $("#v").value.trim();
    l.files = $$("#files .rowx").map((r) => { const [a, b] = [...r.querySelectorAll("input")].map((x) => x.value.trim()); return { label: a, url: b }; }).filter((x) => x.label || x.url);
    l.status = $("[name=st]:checked").value; l.at = $("#at").value ? new Date($("#at").value).toISOString() : ""; l.days = $("#days").value === "" ? 0 : +$("#days").value; l.qa = $("#qa").checked;
  }
  function preview(c, ch, l, pv) {
    const idx = ch.lessons.indexOf(l); const locked = l.status !== "published";
    return `<div class="pv-wrap"><div class="pv ${pv === "sp" ? "phone" : ""}"><div class="hint">${esc(c.title)} › ${esc(ch.title)}　${idx + 1} / ${ch.lessons.length}</div>
      <h2 style="margin:2px 0 0;font-size:${pv === "sp" ? 17 : 20}px">${esc(l.title || "（題名なし）")}</h2>${l.minutes ? `<div class="hint">約 ${l.minutes} 分</div>` : ""}
      ${locked ? `<div class="locked" style="margin-top:10px">${l.status === "draft" ? "下書きなので、生徒には出ていません" : l.status === "scheduled" ? `${esc(fmtDT(l.at)) || "（日時未設定）"} に開きます` : `入会から ${l.days} 日後に開きます`}</div>` : ""}
      ${l.video ? '<div class="video">▶ 動画（YouTube）</div>' : ""}${l.summary ? `<p style="white-space:pre-wrap">${esc(l.summary)}</p>` : ""}
      ${l.files.length ? `<div class="lbl" style="margin-top:8px">資料</div><div class="dl">${l.files.map((x) => `<span>📄 ${esc(x.label)}</span>`).join("")}</div>` : ""}
      <div class="pvfoot">${l.qa ? '<button class="btn" type="button" tabindex="-1">このコンテンツについて質問する</button>' : ""}</div></div></div>`;
  }

  // ---------- マイページの作成画面（仕組みはページと同じ：HTML・版・公開） ----------
  let MP = null, mpTab = "html", mpDraft = null, mpH = 0;
  const MARK_LABEL = { name: "呼び名", next: "続きから見る", shelf: "教材の棚", fresh: "新しく入った教材", progress: "学びの記録", news: "新しいお知らせ", apps: "使えるアプリ" };
  const marksOf = (h) => Object.keys(MARK_LABEL).filter((k) => new RegExp(`data-lab-part\\s*=\\s*["']mypage:${k}["']`).test(String(h || "").replace(/<!--[\\s\\S]*?-->/g, "")));
  async function loadMypage(v) {
    const r = await call("/api/admin/mypage" + (v ? "?v=" + encodeURIComponent(v) : ""));
    if (!r.ok) { toast(errText(r)); return false; }
    MP = r; mpDraft = r.html; return true;
  }
  window.addEventListener("message", (e) => {
    const fr = $("#mpfr");
    if (!fr || e.source !== fr.contentWindow || !e.data || typeof e.data.labMypageHeight !== "number") return;
    mpH = Math.min(Math.max(e.data.labMypageHeight, 200), 6000); fr.style.height = mpH + "px";
  });
  function renderMypageHtml(m) {
    if (!MP) { m.innerHTML = `${crumbs()}<h1>マイページ</h1><p class="hint">読み込んでいます…</p>`; loadMypage().then((ok) => ok && V.kind === "mypage" && render()); return; }
    const p = MP.page, live = MP.mode === "html" && p.status === "published" && p.published_version;
    const cur = MP.version, have = marksOf(mpDraft);
    const changed = mpDraft !== MP.html;
    m.innerHTML = `${crumbs()}<p style="margin:0 0 6px"><button class="btn sm ghost" id="mpback">← テンプレと部品に戻る</button></p><div class="hrow"><h1>マイページ（上級：HTML）</h1>${live ? `<span class="st pub">● 公開中 版 ${p.published_version}</span>` : '<span class="st draft">○ まだ公開していない</span>'}<span class="grow"></span>
      ${cur && !(live && cur === p.published_version) ? `<button class="btn pri" id="mppub" ${changed ? "disabled" : ""}>版 ${cur} を公開する</button>` : ""}</div>
    <p class="lead">HTML でまるごと作ります。印を書いた所に、生徒ごとの中身が入ります。版を公開すると、生徒にはテンプレと部品の形の代わりにこの HTML が出ます（テンプレと部品の形を公開し直すと戻る）。</p>
    <div class="tabs2" role="tablist">${[["html", "HTML"], ["pc", "見え方（パソコン）"], ["sp", "見え方（スマホ）"], ["vers", `版（${MP.versions.length}）`]].map(([k, n]) => `<button role="tab" aria-selected="${mpTab === k}" data-mpt="${k}">${n}</button>`).join("")}</div>
    <div id="mpb"></div>`;
    const b = $("#mpb");
    if (mpTab === "html") {
      b.innerHTML = `<div class="ed"><div class="sec"><div class="hrow" style="margin-bottom:8px"><span class="hint">いま開いている版：${cur ? `版 ${cur}` : "なし"}${changed ? "（書きかけあり）" : ""}</span><span class="grow"></span>
        <select id="mpver" aria-label="開く版" style="width:auto">${MP.versions.map((x) => `<option value="${x.version}" ${x.version === cur ? "selected" : ""}>版 ${x.version}${x.version === p.published_version && live ? "（公開中）" : ""}${x.note ? "・" + esc(x.note.slice(0, 20)) : ""}</option>`).join("")}</select></div>
        <div class="mdbar" role="toolbar" aria-label="印を入れる">${Object.entries(MARK_LABEL).map(([k, n]) => `<button data-mk="${k}" title="カーソルの位置に入れる">＋ ${n}</button>`).join("")}</div>
        <p class="hint" id="mphint" style="margin:6px 0">入っている印：${Object.entries(MARK_LABEL).map(([k, n]) => have.includes(k) ? `<span class="key">${n}</span>` : `<span style="color:var(--muted)">${n}（なし）</span>`).join(" ")}</p>
        <textarea id="mph" spellcheck="false" aria-label="マイページの HTML" style="min-height:460px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;tab-size:2">${esc(mpDraft)}</textarea>
        <div class="f" style="margin-top:8px"><label for="mpnote">この版のメモ <span class="hint">版の一覧に出る</span></label><input type="text" id="mpnote" maxlength="200" placeholder="例：お知らせを上に移した"></div>
        <span class="err" id="mpe"></span></div>
        <div class="stick"><button class="btn pri" id="mpsave" ${changed ? "" : "disabled"}>保存する（版 ${(p.latest_version || 0) + 1} になる）</button><button class="btn ghost" id="mpundo" ${changed ? "" : "disabled"}>書きかけを捨てる</button><span class="hint">⌘／Ctrl＋S でも保存。保存しても、公開するまで生徒には出ません</span></div></div>`;
      const ta = $("#mph");
      const hint = () => { const hv = marksOf(mpDraft); $("#mphint").innerHTML = "入っている印：" + Object.entries(MARK_LABEL).map(([k, n]) => hv.includes(k) ? `<span class="key">${n}</span>` : `<span style="color:var(--muted)">${n}（なし）</span>`).join(" "); };
      const sync = () => { mpDraft = ta.value; hint(); dirty = mpDraft !== MP.html; $("#mpsave").disabled = !dirty; $("#mpundo").disabled = !dirty; const pb = $("#mppub"); if (pb) pb.disabled = dirty; };
      ta.addEventListener("input", sync);
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Tab") { e.preventDefault(); const s0 = ta.selectionStart; ta.setRangeText("  ", s0, ta.selectionEnd, "end"); sync(); }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      });
      $$("[data-mk]").forEach((x) => (x.onclick = () => { const t = `<div data-lab-part="mypage:${x.dataset.mk}"></div>`; ta.focus(); ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, "end"); sync(); }));
      $("#mpver").onchange = (e) => { const go2 = async () => { dirty = false; if (await loadMypage(e.target.value)) render(); }; if (dirty) { confirmLeave(go2); return; } go2(); };
      $("#mpundo").onclick = () => { mpDraft = MP.html; dirty = false; render(); toast("書きかけを捨てました"); };
      const save = async () => {
        if (busy || mpDraft === MP.html) return;
        if (!mpDraft.trim()) { $("#mpe").textContent = "HTML が空です"; ta.focus(); return; }
        busy = true;
        try {
          const r = await call("/api/admin/mypage", "PUT", { html: mpDraft, note: $("#mpnote").value });
          if (!r.ok) { $("#mpe").textContent = r.error === "too_long" ? "長すぎます（40 万字まで）" : errText(r); return; }
          dirty = false; await loadMypage(r.version); render();
          toast(`版 ${r.version} として保存しました。生徒にはまだ出ていません`);
          $("#mpsave")?.focus();
        } finally { busy = false; }
      };
      $("#mpsave").onclick = save;
    } else if (mpTab === "pc" || mpTab === "sp") {
      b.innerHTML = `<p class="hint">中身は見本です（呼び名は「受講生」、次にやることは教材の最初の 1 本、アプリは関門を通ったもの全部）。${mpDraft !== MP.html ? "保存していない書きかけで出しています。" : ""}</p>
        <div class="pv-wrap"><div class="pv ${mpTab === "sp" ? "phone" : ""}" style="padding:0;overflow:hidden;background:var(--bg)"><iframe id="mpfr" title="マイページの見え方" sandbox="allow-scripts" style="width:100%;border:0;display:block;height:${mpH || 600}px"></iframe></div></div>`;
      call("/api/admin/mypage/preview", "POST", { html: mpDraft }).then((r) => { const fr = $("#mpfr"); if (!fr) return; if (!r.ok) { toast(errText(r)); return; } fr.srcdoc = r.html; });
    } else {
      b.innerHTML = `<div style="overflow-x:auto"><table class="st-t"><thead><tr><th>版</th><th>メモ</th><th>作った人</th><th>日時</th><th></th></tr></thead><tbody>
        ${MP.versions.map((x) => `<tr><td><b>版 ${x.version}</b>${x.version === p.published_version && live ? ' <span class="st pub">公開中</span>' : ""}</td><td>${esc(x.note || "")}</td><td>${esc(String(x.made_by || "").replace(/^admin:/, ""))}</td><td>${esc(fmtDT(x.created_at))}</td>
        <td><button class="btn sm" data-mpopen="${x.version}">開く</button></td></tr>`).join("")}</tbody></table></div>
        ${live ? `<div class="stick"><button class="btn ghost" id="mpstop">公開を止める（生徒の画面からマイページを外す）</button></div>` : ""}`;
      $$("[data-mpopen]").forEach((x) => (x.onclick = () => { const go2 = async () => { dirty = false; if (await loadMypage(x.dataset.mpopen)) { mpTab = "html"; render(); } }; if (dirty) { confirmLeave(go2); return; } go2(); }));
      if ($("#mpstop")) $("#mpstop").onclick = () => { lastF = $("#mpstop"); modal(`<h3>マイページの公開を止めますか</h3><p>生徒の画面からマイページが外れ、教材の一覧が最初に出るようになります。版は残ります。</p><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">止める</button></div>`,
        { x: () => closeM(), ok: async () => { closeM(true); const r = await call("/api/admin/mypage/publish", "POST", { stop: true }); if (!r.ok) { toast(errText(r)); return; } await loadMypage(MP.version); render(); toast("公開を止めました"); } }); };
    }
    $$("[data-mpt]").forEach((x) => (x.onclick = () => { mpTab = x.dataset.mpt; render(); $(`[data-mpt="${mpTab}"]`).focus(); }));
    $("#mpback").onclick = () => { const g = () => { dirty = false; mpDraft = MP.html; mpView = "blocks"; render(); }; if (dirty) { confirmLeave(g); return; } g(); };
    if ($("#mppub")) $("#mppub").onclick = () => {
      lastF = $("#mppub");
      modal(`<h3>版 ${cur} を公開しますか</h3><p>生徒全員のマイページが、すぐにこの版になります。${live ? `今の公開中は版 ${p.published_version} です。` : "生徒の画面で、最初にマイページが出るようになります。"}</p>
        <div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">公開する</button></div>`,
        { x: () => closeM(), ok: async () => { closeM(true); const r = await call("/api/admin/mypage/publish", "POST", { version: cur }); if (!r.ok) { toast(errText(r)); return; } await loadMypage(cur); render(); toast(`版 ${cur} を公開しました`); } });
    };
  }


  // ---------- マイページ：テンプレと部品（2026-10-29 デモ 8 版）。HTML は「上級」から ----------
  let mpView = "blocks", MPC = null, mpOpen = null, mpPv = "pc", mpTimer = null;
  const TPLS = [["simple", "シンプル", "縦に 1 列。スマホで読みやすい"], ["dash", "ダッシュボード", "続きと教材の棚を大きく、横に記録とお知らせ"], ["magazine", "マガジン", "上に大きな画像。教材の棚を横に並べる"]];
  const BLOCKS = { hero: "ようこそ", next: "続きから見る", shelf: "教材の棚", fresh: "新しく入った教材", progress: "学びの記録", news: "お知らせ", cards: "カード（自由なリンク）" };
  const AUTO = { next: "中身は自動：前回の続き（まだ何も見ていない人には最初の 1 本）。進み具合のバー付き", shelf: "中身は自動：その人が見られるプログラムを、カリキュラムの並びで出す。進み具合付き", fresh: "中身は自動：その人が見られる教材のうち、新しく入った 3 本", progress: "中身は自動：今週見た本数・続けた日数・全体の進み", news: "中身は自動：新しいお知らせ 1 件" };
  const cfgCopy = (o) => JSON.parse(JSON.stringify(o));
  const published = () => MP.config || null;
  function renderMypage(m) {
    if (mpView === "html") return renderMypageHtml(m);
    if (!MP) { m.innerHTML = `${crumbs()}<h1>マイページ</h1><p class="hint">読み込んでいます…</p>`; loadMypage().then((ok) => ok && V.kind === "mypage" && render()); return; }
    if (!MPC) MPC = cfgCopy(published() || MP.default_config);
    const pub = published(), changed = JSON.stringify(MPC) !== JSON.stringify(pub || null);
    const liveBlocks = !!pub && MP.mode === "blocks", liveHtml = MP.mode === "html" && MP.page.status === "published" && MP.page.published_version;
    m.innerHTML = `${crumbs()}<div class="hrow"><h1>マイページ</h1>${liveBlocks ? '<span class="st pub">● 公開中</span>' : liveHtml ? '<span class="st sch">● HTML の版が公開中</span>' : '<span class="st draft">○ まだ公開していない</span>'}${changed ? '<span class="hint">公開していない変更があります</span>' : ""}<span class="grow"></span>
      <button class="btn" id="mprev" ${changed && pub ? "" : "disabled"}>変更を捨てる</button><button class="btn pri" id="mppub" ${changed || !liveBlocks ? "" : "disabled"}>公開する</button></div>
    <p class="lead">生徒がログインして最初に見る画面です。テンプレを選んで、部品の並びと文言を直します。${liveHtml ? "いまは上級の HTML の版が出ています。ここで「公開する」と、こちらの形に戻ります。" : ""}</p>
    <div class="mp-ed"><div class="mp-cfg">
      <div class="sec"><h3>テンプレ</h3><div class="mp-tpls" role="radiogroup" aria-label="テンプレ">${TPLS.map(([k, n, d]) => `<button role="radio" aria-checked="${MPC.tpl === k}" data-tpl="${k}" class="mp-tpl"><span class="mp-mini mp-mini-${k}" aria-hidden="true"><i></i><i></i><i></i></span><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>
      <div class="sec"><h3>部品 <span class="hint">並べ替え・出す出さない・文言</span></h3><div class="mp-blocks">${MPC.blocks.map((b, i) => `<div class="mp-bl ${b.on ? "" : "off"}"><div class="mp-blh"><label class="mp-tg"><input type="checkbox" data-bon="${i}" ${b.on ? "checked" : ""} aria-label="${BLOCKS[b.k]}を出す"><span></span></label><b>${BLOCKS[b.k]}</b><span class="grow"></span>
        <span class="mv"><button data-bmv="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="${BLOCKS[b.k]}を上へ">▲</button><button data-bmv="${i}" data-d="1" ${i === MPC.blocks.length - 1 ? "disabled" : ""} aria-label="${BLOCKS[b.k]}を下へ">▼</button></span>
        <button class="btn sm" data-bed="${i}" aria-expanded="${mpOpen === i}">${mpOpen === i ? "閉じる" : "編集"}</button></div>
        ${mpOpen === i ? `<div class="mp-blf">${b.k === "hero" ? `<div class="f"><label for="bh-t">見出し <span class="hint">{{呼び名}} に生徒の呼び名が入る</span></label><input type="text" id="bh-t" data-bf="title" maxlength="120" value="${esc(b.title)}"></div><div class="f"><label for="bh-x">ひとこと</label><input type="text" id="bh-x" data-bf="text" maxlength="300" value="${esc(b.text)}"></div><div class="f"><label for="bh-i">背景の画像の住所 <span class="hint">空なら画像なし。https:// から</span></label><input type="url" id="bh-i" data-bf="img" value="${esc(b.img)}" placeholder="https://"></div>`
          : `<div class="f"><label for="bl-${i}">見出し</label><input type="text" id="bl-${i}" data-bf="label" maxlength="60" value="${esc(b.label)}"></div>${AUTO[b.k] ? `<p class="hint" style="margin:0">${AUTO[b.k]}</p>`
          : `<div class="f"><span class="lbl">中身</span><div class="radio"><label><input type="radio" name="csrc" value="hand" ${b.src !== "apps" ? "checked" : ""}>自分で並べる<span class="hint sub">オプチャ・質問の仕方・申込のページなど、何でも</span></label><label><input type="radio" name="csrc" value="apps" ${b.src === "apps" ? "checked" : ""}>その人が使えるアプリ（自動）<span class="hint sub">権利で開くアプリだけが出る。使えるアプリが無い人には、このカードごと出ない</span></label></div></div>
            ${b.src !== "apps" ? `<div class="rows">${b.items.map((it, k) => `<div class="cardrow"><input type="text" value="${esc(it.title)}" data-li="${k}" data-lf="title" aria-label="${k + 1} 枚目の名前" placeholder="名前"><input type="text" value="${esc(it.desc)}" data-li="${k}" data-lf="desc" aria-label="${k + 1} 枚目のひとこと" placeholder="ひとこと"><input type="url" value="${esc(it.url)}" data-li="${k}" data-lf="url" aria-label="${k + 1} 枚目の住所" placeholder="https://"><button class="x" data-lx="${k}" aria-label="${k + 1} 枚目を消す">×</button></div>`).join("")}</div><button class="btn sm ghost" id="ladd" style="align-self:flex-start">＋ カードを足す</button>` : ""}`}`}<span class="err" id="mpbe"></span></div>` : ""}</div>`).join("")}</div></div>
      <details class="sec mp-adv"><summary>上級：HTML で書く</summary><p class="hint">テンプレと部品の代わりに、HTML でまるごと作ります。今の形を HTML に写して始められます。HTML の版を公開するまで、生徒の見え方は変わりません。</p><div class="hrow"><button class="btn sm" id="mphtml">今の形を HTML に写して書き始める</button>${MP.versions.length ? '<button class="btn sm ghost" id="mphtml2">HTML の版を開く</button>' : ""}</div></details>
    </div>
    <div class="mp-pvbox"><div class="hrow" style="margin-bottom:8px"><b style="font-size:13px">見え方</b><span class="hint">中身は見本（呼び名は「受講生」）</span><span class="grow"></span><div class="seg"><button class="btn sm ${mpPv === "pc" ? "pri" : ""}" data-mpv="pc" aria-pressed="${mpPv === "pc"}">パソコン</button><button class="btn sm ${mpPv === "sp" ? "pri" : ""}" data-mpv="sp" aria-pressed="${mpPv === "sp"}">スマホ</button></div></div>
      <div class="mp-frame ${mpPv}" style="padding:12px"><iframe id="mpfr" title="マイページの見え方" sandbox="allow-scripts" style="width:100%;border:0;display:block;height:${mpH || 640}px"></iframe></div></div></div>`;
    const refresh = (now) => { clearTimeout(mpTimer); mpTimer = setTimeout(() => call("/api/admin/mypage/preview", "POST", { config: MPC }).then((r) => { const fr = $("#mpfr"); if (fr && r.ok) fr.srcdoc = r.html; }), now ? 0 : 400); };
    const ch = (focusSel) => { dirty = true; render(); if (focusSel) $(focusSel)?.focus(); };
    refresh(true);
    $$("[data-tpl]").forEach((b) => (b.onclick = () => { MPC.tpl = b.dataset.tpl; ch(`[data-tpl="${MPC.tpl}"]`); say(`テンプレを「${TPLS.find((x) => x[0] === MPC.tpl)[1]}」にしました`); }));
    $$("[data-bon]").forEach((x) => (x.onchange = () => { MPC.blocks[+x.dataset.bon].on = x.checked; ch(`[data-bon="${x.dataset.bon}"]`); }));
    $$("[data-bmv]").forEach((b) => (b.onclick = () => { const i = +b.dataset.bmv, j = i + +b.dataset.d; [MPC.blocks[i], MPC.blocks[j]] = [MPC.blocks[j], MPC.blocks[i]]; if (mpOpen === i) mpOpen = j; else if (mpOpen === j) mpOpen = i; dirty = true; render(); ($(`[data-bmv="${j}"][data-d="${b.dataset.d}"]:not([disabled])`) || $(`[data-bmv="${j}"]:not([disabled])`))?.focus(); }));
    $$("[data-bed]").forEach((b) => (b.onclick = () => { const i = +b.dataset.bed; mpOpen = mpOpen === i ? null : i; render(); ($(".mp-blf input") || $(`[data-bed="${i}"]`)).focus(); }));
    const mark = () => { dirty = true; $("#mprev").disabled = !published(); $("#mppub").disabled = false; refresh(); };
    $$("[data-bf]").forEach((x) => (x.oninput = () => { MPC.blocks[mpOpen][x.dataset.bf] = x.value; mark(); }));
    $$("[data-li]").forEach((x) => (x.oninput = () => { MPC.blocks[mpOpen].items[+x.dataset.li][x.dataset.lf] = x.value; mark(); }));
    $$("[data-lx]").forEach((b) => (b.onclick = () => { MPC.blocks[mpOpen].items.splice(+b.dataset.lx, 1); ch("#ladd"); }));
    if ($("#ladd")) $("#ladd").onclick = () => { MPC.blocks[mpOpen].items.push({ title: "", desc: "", url: "" }); ch(); const r = $$("[data-li]"); r[r.length - 3]?.focus(); };
    $$("[name=csrc]").forEach((x) => (x.onchange = () => { MPC.blocks[mpOpen].src = x.value; MPC.blocks[mpOpen].items = MPC.blocks[mpOpen].items || []; ch(`[name=csrc][value=${x.value}]`); }));
    $$("[data-mpv]").forEach((b) => (b.onclick = () => { mpPv = b.dataset.mpv; render(); $(`[data-mpv="${mpPv}"]`).focus(); }));
    $("#mprev").onclick = () => { MPC = cfgCopy(published()); mpOpen = null; dirty = false; render(); toast("公開中の形に戻しました"); };
    $("#mppub").onclick = () => {
      lastF = $("#mppub");
      modal(`<h3>マイページを公開しますか</h3><p>生徒全員のマイページが、すぐにこの形になります。${liveHtml ? "いま出ている HTML の版の代わりに、こちらが出ます。" : ""}</p><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">公開する</button></div>`,
        { x: () => closeM(), ok: async () => { closeM(true); const r = await call("/api/admin/mypage/config", "PUT", { config: MPC });
          if (!r.ok) { toast({ bad_card_url: "カードの住所は https:// から入れてください", card_title_required: "カードの名前が空です", bad_image_url: "画像の住所は https:// から入れてください" }[r.error] || errText(r)); return; }
          dirty = false; await loadMypage(); MPC = cfgCopy(MP.config); render(); toast("マイページを公開しました"); $("#mprev")?.focus(); } });
    };
    $("#mphtml").onclick = async () => {
      if (busy) return; busy = true;
      try { const r = await call("/api/admin/mypage/to-html", "POST", { config: MPC }); if (!r.ok) { toast(errText(r)); return; } dirty = false; await loadMypage(r.version); mpView = "html"; mpTab = "html"; render(); toast(`今の形を版 ${r.version} として写しました。公開するまで生徒には出ません`); }
      finally { busy = false; }
    };
    if ($("#mphtml2")) $("#mphtml2").onclick = () => { mpView = "html"; mpTab = "html"; render(); };
  }

  // ---------- サイトのほかの画面 ----------
  function renderSoon(m) {
    const s = site(); const what = ["お知らせ", "マイページと生徒の画面に出すお知らせを書く・日時を決めて出す。書く画面はまだありません（次の 1 枚で作る）"];
    m.innerHTML = `${crumbs()}<h1>${what[0]}</h1><p class="lead">${esc(s.name)}</p><div class="soon"><b>まだ作っていません</b><p style="margin:6px 0 0">${what[1]}</p></div>`;
  }
  const LCOL = ["#b45309", "#1d4ed8", "#0f766e", "#7c3aed", "#be123c", "#334155"];
  function renderSiteSet(m) {
    const s = site(); const L = { logo: s.login.logo || "", color: s.login.color || "", msg: s.login.msg || "" };
    const origin = location.origin;
    const urls = [["ログイン", "/login", "生徒に最初に渡す住所。ログインしたら下の「最初に出す画面」へ"], ["マイページ", "/app", "ログインしたあとの入口"], ["教材の一覧", "/app#lessons", "教材だけを開いてほしいとき"]];
    m.innerHTML = `${crumbs()}<h1>サイトの設定</h1><p class="lead">${esc(s.name)}</p><div class="ed" style="max-width:820px">
    <div class="sec"><h3>基本</h3><div class="f"><label for="sn">サイトの名前 <span class="hint">生徒の画面の上に出る</span></label><input type="text" id="sn" value="${esc(s.name)}"><span class="err" id="sne"></span></div>
      <div class="f"><label for="sd">説明 <span class="hint">Naoki だけが見るメモ</span></label><input type="text" id="sd" value="${esc(s.desc)}"></div>
      <div class="f"><span class="lbl">公開</span><div class="radio"><label><input type="radio" name="ss" value="published" ${s.status === "published" ? "checked" : ""}>公開する</label><label><input type="radio" name="ss" value="draft" ${s.status === "draft" ? "checked" : ""}>下書き（サイトごと生徒に出ない）</label></div></div></div>
    <div class="sec"><h3>住所 <span class="hint">決まった形。変えられません（独自のドメインは、ほかの事業者を迎えるときに）</span></h3>
      <div class="urls">${urls.map(([n, u, h], i) => `<div class="urlrow"><div><b>${n}</b><span class="hint">${h}</span></div><code>${esc(origin + u)}</code><button class="btn sm" data-cp="${i}">写す</button></div>`).join("")}</div></div>
    <div class="sec"><h3>ログインしたあと最初に出す画面</h3><div class="radio"><label><input type="radio" name="land" value="mypage" ${s.landing !== "lessons" ? "checked" : ""}>マイページ<span class="hint sub">マイページを公開していないときは、教材の一覧が出ます</span></label><label><input type="radio" name="land" value="lessons" ${s.landing === "lessons" ? "checked" : ""}>教材の一覧</label></div></div>
    <div class="sec"><h3>ログイン画面</h3><div class="two"><div>
      <div class="f"><label for="lg">ロゴの文字 <span class="hint">空ならシアラボ</span></label><input type="text" id="lg" maxlength="40" value="${esc(L.logo)}"></div>
      <div class="f"><span class="lbl">主な色 <span class="hint">ボタンとリンクの色</span></span><div style="display:flex;gap:6px;flex-wrap:wrap"><label style="cursor:pointer"><input type="radio" name="lc" value="" ${!L.color ? "checked" : ""} class="sr" aria-label="今の色のまま"><span class="lcsw" style="display:inline-grid;place-items:center;width:40px;height:40px;border-radius:8px;border:1px dashed var(--field);font-size:11px">なし</span></label>${LCOL.map((c) => `<label style="cursor:pointer"><input type="radio" name="lc" value="${c}" ${L.color === c ? "checked" : ""} class="sr" aria-label="色 ${c}"><span class="lcsw" style="display:inline-block;width:40px;height:40px;border-radius:8px;background:${c}"></span></label>`).join("")}</div></div>
      <div class="f"><label for="lm">ひとこと <span class="hint">空なら今の説明のまま</span></label><input type="text" id="lm" maxlength="200" value="${esc(L.msg)}"></div></div>
      <div><div class="lbl" style="margin-bottom:6px">見え方</div><div class="lgpv" id="lgpv"></div></div></div></div>
    <div class="stick"><button class="btn pri" id="ssave">保存する</button></div></div>`;
    const swatch = () => $$("[name=lc]").forEach((r) => (r.nextElementSibling.style.outline = r.checked ? "3px solid var(--fg)" : "0", r.nextElementSibling.style.outlineOffset = "2px"));
    const lp = () => { const c = ($("[name=lc]:checked") || {}).value || "#1f5c4d"; $("#lgpv").innerHTML = `<div class="lgcard"><div class="lglogo" style="color:${c}">${esc($("#lg").value || "シアラボ")}</div><p>${esc($("#lm").value || "登録したメールアドレスに、ログイン用のリンクを送ります。パスワードは要りません。")}</p><div class="lgin">メールアドレス</div><div class="lgbtn" style="background:${c}">ログイン用のリンクを送る</div><span class="hint">まだ登録していない方は無料登録へ</span></div>`; };
    lp(); swatch();
    $$("#main input").forEach((x) => { x.addEventListener("input", () => { dirty = true; lp(); }); x.addEventListener("change", () => { dirty = true; lp(); swatch(); }); });
    $$("[data-cp]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(origin + urls[+b.dataset.cp][1]); b.textContent = "写しました"; } catch { b.textContent = "写せませんでした"; } setTimeout(() => (b.textContent = "写す"), 1800); }));
    $("#ssave").onclick = () => {
      const n = $("#sn").value.trim(); if (!n) { $("#sne").textContent = "名前が空です"; $("#sn").focus(); return; }
      const active = $("[name=ss]:checked").value === "published";
      const doIt = async () => {
        if (busy) return; busy = true;
        try {
          const r1 = await call("site", "PUT", { id: s.id, name: n, description: $("#sd").value, active });
          if (!r1.ok) { toast(errText(r1)); return; }
          const r2 = await call("/api/admin/mypage/look", "PUT", { landing: $("[name=land]:checked").value, login: { logo: $("#lg").value, color: $("[name=lc]:checked").value, msg: $("#lm").value } });
          if (!r2.ok) { toast(errText(r2)); return; }
          dirty = false; await reload(); render(); toast("サイトの設定を保存しました"); $("#ssave").focus();
        } finally { busy = false; }
      };
      if (!active && s.status === "published") { lastF = $("#ssave"); modal(`<h3>サイトを下書きにしますか</h3><p>しあらぼの生徒全員の教材が、すぐに見えなくなります。</p><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">下書きにする</button></div>`, { x: () => closeM(), ok: () => { closeM(true); doIt(); } }); return; }
      doIt();
    };
  }
  // 受講生（読むだけ）。進み具合＝見たコンテンツ ÷ 開けるコンテンツ（見た記録から数える）
  async function loadStudents() {
    const r = await call("students");
    STU = r.ok ? r.students : [];
    if (!r.ok) toast(errText(r));
  }
  function renderStudents(m) {
    const s = site(); const ks = s.curricula;
    if (!STU) { m.innerHTML = `${crumbs()}<h1>受講生</h1><p class="hint">読み込んでいます…</p>`; loadStudents().then(() => V.kind === "students" && render()); return; }
    const opens = (st) => ks.filter((k) => live(k) && k.rights.some((r) => st.rights.includes(r)));
    const visible = (st) => { const ids = new Set(); opens(st).forEach((k) => k.programs.forEach((pid) => { const p = s.programs.find((x) => x.id === pid); if (p && live(p)) p.chapters.forEach((ch) => live(ch) && ch.lessons.forEach((l) => l.status !== "draft" && ids.add(l.id))); })); return ids; };
    const prog = (st) => { const vis = visible(st); if (!vis.size) return 0; return Math.round((st.viewed_ids.filter((id) => vis.has(id)).length / vis.size) * 100); };
    const stop = (st) => { const d = daysAgo(st.last_viewed_at); return d == null || d >= 14; };
    const rows = STU.filter((st) => (!stuF.cur || opens(st).some((k) => k.id === stuF.cur)) && (!stuF.stop || stop(st)) && (!stuF.q || (st.name + st.email).includes(stuF.q)));
    const all = STU.map((st) => ({ st, p: prog(st) }));
    m.innerHTML = `${crumbs()}<h1>受講生</h1><p class="lead">このサイトのカリキュラムを開ける人と、学びの進み具合です。名前や連絡先などの人の情報は、顧客管理としあらぼ管理が正本です。開ける・閉じるは権利の付け外しで行います。</p>
    <div class="kpis"><div class="kpi"><b>${STU.length}</b><span>開ける人</span></div><div class="kpi"><b>${STU.filter((x) => x.viewed_ids.length).length}</b><span>1 本以上見た人</span></div><div class="kpi"><b>${STU.length ? Math.round(all.reduce((a, x) => a + x.p, 0) / STU.length) : 0}%</b><span>平均の進み具合</span></div><div class="kpi"><b>${STU.filter(stop).length}</b><span>14 日以上見ていない人</span></div></div>
    <div class="tools"><input class="search" type="search" id="sq" placeholder="名前かメールで探す" value="${esc(stuF.q)}" aria-label="名前かメールで探す">
      <select id="sk" aria-label="カリキュラムで絞る" style="width:auto"><option value="">すべてのカリキュラム</option>${ks.map((k) => `<option value="${k.id}" ${stuF.cur === k.id ? "selected" : ""}>${esc(k.title)}</option>`).join("")}</select>
      <button class="btn" id="sstop" aria-pressed="${stuF.stop}">止まっている人だけ（14 日以上）</button><span class="hint">${rows.length} 人</span></div>
    <div style="overflow-x:auto"><table class="st-t"><thead><tr><th>受講生</th><th>開けるカリキュラム</th><th>進み具合</th><th>最後に見た日</th><th></th></tr></thead><tbody>
    ${rows.map((st) => { const p = prog(st), d = daysAgo(st.last_viewed_at); return `<tr><td>${esc(st.name || st.email)}<div>${st.rights.map((r) => `<span class="key">${esc(rname(r))}</span>`).join(" ")}</div></td><td>${opens(st).map((k) => esc(k.title)).join("・") || '<span class="err">なし</span>'}</td>
      <td><div style="display:flex;gap:8px;align-items:center"><div class="bar-p" style="width:90px"><i style="width:${p}%"></i></div>${p}%</div></td>
      <td>${d == null ? '<span class="err">まだ見ていない</span>' : `${d === 0 ? "今日" : d === 1 ? "昨日" : d + " 日前"}${d >= 14 ? ' <span class="err">止まっている</span>' : ""}`}</td>
      <td><button class="btn sm" data-stu="${st.id}">顧客管理で開く →</button></td></tr>`; }).join("") || '<tr><td colspan="5" class="hint">当たる人がいません</td></tr>'}</tbody></table></div>
    <p class="hint">進み具合は、生徒が教材を開いた記録から数えます（「見終わった」を押す形は、まだありません）</p>`;
    $("#sq").oninput = (e) => { stuF.q = e.target.value; const p = e.target.selectionStart; render(); $("#sq").focus(); $("#sq").setSelectionRange(p, p); };
    $("#sk").onchange = (e) => { stuF.cur = e.target.value; render(); $("#sk").focus(); };
    $("#sstop").onclick = () => { stuF.stop = !stuF.stop; render(); $("#sstop").focus(); };
    $$("[data-stu]").forEach((b) => (b.onclick = () => openPerson(b.dataset.stu)));
  }

  // ---------- 部品 ----------
  let tT;
  function toast(t) { say(t); clearTimeout(tT); $("#toast").innerHTML = `<div class="toast" role="status"><span>${esc(t)}</span></div>`; tT = setTimeout(() => ($("#toast").innerHTML = ""), 3200); }
  function undoToast(t, fn) { say(t + "。元に戻せます"); clearTimeout(tT); $("#toast").innerHTML = `<div class="toast" role="status"><span>${esc(t)}</span><button id="und">元に戻す</button></div>`; $("#und").onclick = () => { $("#toast").innerHTML = ""; fn(); }; tT = setTimeout(() => ($("#toast").innerHTML = ""), 8000); }
  function ask(label, done) { modal(`<h3>${esc(label)}</h3><input type="text" id="nm" aria-label="${esc(label)}"><p class="err" id="nme"></p><div class="macts"><button class="btn" data-m="x">やめる</button><button class="btn pri" data-m="ok">作る</button></div>`, { x: () => closeM(), ok: () => { const v = $("#nm").value.trim(); if (!v) { $("#nme").textContent = "名前が空です"; $("#nm").focus(); return; } closeM(true); done(v); } }); $("#nm").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $('[data-m="ok"]').click(); } }; }
  function modal(html, acts) {
    lastF = lastF || root.activeElement; $("#mslot").innerHTML = `<div class="mbg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; const md = $(".modal");
    md.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => acts[b.dataset.m]())); $(".mbg").onclick = (ev) => { if (ev.target === ev.currentTarget) closeM(); };
    (md.querySelector("input:not([type=radio]),textarea,select") || md.querySelector("input,button")).focus();
    md.onkeydown = (ev) => { if (ev.key === "Escape") closeM(); if (ev.key === "Tab") { const a = [...md.querySelectorAll("input,button,textarea,select")]; const i = a.indexOf(root.activeElement); if (ev.shiftKey && i === 0) { ev.preventDefault(); a[a.length - 1].focus(); } else if (!ev.shiftKey && i === a.length - 1) { ev.preventDefault(); a[0].focus(); } } };
  }
  function closeM(noBack) { $("#mslot").innerHTML = ""; if (!noBack && lastF && root.contains(lastF)) lastF.focus(); lastF = null; }

  // 外から呼ぶ：開くたびに読み直す（ほかの画面や AI が直したものを拾うため）。書きかけがあれば読み直さない
  return {
    async open() {
      if (dirty) return;
      if (await reload()) { STU = null; MP = null; MPC = null; mpView = "blocks"; loadStudents().then(() => { if (["sites", "curricula", "curriculum", "students"].includes(V.kind) && !dirty) render(); }); render(); }
    },
    isDirty: () => dirty,
  };
}

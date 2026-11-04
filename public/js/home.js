// 生徒のホームと教材の図書館（2026-11-04 Naoki OK・デモ https://claude.ai/artifact/Wwbzz2xq57h3yo6PNajiuA ）。
// ホームは「学びの記録」と「段」だけ。段の並びは版（シアラボ会員・メンシプ会員・モニターなど）ごとに持つ。
// 種類のラベル：会員サイトのコンテンツにまだ種類の欄が無いので、今はプログラムとコースから決める（管理画面で選べるようにするのは 3 本目）。
// テーマ：入っているプログラムがそのままテーマ。今日のおすすめは、テーマの中からまだ見ていないものを日付で決めた 4 本。
import { esc } from "/js/common.js";

// 版ごとの段の並び（器）。3 本目で管理画面から並べ替えられるようにする
export const HOME_ROWS = {
  lab: ["record", "continue", "picks", "fresh"],
  mem: ["record", "continue", "picks", "fresh"],
  mon: ["record", "continue", "picks"],
  free: ["continue", "picks"],
};
const ROW_TITLE = { continue: "続きから", picks: "今日のおすすめ", fresh: "新しく入った" };
export const KINDS = ["セミナー", "アーカイブ", "動画講座", "記事", "note記事", "メンシプ限定"];
const READ = new Set(["記事", "note記事", "メンシプ限定"]);

/** 教材の 1 本ずつに、種類・プログラム・コース・並びを付けた平らな一覧 */
export function flatten(programs) {
  const out = [], seen = new Set();
  (programs || []).forEach((p, pi) => (p.courses || []).forEach((c, ci) => c.lessons.forEach((l, li) => {
    if (seen.has(l.id)) return; // 同じ教材が 2 つの棚に入っているときは最初の 1 つ
    seen.add(l.id);
    out.push({ ...l, kind: kindOf(p, c, l), program: p.title, programId: p.id, course: c.title, courseId: c.id, order: [pi, ci, li] });
  })));
  return out;
}
export function kindOf(p, c, l) {
  if (l.kind && KINDS.includes(l.kind)) return l.kind;
  if (/セミナーアーカイブ/.test(p.title || "")) return /その他/.test(c.title || "") ? "アーカイブ" : "セミナー";
  return l.youtube_id ? "動画講座" : "記事";
}

// ---- 学びの記録 ----
const jst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
export function record(views, now = Date.now()) {
  const ids = new Set(views.map((v) => v.id));
  const week = new Set(views.filter((v) => Date.parse(v.at) > now - 7 * 864e5).map((v) => v.id)).size;
  const days = new Map();
  views.forEach((v) => { const d = jst(v.at); days.set(d, (days.get(d) || 0) + 1); });
  let streak = 0;
  const today = jst(new Date(now).toISOString());
  let d = days.has(today) ? today : jst(new Date(now - 864e5).toISOString());
  while (days.has(d) && streak < 3650) { streak++; d = new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10); }
  // 12 週（84 日）。左上が古い日、右下が今日。週は月曜はじまり
  const cells = [];
  const end = new Date(Date.parse(today + "T00:00:00Z"));
  const dow = (end.getUTCDay() + 6) % 7;
  const start = new Date(end.getTime() - (77 + dow) * 864e5);
  for (let t = start.getTime(); t <= end.getTime(); t += 864e5) {
    const key = new Date(t).toISOString().slice(0, 10);
    const n = days.get(key) || 0;
    cells.push({ key, n, lv: n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3 });
  }
  return { total: ids.size, week, streak, cells };
}

// ---- 続きから：最近開いたコースの、まだ見ていない次の 1 本 ----
export function continueList(flat, views, max = 4) {
  const seen = new Set(views.map((v) => v.id));
  const byId = new Map(flat.map((x) => [x.id, x]));
  const out = [], used = new Set();
  for (const v of views) {
    const x = byId.get(v.id); if (!x) continue;
    const key = x.programId + "/" + x.courseId;
    if (used.has(key)) continue;
    used.add(key);
    const next = flat.find((y) => y.programId === x.programId && y.courseId === x.courseId && !seen.has(y.id) && (y.order[2] > x.order[2]));
    if (next) out.push(next);
    if (out.length >= max) break;
  }
  if (!out.length) { const first = flat.find((y) => !seen.has(y.id)); if (first) out.push(first); }
  return out;
}

// ---- 今日のおすすめ：テーマ（プログラム）の中から、まだ見ていないものを日付で決めた順に ----
export function themes(flat) {
  return [...new Map(flat.map((x) => [x.programId, x.program])).entries()].map(([id, title]) => ({ id, title }));
}
export function defaultTheme(flat, views) {
  const count = new Map();
  const byId = new Map(flat.map((x) => [x.id, x]));
  views.forEach((v) => { const x = byId.get(v.id); if (x) count.set(x.programId, (count.get(x.programId) || 0) + 1); });
  let best = null, n = -1;
  count.forEach((c, id) => { if (c > n) { best = id; n = c; } });
  return best || (flat[0] && flat[0].programId) || null;
}
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
export function picks(flat, views, themeId, seed, day, exclude = [], max = 4) {
  const seen = new Set(views.map((v) => v.id)), ex = new Set(exclude);
  const pool = flat.filter((x) => x.programId === themeId && !seen.has(x.id) && !ex.has(x.id));
  return pool.map((x) => ({ x, k: hash(seed + "|" + day + "|" + x.id) })).sort((a, b) => a.k - b.k).slice(0, max).map((o) => o.x);
}

// ---- 新しく入った：セミナーのいちばん新しいコースの、後ろから ----
export function freshList(flat, max = 4) {
  const sem = flat.filter((x) => x.kind === "セミナー");
  if (!sem.length) return flat.slice(-max).reverse();
  const last = sem.reduce((a, b) => (b.order[1] > a.order[1] ? b : a));
  return sem.filter((x) => x.courseId === last.courseId).sort((a, b) => b.order[2] - a.order[2]).slice(0, max);
}

// ---- 絵（カード） ----
export function card(x, seen) {
  const rd = READ.has(x.kind) || !x.youtube_id;
  const done = seen && seen.has(x.id);
  const th = rd
    ? `<span class="th paper"><span class="lb">${esc(x.kind)}</span><span class="pt">${esc(x.course)}</span></span>`
    : `<span class="th"><img alt="" loading="lazy" src="https://i.ytimg.com/vi/${encodeURIComponent(x.youtube_id)}/mqdefault.jpg" onerror="this.remove()"><span class="lb">${esc(x.kind)}</span>${x.minutes ? `<span class="du">${x.minutes} 分</span>` : ""}${done ? '<span class="pg"><i style="width:100%"></i></span>' : ""}</span>`;
  return `<a class="v" href="#lesson/${encodeURIComponent(x.id)}" data-id="${esc(x.id)}">${th}<span class="vt">${esc(x.title)}</span><span class="vm">${esc(x.course)}${done ? "・見た" : ""}</span></a>`;
}
const rail = (items, seen) => `<div class="rail">${items.map((x) => card(x, seen)).join("")}</div>`;

/** ホームを描く。ctx = { tier, flat, views, seed, theme, onTheme } */
export function homeHtml(ctx) {
  const { flat, views } = ctx;
  const seen = new Set(views.map((v) => v.id));
  const rows = HOME_ROWS[ctx.tier] || HOME_ROWS.lab;
  const cont = continueList(flat, views);
  const out = [];
  for (const k of rows) {
    if (k === "record") {
      const r = record(views);
      out.push(`<section class="rec" aria-label="学びの記録"><div class="nums">
        <div><b>${r.total}<small>本</small></b><span>見た教材</span></div>
        <div><b>${r.week}<small>本</small></b><span>今週見た</span></div>
        <div><b>${r.streak}<small>日</small></b><span>続いている</span></div></div>
        <div class="hm" role="img" aria-label="12 週のうち学んだ日 ${r.cells.filter((c) => c.n).length} 日">${r.cells.map((c) => `<i class="l${c.lv}" title="${c.key}${c.n ? "・" + c.n + " 本" : ""}"></i>`).join("")}</div></section>`);
    } else if (k === "continue") {
      if (cont.length) out.push(`<section class="row"><div class="rh"><h2>${views.length ? ROW_TITLE.continue : "最初に見る 1 本"}</h2></div>${rail(cont, seen)}</section>`);
    } else if (k === "picks") {
      const list = themes(flat);
      if (!list.length) continue;
      const theme = list.some((t) => t.id === ctx.theme) ? ctx.theme : defaultTheme(flat, views);
      const items = picks(flat, views, theme, ctx.seed, new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), cont.map((x) => x.id));
      out.push(`<section class="row"><div class="rh"><h2>${ROW_TITLE.picks}</h2>
        <label class="theme"><span class="sr">テーマを変える</span><select id="home-theme">${list.map((t) => `<option value="${esc(t.id)}"${t.id === theme ? " selected" : ""}>テーマ：${esc(t.title)}</option>`).join("")}</select></label></div>
        <p class="rnote">あなたのテーマから毎日 4 本。明日の朝に入れ替わります</p>
        ${items.length ? rail(items, seen) : '<p class="note">このテーマの教材は、全部見終わりました。テーマを変えると、ほかのおすすめが出ます。</p>'}</section>`);
    } else if (k === "fresh") {
      const f = freshList(flat);
      if (f.length) out.push(`<section class="row"><div class="rh"><h2>${ROW_TITLE.fresh}</h2><a href="#lessons">すべて</a></div>${rail(f, seen)}</section>`);
    }
  }
  return `<div class="home">${out.join("")}</div>`;
}

/** 教材の図書館：上の絞り込み（すべて＋種類）と、種類ごとの棚。種類を選ぶと、コースごとに全部を並べる */
export function libraryHtml(flat, views, kind) {
  const seen = new Set(views.map((v) => v.id));
  const kinds = KINDS.filter((k) => flat.some((x) => x.kind === k));
  const chips = `<div class="chips" role="group" aria-label="種類で絞り込む">${["すべて", ...kinds].map((k) => `<button type="button" data-kind="${esc(k)}" aria-pressed="${(kind || "すべて") === k}">${esc(k)}${k === "すべて" ? "" : `<span>${flat.filter((x) => x.kind === k).length}</span>`}</button>`).join("")}</div>`;
  let body;
  if (!kind || kind === "すべて") {
    body = kinds.map((k) => { const items = flat.filter((x) => x.kind === k); const newest = k === "セミナー" || k === "アーカイブ" ? [...items].reverse() : items;
      return `<section class="row"><div class="rh"><h2>${esc(k)}<span class="cnt">${items.length}</span></h2><button type="button" class="more" data-kind="${esc(k)}">すべて</button></div>${rail(newest.slice(0, 8), seen)}<div class="board" aria-hidden="true"></div></section>`; }).join("");
  } else {
    const items = flat.filter((x) => x.kind === kind);
    const groups = new Map();
    items.forEach((x) => { const g = x.program === x.course || kind === "セミナー" || kind === "アーカイブ" ? x.course : x.program; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
    const ordered = [...groups.entries()];
    if (kind === "セミナー") ordered.reverse();
    body = ordered.map(([g, xs]) => `<section class="row"><div class="rh"><h2>${esc(g)}<span class="cnt">${xs.length}</span></h2></div><div class="grid">${xs.map((x) => card(x, seen)).join("")}</div></section>`).join("");
  }
  return `<header class="lh"><h1 class="lt">教材</h1><label class="search"><span class="sr">教材を探す</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input id="lib-q" type="search" placeholder="題名で探す" autocomplete="off"></label>${chips}</header>
    <div id="lib-body">${body}</div><div id="lib-found" class="hidden"></div>`;
}
/** 題名で探した結果（種類の絞り込みの中で探す） */
export function searchHtml(flat, views, q, kind) {
  const seen = new Set(views.map((v) => v.id));
  const s = q.trim().toLowerCase();
  const items = flat.filter((x) => (!kind || kind === "すべて" || x.kind === kind) && String(x.title).toLowerCase().includes(s));
  return items.length ? `<section class="row"><div class="rh"><h2>「${esc(q.trim())}」<span class="cnt">${items.length}</span></h2></div><div class="grid">${items.slice(0, 60).map((x) => card(x, seen)).join("")}</div></section>`
    : `<p class="note">「${esc(q.trim())}」に合う教材はありませんでした。言葉を短くするか、上の種類を「すべて」にして探してください。</p>`;
}

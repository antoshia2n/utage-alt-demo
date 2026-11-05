// 目標達成くん（2026-11-05・Naoki 11:25「OK」）1 便目：8 段の帯と ①理想・②条件（KGI・リソース予算）・③戦略（13 週の目標・全体像・状態）
// 正本はサーバーの b_goal_plans（生徒が書く）。ここは描くのと、直したら保存を頼むだけ。
// 2 便目（2026-11-05 12:29 OK）：④ 戦術（状態ごとのリサーチ・仮説・この週の KPI・やること）。
// 3 便目（2026-11-05 12:40 OK）：⑤ 実行・⑥ 記録（記録タブ）と ⑦ 評価・⑧ 修正（振り返りタブ・週報を出す）。
// 4 便目（2026-11-05 13:05 OK）：成長レポート（週ごとの行動と時間の実行率・届いた状態・KGI の伸び）。
export const WEEKS = 13;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D = 864e5;
const day0 = (d) => Date.parse(d + "T00:00:00Z");
export const weekDate = (plan, n) => new Date(day0(plan.start) + (n - 1) * 7 * D);
const md = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
export const monthWeek = (plan, n) => { const d = weekDate(plan, n); return `${d.getUTCMonth() + 1}月${Math.ceil(d.getUTCDate() / 7)}週`; };
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
// 今日は 13 週の何週目か（始まる前は 0、終わったあとは 14）
export function weekNo(plan, today) { const k = Math.floor((day0(today) - day0(plan.start)) / (7 * D)) + 1; return Math.max(0, Math.min(WEEKS + 1, k)); }
export const goal13Text = (plan) => plan.goal13Own ? plan.goal13 : (plan.kgi.length ? `${plan.kgi.map((k) => `${k.n} ${fmt(k.to)} ${k.u}`.trim()).join("・")}に届いている` : "");
export const budSum = (p) => p.bud.reduce((a, b) => a + (+b.h || 0), 0);
export const goalHours = (p) => p.bud.filter((b) => b.g).reduce((a, b) => a + (+b.h || 0), 0);
const kp = (k) => (k.to ? Math.min(1, Math.max(0, k.v / k.to)) : 0);
export const msProgress = (m) => (m.kpi.length ? m.kpi.reduce((a, b) => a + kp(b), 0) / m.kpi.length : null);
export const msDone = (m) => m.kpi.length > 0 && m.kpi.every((k) => k.to > 0 && k.v >= k.to);
// 週に状態を並べる。予備の週は飛ばし、続ける週（ext）はその状態のすぐ後ろに入る。並びきらない数を over で返す
export function place(plan) {
  const seq = [];
  plan.ms.forEach((m, i) => { for (let k = 0; k <= (plan.ext[i] || 0); k++) seq.push([i, k]); });
  const w = Array(WEEKS + 1).fill(null); let j = 0;
  for (let n = 1; n <= WEEKS; n++) { if (plan.spare.includes(n)) { w[n] = "spare"; continue; } if (j < seq.length) w[n] = seq[j++]; }
  return { w, over: seq.length - j };
}
export function weekState(plan, n, now) {
  const { w } = place(plan), x = w[n];
  if (x === "spare") return "spare";
  if (!x) return "empty";
  if (n === now) return "now";
  if (n > now) return x[1] > 0 ? "cont" : "next";
  const last = w.findLastIndex((y) => Array.isArray(y) && y[0] === x[0]);
  return n < last ? "late" : msDone(plan.ms[x[0]]) ? "done" : "late";
}
// 今週の状態の番号（予備の週・13 週の外は null）
export function nowMs(plan, today) { const x = place(plan).w[weekNo(plan, today)]; return Array.isArray(x) ? x[0] : null; }
// その状態が最初に入る週（並びきらなければ 0）
export const msWeek = (plan, i) => place(plan).w.findIndex((x) => Array.isArray(x) && x[0] === i && x[1] === 0);
export const tasksHours = (m) => (m ? m.tasks.reduce((a, t) => a + (+t.hr || 0), 0) : 0);
const ST_LABEL = { done: "達成", late: "未達", now: "今週", next: "これから", cont: "続ける", spare: "予備", empty: "空き" };
const ST_COLOR = { done: "#15803d", now: "#4644c7", next: "#9b99e6", late: "#d97706", cont: "#d97706", spare: "#c7c7cf", empty: "#d4d4dc" };
const ed = (path, val, ph, cls = "") => `<span class="${cls}" data-ed="${path}" data-ph="${esc(ph)}" contenteditable="plaintext-only" role="textbox" aria-label="${esc(ph)}" spellcheck="false">${esc(val)}</span>`;
const head = (no, title, q) => `<div class="gk-sh"><span class="gk-no">${no}</span><h3>${title}</h3><span class="q">${q}</span></div>`;

const STEPS = [["理想", "s1"], ["条件", "s2"], ["戦略", "s3"], ["戦術", "s4"], ["実行", "s5"], ["記録", "s6"], ["評価", "s7"], ["修正", "s8"]];
export function chainHtml(plan, today) {
  const cur = today ? nowMs(plan, today) : null, m = cur == null ? null : plan.ms[cur];
  const n = today ? weekNo(plan, today) : 0, w = plan.wk && plan.wk[n];
  const done = [!!plan.ideal, plan.kgi.length > 0, plan.ms.length > 0, !!(m && m.resDone && m.hypDone && m.kpi.length),
    !!(m && (m.kpi.some((k) => k.v > 0) || m.tasks.some((t) => t.d))), !!(w && Object.values(w.used || {}).some((h) => h > 0)), !!(w && w.reason), !!(w && w.next)];
  const here = done.indexOf(false);
  return STEPS.map(([n, id], i) => {
    const g = i < 3 ? 1 : i < 6 ? 2 : 3;
    if (!id) return `<span class="gk-ci g${g} soon"><span class="gk-cn"><b>${i + 1}</b></span>${n}<span class="st">準備中</span></span>`;
    return `<a href="#goals" data-to="${id}" class="gk-ci g${g} ${done[i] ? "" : "todo"} ${i === here ? "here" : ""}"><span class="gk-cn"><b>${i + 1}</b></span>${n}<span class="st">${done[i] ? "できた" : i === here ? "次はここ" : "まだ"}</span></a>`;
  }).join("") + `<div class="gk-loop"><span>⑧ 修正は ④ 戦術へ戻る</span></div>`;
}
export function weekInfo(plan, n, now) {
  const x = place(plan).w[n], st = weekState(plan, n, now), d = weekDate(plan, n), e = new Date(d.getTime() + 6 * D);
  const sub = `${monthWeek(plan, n)}（${md(d)}〜${md(e)}）`;
  if (!Array.isArray(x)) return { n, st, sub, title: x === "spare" ? "予備の週" : "まだ状態がありません", i: null };
  const [i, k] = x, m = plan.ms[i];
  return { n, st, sub, i, k, title: `状態 ${i + 1}${k > 0 ? `（続き ${k + 1} 週目）` : ""}：${m.n || "（まだ書いていません）"}`, p: msProgress(m), kpi: m.kpi };
}
function roadHtml(plan, now, big) {
  return Array.from({ length: WEEKS }, (_, i) => {
    const n = i + 1, f = weekInfo(plan, n, now), st = f.st;
    const mini = f.i != null ? (f.p == null ? `<span class="mini"></span>` : `<span class="mini"><i style="width:${Math.round(f.p * 100)}%"></i></span>`) : `<span class="mini sp">${st === "spare" ? "予" : ""}</span>`;
    return big ? `<button type="button" class="c big st-${st === "cont" ? "late" : st} ${n === now ? "now" : ""}" data-wk="${n}" aria-label="第${n}週 ${esc(f.title)}"><span class="no">${n}</span>${mini}</button>`
      : `<span class="c st-${st === "cont" ? "late" : st} ${n === now ? "now" : ""}" title="第${n}週 ${esc(f.title)}">${st === "spare" ? "予" : n}</span>`;
  }).join("");
}
const monthsHtml = (plan) => Array.from({ length: WEEKS }, (_, i) => { const d = weekDate(plan, i + 1); return `<span>${i === 0 || d.getUTCDate() <= 7 ? `${d.getUTCMonth() + 1}月` : ""}</span>`; }).join("");

function budgetHtml(plan) {
  const row = (b, i) => `<div class="gk-bro"><i style="background:${b.c}"></i>${ed(`bud.${i}.n`, b.n, "項目の名前")}<span class="hs"><button type="button" data-bh="${i}" data-d="-1" aria-label="${esc(b.n)}を 1 時間減らす">−</button><b>${b.h}h</b><button type="button" data-bh="${i}" data-d="1" aria-label="${esc(b.n)}を 1 時間増やす">＋</button></span><button class="mv" type="button" data-bmv="${i}" aria-label="${b.g ? "生活の時間へ移す" : "目標に使う時間へ移す"}" title="${b.g ? "生活の時間へ移す" : "目標に使う時間へ移す"}">${b.g ? "←" : "→"}</button><button class="gk-x" type="button" data-del="bud.${i}" aria-label="${esc(b.n)}を消す">×</button></div>`;
  const sum = budSum(plan), free = 168 - sum, life = sum - goalHours(plan);
  return `<div class="gk-bud2"><div class="gk-numh">リソース予算　1 週間は 168 時間</div>
    <div class="gk-budbar" aria-hidden="true">${plan.bud.filter((b) => !b.g).concat(plan.bud.filter((b) => b.g)).map((b) => `<i style="flex:${b.h};background:${b.c}"></i>`).join("")}${free > 0 ? `<i style="flex:${free};background:#e8e8ee"></i>` : ""}</div>
    <div class="gk-budcols">
      <div class="gk-budcol"><h4>生活の時間<b>${life}h</b></h4>${plan.bud.map((b, i) => (b.g ? "" : row(b, i))).join("")}</div>
      <div class="gk-budcol goal"><h4>目標に使う時間<b>${goalHours(plan)}h</b></h4>${plan.bud.map((b, i) => (b.g ? row(b, i) : "")).join("")}<p class="note" style="margin:6px 0 0;font-size:11.5px">この時間が、④ 戦術でやることを組むときの上限になります</p></div>
    </div>
    <div class="gk-budsum"><span>合計 <b class="${free < 0 ? "over" : ""}">${sum}</b> / 168 時間　${free < 0 ? `<b class="over">${-free} 時間オーバー</b>` : free > 0 ? `空き ${free} 時間` : "ぴったり"}</span>${plan.bud.length < 12 ? `<button class="gk-mini-add" type="button" data-add="bud">＋ 項目を足す</button>` : ""}</div></div>`;
}

export function planHtml(plan, today) {
  const now = weekNo(plan, today), { w, over } = place(plan);
  const kgi = plan.kgi.map((k, i) => `<div class="gk-bar kgi">${ed(`kgi.${i}.n`, k.n, "数字の名前")}<div class="tr"><i style="width:${kp(k) * 100}%"></i><span class="pace" style="left:${Math.min(1, now / WEEKS) * 100}%"></span></div><span class="v">${ed(`kgi.${i}.v`, fmt(k.v), "今")}<small> / </small>${ed(`kgi.${i}.to`, fmt(k.to), "目標")}${ed(`kgi.${i}.u`, k.u, "単位", "u")}</span><button class="gk-x" type="button" data-del="kgi.${i}" aria-label="${esc(k.n)}を消す">×</button></div>`).join("");
  const rows = plan.ms.map((m, i) => {
    const n = w.findIndex((x) => Array.isArray(x) && x[0] === i && x[1] === 0);
    const st = n > 0 ? weekState(plan, n, now) : "empty", c = ST_COLOR[st], p = msProgress(m), ext = plan.ext[i] || 0;
    return `<li style="--c:${c}" class="gk-msrow ${st === "now" ? "now" : ""}"><div class="gk-msgo">
      <span class="wk">${n > 0 ? `第 ${n} 週・${monthWeek(plan, n)}` : "週が足りません"}${ext ? `<span class="cont">＋${ext}週</span>` : ""}</span>
      ${ed(`ms.${i}.n`, m.n, "どんな状態になっているか", "nm")}
      <span class="pp">${p == null ? `<span class="note" style="margin:0;font-size:11px">KPI は ④ で決めます</span>` : `<span class="tr"><i style="width:${Math.round(p * 100)}%;background:${c}"></i></span>${Math.round(p * 100)}%`}</span>
      <span class="stt" style="color:${c}">${ST_LABEL[st]}</span>
      <button class="gk-go" type="button" data-ms="${i}">${m.resDone && m.hypDone && m.kpi.length ? "戦術を見る" : "戦術を考える"} →</button>
      <button class="gk-x" type="button" data-del="ms.${i}" aria-label="状態 ${i + 1} を消す">×</button></div></li>`;
  }).join("");
  return `
  <div class="gk-step g1" id="s1">${head(1, "理想", "1 年後、どうなっていたいか")}
    <div class="gk-ideal"><span class="l">${ed("idealWhen", plan.idealWhen, "いつまでに（例：2027年10月）")} の自分</span><p>${ed("ideal", plan.ideal, "どうなっていたいか（例：X で集客して、自分の講座で月 30 万円が売れている）")}</p></div></div>
  <div class="gk-link">↓ 理想のために、次の 3 か月で届く数字と使える時間</div>
  <div class="gk-step g1" id="s2">${head(2, "条件", "KGI＝13 週で目指す数字（3 つまで）。面談で現実的に決めます")}
    ${kgi ? `<div class="gk-bars">${kgi}</div>` : `<p class="note" style="margin:0">まだありません。例：フォロワー 1,000 人</p>`}
    ${plan.kgi.length < 3 ? `<button class="gk-add" type="button" data-add="kgi">＋ KGI を足す</button>` : `<p class="note" style="margin:0">KGI は 3 つまでです</p>`}
    ${budgetHtml(plan)}</div>
  <div class="gk-link">↓ KGI に届いた姿が、13 週の目標になる</div>
  <div class="gk-step g1" id="s3">${head(3, "戦略", "13 週の目標を、1 週ずつの状態に分ける")}
    <div class="gk-goal13"><span class="l">13 週の目標（${monthWeek(plan, 1)}〜${monthWeek(plan, WEEKS)}）${plan.goal13Own ? "" : `　<span class="gk-from">② KGI から自動</span>`}</span><p>${ed("goal13", goal13Text(plan), "13 週後にどうなっているか")}<span class="st"> 状態</span></p>
      <label class="gk-start">始めた週の月曜 <input type="date" data-start value="${esc(plan.start)}"></label></div>
    <div class="gk-strat"><span class="l">戦略のひとこと</span>${ed("strat", plan.strat, "どうやって届くか（例：引用ポストで知ってもらい、記事で信頼してもらう）")}</div>
    <div class="gk-overview"><div class="gk-sh" style="margin-bottom:6px"><h3 style="font-size:14px">4 半期の全体像</h3><span class="sp note" style="margin:0">${now < 1 ? "まだ始まっていません" : now > WEEKS ? "13 週が終わりました" : `第 ${now} 週（${monthWeek(plan, now)}）／13 週`}　マスに乗せると中身、押すとその状態の戦術</span></div>
      <div class="gk-road">${roadHtml(plan, now, true)}</div><div class="gk-mo">${monthsHtml(plan)}</div>
      <div class="gk-legend"><span style="--c:#15803d">達成</span><span style="--c:#d97706">未達・続ける</span><span style="--c:#4644c7">今週</span><span style="--c:#e4e4f7">これから</span><span style="--c:#d4d4dc">予備</span></div>
      <div class="gk-pop" id="gk-pop" role="tooltip" hidden></div></div>
    ${over > 0 ? `<p class="msg err" style="margin:0">週が ${over} つ足りません。予備を減らすか、状態をまとめてください</p>` : ""}
    <div class="gk-sh"><h3 style="font-size:14px">マイルストーン（状態 ${plan.ms.length} 個・予備 ${plan.spare.length} 週）</h3></div>
    ${rows ? `<ul class="gk-mlist">${rows}</ul>` : `<p class="note" style="margin:0">まだありません。1 週で届く「状態」を 10 個ほど並べます。例：毎日投稿の仕組みができている</p>`}
    ${plan.ms.length < 13 ? `<button class="gk-add" type="button" data-add="ms">＋ 状態を足す（空いている週へ自動で並びます）</button>` : ""}
    <p class="note" style="margin:0">最初の数週は「型が決まっている」のような、やり方を見つける状態から置くと進めやすくなります。各状態の KPI とやることは「戦術を考える」から決めます</p></div>`;
}
export function popHtml(plan, n, now) {
  const f = weekInfo(plan, n, now);
  return `<div class="t">第 ${f.n} 週・${esc(f.sub)}</div><div class="h">${esc(f.title)}</div>`
    + (f.kpi ? f.kpi.map((k) => `<div class="r"><span>${esc(k.n)}</span><b>${fmt(k.v)} / ${fmt(k.to)}${esc(k.u)}</b></div>`).join("") : "")
    + (f.p != null && f.i != null ? `<div class="r"><span>進み</span><b>${Math.round(f.p * 100)}%</b></div>` : "")
    + (f.i != null ? `<button type="button" class="gk-mini-add" data-ms="${f.i}">この状態の戦術を開く →</button>` : "")
    + (f.n > now ? `<button type="button" class="gk-mini-add" data-spare="${f.n}">${f.st === "spare" ? "予備をやめる" : "この週を予備にする"}</button>` : "");
}

// ④ 戦術を考える（状態ごと）：リサーチした → 仮説を作った → この週の KPI → やること（いつ・何時間）
export function tacHtml(plan, today, sel) {
  const cur = nowMs(plan, today), i = sel != null && plan.ms[sel] ? sel : cur != null ? cur : plan.ms.length ? 0 : null;
  if (i == null) return `<div class="gk-step g2" id="s4">${head(4, "戦術を考える", "先に ③ で状態を 1 つ以上置きます")}<button class="gk-add" type="button" data-gv="plan">③ 戦略へ</button></div>`;
  const m = plan.ms[i], n = msWeek(plan, i), hrs = tasksHours(m), cap = goalHours(plan);
  const opts = plan.ms.map((mm, j) => `<option value="${j}" ${j === i ? "selected" : ""}>状態 ${j + 1}：${esc(mm.n || "（まだ書いていません）")}${j === cur ? "（今週）" : ""}</option>`).join("");
  const kpi = m.kpi.map((k, j) => `<div class="gk-kpid"><input class="gk-in" data-kf="${i}.${j}.n" value="${esc(k.n)}" placeholder="数字の名前（例：X 記事）" aria-label="KPI ${j + 1} の名前" maxlength="30"><input class="gk-in num" data-kf="${i}.${j}.to" value="${k.to ? fmt(k.to) : ""}" inputmode="numeric" placeholder="目標" aria-label="KPI ${j + 1} の目標"><input class="gk-in unit" data-kf="${i}.${j}.u" value="${esc(k.u)}" placeholder="単位" aria-label="KPI ${j + 1} の単位" maxlength="10"><button class="gk-x" type="button" data-del="ms.${i}.kpi.${j}" aria-label="KPI ${j + 1} を消す">×</button></div>`).join("");
  const tasks = m.tasks.map((t, j) => `<li><span class="tt">${ed(`ms.${i}.tasks.${j}.t`, t.t, "やること")}<span class="wh">いつ：${ed(`ms.${i}.tasks.${j}.when`, t.when, "例：火曜の朝")}${t.from ? "　⑧ 先週の修正から" : ""}</span></span><span class="hr">${ed(`ms.${i}.tasks.${j}.hr`, String(t.hr || 0), "0")}h</span><button class="gk-x" type="button" data-del="ms.${i}.tasks.${j}" aria-label="やること ${j + 1} を消す">×</button></li>`).join("");
  return `<div class="gk-step g2" id="s4">${head(4, "戦術を考える", "調べて、仮説を立てて、この週の KPI とやることに落とす")}
    <label class="gk-pick"><span>どの状態の戦術？</span><select data-sel aria-label="戦術を考える状態">${opts}</select></label>
    <div class="gk-goal13 now"><span class="l">${n > 0 ? `第 ${n} 週・${monthWeek(plan, n)}` : "週が足りません"}${i === cur ? "（今週）" : ""}　<span class="gk-from">③ マイルストーンから</span></span><p>${ed(`ms.${i}.n`, m.n, "どんな状態になっているか")}</p></div>
    <div class="gk-sub"><h4><label class="gk-ck"><input type="checkbox" data-mck="${i}.resDone" ${m.resDone ? "checked" : ""}><span class="tag">1</span>リサーチした</label><small>伸びている人・自分のデータなど、自由に</small></h4>
      <textarea class="gk-bul" rows="3" data-mtx="${i}.res" maxlength="2000" placeholder="・調べたこと、気づいたこと" aria-label="リサーチ">${esc(m.res)}</textarea></div>
    <div class="gk-sub"><h4><label class="gk-ck"><input type="checkbox" data-mck="${i}.hypDone" ${m.hypDone ? "checked" : ""}><span class="tag">2</span>仮説を作った</label><small>「〇〇をすれば、△△になるはず」</small></h4>
      <textarea class="gk-bul" rows="2" data-mtx="${i}.hyp" maxlength="1000" placeholder="・〇〇をすれば、△△になるはず" aria-label="仮説">${esc(m.hyp)}</textarea></div>
    <div class="gk-sub"><h4><span class="tag">3</span>この週の KPI<small>仮説が当たったかを測る数字（5 つまで）</small></h4>
      ${kpi || `<p class="note" style="margin:0">まだありません。例：X 記事 2 本</p>`}${m.kpi.length < 5 ? `<button class="gk-mini-add" type="button" data-addk="${i}">＋ KPI を足す</button>` : ""}</div>
    <div class="gk-sub"><h4><span class="tag">4</span>やること<small>いつ・何時間</small></h4>
      ${tasks ? `<ul class="gk-tac">${tasks}</ul>` : ""}${m.tasks.length < 20 ? `<button class="gk-add" type="button" data-addt="${i}">＋ やることを足す</button>` : ""}
      <div class="gk-cap ${hrs > cap ? "over" : ""}"><span>計画 <b>${hrs} 時間</b> ／ 目標に使える ${cap} 時間（② から）</span><span>${hrs > cap ? `<b class="ov">${hrs - cap} 時間はみ出し</b>` : `残り ${cap - hrs} 時間`}</span><div class="tr"><i style="width:${cap ? Math.min(100, (hrs / cap) * 100) : 0}%"></i></div></div></div>
    <div class="gk-act"><button class="btn ghost" type="button" data-back>← 全体像へ戻る</button></div></div>`;
}

// ---------- 3 便目：⑤ 実行・⑥ 記録・⑦ 評価・⑧ 修正 ----------
export const REASONS = ["時間が取れなかった", "やり方が合わなかった", "予定外の仕事", "体調・気分", "思ったより難しかった", "うまくいった"];
const WK0 = () => ({ used: {}, memo: "", reason: "", why: "", next: "", rmSpare: 0, tryy: "", tryAdded: 0 });
export const weekRec = (plan, n) => (plan.wk && plan.wk[n]) || WK0();
const ensureWeek = (plan, n) => { plan.wk = plan.wk || {}; if (!plan.wk[n]) plan.wk[n] = WK0(); return plan.wk[n]; };
export const msAt = (plan, n) => { const x = place(plan).w[n]; return Array.isArray(x) ? x : null; };
export function usedHours(plan, n) { const w = weekRec(plan, n); return plan.bud.filter((b) => b.g).reduce((a, b) => a + (+w.used[b.n] || 0), 0); }
export function timeRate(plan, n) { const cap = goalHours(plan); return cap ? Math.round((usedHours(plan, n) / cap) * 100) : 0; }
export function actRate(plan, n) {
  const x = msAt(plan, n); if (!x) return null;
  const m = plan.ms[x[0]], parts = m.kpi.map(kp).concat(m.tasks.map((t) => (t.d ? 1 : 0)));
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null;
}
export function verdict(t, a) {
  if (a == null) return ["KPI ややることがまだありません", "④ 戦術で、この週の KPI とやることを決めます"];
  const lt = t < 70, la = a < 70;
  return lt && la ? ["時間が取れず、進みも少なかった", "時間の予算が現実的か見直す"] : !lt && la ? ["時間は使えたが、進みが少なかった", "やり方（仮説）を見直す"] : lt ? ["少ない時間で進められた", "この仮説は効いている"] : ["時間も使えて、進みも出た", "このまま次の状態へ"];
}
const weekSel = (plan, today, n) => { const now = Math.min(weekNo(plan, today), WEEKS); return now < 1 ? "" : `<label class="gk-pick"><span>どの週？</span><select data-wsel aria-label="記録する週">${Array.from({ length: now }, (_, i) => now - i).map((k) => `<option value="${k}" ${k === n ? "selected" : ""}>第 ${k} 週（${monthWeek(plan, k)}）${k === now ? "・今週" : ""}</option>`).join("")}</select></label>`; };
const stateLine = (plan, n) => { const x = msAt(plan, n); return x ? `状態 ${x[0] + 1}${x[1] > 0 ? `（続き ${x[1] + 1} 週目）` : ""}：${plan.ms[x[0]].n || "（まだ書いていません）"}` : "予備の週"; };
export function recHtml(plan, today, n) {
  if (weekNo(plan, today) < 1) return `<div class="gk-step g2">${head(5, "実行", "13 週が始まってから記録します")}</div>`;
  const x = msAt(plan, n), m = x ? plan.ms[x[0]] : null, i = x ? x[0] : null, w = weekRec(plan, n);
  const kpi = m && m.kpi.length ? m.kpi.map((k, j) => k.to >= 1000
    ? `<div class="gk-stp"><div class="n">${esc(k.n || "（名前なし）")}<small>目標 ${fmt(k.to)}${esc(k.u)}</small></div><input class="gk-in big" data-kin="${i}.${j}" value="${fmt(k.v)}" inputmode="numeric" aria-label="${esc(k.n)}の今の数"></div>`
    : `<div class="gk-stp"><div class="n">${esc(k.n || "（名前なし）")}<small>目標 ${fmt(k.to)}${esc(k.u)}</small></div><div class="c"><button type="button" data-kv="${i}.${j}" data-d="-1" aria-label="${esc(k.n)}を 1 減らす">−</button><input class="gk-in mid" data-kin="${i}.${j}" value="${fmt(k.v)}" inputmode="numeric" aria-label="${esc(k.n)}の今の数"><button type="button" data-kv="${i}.${j}" data-d="1" aria-label="${esc(k.n)}を 1 足す">＋</button></div></div>`).join("")
    : `<p class="note" style="margin:0">この週の KPI はまだありません。<button class="gk-mini-add" type="button" data-ms="${i ?? ""}">④ 戦術で決める →</button></p>`;
  const tasks = m && m.tasks.length ? `<div class="gk-numh">やることのチェック</div><ul class="gk-tac">${m.tasks.map((t, j) => `<li class="${t.d ? "done" : ""}"><label class="gk-ck"><input type="checkbox" data-td="${i}.${j}" ${t.d ? "checked" : ""}><span>${esc(t.t || "（まだ書いていません）")}</span></label><span class="hr">${t.hr}h${t.when ? "・" + esc(t.when) : ""}</span></li>`).join("")}</ul>` : "";
  const hrs = plan.bud.filter((b) => b.g).map((b) => `<label class="gk-hl">${esc(b.n)}<input class="gk-in hh" data-used="${esc(b.n)}" value="${w.used[b.n] ?? ""}" inputmode="decimal" placeholder="0" aria-label="${esc(b.n)}に使った時間"><small>/ ${b.h}h</small></label>`).join("");
  return `<div class="gk-step g2" id="s5">${head(5, "実行", "今週の KPI の数と、やることのチェック。いつ入れても、まとめて入れても大丈夫")}
    ${weekSel(plan, today, n)}<div class="gk-goal13 now"><span class="l">第 ${n} 週・${monthWeek(plan, n)}</span><p>${esc(stateLine(plan, n))}</p></div>
    ${m ? `<div class="gk-steps">${kpi}</div>${tasks}` : `<p class="note" style="margin:0">予備の週です。遅れを取り戻すか、休む週にします</p>`}</div>
  <div class="gk-step g2" id="s6">${head(6, "記録", "今週、目標に使った時間（だいたいで大丈夫）とメモ")}
    ${hrs ? `<div class="gk-hrs">${hrs}</div>` : `<p class="note" style="margin:0">② リソース予算で「目標に使う時間」を決めると、ここに出ます</p>`}
    <div><span class="gk-numh">メモ</span><span class="gk-opt">書かなくても大丈夫</span><textarea class="gk-bul" rows="2" data-wtx="memo" maxlength="2000" placeholder="・気づいたこと" aria-label="メモ">${esc(w.memo)}</textarea></div>
    <p class="note" style="margin:0">ここで入れた数と時間が、そのまま ⑦ 評価に入ります</p></div>`;
}
export function reportFor(plan, n) {
  const x = msAt(plan, n), m = x ? plan.ms[x[0]] : null, w = weekRec(plan, n), t = timeRate(plan, n), a = actRate(plan, n);
  const d = weekDate(plan, n), e = new Date(d.getTime() + 6 * D);
  const r = { state: stateLine(plan, n), done: m && msDone(m) ? 1 : 0, kpi: m ? m.kpi.map((k) => ({ ...k })) : [], kgi: plan.kgi.map((k) => ({ ...k })), hours: { used: usedHours(plan, n), cap: goalHours(plan) },
    rates: { time: t, act: a ?? 0 }, tasks: { done: m ? m.tasks.filter((k) => k.d).length : 0, all: m ? m.tasks.length : 0 }, reason: w.reason, why: w.why, next: w.next, tryy: w.tryy, memo: w.memo };
  r.text = `【週報】${monthWeek(plan, n)}（${md(d)}〜${md(e)}）第${n}週／13\n今週の状態：${r.state}（${r.done ? "届いた" : "まだ"}）\n時間 ${r.hours.used}/${r.hours.cap}h（${t}%）・行動 ${a ?? "―"}%\n`
    + (r.kpi.length ? r.kpi.map((k) => `${k.n} ${fmt(k.v)}/${fmt(k.to)}${k.u}`).join("・") + "\n" : "")
    + `理由：${w.reason || "―"}${w.why ? `（${w.why}）` : ""}\n来週：${w.next === "cont" ? "同じ状態を続ける" : w.next === "go" ? "次の状態へ進む" : "―"}${w.tryy ? `\n変えること：${w.tryy}` : ""}${w.memo.trim() ? `\nメモ：\n${w.memo.trim()}` : ""}`;
  return r;
}
export function reviewHtml(plan, today, n, rv) {
  if (weekNo(plan, today) < 1) return `<div class="gk-step g3">${head(7, "評価", "13 週が始まってから振り返ります")}</div>`;
  const x = msAt(plan, n), m = x ? plan.ms[x[0]] : null, w = weekRec(plan, n), t = timeRate(plan, n), a = actRate(plan, n), [v1, v2] = verdict(t, a);
  const nx = place(plan).w.slice(n + 1).find((y) => Array.isArray(y) && (!x || y[0] !== x[0]));
  const ok = !!(w.reason && w.next);
  const badge = rv ? (rv.approved_at ? `<span class="gk-badge ok">シアニンが承認 ✓</span>` : `<span class="gk-badge sent">提出済み</span>`) : `<span class="gk-badge">まだ出していません</span>`;
  return `<div class="gk-pipe"><div><b>④ 戦術</b>計画 ${m ? tasksHours(m) : 0}h</div><span>＋</span><div><b>⑤⑥ 記録</b>数と時間</div><span>→</span><div class="me"><b>⑦⑧ 週報</b>来週の ④ と ③ へ</div></div>
  <div class="gk-step g3" id="s7">${head(7, "評価", "数は ⑤⑥ から自動で入っています")}
    <div class="gk-sh">${weekSel(plan, today, n)}<span class="sp">${badge}</span></div>
    <div class="gk-auto"><div class="row"><span>今週の状態</span><b>${esc(stateLine(plan, n))}　${m ? (msDone(m) ? "届いた" : "まだ") : ""}</b></div>
      ${m ? m.kpi.map((k) => `<div class="row"><span>${esc(k.n)}</span><b>${fmt(k.v)} / ${fmt(k.to)}${esc(k.u)}</b></div>`).join("") : ""}</div>
    <div class="gk-2ax"><div class="ax"><span>時間の実行率</span><strong>${t}%</strong><span>${usedHours(plan, n)} / ${goalHours(plan)} 時間</span></div><div class="ax"><span>行動の実行率</span><strong>${a ?? "―"}${a == null ? "" : "%"}</strong><span>KPI とやることの平均</span></div></div>
    <div class="gk-verd"><div class="v1">${v1}</div><div class="v2">${v2}</div></div>
    <div><span class="gk-numh">一番の理由は？</span><span class="gk-req">1 つ押す</span><div class="gk-chips" role="group" aria-label="一番の理由">${REASONS.map((r) => `<button type="button" data-rs="${esc(r)}" aria-pressed="${w.reason === r}">${r}</button>`).join("")}</div></div>
    <div><span class="gk-numh">ひとこと</span><span class="gk-opt">書かなくても大丈夫</span><input class="gk-in wide" data-wtx="why" value="${esc(w.why)}" maxlength="200" placeholder="例：記事が下書きで止まった" aria-label="ひとこと"></div></div>
  <div class="gk-link">↓ 来週へつなぐ</div>
  <div class="gk-step g3" id="s8">${head(8, "修正", "来週の進め方を選ぶと、③ ロードマップが自動で直ります")}
    <div class="gk-choice" role="radiogroup" aria-label="来週の進め方">
      <label><input type="radio" name="gk-nx" value="cont" ${w.next === "cont" ? "checked" : ""} ${m ? "" : "disabled"}><span>同じ状態を、来週も続ける${m && !msDone(m) ? "（おすすめ）" : ""}<small>${m ? `第 ${n + 1} 週も「${esc(m.n || "この状態")}」。予備の週を 1 つ使います` : "予備の週は続けられません"}</small></span></label>
      <label><input type="radio" name="gk-nx" value="go" ${w.next === "go" ? "checked" : ""}><span>次の状態へ進む${m && msDone(m) ? "（おすすめ）" : ""}<small>来週は「${nx ? esc(plan.ms[nx[0]].n || "次の状態") : "―"}」</small></span></label>
    </div>
    <div><span class="gk-numh">来週変えること</span><span class="gk-opt">書くと、出したときに来週の ④ やることに入ります</span><input class="gk-in wide" data-wtx="tryy" value="${esc(w.tryy)}" maxlength="200" placeholder="例：記事は火曜と金曜の朝に 45 分だけ取る" aria-label="来週変えること"></div></div>
  <div class="gk-act"><button class="btn ghost" type="button" data-copy>コピー</button><button class="btn" type="button" data-submit ${ok ? "" : "disabled"}>${rv ? "出し直す" : "週報を出す"}</button></div>
  <p class="note gk-hint">${ok ? (rv ? "出し直すと、承認はいったん外れます" : "出すと、シアニンが読んで承認します") : "理由を 1 つと、来週の進め方を選ぶと出せます"}</p>
  ${rv && rv.approved_at && rv.comment ? `<div class="gk-from-box"><span class="l">シアニンから</span><span>${esc(rv.comment)}</span></div>` : ""}`;
}
// ⑧：来週の進め方。前の選び方を戻してから当てる。「続ける」は次の週の予備（無ければ一番うしろの予備）を 1 つ使う
export function applyNext(plan, n, choice) {
  const w = ensureWeek(plan, n), x = msAt(plan, n);
  if (w.next === choice) return false;
  if (w.next === "cont" && x) { plan.ext[x[0]] = Math.max(0, (plan.ext[x[0]] || 0) - 1); if (!plan.ext[x[0]]) delete plan.ext[x[0]]; if (w.rmSpare) plan.spare = [...new Set([...plan.spare, w.rmSpare])].sort((a, b) => a - b); w.rmSpare = 0; }
  if (choice === "cont") {
    if (!x) return false;
    plan.ext[x[0]] = (plan.ext[x[0]] || 0) + 1;
    const later = plan.spare.filter((k) => k > n), rm = later.includes(n + 1) ? n + 1 : later.length ? Math.max(...later) : 0;
    if (rm) { plan.spare = plan.spare.filter((k) => k !== rm); w.rmSpare = rm; }
  }
  w.next = choice; return true;
}
// 記録・振り返りの欄の入力。変えたら true
export function applyWeek(plan, n, t) {
  const ds = t.dataset || {};
  if (ds.kin) { const [i, j] = ds.kin.split("."), k = plan.ms[i] && plan.ms[i].kpi[j]; if (!k) return false; const v = Number(String(t.value).replace(/[^\d.\-]/g, "")) || 0; if (k.v === v) return false; k.v = v; return true; }
  if (ds.kv) { const [i, j] = ds.kv.split("."), k = plan.ms[i] && plan.ms[i].kpi[j]; if (!k) return false; k.v = Math.max(0, (+k.v || 0) + +ds.d); return true; }
  if (ds.td) { const [i, j] = ds.td.split("."), x = plan.ms[i] && plan.ms[i].tasks[j]; if (!x) return false; x.d = t.checked ? 1 : 0; return true; }
  if (ds.used != null) { const w = ensureWeek(plan, n), v = Math.round(Math.min(168, Math.max(0, Number(String(t.value).replace(/[^\d.]/g, "")) || 0)) * 2) / 2; if (w.used[ds.used] === v) return false; w.used[ds.used] = v; return true; }
  if (ds.wtx) { const w = ensureWeek(plan, n); if (w[ds.wtx] === t.value) return false; w[ds.wtx] = t.value; return true; }
  if (ds.rs) { const w = ensureWeek(plan, n); w.reason = w.reason === ds.rs ? "" : ds.rs; return true; }
  return false;
}
// 出したあと：「来週変えること」を次に来る状態（予備の週は飛ばす）のやることに 1 回だけ足す
export function carryTry(plan, n) {
  const w = weekRec(plan, n), x = place(plan).w.slice(n + 1).find((y) => Array.isArray(y));
  if (!w.tryy.trim() || w.tryAdded || !x) return false;
  plan.ms[x[0]].tasks.push({ t: w.tryy.trim(), when: "", hr: 0, d: 0, from: 1 }); ensureWeek(plan, n).tryAdded = 1; return true;
}

// ---------- 4 便目：成長レポート ----------
const ST_FILL = { done: "#15803d", now: "#5e5ce6", next: "#c9c8f3", late: "#d97706", cont: "#d97706", spare: "#c7c7cf", empty: "#d4d4dc" };
function barsSvg(vals, opts) {
  const W = 560, H = 170, p = 28, bw = (W - p * 2) / WEEKS, max = opts.max, y = (v) => H - 22 - (Math.min(v, max) / max) * (H - 40);
  let s = `<svg class="gk-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">`;
  if (opts.line != null) s += `<line x1="${p}" x2="${W - p}" y1="${y(opts.line)}" y2="${y(opts.line)}" stroke="#15803d" stroke-dasharray="4 4"/><text x="${W - p}" y="${y(opts.line) - 4}" font-size="10" text-anchor="end" fill="#15803d">${opts.lineLabel}</text>`;
  vals.forEach((v, i) => {
    const x = p + i * bw + 3, w = bw - 6;
    if (v == null) s += `<rect x="${x}" y="${H - 24}" width="${w}" height="2" fill="currentColor" opacity=".2"/>`;
    else s += `<rect x="${x}" y="${y(v.v)}" width="${w}" height="${Math.max(1, H - 22 - y(v.v))}" rx="4" fill="${v.c}"/><text x="${x + w / 2}" y="${y(v.v) - 4}" font-size="10" text-anchor="middle" fill="currentColor">${v.t ?? v.v}</text>`;
    s += `<text x="${x + w / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".55">${i + 1}</text>`;
  });
  return s + "</svg>";
}
function lineSvg(k, pts, now) {
  const W = 560, H = 160, p = 28, vals = pts.map((q) => q.v).concat([k.to]), lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
  const x = (n) => p + ((n - 1) / (WEEKS - 1)) * (W - p * 2), y = (v) => H - 22 - ((v - lo) / (hi - lo || 1)) * (H - 44);
  let s = `<svg class="gk-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(k.n)}の伸び"><line x1="${p}" x2="${W - p}" y1="${y(k.to)}" y2="${y(k.to)}" stroke="currentColor" opacity=".3" stroke-dasharray="4 4"/><text x="${W - p}" y="${y(k.to) - 5}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">目標 ${fmt(k.to)}${esc(k.u)}</text>`;
  if (pts.length > 1) s += `<polyline fill="none" stroke="#5e5ce6" stroke-width="3" points="${pts.map((q) => `${x(q.n)},${y(q.v)}`).join(" ")}"/>`;
  s += pts.map((q) => `<circle cx="${x(q.n)}" cy="${y(q.v)}" r="4" fill="#5e5ce6"/><text x="${x(q.n)}" y="${y(q.v) - 8}" font-size="10" text-anchor="middle" fill="currentColor">${fmt(q.v)}</text>`).join("");
  for (let n = 1; n <= WEEKS; n++) s += `<text x="${x(n)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity="${n === now ? 1 : 0.5}">${n}</text>`;
  return s + "</svg>";
}
export function growHtml(plan, today, reviews) {
  const now = Math.min(weekNo(plan, today), WEEKS);
  if (now < 1) return `<div class="gk-step">${head("◎", "成長レポート", "13 週が始まると、ここに週ごとの伸びが出ます")}</div>`;
  const rv = (n) => (reviews || []).find((x) => x.week_no === n) || null;
  const act = Array.from({ length: WEEKS }, (_, i) => { const n = i + 1, r = rv(n), v = r && r.rates ? r.rates.act : n === now ? actRate(plan, n) : null; return v == null ? null : { v, c: ST_FILL[weekState(plan, n, now)] || "#c9c8f3" }; });
  const cap = goalHours(plan);
  const tm = Array.from({ length: WEEKS }, (_, i) => { const n = i + 1; if (n > now) return null; const u = usedHours(plan, n); return { v: u, t: `${u}`, c: u >= cap * 0.7 ? "#5e5ce6" : "#9b99e6" }; });
  const sent = Array.from({ length: now }, (_, i) => rv(i + 1)).filter(Boolean).length;
  const reached = plan.ms.filter(msDone).length;
  const acts = act.filter(Boolean).map((a) => a.v), avg = acts.length ? Math.round(acts.reduce((a, b) => a + b, 0) / acts.length) : null;
  const kgi = plan.kgi.map((k) => {
    const pts = [];
    for (let n = 1; n <= now; n++) { const r = rv(n), h = r && Array.isArray(r.kgi) ? r.kgi.find((x) => x.n === k.n) : null; if (h) pts.push({ n, v: +h.v || 0 }); }
    const last = pts.find((q) => q.n === now); if (last) last.v = +k.v || 0; else pts.push({ n: now, v: +k.v || 0 });
    return `<div class="gk-step">${head("◎", `KGI の伸び：${esc(k.n || "（名前なし）")}`, "週報を出した週の値と、いまの値")}${lineSvg(k, pts, now)}</div>`;
  }).join("");
  return `<div class="gk-tiles">
      <div class="gk-tile"><b>${reached}<small> / ${plan.ms.length}</small></b><span>届いた状態</span></div>
      <div class="gk-tile"><b>${sent}<small> / ${now}</small></b><span>週報を出した週</span></div>
      <div class="gk-tile"><b>${avg ?? "―"}<small>${avg == null ? "" : "%"}</small></b><span>行動の実行率（平均）</span></div></div>
    <div class="gk-step">${head("◎", "週ごとの行動の実行率", "色＝その週の状態に届いたか（緑 達成・オレンジ 未達・紫 今週）。線は 85%")}${barsSvg(act, { max: 100, line: 85, lineLabel: "85%", label: "週ごとの行動の実行率" })}</div>
    <div class="gk-step">${head("◎", "週ごとに目標へ使った時間", `② リソース予算の「目標に使う時間」は週 ${cap} 時間（線）`)}${barsSvg(tm, { max: Math.max(cap, ...tm.filter(Boolean).map((t) => t.v), 1), line: cap || null, lineLabel: `${cap}h`, label: "週ごとに目標へ使った時間" })}</div>
    ${kgi}`;
}

// ホームのカード（今週の状態と全体像）
export function homeCardHtml(plan, today) {
  const now = weekNo(plan, today), f = now >= 1 && now <= WEEKS ? weekInfo(plan, now, now) : null;
  const g13 = goal13Text(plan);
  return `<a class="card gk" href="#goals" data-go="goals">
    <div class="gk-hc-top"><span class="l">13 週の目標：${esc(g13 || "まだ書いていません")}</span><p>${f ? `今週（第 ${now} 週）の状態：${esc(f.title.replace(/^状態 \d+(（[^）]*）)?：/, ""))}` : now < 1 ? "13 週はこれから始まります" : "13 週が終わりました。次の 13 週を設計しましょう"}</p></div>
    <div class="gk-hc-body"><div class="gk-road">${roadHtml(plan, now, false)}</div>
      <div class="gk-hc-row" style="font-size:13px">${f && actRate(plan, now) != null ? `<span>今週の行動の実行率 <b>${actRate(plan, now)}%</b></span>` : ""}<span>時間 <b>${usedHours(plan, now)} / ${goalHours(plan)}h</b></span></div>
      <span class="gk-hc-go">目標達成くんを開く →</span></div></a>`;
}

// 直す：path（例 "kgi.0.to"）に値を入れる。数の欄は数にする
export function setPath(plan, path, val) {
  const ks = path.split("."), k = ks.pop(), o = ks.reduce((a, b) => (a == null ? a : a[b]), plan);
  if (o == null) return false;
  if (path === "goal13") { const t = String(val).trim(); if (t === goal13Text(plan)) return false; plan.goal13 = t; plan.goal13Own = t ? 1 : 0; return true; }
  const next = ["v", "to", "h", "hr"].includes(k) ? (Number(String(val).replace(/[^\d.\-]/g, "")) || 0) : String(val).trim();
  if (o[k] === next) return false;
  o[k] = next; return true;
}
const NEW = { kgi: () => ({ n: "", v: 0, to: 0, u: "" }), ms: () => ({ n: "", kpi: [], tasks: [], res: "", hyp: "", resDone: 0, hypDone: 0 }), bud: () => ({ n: "", h: 0, g: 0, c: "#a78bfa" }) };
// 欄の入力（KPI の名前・目標・単位、リサーチ・仮説の文、チェック）。変えたら true。文を書いたらチェックも付ける
export function applyField(plan, t) {
  const ds = t.dataset || {};
  if (ds.kf) { const [i, j, f] = ds.kf.split("."), k = plan.ms[i] && plan.ms[i].kpi[j]; if (!k) return false; const v = f === "to" ? (Number(String(t.value).replace(/[^\d.]/g, "")) || 0) : String(t.value).trim(); if (k[f] === v) return false; k[f] = v; return true; }
  if (ds.mtx) { const [i, f] = ds.mtx.split("."), m = plan.ms[i]; if (!m || m[f] === t.value) return false; m[f] = t.value; if (t.value.trim() && !m[f + "Done"]) m[f + "Done"] = 1; return true; }
  if (ds.mck) { const [i, f] = ds.mck.split("."), m = plan.ms[i]; if (!m) return false; m[f] = t.checked ? 1 : 0; return true; }
  return false;
}
// ボタンを押したときの変更。変えたら true
export function applyAction(plan, d, now) {
  if (d.add && NEW[d.add]) { plan[d.add].push(NEW[d.add]()); return true; }
  if (d.addk != null && plan.ms[d.addk]) { plan.ms[d.addk].kpi.push({ n: "", v: 0, to: 0, u: "" }); return true; }
  if (d.addt != null && plan.ms[d.addt]) { plan.ms[d.addt].tasks.push({ t: "", when: "", hr: 0, d: 0, from: 0 }); return true; }
  if (d.del) {
    const ks = d.del.split("."), i = +ks.pop(), list = ks.reduce((a, b) => a[b], plan); list.splice(i, 1);
    if (ks.length === 1 && ks[0] === "ms") { const ext = {}; for (const [k, v] of Object.entries(plan.ext)) { const n = +k; if (n < i) ext[n] = v; else if (n > i) ext[n - 1] = v; } plan.ext = ext; }
    return true;
  }
  if (d.bh != null) { const b = plan.bud[d.bh]; b.h = Math.max(0, Math.min(168, (+b.h || 0) + +d.d)); return true; }
  if (d.bmv != null) { const b = plan.bud[d.bmv]; b.g = b.g ? 0 : 1; return true; }
  if (d.spare) { const n = +d.spare; if (n <= now) return false; plan.spare = plan.spare.includes(n) ? plan.spare.filter((x) => x !== n) : [...plan.spare, n].sort((a, b) => a - b); return true; }
  return false;
}

// ---------- 6 便目（2026-11-05 Naoki 14:55「OK」）：シアニンと決めた下書き ----------
// done：直前に押したもの（"start"＝始めた・"keep"＝しまった）。押したあとは「元に戻す」の帯だけを出す
export function draftHtml(dr, open, done) {
  if (done) return `<div class="gk-draft done" role="status"><span>${done === "start" ? "下書きで ①理想・②KGI・③13 週を入れて保存しました。② のリソース予算は自分で入れてください" : "下書きはしまいました。今の設計はそのままです"}</span><button class="btn ghost" type="button" data-draft="undo">元に戻す</button></div>`;
  if (!dr) return "";
  const p = { start: dr.start, ms: dr.ms || [], ext: {}, spare: dr.spare || [] }, { w } = place(p);
  const weeks = Array.from({ length: WEEKS }, (_, k) => k + 1).map((n) => {
    const x = w[n], m = Array.isArray(x) ? p.ms[x[0]] : null;
    return x === "spare" ? `<li class="sp"><span>第 ${n} 週<small>${md(weekDate(p, n))}〜</small></span><span>予備の週</span></li>`
      : m ? `<li><span>第 ${n} 週<small>${md(weekDate(p, n))}〜</small></span><span>${esc(m.n)}${m.kpi.length ? `<small>KPI：${m.kpi.map((k) => `${esc(k.n)} ${fmt(k.to)}${esc(k.u)}`).join("・")}</small>` : ""}</span></li>`
      : `<li class="sp"><span>第 ${n} 週<small>${md(weekDate(p, n))}〜</small></span><span>（空き）</span></li>`;
  }).join("");
  const kgi = (dr.kgi || []).map((k) => `${esc(k.n)} ${fmt(k.to)}${esc(k.u)}`).join("・");
  return `<section class="gk-draft" aria-label="シアニンと決めた下書き">
    <h3>シアニンと決めた下書きがあります</h3>
    <p>${dr.source ? esc(dr.source) + "から" : "面談の中身から"}作りました。理想・KGI・13 週の状態が入っています。始めたあとも自由に直せます。</p>
    <div class="gk-draft-act"><button class="btn" type="button" data-draft="start">この設計で始める</button><button class="btn ghost" type="button" data-draft="keep">今のままにする</button><button class="gk-mini-add" type="button" data-draft="open" aria-expanded="${open ? "true" : "false"}">中を見る ${open ? "▲" : "▼"}</button></div>
    ${open ? `<dl class="gk-draft-body"><dt>① 理想</dt><dd>${esc(dr.ideal || "（空）")}${dr.idealWhen ? `（${esc(dr.idealWhen)}）` : ""}</dd><dt>② KGI</dt><dd>${kgi || "（空）"}</dd><dt>③ 13 週</dt><dd>${md(weekDate(p, 1))} から${dr.goal13 ? `・${esc(dr.goal13)}` : ""}<ol class="gk-draft-wk">${weeks}</ol></dd></dl>` : ""}
  </section>`;
}

// 目標達成くん（2026-11-05・Naoki 11:25「OK」）1 便目：8 段の帯と ①理想・②条件（KGI・リソース予算）・③戦略（13 週の目標・全体像・状態）
// 正本はサーバーの b_goal_plans（生徒が書く）。ここは描くのと、直したら保存を頼むだけ。
// 2 便目（2026-11-05 12:29 OK）：④ 戦術（状態ごとのリサーチ・仮説・この週の KPI・やること）。⑤〜⑧ は次の便で開く。
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

const STEPS = [["理想", "s1"], ["条件", "s2"], ["戦略", "s3"], ["戦術", "s4"], ["実行"], ["記録"], ["評価"], ["修正"]];
export function chainHtml(plan, today) {
  const cur = today ? nowMs(plan, today) : null, m = cur == null ? null : plan.ms[cur];
  const done = [!!plan.ideal, plan.kgi.length > 0, plan.ms.length > 0, !!(m && m.resDone && m.hypDone && m.kpi.length)];
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
  const tasks = m.tasks.map((t, j) => `<li><span class="tt">${ed(`ms.${i}.tasks.${j}.t`, t.t, "やること")}<span class="wh">いつ：${ed(`ms.${i}.tasks.${j}.when`, t.when, "例：火曜の朝")}</span></span><span class="hr">${ed(`ms.${i}.tasks.${j}.hr`, String(t.hr || 0), "0")}h</span><button class="gk-x" type="button" data-del="ms.${i}.tasks.${j}" aria-label="やること ${j + 1} を消す">×</button></li>`).join("");
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
// ホームのカード（今週の状態と全体像）
export function homeCardHtml(plan, today) {
  const now = weekNo(plan, today), f = now >= 1 && now <= WEEKS ? weekInfo(plan, now, now) : null;
  const g13 = goal13Text(plan);
  return `<a class="card gk" href="#goals" data-go="goals">
    <div class="gk-hc-top"><span class="l">13 週の目標：${esc(g13 || "まだ書いていません")}</span><p>${f ? `今週（第 ${now} 週）の状態：${esc(f.title.replace(/^状態 \d+(（[^）]*）)?：/, ""))}` : now < 1 ? "13 週はこれから始まります" : "13 週が終わりました。次の 13 週を設計しましょう"}</p></div>
    <div class="gk-hc-body"><div class="gk-road">${roadHtml(plan, now, false)}</div>
      <div class="gk-hc-row" style="font-size:13px">${f && f.p != null ? `<span>今週の状態の進み <b>${Math.round(f.p * 100)}%</b></span>` : ""}<span>目標に使える時間 <b>${goalHours(plan)}h</b>／週</span></div>
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

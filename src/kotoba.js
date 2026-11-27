// デザインの指示集（仮の名前）便 1（2026-11-27 Naoki OK）：公式サイト（lp.shia2n.jp/design-feedback）の画面
// 中身（指示 40 枚・場面 5 つ・見本）は kotoba-data.js。この画面は中身をそのまま HTML にして返し、
// 動き（kotobaClient）はコピーと切り替えだけを持つ。コピーできるかは /api/p/kotoba/me で聞く
import { KOTOBA_VIEWS, KOTOBA_RULES, KOTOBA_SCENES, KOTOBA_SAMPLE, kotobaMock } from "./kotoba-data.js";

export const KOTOBA_PATH = "/design-feedback"; // 2026-11-27 Naoki「デザインフィードバックとかじゃない？」で /kotoba から変えた
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rule = (n) => KOTOBA_RULES.find((r) => r[0] === n);

// コピーする文の組み立て（画面の動きと試験の両方で使う）
export function kotobaCopyText(kind, id, lang = "ja") {
  const en = lang === "en";
  if (kind === "rule") { const r = rule(Number(id)); return r ? (en ? r[6] : r[5]) : ""; }
  if (kind === "scene") {
    const sc = KOTOBA_SCENES.find((x) => x.id === id);
    if (!sc) return "";
    const lines = sc.rules.map((n, i) => `${i + 1}. ${en ? rule(n)[6] : rule(n)[5]}`);
    return en ? `Please revise this ${sc.name} design with the following points:\n${lines.join("\n")}` : `この${sc.name}を、次の点で直してください。\n${lines.join("\n")}`;
  }
  if (kind === "sample") {
    const lines = KOTOBA_SAMPLE.picks.map((p, i) => `${i + 1}. ${en ? rule(p.id)[6] : `${p.where}：${rule(p.id)[5]}`}`);
    return en ? `Please revise this diagram with the following points:\n${lines.join("\n")}` : `この図解を、次の点で直してください。\n${lines.join("\n")}`;
  }
  if (kind === "change") {
    const c = KOTOBA_SAMPLE.changes[Number(id)];
    return c ? `${c.title}にしてください。\n${c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "";
  }
  return "";
}

// 見本の画像（直す前の図解）。デモの canvas の絵を同じ形の SVG にしたもの
function sampleSvg() {
  const r = (c, x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  let b = r("#fff", 0, 0, 640, 640) + r("#ff4d6d", 0, 0, 640, 70);
  b += `<text x="20" y="48" font-size="34" font-weight="700" fill="#fff" font-family="sans-serif">知らないと損する副業のコツ</text>`;
  b += r("#3a86ff", 20, 90, 260, 200);
  for (let i = 0; i < 9; i++) b += r("#9a9a9a", 300, 96 + i * 22, 300 - (i % 3) * 30, 10);
  for (let i = 0; i < 4; i++) b += r("#9a9a9a", 20, 310 + i * 24, 600 - (i % 2) * 80, 10);
  b += `<circle cx="70" cy="500" r="40" fill="#ffd60a"/><circle cx="170" cy="500" r="40" fill="#06d6a0"/>` + r("#8338ec", 240, 460, 380, 80);
  b += `<text x="290" y="512" font-size="30" font-weight="700" fill="#fff" font-family="sans-serif">今すぐチェック！！</text>`;
  return `<svg viewBox="0 0 640 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="見本の図解：赤い帯の見出し、青い四角、灰色の文字の行が13本、黄と緑の丸、紫のボタン">${b}</svg>`;
}

const copyBtn = (kind, id, label = "指示をコピー") => `<button type="button" class="cp" data-copy="${kind}" data-id="${esc(id)}">${esc(label)}</button>`;

function ruleCard(r) {
  const [n, view, sym, term, why, ja, en, mk] = r;
  const pic = mk ? `<div class="ba"><figure><figcaption>直す前</figcaption>${kotobaMock(mk, false)}</figure><figure><figcaption>直した後</figcaption>${kotobaMock(mk, true)}</figure></div>` : "";
  return `<article class="card" id="r-${n}" data-view="${esc(view)}"><p class="vl">${esc(view)}</p><h3>「${esc(sym)}」</h3>
<p class="term">デザイナーの言葉：<b>${esc(term)}</b></p><p class="why">${esc(why)}</p>${pic}
<p class="fix" lang="ja">${esc(ja)}</p><p class="fix" lang="en" hidden>${esc(en)}</p>${copyBtn("rule", n)}</article>`;
}

function sceneTabs() {
  const tabs = KOTOBA_SCENES.map((s, i) => `<button type="button" role="tab" id="t-${s.id}" aria-controls="p-${s.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(s.name)}<small>${esc(s.sub)}</small></button>`).join("");
  const panels = KOTOBA_SCENES.map((s, i) => `<div role="tabpanel" id="p-${s.id}" aria-labelledby="t-${s.id}" class="sp"${i === 0 ? "" : " hidden"}>
<h3>${esc(s.name)}でまず押さえること</h3><ul class="pre">${s.pre.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
<h3>よく使う直しの指示</h3><ol class="sr6">${s.rules.map((n) => { const r = rule(n); return `<li><a href="#r-${n}">「${esc(r[2])}」</a><span>${esc(r[3])}</span></li>`; }).join("")}</ol>
<h3>よくある失敗</h3><ul class="ng">${s.ng.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
${copyBtn("scene", s.id, `${s.name}の基本をまとめてコピー`)}</div>`).join("");
  return `<div role="tablist" aria-label="場面" class="tabs">${tabs}</div>${panels}`;
}

function sampleBlock() {
  const S = KOTOBA_SAMPLE;
  const picks = S.picks.map((p) => { const r = rule(p.id); return `<details><summary><b>${esc(r[3])}</b><span>${esc(p.where)}</span></summary><p>${esc(p.reason)}</p><p class="fix" lang="ja">${esc(r[5])}</p><p class="fix" lang="en" hidden>${esc(r[6])}</p><p><a class="tl" href="#r-${r[0]}">指示のカードを見る</a></p></details>`; }).join("");
  const ch = S.changes.map((c, i) => `<details><summary><b>${String.fromCharCode(65 + i)}　${esc(c.title)}</b></summary><p>${esc(c.why)}</p><ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${copyBtn("change", i, "この変え方をコピー")}</details>`).join("");
  return `<div class="smp"><figure class="smp-img">${sampleSvg()}<figcaption>見本の画像（図解）</figcaption></figure>
<div class="smp-r"><p class="good"><b>よい所</b>　${esc(S.good)}</p>
<h3>直すとよくなる所（${S.picks.length}つ）</h3>${picks}
<div class="all1"><p>まとめた指示（そのまま AI に貼れます）</p>${copyBtn("sample", "all", "まとめた指示をコピー")}</div>
<h3>変えるなら</h3>${ch}
<p class="soon">自分の画像を入れて見立てる機能は、準備中です。</p></div></div>`;
}

export function kotobaPageHtml({ siteName = "シアニン", join = "/xmas-gift" } = {}) {
  const views = `<div class="flt" role="group" aria-label="見るところで絞る"><button type="button" data-view="" aria-pressed="true">すべて</button>${KOTOBA_VIEWS.map((v) => `<button type="button" data-view="${esc(v)}" aria-pressed="false">${esc(v)}</button>`).join("")}</div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIに伝わるデザインの直し方｜${esc(siteName)}</title>
<meta name="description" content="気になる所から、デザイナーが使う言葉と、AI にそのまま貼れる直しの指示が見つかります。画像ポスト・サムネ・図解・LP・スライドの場面ごとの基本つき。">
<link rel="canonical" href="https://lp.shia2n.jp${KOTOBA_PATH}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kurenaido&display=swap">
<style>${KOTOBA_CSS}</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><filter id="f-sh"><feDropShadow dx="1.5" dy="1.5" stdDeviation=".4" flood-color="#000" flood-opacity=".7"/></filter><linearGradient id="g-rain" x1="0" x2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".5" stop-color="#ffd60a"/><stop offset="1" stop-color="#3a86ff"/></linearGradient></defs></svg>
<a class="skip" href="#main">本文へ移動</a>
<header class="sh"><div><a class="logo" href="/">${esc(siteName)}</a><nav aria-label="サイトの案内"><a href="/#start">はじめての方へ</a><a href="/gift">会員限定コンテンツ</a><a href="${KOTOBA_PATH}" aria-current="page">デザインフィードバック</a><a href="/chat">チャット</a><a href="/blog">記事一覧</a></nav>
<div data-lab-part="account"></div></div></header>
<main id="main" tabindex="-1" class="kw">
<section class="hero"><p class="hand" aria-hidden="true">ノンデザイナーのための</p><h1>AIに伝わる、デザインの直し方</h1>
<p>気になる所から、デザイナーが使う言葉と、AI にそのまま貼れる直しの指示が見つかります。参考の作品をまねずに、良さだけを借りる考え方で作っています。</p>
<p class="jump"><a href="#sample">見本の見立てを見る</a><a href="#scenes">場面で選ぶ</a><a href="#all">気になる所から探す</a></p>
<p class="gate-note" id="gate-note">指示のコピーは無料会員の方がご利用いただけます。<a href="${esc(join)}">無料会員登録</a>　<a href="/login?next=${encodeURIComponent(KOTOBA_PATH)}">ログイン</a></p></section>
<div class="lang" role="group" aria-label="コピーする言葉"><span>コピーする言葉</span><button type="button" data-lang="ja" aria-pressed="true">日本語</button><button type="button" data-lang="en" aria-pressed="false">英語</button></div>
<section id="sample" aria-labelledby="h-sample"><h2 id="h-sample">見本：この図解を見立てると</h2>${sampleBlock()}</section>
<section id="scenes" aria-labelledby="h-scenes"><h2 id="h-scenes">場面で選ぶ</h2>${sceneTabs()}</section>
<section id="all" aria-labelledby="h-all"><h2 id="h-all">気になる所から探す（${KOTOBA_RULES.length}枚）</h2>${views}<div class="cards">${KOTOBA_RULES.map(ruleCard).join("")}</div></section>
<p class="disc">この画面の指示は、見た目を直すための一般的な考え方です。参考にした作品と似ていないか、法的に問題がないかの判断はしません。</p>
</main>
<dialog id="d-gate" aria-labelledby="d-gate-h"><h2 id="d-gate-h">コピーは無料会員の方がご利用いただけます</h2><p>メールアドレスだけで登録できます。登録すると、40枚の指示と場面ごとのまとめを何度でもコピーできます。</p>
<p class="d-btns"><a class="go" href="${esc(join)}">無料会員登録</a><a class="sub" href="/login?next=${encodeURIComponent(KOTOBA_PATH)}">登録済みの方はログイン</a></p><form method="dialog"><button class="x">閉じる</button></form></dialog>
<div id="live" class="sr" role="status" aria-live="polite"></div>
<footer class="bf"><div><span style="font-weight:700;color:#1a1a1a">${esc(siteName)}</span><a href="https://lab.shia2n.jp/legal/terms">利用規約</a><a href="https://lab.shia2n.jp/legal/privacy">プライバシーポリシー</a><a href="https://lab.shia2n.jp/legal/tokushoho">特定商取引法に基づく表記</a><span>© 株式会社Best Life Consulting</span></div></footer>
<script src="/_lab/embed.js" defer data-kind="site"></script>
<script>var __name=window.__name||function(f){return f};(${kotobaClient.toString()})(${JSON.stringify({ rules: KOTOBA_RULES.map((r) => [r[0], r[5], r[6]]), scenes: KOTOBA_SCENES.map((s) => [s.id, s.name, s.rules]), sample: { picks: KOTOBA_SAMPLE.picks.map((p) => [p.id, p.where]), changes: KOTOBA_SAMPLE.changes.map((c) => [c.title, c.steps]) } }).replace(/</g, "\\u003c")});</script>
</body></html>`;
}

const KOTOBA_CSS = `[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:#fcfbf8;color:#1a1a1a;font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8;font-size:16px}
a{color:#1a1a1a}:focus-visible{outline:3px solid #1a1a1a;outline-offset:3px}@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}html{scroll-behavior:smooth}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:8px;top:-60px;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;z-index:30}.skip:focus{top:8px}
.sh{border-bottom:1px solid #d9d6cf}.sh>div{max-width:1360px;margin:0 auto;padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:16px 32px}
.sh .logo{font-weight:700;font-size:24px;letter-spacing:.04em;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.sh nav{display:flex;flex-wrap:wrap;gap:8px 24px;flex:1 1 auto}.sh nav a{padding:8px 0;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.sh nav a[aria-current=page]{font-weight:700;text-decoration:underline;text-underline-offset:6px}
.kw{max-width:1120px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:40px;line-height:1.4;margin:0 0 16px}h2{font-size:28px;line-height:1.4;margin:64px 0 24px}h3{font-size:18px;line-height:1.5;margin:24px 0 8px}
.hand{margin:0;font-family:"Zen Kurenaido","Noto Sans JP",sans-serif;font-size:24px;color:#c8102e;transform:rotate(-2deg);display:inline-block}
.hero p{max-width:720px}.jump{display:flex;flex-wrap:wrap;gap:8px 24px}.jump a{min-height:44px;display:inline-flex;align-items:center;font-weight:700}
.gate-note{font-size:14px;color:#555}.gate-note a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px}
.lang{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;background:#fcfbf8;border-bottom:1px solid #d9d6cf}.lang span{font-size:14px;font-weight:700;margin-right:8px}
button{font:inherit;color:#1a1a1a;cursor:pointer}
.lang button,.flt button{min-height:44px;padding:0 16px;border:1px solid #8a867d;border-radius:8px;background:#fff}.lang button[aria-pressed=true],.flt button[aria-pressed=true]{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
.cp{min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font-weight:700;margin-top:8px}
.fix{background:#f3f1eb;border-left:4px solid #c8102e;padding:12px 16px;margin:8px 0;border-radius:0 8px 8px 0}
.smp{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start}.smp-img{flex:1 1 280px;margin:0;position:sticky;top:72px}.smp-img svg{width:100%;height:auto;border:1px solid #d9d6cf;border-radius:8px;display:block}.smp-img figcaption{font-size:14px;color:#555;margin-top:8px}
.smp-r{flex:999 1 420px;min-width:0}.good{background:#fff;border:1px solid #d9d6cf;border-radius:8px;padding:16px}
details{border:1px solid #d9d6cf;border-radius:8px;background:#fff;margin:8px 0}summary{min-height:52px;padding:12px 16px;cursor:pointer;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}summary span{font-size:14px;color:#555}details>*:not(summary){margin-left:16px;margin-right:16px}details>:last-child{margin-bottom:16px}
.all1{border:2px solid #1a1a1a;border-radius:8px;padding:16px;margin:24px 0;background:#fff}.all1 p{margin:0;font-weight:700}
.soon{font-size:14px;color:#555}.tl{display:inline-flex;min-height:44px;align-items:center}
.tabs{display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid #d9d6cf}.tabs button{min-height:56px;padding:8px 16px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:none;display:flex;flex-direction:column;align-items:flex-start;line-height:1.4}.tabs button small{font-size:14px;color:#555}
.tabs button[aria-selected=true]{background:#fff;border-color:#d9d6cf;font-weight:700;margin-bottom:-1px}
.sp{background:#fff;border:1px solid #d9d6cf;border-top:0;border-radius:0 0 8px 8px;padding:8px 24px 24px}.sp ul,.sp ol{padding-left:24px;margin:0}
.sr6 li{margin:4px 0}.sr6 a{display:inline-flex;min-height:44px;align-items:center;margin-right:12px}.sr6 span{font-size:14px;color:#555}.ng li::marker{content:"× ";color:#c8102e}
.flt{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{background:#fff;border:1px solid #d9d6cf;border-radius:8px;padding:24px;display:flex;flex-direction:column;scroll-margin-top:72px}.card h3{margin:0 0 8px}.card .vl{margin:0;font-size:14px;color:#555}.card .term{margin:0}.card .why{margin:4px 0 0;font-size:14px;color:#555}.card .cp{align-self:flex-start;margin-top:auto}.card .fix{margin-bottom:16px}
.ba{display:flex;gap:8px;margin:12px 0 0}.ba figure{flex:1 1 0;margin:0}.ba figcaption{font-size:14px;color:#555}.ba svg{width:100%;height:auto;border:1px solid #d9d6cf;border-radius:4px;display:block}
.disc{margin-top:48px;font-size:14px;color:#555}
dialog{border:0;border-radius:8px;padding:32px;max-width:520px;width:calc(100% - 32px)}dialog::backdrop{background:rgba(26,26,26,.5)}dialog h2{margin:0 0 8px;font-size:22px}
.d-btns{display:flex;flex-wrap:wrap;gap:16px;align-items:center}.go{display:inline-flex;align-items:center;min-height:52px;padding:0 32px;background:#c8102e;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}.sub{min-height:44px;display:inline-flex;align-items:center}
.x{min-height:44px;padding:0 16px;border:1px solid #8a867d;border-radius:8px;background:#fff;margin-top:8px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:12px 24px;border-radius:8px;z-index:40;max-width:calc(100% - 32px)}
.bf{border-top:1px solid #d9d6cf}.bf>div{max-width:1360px;margin:0 auto;padding:24px;display:flex;flex-wrap:wrap;align-items:center;gap:0 24px;font-size:14px;color:#555}.bf a{color:#555;padding:12px 0}.bf span:last-child{margin-left:auto}
@media (max-width:600px){.tabs{flex-wrap:nowrap;overflow-x:auto}.tabs button{flex:none}h1{font-size:28px}h2{font-size:22px;margin-top:48px}.kw{padding:24px 16px 48px}.smp-img{position:static}.sp{padding:8px 16px 16px}.card{padding:16px}.cards{grid-template-columns:1fr}}`;

// 画面の動き（ブラウザで動く。外の変数は使わない。中身は引数 D で受ける）
export function kotobaClient(D) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  let lang = "ja", member = false, checked = false;
  const rule = (n) => D.rules.find((r) => r[0] === n);
  function text(kind, id) {
    const en = lang === "en";
    if (kind === "rule") { const r = rule(Number(id)); return r ? r[en ? 2 : 1] : ""; }
    if (kind === "scene") {
      const s = D.scenes.find((x) => x[0] === id); if (!s) return "";
      const lines = s[2].map((n, i) => (i + 1) + ". " + rule(n)[en ? 2 : 1]);
      return (en ? "Please revise this " + s[1] + " design with the following points:\n" : "この" + s[1] + "を、次の点で直してください。\n") + lines.join("\n");
    }
    if (kind === "sample") {
      const lines = D.sample.picks.map((p, i) => (i + 1) + ". " + (en ? rule(p[0])[2] : p[1] + "：" + rule(p[0])[1]));
      return (en ? "Please revise this diagram with the following points:\n" : "この図解を、次の点で直してください。\n") + lines.join("\n");
    }
    if (kind === "change") { const c = D.sample.changes[Number(id)]; return c ? c[0] + "にしてください。\n" + c[1].map((s, i) => (i + 1) + ". " + s).join("\n") : ""; }
    return "";
  }
  function say(m) {
    const l = $("#live"); l.textContent = ""; setTimeout(() => { l.textContent = m; }, 30);
    document.querySelector(".toast")?.remove();
    const d = document.createElement("div"); d.className = "toast"; d.setAttribute("aria-hidden", "true"); d.textContent = m; document.body.append(d);
    setTimeout(() => d.remove(), 3500);
  }
  async function who() {
    let u = ""; try { u = localStorage.getItem("lab_u") || ""; } catch (_) {}
    try {
      const r = await fetch("/api/p/kotoba/me", { headers: u ? { "x-lab-u": u } : {} }).then((x) => x.json());
      member = !!(r && r.member);
    } catch (_) { member = false; }
    checked = true;
    if (member) $("#gate-note").hidden = true;
  }
  const ready = who();
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-copy]");
    if (b) {
      if (!checked) await ready;
      if (!member) { $("#d-gate").showModal(); return; }
      const t = text(b.dataset.copy, b.dataset.id);
      try { await navigator.clipboard.writeText(t); say(lang === "en" ? "英語の指示をコピーしました" : "指示をコピーしました"); }
      catch (_) { say("コピーできませんでした。文字を選んでコピーしてください"); }
      return;
    }
    const lb = e.target.closest("button[data-lang]");
    if (lb) {
      lang = lb.dataset.lang;
      $$("button[data-lang]").forEach((x) => x.setAttribute("aria-pressed", String(x === lb)));
      $$(".fix[lang]").forEach((p) => { p.hidden = p.getAttribute("lang") !== lang; });
      say(lang === "en" ? "英語でコピーします" : "日本語でコピーします");
      return;
    }
    const vb = e.target.closest(".flt button[data-view]");
    if (vb) {
      const v = vb.dataset.view;
      $$(".flt button").forEach((x) => x.setAttribute("aria-pressed", String(x === vb)));
      let n = 0; $$(".card").forEach((c) => { const on = !v || c.dataset.view === v; c.hidden = !on; if (on) n++; });
      say((v || "すべて") + "：" + n + "枚");
      return;
    }
    const tb = e.target.closest('[role="tab"]');
    if (tb) selectTab(tb);
  });
  function selectTab(tb) {
    $$('[role="tab"]').forEach((t) => { const on = t === tb; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; document.getElementById(t.getAttribute("aria-controls")).hidden = !on; });
    tb.focus();
  }
  $(".tabs").addEventListener("keydown", (e) => {
    const tabs = $$('[role="tab"]'); const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const k = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
    if (k === undefined) return; e.preventDefault(); selectTab(tabs[(i + k + tabs.length) % tabs.length]);
  });
  $("#d-gate").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}

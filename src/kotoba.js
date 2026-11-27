// デザインの指示集（仮の名前）便 1（2026-11-27 Naoki OK）：公式サイト（lp.shia2n.jp/design-feedback）の画面
// 中身（指示 40 枚・場面 5 つ・見本）は kotoba-data.js。この画面は中身をそのまま HTML にして返し、
// 動き（kotobaClient）はコピーと切り替えだけを持つ。コピーできるかは /api/p/kotoba/me で聞く
import { KOTOBA_VIEWS, KOTOBA_RULES, KOTOBA_SCENES, KOTOBA_SAMPLE, KOTOBA_WORDS, kotobaMock } from "./kotoba-data.js";

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
</div></div>`;
}

// 便 2（2026-11-27 Naoki OK 10:44・AI の見立ては 3 つのモデルで外れたため、止める条件どおり AI を使わない形にした）：
// 自分の画像を見ながら、気になる所を選ぶ → まとめた指示（日本語・英語）。画像はブラウザの中だけで、どこにも送らない
export const KOTOBA_WISHES = [
  { id: "stylish", name: "もっとスタイリッシュに", ja: ["色を白・墨色・差し色1色の3色に絞る", "見出しを本文の3倍以上の大きさにして、ほかは小さくする", "外周と要素の間の余白を、今の倍にとる", "影・縁取り・グラデーションの飾りを外す"], en: ["Limit colors to white, near-black and one accent", "Make the headline at least 3x the body size; shrink everything else", "Double the margins around the edges and between elements", "Remove shadows, outlines and gradients"], words: ["白地に差し色1色", "余白多め", "ミニマル"] },
  { id: "readable", name: "もっと読みやすく", ja: ["画像の中の文字は3〜5語に絞る", "見出しを本文の3倍以上の大きさにする", "行間を文字の大きさの1.6〜1.8倍に広げる", "明るい背景に濃い文字にする"], en: ["Cut on-image text to 3–5 words", "Make the headline at least 3x the body size", "Set line spacing to 1.6–1.8x the font size", "Use dark text on a light background"], words: ["余白多め"] },
  { id: "stand", name: "タイムラインで目立たせたい", ja: ["主役を1つに決めて、画面の中央に大きく置く", "はっきりした差し色1色を、主役だけに使う", "文字は3〜5語にして、スマホでも読める大きさにする", "主役の後ろは無地にする"], en: ["Pick one subject and place it large in the center", "Use one strong accent color only on the subject", "Keep text to 3–5 words, readable on a phone", "Keep the background behind the subject plain"], words: ["日の丸構図", "補色の対比"] },
  { id: "soft", name: "やさしい雰囲気に", ja: ["色をくすみ寄り・パステル寄りにする", "四角の角を丸くする", "写真や絵は、やわらかい光にする", "文字は細めの書体にする"], en: ["Shift colors toward muted pastels", "Round the corners of boxes", "Use soft, diffused light in photos or illustrations", "Use a lighter-weight typeface"], words: ["パステル", "くすみ色", "やわらかい拡散光"] },
];

// 2026-11-27（Naoki OK 12:50）：見立ては使う人の ChatGPT・Claude に任せる（Workers AI は外れた・ChatGPT は Naoki の画像 3 枚とも合格）。
// 無料会員に体験版の文をコピーで渡し、有料のスキル（shia2n-design-feedback）へ案内する
export function kotobaTrialPrompt() {
  return `あなたは日本語で話すアートディレクターです。添付の画像は、私が作った SNS 用の画像です。
下の「直す所の一覧」から、この画像で直すと一番良くなるものを3つ、効く順に選んでください。

決まり
・画像に実際に見えていることだけを根拠にする。見えていないことは書かない
・良い所が多い画像でも、直すと良くなる所を選ぶ
・人名・作品名・ブランド名は書かない

出す形
よい所：1文
直す所（3つ）：番号・名前／画像のどこか／なぜそう見たか（1文）
まとめた指示：画像を作る AI にそのまま貼れる形で、3つを直す指示（「それ以外は変えない」を付ける）

直す所の一覧
${KOTOBA_RULES.map((r) => `${r[0]}. ${r[2]}（${r[3]}）`).join("\n")}`;
}
function trialBlock() {
  return `<div class="tr"><ol class="tr-steps"><li>下の「体験版の文をコピー」を押す</li><li>ChatGPT か Claude の新しいチャットに、自分の画像を1枚添えて貼り、送る</li><li>よい所・直す所3つ・そのまま貼れる直しの指示が返ってくる</li></ol>
<div class="all1"><p>体験版の文（直す所の一覧40つき）</p><pre class="lk-out tr-pre">${esc(kotobaTrialPrompt().split("\n").slice(0, 6).join("\n"))}\n…（続きはコピーで）</pre><button type="button" class="cp" data-copy="trial" data-id="1">体験版の文をコピー</button></div>
<p class="lk-note">直した画像と比べる・自分のデザインの決めごと（マイスタイル）をためる・参考作品とのパクリ度を見る、は有料版（準備中）で使えます。</p></div>`;
}

function lookBlock() {
  const first = KOTOBA_SCENES[0];
  const ck = (r) => `<label class="ckr"><input type="checkbox" data-pk="${r[0]}"><span><b>「${esc(r[2])}」</b><small>${esc(r[3])}</small></span></label>`;
  const groups = KOTOBA_VIEWS.map((v) => `<details class="opt"><summary>${esc(v)}</summary>${KOTOBA_RULES.filter((r) => r[1] === v).map(ck).join("")}</details>`).join("");
  return `<div class="lk"><div class="lk-in">
<label class="drop" id="lk-drop"><input type="file" id="lk-file" accept="image/png,image/jpeg,image/webp" class="sr"><img id="lk-prev" alt="入れた画像" hidden><span id="lk-empty"><b>画像をここに置く</b><br>または押して選ぶ（PNG・JPEG）</span></label>
<p class="lk-note">画像はこのブラウザの中だけで表示し、どこにも送りません。見ながら右で選んでください。</p>
<label for="lk-scene" class="lb">場面</label><select id="lk-scene">${KOTOBA_SCENES.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.sub)}）</option>`).join("")}</select></div>
<div class="lk-res"><h3>1. 気になる所を選ぶ</h3><p class="lk-note">まずは、この場面でよくある所から。</p><div id="lk-top">${first.rules.map((n) => ck(KOTOBA_RULES.find((r) => r[0] === n))).join("")}</div>
<p class="lk-note">ほかの気になる所（見るところ別）</p>${groups}
<h3>2. 変えたい方向（なくてもよい）</h3><div class="chips" role="group" aria-label="変えたい方向">${KOTOBA_WISHES.map((w) => `<button type="button" data-wish="${esc(w.id)}" aria-pressed="false">${esc(w.name)}</button>`).join("")}</div>
<div class="all1"><p>3. まとめた指示（そのまま AI に貼れます）</p><pre class="lk-out" id="lk-out">上で、気になる所を選んでください。</pre><button type="button" class="cp" data-copy="look" data-id="1">まとめた指示をコピー</button></div>
<h3>4. 直した画像と並べて確かめる</h3><p class="lk-note">直した画像を入れると、元の画像と並べて出します。選んだ所が直ったかを、自分の目で確かめてください。</p>
<label class="sub2 fl"><input type="file" id="lk-after" accept="image/png,image/jpeg,image/webp" class="sr">直した画像を選ぶ</label>
<div id="lk-cmp" class="cmp2" hidden><figure><figcaption>直す前</figcaption><img id="lk-b" alt="直す前の画像"></figure><figure><figcaption>直した後</figcaption><img id="lk-a" alt="直した後の画像"></figure></div><ul id="lk-chk" class="cmpl"></ul></div></div>`;
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
<p class="jump"><a href="#trial">AI に見立ててもらう</a><a href="#sample">見本の見立てを見る</a><a href="#scenes">場面で選ぶ</a><a href="#all">気になる所から探す</a></p>
<p class="gate-note" id="gate-note">指示のコピーは無料会員の方がご利用いただけます。<a href="${esc(join)}">無料会員登録</a>　<a href="/login?next=${encodeURIComponent(KOTOBA_PATH)}">ログイン</a></p></section>
<div class="lang" role="group" aria-label="コピーする言葉"><span>コピーする言葉</span><button type="button" data-lang="ja" aria-pressed="true">日本語</button><button type="button" data-lang="en" aria-pressed="false">英語</button></div>
<section id="trial" aria-labelledby="h-trial"><h2 id="h-trial">AI に自分の画像を見立ててもらう（体験版）</h2>${trialBlock()}</section>
<section id="look" aria-labelledby="h-look"><h2 id="h-look">自分の画像を自分でチェックする</h2>${lookBlock()}</section>
<section id="sample" aria-labelledby="h-sample"><h2 id="h-sample">見本：この図解を見立てると</h2>${sampleBlock()}</section>
<section id="scenes" aria-labelledby="h-scenes"><h2 id="h-scenes">場面で選ぶ</h2>${sceneTabs()}</section>
<section id="all" aria-labelledby="h-all"><h2 id="h-all">気になる所から探す（${KOTOBA_RULES.length}枚）</h2>${views}<div class="cards">${KOTOBA_RULES.map(ruleCard).join("")}</div></section>
<p class="disc">この画面の指示は、見た目を直すための一般的な考え方です。参考にした作品と似ていないか、法的に問題がないかの判断はしません。</p>
</main>
<dialog id="d-gate" aria-labelledby="d-gate-h"><h2 id="d-gate-h">コピーは無料会員の方がご利用いただけます</h2><p>メールアドレスだけで登録できます。登録すると、AI に画像を見立ててもらう体験版の文と、40枚の指示・場面ごとのまとめを何度でもコピーできます。</p>
<p class="d-btns"><a class="go" href="${esc(join)}">無料会員登録</a><a class="sub" href="/login?next=${encodeURIComponent(KOTOBA_PATH)}">登録済みの方はログイン</a></p><form method="dialog"><button class="x">閉じる</button></form></dialog>
<div id="live" class="sr" role="status" aria-live="polite"></div>
<footer class="bf"><div><span style="font-weight:700;color:#1a1a1a">${esc(siteName)}</span><a href="https://lab.shia2n.jp/legal/terms">利用規約</a><a href="https://lab.shia2n.jp/legal/privacy">プライバシーポリシー</a><a href="https://lab.shia2n.jp/legal/tokushoho">特定商取引法に基づく表記</a><span>© 株式会社Best Life Consulting</span></div></footer>
<script src="/_lab/embed.js" defer data-kind="site"></script>
<script>var __name=window.__name||function(f){return f};(${kotobaClient.toString()})(${JSON.stringify({ trial: kotobaTrialPrompt(), rules: KOTOBA_RULES.map((r) => [r[0], r[5], r[6], r[2], r[3]]), wishes: KOTOBA_WISHES, words: KOTOBA_WORDS.filter((w) => KOTOBA_WISHES.some((x) => x.words.includes(w[0]))), scenes: KOTOBA_SCENES.map((s) => [s.id, s.name, s.rules]), sample: { picks: KOTOBA_SAMPLE.picks.map((p) => [p.id, p.where]), changes: KOTOBA_SAMPLE.changes.map((c) => [c.title, c.steps]) } }).replace(/</g, "\\u003c")});</script>
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
.lk{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start}.lk-in{flex:1 1 300px;min-width:0}.lk-res{flex:999 1 420px;min-width:0}
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:220px;border:2px dashed #8a867d;border-radius:8px;background:#fff;text-align:center;padding:16px;cursor:pointer}.drop.over{border-color:#c8102e;background:#fff5f6}.drop img{max-width:100%;max-height:360px;border-radius:4px}
.sub2,.chips button,.x2{min-height:44px;padding:0 16px;border:1px solid #8a867d;border-radius:8px;background:#fff}
.go2{width:100%;min-height:52px;border:0;border-radius:8px;background:#c8102e;color:#fff;font-weight:700;margin-top:16px}.go2:disabled{background:#8a867d}
.opt fieldset{border:0;padding:0;margin:8px 0}.opt legend,.lb{font-weight:700;display:block;margin:12px 0 4px}.rd{display:flex;gap:8px;align-items:center;min-height:44px}.rd input{width:20px;height:20px}
.opt select,.opt textarea{width:100%;font:inherit;font-size:16px;padding:12px;border:1px solid #8a867d;border-radius:8px;background:#fff;min-height:48px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.lk-note{font-size:14px;color:#555}.ph{color:#555;background:#f3f1eb;border-radius:8px;padding:24px;margin:0}
.pk{display:flex;gap:8px;align-items:flex-start}.pk>input{flex:none;width:24px;height:24px;margin:14px 0 0}.pk>details{flex:1 1 auto;min-width:0;margin:4px 0}
.lk-out{white-space:pre-wrap;background:#f3f1eb;border-radius:8px;padding:12px 16px;margin:8px 0;font:inherit;font-size:14px}
.ckr{display:flex;gap:12px;align-items:flex-start;min-height:44px;padding:8px 0;cursor:pointer}.ckr input{flex:none;width:22px;height:22px;margin:3px 0 0}.ckr small{display:block;font-size:14px;color:#555}.chips button[aria-pressed=true]{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
.cmp2{display:flex;gap:12px;margin:12px 0}.cmp2 figure{flex:1 1 0;margin:0;min-width:0}.cmp2 img{width:100%;height:auto;border:1px solid #d9d6cf;border-radius:4px}.cmp2 figcaption{font-size:14px;color:#555}
.ok{color:#1a1a1a;font-weight:700}.ng2{color:#c8102e;font-weight:700}.cmpl{list-style:none;padding:0;margin:8px 0}.cmpl li{padding:8px 0;border-bottom:1px solid #d9d6cf}
.fl{display:inline-flex;align-items:center;cursor:pointer}.tr-steps{padding-left:24px}.tr-steps li{margin:4px 0}.tr-pre{max-height:9em;overflow:hidden}.soon{font-size:14px;color:#555}.tl{display:inline-flex;min-height:44px;align-items:center}
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
  const L = { pick: [], wish: "", after: false };
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
    if (kind === "look") return lookText();
    if (kind === "trial") return D.trial;
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
      if ($("#lk-out")) drawOut();
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
  // ---------- 便 2：自分の画像をチェックする（AI を使わない・画像は送らない） ----------
  const escH = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wordEn = (w) => { const f = D.words.find((x) => x[0] === w); return f ? f[1] : w; };
  function lookText() {
    const en = lang === "en", w = D.wishes.find((x) => x.id === L.wish);
    if (!L.pick.length && !w) return "";
    const out = [en ? "Please change only the following points and keep everything else the same." : "次の点だけ変えてください。それ以外は変えないでください。"];
    let k = 1;
    L.pick.forEach((id) => { const ru = rule(id); if (ru) out.push(en ? "- " + ru[2] : (k++) + ". " + ru[1]); });
    if (w) {
      if (en) { w.en.forEach((x) => out.push("- " + x)); out.push("- Style: " + w.words.map(wordEn).join(", ")); }
      else { out.push((k++) + ". 「" + w.name + "」の方向に変える："); w.ja.forEach((x) => out.push("   ・" + x)); out.push("   ・トーン：" + w.words.join("、")); }
    }
    return out.join("\n");
  }
  function drawOut() {
    const o = $("#lk-out"); if (o) o.textContent = lookText() || "上で、気になる所を選んでください。";
    const ul = $("#lk-chk"); if (!ul) return;
    ul.innerHTML = L.after ? L.pick.map((id) => { const ru = rule(id); return '<li><label class="ckr"><input type="checkbox"><span><b>直った：「' + escH(ru[3]) + "」</b></span></label></li>"; }).join("") : "";
  }
  async function showFile(file, img) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type || "")) { say("画像のファイル（PNG・JPEG）を選んでください"); return false; }
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const u = URL.createObjectURL(file); img.dataset.url = u; img.src = u; img.hidden = false; return true;
  }
  if ($("#lk-out")) {
    $("#lk-file").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (await showFile(f, $("#lk-prev"))) { $("#lk-empty").hidden = true; say("画像を入れました。右で気になる所を選んでください"); } });
    const drop = $("#lk-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", async (e) => { if (await showFile(e.dataTransfer.files[0], $("#lk-prev"))) $("#lk-empty").hidden = true; });
    $("#lk-scene").addEventListener("change", (e) => {
      const sc = D.scenes.find((x) => x[0] === e.target.value); if (!sc) return;
      $("#lk-top").innerHTML = sc[2].map((n) => { const ru = rule(n); return '<label class="ckr"><input type="checkbox" data-pk="' + n + '"' + (L.pick.includes(n) ? " checked" : "") + "><span><b>「" + escH(ru[3]) + "」</b><small>" + escH(ru[4]) + "</small></span></label>"; }).join("");
      say(sc[1] + "でよくある所に切り替えました");
    });
    document.addEventListener("change", async (e) => {
      if (e.target.id === "lk-after") {
        const f = e.target.files[0]; e.target.value = "";
        if (!$("#lk-prev").src || $("#lk-prev").hidden) { say("先に、直す前の画像を左に入れてください"); return; }
        if (await showFile(f, $("#lk-a"))) { $("#lk-b").src = $("#lk-prev").src; $("#lk-cmp").hidden = false; L.after = true; drawOut(); say("並べました。直ったかを確かめてください"); }
        return;
      }
      const pk = e.target.dataset && e.target.dataset.pk;
      if (pk) {
        const n = Number(pk);
        L.pick = e.target.checked ? [...L.pick.filter((x) => x !== n), n] : L.pick.filter((x) => x !== n);
        $$('input[data-pk="' + n + '"]').forEach((x) => { x.checked = e.target.checked; });
        drawOut();
      }
    });
    document.addEventListener("click", (e) => {
      const w = e.target.closest("button[data-wish]"); if (!w) return;
      L.wish = L.wish === w.dataset.wish ? "" : w.dataset.wish;
      $$("button[data-wish]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.wish === L.wish)));
      drawOut();
    });
  }
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

// 便 2（関門 5・2026-10-29）：生徒の画面（/app）の右上に、ほかの会員用アプリと同じ共通の外枠を付ける。
// 外枠の部品は shia2n-core の mountAppShell（public/js/vendor/app-shell.js・tools/build-shell.mjs で作る）。
// 誰で入っているか・開けるアプリは Firebase ではなく、マーケくんのログイン（Supabase）と /api/me の答えで差し替える。
// マニュアルの文の正本はこの 1 枚（できることの一覧と操作の案内は同じ文を読む）。
import { mountAppShell } from "/js/vendor/app-shell.js";

const side = (tab) => `.side [data-tab="${tab}"]`;
const go = (tab) => () => { const b = document.querySelector(side(tab)); if (b && !b.classList.contains("hidden")) b.click(); };

const FULL_SECTIONS = [
  { title: "学ぶ", items: [
    { t: "教材", d: "セミナーのアーカイブと講座の教材が、プログラム → コース → 教材の順に並びます。上の欄に題名の一部を入れると絞り込めます。見た教材には「視聴済み」が付きます。" },
    { t: "教材の下の質問とメモ", d: "教材を開くと、下で質問を送れます。答えはその教材の下と「添削ルーム」に出ます。「自分のメモ」はあなただけが見られます。" },
    { t: "お知らせ", d: "シアニンからのお知らせが新しい順に並びます。" },
  ] },
  { title: "添削", items: [
    { t: "添削ルーム", d: "シアニンと 1 対 1 の部屋です。「添削」の枠で文章（と画像）を出すと、原文・添削後・コメントの 3 欄で返ってきます。質問や連絡は「やり取り」の枠へ。", keys: ["⌘／Ctrl", "Enter"] },
    { t: "振り返り", d: "返ってきた添削だけを新しい順に並べます。番号の付いた色の範囲を押すと、指摘が光ります。" },
  ] },
  { title: "相談", items: [
    { t: "予約", d: "個別相談とセミナーの申し込みです（いまは準備中）。" },
  ] },
  { title: "契約", items: [
    { t: "ご契約", d: "続いている定期のお支払いと、分割のお支払いの残りが見られます。定期はここから止められます。" },
  ] },
];
const CONTRACT_SECTIONS = [FULL_SECTIONS[3]];

const FULL_TOURS = [
  { id: "lessons", title: "教材を見る", desc: "教材の並びと、探し方", before: go("lessons"), steps: [
    { el: side("lessons"), title: "教材", body: "左の「教材」で、教材の一覧に戻れます。" },
    { el: "#lib-q", title: "探す", body: "題名の一部を入れると、その場で絞り込めます。" },
    { el: "#tab-lessons .lesson", title: "開く", body: "教材を押すと動画とまとめが開きます。下で質問とメモが書けます。" },
  ] },
  { id: "room", title: "添削を出す", desc: "文章を出して、返ってきたものを見る", before: go("room"), steps: [
    { el: side("room"), title: "添削ルーム", body: "シアニンと 1 対 1 の部屋です。返事があると数字が付きます。" },
    { el: "#c-text", title: "文章を貼る", body: "添削してほしい文章を貼ります。画像も足せます。" },
    { el: "#c-send", title: "出す", body: "「出す」で届きます。⌘／Ctrl＋Enter でも出せます。返ってきたものは「振り返り」にもたまります。" },
  ] },
  { id: "contract", title: "ご契約を見る", desc: "お支払いの確認と、定期の止め方", before: go("contract"), steps: [
    { el: side("contract"), title: "ご契約", body: "続いている定期と、分割の残りが見られます。" },
    { el: "#ct-list", title: "定期を止める", body: "定期のお支払いは、ここから止められます。止めても、次の更新日までは使えます。" },
  ] },
];
const CONTRACT_TOURS = [FULL_TOURS[2]];

/** 外枠を作って el（上の帯の右端）に置く。me は /api/me の答え、sb は Supabase の client */
export function mountStudentShell(el, { me, sb, session }) {
  const contract = me.access === "contract";
  const u = session.user || {};
  const user = { uid: u.id, email: u.email, displayName: (me.me && me.me.name) || "" };
  const shell = mountAppShell({
    appId: "marke-app",
    appName: "マーケくん",
    host: "lab.shia2n.jp",
    manual: {
      intro: contract ? "この画面はご契約の確認用です。教材・添削ルームは、しあらぼの会員向けです。" : "しあらぼの教材・添削・相談・ご契約が、この画面にまとまっています。",
      sections: contract ? CONTRACT_SECTIONS : FULL_SECTIONS,
    },
    tours: contract ? CONTRACT_TOURS : FULL_TOURS,
    source: {
      user: () => user,
      profile: async () => ({ role: me.admin ? "admin" : "user", displayName: user.displayName }),
      apps: async () => [],
      gateApps: async () => (Array.isArray(me.apps) ? me.apps : []),
      signOut: async () => { await sb.auth.signOut(); },
      watch: null,
    },
  });
  shell.attach(el);
  return shell;
}

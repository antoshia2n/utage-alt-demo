// 生徒の画面（/app）の題の横の「？」（2026-11-08・Naoki OK 22:01「作る前の 1 枚」）。
// シアニン用の画面（guide.js）と同じ部品（shia2n-core の shell/guide.js）を使う。右上の「ガイド」が「あり」のときだけ出す。
// 文の正本はここ 1 か所。くわしい説明は右上の使い方（student-shell.js のマニュアル）。
import { guideOn, onGuide, ensureGuideCss } from "/js/vendor/app-shell.js";

export const STUDENT_GUIDE = {
  home: "学んだ日数と、続きから・今日のおすすめ・新しい教材が並びます。おすすめのテーマは右の「テーマ」から変えられます",
  lessons: "教材が種類ごとの棚に並びます。上のボタンで種類を選ぶか、題名の一部を入れて探せます",
  lesson: "動画とまとめを見ます。下で質問を送れて、答えはここと添削ルームに出ます。「自分のメモ」はあなただけが見られます",
  room: "シアニンと 1 対 1 の部屋です。「添削」に文章を出すと、原文・添削後・コメントで返ってきます。質問や連絡は「やり取り」へ",
  review: "返ってきた添削だけが新しい順に並びます。番号の付いた範囲を押すと、指摘が光ります",
  goals: "理想から今週の 1 本までを 1 本の線でつないで回します。文字を押すと、そのまま編集できます",
  booking: "シアニンとの個別相談を予約します。日時を選び、聞かれていることを書いて予約します。キャンセルもここからできます",
  apps: "あなたが使えるアプリの一覧です。押すと、そのアプリが開きます",
  mypage: "あなたのページです",
  news: "シアニンからのお知らせが新しい順に並びます",
  contract: "続いている定期のお支払いと、分割の残りが見られます。定期はここから止められます。止めても次の更新日までは使えます",
};

let cur = "home";
let title = "ホーム";
/** 題の横の「？」（app.html の #crumb-q）を、開いている画面の説明に合わせる */
export function setStudentGuide(view, t) {
  if (view) cur = view;
  if (t) title = t;
  const b = document.getElementById("crumb-q"); if (!b) return;
  const d = STUDENT_GUIDE[cur] || "";
  b.dataset.t = title;
  b.dataset.d = d;
  b.setAttribute("aria-label", title + "とは");
  b.hidden = !d || !guideOn();
}
export function initStudentGuide(view, t) {
  ensureGuideCss();
  if (!document.querySelector("style[data-lab-guide]")) {
    const st = document.createElement("style"); st.dataset.labGuide = "1";
    st.textContent = "#crumb-q[hidden]{display:none}#crumb-q{flex:0 0 auto;margin-left:6px;font-size:12px;vertical-align:middle}";
    document.head.appendChild(st);
  }
  try { onGuide(() => setStudentGuide()); } catch (_) { /* 無くても動く */ }
  window.__labGuide = setStudentGuide; // app.js の画面の切り替えから呼ぶ（読めなかったときは何もしない）
  setStudentGuide(view || "home", t || "ホーム");
}

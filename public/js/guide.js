// ガイドの「？」（2026-11-08・直す順 4・Naoki OK 18:38。ほかのアプリと同じ形・shia2n-core 1.17.0 の shell/guide.js）
// 右上の「ガイド」が「あり」のとき、画面の題の横に小さな「？」を出す。押すと（マウスなら乗せると）題と説明の小窓。
// 文の正本はここ 1 か所。くわしい「できること」の一覧は左の「使い方」（サーバーの道具の一覧から自動で作る）。
import { guideOn, onGuide, ensureGuideCss } from "/js/vendor/app-shell.js";

export const VIEW_GUIDE = {
  home: "今日の予約・やること・段階のボード（受講 → オファー → 個別相談 → アプローチ → リストイン）を 1 枚で見ます。人を押すと顧客管理で詳細が開きます",
  guide: "画面ごとのできることと、AI に頼んだときに承認が要るかの一覧です。送る前・承認する前に見ることも並びます",
  people: "顧客の一覧です。流入元や会員・権利で絞り、押すとその人の詳細（段階・権利・やり取り）が開きます",
  chat: "生徒とのやり取りとメモです。左で要返信・後で・すべてを切り替え、右に顧客のカードが出ます。? でキーの一覧",
  rooms: "添削ルームです。添削の提出と教材の質問に返信します。未返信の数は上の札に出ます",
  refer: "紹介の記録です。報酬の率は「商品」の各商品で決めます。紹介のリンクは、生徒が自分の画面の「お知らせ」からコピーします",
  line: "LINE のキーワードの自動応答と、相手を絞って送るメッセージです",
  pages: "ページと経路です。ページの中身は Claude が書きます。経路は、その人が初めて登録したときのものに決まります",
  forms: "フォームと、フォームで聞く欄（人の項目）です。答えは顧客ごとに残り、一斉配信の配信対象を絞れます",
  deliver: "一斉配信とステップ配信です。一斉配信は下書きに保存し、詳細の「送る」で送ります。ステップ配信は毎時実行されます",
  deals: "個別相談の予約メニュー・セミナー・担当者です。担当者ごとに Google カレンダーをつなぐと、その人の空き時間で受け付けます",
  products: "商品と継続課金です。課金が失敗すると、その人へ自動でメールが届きます。解約すると元に戻せません",
  site: "会員サイトです。サイト › カリキュラム › プログラム › コース › コンテンツ の順に作ります。権利はカリキュラムに付きます",
  web: "公開サイト（ブログとファネルページ）の見た目と部品です。部品の中身は、読者の段階で変わります",
  recordings: "録画の棚です。名前をそろえ、共有リンクを発行します。Zoom 以外の動画・音声は「アップロード」から入れます",
  media: "画像・PDF・Google スライド・動画を置く棚です。行の「共有」で共有リンクを作れます",
  utagecopy: "UTAGE の中身を全部コピーしたものを、読むだけで見る棚です。毎晩取り直します",
  blueprint: "シナリオの設計図とステップ配信の流れです。箱を押すと、入口と出口・先週の人数が出ます",
  ai: "AI からの承認待ちと、AI に何を許すか（自動・承認・禁止）、AI の操作の記録です",
  settings: "決済（UnivaPay）・メールの送り方・スマホの通知・カレンダー・オプチャの設定です",
  access: "「先行で試す」の権利を持つ人に、アプリを開くかを切り替えます",
  invites: "招待リンクです。開いた人が「Google で登録」を押すと、選んだ権利が期限つきで付きます",
};

let cur = "home";
/** 題の横の「？」（admin.html の #crumb-q）を、開いている画面の説明に合わせる */
export function setViewGuide(view, title) {
  if (view) cur = view;
  const b = document.getElementById("crumb-q"); if (!b) return;
  const d = VIEW_GUIDE[cur];
  if (title) b.dataset.t = title;
  b.dataset.d = d || "";
  b.setAttribute("aria-label", (b.dataset.t || "この画面") + "とは");
  b.hidden = !d || !guideOn();
}
export function initGuide() {
  ensureGuideCss();
  if (!document.querySelector("style[data-mk-guide]")) { const st = document.createElement("style"); st.dataset.mkGuide = "1"; st.textContent = "#crumb-q[hidden]{display:none}#crumb-q{font-size:12px;vertical-align:middle}"; document.head.appendChild(st); }
  try { onGuide(() => setViewGuide()); } catch (_) { /* 無くても動く */ }
  setViewGuide("home", "ホーム");
}

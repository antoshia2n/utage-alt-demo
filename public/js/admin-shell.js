// 管理画面（/admin）の右上に、生徒の画面（/app）と同じ共通の外枠を付ける（2026-10-31 開発部・全アプリの右上をそろえる）。
// 外枠の部品は生徒の画面と同じ public/js/vendor/app-shell.js（shia2n-core の mountAppShell・tools/build-shell.mjs で作る）。
// 誰で入っているかは Firebase ではなく、マーケくんのログイン（Supabase）と /api/admin/whoami の答えで差し替える。
// マニュアルの文はここには書かない。管理画面の左のメニューと、各画面に書いてある説明文（admin.html）を開いたときに読んで並べる
// （文の正本は admin.html の 1 か所。メニューや説明を直せば、？ の中身も一緒に変わる）。
import { mountAppShell, setTabTitle } from "/js/vendor/app-shell.js";

const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const label = (b) => txt(b.firstChild) || txt(b);
const LOADING = /^読み込んでいます/;

/* 画面の中に書いてある説明文（数や状態を後から入れる id の付いた欄・入力の欄の注・読み込み中の字は除く） */
function notesOf(root) {
  if (!root) return [];
  return [...root.querySelectorAll("p.note:not([id])")]
    .filter((p) => !p.closest("form, details, .legend"))
    .map(txt).filter((s) => s && !LOADING.test(s))
    .map((s) => (/[。）」]$/.test(s) ? s : s + "。"));
}
/* 画面の中のタブ（例：一斉配信・ステップ配信） */
function tabsOf(root) {
  const t = root ? [...root.querySelectorAll("[data-vtabs] [data-vtab]")].map(txt).filter(Boolean) : [];
  return t.length > 1 ? "画面の中で「" + t.join("」「") + "」を切り替えます。" : "";
}
/* 画面ごとの説明。基本は画面の中の説明文。説明文の無い画面は、画面にある見出し・欄の名前を並べる */
const SPECIAL = {
  home: (v) => { const h = [...v.querySelectorAll("h3.home-h")].map((e) => txt(e.firstChild)).filter(Boolean); return h.length ? h.join("・") + "が並びます。" : ""; },
  guide: (v) => { const t = [...v.querySelectorAll(".guide-toc a")].map(txt).filter(Boolean); return t.length ? "「" + t.join("」「") + "」が載っています。" : ""; },
  people: () => { const c = [...document.querySelectorAll("#cust-list thead th")].map(txt).filter(Boolean); return c.length ? "顧客の一覧（" + c.join("・") + "）。人を押すと、その人の詳細が開きます。" : ""; },
  /* 会員サイトの画面は開いたときに描く（public/js/site.js）ので、画面に前もって書いてある説明が無い。並びの名前だけ site.js の決めから写す */
  site: () => "サイト › カリキュラム › プログラム › コース › コンテンツ の順に、会員が見る教材の並びを作ります。",
  settings: (v) => { const s = [...v.querySelectorAll("details > summary")].map(txt).filter(Boolean); return s.length ? s.join("／") : ""; },
};
function describe(view) {
  const v = document.getElementById("view-" + view);
  if (!v) return "";
  if (SPECIAL[view]) return SPECIAL[view](v);
  const root = document.getElementById(view + "-list") || v;
  return [tabsOf(root), ...notesOf(root)].filter(Boolean).join(" ");
}

/** 左のメニューのまとまりを、マニュアルの見出しと項目にする（使い方の画面の「できること」と同じく、メニューから毎回組み立てる） */
export function buildManual() {
  const sections = [];
  const solo = [];
  document.querySelectorAll(".side .grp-box, .side .grp-solo").forEach((box) => {
    const items = [...box.querySelectorAll("[data-view]")].map((b) => ({ t: label(b), d: describe(b.dataset.view) })).filter((x) => x.t);
    if (!items.length) return;
    const head = box.querySelector(".grp");
    if (head) sections.push({ title: txt(head), items });
    else solo.push(...items);
  });
  if (solo.length) sections.push({ title: "会員サイトとファネル", items: solo });
  return {
    intro: "マーケくんのシアニン用の画面です。" + ((notesOf(document.getElementById("gd-can"))[0] || "").split("。")[0] + "。").replace(/^。$/, ""),
    sections,
  };
}

/** 外枠を作って el（上の帯の右端）に置く。who は /api/admin/whoami の答え、sb は Supabase の client、session はいまのログイン */
export function mountAdminShell(el, { who, sb, session }) {
  const u = (session && session.user) || {};
  const user = { uid: u.id || "admin", email: who.email || u.email || "", displayName: "シアニン" };
  const go = (view) => () => { const b = document.querySelector(`.side [data-view="${view}"]`); if (b) b.click(); };
  const shell = mountAppShell({
    appId: "marke-admin",
    appName: "マーケくん",
    host: "lab.shia2n.jp",
    theme: false, // 暗い画面は OS の設定（prefers-color-scheme）だけで持ち、[data-theme] では切り替えない
    manual: buildManual(),
    settings: [
      { label: "決済・メール・オプチャの設定を開く", note: "決済・メールの送り方・スマホの通知・カレンダー・オプチャ", run: go("settings") },
      { label: "使い方の画面を開く", note: "できること・送る前に見ること・毎日の手順", run: go("guide") },
    ],
    source: {
      user: () => user,
      profile: async () => ({ role: "admin", displayName: user.displayName }),
      apps: async () => [],
      signOut: async () => { await sb.auth.signOut(); },
      watch: null,
    },
  });
  shell.attach(el);

  /* タブの名前は開いているものの名前（詳細を開いていればその名前、ほかは画面の名前）だけ。アプリはファビコンで示す */
  const crumb = document.getElementById("crumb"), sub = document.getElementById("crumb-sub");
  const name = () => txt(sub).replace(/^›\s*/, "") || txt(crumb);
  const paint = () => setTabTitle(name(), "マーケくん");
  paint();
  const mo = new MutationObserver(paint);
  [crumb, sub].forEach((e) => e && mo.observe(e, { childList: true, characterData: true, subtree: true }));
  return { shell, destroy() { mo.disconnect(); shell.destroy(); } };
}

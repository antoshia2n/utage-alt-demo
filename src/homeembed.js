// 公式サイトの作り直し 便 2：ホームの部品を描く（embed.js の中に、この関数のソースをそのまま埋め込む）
// 外の変数は使わない（ctx で受け取る）。草案 v0.7 の見た目：紙の白・墨・赤ペン 1 色。基準「WEBページの基準 1.1」の決まり
// （押す所 44px・一時停止・動きを減らす設定で止める・今が何枚目かを文字でも出す・色だけで区別しない）
export function homeEmbed(ctx) {
  const { esc, mountForm, PREVIEW } = ctx;
  let homeP = null, meP = null;
  const loadHome = () => (homeP = homeP || fetch("/api/p/home").then((x) => x.json()).catch(() => ({})));
  const loadMe = () => (meP = meP || fetch("/api/p/me").then((x) => x.json()).catch(() => ({})));
  const href = (h) => (/^(#[A-Za-z0-9_-]+|[/](?![/\\])\S*|https:[/][/]\S+)$/.test(String(h || "")) ? String(h) : "#");
  const reduce = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const st = document.createElement("style");
  st.textContent = ":root{--lab-ink:#1a1a1a;--lab-red:#c8102e;--lab-line:#d9d6cf;--lab-mut:#555555;--lab-soft:#f3f1eb}"
    + ".lab-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}"
    + ".lab-hand{font-family:'Zen Kurenaido','Noto Sans JP',sans-serif;color:var(--lab-red)}"
    + ".lab-sl-box{position:relative;background:#fff;border:1px solid var(--lab-line);border-radius:8px;overflow:hidden}"
    + ".lab-sl-s{display:flex;flex-wrap:wrap;gap:32px 48px;align-items:center;padding:clamp(24px,5vw,48px);min-height:400px;box-sizing:border-box}.lab-sl-s[hidden]{display:none}"
    + ".lab-sl-tx{flex:3 1 380px;min-width:0}.lab-sl-lb{margin:0 0 16px;font-size:16px;font-weight:700;color:var(--lab-red)}"
    + ".lab-sl-h{margin:0;font-size:44px;line-height:1.35;font-weight:700;color:var(--lab-ink)}"
    + ".lab-sl-p{margin:24px 0 0;font-size:18px;max-width:30em}"
    + ".lab-sl-go{display:inline-flex;align-items:center;min-height:52px;margin-top:32px;background:var(--lab-red);color:#fff!important;font-weight:700;font-size:18px;padding:0 32px;border-radius:8px;text-decoration:none}"
    + ".lab-sl-fig{flex:2 1 300px;min-width:0;margin:0;position:relative}"
    + ".lab-sl-fig img,.lab-ph{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#fff;border:1px solid var(--lab-line);border-radius:8px;box-sizing:border-box}"
    + ".lab-ph{display:flex;flex-direction:column;justify-content:center;gap:8px;padding:24px;position:relative;overflow:hidden}.lab-ph b{font-size:24px;line-height:1.4;color:var(--lab-ink)}"
    + ".lab-ph i{display:block;width:64px;height:4px;background:var(--lab-red);border-radius:2px}"
    + ".lab-tag{position:absolute;right:8px;top:8px;font-size:14px;font-style:normal;color:var(--lab-mut);background:var(--lab-soft);padding:0 8px;border-radius:4px}"
    + ".lab-sl-fig figcaption{position:absolute;left:-8px;bottom:-32px;font-size:24px;transform:rotate(-3deg)}"
    + ".lab-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:16px 0 0}.lab-ctl>div{display:flex;gap:8px;flex-wrap:wrap}"
    + ".lab-b{min-width:44px;min-height:44px;padding:0 12px;border-radius:8px;border:1px solid #8a867d;background:#fff;color:var(--lab-ink);font:inherit;font-size:16px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}"
    + ".lab-b[aria-current=true],.lab-b[aria-pressed=true]{background:var(--lab-ink);color:#fff;border-color:var(--lab-ink)}"
    + ".lab-pos{font-size:14px;color:var(--lab-mut)}"
    + ".lab-sh-tabs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:24px}"
    + ".lab-sh-hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin-bottom:16px}.lab-sh-hd h3{margin:0;font-size:24px}.lab-sh-hd span{font-size:16px;color:var(--lab-mut)}"
    + ".lab-sh-row{overflow-x:auto;padding-top:40px}.lab-sh-row ol{list-style:none;margin:0;padding:0 8px;display:flex;align-items:flex-end;gap:6px;min-height:260px;border-bottom:8px solid var(--lab-ink)}"
    + ".lab-sh-row li{position:relative;flex:none}.lab-sh-row li .lab-hand{position:absolute;left:-4px;top:-40px;white-space:nowrap;font-size:24px;transform:rotate(-4deg)}"
    + ".lab-bk1{display:flex;flex-direction:column;align-items:center;justify-content:space-between;box-sizing:border-box;padding:12px 0;border:2px solid var(--lab-ink);border-bottom:0;border-radius:4px 4px 0 0;text-decoration:none;color:var(--lab-ink);background:#fff}"
    + ".lab-sh-row li:nth-child(even) .lab-bk1{background:var(--lab-soft)}.lab-bk1.first{background:var(--lab-ink);color:#fff}"
    + ".lab-bk1 b{writing-mode:vertical-rl;font-size:16px;line-height:1.4;letter-spacing:.06em;max-height:75%;overflow:hidden}.lab-bk1 small{writing-mode:vertical-rl;font-size:14px}"
    + ".lab-sb{display:flex;flex-direction:column;gap:32px}.lab-sb section{border-top:2px solid var(--lab-ink);padding-top:24px}.lab-sb section.lab-join{border:2px solid var(--lab-ink);border-radius:8px;padding:24px;background:#fff}"
    + ".lab-sb .k{margin:0 0 8px;font-size:14px;font-weight:700}.lab-sb h2{margin:0 0 8px;font-size:24px;line-height:1.5}.lab-sb p{margin:0 0 16px;font-size:16px}"
    + ".lab-sb .go{display:flex;align-items:center;justify-content:center;min-height:48px;border:2px solid var(--lab-ink);border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;color:var(--lab-ink)}.lab-sb .lab-join .go{background:var(--lab-red);border-color:var(--lab-red);color:#fff}"
    + ".lab-left{position:relative;display:inline-block;padding:0 8px;font-weight:700}.lab-left svg{position:absolute;left:-8px;top:-8px;width:calc(100% + 16px);height:calc(100% + 16px)}"
    + ".lab-cat h2{margin:0 0 8px;font-size:24px}.lab-cat ul{list-style:none;margin:0;padding:0}.lab-cat a{display:flex;justify-content:space-between;align-items:center;min-height:44px;border-bottom:1px solid var(--lab-line);font-size:16px;color:var(--lab-ink);text-decoration:none}.lab-cat span{color:var(--lab-mut)}"
    + ".lab-acc{display:inline-flex;align-items:center;gap:8px 16px;flex-wrap:wrap;font-size:16px}.lab-acc a{padding:10px 0}"
    + "@media (max-width:600px){.lab-sl-fig figcaption{position:static;display:block;margin-top:8px;transform:none}.lab-sl-s{min-height:0}.lab-sl-h{font-size:32px}.lab-ph b{font-size:18px}}"
    // 便 6：サイドバーの無料会員登録のフォームを v0.7 の見た目に
    + ".lab-sb .lab-form{display:flex;flex-direction:column;gap:16px;font-size:16px;max-width:none;margin:0}.lab-sb .lab-form label{display:block;font-size:16px;font-weight:700;margin:0 0 8px}.lab-sb .lab-form .lab-note{font-weight:400;color:#555;font-size:14px;opacity:1}.lab-sb .lab-form .lab-input{width:100%;font:inherit;font-size:16px;padding:14px 16px;min-height:52px;border:1px solid #8a867d;border-radius:8px;background:#fff;color:#1a1a1a}.lab-sb .lab-form .lab-input[aria-invalid=true]{border:2px solid #c8102e}.lab-sb .lab-form .lab-check{display:flex;gap:12px;align-items:flex-start;font-weight:400;font-size:14px;line-height:1.7}.lab-sb .lab-form .lab-check input{width:24px;height:24px;flex:none;margin:0}.lab-sb .lab-form .lab-btn{min-height:56px;line-height:1.4;border:0;border-radius:8px;background:#c8102e;color:#fff;font:inherit;font-size:18px;font-weight:700;cursor:pointer}.lab-sb .lab-form .lab-btn:disabled{background:#8a867d;opacity:1;cursor:default}.lab-sb .lab-form .lab-err{color:#c8102e;font-weight:700;font-size:14px}.lab-sb .lab-form .lab-err:empty{display:none}"
    + "@media (prefers-reduced-motion: reduce){.lab-sl-s{transition:none}}";
  document.head.appendChild(st);

  function slider(el, slides) {
    if (!slides.length) { el.style.display = "none"; return; }
    let idx = 0, playing = !reduce() && slides.length > 1, hold = false, timer = null;
    el.innerHTML = '<section aria-roledescription="スライダー" aria-label="お知らせ"><div class="lab-sl-box">'
      + slides.map((s, i) => '<div class="lab-sl-s" role="group" aria-roledescription="スライド" aria-label="' + (i + 1) + ' / ' + slides.length + '"' + (i ? " hidden" : "") + '>'
        + '<div class="lab-sl-tx">' + (s.label ? '<p class="lab-sl-lb">' + esc(s.label) + "</p>" : "") + '<h2 class="lab-sl-h">' + esc(s.title) + "</h2>"
        + (s.body ? '<p class="lab-sl-p">' + esc(s.body) + "</p>" : "") + (s.cta ? '<a class="lab-sl-go" href="' + esc(href(s.href)) + '" data-lab-button="slide-' + (i + 1) + '">' + esc(s.cta) + "</a>" : "") + "</div>"
        + '<figure class="lab-sl-fig">' + (s.img ? '<img src="' + esc(s.img) + '" alt="' + esc(s.alt || "") + '" loading="' + (i ? "lazy" : "eager") + '">' : '<span class="lab-ph"><b>' + esc(s.title) + '</b><i aria-hidden="true"></i><em class="lab-tag">仮</em></span>')
        + (s.note ? '<figcaption class="lab-hand" aria-hidden="true">' + esc(s.note) + "</figcaption>" : "") + "</figure></div>").join("")
      + "</div>" + (slides.length > 1 ? '<div class="lab-ctl"><button type="button" class="lab-b" data-x="prev" aria-label="前へ">‹</button><div>'
        + slides.map((_, i) => '<button type="button" class="lab-b" data-x="' + i + '" aria-label="' + (i + 1) + '枚目のスライド">' + (i + 1) + "</button>").join("")
        + '</div><button type="button" class="lab-b" data-x="next" aria-label="次へ">›</button><button type="button" class="lab-b" data-x="toggle"></button><span class="lab-pos"></span></div>' : "") + "</section>";
    const ss = el.querySelectorAll(".lab-sl-s");
    const draw = () => {
      ss.forEach((s, i) => { s.hidden = i !== idx; });
      el.querySelectorAll('.lab-ctl [data-x]').forEach((b) => { if (/^\d+$/.test(b.dataset.x)) b.setAttribute("aria-current", String(Number(b.dataset.x) === idx)); });
      const t = el.querySelector('[data-x="toggle"]'); if (t) t.textContent = playing ? "一時停止" : "再生";
      const p = el.querySelector(".lab-pos"); if (p) { p.textContent = (idx + 1) + " / " + slides.length + (playing ? " ・ 自動再生中" : " ・ 一時停止中"); p.setAttribute("aria-live", playing ? "off" : "polite"); }
    };
    const tick = () => { clearInterval(timer); if (playing) timer = setInterval(() => { if (!hold) { idx = (idx + 1) % slides.length; draw(); } }, 7000); };
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-x]"); if (!b) return;
      const x = b.dataset.x;
      if (x === "prev") idx = (idx + slides.length - 1) % slides.length;
      else if (x === "next") idx = (idx + 1) % slides.length;
      else if (x === "toggle") playing = !playing;
      else idx = Number(x);
      if (x !== "toggle") playing = false; // 自分で動かしたら自動は止める
      draw(); tick();
    });
    // 触っている間・中にフォーカスがある間は切り替えない
    el.addEventListener("mouseenter", () => { hold = true; }); el.addEventListener("mouseleave", () => { hold = false; });
    el.addEventListener("focusin", () => { hold = true; }); el.addEventListener("focusout", () => { hold = false; });
    draw(); tick();
  }

  function shelf(el, shelves) {
    if (!shelves.length) { el.style.display = "none"; return; }
    let cur = 0;
    const draw = () => {
      el.innerHTML = '<div class="lab-sh-tabs">' + (shelves.length > 1 ? '<button type="button" class="lab-b" data-s="prev" aria-label="前の棚へ">‹</button>' : "")
        + shelves.map((s, i) => '<button type="button" class="lab-b" data-s="' + i + '" aria-pressed="' + (i === cur) + '">' + esc(s.name) + "</button>").join("")
        + (shelves.length > 1 ? '<button type="button" class="lab-b" data-s="next" aria-label="次の棚へ">›</button>' : "") + "</div>"
        + (() => {
          const s = shelves[cur];
          const books = s.books || [];
          return '<div class="lab-sh-hd"><h3>' + esc(s.name) + "</h3><span>" + esc(s.who || "") + (books.length ? " ・ 全" + books.length + "本" : "") + "</span></div>"
            + (books.length ? '<div class="lab-sh-row" role="region" tabindex="0" aria-label="' + esc(s.name) + 'へのおすすめ"><ol>'
              + books.map((b, i) => {
                const w = [72, 60, 64, 56, 68, 60, 64][i % 7], h = [256, 232, 244, 220, 248, 228, 240][i % 7];
                return "<li>" + (i === 0 ? '<span class="lab-hand" aria-hidden="true">ここから ↓</span>' : "")
                  + '<a class="lab-bk1' + (i === 0 ? " first" : "") + '" style="width:' + w + "px;height:" + h + 'px" href="/blog/' + encodeURIComponent(b.slug) + '?s=' + (cur + 1) + '">'
                  + "<small>" + (i + 1) + '<span class="lab-sr">本目 ' + esc(s.name) + "向け：</span></small><b>" + esc(b.title) + "</b><small>" + esc(b.kind || "記事") + "</small></a></li>";
              }).join("") + "</ol></div>"
              : '<p class="lab-pos">この棚の記事は準備中です。</p>');
        })();
    };
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-s]"); if (!b) return;
      const x = b.dataset.s;
      cur = x === "prev" ? (cur + shelves.length - 1) % shelves.length : x === "next" ? (cur + 1) % shelves.length : Number(x);
      draw();
      const again = el.querySelector('[data-s="' + x + '"]'); if (again) again.focus(); // 描き直しても押したボタンに戻る
    });
    draw();
  }

  async function sidebar(el, sb) {
    const me = await loadMe();
    const j = sb.join || {}, c = sb.consult || {}, m = sb.membership || {};
    const left = typeof c.left === "number"
      ? (c.left > 0 ? '<p>今月の募集枠：<span class="lab-left">残り ' + c.left + ' 名<svg aria-hidden="true" viewBox="0 0 140 60" preserveAspectRatio="none"><ellipse cx="70" cy="30" rx="66" ry="25" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--lab-red)" transform="rotate(-3 70 30)"></ellipse></svg></span></p>'
        : "<p><b>今月の募集枠は埋まりました。</b>次回はメールでお知らせします。</p>")
      : "";
    el.classList.add("lab-sb");
    el.innerHTML = (j.title ? '<section class="lab-join"><p class="k">無料</p><h2>' + esc(j.title) + "</h2>"
        + (me.logged_in ? "<p>" + esc(me.name ? me.name + "さん、" : "") + "ログイン中です。会員限定コンテンツをご覧いただけます。</p>"
          : (j.body ? "<p>" + esc(j.body) + "</p>" : "") + (j.form ? '<div data-join-form data-lab-cta="' + esc(j.cta || "無料会員登録") + '"></div>' : '<a class="go" href="' + esc(href(j.href)) + '" data-lab-button="side-join">' + esc(j.cta || "無料会員登録") + "</a>"))
        + "</section>" : "")
      + (c.title ? '<section id="consult"><p class="k">人数限定</p><h2>' + esc(c.title) + "</h2>" + (c.body ? "<p>" + esc(c.body) + "</p>" : "") + left
        + (c.left === 0 ? "" : '<a class="go" href="' + esc(href(c.href)) + '" data-lab-button="side-consult">' + esc(c.cta || "予約する") + "</a>") + "</section>" : "")
      + (m.title ? "<section><h2>" + esc(m.title) + "</h2>" + (m.body ? "<p>" + esc(m.body) + "</p>" : "") + (m.href ? '<a class="go" href="' + esc(href(m.href)) + '" data-lab-button="side-membership">' + esc(m.cta || "詳しく見る") + "</a>" : "") + "</section>" : "");
    const f = el.querySelector("[data-join-form]");
    if (f && j.form && !me.logged_in) mountForm(f, j.form);
  }

  async function categories(el) {
    const r = await fetch("/api/p/categories").then((x) => x.json()).catch(() => ({}));
    const cats = (r && r.categories) || [];
    if (!cats.length) { el.style.display = "none"; return; }
    el.classList.add("lab-cat");
    el.innerHTML = '<nav aria-label="カテゴリ"><h2>カテゴリ</h2><ul>' + cats.map((c) => '<li><a href="/blog?cat=' + encodeURIComponent(c.name) + '"><span style="color:inherit">' + esc(c.name) + "</span><span>" + c.count + " 本</span></a></li>").join("") + "</ul></nav>";
  }

  async function account(el) {
    const me = await loadMe();
    el.classList.add("lab-acc");
    if (!me.logged_in) { el.innerHTML = '<a href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">ログイン</a>'; return; }
    el.innerHTML = "<span>" + esc(me.name ? me.name + "さん" : "ログイン中") + '</span><button type="button" class="lab-b" data-out>ログアウト</button>';
    el.querySelector("[data-out]").addEventListener("click", async () => {
      if (PREVIEW) return;
      await fetch("/api/p/logout", { method: "POST" }).catch(() => {});
      location.reload();
    });
  }

  return function mount(el, v) {
    if (v === "slider:home") { loadHome().then((r) => slider(el, (r && r.ok && r.slides) || [])); return true; }
    if (v === "shelf:home") { loadHome().then((r) => shelf(el, (r && r.ok && r.shelves) || [])); return true; }
    if (v === "sidebar:home") { loadHome().then((r) => sidebar(el, (r && r.ok && r.sidebar) || {})); return true; }
    if (v === "categories") { categories(el); return true; }
    if (v === "account") { account(el); return true; }
    return false;
  };
}

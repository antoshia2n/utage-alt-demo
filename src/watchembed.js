// 公式サイトの作り直し 便 3（2026-11-25 Naoki OK）：記事（視聴ページ）の動き。embed.js の中に、この関数のソースをそのまま埋め込む
// 外の変数は使わない（ctx で受け取る）。
// - 動画：続きから再生（この端末で見た所を覚える）・再生速度（1／1.25／1.5／2 倍・この端末で覚える）
// - おすすめの順番：見終わった記事に「視聴済み」を付け、「視聴済み 2 / 6」と進み具合の帯を出す（この端末で覚える）
//   見終わった＝動画の記事は 9 割まで見た、動画の無い記事は記事の終わりまで読んだ（会員限定の続きが閉じている間は数えない）
export function watchEmbed(ctx) {
  const { store } = ctx;
  const art = document.querySelector(".lab-article[data-slug]");
  if (!art) return { scan() {} };
  const SLUG = art.getAttribute("data-slug");
  const doneSet = () => { try { const a = JSON.parse(store.get("lab_done") || "[]"); return new Set(Array.isArray(a) ? a : []); } catch (_) { return new Set(); } };
  function paintOrder() {
    const box = document.querySelector("[data-lab-order]");
    if (!box) return;
    const slugs = box.getAttribute("data-lab-order").split(",").filter(Boolean);
    const d = doneSet();
    const n = slugs.filter((x) => d.has(x)).length;
    const c = box.querySelector("[data-lab-count]");
    if (c) { c.dataset.base = c.dataset.base || c.textContent.split(" ・ ")[0]; c.textContent = c.dataset.base + " ・ 視聴済み " + n + " / " + slugs.length; }
    const bar = box.querySelector(".w-bar i");
    if (bar) bar.style.width = Math.round((n / Math.max(1, slugs.length)) * 100) + "%";
    box.querySelectorAll("a[data-slug]").forEach((a) => {
      const on = d.has(a.dataset.slug);
      a.classList.toggle("done", on);
      const t = a.querySelector(".tag");
      if (on && t && a.getAttribute("aria-current") !== "page") t.textContent = "視聴済み";
    });
  }
  function markDone() {
    const d = doneSet();
    if (d.has(SLUG)) return;
    d.add(SLUG);
    store.set("lab_done", JSON.stringify([...d].slice(-500)));
    paintOrder();
  }
  const locked = () => !!document.querySelector("[data-lab-gated][hidden]") && !document.documentElement.classList.contains("lab-in");
  paintOrder();

  // 動画の無い記事：記事の終わりまで読んだら見終わった
  if (art.getAttribute("data-video") !== "1" && "IntersectionObserver" in window) {
    const end = art.querySelector("[data-lab-end]");
    if (end) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !locked()) { markDone(); io.disconnect(); } });
      io.observe(end);
    }
  }

  // 動画：YouTube の仕組み（iframe_api）で動かす
  const RATES = [1, 1.25, 1.5, 2];
  let rate = Number(store.get("lab_yt_rate")) || 1;
  if (!RATES.includes(rate)) rate = 1;
  const fmt = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0"); };
  const items = [];
  let api = null, apiAsked = false;
  function want() {
    if (window.YT && window.YT.Player) { api = window.YT; start(); return; }
    if (apiAsked) return;
    apiAsked = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); api = window.YT; start(); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true; document.head.appendChild(s);
  }
  function start() {
    items.forEach((it) => {
      if (it.player || !api) return;
      it.player = new api.Player(it.box.querySelector("iframe"), {
        events: {
          onReady: (e) => { try { e.target.setPlaybackRate(rate); } catch (_) {} if (it.pending) { it.pending = false; e.target.seekTo(it.saved, true); e.target.playVideo(); } },
          onStateChange: (e) => {
            if (e.data === api.PlayerState.PLAYING) { try { e.target.setPlaybackRate(rate); } catch (_) {} }
            if (e.data === api.PlayerState.ENDED) { store.set(it.key, "0"); markDone(); }
          },
        },
      });
    });
  }
  function scan() {
    art.querySelectorAll(".lab-yt[data-yt]:not([data-ready])").forEach((box) => {
      box.setAttribute("data-ready", "1");
      const id = box.getAttribute("data-yt"), key = "lab_yt:" + id;
      const it = { box, id, key, saved: Number(store.get(key)) || 0, player: null, pending: false };
      const bar = document.createElement("div");
      bar.className = "lab-ytc"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "動画の操作");
      bar.innerHTML = (it.saved >= 30 ? '<button type="button" class="lab-resume" data-resume>続きから再生［' + fmt(it.saved) + "］</button>" : "")
        + '<span id="lab-rate-' + id + '">再生速度</span>'
        + RATES.map((r) => '<button type="button" data-rate="' + r + '" aria-pressed="' + (r === rate) + '" aria-describedby="lab-rate-' + id + '">' + r + "倍</button>").join("");
      box.after(bar);
      bar.addEventListener("click", (ev) => {
        const b = ev.target.closest("button"); if (!b) return;
        if (b.hasAttribute("data-resume")) {
          if (it.player && it.player.seekTo) { it.player.seekTo(it.saved, true); it.player.playVideo(); } else { it.pending = true; want(); }
          b.remove();
          const f = bar.querySelector("button"); if (f) f.focus();
          return;
        }
        rate = Number(b.getAttribute("data-rate")) || 1;
        store.set("lab_yt_rate", String(rate));
        document.querySelectorAll(".lab-ytc [data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.getAttribute("data-rate")) === rate)));
        items.forEach((x) => { if (x.player && x.player.setPlaybackRate) { try { x.player.setPlaybackRate(rate); } catch (_) {} } });
      });
      items.push(it);
    });
    if (items.length) want();
  }
  // 見た所を 5 秒ごとに覚える。9 割まで見たら見終わった
  setInterval(() => {
    items.forEach((it) => {
      const p = it.player;
      if (!p || !p.getCurrentTime || !p.getPlayerState || p.getPlayerState() !== 1) return;
      const t = p.getCurrentTime(), d = p.getDuration ? p.getDuration() : 0;
      if (d && t / d >= 0.9) markDone();
      store.set(it.key, d && d - t < 10 ? "0" : String(Math.floor(t)));
    });
  }, 5000);
  scan();
  return { scan };
}

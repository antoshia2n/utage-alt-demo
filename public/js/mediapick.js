// メディアの便 M2b（2026-11-07 Naoki OK 09:07）：「メディアから選ぶ」の窓。棚から 1 つ選ぶと、そのファイルの共有リンク（期限なし・名前は使い先）を作って住所を返す
//  ・呼ぶ側：LINE の自動応答の画像（mode "line"）／マイページの背景の画像（mode "image"）／レッスンの資料（mode "file"）
//  ・LINE は png か jpg・元が 10MB まで。1MB を超える画像は、ここでプレビュー（1024px までの jpg・1MB まで）を作って棚に置く
//  ・窓は自分の影の DOM（どの画面の見た目ともぶつからない）。開くと探す欄へ・Tab は中で回る・Esc で閉じる・閉じたら開いたボタンへ戻る
//  ・サーバー側の試験は tests/media-pick.test.mjs。窓そのもの（プレビューの大きさ・戻る先）は手元の試し台で確かめた（2026-11-07）
import { api } from "/js/common.js";

const KIND = { image: "画像", pdf: "PDF", slide: "スライド", video: "動画", audio: "音声", other: "そのほか" };
const MODES = {
  line: { title: "LINE で送る画像を選ぶ", kinds: ["image"], note: "LINE で送れるのは png か jpg で、10MB までです。1MB を超える画像は、トークに並ぶ小さなプレビューをここで作ります。" },
  image: { title: "画像を選ぶ", kinds: ["image"], note: "選ぶと、ログインなしで開ける共有リンクの住所が入ります。" },
  file: { title: "資料を選ぶ", kinds: ["pdf", "slide", "image", "other"], note: "選ぶと、ログインなしで開ける共有リンクの住所が入ります。止めたいときはメディアの画面の「共有」から止められます。" },
};
export const LINE_PREVIEW_MAX = 1024 * 1024;
export const LINE_IMAGE_MAX = 10 * 1024 * 1024;
const VIEW_TYPES = /^image[/](png|jpeg|gif|webp)$/;
const size = (n) => !n ? "" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const ERR = {
  no_file: "まだ写し終わっていないファイルです", not_found: "見つかりませんでした（消されたかもしれません）", no_store: "置き場につながっていません",
  preview_too_big: "プレビューを 1MB に収められませんでした", not_image: "画像ではないのでプレビューを作れません",
};

// 選べないときの理由（選べるなら空）。押したらこの文を出す（灰色で黙って押せなくしない）
export function blockReason(x, mode) {
  if (x.waiting) return "UTAGE から写している途中です。写し終わってから選べます（毎時 7 分に進みます）";
  if (x.kind !== "slide" && !x.has_file) return "ファイルがありません（写せなかったか、消されました）";
  const type = String(x.content_type || "").split(";")[0].trim();
  if (mode === "line") {
    if (!/^image[/](png|jpeg)$/.test(type)) return "LINE で送れる画像は png か jpg だけです";
    if ((x.size || 0) > LINE_IMAGE_MAX) return `LINE で送れる画像は 10MB までです（この画像は ${size(x.size)}）`;
  }
  if (mode === "image" && !VIEW_TYPES.test(type)) return "この形式の画像はブラウザで出せません（png・jpg・gif・webp を選んでください）";
  return "";
}
// LINE のプレビューが要るか
export const needsPreview = (x, mode) => mode === "line" && (x.size || 0) > LINE_PREVIEW_MAX;

// 画面の中で小さな jpg を作る（長い辺 1024px から、1MB に収まるまで小さく）
async function shrink(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    for (const edge of [1024, 800, 640, 480]) {
      const r = Math.min(1, edge / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * r)); c.height = Math.max(1, Math.round(bmp.height * r));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.7, 0.55]) {
        const out = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q));
        if (out && out.size <= LINE_PREVIEW_MAX - 16 * 1024) return out;
      }
    }
  } finally { if (bmp.close) bmp.close(); }
  return null;
}

export function pickMedia({ getToken, mode = "file", label = "", opener = document.activeElement } = {}) {
  const M = MODES[mode] || MODES.file;
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-media-pick", "");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial}
      .bg{position:fixed;inset:0;background:rgba(20,16,12,.45);display:grid;place-items:center;z-index:9999;padding:16px;font:14px/1.6 Geist,"Noto Sans JP",system-ui,sans-serif;color:var(--fg,#1a1a1a)}
      .dlg{background:var(--panel,#fff);border-radius:14px;width:min(720px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}
      .hd{padding:16px 18px 10px;border-bottom:1px solid var(--line,#e6dfd6)}
      h2{margin:0 0 4px;font-size:18px;font-weight:800}
      .note{margin:0;color:var(--muted,#6b6259);font-size:13px}
      .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
      input[type=search]{flex:1;min-width:180px;font:inherit;padding:7px 10px;border:1px solid var(--field,#a39a90);border-radius:8px;background:var(--panel,#fff);color:inherit}
      .chip{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--field,#a39a90);border-radius:999px;background:var(--panel,#fff);color:inherit;cursor:pointer}
      .chip[aria-pressed=true]{background:#b45309;border-color:#b45309;color:#fff}
      .list{overflow:auto;padding:6px 10px 10px;flex:1}
      .row{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px}
      .row+.row{border-top:1px solid var(--line,#e6dfd6)}
      .th{width:48px;height:48px;border-radius:8px;background:var(--soft,#f7f3ee);flex:none;display:grid;place-items:center;overflow:hidden;font-size:12px;color:var(--muted,#6b6259)}
      .th img{width:100%;height:100%;object-fit:cover}
      .nm{flex:1;min-width:0}
      .nm b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nm small{display:block;color:var(--muted,#6b6259);font-size:12px}
      .nm .why{color:#b42318}
      .btn{font:inherit;font-size:13px;padding:6px 14px;border-radius:8px;border:1px solid var(--field,#a39a90);background:var(--panel,#fff);color:inherit;cursor:pointer;white-space:nowrap}
      .btn.pri{background:#b45309;border-color:#b45309;color:#fff}
      .btn:focus-visible,.chip:focus-visible,input:focus-visible{outline:2px solid #b45309;outline-offset:2px}
      .ft{display:flex;gap:8px;align-items:center;padding:10px 18px;border-top:1px solid var(--line,#e6dfd6)}
      .st{flex:1;font-size:13px;color:var(--muted,#6b6259)}
      .empty{padding:24px 8px;color:var(--muted,#6b6259)}
      .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
      @media (pointer:coarse){.btn,.chip{min-height:44px;min-width:44px}input[type=search]{font-size:16px;min-height:44px}}
    </style>
    <div class="bg" id="bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="ttl">
      <div class="hd"><h2 id="ttl">${M.title}</h2><p class="note">${M.note}</p>
        <div class="bar"><label class="sr" for="q">探す</label><input type="search" id="q" placeholder="名前かフォルダの言葉で探す">
          ${M.kinds.length > 1 ? `<span role="group" aria-label="種類で絞る" style="display:flex;gap:6px;flex-wrap:wrap"><button class="chip" type="button" data-k="" aria-pressed="true">すべて</button>${M.kinds.map((k) => `<button class="chip" type="button" data-k="${k}" aria-pressed="false">${KIND[k]}</button>`).join("")}</span>` : ""}</div></div>
      <div class="list" id="list"><p class="empty">読み込んでいます…</p></div>
      <div class="ft"><span class="st" id="st" role="status" aria-live="polite"></span><button class="btn" type="button" id="cancel">キャンセル</button></div>
    </div></div>`;
    const $ = (s) => root.querySelector(s);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const say = (t) => { $("#st").textContent = t; };
    let items = [], kind = "", busy = false, done = false;
    const blobs = [];
    const finish = (val) => {
      if (done) return; done = true;
      blobs.forEach((u) => URL.revokeObjectURL(u)); if (io) io.disconnect();
      host.remove(); document.removeEventListener("keydown", onKey, true);
      if (opener && opener.isConnected) opener.focus();
      resolve(val);
    };
    // 小さな見本の画像（見えた行だけ・4 つずつ）
    let queue = [], running = 0;
    const pump = () => {
      while (running < 4 && queue.length) {
        const [img, id] = queue.shift(); running++;
        fetch("/api/admin/media/file?id=" + encodeURIComponent(id), { headers: { authorization: "Bearer " + getToken() } })
          .then((r) => r.ok ? r.blob() : null).then((b) => { if (b && !done) { const u = URL.createObjectURL(b); blobs.push(u); img.src = u; } })
          .catch(() => {}).finally(() => { running--; pump(); });
      }
    };
    const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); queue.push([e.target, e.target.dataset.id]); pump(); } })) : null;

    function draw() {
      const q = $("#q").value.trim().toLowerCase();
      const rows = items.filter((x) => (!kind || x.kind === kind) && (!q || (x.name + " " + x.folder).toLowerCase().includes(q))).slice(0, 300);
      $("#list").innerHTML = rows.length ? rows.map((x) => {
        const why = blockReason(x, mode);
        const thumb = x.kind === "image" && x.has_file ? `<img alt="" data-id="${esc(x.id)}">` : esc(KIND[x.kind] || "");
        const extra = !why && needsPreview(x, mode) ? "・LINE 用のプレビューを作ります" : "";
        return `<div class="row"><span class="th">${thumb}</span><span class="nm"><b>${esc(x.name)}</b><small>${esc(KIND[x.kind] || x.kind)}${x.folder ? "・" + esc(x.folder) : ""}${x.size ? "・" + size(x.size) : ""}${extra}</small>${why ? `<small class="why">${esc(why)}</small>` : ""}</span>
          <button class="btn ${why ? "" : "pri"}" type="button" data-pick="${esc(x.id)}" aria-label="「${esc(x.name)}」を選ぶ">選ぶ</button></div>`;
      }).join("") : `<p class="empty">${items.length ? "合うものがありません。言葉を変えてみてください" : "メディアの棚にまだありません。メディアの画面の「アップロード」から入れられます"}</p>`;
      if (io) $("#list").querySelectorAll("img[data-id]").forEach((im) => io.observe(im));
      $("#list").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.pick, b)));
    }

    async function choose(id, btn) {
      if (busy) return;
      const x = items.find((y) => y.id === id); if (!x) return;
      const why = blockReason(x, mode);
      if (why) { say(why); return; }
      busy = true; btn.setAttribute("aria-busy", "true");
      try {
        if (needsPreview(x, mode)) {
          say("LINE 用のプレビューを作っています…");
          const res = await fetch("/api/admin/media/file?id=" + encodeURIComponent(x.id), { headers: { authorization: "Bearer " + getToken() } });
          if (!res.ok) { say("画像を読めませんでした。もう一度試してください"); return; }
          const small = await shrink(await res.blob()).catch(() => null);
          if (!small) { say("プレビューを 1MB に収められませんでした。画像を小さくしてから入れ直してください"); return; }
          const up = await fetch("/api/admin/media/preview?id=" + encodeURIComponent(x.id), { method: "POST", headers: { authorization: "Bearer " + getToken(), "content-type": "image/jpeg" }, body: small });
          const ur = await up.json().catch(() => ({ ok: false, error: up.status }));
          if (!ur.ok) { say(ERR[ur.error] || `プレビューを置けませんでした（${ur.error}）`); return; }
        }
        say("共有リンクを作っています…");
        const r = await api("/api/admin/media/links", { method: "POST", token: getToken(), body: { media_id: x.id, label: String(label || "").slice(0, 60) } });
        if (!r.ok) { say(ERR[r.error] || `共有リンクを作れませんでした（${r.error || r.status}）`); return; }
        finish({ url: r.url, name: x.name, kind: x.kind, id: x.id });
      } finally { busy = false; if (!done) btn.removeAttribute("aria-busy"); }
    }

    const onKey = (e) => {
      if (done) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key !== "Tab") return;
      const f = [...root.querySelectorAll("button,input")].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const cur = root.activeElement, i = f.indexOf(cur);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    $("#cancel").addEventListener("click", () => finish(null));
    $("#bg").addEventListener("click", (e) => { if (e.target.id === "bg") finish(null); });
    $("#q").addEventListener("input", draw);
    root.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
      kind = b.dataset.k; root.querySelectorAll("[data-k]").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); draw();
    }));
    $("#q").focus();

    (async () => {
      const p = new URLSearchParams({ limit: "2000" });
      if (M.kinds.length === 1) p.set("kind", M.kinds[0]);
      const r = await api("/api/admin/media?" + p, { token: getToken() });
      if (done) return;
      if (!r.ok) { $("#list").innerHTML = `<p class="empty">読めませんでした（${esc(r.error || r.status)}）</p>`; return; }
      items = (r.items || []).filter((x) => M.kinds.includes(x.kind));
      draw();
    })();
  });
}

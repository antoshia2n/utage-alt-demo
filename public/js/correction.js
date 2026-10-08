// B の便 6a：添削を左右に並べて見せる（生徒の画面とシアニン用の画面で共通）。
//  ・指摘（notes）が無い添削：左に原文、右に添削後
//  ・指摘がある添削（長文）：左に原文（引用した範囲に色と番号）、右に番号つきの指摘。添削後とコメントはその下
//  範囲と指摘は同じ番号で結び、どちらかを押すと両方が光る。
// 2026-09-25 の判断「長文の添削は左に生徒の文・右に指摘を並べ、色の付いた範囲と指摘を同じ番号で結ぶ。短文の左右比較を伸ばして 1 つにする」の形。

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 原文を「印なし」と「番号つきの範囲」の切れ目に分ける。
// 同じ引用が 2 回あれば、前の印と重ならない次の出現を使う。重なって置けない指摘は印を付けずに右にだけ出す（placed に入らない）
export function markOriginal(original, notes) {
  const text = String(original ?? "");
  const spans = [];
  for (const n of notes || []) {
    const q = String(n.quote || "");
    if (!q) continue;
    let from = 0, at = -1;
    while ((at = text.indexOf(q, from)) !== -1) {
      const end = at + q.length;
      if (!spans.some((s) => at < s.end && s.start < end)) break;
      from = at + 1;
    }
    if (at !== -1) spans.push({ start: at, end: at + q.length, n: n.n });
  }
  spans.sort((a, b) => a.start - b.start);
  const parts = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) parts.push({ text: text.slice(pos, s.start) });
    parts.push({ text: text.slice(s.start, s.end), n: s.n });
    pos = s.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return { parts, placed: new Set(spans.map((s) => s.n)) };
}

function block(label, text, cls = "") {
  return `<div class="rb ${cls}"><div class="rb-l">${label}</div><div class="rb-t">${esc(text) || '<span class="note">（なし）</span>'}</div></div>`;
}

export function correctionHtml(m) {
  const notes = Array.isArray(m.notes) ? m.notes : [];
  if (!notes.length) {
    return `<div class="sbs">
      <div class="sbs-col">${block("原文", m.original, "orig")}</div>
      <div class="sbs-col">${block("添削後", m.corrected, "corr")}</div>
    </div>${m.comment ? block("コメント", m.comment) : ""}`;
  }
  const { parts, placed } = markOriginal(m.original, notes);
  const left = parts.map((p) => p.n
    ? `<mark class="nt" data-n="${p.n}" tabindex="0"><sup>${p.n}</sup>${esc(p.text)}</mark>`
    : esc(p.text)).join("");
  const right = notes.map((n) => `<li class="nt-item" data-n="${n.n}" tabindex="0">
      <span class="nt-no">${n.n}</span><div>${n.quote && !placed.has(n.n) ? `<div class="note">「${esc(n.quote)}」</div>` : ""}<div class="pre">${esc(n.text)}</div></div></li>`).join("");
  return `<div class="sbs long">
      <div class="sbs-col"><div class="rb-l">原文</div><div class="rb-t orig-marked">${left}</div></div>
      <div class="sbs-col"><div class="rb-l">指摘 ${notes.length} 件</div><ol class="nt-list">${right}</ol></div>
    </div>
    ${block("添削後", m.corrected, "corr")}${m.comment ? block("コメント", m.comment) : ""}`;
}

// 範囲と指摘を結ぶ（押すと同じ番号が光り、反対側の列をその位置まで動かす）
export function wireNotes(root) {
  root.querySelectorAll(".sbs.long").forEach((box) => {
    const light = (n, from) => {
      box.querySelectorAll("[data-n]").forEach((el) => el.classList.toggle("on", el.dataset.n === n));
      const other = box.querySelector(from === "mark" ? `.nt-item[data-n="${n}"]` : `mark[data-n="${n}"]`);
      if (other) other.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    box.querySelectorAll("mark[data-n]").forEach((el) => {
      el.addEventListener("click", () => light(el.dataset.n, "mark"));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") light(el.dataset.n, "mark"); });
    });
    box.querySelectorAll(".nt-item[data-n]").forEach((el) => {
      el.addEventListener("click", () => light(el.dataset.n, "item"));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") light(el.dataset.n, "item"); });
    });
  });
}

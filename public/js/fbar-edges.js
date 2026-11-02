// 2026-11-02：上の帯（全体・顧客・パーツ・会員サイト・ファネル構築・設定）が狭い画面で横に収まらないとき、
// 続きがある側の端を薄くして「まだある」と分かるようにする。選んだタブは帯の真ん中あたりへ送る。
// 作り方の決まり 5b「上の帯：スマホで全部入らないときは右端を薄くして続きがあると示す。今いるタブを見える位置へ送る」

// 端の薄さを今の位置に合わせる（more-l＝左に続きあり・more-r＝右に続きあり）
export function updateEdges(bar) {
  const rest = bar.scrollWidth - bar.clientWidth;
  bar.classList.toggle("more-l", rest > 1 && bar.scrollLeft > 1);
  bar.classList.toggle("more-r", rest > 1 && bar.scrollLeft < rest - 1);
}

// 選んでいるタブを見える位置へ送る（ページ全体は動かさない）
export function revealSelected(bar) {
  const btn = bar.querySelector('[aria-selected="true"]');
  if (btn && bar.scrollWidth > bar.clientWidth) {
    const b = btn.getBoundingClientRect(), r = bar.getBoundingClientRect();
    const left = b.left - r.left + bar.scrollLeft - (bar.clientWidth - b.width) / 2;
    bar.scrollLeft = Math.max(0, Math.min(left, bar.scrollWidth - bar.clientWidth));
  }
  updateEdges(bar);
}

// 帯を動かしたとき・画面の幅が変わったときに端を合わせ直す
export function watchEdges(bar) {
  bar.addEventListener("scroll", () => updateEdges(bar), { passive: true });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => revealSelected(bar)).observe(bar);
  else addEventListener("resize", () => revealSelected(bar));
  updateEdges(bar);
}

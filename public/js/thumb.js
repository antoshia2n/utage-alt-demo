// 録画のサムネ（型 A「帯」・2026-11-15 Naoki OK「Aかな」・デモ https://claude.ai/artifact/T3fsJEgR9Zv6MqrBmGwaB9 ）
//  ・絵は画像にせず、言葉（大きな一言・補足）だけを録画の保管（zoom-to-youtube の shelf/meta/ の thumb）に持つ。ここで毎回描く
//  ・言葉は AI が文字起こしから作る。録画の棚の詳細で編集できる
//  ・大きさは入れ物の幅に合わせる（cqw）。入れ物は 16:9 で、position: relative を持っていること
//  ・シアニン用の画面（録画の棚）と生徒の画面（教材のカード）の両方がこの 1 つを使う

const KAI = { "セミナー": "#2563eb", "打ち合わせ": "#7c3aed", "個別相談": "#0d9488", "Zoom添削": "#db2777", "その他": "#a39a90" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** t = { big, sub, kai, date }。date は YYYY-MM-DD */
export function thumbA(t, { showKai = true } = {}) {
  const kai = t.kai || "その他";
  const date = String(t.date || "").replace(/-/g, ".");
  return `<span class="thumb-a" aria-hidden="true" style="container-type:inline-size;position:absolute;inset:0;display:flex;background:#f5f0eb;color:#1a1a1a;font-family:'Noto Sans JP',system-ui,sans-serif;overflow:hidden;text-align:left">`
    + `<span style="width:2.2cqw;flex:none;background:#f59e0b"></span>`
    + `<span style="flex:1;min-width:0;padding:5.6cqw 6.9cqw;display:flex;flex-direction:column;justify-content:space-between">`
    + `<span style="display:flex;align-items:center;gap:1.9cqw">`
    + (showKai ? `<span style="display:inline-flex;align-items:center;gap:.9cqw;padding:.8cqw 1.9cqw;border-radius:99px;background:#fff;font-size:2.4cqw;font-weight:700;line-height:1.4"><i style="display:inline-block;width:1.25cqw;height:1.25cqw;border-radius:50%;background:${KAI[kai] || KAI["その他"]}"></i>${esc(kai)}</span>` : "")
    + (date ? `<span style="font-size:2.4cqw;font-weight:500;color:#6b6259">${esc(date)}</span>` : "")
    + `</span>`
    + `<span style="display:flex;flex-direction:column;gap:2.2cqw">`
    + `<b style="font-size:8.75cqw;font-weight:900;line-height:1.12;letter-spacing:-.02em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.big || "録画")}</b>`
    + (t.sub ? `<span style="font-size:3.3cqw;font-weight:700;color:#6b6259;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.sub)}</span>` : "")
    + `</span>`
    + `<span style="align-self:flex-end;font-size:2.4cqw;font-weight:900;color:#b45309">シアニン</span>`
    + `</span></span>`;
}

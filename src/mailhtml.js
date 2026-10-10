// B の便 11b：メールの見た目の型（1 つ）と、開いたかを数える画像。
// 本文は今までどおり文字で書く。次の書き方だけが特別に変わる：
//   [[ボタンの文字|https://…]] … 見た目の付いたボタンになる。文字だけのメールでは「ボタンの文字：住所」になる
//   https://… の住所            … 押せるリンクになる
// 型は見出し（シアラボ）・本文・ボタン・末尾（事業者名と配信停止）の順。色はログインのメールと同じ緑。

export const BUTTON_RE = /\[\[([^\[\]|\r\n]{1,40})\|(https?:\/\/[^\s\]<>"']{1,1000})\]\]/g;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'\]]+/g;
const GREEN = "#1f5c4d";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 文字だけのメール：ボタンの書き方を「文字：住所」に直す
export function mailText(text) {
  return String(text).replace(BUTTON_RE, (_, label, url) => `${label.trim()}：${url}`);
}

function bodyHtml(text) {
  const parts = [];
  let last = 0;
  const src = String(text);
  for (const m of src.matchAll(BUTTON_RE)) {
    parts.push({ t: src.slice(last, m.index) });
    parts.push({ label: m[1].trim(), url: m[2] });
    last = m.index + m[0].length;
  }
  parts.push({ t: src.slice(last) });
  // ボタンの前後の改行は 1 つずつ詰める（ボタンの上下の余白と重なって間が空きすぎるため）
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].url) continue;
    if (parts[i - 1]) parts[i - 1].t = parts[i - 1].t.replace(/\r?\n$/, "");
    if (parts[i + 1]) parts[i + 1].t = parts[i + 1].t.replace(/^\r?\n/, "");
  }
  return parts.map((p) => {
    if (p.url) {
      return `<div style="margin:20px 0;white-space:normal"><a href="${escapeHtml(p.url)}" style="background:${GREEN};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-weight:bold">${escapeHtml(p.label)}</a></div>`;
    }
    // 住所は押せるリンクにする（住所の前後は文字のまま）
    let out = "", at = 0;
    for (const u of p.t.matchAll(URL_IN_TEXT)) {
      out += escapeHtml(p.t.slice(at, u.index)) + `<a href="${escapeHtml(u[0])}" style="color:${GREEN}">${escapeHtml(u[0])}</a>`;
      at = u.index + u[0].length;
    }
    return out + escapeHtml(p.t.slice(at));
  }).join("");
}

// 見た目の付いたメール。footHtml は mailcfg.footer の html（事業者名・配信停止）。openUrl があれば開いたかを数える画像を最後に置く
export function mailHtml(text, { footHtml = "", openUrl = "", brand = "シアラボ" } = {}) {
  return `<div style="background:#f4f6f5;padding:24px 12px;font-family:-apple-system,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif">`
    + `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e8e6">`
    + `<div style="background:${GREEN};color:#ffffff;padding:14px 24px;font-size:15px;font-weight:bold;letter-spacing:1px">${escapeHtml(brand)}</div>`
    + `<div style="padding:24px;color:#222;font-size:15px;line-height:1.9;white-space:pre-wrap;word-break:break-word">${bodyHtml(text)}</div>`
    + `<div style="padding:16px 24px;border-top:1px solid #e3e8e6;font-size:12px;color:#777;line-height:1.7">${footHtml}</div>`
    + `</div></div>`
    + (openUrl ? `<img src="${escapeHtml(openUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : "");
}

// 開いたかを数える画像（1 × 1 の透明な GIF）
export const PIXEL_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

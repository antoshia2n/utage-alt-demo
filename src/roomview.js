// B の便 15b：部屋を「添削」と「やり取り」の 2 つの枠に分ける（2026-10-10 Naoki「OK」）。表は増やさない。
//   添削の枠   … correction_submitted と correction_returned（今までどおり）
//   やり取りの枠 … room_chat（教材の質問と答えを含む）と、ここで作る 1 行の知らせ
// 1 行の知らせは、今ある出来事（予約・取り消し・セミナーの申込・申し込み（購入）・フォームの回答）から読むだけで、新しく書かない。

export const NOTICE_TYPES = ["consult_booked", "consult_canceled", "seminar_registered", "purchase_completed", "form_submitted"];
export const NOTICE_MAX = 50;

// 出来事 1 つを、画面に出す 1 行の知らせの形にする
export function toNotice(e) {
  const p = e.payload || {};
  const base = { id: e.id, kind: "notice", type: e.type, at: e.occurred_at };
  switch (e.type) {
    case "consult_booked": return { ...base, title: "個別相談の予約", detail: p.type_title || "個別相談", slot: p.slot || null };
    case "consult_canceled": return { ...base, title: "予約の取り消し", detail: p.type_title || "個別相談", slot: p.slot || null };
    case "seminar_registered": return { ...base, title: "セミナーの申込", detail: p.title || "" };
    case "purchase_completed": return { ...base, title: "お申し込み", detail: p.product_name || "", ...(p.mode === "test" ? { test: true } : {}) };
    case "form_submitted": return { ...base, title: "フォームの回答", detail: p.title || p.slug || "" };
    default: return null;
  }
}

// 1 人の知らせ（古い順・新しいものから NOTICE_MAX 件）
export async function roomNotices(db, env, personId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(personId || ""))) return [];
  const evs = await db(env, "GET", `events?select=id,type,payload,occurred_at&customer_id=eq.${personId}&type=in.(${NOTICE_TYPES.join(",")})&order=id.desc&limit=${NOTICE_MAX}`);
  return evs.reverse().map(toNotice).filter(Boolean);
}

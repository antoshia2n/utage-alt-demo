// 公開の面・ログインの面・シアニン用の画面で共通に使うもの
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let clientPromise = null;

export function getClient() {
  if (!clientPromise) {
    clientPromise = fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        if (!c.supabaseUrl || !c.supabaseKey || String(c.supabaseUrl).startsWith("SET_")) {
          throw new Error("まだ設定が入っていません（Supabase の住所と公開の鍵）");
        }
        // メールのリンクを別のブラウザで開いても入れるように implicit を使う
        return createClient(c.supabaseUrl, c.supabaseKey, {
          auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
        });
      });
  }
  return clientPromise;
}

export async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ ok: false, error: "bad_response" }));
  if (!res.ok && data.ok !== false) data.ok = false;
  data.status = res.status;
  return data;
}

export const SOURCE_LABEL = { x: "X", note: "note", youtube: "YouTube", direct: "直接", other: "その他" };

export const EVENT_LABEL = {
  registered: "無料登録",
  register_again: "登録フォームを再送",
  login: "ログイン",
  lesson_viewed: "教材を開いた",
  announcement_opened: "お知らせを開いた",
  note_member_set: "note メンバーの印を変更",
  correction_submitted: "添削を出した",
  correction_returned: "添削を返した",
  room_read: "添削ルームを読んだ",
  subscription_started: "入会（定期課金が始まった）",
  subscription_payment: "定期課金の入金",
  subscription_failed: "定期課金の失敗",
  subscription_canceled: "定期課金の解約",
  subscription_suspended: "定期課金の停止",
  email_sent: "メールを送った",
  email_failed: "メールを送れなかった",
  email_blocked: "メールを送らなかった",
  email_unsubscribed: "メールの配信を止めた",
  consult_booked: "個別相談を予約した",
  consult_canceled: "個別相談の予約を取り消した",
  consult_done: "面談した",
  deal_won: "成約",
  deal_lost: "失注",
  seminar_registered: "セミナーに申し込んだ",
  seminar_reminded: "セミナーの前日の知らせ",
  seminar_archive_sent: "セミナーのアーカイブを配った",
  seminar_notice_sent: "セミナーの知らせを送った",
  seminar_full: "セミナーが定員で申し込めなかった",
  purchase_completed: "購入（決済が通った）",
  email_clicked: "メールのリンクを押した",
  label_added: "ラベルを付けた",
  label_removed: "ラベルを外した",
  admin_notified: "シアニンに知らせた",
  admin_notify_failed: "シアニンに知らせられなかった",
  connector_skipped: "コネクタの条件に当たらなかった",
  room_chat: "メッセージ",
  push_subscribed: "スマホの通知を受け取り始めた",
  push_unsubscribed: "スマホの通知をやめた",
  referred: "紹介のリンクから登録",
  referral_reward: "紹介した人が買った（報酬）",
  referral_paid: "紹介の報酬を払った",
  form_submitted: "フォームに答えた",
  page_viewed: "ページを見た",
  page_clicked: "ページのボタンを押した",
  grants_synced: "権利を合わせた",
};

// ログインが要る画像を読み、画面に出せる住所に変える（img の src に鍵を付けられないため）
const imageCache = new Map();
export async function authImage(path, token) {
  if (imageCache.has(path)) return imageCache.get(path);
  const p = fetch(path, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((b) => URL.createObjectURL(b));
  imageCache.set(path, p);
  p.catch(() => imageCache.delete(path));
  return p;
}

// 送る前に画像を縮める（長い辺 1600px・JPEG）。縮められない形式はそのまま
export async function shrinkImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
    return blob || file;
  } catch (_) { return file; }
}

export function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 流入元の印：?src=x などを最初に来たときだけ覚える
export function rememberSource() {
  const src = new URLSearchParams(location.search).get("src");
  if (src) { try { sessionStorage.setItem("src", src); } catch (_) {} }
}
export function currentSource() {
  try { return sessionStorage.getItem("src") || "direct"; } catch (_) { return "direct"; }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

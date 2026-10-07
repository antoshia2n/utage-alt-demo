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
};

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

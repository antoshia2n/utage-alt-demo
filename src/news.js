// お知らせ（2026-10-29 13:06 Naoki「OK」）：会員サイト › お知らせで書く・日時を決めて出す・取り下げる。
//  表は今のお知らせの表（本番 b_announcements）をそのまま使い、欄 status（published・draft・withdrawn）を足した（supabase/b25_news.sql）。
//  生徒に出すのは「status が published で、published_at を過ぎたもの」だけ。日時を決めて出すときは published_at を先の時刻にする。
//  デモの置き場（B_STORE が無い）の表には status が無いので、今までどおり全部を出す。

export const NEWS_STATUSES = ["published", "draft", "withdrawn"];
const TITLE_MAX = 120, BODY_MAX = 4000;

// 生徒に出すお知らせを読む問い合わせ（新しい順）
export function newsQuery(env, limit = 20, nowIso = new Date().toISOString()) {
  const base = `announcements?select=id,title,body,published_at&order=published_at.desc&limit=${limit}`;
  return env.B_STORE ? `${base}&status=eq.published&published_at=lte.${encodeURIComponent(nowIso)}` : base;
}

// 書く画面から来た値を確かめる。mode：now（すぐ出す）・at（日時を決めて出す）・draft（下書き）
export function checkNews(b = {}, now = Date.now()) {
  const title = String(b.title ?? "").trim().slice(0, TITLE_MAX);
  if (!title) return { ok: false, error: "title_required", field: "title" };
  const body = String(b.body ?? "").trim().slice(0, BODY_MAX);
  const mode = ["now", "at", "draft"].includes(b.mode) ? b.mode : "now";
  let published_at = new Date(now).toISOString();
  if (mode === "at") {
    const t = Date.parse(b.at || "");
    if (!Number.isFinite(t)) return { ok: false, error: "at_required", field: "at" };
    if (t < now - 60e3) return { ok: false, error: "at_in_past", field: "at" };
    published_at = new Date(t).toISOString();
  }
  return { ok: true, row: { title, body, published_at, status: mode === "draft" ? "draft" : "published" } };
}

export function makeNews({ db }) {
  const demo = (env) => (!env.B_STORE ? { ok: false, error: "demo_store" } : null);

  async function list(env) {
    const d = demo(env); if (d) return d;
    const rows = await db(env, "GET", "announcements?select=id,title,body,published_at,status,updated_at,updated_by&order=published_at.desc&limit=200");
    const now = Date.now();
    return { ok: true, news: rows.map((r) => ({ ...r, state: r.status !== "published" ? r.status : Date.parse(r.published_at) > now ? "scheduled" : "live" })) };
  }

  async function save(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const c = checkNews(b);
    if (!c.ok) return c;
    const row = { ...c.row, updated_at: new Date().toISOString(), updated_by: String(by || "").slice(0, 200) };
    if (b.id != null && b.id !== "") {
      if (!/^\d{1,12}$/.test(String(b.id))) return { ok: false, error: "bad_id" };
      // 直すとき、すでに出ているものの日時は変えない（「すぐ出す」のまま直したら、並びが動かないように）
      if (b.mode === "now") {
        const [cur] = await db(env, "GET", `announcements?select=published_at,status&id=eq.${b.id}`);
        if (!cur) return { ok: false, error: "not_found" };
        if (cur.status === "published" && Date.parse(cur.published_at) <= Date.now()) row.published_at = cur.published_at;
      }
      const rows = await db(env, "PATCH", `announcements?id=eq.${b.id}`, row);
      return rows.length ? { ok: true, id: rows[0].id } : { ok: false, error: "not_found" };
    }
    const [r] = await db(env, "POST", "announcements", [row], "return=representation");
    return { ok: true, id: r.id };
  }

  // 取り下げる・戻す・下書きにする（消さない）
  async function setStatus(env, { id, status } = {}, by) {
    const d = demo(env); if (d) return d;
    if (!/^\d{1,12}$/.test(String(id ?? ""))) return { ok: false, error: "bad_id" };
    if (!NEWS_STATUSES.includes(status)) return { ok: false, error: "bad_status" };
    const rows = await db(env, "PATCH", `announcements?id=eq.${id}`, { status, updated_at: new Date().toISOString(), updated_by: String(by || "").slice(0, 200) });
    return rows.length ? { ok: true } : { ok: false, error: "not_found" };
  }

  return { list, save, setStatus };
}

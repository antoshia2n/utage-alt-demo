// B の便 8d：変えた記録と「元に戻す」。
// 設定（表 b_settings の 1 行）と部品の持ち主（b_campaign_parts の 1 行）を変えたとき、前と後を b_inbound_log に channel=change で 1 件ずつ残す。
// 元に戻すと前の値を書き戻し、channel=change_undone で「どれを戻したか」を残す。同じ記録は 1 回だけ戻せる。
// 同じ設定・同じ部品に、あとから別の変更が入っていたら戻さない（新しい変更を黙って消さないため）。先に新しいほうを戻す。
// 表は増やさない（記録は b_inbound_log、戻す先はもとの表）。

export const CHANGE_KINDS = ["setting", "part"];
const PART_RE = /^([a-z]{2,20}):(.{1,80})$/;

export function makeChanges(h) {
  const { db, logInbound } = h;

  async function record(env, { kind, target, before = null, after = null, summary = "", actor = "" }) {
    if (!env.B_STORE) return;
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await logInbound(env, "change", { kind, target, before, after, summary: String(summary).slice(0, 200), actor: String(actor).slice(0, 200) }, { ok: true }, 200);
  }

  async function rows(env, limit = 200) {
    return await db(env, "GET", `inbound_log?select=id,channel,request,at&channel=in.(change,change_undone)&order=id.desc&limit=${limit}`);
  }

  function shape(all) {
    const undone = new Map();
    for (const r of all) if (r.channel === "change_undone" && r.request && r.request.of != null) undone.set(Number(r.request.of), r);
    return all.filter((r) => r.channel === "change").map((r) => {
      const q = r.request || {};
      const u = undone.get(Number(r.id));
      return { id: r.id, at: r.at, kind: q.kind, target: q.target, summary: q.summary || "", actor: q.actor || "", before: q.before ?? null, after: q.after ?? null,
        undone: !!u, undone_at: u ? u.at : null, undone_by: u ? (u.request || {}).by || "" : null };
    });
  }

  async function list(env, { limit = 50 } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const changes = shape(await rows(env, 400)).slice(0, lim);
    return { ok: true, count: changes.length, changes };
  }

  async function undo(env, { id }, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const n = parseInt(id, 10);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "bad_id" };
    const all = shape(await rows(env, 400));
    const c = all.find((x) => Number(x.id) === n);
    if (!c) return { ok: false, error: "change_not_found", note: "直近 400 件の記録の中に無い" };
    if (c.undone) return { ok: false, error: "already_undone", undone_at: c.undone_at };
    if (!CHANGE_KINDS.includes(c.kind)) return { ok: false, error: "cannot_undo_kind", kind: c.kind };
    const newer = all.find((x) => Number(x.id) > n && x.kind === c.kind && x.target === c.target && !x.undone);
    if (newer) return { ok: false, error: "newer_change", newer_id: newer.id, note: "あとの変更を先に戻す" };
    const now = new Date().toISOString();
    const by = String(actor || "").slice(0, 200);
    if (c.kind === "setting") {
      if (!/^[a-z_]{2,40}$/.test(String(c.target))) return { ok: false, error: "bad_target" };
      await db(env, "POST", "settings?on_conflict=key", [{ key: c.target, value: c.before == null ? "" : String(c.before), updated_at: now, updated_by: by }], "resolution=merge-duplicates,return=minimal");
    } else {
      const m = String(c.target).match(PART_RE);
      if (!m) return { ok: false, error: "bad_target" };
      const [, type, pid] = m;
      if (!c.before || !c.before.campaign_id) {
        await db(env, "DELETE", `b_campaign_parts?part_type=eq.${type}&part_id=eq.${encodeURIComponent(pid)}`, undefined, "return=minimal");
      } else {
        await db(env, "POST", "b_campaign_parts?on_conflict=part_type,part_id",
          [{ part_type: type, part_id: pid, campaign_id: c.before.campaign_id, role: c.before.role || "", updated_at: now, updated_by: by }],
          "resolution=merge-duplicates,return=minimal");
      }
    }
    await logInbound(env, "change_undone", { of: n, kind: c.kind, target: c.target, restored: c.before, by }, { ok: true }, 200);
    return { ok: true, id: n, kind: c.kind, target: c.target, restored: c.before };
  }

  return { record, list, undo };
}

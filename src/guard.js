// B の便 3：AI（MCP）の道具ごとの権限（自動・承認・禁止）と、承認待ちの台帳。
// 権限の表は b_permissions、承認待ちは b_approvals（本番の置き場だけにある。デモの置き場では今までどおり全部「自動」）。
// AI は自分の権限を変えられない：権限を変える道具は MCP に出さず、シアニン用の画面（b_admins のメールで入る）だけが変える。
// 権限の変更・承認・却下は b_inbound_log に「誰がやったか」付きで 1 件ずつ残す。
// 承認の形は Pay-kun の「承認を頼む」に合わせる：AI は承認待ちを作って URL を返す → Naoki が画面で中身を見て「承認して実行」。

export const MODES = ["auto", "approve", "deny"];

// 便 8d から：表に行が無い道具のうち、下の一覧にあるものは、最初に使うとき（または権限の一覧を開いたとき）にこの値で表へ入れる。
// 新しい道具の最初の値は、プルリクの中のこの一覧で決まり、Naoki の Merge で入る（SQL Editor に貼る手を減らすため）。入れたあとは画面で変えられる。
// 一覧に無い道具は今までどおり「禁止」。表にある行は上書きしない。
// （以前の決まり）表に行が無い道具は「禁止」。新しい道具を足したら、ここと SQL（b3_permissions.sql・b4_products.sql・b5_delivery.sql・b6a_learn.sql・b6b_bridge.sql・b7a_settings.sql・b8c_plan.sql）の最初の値を両方足す
export const DEFAULT_MODES = {
  find_person: "auto", get_timeline: "auto", stats: "auto",
  list_rooms: "auto", get_room: "auto", list_consults: "auto", list_seminars: "auto",
  list_approvals: "auto", get_approval: "auto", list_permissions: "auto",
  send_seminar_reminder: "auto",
  send_email: "approve", return_correction: "approve", set_deal_stage: "approve",
  set_note_member: "approve", send_seminar_archive: "approve",
  list_products: "auto", set_product: "approve",
  // 便 12c：継続課金の一覧は自動、解約は承認（UnivaPay の課金を永久に止めるため）
  list_subscriptions: "auto", cancel_subscription: "approve",
  preview_audience: "auto", list_broadcasts: "auto", draft_broadcast: "auto", cancel_broadcast: "auto", list_steps: "auto",
  queue_broadcast: "approve", set_step: "approve",
  list_lessons: "auto", list_corrections: "auto",
  get_meetings: "auto", list_tables: "auto",
  get_community_link: "auto", set_community_link: "approve",
  list_campaigns: "auto", get_blueprint: "auto", create_campaign: "auto", set_part_campaign: "auto",
  archive_campaign: "approve",
  // 便 8g-3：一言の下書きは動かない下書きだけを作るので自動（動かすのは set_step の承認）
  draft_flow: "auto",
  // 便 8g-4：読む・テンプレの保存・下書きを作るのは自動（何も動かない）。ブロックをまとめて動かすのは承認
  list_blocks: "auto", list_templates: "auto", save_template: "auto", use_template: "auto", copy_campaign: "auto", publish_block: "approve",
  get_mail_settings: "auto", set_mail_settings: "approve",
  get_tidy_plan: "auto", apply_tidy: "approve", list_changes: "auto", undo_change: "approve",
  // 便 8e：ラベルを読むのは自動、人の行を変える手のラベルは承認（B の原則 3 の最初の値に合わせる）
  get_labels: "auto", add_label: "approve", remove_label: "approve",
  // 便 11a：項目とフォームを読む・項目を足すのは自動（何も送らない）。フォームを作る・公開するのは承認（外の人が見る面のため）
  list_fields: "auto", set_field: "auto", list_forms: "auto", list_answers: "auto", set_form: "approve",
  // 便 8f-1：読むのは自動、カレンダーの非公開 URL を変えるのは承認
  get_today: "auto", get_stage_board: "auto", set_calendar_url: "approve",
  // 便 8f-3：生徒へのメッセージは承認（添削の返信と同じ）、Naoki への通知と端末の一覧は自動
  send_chat: "approve", notify_naoki: "auto", get_push_status: "auto",
  // 便 8g-2：紹介の集計を読むのは自動、払った記録はお金の記録なので承認
  list_referrals: "auto", mark_referral_paid: "approve",
  // 便 12a：ページ。読む・依頼を読む・下書きを置く・経路を数えるのは自動（外の人には何も見えない）。公開と止めるのは承認
  list_pages: "auto", get_page: "auto", list_page_requests: "auto", get_page_request: "auto", save_page_draft: "auto", list_routes: "auto",
  publish_page: "approve",
  // 便 13：セミナーの回を読むのは自動。回を作る・知らせを足す・いま送るは承認（申込者へ届くもの・外から申し込める回が増えるため）
  get_seminar: "auto", set_seminar: "approve", set_seminar_notice: "approve", send_seminar_notice: "approve",
  // 便 13b：予約の種類を読む・空き時間を見るのは自動。種類を作る・直すのは承認（外から予約できる枠が増えるため）
  list_booking_types: "auto", get_booking_type: "auto", get_booking_slots: "auto", set_booking_type: "approve",
};

// 権限を問わず通す道具（承認待ちを見るための道具が承認待ちになると回らないため）
const ALWAYS = new Set(["list_approvals", "get_approval", "list_permissions"]);

const APPROVAL_STATUS = ["pending", "approved", "rejected", "expired", "failed"];

export function makeGuard(h) {
  const { db, logInbound } = h;

  // 一覧にあって表に無い道具を、一覧の値で表へ入れる（ある行は触らない）
  async function seedDefaults(env, only) {
    const have = new Set((await db(env, "GET", "b_permissions?select=tool")).map((r) => r.tool));
    const missing = Object.keys(DEFAULT_MODES).filter((t) => !have.has(t) && (!only || t === only));
    if (!missing.length) return [];
    await db(env, "POST", "b_permissions?on_conflict=tool",
      missing.map((tool) => ({ tool, mode: DEFAULT_MODES[tool], note: "最初の値（コードの一覧）", updated_at: new Date().toISOString(), updated_by: "default" })),
      "resolution=ignore-duplicates,return=minimal");
    await logInbound(env, "permission_default", { tools: missing.map((t) => ({ tool: t, mode: DEFAULT_MODES[t] })) }, { ok: true }, 200);
    return missing;
  }

  async function modeOf(env, tool) {
    if (!env.B_STORE) return "auto";
    if (ALWAYS.has(tool)) return "auto";
    const rows = await db(env, "GET", `b_permissions?select=mode&tool=eq.${encodeURIComponent(tool)}`);
    if (rows.length) return rows[0].mode;
    if (DEFAULT_MODES[tool]) { await seedDefaults(env, tool); return DEFAULT_MODES[tool]; }
    return "deny";
  }

  async function listPermissions(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", note: "デモの置き場では権限の表を使わない（全部自動）", permissions: [] };
    await seedDefaults(env);
    const rows = await db(env, "GET", "b_permissions?select=tool,mode,note,updated_at,updated_by&order=tool.asc");
    return { ok: true, count: rows.length, permissions: rows, unknown_tool_mode: "deny" };
  }

  async function setPermission(env, { tool, mode }, adminEmail) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!/^[a-z_]{2,40}$/.test(String(tool || ""))) return { ok: false, error: "bad_tool" };
    if (!MODES.includes(mode)) return { ok: false, error: "bad_mode" };
    const before = await db(env, "GET", `b_permissions?select=mode&tool=eq.${tool}`);
    await db(env, "POST", "b_permissions?on_conflict=tool",
      [{ tool, mode, updated_at: new Date().toISOString(), updated_by: adminEmail }], "resolution=merge-duplicates,return=minimal");
    await logInbound(env, "permission", { tool, from: before.length ? before[0].mode : null, to: mode, by: adminEmail }, { ok: true }, 200);
    return { ok: true, tool, mode };
  }

  async function requestApproval(env, tool, args, origin) {
    const [row] = await db(env, "POST", "b_approvals",
      [{ tool, args: args || {}, requested_by: "mcp" }], "return=representation");
    await logInbound(env, "approval", { action: "requested", id: row.id, tool }, { ok: true }, 200);
    return {
      ok: true,
      pending_approval: true,
      approval_id: row.id,
      approval_url: `${origin}/admin#approval/${row.id}`,
      expires_at: row.expires_at,
      note: "この道具は承認が要る。Naoki が画面で「承認して実行」を押すまで実行されない。approval_url を Naoki に渡して待つこと",
    };
  }

  function shape(r) {
    const expired = r.status === "pending" && new Date(r.expires_at).getTime() < Date.now();
    return { ...r, status: expired ? "expired" : r.status };
  }

  async function listApprovals(env, { status = "pending", limit = 50 } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, approvals: [] };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    let q = `b_approvals?select=*&order=created_at.desc&limit=${lim}`;
    if (status && status !== "all") {
      if (!APPROVAL_STATUS.includes(status)) return { ok: false, error: "bad_status" };
      q += `&status=eq.${status === "expired" ? "pending" : status}`;
    }
    let rows = (await db(env, "GET", q)).map(shape);
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    return { ok: true, count: rows.length, approvals: rows };
  }

  async function getApproval(env, { approval_id }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(approval_id || ""))) return { ok: false, error: "bad_approval_id" };
    const [row] = await db(env, "GET", `b_approvals?select=*&id=eq.${approval_id}`);
    if (!row) return { ok: true, found: false };
    return { ok: true, found: true, approval: shape(row) };
  }

  // 承認なら、頼まれたときの中身のまま道具を実行する（実行は AI の操作として actor=mcp で残る）
  async function decide(env, { approval_id, decision }, adminEmail, run) {
    if (!["approve", "reject"].includes(decision)) return { ok: false, error: "bad_decision" };
    const g = await getApproval(env, { approval_id });
    if (!g.ok || !g.found) return { ok: false, error: "not_found" };
    const a = g.approval;
    if (a.status !== "pending") return { ok: false, error: "already_" + a.status };
    // 先に印を付けて、2 回押しても 2 回実行されないようにする（pending の行だけが変わる）
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    const claimed = await db(env, "PATCH", `b_approvals?id=eq.${a.id}&status=eq.pending`,
      { status: nextStatus, decided_at: new Date().toISOString(), decided_by: adminEmail }, "return=representation");
    if (claimed.length === 0) return { ok: false, error: "already_decided" };
    let result = null;
    if (decision === "approve") {
      try { result = await run(a.tool, a.args || {}); }
      catch (e) { result = { ok: false, error: "failed", detail: String(e.message).slice(0, 300) }; }
      await db(env, "PATCH", `b_approvals?id=eq.${a.id}`,
        { status: result && result.ok === false ? "failed" : "approved", result }, "return=minimal");
    }
    await logInbound(env, "approval", { action: decision, id: a.id, tool: a.tool, by: adminEmail },
      { ok: !(result && result.ok === false) }, 200);
    return { ok: true, approval_id: a.id, status: decision === "approve" ? (result && result.ok === false ? "failed" : "approved") : "rejected", result };
  }

  async function aiLog(env, { limit = 100 } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, items: [] };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
    const rows = await db(env, "GET", `inbound_log?select=id,channel,request,response,status,at&channel=in.(mcp,approval,permission)&order=at.desc&limit=${lim}`);
    return { ok: true, count: rows.length, items: rows };
  }

  return { modeOf, listPermissions, setPermission, requestApproval, listApprovals, getApproval, decide, aiLog, ALWAYS };
}

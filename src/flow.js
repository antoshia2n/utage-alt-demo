// 便 T5（2026-11-08 Naoki OK 09:23）：シナリオの「流れ」。部品を相手が通る順に 1 列に並べ、カードごとに
//   相手に見える中身・状態・配信タイミング・「Naoki が作るもの」・承認待ち・AI の案を返す。
//   AI と作る：画面で「AI と作る」→ 依頼（b_ai_drafts・status asked）と依頼文 → claude.ai に貼る → AI が put_ai_draft で案を置く（ready）
//   → 画面で今の本文と並べ、直して「採用」（adopted）か「採用しない」（dropped）。採用するまで配信中の本文は変わらない。
//   中から Claude の API は呼ばない（2026-10-21 の決め）。採用はシアニン用の画面からだけ（AI からは採用できない）。
import { TRIGGERS, ACTIONS } from "./connect.js";

const LANE_ORDER = ["meet", "signup", "warm", "consult", "buy", "learn", "refer"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_RE = /^[a-z][a-z_]{1,19}$/;
const NOTE_MAX = 1000;
const BODY_MAX = 5000;
export const AI_TARGETS = ["step", "line_invite"];

// 配信タイミング（時間の数 → 「直後」「2日後」「1日 6時間後」）
export function delayText(h) {
  const n = Number(h) || 0, d = Math.floor(n / 24), r = n % 24;
  if (!n) return "直後";
  return d && r ? `${d}日 ${r}時間後` : d ? `${d}日後` : `${r}時間後`;
}

// 「Naoki が作るもの」：文の中の「Naoki が〜」の行と、行まるごとの（…）の空欄。HTML はタグを外して読む
export function todosOf(text) {
  const plain = String(text || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
  const out = [];
  for (const raw of plain.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/Naoki が/.test(l) || /^（[^（）]{2,80}）$/.test(l)) {
      let t;
      if (/^（[^（）]*）$/.test(l)) {
        // 行まるごとの空欄「（…。Naoki が入れる）」
        t = l.slice(1, -1).replace(/[。、]?\s*は?\s*Naoki が(決めて)?入れる$/, "").replace(/[。、：:]$/, "").trim();
      } else {
        // 行の途中の「（住所は Naoki が入れる）」→「：住所」
        t = l.replace(/（([^（）]*?)\s*は?\s*Naoki が(決めて)?入れる）/g, (m, a) => (a.trim() ? "：" + a.trim().replace(/[：:]$/, "") : "")).trim();
      }
      if (t && !out.includes(t)) out.push(t.length > 80 ? t.slice(0, 80) + "…" : t);
    }
  }
  return out;
}

const LINE_ACCOUNT_NAME = { shianin: "シアニン", college_ops: "言語化ライティングカレッジ運営" };

export function makeFlow(h) {
  const { db, plan, guard, line, pages } = h;

  async function aiOpen(env, keys) {
    if (!keys.length) return new Map();
    const rows = await db(env, "GET", `b_ai_drafts?select=*&status=in.(asked,ready)&order=created_at.desc&limit=200`);
    const m = new Map();
    for (const r of rows) { const k = `${r.part_type}:${r.part_id}`; if (keys.includes(k) && !m.has(k)) m.set(k, r); }
    return m;
  }

  // 承認待ちを、どのカードのものかに引き当てる
  function approvalKeys(ap) {
    const a = ap.args || {};
    const out = [];
    if (ap.tool === "set_step" && a.id) out.push(`step:${a.id}`);
    if (ap.tool === "publish_block" && Array.isArray(a.step_ids)) for (const id of a.step_ids) out.push(`step:${id}`);
    if (ap.tool === "set_line_invite" && a.account) out.push(`line_invite:${a.account}`);
    if (ap.tool === "set_form" && a.id) out.push(`form:${a.id}`);
    if (ap.tool === "set_booking_type" && a.id) out.push(`booking:${a.id}`);
    if ((ap.tool === "publish_page" || ap.tool === "set_page_close") && a.page_id) out.push(`page:${a.page_id}`);
    return out;
  }
  const APPROVAL_WHAT = { set_step: "ステップ配信の変更", publish_block: "ブロックの配信開始", set_line_invite: "友だち追加の案内の文の変更", set_form: "フォームの変更", set_booking_type: "予約の種類の変更", publish_page: "ページの公開", set_page_close: "ページの公開期限" };

  async function flow(env, { campaign_id } = {}) {
    if (!UUID_RE.test(String(campaign_id || ""))) return { ok: false, error: "bad_campaign_id" };
    const bp = await plan.blueprint(env, { campaign_id });
    if (bp.ok === false) return bp;
    const camp = (bp.campaigns || []).find((c) => c.id === campaign_id);
    if (!camp) return { ok: false, error: "campaign_not_found" };
    const parts = bp.parts || [];
    const stepIds = parts.filter((p) => p.type === "step").map((p) => p.id);
    const steps = stepIds.length ? await db(env, "GET", `b_steps?select=*&id=in.(${stepIds.join(",")})`) : [];
    const stepById = new Map(steps.map((s) => [String(s.id), s]));
    const cards = [];
    for (const p of parts) {
      const base = { key: p.key, type: p.type, id: p.id, lane: p.lane, name: p.name, state: p.state, outside: !!p.outside, week: p.week };
      if (p.type === "step") {
        const s = stepById.get(String(p.id));
        if (!s) continue;
        const ta = s.trigger_args || {};
        const sel = s.selector || {};
        const test = Array.isArray(sel.emails) && sel.emails.length > 0 && Object.keys(sel).length === 1;
        cards.push({ ...base, name: s.name || p.name, kind: s.action === "send_line" ? "LINE" : s.action === "send_email" ? "メール" : "ステップ配信",
          trigger: s.trigger, delay_hours: s.delay_hours || 0,
          when: `${(TRIGGERS[s.trigger] || {}).label || s.trigger}${ta.account ? `（${LINE_ACCOUNT_NAME[ta.account] || ta.account}）` : ""}から ${delayText(s.delay_hours)}`,
          action_label: ACTIONS[s.action] || s.action, subject: s.subject || "", text: s.body || "", editable: ["send_line", "send_email", "notify_admin"].includes(s.action),
          audience: test ? `テスト配信（${sel.emails.length} 人）` : Object.keys(sel).length ? "条件で絞った人" : "トリガーに当たった人全員",
          state: s.active ? (test ? "test" : "running") : "draft", line_account: (s.action_args || {}).account || ta.account || null });
      } else if (p.type === "page") {
        const r = await pages.getPage(env, { page_id: p.id }).catch(() => null);
        const pg = r && r.page;
        cards.push({ ...base, kind: "ページ", when: pg && pg.closes_at ? `公開期限 ${pg.closes_at}` : "", text: "", todo_source: (r && r.html) || "",
          link_admin: `#page/${p.id}`, url: p.url || null, state: pg ? (pg.status === "published" ? "running" : "draft") : p.state });
      } else if (p.type === "form") {
        const [f] = await db(env, "GET", `b_forms?select=id,slug,title,intro,thanks,active&id=eq.${p.id}`);
        cards.push({ ...base, kind: "フォーム", text: f ? [f.intro, f.thanks ? "答えたあと：" + f.thanks : ""].filter(Boolean).join("\n") : "", state: f && f.active ? "running" : "draft", note: p.outside || !(p.campaigns || []).length ? "シナリオに未追加（設計図から追加できます）" : "" });
      } else if (p.type === "booking") {
        const [b] = await db(env, "GET", `b_booking_types?select=id,slug,title,description,minutes,active&id=eq.${p.id}`);
        cards.push({ ...base, kind: "予約", text: b ? [b.description, `長さ ${b.minutes} 分`].filter(Boolean).join("\n") : "", state: b && b.active ? "running" : "draft" });
      } else {
        cards.push({ ...base, kind: p.type, text: "" });
      }
    }
    // LINE 連携のステップがあれば、その前に「友だち追加の案内」を入れる（アカウントごとに 1 枚）
    const accounts = [...new Set(cards.filter((c) => c.trigger === "line_linked" && c.line_account).map((c) => c.line_account))];
    for (const acc of accounts) {
      if (!ACCOUNT_RE.test(acc)) continue;
      const r = await line.inviteText(env, acc);
      cards.push({ key: `line_invite:${acc}`, type: "line_invite", id: acc, lane: "signup", kind: "LINE", name: `${LINE_ACCOUNT_NAME[acc] || acc} の LINE：友だち追加の案内`,
        when: "友だち追加のとき（1 回）", text: r.text || "友だち追加ありがとうございます。\nお知らせをメールでも受け取れるよう、こちらからメールアドレスを登録してください。\n（その人専用の登録のリンク）",
        uses_default: !r.text, state: "running", editable: true, audience: "新しく友だち追加した人全員" });
    }
    // 並べる：段階 → LINE の案内 → 配信タイミング → 名前
    const typeOrder = { page: 0, form: 1, line_invite: 2, step: 3, booking: 4 };
    cards.sort((a, b) => (LANE_ORDER.indexOf(a.lane) + 1 || 99) - (LANE_ORDER.indexOf(b.lane) + 1 || 99)
      || (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || (a.delay_hours || 0) - (b.delay_hours || 0) || String(a.name).localeCompare(String(b.name)));
    // Naoki が作るもの・承認待ち・AI の案
    const pend = await guard.listApprovals(env, { status: "pending" });
    const byKey = new Map();
    const other = [];
    for (const ap of (pend.approvals || [])) {
      const ks = approvalKeys(ap).filter((k) => cards.some((c) => c.key === k));
      if (!ks.length) { other.push(ap.id); continue; }
      for (const k of ks) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ id: ap.id, tool: ap.tool, what: APPROVAL_WHAT[ap.tool] || ap.tool, created_at: ap.created_at, expires_at: ap.expires_at, body: (ap.args || {}).body ?? (ap.args || {}).text ?? null }); }
    }
    const drafts = await aiOpen(env, cards.map((c) => c.key));
    const lanes = Object.fromEntries((bp.lanes || []).map((l) => [l.id, l.label]));
    for (const c of cards) {
      c.stage = lanes[c.lane] || c.lane;
      c.todos = todosOf(c.todo_source || c.text);
      delete c.todo_source;
      c.approvals = byKey.get(c.key) || [];
      const d = drafts.get(c.key);
      c.ai = d ? { id: d.id, status: d.status, note: d.note, draft: d.draft, created_at: d.created_at } : null;
      c.ai_ok = AI_TARGETS.includes(c.type) && !!c.editable;
    }
    return { ok: true, campaign: { id: camp.id, name: camp.name, starts_on: camp.starts_on }, cards,
      counts: { parts: cards.length, todo: cards.filter((c) => c.todos.length).length, pending: cards.reduce((n, c) => n + c.approvals.length, 0) }, other_pending: other.length };
  }

  // ---------- AI と作る ----------
  async function partContext(env, part_type, part_id) {
    if (part_type === "step") {
      const [s] = await db(env, "GET", `b_steps?select=*&id=eq.${Number(part_id) || 0}`);
      if (!s) return null;
      return { name: s.name, text: s.body || "", subject: s.subject || "", when: `${(TRIGGERS[s.trigger] || {}).label || s.trigger}から ${delayText(s.delay_hours)}`, action: s.action, row: s };
    }
    if (part_type === "line_invite") {
      if (!ACCOUNT_RE.test(String(part_id))) return null;
      const r = await line.inviteText(env, part_id);
      return { name: `${LINE_ACCOUNT_NAME[part_id] || part_id} の LINE：友だち追加の案内`, text: r.text || "", when: "友だち追加のとき（1 回）", action: "line_invite" };
    }
    return null;
  }

  function promptText(req, ctx, campName) {
    return [
      `マーケくんの AI の案の依頼 ${req.id} です。マーケくんの道具 get_ai_draft で依頼の中身（シナリオの前後の配信と企画の情報）を読み、put_ai_draft で案を置いてください。`,
      `シナリオ：${campName || "（なし）"}`,
      `直すもの：${ctx.name}（${ctx.when}）`,
      `ひとこと：${req.note || "（なし）"}`,
      "置くのは案だけです。配信中の本文は変えないでください。採用は Naoki が画面で決めます。",
    ].join("\n");
  }

  async function createRequest(env, { part_type, part_id, note, campaign_id } = {}, by = "admin") {
    if (!AI_TARGETS.includes(part_type)) return { ok: false, error: "bad_part_type", types: AI_TARGETS };
    const ctx = await partContext(env, part_type, part_id);
    if (!ctx) return { ok: false, error: "part_not_found" };
    const n = String(note || "").trim();
    if (n.length > NOTE_MAX) return { ok: false, error: "too_long", max: NOTE_MAX };
    if (campaign_id && !UUID_RE.test(String(campaign_id))) return { ok: false, error: "bad_campaign_id" };
    // 同じ部品の開いている依頼は閉じてから作る（1 枚に案は 1 つ）
    await db(env, "PATCH", `b_ai_drafts?part_type=eq.${part_type}&part_id=eq.${encodeURIComponent(String(part_id))}&status=in.(asked,ready)`, { status: "dropped", decided_at: new Date().toISOString(), decided_by: String(by).slice(0, 200) }, "return=minimal");
    const [row] = await db(env, "POST", "b_ai_drafts", [{ id: crypto.randomUUID(), part_type, part_id: String(part_id), note: n, base_text: ctx.text, campaign_id: campaign_id || null, status: "asked", created_by: String(by).slice(0, 200) }], "return=representation");
    let campName = "";
    if (campaign_id) { const [c] = await db(env, "GET", `b_campaigns?select=name&id=eq.${campaign_id}`); campName = c ? c.name : ""; }
    return { ok: true, request: row, prompt: promptText(row, ctx, campName) };
  }

  // AI が読む：依頼・今の本文・同じシナリオの前後の配信
  async function getRequest(env, { id } = {}) {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const [req] = await db(env, "GET", `b_ai_drafts?select=*&id=eq.${id}`);
    if (!req) return { ok: false, error: "not_found" };
    const ctx = await partContext(env, req.part_type, req.part_id);
    if (!ctx) return { ok: false, error: "part_not_found" };
    let neighbors = [];
    let campaign = null;
    if (req.campaign_id) {
      const f = await flow(env, { campaign_id: req.campaign_id });
      if (f.ok) {
        campaign = f.campaign;
        neighbors = f.cards.map((c) => ({ key: c.key, kind: c.kind, name: c.name, when: c.when || "", text: (c.text || "").slice(0, 1500), this_one: c.key === `${req.part_type}:${req.part_id}` }));
      }
    }
    return { ok: true, request: { id: req.id, status: req.status, note: req.note, part_type: req.part_type, part_id: req.part_id }, target: { name: ctx.name, when: ctx.when, action: ctx.action, text: ctx.text, subject: ctx.subject || "" },
      campaign, flow: neighbors,
      rules: "案は本文だけ。LINE は 2000 字まで・件名なし。{{name}} などの差し込みはそのまま使える。実在しない実績や数字を書かない。決まっていないことは（Naoki が入れる：〜）と空欄で残す。" };
  }

  // AI が置く（案だけ。配信中の本文は変えない）
  async function putDraft(env, { id, body } = {}, by = "mcp") {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const t = String(body || "").trim();
    if (!t) return { ok: false, error: "need_body" };
    if (t.length > BODY_MAX) return { ok: false, error: "too_long", max: BODY_MAX };
    const [req] = await db(env, "GET", `b_ai_drafts?select=*&id=eq.${id}`);
    if (!req) return { ok: false, error: "not_found" };
    if (!["asked", "ready"].includes(req.status)) return { ok: false, error: "closed", status: req.status };
    if (req.part_type === "step") {
      const [s] = await db(env, "GET", `b_steps?select=action&id=eq.${Number(req.part_id) || 0}`);
      if (s && s.action === "send_line" && t.length > 2000) return { ok: false, error: "too_long", max: 2000 };
    }
    await db(env, "PATCH", `b_ai_drafts?id=eq.${id}`, { draft: t, status: "ready", drafted_at: new Date().toISOString(), drafted_by: String(by).slice(0, 200) }, "return=minimal");
    return { ok: true, id, status: "ready", note: "画面の「流れ」のカードに、今の本文と並べて出ます。採用は Naoki が決めます" };
  }

  // 画面から：採用（body を渡すとその文で）・採用しない
  async function decide(env, { id, action, body } = {}, by = "admin") {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const [req] = await db(env, "GET", `b_ai_drafts?select=*&id=eq.${id}`);
    if (!req) return { ok: false, error: "not_found" };
    if (!["asked", "ready"].includes(req.status)) return { ok: false, error: "closed", status: req.status };
    const now = new Date().toISOString();
    if (action === "drop") {
      await db(env, "PATCH", `b_ai_drafts?id=eq.${id}`, { status: "dropped", decided_at: now, decided_by: String(by).slice(0, 200) }, "return=minimal");
      return { ok: true, status: "dropped" };
    }
    if (action !== "adopt") return { ok: false, error: "bad_action" };
    const text = String(body ?? req.draft ?? "").trim();
    if (!text) return { ok: false, error: "need_body" };
    let r;
    if (req.part_type === "step") r = await h.setStepBody(env, Number(req.part_id), text, by);
    else if (req.part_type === "line_invite") r = await line.setInviteText(env, { account: req.part_id, text }, by);
    else return { ok: false, error: "bad_part_type" };
    if (!r || r.ok === false) return r || { ok: false, error: "save_failed" };
    await db(env, "PATCH", `b_ai_drafts?id=eq.${id}`, { status: "adopted", adopted_text: text, decided_at: now, decided_by: String(by).slice(0, 200) }, "return=minimal");
    return { ok: true, status: "adopted" };
  }

  return { flow, createRequest, getRequest, putDraft, decide };
}

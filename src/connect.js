// B の便 8e：コネクタ（トリガー → セレクタ → アクション）と、自動で付くラベル。
// 表は増やさない。コネクタは表 b_steps を広げた行（supabase/b8e_connect.sql）。動かすのは src/deliver.js の毎時の処理。
//   トリガー（〜したら）… 出来事の記録の種類。下の TRIGGERS から選ぶ
//   セレクタ（誰に）   … 一斉配信の宛先と同じ形の条件（流入元・買った・会員か・ラベル）。空なら全員
//   アクション（〜する）… メールを送る／Naoki に知らせる／ラベルを付ける
// ラベルは出来事の記録から毎回計算する（流入元・会員かどうか・買った商品・押したリンク・参加した企画・最後に動いた日）。
// 手で付けるラベルは例外で、出来事 label_added／label_removed に積む（コネクタの「ラベルを付ける」も同じ出来事）。

export const TRIGGERS = {
  registered:           { type: "registered",           label: "無料登録した" },
  purchase:             { type: "purchase_completed",   label: "買った" },
  clicked:              { type: "email_clicked",        label: "メールのリンクを押した" },
  lesson_viewed:        { type: "lesson_viewed",        label: "教材を見た" },
  correction_submitted: { type: "correction_submitted", label: "添削を出した" },
  login:                { type: "login",                label: "ログインした" },
  label_added:          { type: "label_added",          label: "ラベルが付いた" },
};

export const ACTIONS = { send_email: "メールを送る", notify_admin: "Naoki に知らせる", add_label: "ラベルを付ける" };

// コネクタが積む出来事（同じきっかけで 2 回動かないように数える）。failed は 3 回まで試し直す
export const DONE_TYPES = ["email_sent", "email_blocked", "email_failed", "admin_notified", "admin_notify_failed", "label_added", "connector_skipped"];
export const FAIL_TYPES = ["email_failed", "admin_notify_failed"];

// ラベルの名前：空白・カンマ・山かっこ・引用符を含まない 1〜40 文字
export const LABEL_RE = /^[^\s,<>"'`]{1,40}$/u;

const SOURCE_NAME = { x: "X", note: "note", youtube: "YouTube", direct: "直接", other: "その他" };
// 「最後に動いた日」に数える、本人が動いた出来事
const ACTIVE_TYPES = new Set(["registered", "login", "lesson_viewed", "correction_submitted", "email_clicked", "purchase_completed", "seminar_registered", "consult_booked", "announcement_opened"]);
export const LABEL_EVENT_TYPES = ["registered", "login", "lesson_viewed", "correction_submitted", "email_clicked", "email_sent",
  "purchase_completed", "seminar_registered", "consult_booked", "announcement_opened", "label_added", "label_removed"];

const byTime = (a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || (Number(a.id || 0) - Number(b.id || 0));

// 商品の外の名前（生徒に見える名前）をラベルに使える形にする。空白は詰め、カンマや引用符は「・」に、36 文字まで（「買った:」と合わせて 40）
export function productLabelName(name) {
  const s = String(name || "").replace(/\s+/g, "").replace(/[,<>"'`]+/g, "・").replace(/^・+|・+$/g, "");
  return s.slice(0, 36);
}

// 1 人分の自動ラベル。ownerOf は部品の鍵（step:12・broadcast:uuid）→ 企画名（常設は入れない）。productNames は商品の番号 → 外の名前
export function autoLabels({ person, events = [], member = false, ownerOf = {}, productNames = {}, now = Date.now() }) {
  const out = new Set();
  out.add("流入元:" + (SOURCE_NAME[person.source] || person.source || "不明"));
  out.add(member ? "会員" : "会員でない");
  let last = person.created_at ? new Date(person.created_at).getTime() : 0;
  for (const e of events) {
    const p = e.payload || {};
    if (ACTIVE_TYPES.has(e.type)) last = Math.max(last, new Date(e.occurred_at).getTime());
    // 便 8f-1：商品の中の番号ではなく外の名前で出す（統括 2026-10-09 13:18）。名前が引けないときだけ番号
    if (e.type === "purchase_completed" && p.product_id) { out.add("購入者"); out.add("買った:" + (productLabelName(productNames[p.product_id] || p.product_name) || p.product_id)); }
    else if (e.type === "email_clicked") out.add("リンクを押した");
    else if (e.type === "lesson_viewed") out.add("教材を見た");
    else if (e.type === "correction_submitted") out.add("添削を出した");
    else if (e.type === "seminar_registered") out.add("セミナーに申し込んだ");
    else if (e.type === "consult_booked") out.add("個別相談を予約した");
    else if (e.type === "email_sent") {
      const key = p.kind === "step" && p.step_id != null ? `step:${p.step_id}` : p.kind === "broadcast" && p.broadcast_id ? `broadcast:${p.broadcast_id}` : null;
      if (key && ownerOf[key]) out.add("企画:" + ownerOf[key]);
    }
  }
  const days = last ? (now - last) / 864e5 : Infinity;
  out.add(days <= 7 ? "最後に動いた:7日以内" : days <= 30 ? "最後に動いた:30日以内" : "最後に動いた:30日より前");
  return [...out];
}

// 付けた（手・コネクタ）ラベル。古い順に足し引きした結果
export function manualLabels(events = []) {
  const s = new Set();
  for (const e of [...events].filter((x) => x.type === "label_added" || x.type === "label_removed").sort(byTime)) {
    const l = e.payload && e.payload.label;
    if (!l) continue;
    if (e.type === "label_added") s.add(l); else s.delete(l);
  }
  return [...s];
}

// 自動と手を合わせる。同じ名前なら自動を優先（手で付けた印は付けない）
export function mergeLabels(auto, manual) {
  const a = new Set(auto);
  return [...auto.map((label) => ({ label, auto: true })), ...manual.filter((l) => !a.has(l)).map((label) => ({ label, auto: false }))];
}

// 出来事の記録の actor の決まり（site・admin・mcp・webhook・seed）に合わせる
export function eventActor(actor) {
  if (actor === "mcp" || actor === "site" || actor === "webhook" || actor === "seed") return actor;
  return String(actor || "").includes("@") ? "admin" : "site";
}

export function makeConnect(h) {
  const { db, addEvent, logInbound, sell } = h;

  async function ownersMap(env) {
    if (!env.B_STORE) return {};
    const [owners, campaigns] = await Promise.all([
      db(env, "GET", "b_campaign_parts?select=part_type,part_id,campaign_id"),
      db(env, "GET", "b_campaigns?select=id,name,kind"),
    ]);
    const cname = Object.fromEntries(campaigns.filter((c) => c.kind !== "standing").map((c) => [c.id, c.name]));
    const out = {};
    for (const o of owners) if (cname[o.campaign_id]) out[`${o.part_type}:${o.part_id}`] = cname[o.campaign_id];
    return out;
  }

  async function productNameMap(env) {
    if (!env.B_STORE) return {};
    return Object.fromEntries((await db(env, "GET", "b_products?select=id,name")).map((p) => [p.id, p.name]));
  }

  // 全員のラベル（Map：人の番号 → [{label, auto}]）。onlyIds を渡すとその人だけ
  async function labelMap(env, onlyIds = null) {
    let pq = "customer_summary?select=id,source,created_at&limit=10000";
    let eq = `events?select=id,customer_id,type,payload,occurred_at&type=in.(${LABEL_EVENT_TYPES.join(",")})&order=id.asc&limit=50000`;
    if (onlyIds && onlyIds.length) { pq += `&id=in.(${onlyIds.join(",")})`; eq += `&customer_id=in.(${onlyIds.join(",")})`; }
    const [people, events, ent, ownerOf, productNames] = await Promise.all([db(env, "GET", pq), db(env, "GET", eq), sell.entitlementMap(env), ownersMap(env), productNameMap(env)]);
    const byPerson = new Map();
    for (const e of events) { if (!byPerson.has(e.customer_id)) byPerson.set(e.customer_id, []); byPerson.get(e.customer_id).push(e); }
    const out = new Map();
    for (const p of people) {
      const evs = byPerson.get(p.id) || [];
      out.set(p.id, mergeLabels(autoLabels({ person: p, events: evs, member: !!(ent[p.id] && ent[p.id].member), ownerOf, productNames }), manualLabels(evs)));
    }
    return out;
  }

  // 1 人のラベル、または全員のラベルの人数（person_id を省いたとき）
  async function getLabels(env, { person_id } = {}) {
    if (person_id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(person_id))) return { ok: false, error: "bad_person_id" };
      const m = await labelMap(env, [person_id]);
      if (!m.has(person_id)) return { ok: true, found: false };
      return { ok: true, found: true, person_id, labels: m.get(person_id) };
    }
    const m = await labelMap(env);
    const counts = {};
    for (const list of m.values()) for (const x of list) {
      const k = x.label;
      counts[k] = counts[k] || { label: k, auto: x.auto, people: 0 };
      counts[k].people++;
    }
    const labels = Object.values(counts).sort((a, b) => Number(b.auto) - Number(a.auto) || b.people - a.people || a.label.localeCompare(b.label));
    return { ok: true, people: m.size, count: labels.length, labels };
  }

  async function changeLabel(env, { person_id, label }, actor, add, extra = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const l = String(label || "").trim();
    if (!LABEL_RE.test(l)) return { ok: false, error: "bad_label", note: "空白・カンマ・山かっこ・引用符を含まない 1〜40 文字" };
    const [p] = await db(env, "GET", `customers?select=id&id=eq.${person_id}`);
    if (!p) return { ok: true, found: false };
    const evs = await db(env, "GET", `events?select=id,type,payload,occurred_at&customer_id=eq.${person_id}&type=in.(label_added,label_removed)&order=id.asc&limit=2000`);
    const has = manualLabels(evs).includes(l);
    // もう同じ状態なら出来事を積まない（「ラベルが付いたら」のコネクタが同じ人で回り続けないため）
    if (add === has) return { ok: true, found: true, label: l, changed: false };
    await addEvent(env, person_id, add ? "label_added" : "label_removed", { label: l, by: String(actor).slice(0, 120), ...extra }, eventActor(actor));
    return { ok: true, found: true, label: l, changed: true };
  }
  const addLabel = (env, args, actor, extra) => changeLabel(env, args, actor, true, extra);
  const removeLabel = (env, args, actor) => changeLabel(env, args, actor, false);

  // Naoki（b_admins の全員）へ知らせる。テスト宛ての制限は通さない（宛先がシアニンだけのため）
  async function notifyAdmins(env, { subject, text }) {
    const admins = await db(env, "GET", "admins?select=email");
    if (!admins.length) return { sent: 0, failed: 0, error: "no_admins" };
    const cfg = await h.mailcfg.get(env);
    if (!env.EMAIL || !cfg.from) return { sent: 0, failed: admins.length, error: "mail_not_configured" };
    let sent = 0, failed = 0, error = null;
    for (const a of admins) {
      try { await env.EMAIL.send({ to: a.email, from: h.mailcfg.fromField(cfg), subject, text }); sent++; }
      catch (e) { failed++; error = String(e && e.message || e).slice(0, 200); }
    }
    if (failed) await logInbound(env, "notify", { subject, admins: admins.length }, { ok: false, sent, failed, error }, 500);
    return { sent, failed, error };
  }

  return { labelMap, getLabels, addLabel, removeLabel, notifyAdmins };
}

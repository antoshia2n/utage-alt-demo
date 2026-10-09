// B の便 8g-4：ブロックとテンプレ。
//   ブロック … 企画の中の部品のひとまとまり。b_campaign_parts.block_name で持つ。入口と出口は保存せず、線（コネクタの設定）から毎回出す
//   テンプレ … b_templates。kind block（ブロック 1 つ）／campaign（企画まるごと）。中身 body はコネクタの設定の写し（draft_flow と同じ形）
//               同じ名前で保存し直すと版 version を 1 つ上げる。テンプレを直しても、作った部品は変わらない（作った元と版だけを部品に残す）
//   複製・テンプレから作る … 必ず下書き（動かない）。元に開催日があれば、新しい開催日が無いと作らない
//   まとめて動かす（publish_block）… 承認が要る。頼んだ時点でブロックの中の下書きの番号と、部品の一覧（種類・名前・宛先の人数）を
//               承認の中身に書き込む。承認されたら、その番号の下書きだけを動かす（頼んだあとに足されたものは動かさない）

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NAME_MAX = 80;
const BLOCK_MAX = 60;
// テンプレに写すコネクタの欄（番号・状態・動かした時刻は写さない）
const STEP_FIELDS = ["name", "trigger", "trigger_args", "product_id", "delay_hours", "selector", "action", "action_args", "subject", "body"];
// たたんだとき入口と出口がこれを超えるブロックは、版 7 の止める条件の数え上げに入れる
export const BLOCK_PORT_MAX = 4;

// ブロックの入口と出口（線から出す）。入口＝外 → 中の線、出口＝中 → 外の線
export function blockPorts(memberKeys, edges) {
  const inside = new Set(memberKeys);
  const ins = edges.filter((e) => inside.has(e.to) && !inside.has(e.from));
  const outs = edges.filter((e) => inside.has(e.from) && !inside.has(e.to));
  return { ins, outs, too_many: ins.length > BLOCK_PORT_MAX || outs.length > BLOCK_PORT_MAX };
}

export function makeBlocks(h) {
  const { db, logInbound, plan, deliver, draftFlow } = h;

  const actorOf = (a) => String(a || "unknown").slice(0, 120);

  async function campaignOf(env, id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const [c] = await db(env, "GET", `b_campaigns?select=*&id=eq.${id}`);
    return c || null;
  }

  // 企画の中のコネクタ（ブロックごと）。block_name を渡すとそのブロックだけ
  async function stepsOfCampaign(env, campaignId, blockName = null) {
    let q = `b_campaign_parts?select=part_id,block_name,role,template_id,template_version&part_type=eq.step&campaign_id=eq.${campaignId}`;
    if (blockName !== null) q += `&block_name=eq.${encodeURIComponent(blockName)}`;
    const owned = await db(env, "GET", q);
    if (!owned.length) return [];
    const steps = await db(env, "GET", `b_steps?select=*&id=in.(${owned.map((o) => Number(o.part_id)).filter(Number.isFinite).join(",")})&order=id.asc`);
    const own = Object.fromEntries(owned.map((o) => [String(o.part_id), o]));
    return steps.map((s) => ({ ...s, block_name: own[String(s.id)].block_name || "", role: own[String(s.id)].role || "" }));
  }

  const copyOf = (s) => Object.fromEntries(STEP_FIELDS.filter((k) => s[k] !== undefined && s[k] !== null).map((k) => [k, s[k]]));

  // ---------- テンプレ ----------
  async function listTemplates(env, { kind = "", include_archived = false } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    let q = "b_templates?select=id,name,kind,version,note,body,updated_at,updated_by,archived_at&order=updated_at.desc&limit=200";
    if (kind === "block" || kind === "campaign") q += `&kind=eq.${kind}`;
    if (!(include_archived === true || include_archived === "true")) q += "&archived_at=is.null";
    const rows = await db(env, "GET", q);
    return {
      ok: true, count: rows.length,
      templates: rows.map((t) => ({
        id: t.id, name: t.name, kind: t.kind, version: t.version, note: t.note, updated_at: t.updated_at, updated_by: t.updated_by, archived_at: t.archived_at,
        blocks: ((t.body && t.body.blocks) || []).map((b) => ({ block_name: b.block_name, connectors: (b.connectors || []).length })),
        has_date: !!(t.body && t.body.has_date),
      })),
    };
  }

  // 企画のブロック 1 つ（kind block）か、企画まるごと（kind campaign）をテンプレにする。同じ名前があれば版を 1 つ上げて中身を差し替える
  async function saveTemplate(env, { name, kind = "block", campaign_id, block_name = "", note = "" } = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const n = String(name || "").trim();
    if (!n || n.length > NAME_MAX) return { ok: false, error: "bad_name", max: NAME_MAX };
    if (kind !== "block" && kind !== "campaign") return { ok: false, error: "bad_kind", kinds: ["block", "campaign"] };
    const c = await campaignOf(env, campaign_id);
    if (!c) return { ok: false, error: "campaign_not_found" };
    const bn = String(block_name || "").trim();
    if (kind === "block" && !bn) return { ok: false, error: "need_block_name" };
    const steps = await stepsOfCampaign(env, c.id, kind === "block" ? bn : null);
    if (!steps.length) return { ok: false, error: "nothing_to_save", note: kind === "block" ? "このブロックにコネクタが無い" : "この企画にコネクタが無い" };
    const groups = new Map();
    for (const s of steps) {
      const key = s.block_name || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...copyOf(s), role: s.role });
    }
    const body = { blocks: [...groups.entries()].map(([block_name, connectors]) => ({ block_name, connectors })), has_date: !!c.starts_on, from_campaign: c.name };
    const [live] = await db(env, "GET", `b_templates?select=id,version,kind&name=eq.${encodeURIComponent(n)}&archived_at=is.null`);
    const now = new Date().toISOString();
    let row;
    if (live) {
      if (live.kind !== kind) return { ok: false, error: "name_taken_other_kind", kind: live.kind };
      [row] = await db(env, "PATCH", `b_templates?id=eq.${live.id}`, { body, version: live.version + 1, note: String(note || "").slice(0, 500), updated_at: now, updated_by: actorOf(actor) }, "return=representation");
    } else {
      [row] = await db(env, "POST", "b_templates", [{ name: n, kind, body, note: String(note || "").slice(0, 500), updated_at: now, updated_by: actorOf(actor) }], "return=representation");
    }
    await logInbound(env, "template", { action: live ? "update" : "create", id: row.id, name: n, version: row.version, by: actor }, { ok: true }, 200);
    return { ok: true, id: row.id, name: n, kind, version: row.version, blocks: body.blocks.map((b) => ({ block_name: b.block_name, connectors: b.connectors.length })) };
  }

  // 下書きを作って、ブロックと作った元を部品に書く（draft_flow の上に乗せる）
  async function makeDrafts(env, { campaign_id, campaign_title, starts_on, blocks, origin }, actor) {
    const out = { created: [], blocks: [] };
    let cid = campaign_id || null, cname = null;
    for (const b of blocks) {
      const r = await draftFlow(env, { campaign_id: cid, campaign_title: cid ? "" : campaign_title, starts_on, connectors: b.connectors }, actor);
      if (!r.ok) return { ok: false, error: r.error, block_name: b.block_name, index: r.index, created: [...out.created, ...(r.created || [])], campaign_id: cid || r.campaign_id || null };
      cid = r.campaign_id; cname = r.campaign_name;
      for (const id of r.step_ids) {
        await db(env, "PATCH", `b_campaign_parts?part_type=eq.step&part_id=eq.${id}`, {
          block_name: String(b.block_name || "").slice(0, BLOCK_MAX),
          template_id: origin ? origin.id : null, template_version: origin ? origin.version : null,
        }, "return=minimal");
        out.created.push(id);
      }
      out.blocks.push({ block_name: b.block_name || "", connectors: r.step_ids.length });
    }
    return { ok: true, campaign_id: cid, campaign_name: cname, created: out.created.length, step_ids: out.created, blocks: out.blocks };
  }

  // テンプレから下書きを作る。campaign_id（いまある企画）か campaign_title（新しく作る）。元に開催日があれば starts_on が要る
  async function useTemplate(env, { template_id, campaign_id = null, campaign_title = "", starts_on = null, block_name = "" } = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    if (!UUID_RE.test(String(template_id || ""))) return { ok: false, error: "bad_template_id" };
    const [t] = await db(env, "GET", `b_templates?select=*&id=eq.${template_id}`);
    if (!t || t.archived_at) return { ok: false, error: "template_not_found" };
    if (!campaign_id && !String(campaign_title || "").trim()) return { ok: false, error: "need_campaign", note: "campaign_id か campaign_title" };
    if (campaign_id && !(await campaignOf(env, campaign_id))) return { ok: false, error: "campaign_not_found" };
    if (t.kind === "campaign" && t.body && t.body.has_date && !starts_on && !campaign_id) return { ok: false, error: "need_starts_on", note: "元の企画に開催日があるので、新しい開催日が要る" };
    let blocks = (t.body && t.body.blocks) || [];
    // ブロックのテンプレは、名前を変えて入れられる
    if (t.kind === "block" && String(block_name || "").trim()) blocks = blocks.map((b) => ({ ...b, block_name: String(block_name).trim() }));
    const r = await makeDrafts(env, { campaign_id, campaign_title, starts_on, blocks, origin: { id: t.id, version: t.version } }, actor);
    if (!r.ok) return r;
    return { ...r, template: { id: t.id, name: t.name, version: t.version }, note: "すべて下書き（動いていない）。動かすのは publish_block（承認）" };
  }

  // 企画を下書きで複製する。新しい企画名と開催日だけを入れる。元に開催日があれば starts_on が要る
  async function copyCampaign(env, { campaign_id, title, starts_on = null } = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const c = await campaignOf(env, campaign_id);
    if (!c) return { ok: false, error: "campaign_not_found" };
    if (c.kind === "standing") return { ok: false, error: "standing_cannot_copy" };
    if (!String(title || "").trim()) return { ok: false, error: "need_title" };
    if (c.starts_on && !starts_on) return { ok: false, error: "need_starts_on", note: "元の企画に開催日があるので、新しい開催日が要る" };
    const steps = await stepsOfCampaign(env, c.id);
    if (!steps.length) return { ok: false, error: "nothing_to_copy" };
    const owned = await db(env, "GET", `b_campaign_parts?select=part_id,template_id,template_version&part_type=eq.step&campaign_id=eq.${c.id}`);
    const originOf = Object.fromEntries(owned.map((o) => [String(o.part_id), o]));
    const groups = new Map();
    for (const s of steps) { const k = s.block_name || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ ...copyOf(s), role: s.role }); }
    const blocks = [...groups.entries()].map(([block_name, connectors]) => ({ block_name, connectors }));
    // 作った元：元の企画の部品がテンプレから作ったものなら、その版をそのまま引き継ぐ（1 つにそろっているときだけ）
    const origins = [...new Set(steps.map((s) => (originOf[String(s.id)] || {}).template_id).filter(Boolean))];
    let origin = null;
    if (origins.length === 1) { const o = owned.find((x) => x.template_id === origins[0]); origin = { id: origins[0], version: o.template_version }; }
    const r = await makeDrafts(env, { campaign_title: title, starts_on, blocks, origin }, actor);
    if (!r.ok) return r;
    return { ...r, from: { id: c.id, name: c.name }, note: "すべて下書き（動いていない）。動かすのは publish_block（承認）" };
  }

  // ---------- まとめて動かす ----------
  // 承認を頼む前に呼ぶ。動かす下書きの番号と、部品の一覧（種類・名前・宛先の人数）を中身に書き込む
  async function preparePublish(env, { campaign_id, block_name } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const c = await campaignOf(env, campaign_id);
    if (!c) return { ok: false, error: "campaign_not_found" };
    if (c.archived_at) return { ok: false, error: "campaign_archived" };
    const bn = String(block_name || "").trim();
    if (!bn) return { ok: false, error: "need_block_name" };
    const steps = (await stepsOfCampaign(env, c.id, bn)).filter((s) => !s.active);
    if (!steps.length) return { ok: false, error: "nothing_to_publish", note: "このブロックに動いていない下書きが無い" };
    // 複製・テンプレから作った企画は、元に開催日があるのに開催日が空なら動かさない
    const owned = await db(env, "GET", `b_campaign_parts?select=template_id&part_type=eq.step&campaign_id=eq.${c.id}&block_name=eq.${encodeURIComponent(bn)}`);
    const tids = [...new Set(owned.map((o) => o.template_id).filter(Boolean))];
    if (tids.length && !c.starts_on) {
      const ts = await db(env, "GET", `b_templates?select=body&id=in.(${tids.join(",")})`);
      if (ts.some((t) => t.body && t.body.has_date)) return { ok: false, error: "need_starts_on", note: "開催日が空のまま。企画の開催日を入れてから動かす" };
    }
    const preview = [];
    for (const s of steps) {
      const a = await deliver.previewAudience(env, { filter: s.selector || {} });
      preview.push({
        type: "コネクタ", step_id: s.id, name: s.name || s.subject || `コネクタ ${s.id}`, trigger: s.trigger, action: s.action || "send_email",
        audience: a && a.ok ? a.count : null,
      });
    }
    return { ok: true, args: { campaign_id: c.id, campaign_name: c.name, block_name: bn, step_ids: steps.map((s) => s.id), _preview: preview } };
  }

  // 承認されたあとに動く。頼んだ時点の番号の下書きだけを動かす
  async function publishBlock(env, { campaign_id, block_name, step_ids } = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const ids = Array.isArray(step_ids) ? step_ids.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) return { ok: false, error: "need_step_ids", note: "publish_block は承認の前に中身を書き込む。そのまま呼び直す" };
    const now = await stepsOfCampaign(env, campaign_id, String(block_name || ""));
    const byId = Object.fromEntries(now.map((s) => [s.id, s]));
    const started = [], skipped = [];
    for (const id of ids) {
      const s = byId[id];
      if (!s) { skipped.push({ step_id: id, reason: "not_in_block" }); continue; }
      if (s.active) { skipped.push({ step_id: id, reason: "already_running" }); continue; }
      const r = await deliver.setStep(env, { id, active: true }, actor);
      if (r.ok) started.push(id); else skipped.push({ step_id: id, reason: r.error });
    }
    await logInbound(env, "block", { action: "publish", campaign_id, block_name, by: actor }, { ok: true, started: started.length, skipped: skipped.length }, 200);
    return { ok: true, started: started.length, step_ids: started, skipped };
  }

  // 企画の中のブロックの一覧（設計図の部品と線から、入口と出口を出す）
  async function listBlocks(env, { campaign_id } = {}) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const bp = await plan.blueprint(env, { campaign_id: campaign_id || "all" });
    if (!bp.ok) return bp;
    const groups = new Map();
    for (const p of bp.parts) {
      if (!p.block_name || p.outside) continue;
      const k = `${p.campaign_id}|${p.block_name}`;
      if (!groups.has(k)) groups.set(k, { campaign_id: p.campaign_id, campaign_name: p.campaign_name, block_name: p.block_name, members: [] });
      groups.get(k).members.push(p);
    }
    const blocks = [...groups.values()].map((g) => {
      const ports = blockPorts(g.members.map((m) => m.key), bp.edges);
      return {
        campaign_id: g.campaign_id, campaign_name: g.campaign_name, block_name: g.block_name,
        parts: g.members.map((m) => ({ key: m.key, name: m.name, state: m.state })),
        ins: ports.ins.map((e) => ({ from: e.from, to: e.to, week: e.week, counted: e.counted })),
        outs: ports.outs.map((e) => ({ from: e.from, to: e.to, week: e.week, counted: e.counted })),
        too_many: ports.too_many,
      };
    });
    return { ok: true, count: blocks.length, too_many: blocks.filter((b) => b.too_many).length, port_max: BLOCK_PORT_MAX, blocks };
  }

  return { listTemplates, saveTemplate, useTemplate, copyCampaign, preparePublish, publishBlock, listBlocks };
}

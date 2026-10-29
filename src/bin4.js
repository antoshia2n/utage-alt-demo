// 便 4：個別相談の予約の記録と商談の段階（2026-10-29 ムダ 10 の 3 段目で、架空のセミナー・相談の枠・請求の見本を消した。本物の予約は src/booking.js、セミナーは src/seminars.js）
// 便 1〜3 と同じく新しい表は作らない。予約・申込・面談・成約／失注は出来事の記録（events）に積み、段階は記録から計算する。
//   consult_booked / consult_canceled … 個別相談の予約と取り消し（slot：開始の時刻）
//   consult_done / deal_won / deal_lost … 面談した・成約・失注（memo・amount）
//   seminar_registered / seminar_reminded / seminar_archive_sent … セミナーの申込・前日の知らせ・アーカイブを配った

const DEAL_TYPES = ["consult_booked", "consult_canceled", "consult_done", "deal_won", "deal_lost"];
const STAGE_LABEL = { none: "", booked: "相談予約", done: "面談済", won: "成約", lost: "失注" };

export function makeBin4(h) {
  const { db, addEvent } = h;

  async function dealEvents(env, customerId) {
    let q = `events?select=id,customer_id,type,payload,actor,occurred_at&type=in.(${DEAL_TYPES.join(",")})&order=id.asc&limit=5000`;
    if (customerId) q += `&customer_id=eq.${customerId}`;
    return await db(env, "GET", q);
  }

  // 段階は記録から計算する：予約 → 面談済 → 成約／失注。取り消すと 1 つ前に戻る
  function dealOf(evs) {
    let stage = "none", prev = "none", booking = null, memo = null, amount = null, at = null;
    for (const e of evs) {
      const p = e.payload || {};
      if (e.type === "consult_booked") { prev = stage === "booked" ? prev : stage; stage = "booked"; booking = p.slot; at = e.occurred_at; }
      else if (e.type === "consult_canceled") { if (stage === "booked" && booking === p.slot) { stage = prev; booking = null; at = e.occurred_at; } }
      else if (e.type === "consult_done") { stage = "done"; memo = p.memo || memo; at = e.occurred_at; }
      else if (e.type === "deal_won") { stage = "won"; memo = p.memo || memo; amount = p.amount ?? null; at = e.occurred_at; }
      else if (e.type === "deal_lost") { stage = "lost"; memo = p.memo || memo; at = e.occurred_at; }
    }
    return { stage, label: STAGE_LABEL[stage], booking: stage === "booked" ? booking : null, memo, amount, at };
  }

  function activeBookings(evs) {
    const map = new Map();
    for (const e of evs) {
      const slot = e.payload && e.payload.slot;
      if (!slot) continue;
      if (e.type === "consult_booked") map.set(e.customer_id + "|" + slot, { customer_id: e.customer_id, slot, topic: e.payload.topic || "", booked_at: e.occurred_at, id: e.id });
      if (e.type === "consult_canceled") map.delete(e.customer_id + "|" + slot);
    }
    return [...map.values()];
  }

  async function dealMap(env) {
    const evs = await dealEvents(env);
    const by = new Map();
    for (const e of evs) { if (!by.has(e.customer_id)) by.set(e.customer_id, []); by.get(e.customer_id).push(e); }
    const out = {};
    for (const [id, list] of by) out[id] = dealOf(list);
    return out;
  }

  async function deal(env, customerId) {
    return dealOf(await dealEvents(env, customerId));
  }

  const fmtJst = (iso) => {
    const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
    const p = (n) => String(n).padStart(2, "0");
    const wd = "日月火水木金土"[d.getUTCDay()];
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${wd}）${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };


  // ---------- シアニン用・AI 用 ----------
  async function listConsults(env, { include_past = false } = {}, now = new Date()) {
    const all = await dealEvents(env);
    let list = activeBookings(all);
    if (!(include_past === true || include_past === "true")) list = list.filter((b) => new Date(b.slot).getTime() > now.getTime() - 3 * 3600e3);
    list.sort((a, b) => a.slot.localeCompare(b.slot));
    const ids = [...new Set(list.map((b) => b.customer_id))];
    const people = ids.length ? await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`) : [];
    const pmap = Object.fromEntries(people.map((p) => [p.id, p]));
    const dm = await dealMap(env);
    return {
      ok: true, count: list.length,
      consults: list.map((b) => ({
        person_id: b.customer_id, name: pmap[b.customer_id] ? pmap[b.customer_id].name : "", email: pmap[b.customer_id] ? pmap[b.customer_id].email : "",
        slot: b.slot, label: fmtJst(b.slot), topic: b.topic, stage: dm[b.customer_id] ? dm[b.customer_id].stage : "booked",
      })),
    };
  }

  async function setDealStage(env, { person_id, stage, memo = "", amount = null }, actor) {
    if (!/^[0-9a-f-]{36}$/i.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const map = { done: "consult_done", won: "deal_won", lost: "deal_lost" };
    if (!map[stage]) return { ok: false, error: "bad_stage", allowed: Object.keys(map) };
    const [person] = await db(env, "GET", `customers?select=id&id=eq.${person_id}`);
    if (!person) return { ok: true, found: false };
    const payload = { memo: String(memo || "").trim().slice(0, 4000) };
    if (stage === "won") {
      const n = amount === null || amount === "" || amount === undefined ? null : Number(amount);
      if (n !== null && (!Number.isFinite(n) || n < 0)) return { ok: false, error: "bad_amount" };
      payload.amount = n;
    }
    const ev = await addEvent(env, person_id, map[stage], payload, actor);
    return { ok: true, found: true, id: ev.id, deal: await deal(env, person_id) };
  }

  return {
    deal, dealMap, listConsults, setDealStage, STAGE_LABEL,
  };
}

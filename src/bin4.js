// 便 4：個別相談の予約・セミナー（Zoom の案内・前日リマインド・アーカイブ）・商談の段階・コンサルの請求を読む見本
// 便 1〜3 と同じく新しい表は作らない。予約・申込・面談・成約／失注は出来事の記録（events）に積み、段階は記録から計算する。
//   consult_booked / consult_canceled … 個別相談の予約と取り消し（slot：開始の時刻）
//   consult_done / deal_won / deal_lost … 面談した・成約・失注（memo・amount）
//   seminar_registered / seminar_reminded / seminar_archive_sent … セミナーの申込・前日の知らせ・アーカイブを配った
// セミナーの中身と請求の見本は架空のデータで、このファイルに置く（本物の sales-manager には触れない）。

export const SEMINARS = [
  {
    id: "sem-20261001",
    title: "言語化セミナー 第 1 回：頭の中を 1 行にする（架空）",
    starts_at: "2026-10-01T11:00:00Z",
    minutes: 60,
    zoom_url: "https://zoom.us/j/0000000001",
    archive_url: "https://www.youtube.com/watch?v=demo-archive-01",
  },
  {
    id: "sem-20261021",
    title: "言語化セミナー 第 2 回：図にしてから書く（架空）",
    starts_at: "2026-10-21T11:00:00Z",
    minutes: 60,
    zoom_url: "https://zoom.us/j/0000000002",
    archive_url: "https://www.youtube.com/watch?v=demo-archive-02",
  },
];

// コンサルの請求を読む見本（sales-manager が返す形を真似た架空のデータ・メールで結ぶ）
export const CONTRACT_SAMPLES = {
  "takahashi.demo@example.com": { plan: "X 運用コンサル（月額）", amount: 55000, status: "契約中", paid: [{ month: "2026-09", state: "入金済" }, { month: "2026-10", state: "入金済" }] },
  "suzuki.demo@example.com": { plan: "単発の個別相談", amount: 33000, status: "契約中", paid: [{ month: "2026-10", state: "入金待ち" }] },
  "sato.demo@example.com": { plan: "X 運用コンサル（月額）", amount: 55000, status: "終了", paid: [{ month: "2026-08", state: "入金済" }, { month: "2026-09", state: "入金済" }] },
};

const SLOT_HOURS_JST = [10, 14, 20];
const SLOT_DAYS = 14;
const DEAL_TYPES = ["consult_booked", "consult_canceled", "consult_done", "deal_won", "deal_lost"];
const STAGE_LABEL = { none: "", booked: "相談予約", done: "面談済", won: "成約", lost: "失注" };

export function makeBin4(h) {
  const { db, addEvent, bin3 } = h;

  // ---------- 予約の枠（平日の 10 時・14 時・20 時、14 日先まで。日本時間） ----------
  function slots(now = new Date()) {
    const out = [];
    const jstNow = new Date(now.getTime() + 9 * 3600e3);
    for (let d = 0; d <= SLOT_DAYS; d++) {
      const day = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + d));
      const wd = day.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (const hr of SLOT_HOURS_JST) {
        const startUtc = new Date(day.getTime() + (hr - 9) * 3600e3);
        if (startUtc.getTime() > now.getTime() + 2 * 3600e3) out.push(startUtc.toISOString());
      }
    }
    return out;
  }

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

  // ---------- 生徒：予約とセミナー ----------
  async function studentView(env, customer, now = new Date()) {
    const all = await dealEvents(env);
    const taken = new Set(activeBookings(all).map((b) => b.slot));
    const mine = activeBookings(all.filter((e) => e.customer_id === customer.id)).filter((b) => new Date(b.slot) > now);
    const regs = await db(env, "GET", `events?select=payload&customer_id=eq.${customer.id}&type=eq.seminar_registered`);
    const regIds = new Set(regs.map((r) => r.payload && r.payload.seminar_id));
    return {
      ok: true,
      slots: slots(now).map((s) => ({ slot: s, label: fmtJst(s), taken: taken.has(s) })),
      mine: mine.map((b) => ({ slot: b.slot, label: fmtJst(b.slot), topic: b.topic })),
      seminars: SEMINARS.map((s) => {
        const past = new Date(s.starts_at) < now;
        const registered = regIds.has(s.id);
        return {
          id: s.id, title: s.title, starts_at: s.starts_at, label: fmtJst(s.starts_at), minutes: s.minutes, past, registered,
          zoom_url: registered && !past ? s.zoom_url : null,
          archive_url: registered && past ? s.archive_url : null,
        };
      }),
    };
  }

  async function book(env, customer, { slot, topic }, now = new Date()) {
    const s = String(slot || "");
    if (!slots(now).includes(s)) return { ok: false, error: "bad_slot" };
    const all = await dealEvents(env);
    const active = activeBookings(all);
    if (active.some((b) => b.slot === s)) return { ok: false, error: "slot_taken" };
    if (active.some((b) => b.customer_id === customer.id && new Date(b.slot) > now)) return { ok: false, error: "already_booked" };
    const t = String(topic || "").trim().slice(0, 1000);
    const ev = await addEvent(env, customer.id, "consult_booked", { slot: s, topic: t }, "site");
    const mail = await bin3.sendMail(env, customer, {
      kind: "consult_booked",
      subject: "【言語化ラボ・デモ】個別相談の予約を受け付けました",
      text: `${customer.name || ""} さん\n\n個別相談の予約を受け付けました。\n日時：${fmtJst(s)}（30 分）\n相談したいこと：${t || "（未記入）"}\n\n当日は Zoom の URL をこのメールでお送りします（デモなので架空です）。\n取り消しはマイページの「予約」からできます。`,
    });
    return { ok: true, id: ev.id, slot: s, label: fmtJst(s), mail: mail.result };
  }

  async function cancel(env, customer, { slot }) {
    const s = String(slot || "");
    const active = activeBookings(await dealEvents(env, customer.id));
    if (!active.some((b) => b.slot === s)) return { ok: false, error: "not_booked" };
    await addEvent(env, customer.id, "consult_canceled", { slot: s }, "site");
    return { ok: true };
  }

  async function registerSeminar(env, customer, seminarId, now = new Date()) {
    const s = SEMINARS.find((x) => x.id === seminarId);
    if (!s) return { ok: false, error: "unknown_seminar" };
    if (new Date(s.starts_at) < now) return { ok: false, error: "seminar_over" };
    const done = await db(env, "GET", `events?select=id&customer_id=eq.${customer.id}&type=eq.seminar_registered&payload->>seminar_id=eq.${s.id}&limit=1`);
    if (done.length) return { ok: true, already: true };
    await addEvent(env, customer.id, "seminar_registered", { seminar_id: s.id }, "site");
    const mail = await bin3.sendMail(env, customer, {
      kind: "seminar_registered",
      subject: `【言語化ラボ・デモ】セミナーのお申し込み：${s.title}`,
      text: `${customer.name || ""} さん\n\n${s.title} のお申し込みを受け付けました。\n日時：${fmtJst(s.starts_at)}（${s.minutes} 分）\nZoom：${s.zoom_url}（デモなので架空です）\n\n前日にもう一度お知らせします。`,
      extra: { seminar_id: s.id },
    });
    return { ok: true, already: false, mail: mail.result };
  }

  // ---------- 定時の処理：セミナーの 24 時間前を過ぎた申込者へ前日の知らせを 1 通 ----------
  async function remindSeminars(env, { force_seminar_id = null } = {}, now = new Date()) {
    const out = { checked: 0, sent: 0, blocked: 0, failed: 0 };
    for (const s of SEMINARS) {
      const start = new Date(s.starts_at).getTime();
      const due = force_seminar_id ? s.id === force_seminar_id : (start - now.getTime() <= 24 * 3600e3 && start > now.getTime());
      if (!due) continue;
      const regs = await db(env, "GET", `events?select=customer_id&type=eq.seminar_registered&payload->>seminar_id=eq.${s.id}`);
      const done = new Set((await db(env, "GET", `events?select=customer_id&type=eq.seminar_reminded&payload->>seminar_id=eq.${s.id}`)).map((r) => r.customer_id));
      for (const cid of [...new Set(regs.map((r) => r.customer_id))]) {
        out.checked++;
        if (done.has(cid)) continue;
        const [customer] = await db(env, "GET", `customers?select=id,email,name&id=eq.${cid}`);
        if (!customer) continue;
        const r = await bin3.sendMail(env, customer, {
          kind: "seminar_reminder",
          subject: `【言語化ラボ・デモ】もうすぐセミナーです（${fmtJst(s.starts_at)}）：${s.title}`,
          text: `${customer.name || ""} さん\n\n${fmtJst(s.starts_at)} から ${s.title} があります。\nZoom：${s.zoom_url}（デモなので架空です）`,
          extra: { seminar_id: s.id },
        });
        await addEvent(env, cid, "seminar_reminded", { seminar_id: s.id, mail: r.result }, "site");
        out[r.result === "sent" ? "sent" : r.result === "blocked" ? "blocked" : "failed"]++;
      }
    }
    return out;
  }

  async function sendArchive(env, seminarId, actor) {
    const s = SEMINARS.find((x) => x.id === seminarId);
    if (!s) return { ok: false, error: "unknown_seminar" };
    const regs = await db(env, "GET", `events?select=customer_id&type=eq.seminar_registered&payload->>seminar_id=eq.${s.id}`);
    const done = new Set((await db(env, "GET", `events?select=customer_id&type=eq.seminar_archive_sent&payload->>seminar_id=eq.${s.id}`)).map((r) => r.customer_id));
    const out = { ok: true, registrants: 0, sent: 0, blocked: 0, failed: 0, skipped: 0 };
    for (const cid of [...new Set(regs.map((r) => r.customer_id))]) {
      out.registrants++;
      if (done.has(cid)) { out.skipped++; continue; }
      const [customer] = await db(env, "GET", `customers?select=id,email,name&id=eq.${cid}`);
      if (!customer) continue;
      const r = await bin3.sendMail(env, customer, {
        kind: "seminar_archive",
        subject: `【言語化ラボ・デモ】アーカイブ：${s.title}`,
        text: `${customer.name || ""} さん\n\n${s.title} のアーカイブです。\n${s.archive_url}（デモなので架空です）\nマイページの「予約」からも見られます。`,
        actor, extra: { seminar_id: s.id },
      });
      await addEvent(env, cid, "seminar_archive_sent", { seminar_id: s.id, mail: r.result }, actor);
      out[r.result === "sent" ? "sent" : r.result === "blocked" ? "blocked" : "failed"]++;
    }
    return out;
  }

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

  async function seminarsAdmin(env, now = new Date()) {
    const out = [];
    for (const s of SEMINARS) {
      const regs = await db(env, "GET", `events?select=customer_id&type=eq.seminar_registered&payload->>seminar_id=eq.${s.id}`);
      const rem = await db(env, "GET", `events?select=customer_id&type=eq.seminar_reminded&payload->>seminar_id=eq.${s.id}`);
      const arc = await db(env, "GET", `events?select=customer_id&type=eq.seminar_archive_sent&payload->>seminar_id=eq.${s.id}`);
      out.push({
        id: s.id, title: s.title, starts_at: s.starts_at, label: fmtJst(s.starts_at), past: new Date(s.starts_at) < now,
        registrants: new Set(regs.map((r) => r.customer_id)).size,
        reminded: new Set(rem.map((r) => r.customer_id)).size,
        archive_sent: new Set(arc.map((r) => r.customer_id)).size,
      });
    }
    return { ok: true, count: out.length, seminars: out };
  }

  function contractOf(email) {
    const c = CONTRACT_SAMPLES[String(email || "").toLowerCase()];
    return c ? { ...c, source: "sample", note: "sales-manager の形を真似た架空の見本。本物には触れていない" } : null;
  }

  return {
    slots, deal, dealMap, studentView, book, cancel, registerSeminar, remindSeminars, sendArchive,
    listConsults, setDealStage, seminarsAdmin, contractOf, STAGE_LABEL,
  };
}

// チャットの便 C1（2026-11-07 Naoki OK 10:55・デモ https://claude.ai/artifact/CqUVZrEMegXbRk385fkZ2J）
// シアニン用の画面の「チャット」。人ごとのやり取り（添削ルームの部屋と同じ出来事）に、次の 4 つを足す。表は増やさない（出来事の表に積む）
//   chat_note  … メモ（自分だけ）。生徒の画面は部屋の 4 種類（ROOM_TYPES）しか読まないので、生徒には出ない
//   chat_later … 後で見る。payload.until（日時）まで「要返信」から外す。until が null なら外したことを取り消す
//   chat_task  … メッセージから TaskMaster にタスクを足した印（payload.event_id・task_id・title）
//   chat_fwd   … 別のチャットへメモとして転送した印は、転送先の chat_note（payload.forwarded_from）で持つ
// 右の「履歴」は、その人の出来事（顧客管理の 1 枚と同じ getTimeline）を種類ごとに分けて返す。部屋の出来事と読んだ印・通知の購読は出さない
// 0.71.1：履歴の「そのほか」もチップで絞れるように CATS に足した（本番の 1 人分で見つけた）。試験は tests/chat.test.mjs。画面は public/js/chat.js（手元の試し台で、ホバー・右クリック・1 キー・後で・メモ・⌘K・探す・右の幅・スマホを確かめた）
// チャットの便 C2a（2026-11-07 Naoki OK 11:45）：フォルダ・フォルダの中で探す・右の「資料」・資料に入れる・顧客管理に残す。生徒の画面は変えない。表は増やさない
//   フォルダの名前と並び … 表 b_settings の 1 行（key=chat_folders・1 行に「番号 名前」）。消すと中のチャットは「フォルダなし」に戻る（チャットは消えない）
//   chat_folder … その人のチャットをどのフォルダに入れたか（payload.folder・null で外す）。いちばん新しいものが効く
//   chat_saved  … 「資料に入れる」（payload.event_id・text・off）。右の「資料」に出る。同じメッセージは off で外せる
//   chat_pin    … 「顧客管理に残す」（payload.event_id・text・from）。顧客管理の 1 枚の「概要」と履歴に出る
export const NOTE_MAX = 8000;
export const CHAT_TYPES = ["chat_note", "chat_later", "chat_task", "chat_folder", "chat_saved", "chat_pin"];
export const FOLDER_KEY = "chat_folders";
export const FOLDER_NAME_MAX = 20;
export const FOLDER_MAX = 30;
const FOLDER_ID_RE = /^[a-z0-9]{4}$/;
const URL_RE = /https?:[/][/][^\s　<>"'）」]+/g;

// フォルダの行（設定の値）⇔ [{id,name}]
export function parseFolders(v) {
  return String(v || "").split("\n").map((l) => { const m = l.match(/^([a-z0-9]{4}) (.+)$/); return m ? { id: m[1], name: m[2] } : null; }).filter(Boolean);
}
export function formatFolders(fs) { return fs.map((f) => `${f.id} ${f.name}`).join("\n"); }
export function folderNameOk(v) {
  const n = String(v ?? "").replace(/\s+/g, " ").trim();
  return n && n.length <= FOLDER_NAME_MAX ? n : null;
}
// いちばん新しい chat_folder の folder（あるフォルダだけ）
export function folderOf(events, ids) {
  const last = (events || []).filter((e) => e.type === "chat_folder").sort((a, b) => b.id - a.id)[0];
  const f = last && last.payload && last.payload.folder;
  return f && (!ids || ids.has(f)) ? f : null;
}

// 右の「資料」：やり取りとメモから集めたリンク・画像と、「資料に入れる」で残したもの（新しい順）
export function vaultOf(messages, notes, chatEvents) {
  const out = [], seen = new Set();
  const add = (x) => { const k = x.kind + ":" + (x.url || x.key || x.event_id); if (seen.has(k)) return; seen.add(k); out.push(x); };
  const saved = {};
  for (const e of (chatEvents || []).filter((e) => e.type === "chat_saved").sort((a, b) => a.id - b.id)) {
    const p = e.payload || {}; const k = String(p.event_id);
    if (p.off) delete saved[k]; else saved[k] = { kind: "saved", event_id: p.event_id, text: String(p.text || ""), from: p.from || "", at: e.occurred_at, id: e.id };
  }
  for (const s of Object.values(saved).sort((a, b) => b.id - a.id)) add(s);
  const src = [
    ...(messages || []).map((m) => ({ id: m.id, at: m.at, from: m.from === "student" ? "生徒" : "シアニン", text: m.kind === "chat" || m.from === "student" ? m.text || "" : [m.comment, m.corrected].filter(Boolean).join("\n"), images: m.images || [] })),
    ...(notes || []).map((n) => ({ id: n.id, at: n.at, from: "メモ", text: n.text || "", images: [] })),
  ].sort((a, b) => b.id - a.id);
  for (const m of src) {
    for (const u of String(m.text).match(URL_RE) || []) add({ kind: "link", url: u, event_id: m.id, from: m.from, at: m.at, text: String(m.text).replace(/\s+/g, " ").slice(0, 120) });
    for (const k of m.images) add({ kind: "image", key: k, event_id: m.id, from: m.from, at: m.at });
  }
  return out;
}
const UUID_RE = /^[0-9a-f-]{36}$/i;

// 出来事 → 履歴の種類（チップの名前）。無いものは null（履歴に出さない）
const CAT = [
  [/^(purchase_completed|subscription_)/, "購入"],
  [/^(consult_|deal_)/, "予約"],
  [/^seminar_/, "セミナー"],
  [/^(lesson_|announcement_opened)/, "学習"],
  [/^email_/, "メール"],
  [/^line_/, "LINE"],
  [/^correction_/, "添削"],
  [/^form_submitted$/, "フォーム"],
  [/^page_/, "ページ"],
  [/^(entitlement_|grants_synced|note_member_set)/, "権利"],
  [/^(registered|register_again|login|invite_accepted|referred|referral_)/, "登録とログイン"],
  [/^(label_added|label_removed|step_entered|sales_marked|field_set)/, "マーケ"],
];
export const CATS = [...new Set(CAT.map((x) => x[1])), "そのほか"];
export function categoryOf(type) {
  const t = String(type || "");
  if (t === "room_read" || t === "room_chat" || t.startsWith("push_") || CHAT_TYPES.includes(t)) return null;
  for (const [re, c] of CAT) if (re.test(t)) return c;
  return "そのほか";
}

// 後での状態：いちばん新しい chat_later の until が今より先なら、その日時。そうでなければ null
export function laterOf(events, now = Date.now()) {
  const last = (events || []).filter((e) => e.type === "chat_later").sort((a, b) => b.id - a.id)[0];
  const u = last && last.payload && last.payload.until;
  return u && Date.parse(u) > now ? u : null;
}

// 要返信：最後の発言が生徒（メッセージか添削の依頼）か、添削の未返信がある。後での間は外す
export function needsReply(room, later) {
  if (later) return false;
  return room.last_from === "student" || (room.unreplied || 0) > 0 || (room.lesson_open || 0) > 0;
}

// 次の予約：予約した枠のうち、まだ来ていなくて取り消していないものの、いちばん近いもの
export function nextBooking(events, now = Date.now()) {
  const canceled = new Set((events || []).filter((e) => e.type === "consult_canceled").map((e) => String((e.payload || {}).slot || "")));
  return (events || []).filter((e) => e.type === "consult_booked" && e.payload && e.payload.slot && Date.parse(e.payload.slot) > now && !canceled.has(String(e.payload.slot)))
    .map((e) => ({ slot: e.payload.slot, title: e.payload.type_title || "個別相談" }))
    .sort((a, b) => Date.parse(a.slot) - Date.parse(b.slot))[0] || null;
}

// 右の上の顧客のカード
export function cardOf(t, now = Date.now()) {
  const ev = t.events || [];
  const done = ev.filter((e) => e.type === "consult_done").sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0];
  const ents = (t.entitlements || []).filter((x) => !x.expires_at || Date.parse(x.expires_at) > now).map((x) => ({ key: x.key, expires_at: x.expires_at || null }));
  const last = (t.purchases || []).find((p) => p.mode !== "test") || null;
  return {
    name: t.person.name || "", email: t.person.email || "",
    stage: t.stage ? t.stage.label : "",
    entitlements: ents,
    last_purchase: last ? { name: last.name, at: last.at } : null,
    next_booking: nextBooking(ev, now),
    last_meeting: done ? done.occurred_at : null,
  };
}

export function historyOf(events) {
  return (events || []).map((e) => ({ id: e.id, type: e.type, cat: categoryOf(e.type), at: e.occurred_at, payload: e.payload || {}, actor: e.actor }))
    .filter((x) => x.cat);
}

export function makeChat({ db, addEvent, core, logInbound }) {
  const chatEvents = async (env, personId) => db(env, "GET", `events?select=id,customer_id,type,payload,actor,occurred_at&customer_id=eq.${personId}&type=in.(${CHAT_TYPES.join(",")})&order=id.asc&limit=2000`);
  const exists = async (env, id) => !!(await db(env, "GET", `customers?select=id&id=eq.${id}`))[0];

  // ---------- フォルダ ----------
  async function readFolders(env) {
    const rows = await db(env, "GET", `settings?select=value&key=eq.${FOLDER_KEY}`);
    return parseFolders(rows[0] && rows[0].value);
  }
  async function writeFolders(env, fs, actor) {
    const v = formatFolders(fs);
    if (v.length > 500) return { ok: false, error: "folders_full", note: "名前を短くするか、使っていないフォルダを消す" };
    await db(env, "POST", "settings?on_conflict=key", [{ key: FOLDER_KEY, value: v, updated_at: new Date().toISOString(), updated_by: String(actor || "admin").slice(0, 200) }], "resolution=merge-duplicates,return=minimal");
    return { ok: true };
  }
  // 作る（name）・名前を変える（id・name）・並べ替える（id・move：up／down）・消す（id・remove）
  async function saveFolder(env, { id, name, move, remove } = {}, actor) {
    const fs = await readFolders(env);
    let out = null;
    if (!id) {
      const n = folderNameOk(name);
      if (!n) return { ok: false, error: "bad_name", max: FOLDER_NAME_MAX };
      if (fs.some((f) => f.name === n)) return { ok: false, error: "name_taken" };
      if (fs.length >= FOLDER_MAX) return { ok: false, error: "folders_full", max: FOLDER_MAX };
      let nid; do { nid = Math.random().toString(36).slice(2, 6).padEnd(4, "0"); } while (fs.some((f) => f.id === nid));
      out = { id: nid, name: n }; fs.push(out);
    } else {
      if (!FOLDER_ID_RE.test(String(id))) return { ok: false, error: "bad_id" };
      const k = fs.findIndex((f) => f.id === id);
      if (k < 0) return { ok: false, error: "not_found" };
      if (remove === true || remove === "true") fs.splice(k, 1);
      else if (move === "up" || move === "down") { const j = move === "up" ? k - 1 : k + 1; if (j >= 0 && j < fs.length) [fs[k], fs[j]] = [fs[j], fs[k]]; }
      else {
        const n = folderNameOk(name);
        if (!n) return { ok: false, error: "bad_name", max: FOLDER_NAME_MAX };
        if (fs.some((f) => f.name === n && f.id !== id)) return { ok: false, error: "name_taken" };
        fs[k].name = n;
      }
      out = fs[k] || { id, removed: true };
    }
    const w = await writeFolders(env, fs, actor);
    if (!w.ok) return w;
    await logInbound(env, "chat_folder", { action: !id ? "create" : remove ? "remove" : move ? "move" : "rename", id: out.id, name: out.name || null, actor }, { ok: true }, 200);
    return { ok: true, folder: out, folders: fs };
  }
  async function setFolder(env, { person_id, folder_id }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    let f = null;
    if (folder_id) {
      f = String(folder_id);
      if (!(await readFolders(env)).some((x) => x.id === f)) return { ok: false, error: "folder_not_found" };
    }
    if (!(await exists(env, person_id))) return { ok: true, found: false };
    await addEvent(env, person_id, "chat_folder", { folder: f }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, folder_id: f };
  }

  // 左の一覧：部屋のある人。後で・要返信・フォルダを付ける
  async function list(env) {
    const [r, fs] = await Promise.all([core.listRooms(env, {}), readFolders(env)]);
    const ids = r.rooms.map((x) => x.person_id), fids = new Set(fs.map((f) => f.id));
    const later = {}, folder = {};
    if (ids.length) {
      const evs = await db(env, "GET", `events?select=id,customer_id,type,payload&type=in.(chat_later,chat_folder)&customer_id=in.(${ids.join(",")})&order=id.asc&limit=5000`);
      const by = {};
      for (const e of evs) (by[e.customer_id] = by[e.customer_id] || []).push(e);
      for (const id of Object.keys(by)) { later[id] = laterOf(by[id]); folder[id] = folderOf(by[id], fids); }
    }
    const chats = r.rooms.map((x) => ({ ...x, later_until: later[x.person_id] || null, need: needsReply(x, later[x.person_id]), folder_id: folder[x.person_id] || null }));
    const folders = fs.map((f) => ({ ...f, count: chats.filter((c) => c.folder_id === f.id).length, need: chats.filter((c) => c.folder_id === f.id && c.need).length }));
    return { ok: true, count: chats.length, need_count: chats.filter((x) => x.need).length, later_count: chats.filter((x) => x.later_until).length, folders, chats };
  }

  // ⌘K：部屋の無い人も、名前かメールで探して開ける
  async function people(env, { q }) {
    const s = String(q || "").trim();
    if (!s) return { ok: true, people: [] };
    const ps = await core.findPeople(env, { query: s, limit: 20 }, { max: 20 });
    return { ok: true, people: (ps.people || ps || []).map((p) => ({ id: p.id, name: p.name || "", email: p.email || "" })) };
  }

  // 1 人のチャット：やり取り（部屋）・メモ・タスクの印・後で・カード・履歴
  async function get(env, { person_id }) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const room = await core.getRoom(env, { person_id, mark_read: true }, "admin");
    if (!room.ok || !room.found) return room;
    const t = await core.getTimeline(env, { person_id });
    const ce = await chatEvents(env, person_id);
    const notes = ce.filter((e) => e.type === "chat_note").map((e) => ({ id: e.id, kind: "note", at: e.occurred_at, text: (e.payload || {}).text || "", forwarded_from: (e.payload || {}).forwarded_from || null }));
    const tasks = ce.filter((e) => e.type === "chat_task").map((e) => ({ event_id: (e.payload || {}).event_id, task_id: (e.payload || {}).task_id, title: (e.payload || {}).title || "", url: (e.payload || {}).url || "" }));
    const fs = await readFolders(env);
    const pins = ce.filter((e) => e.type === "chat_pin").map((e) => Number((e.payload || {}).event_id));
    return {
      ok: true, found: true, person: { ...room.person, name: t.person ? t.person.name : room.person.name },
      messages: room.messages, notices: room.notices || [], unreplied: room.unreplied,
      notes, tasks, later_until: laterOf(ce), pins,
      folder_id: folderOf(ce, new Set(fs.map((f) => f.id))), folders: fs,
      vault: vaultOf(room.messages, notes, ce),
      card: cardOf(t), history: historyOf(t.events), cats: CATS,
    };
  }

  async function addNote(env, { person_id, text, forwarded_from }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const s = String(text ?? "").trim();
    if (!s) return { ok: false, error: "empty" };
    if (s.length > NOTE_MAX) return { ok: false, error: "too_long", max: NOTE_MAX };
    if (!(await exists(env, person_id))) return { ok: true, found: false };
    const payload = { text: s };
    if (forwarded_from && typeof forwarded_from === "object") {
      payload.forwarded_from = { person_id: String(forwarded_from.person_id || "").slice(0, 36), name: String(forwarded_from.name || "").slice(0, 80), event_id: Number(forwarded_from.event_id) || null };
    }
    const ev = await addEvent(env, person_id, "chat_note", payload, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, id: ev.id };
  }

  async function setLater(env, { person_id, until }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    let u = null;
    if (until != null && until !== "") {
      const t = Date.parse(until);
      if (!Number.isFinite(t) || t <= Date.now()) return { ok: false, error: "bad_until", note: "これから先の日時" };
      if (t > Date.now() + 90 * 864e5) return { ok: false, error: "bad_until", note: "90 日先まで" };
      u = new Date(t).toISOString();
    }
    if (!(await exists(env, person_id))) return { ok: true, found: false };
    await addEvent(env, person_id, "chat_later", { until: u }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, later_until: u };
  }

  // 別のチャットへ「メモとして」転送する（相手の生徒には見えない）。元のメッセージは部屋の出来事から読む
  async function forward(env, { person_id, event_id, to_person_id }, actor) {
    if (!UUID_RE.test(String(person_id || "")) || !UUID_RE.test(String(to_person_id || ""))) return { ok: false, error: "bad_person_id" };
    if (person_id === to_person_id) return { ok: false, error: "same_chat" };
    const [e] = await db(env, "GET", `events?select=id,type,payload&id=eq.${Number(event_id)}&customer_id=eq.${person_id}`);
    if (!e || !["room_chat", "correction_submitted", "correction_returned", "chat_note"].includes(e.type)) return { ok: false, error: "message_not_found" };
    const p = e.payload || {};
    const text = String(p.text || p.corrected || p.comment || "").trim() || "（画像だけのメッセージ）";
    const [from] = await db(env, "GET", `customer_summary?select=id,name,email&id=eq.${person_id}`);
    return addNote(env, { person_id: to_person_id, text, forwarded_from: { person_id, name: from ? from.name || from.email : "", event_id: e.id } }, actor);
  }

  // 1 人のチャットのメッセージ 1 つ（部屋の出来事かメモ）を読み、本文と誰の発言かを返す
  async function messageOf(env, person_id, event_id) {
    const [e] = await db(env, "GET", `events?select=id,type,payload&id=eq.${Number(event_id)}&customer_id=eq.${person_id}`);
    if (!e || !["room_chat", "correction_submitted", "correction_returned", "chat_note"].includes(e.type)) return null;
    const p = e.payload || {};
    const text = String(p.text || p.corrected || p.comment || "").trim() || ((p.images || []).length ? "（画像）" : "");
    const from = e.type === "chat_note" ? "メモ" : (p.from === "student" || e.type === "correction_submitted") ? "生徒" : "シアニン";
    return { id: e.id, text, from };
  }
  // 「資料に入れる」（off で外す）
  async function keep(env, { person_id, event_id, off }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const m = await messageOf(env, person_id, event_id);
    if (!m) return { ok: false, error: "message_not_found" };
    const payload = off === true || off === "true" ? { event_id: m.id, off: true } : { event_id: m.id, text: m.text.slice(0, 2000), from: m.from };
    await addEvent(env, person_id, "chat_saved", payload, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, event_id: m.id, kept: !payload.off };
  }
  // 「顧客管理に残す」：顧客管理の 1 枚の概要と履歴に、このメッセージを写す（同じものは 1 回だけ）
  async function pin(env, { person_id, event_id }, actor) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const m = await messageOf(env, person_id, event_id);
    if (!m) return { ok: false, error: "message_not_found" };
    const had = await db(env, "GET", `events?select=id&customer_id=eq.${person_id}&type=eq.chat_pin&payload->>event_id=eq.${m.id}&limit=1`);
    if (had.length) return { ok: true, found: true, event_id: m.id, already: true };
    await addEvent(env, person_id, "chat_pin", { event_id: m.id, text: m.text.slice(0, 2000), from: m.from }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, event_id: m.id };
  }

  // メッセージから TaskMaster にタスクを 1 件（shia2n-mcp の TaskmasterWriter をサービスの結び env.TASKS で呼ぶ）
  async function addTask(env, { person_id, event_id, title, deadline }, actor, origin) {
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    if (!env.TASKS || typeof env.TASKS.add !== "function") return { ok: false, error: "no_taskmaster", note: "wrangler.jsonc の services に TASKS（shia2n-mcp の TaskmasterWriter）が要る" };
    if (!(await exists(env, person_id))) return { ok: true, found: false };
    const eid = Number(event_id) || null;
    const link_url = `${String(origin || "https://lab.shia2n.jp").replace(/[/]+$/, "")}/admin#chat/${person_id}${eid ? "/" + eid : ""}`;
    const r = await env.TASKS.add({ title, deadline: deadline || null, link_url, link_title: "マーケくんのチャット" });
    if (!r || !r.ok) {
      await logInbound(env, "chat_task", { person_id, event_id: eid, actor }, r || { ok: false }, 500);
      return { ok: false, error: (r && r.error) || "task_failed" };
    }
    await addEvent(env, person_id, "chat_task", { event_id: eid, task_id: r.id, title: r.title, url: r.url }, actor === "mcp" ? "mcp" : "admin");
    return { ok: true, found: true, task_id: r.id, url: r.url };
  }

  // AI の道具：チャットを言葉で探す（やり取りとメモ）。person_id で 1 人に絞れる
  async function search(env, { q, person_id, folder_id, limit = 30 }) {
    const s = String(q || "").trim();
    if (!s) return { ok: false, error: "need_q" };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    let path = `events?select=id,customer_id,type,payload,occurred_at&type=in.(room_chat,correction_submitted,correction_returned,chat_note)&order=id.desc&limit=3000`;
    if (person_id) { if (!UUID_RE.test(String(person_id))) return { ok: false, error: "bad_person_id" }; path += `&customer_id=eq.${person_id}`; }
    else if (folder_id) {
      const l = await list(env);
      if (!l.folders.some((f) => f.id === folder_id)) return { ok: false, error: "folder_not_found" };
      const ids = l.chats.filter((c) => c.folder_id === folder_id).map((c) => c.person_id);
      if (!ids.length) return { ok: true, count: 0, hits: [], folder_id };
      path += `&customer_id=in.(${ids.join(",")})`;
    }
    const evs = await db(env, "GET", path);
    const textOf = (e) => { const p = e.payload || {}; return String(p.text || p.corrected || p.comment || ""); };
    const hits = evs.filter((e) => textOf(e).includes(s)).slice(0, lim);
    const ids = [...new Set(hits.map((e) => e.customer_id))];
    const names = ids.length ? Object.fromEntries((await db(env, "GET", `customer_summary?select=id,name,email&id=in.(${ids.join(",")})`)).map((p) => [p.id, p.name || p.email])) : {};
    return { ok: true, count: hits.length, hits: hits.map((e) => ({ person_id: e.customer_id, name: names[e.customer_id] || "", event_id: e.id, kind: e.type === "chat_note" ? "メモ" : e.type === "room_chat" ? "メッセージ" : "添削", from: e.type === "chat_note" ? "シアニン（メモ）" : ((e.payload || {}).from === "student" || e.type === "correction_submitted" ? "生徒" : "シアニン"), at: e.occurred_at, text: textOf(e).slice(0, 300) })) };
  }

  return { list, people, get, addNote, setLater, forward, addTask, search, saveFolder, setFolder, keep, pin, readFolders };
}

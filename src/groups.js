// チャットの便 C2b（2026-11-07 Naoki OK 12:48・見本 https://claude.ai/artifact/Rpu6FQZSs76gixu6VDeQ2w）：グループチャット。
//  ・グループはシアニンが作り、生徒を入れる（フォルダからまとめて・1 人ずつ）。生徒どうしの 1 対 1 は無い
//  ・送れるのは文と画像（1 通 4 枚まで）。返信はスレッド（thread_of）。スタンプは 6 つ（REACTIONS）
//  ・既読：生徒は b_chat_group_members.read_upto、シアニンは b_chat_groups.admin_read_upto
//  ・生徒に見えるのは、入っているグループだけ。ほかの人のメールは返さない
//  ・名前（C2b-2・src/names.js）：生徒の画面ではニックネームだけ（無い人は「メンバー」・本名は出さない）。シアニンの画面では「ニックネーム（本名）」
//    生徒はニックネームを決めるまで送れない（need_nickname）
//  ・表は supabase/c2b_chat_groups.sql の 3 つ。表がまだ無い置き場では一覧は空で返し、作る・送るは need_sql で断る
export const REACTIONS = ["👍", "❤️", "😂", "🙏", "🔥", "👀"];
export const GROUP_NAME_MAX = 40;
export const TEXT_MAX = 8000;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const CYANIN = "cyanin";
const missing = (e) => /42P01|PGRST205|does not exist|Could not find the table| 404:/i.test(String((e && e.message) || e));

export function groupName(v) {
  const n = String(v ?? "").replace(/\s+/g, " ").trim();
  return n && n.length <= GROUP_NAME_MAX ? n : null;
}
const whoOf = (r) => r.from_customer || CYANIN;

// メッセージの行（古い順）→ 本流のメッセージ（スレッドの返信を中に持つ）。スタンプは誰が押したかの並び
// members：[{customer_id, read_upto, left_at}]・names：番号 → 名前
export function buildView(rows, members, names, viewer) {
  const live = (rows || []).filter((r) => !r.deleted_at).sort((a, b) => a.id - b.id);
  const react = {};
  for (const r of live.filter((x) => x.kind === "react")) {
    const m = (react[r.target] = react[r.target] || {});
    const l = (m[r.emoji] = m[r.emoji] || []);
    if (!l.includes(whoOf(r))) l.push(whoOf(r));
  }
  const active = (members || []).filter((m) => !m.left_at);
  const nameOf = (w) => (w === CYANIN ? "シアニン" : names[w] || "受講生");
  const one = (r) => {
    const w = whoOf(r);
    const readers = active.filter((m) => m.customer_id !== w && Number(m.read_upto || 0) >= r.id).length;
    return {
      id: r.id, from: w === CYANIN ? CYANIN : "student", who: w, name: nameOf(w), mine: w === viewer, at: r.created_at,
      text: r.text || "", images: Array.isArray(r.images) ? r.images : [],
      reactions: Object.entries(react[r.id] || {}).filter(([, l]) => l.length).map(([emoji, l]) => ({ emoji, count: l.length, mine: l.includes(viewer), names: l.map(nameOf) })),
      read: readers, of: active.filter((m) => m.customer_id !== w).length,
    };
  };
  const msgs = live.filter((r) => r.kind === "msg");
  const roots = msgs.filter((r) => !r.thread_of).map((r) => {
    const reps = msgs.filter((x) => x.thread_of === r.id).map(one);
    return { ...one(r), replies: reps, reply_count: reps.length, last_reply_at: reps.length ? reps[reps.length - 1].at : null, repliers: [...new Set(reps.map((x) => x.who))].slice(0, 3).map((w) => ({ who: w, name: nameOf(w) })) };
  });
  return roots;
}

export function makeGroups({ db, push, logInbound, names, nicks }) {
  // 番号 → 呼び名。mode=admin は「ニックネーム（本名）」、mode=student はニックネームだけ（無ければ「メンバー」）
  async function nameMap(env, ids, mode = "admin") {
    const real = await realNames(env, ids);
    const nk = nicks ? await nicks.nicknames(env, Object.keys(real)) : {};
    return Object.fromEntries(Object.keys(real).map((id) => [id, mode === "student" ? nk[id] || "メンバー" : nk[id] ? `${nk[id]}（${real[id]}）` : real[id]]));
  }
  async function realNames(env, ids) {
    const u = [...new Set(ids.filter((x) => UUID_RE.test(String(x))))];
    if (!u.length) return {};
    const rows = await db(env, "GET", `customer_summary?select=id,name,email&id=in.(${u.join(",")})`);
    if (names) { try { const st = await names(env); for (const r of rows) { const n = st.byEmail.get(String(r.email || "").toLowerCase()); if (n) r.name = n; } } catch (_) {} }
    return Object.fromEntries(rows.map((r) => [r.id, r.name || String(r.email || "").split("@")[0] || "受講生"]));
  }
  const groupRow = async (env, id) => (UUID_RE.test(String(id || "")) ? (await db(env, "GET", `b_chat_groups?select=*&id=eq.${id}`))[0] || null : null);
  const membersOf = async (env, id) => db(env, "GET", `b_chat_group_members?select=customer_id,joined_at,left_at,read_upto&group_id=eq.${id}`);
  const rowsOf = async (env, id) => db(env, "GET", `b_chat_group_messages?select=id,kind,from_customer,text,images,thread_of,target,emoji,created_at,deleted_at&group_id=eq.${id}&order=id.asc&limit=5000`);
  const lastOf = (rows) => rows.filter((r) => r.kind === "msg" && !r.deleted_at).slice(-1)[0] || null;

  // ---------- シアニン ----------
  async function list(env) {
    try {
      const gs = await db(env, "GET", "b_chat_groups?select=*&closed_at=is.null&order=sort.asc,created_at.desc");
      if (!gs.length) return { ok: true, groups: [] };
      const ids = gs.map((g) => g.id);
      const [mem, msgs] = await Promise.all([
        db(env, "GET", `b_chat_group_members?select=group_id,customer_id,left_at&group_id=in.(${ids.join(",")})`),
        db(env, "GET", `b_chat_group_messages?select=id,group_id,kind,from_customer,text,images,created_at,deleted_at,thread_of&group_id=in.(${ids.join(",")})&kind=eq.msg&order=id.asc&limit=20000`),
      ]);
      const nm = await nameMap(env, msgs.map((m) => m.from_customer).filter(Boolean));
      return {
        ok: true,
        groups: gs.map((g) => {
          const mine = msgs.filter((m) => m.group_id === g.id && !m.deleted_at);
          const last = mine[mine.length - 1] || null;
          const unread = mine.filter((m) => m.from_customer && m.id > Number(g.admin_read_upto || 0)).length;
          return {
            id: g.id, name: g.name, members: mem.filter((m) => m.group_id === g.id && !m.left_at).length, unread_for_admin: unread, need: unread > 0,
            last_at: last ? last.created_at : g.created_at, last_from: last ? (last.from_customer ? "student" : CYANIN) : null,
            last_name: last ? (last.from_customer ? nm[last.from_customer] || "受講生" : "シアニン") : "", last_text: last ? String(last.text || ((last.images || []).length ? "（画像）" : "")).replace(/\s+/g, " ").slice(0, 60) : "",
          };
        }),
      };
    } catch (e) { return { ok: true, groups: [], note: missing(e) ? "need_sql" : "read_failed" }; }
  }

  async function get(env, { group_id, mark_read = false }) {
    const g = await groupRow(env, group_id).catch((e) => { if (missing(e)) return { need_sql: true }; throw e; });
    if (!g) return { ok: true, found: false };
    if (g.need_sql) return { ok: false, error: "need_sql" };
    const [mem, rows] = await Promise.all([membersOf(env, g.id), rowsOf(env, g.id)]);
    const nm = await nameMap(env, [...mem.map((m) => m.customer_id), ...rows.map((r) => r.from_customer).filter(Boolean)]);
    const last = lastOf(rows);
    if (mark_read && last && last.id > Number(g.admin_read_upto || 0)) await db(env, "PATCH", `b_chat_groups?id=eq.${g.id}`, { admin_read_upto: last.id }, "return=minimal");
    return {
      ok: true, found: true, group: { id: g.id, name: g.name, closed_at: g.closed_at, created_at: g.created_at },
      members: mem.filter((m) => !m.left_at).map((m) => ({ id: m.customer_id, name: nm[m.customer_id] || "受講生", joined_at: m.joined_at })),
      messages: buildView(rows, mem, nm, CYANIN), reactions: REACTIONS,
    };
  }

  // 作る（name・member_ids）
  async function create(env, { name, member_ids = [] }, actor) {
    const n = groupName(name);
    if (!n) return { ok: false, error: "bad_name", max: GROUP_NAME_MAX };
    const ids = [...new Set((Array.isArray(member_ids) ? member_ids : []).map(String))];
    if (ids.some((x) => !UUID_RE.test(x)) || ids.length > 200) return { ok: false, error: "bad_member_ids", max: 200 };
    try {
      const [g] = await db(env, "POST", "b_chat_groups", [{ name: n, created_by: String(actor || "").slice(0, 200) }], "return=representation");
      if (ids.length) await db(env, "POST", "b_chat_group_members", ids.map((c) => ({ group_id: g.id, customer_id: c })), "return=minimal");
      await logInbound(env, "chat_group", { action: "create", id: g.id, name: n, members: ids.length, by: actor }, { ok: true }, 200);
      return { ok: true, group: { id: g.id, name: g.name }, members: ids.length };
    } catch (e) { return { ok: false, error: missing(e) ? "need_sql" : "write_failed", detail: String((e && e.message) || e).slice(0, 160) }; }
  }

  // 名前を変える（name）・人を入れる（add_ids）・抜けてもらう（remove_ids）・閉じる（close）
  async function update(env, { group_id, name, add_ids = [], remove_ids = [], close = false }, actor) {
    const g = await groupRow(env, group_id);
    if (!g) return { ok: false, error: "not_found" };
    const now = new Date().toISOString();
    const out = { ok: true, group_id: g.id };
    if (name != null && name !== "") {
      const n = groupName(name); if (!n) return { ok: false, error: "bad_name", max: GROUP_NAME_MAX };
      await db(env, "PATCH", `b_chat_groups?id=eq.${g.id}`, { name: n }, "return=minimal"); out.name = n;
    }
    const add = [...new Set((add_ids || []).map(String))], rm = [...new Set((remove_ids || []).map(String))];
    if ([...add, ...rm].some((x) => !UUID_RE.test(x))) return { ok: false, error: "bad_member_ids" };
    if (add.length) {
      const mem = await membersOf(env, g.id);
      for (const c of add) {
        if (mem.some((m) => m.customer_id === c)) await db(env, "PATCH", `b_chat_group_members?group_id=eq.${g.id}&customer_id=eq.${c}`, { left_at: null }, "return=minimal");
        else await db(env, "POST", "b_chat_group_members", [{ group_id: g.id, customer_id: c }], "return=minimal");
      }
      out.added = add.length;
    }
    for (const c of rm) await db(env, "PATCH", `b_chat_group_members?group_id=eq.${g.id}&customer_id=eq.${c}`, { left_at: now }, "return=minimal");
    if (rm.length) out.removed = rm.length;
    if (close === true || close === "true") { await db(env, "PATCH", `b_chat_groups?id=eq.${g.id}`, { closed_at: now }, "return=minimal"); out.closed = true; }
    await logInbound(env, "chat_group", { action: "update", id: g.id, ...out, by: actor }, { ok: true }, 200);
    return out;
  }

  // 送る（シアニンか生徒）。thread_of でスレッドの返信。also_main ならグループの本流にも同じ文を流す（シアニンだけ）
  async function post(env, { group_id, text, images = [], thread_of = null, also_main = false }, who, actor) {
    const g = await groupRow(env, group_id);
    if (!g || g.closed_at) return { ok: false, error: "not_found" };
    const t = String(text ?? "").trim();
    const imgs = Array.isArray(images) ? images.map(String) : [];
    if (!t && !imgs.length) return { ok: false, error: "empty" };
    if (t.length > TEXT_MAX) return { ok: false, error: "too_long", max: TEXT_MAX };
    if (imgs.length > 4) return { ok: false, error: "too_many_images", max: 4 };
    const mem = await membersOf(env, g.id);
    const isCyanin = who === CYANIN;
    if (!isCyanin && !mem.some((m) => m.customer_id === who && !m.left_at)) return { ok: false, error: "not_member" };
    const myNick = !isCyanin && nicks ? await nicks.nickname(env, who) : "";
    if (!isCyanin && nicks && !myNick) return { ok: false, error: "need_nickname" };
    let root = null;
    if (thread_of != null && thread_of !== "") {
      [root] = await db(env, "GET", `b_chat_group_messages?select=id,thread_of,from_customer&id=eq.${Number(thread_of)}&group_id=eq.${g.id}&kind=eq.msg`);
      if (!root || root.thread_of) return { ok: false, error: "bad_thread" };
    }
    const row = { group_id: g.id, kind: "msg", from_customer: isCyanin ? null : who, text: t, images: imgs, thread_of: root ? root.id : null, actor: String(actor || "").slice(0, 40) };
    const [m] = await db(env, "POST", "b_chat_group_messages", [row], "return=representation");
    if (isCyanin && root && (also_main === true || also_main === "true")) await db(env, "POST", "b_chat_group_messages", [{ ...row, thread_of: null }], "return=minimal");
    // 自分の分は読んだことにする
    if (isCyanin) await db(env, "PATCH", `b_chat_groups?id=eq.${g.id}`, { admin_read_upto: m.id }, "return=minimal");
    else await db(env, "PATCH", `b_chat_group_members?group_id=eq.${g.id}&customer_id=eq.${who}`, { read_upto: m.id }, "return=minimal");
    // 通知：スレッドの返信は、元の発言者とそのスレッドで話した人だけ。本流は入っている全員
    const body = (t || "（画像）").replace(/\s+/g, " ").slice(0, 120);
    let to = mem.filter((x) => !x.left_at).map((x) => x.customer_id);
    if (root) {
      const talked = (await db(env, "GET", `b_chat_group_messages?select=from_customer&thread_of=eq.${root.id}&kind=eq.msg`)).map((x) => x.from_customer);
      to = to.filter((c) => c === root.from_customer || talked.includes(c));
    }
    to = to.filter((c) => c !== who);
    const nm = isCyanin ? {} : await nameMap(env, [who]);
    const title = `${g.name}${root ? "（スレッド）" : ""}`;
    if (push) {
      for (const c of to) await push.sendTo(env, c, { title, body: `${isCyanin ? "シアニン" : myNick || "メンバー"}：${body}`, url: `/app#room/group/${g.id}`, tag: `group-${g.id}` });
      if (!isCyanin) await push.send(env, { title, body: `${nm[who] || "受講生"}：${body}`, url: `/admin#chat/group/${g.id}`, tag: `group-${g.id}` });
    }
    return { ok: true, id: m.id, notified: to.length };
  }

  // スタンプ：同じ人が同じスタンプを押していれば外し、なければ付ける
  async function react(env, { group_id, message_id, emoji }, who) {
    if (!REACTIONS.includes(emoji)) return { ok: false, error: "bad_emoji", allowed: REACTIONS };
    const g = await groupRow(env, group_id);
    if (!g || g.closed_at) return { ok: false, error: "not_found" };
    if (who !== CYANIN && !(await membersOf(env, g.id)).some((m) => m.customer_id === who && !m.left_at)) return { ok: false, error: "not_member" };
    const [t] = await db(env, "GET", `b_chat_group_messages?select=id&id=eq.${Number(message_id)}&group_id=eq.${g.id}&kind=eq.msg`);
    if (!t) return { ok: false, error: "message_not_found" };
    const whoQ = who === CYANIN ? "from_customer=is.null" : `from_customer=eq.${who}`;
    const had = await db(env, "GET", `b_chat_group_messages?select=id&group_id=eq.${g.id}&kind=eq.react&target=eq.${t.id}&emoji=eq.${encodeURIComponent(emoji)}&${whoQ}&deleted_at=is.null`);
    if (had.length) {
      await db(env, "PATCH", `b_chat_group_messages?id=in.(${had.map((x) => x.id).join(",")})`, { deleted_at: new Date().toISOString() }, "return=minimal");
      return { ok: true, on: false };
    }
    await db(env, "POST", "b_chat_group_messages", [{ group_id: g.id, kind: "react", from_customer: who === CYANIN ? null : who, target: t.id, emoji, actor: who === CYANIN ? "admin" : "site" }], "return=minimal");
    return { ok: true, on: true };
  }

  // 1 対 1 の右のカード：その人が入っているグループ
  async function groupsOf(env, person_id) {
    try {
      const mem = await db(env, "GET", `b_chat_group_members?select=group_id&customer_id=eq.${person_id}&left_at=is.null`);
      if (!mem.length) return [];
      return (await db(env, "GET", `b_chat_groups?select=id,name&closed_at=is.null&id=in.(${mem.map((m) => m.group_id).join(",")})`));
    } catch (_) { return []; }
  }

  // 言葉で探す（グループのメッセージ）
  async function search(env, { q, group_id }) {
    const s = String(q || "").trim(); if (!s) return [];
    try {
      let path = `b_chat_group_messages?select=id,group_id,from_customer,text,created_at,thread_of&kind=eq.msg&deleted_at=is.null&order=id.desc&limit=3000`;
      if (group_id) path += `&group_id=eq.${group_id}`;
      const rows = (await db(env, "GET", path)).filter((r) => String(r.text || "").includes(s));
      if (!rows.length) return [];
      const gs = await db(env, "GET", `b_chat_groups?select=id,name&id=in.(${[...new Set(rows.map((r) => r.group_id))].join(",")})`);
      const nm = await nameMap(env, rows.map((r) => r.from_customer).filter(Boolean));
      const gn = Object.fromEntries(gs.map((g) => [g.id, g.name]));
      return rows.map((r) => ({ group_id: r.group_id, name: gn[r.group_id] || "", event_id: r.id, kind: r.thread_of ? "グループのスレッド" : "グループ", from: r.from_customer ? nm[r.from_customer] || "受講生" : "シアニン", at: r.created_at, text: String(r.text).slice(0, 300) }));
    } catch (_) { return []; }
  }

  // ---------- 生徒 ----------
  async function mine(env, customer_id) {
    try {
      const mem = await db(env, "GET", `b_chat_group_members?select=group_id,read_upto&customer_id=eq.${customer_id}&left_at=is.null`);
      if (!mem.length) return { ok: true, groups: [], unread: 0 };
      const gs = await db(env, "GET", `b_chat_groups?select=id,name,created_at&closed_at=is.null&id=in.(${mem.map((m) => m.group_id).join(",")})`);
      if (!gs.length) return { ok: true, groups: [], unread: 0 };
      const [msgs, cnt] = await Promise.all([
        db(env, "GET", `b_chat_group_messages?select=id,group_id,from_customer,text,images,created_at,thread_of&kind=eq.msg&deleted_at=is.null&group_id=in.(${gs.map((g) => g.id).join(",")})&order=id.asc&limit=20000`),
        db(env, "GET", `b_chat_group_members?select=group_id&left_at=is.null&group_id=in.(${gs.map((g) => g.id).join(",")})`),
      ]);
      const nm = await nameMap(env, msgs.map((m) => m.from_customer).filter(Boolean), "student");
      const out = gs.map((g) => {
        const read = Number((mem.find((m) => m.group_id === g.id) || {}).read_upto || 0);
        const ms = msgs.filter((m) => m.group_id === g.id);
        const last = ms.filter((m) => !m.thread_of).slice(-1)[0] || null;
        return { id: g.id, name: g.name, members: cnt.filter((c) => c.group_id === g.id).length, unread: ms.filter((m) => m.id > read && m.from_customer !== customer_id).length,
          last_at: last ? last.created_at : g.created_at, last_name: last ? (last.from_customer ? (last.from_customer === customer_id ? "あなた" : nm[last.from_customer] || "メンバー") : "シアニン") : "", last_text: last ? String(last.text || "（画像）").replace(/\s+/g, " ").slice(0, 60) : "" };
      }).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
      return { ok: true, groups: out, unread: out.reduce((s, g) => s + g.unread, 0) };
    } catch (e) { return { ok: true, groups: [], unread: 0, note: missing(e) ? "need_sql" : "read_failed" }; }
  }

  async function view(env, { group_id }, customer_id) {
    const g = await groupRow(env, group_id);
    if (!g || g.closed_at) return { ok: false, error: "not_found" };
    const mem = await membersOf(env, g.id);
    if (!mem.some((m) => m.customer_id === customer_id && !m.left_at)) return { ok: false, error: "not_found" };
    const rows = await rowsOf(env, g.id);
    const nm = await nameMap(env, rows.map((r) => r.from_customer).filter(Boolean), "student");
    const me = nicks ? await nicks.nickname(env, customer_id) : "";
    if (me) nm[customer_id] = me;
    return { ok: true, group: { id: g.id, name: g.name }, members: mem.filter((m) => !m.left_at).length, me: { nickname: me },
      messages: buildView(rows, mem, nm, customer_id), reactions: REACTIONS };
  }

  async function markRead(env, { group_id }, customer_id) {
    const g = await groupRow(env, group_id);
    if (!g) return { ok: false, error: "not_found" };
    const rows = await db(env, "GET", `b_chat_group_messages?select=id&group_id=eq.${g.id}&kind=eq.msg&order=id.desc&limit=1`);
    const upto = rows[0] ? rows[0].id : 0;
    await db(env, "PATCH", `b_chat_group_members?group_id=eq.${g.id}&customer_id=eq.${customer_id}&left_at=is.null`, { read_upto: upto }, "return=minimal");
    return { ok: true, upto };
  }

  // 生徒が見てよい画像か：その画像がこのグループのメッセージに載っていて、見る人が入っている
  async function imageAllowed(env, { group_id, key }, customer_id) {
    const g = await groupRow(env, group_id);
    if (!g) return false;
    const mem = await membersOf(env, g.id);
    if (customer_id !== CYANIN && !mem.some((m) => m.customer_id === customer_id && !m.left_at)) return false;
    const rows = await db(env, "GET", `b_chat_group_messages?select=images&group_id=eq.${g.id}&kind=eq.msg&deleted_at=is.null&limit=5000`);
    return rows.some((r) => Array.isArray(r.images) && r.images.includes(key));
  }

  return { list, get, create, update, post, react, groupsOf, search, mine, view, markRead, imageAllowed, CYANIN };
}

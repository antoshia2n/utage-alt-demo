// 予約の便⑤（2026-11-06・デモ v5 に Naoki OK）：予約を Google カレンダーに書き込む
// 2026-11-06 担当者（Naoki OK）：つなぐ先を「担当者」ごとにした（表 b_staff）。予約メニューは担当者を 1 人選ぶ
// しくみ：担当者の Google アカウントに小さな Apps Script（ウェブアプリ）を置き、マーケくんから合言葉つきで呼ぶ。
//   create … 予定を作る（予約した人をゲストに入れると Google から招待が届く）→ 予定の番号を返す
//   delete … 予定を消す（キャンセル・日時の変更のとき）
//   busy   … その期間の予定（終日は除く）。空き時間を出すときに避ける
//   ping   … つながっているか（カレンダーの名前を返す）
// OAuth のクライアントを作らずに済むので、担当者の手は「コードを貼って公開・URL を貼る」だけ。
// busy の無い古いコード（便⑤の初版）のときは、ical_fallback の担当者だけ今までの iCal で読む
const SCRIPT_URL_RE = /^https:[/][/]script[.]google[.]com[/](a[/][^/\s]+[/])?macros[/]s[/][A-Za-z0-9_-]{20,200}[/]exec$/;

export function scriptCode(secret) {
  return `// マーケくん → Google カレンダー（予約を書き込む）。このまま貼って「デプロイ → ウェブアプリ」で公開してください
const SECRET = ${JSON.stringify(secret)};
function doPost(e) {
  const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  if (req.secret !== SECRET) return out({ ok: false, error: "bad_secret" });
  const cal = CalendarApp.getDefaultCalendar();
  if (req.action === "ping") return out({ ok: true, calendar: cal.getName() });
  if (req.action === "create") {
    const guests = (req.guests || []).filter(String);
    const ev = cal.createEvent(req.title, new Date(req.start), new Date(req.end), { description: req.description || "", location: req.location || "", guests: guests.join(","), sendInvites: guests.length > 0 });
    return out({ ok: true, id: ev.getId() });
  }
  if (req.action === "busy") {
    const busy = cal.getEvents(new Date(req.from), new Date(req.to)).filter((ev) => !ev.isAllDayEvent() && ev.getMyStatus() !== CalendarApp.GuestStatus.NO)
      .map((ev) => ({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() }));
    return out({ ok: true, busy: busy });
  }
  if (req.action === "delete") {
    const ev = req.id ? cal.getEventById(req.id) : null;
    if (ev) ev.deleteEvent();
    return out({ ok: true, found: !!ev });
  }
  return out({ ok: false, error: "bad_action" });
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}

const BUSY_TTL = 30e3, busyCache = new Map();
const pub = (x, used = []) => ({ id: x.id, name: x.name, email: x.email, set: !!(x.script_url && x.script_secret), has_secret: !!x.script_secret, ical_fallback: !!x.ical_fallback, updated_at: x.updated_at, used });

export function makeGcal({ db, logInbound, fetchImpl }) {
  const doFetch = (...a) => (fetchImpl || fetch)(...a);
  const now = () => new Date().toISOString();
  async function staffById(env, id) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const [x] = await db(env, "GET", `b_staff?select=*&id=eq.${id}`);
    return x || null;
  }
  async function call(staff, action, payload = {}) {
    if (!staff || !staff.script_url || !staff.script_secret) return { ok: false, error: "unset" };
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      const res = await doFetch(staff.script_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, action, secret: staff.script_secret }), redirect: "follow", signal: ctl.signal });
      clearTimeout(timer);
      const txt = await res.text();
      let j; try { j = JSON.parse(txt); } catch (_) { return { ok: false, error: "not_json", status: res.status }; }
      return j && typeof j === "object" ? j : { ok: false, error: "not_json" };
    } catch (e) {
      return { ok: false, error: e && e.name === "AbortError" ? "timeout" : "fetch_failed" };
    }
  }

  // 担当者の一覧（どの予約メニューで使っているかつき。URL と合言葉は返さない）
  async function list(env) {
    const [rows, types] = await Promise.all([db(env, "GET", "b_staff?select=*&archived_at=is.null&order=created_at.asc"), db(env, "GET", "b_booking_types?select=id,title,staff_id&archived_at=is.null")]);
    return { ok: true, staff: rows.map((x) => pub(x, types.filter((t) => t.staff_id === x.id).map((t) => t.title))) };
  }
  async function set(env, args = {}, by = "admin") {
    const cur = args.id ? await staffById(env, args.id) : null;
    if (args.id && !cur) return { ok: false, error: "not_found" };
    const row = { updated_at: now(), updated_by: String(by).slice(0, 200) };
    if (args.archived === true) {
      const used = (await db(env, "GET", `b_booking_types?select=title&archived_at=is.null&staff_id=eq.${cur.id}`)).map((t) => t.title);
      if (used.length) return { ok: false, error: "staff_in_use", used };
      row.archived_at = now();
    } else {
      if ("name" in args || !cur) { const v = String(args.name || "").trim(); if (!v || v.length > 60) return { ok: false, error: "bad_staff_name" }; row.name = v; }
      if ("email" in args) { const v = String(args.email || "").trim().toLowerCase(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: "bad_staff_email" }; row.email = v; }
    }
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_staff?id=eq.${cur.id}`, row, "return=representation");
    else [out] = await db(env, "POST", "b_staff", [row], "return=representation");
    await logInbound(env, "change", { kind: "staff", id: out.id, name: out.name, by, archived: !!out.archived_at }, { ok: true }, 200);
    return { ok: true, created: !cur, staff: pub(out) };
  }
  // その担当者の合言葉を作って、貼るコードを返す（合言葉は一度作ったら変えない）
  async function makeCode(env, id, by) {
    const x = await staffById(env, id);
    if (!x) return { ok: false, error: "not_found" };
    let secret = x.script_secret;
    if (!secret) {
      const a = new Uint8Array(24); crypto.getRandomValues(a);
      secret = [...a].map((v) => v.toString(16).padStart(2, "0")).join("");
      await db(env, "PATCH", `b_staff?id=eq.${x.id}`, { script_secret: secret, updated_at: now(), updated_by: String(by).slice(0, 200) }, "return=minimal");
    }
    return { ok: true, code: scriptCode(secret) };
  }
  // ウェブアプリの URL を入れて、つながるか確かめる。空で外す
  async function connect(env, id, url, by) {
    const x = await staffById(env, id);
    if (!x) return { ok: false, error: "not_found" };
    const v = String(url || "").trim();
    if (v && !SCRIPT_URL_RE.test(v)) return { ok: false, error: "bad_url", note: "https://script.google.com/macros/s/…/exec の形の URL を貼ってください" };
    if (v && !x.script_secret) return { ok: false, error: "no_secret", note: "先に「コードをコピー」からコードを作ってください" };
    let calendar = "";
    if (v) {
      const r = await call({ script_url: v, script_secret: x.script_secret }, "ping");
      if (!r.ok) return { ok: false, error: r.error === "bad_secret" ? "bad_secret" : "ping_failed", detail: r.error || null };
      calendar = r.calendar || "";
    }
    await db(env, "PATCH", `b_staff?id=eq.${x.id}`, { script_url: v, updated_at: now(), updated_by: String(by).slice(0, 200) }, "return=minimal");
    busyCache.clear();
    await logInbound(env, "gcal_set", { by, staff: x.id, cleared: !v, calendar }, { ok: true }, 200);
    return { ok: true, set: !!v, calendar };
  }
  // つながっているかをその場で確かめる（画面の「確認」）
  async function ping(env, id) { const x = await staffById(env, id); if (!x) return { ok: false, error: "not_found" }; const r = await call(x, "ping"); return { ok: !!r.ok, calendar: r.calendar || "", error: r.ok ? null : r.error }; }

  // 担当者の予定（空き時間を出すときに避ける）。30 秒だけ覚えておく。読めなければ state を返す
  async function busy(env, staffId, fromMs, toMs) {
    const x = await staffById(env, staffId);
    if (!x) return { state: "none" };
    const k = `${x.id}|${Math.floor(fromMs / 60e3)}|${Math.floor(toMs / 60e3)}`, hit = busyCache.get(k);
    if (hit && Date.now() - hit.at < BUSY_TTL) return hit.v;
    const r = await call(x, "busy", { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
    const v = r.ok && Array.isArray(r.busy) ? { state: "ok", busy: r.busy.map((b) => ({ start: Number(b.start), end: Number(b.end) })).filter((b) => b.end > b.start) }
      : { state: r.error === "unset" ? "unset" : "error", error: r.error, fallback: !!x.ical_fallback };
    if (v.state === "ok") busyCache.set(k, { at: Date.now(), v });
    return v;
  }
  // 予約を予定にする。失敗しても予約は止めない（null を返す）
  async function createFor(env, t, b, person) {
    if (t.gcal_write === false || !t.staff_id) return null;
    const x = await staffById(env, t.staff_id);
    if (!x || !x.script_url) return null;
    const lines = [`予約者：${person.name || ""}（${person.email || ""}）`, t.zoom_url ? `Zoom：${t.zoom_url}` : "", ...(b.answers || []).map((a) => `■ ${a.label}\n${a.value || "（空欄）"}`), b.topic ? `■ 相談したいこと\n${b.topic}` : "", "（マーケくんの予約から自動で入れた予定）"].filter(Boolean);
    const r = await call(x, "create", {
      title: `${t.title}：${person.name || person.email || "予約"}`,
      start: b.slot, end: new Date(Date.parse(b.slot) + (b.minutes || t.minutes || 30) * 60e3).toISOString(),
      description: lines.join("\n\n"), location: t.zoom_url || "",
      guests: t.gcal_invite !== false && person.email ? [person.email] : [],
    });
    busyCache.clear();
    return r.ok && r.id ? { id: String(r.id).slice(0, 300), staff_id: x.id } : null;
  }
  async function remove(env, staffId, eventId) {
    if (!eventId) return { ok: true, skipped: true };
    const x = await staffById(env, staffId);
    busyCache.clear();
    return await call(x, "delete", { id: eventId });
  }
  return { list, set, makeCode, connect, ping, busy, createFor, remove, staffById };
}

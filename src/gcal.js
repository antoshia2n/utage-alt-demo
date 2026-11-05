// 予約の便⑤（2026-11-06・デモ v5 に Naoki OK）：予約を Naoki の Google カレンダーに書き込む
// しくみ：Naoki の Google アカウントに小さな Apps Script（ウェブアプリ）を置き、マーケくんから合言葉つきで呼ぶ。
//   create … 予定を作る（予約した人をゲストに入れると Google から招待が届く）→ 予定の番号を返す
//   delete … 予定を消す（キャンセル・日時の変更のとき）
//   ping   … つながっているか（カレンダーの名前を返す）
// OAuth のクライアントを作らずに済むので、Naoki の手は「コードを貼って公開・URL を貼る」だけ。
// 置き場所：表 settings の gcal_script_url（ウェブアプリの URL）と gcal_script_secret（合言葉。画面で作る）
// 空き時間を読むのは今までどおり iCal の非公開 URL（today.js の busyBetween）。

const URL_KEY = "gcal_script_url", SECRET_KEY = "gcal_script_secret";
const SCRIPT_URL_RE = /^https:[/][/]script[.]google[.]com[/](a[/][^/\s]+[/])?macros[/]s[/][A-Za-z0-9_-]{20,200}[/]exec$/;

export function scriptCode(secret) {
  return `// マーケくん → Google カレンダー（予約を書き込む）。このまま貼って「デプロイ → ウェブアプリ」で公開してください
const SECRET = ${JSON.stringify(secret)};
function doPost(e) {
  const req = JSON.parse(e.postData.contents || "{}");
  if (req.secret !== SECRET) return out({ ok: false, error: "bad_secret" });
  const cal = CalendarApp.getDefaultCalendar();
  if (req.action === "ping") return out({ ok: true, calendar: cal.getName() });
  if (req.action === "create") {
    const guests = (req.guests || []).filter(String);
    const ev = cal.createEvent(req.title, new Date(req.start), new Date(req.end), { description: req.description || "", location: req.location || "", guests: guests.join(","), sendInvites: guests.length > 0 });
    return out({ ok: true, id: ev.getId() });
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

export function makeGcal({ db, logInbound, fetchImpl }) {
  const doFetch = (...a) => (fetchImpl || fetch)(...a);
  async function read(env) {
    const rows = await db(env, "GET", `settings?select=key,value,updated_at&key=in.(${URL_KEY},${SECRET_KEY})`);
    const get = (k) => (rows.find((r) => r.key === k) || {});
    return { url: get(URL_KEY).value || "", secret: get(SECRET_KEY).value || "", updated_at: get(URL_KEY).updated_at || null };
  }
  const put = (env, key, value, by) => db(env, "POST", "settings?on_conflict=key", [{ key, value, updated_at: new Date().toISOString(), updated_by: String(by).slice(0, 200) }], "resolution=merge-duplicates,return=minimal");

  async function call(env, action, payload = {}, cfg) {
    const c = cfg || await read(env);
    if (!c.url || !c.secret) return { ok: false, error: "unset" };
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      const res = await doFetch(c.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, action, secret: c.secret }), redirect: "follow", signal: ctl.signal });
      clearTimeout(timer);
      const txt = await res.text();
      let j; try { j = JSON.parse(txt); } catch (_) { return { ok: false, error: "not_json", status: res.status }; }
      return j && typeof j === "object" ? j : { ok: false, error: "not_json" };
    } catch (e) {
      return { ok: false, error: e && e.name === "AbortError" ? "timeout" : "fetch_failed" };
    }
  }

  // 画面用：つながっているか（URL と合言葉そのものは返さない）
  async function status(env) {
    const c = await read(env);
    return { ok: true, set: !!(c.url && c.secret), has_secret: !!c.secret, updated_at: c.updated_at };
  }
  // 合言葉を作り直して、貼るコードを返す（つなぎ直しのときも使う）
  async function makeCode(env, by) {
    const c = await read(env);
    let secret = c.secret;
    if (!secret) {
      const a = new Uint8Array(24); crypto.getRandomValues(a);
      secret = [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
      await put(env, SECRET_KEY, secret, by);
    }
    return { ok: true, code: scriptCode(secret) };
  }
  // ウェブアプリの URL を入れて、つながるか確かめる。空で外す
  async function connect(env, url, by) {
    const v = String(url || "").trim();
    if (!v) { await put(env, URL_KEY, "", by); await logInbound(env, "gcal_set", { by, cleared: true }, { ok: true }, 200); return { ok: true, set: false }; }
    if (!SCRIPT_URL_RE.test(v)) return { ok: false, error: "bad_url", note: "https://script.google.com/macros/s/…/exec の形の URL を貼ってください" };
    const c = await read(env);
    if (!c.secret) return { ok: false, error: "no_secret", note: "先に「コードをコピー」からコードを作ってください" };
    const r = await call(env, "ping", {}, { url: v, secret: c.secret });
    if (!r.ok) return { ok: false, error: r.error === "bad_secret" ? "bad_secret" : "ping_failed", detail: r.error || null };
    await put(env, URL_KEY, v, by);
    await logInbound(env, "gcal_set", { by, calendar: r.calendar || "" }, { ok: true }, 200);
    return { ok: true, set: true, calendar: r.calendar || "" };
  }
  // 予約を予定にする。失敗しても予約は止めない（null を返す）
  async function createFor(env, t, b, person) {
    if (t.gcal_write === false) return null;
    const lines = [`予約者：${person.name || ""}（${person.email || ""}）`, t.zoom_url ? `Zoom：${t.zoom_url}` : "", ...(b.answers || []).map((a) => `■ ${a.label}\n${a.value || "（空欄）"}`), b.topic ? `■ 相談したいこと\n${b.topic}` : "", "（マーケくんの予約から自動で入れた予定）"].filter(Boolean);
    const r = await call(env, "create", {
      title: `${t.title}：${person.name || person.email || "予約"}`,
      start: b.slot, end: new Date(Date.parse(b.slot) + (b.minutes || t.minutes || 30) * 60e3).toISOString(),
      description: lines.join("\n\n"), location: t.zoom_url || "",
      guests: t.gcal_invite !== false && person.email ? [person.email] : [],
    });
    return r.ok && r.id ? String(r.id).slice(0, 300) : null;
  }
  async function remove(env, id) {
    if (!id) return { ok: true, skipped: true };
    return await call(env, "delete", { id });
  }
  return { status, makeCode, connect, call, createFor, remove };
}

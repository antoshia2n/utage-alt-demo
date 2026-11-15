// 会員サイトの「ジャンルの仕分け」（2026-11-15 Naoki OK 15:35）
//  ・ジャンル＝セミナーアーカイブ以外のプログラム（今ある「○○力」）。生徒の教材の「ジャンルから探す」がそのまま読む
//  ・セミナーアーカイブにしか入っていないコンテンツを「仕分け前」として並べ、AI（Workers AI）がどのジャンルに入るかの案を出す
//  ・Naoki が承認すると、そのジャンルの最初のコースに入る（並びの番号は収録日の 8 桁＝生徒の画面では「関連するセミナー」に並ぶ）
//  ・案は表 b_settings の 1 行（key=genre_suggest）に置く。承認するまで生徒の画面は何も変わらない
import { AI_MODEL } from "./chatai.js";

const KEY = "genre_suggest";
const T = { programs: "b_site_programs", courses: "b_site_courses", contents: "b_site_contents", links: "b_site_content_courses" };
const isArchive = (title) => /セミナーアーカイブ/.test(String(title || ""));
// ジャンル＝名前が「○○力」のプログラム（言語化ライティングカレッジのような講座の一式は入れない）
const isGenre = (title) => !isArchive(title) && /力/.test(String(title || ""));
const ID_RE = /^[0-9a-f-]{36}$/i;

/** 題名・要約・日付の欄から収録日（YYYYMMDD の数）を取る。分からなければ更新日 */
export function dateSeq(c) {
  const t = `${c.title || ""} ${c.summary || ""}`;
  let m = t.match(/(20\d\d)[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) { const y = t.match(/(\d\d)年(\d{1,2})月(\d{1,2})日/); if (y) m = [null, "20" + y[1], y[2], y[3]]; }
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  const d = String(c.publish_at || c.created_at || c.updated_at || "").slice(0, 10).replace(/-/g, "");
  return /^\d{8}$/.test(d) ? Number(d) : 20000101;
}

export function makeGenres({ db }) {
  const get = (env, q) => db(env, "GET", q);

  async function readSug(env) {
    try { const [r] = await get(env, `settings?select=value&key=eq.${KEY}`); return r && r.value ? JSON.parse(r.value) : {}; } catch { return {}; }
  }
  async function writeSug(env, v) {
    await db(env, "POST", "settings?on_conflict=key", [{ key: KEY, value: JSON.stringify(v), updated_at: new Date().toISOString(), updated_by: "genres" }], "resolution=merge-duplicates,return=minimal");
  }

  async function state(env) {
    const [programs, courses, contents, links] = await Promise.all([
      get(env, `${T.programs}?select=id,title,active,sort&order=sort.asc&limit=1000`),
      get(env, `${T.courses}?select=id,program_id,title,sort&order=sort.asc&limit=5000`),
      get(env, `${T.contents}?select=id,title,summary,status,active,publish_at,created_at,updated_at,rec_id&active=eq.true&limit=10000`),
      get(env, `${T.links}?select=content_id,course_id&limit=20000`),
    ]);
    const progOf = new Map(courses.map((c) => [c.id, c.program_id]));
    const archive = new Set(programs.filter((p) => isArchive(p.title)).map((p) => p.id));
    const genres = programs.filter((p) => isGenre(p.title) && p.active !== false).map((p) => {
      const cs = courses.filter((c) => c.program_id === p.id);
      return { program_id: p.id, title: p.title, course_id: cs[0]?.id || null, course_title: cs[0]?.title || "" };
    }).filter((g) => g.course_id);
    const gset = new Set(genres.map((g) => g.program_id));
    const by = new Map();
    for (const l of links) { const p = progOf.get(l.course_id); if (!p) continue; if (!by.has(l.content_id)) by.set(l.content_id, new Set()); by.get(l.content_id).add(p); }
    const pending = contents.filter((c) => { const ps = by.get(c.id); return ps && [...ps].some((p) => archive.has(p)) && ![...ps].some((p) => gset.has(p)); });
    return { genres, pending };
  }

  /** 仕分け前の一覧と、出ている案 */
  async function list(env) {
    const [{ genres, pending }, sug] = await Promise.all([state(env), readSug(env)]);
    const rows = pending.map((c) => ({ id: c.id, title: c.title, summary: String(c.summary || "").slice(0, 140), status: c.status, date: String(dateSeq(c)).replace(/^(\d{4})(\d\d)(\d\d)$/, "$1-$2-$3"), recording: !!c.rec_id, suggest: sug[c.id] || null }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { ok: true, genres, pending: rows, waiting: rows.filter((r) => !r.suggest).length };
  }

  /** 案の無いものに AI で案を出す（1 回に limit 本まで） */
  async function suggest(env, limit = 8) {
    if (!env.AI || typeof env.AI.run !== "function") return { ok: false, error: "no_ai" };
    const [{ genres, pending }, sug] = await Promise.all([state(env), readSug(env)]);
    const todo = pending.filter((c) => !sug[c.id]).slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
    const menu = genres.map((g, i) => `${i + 1}. ${g.title}（${g.course_title}）`).join("\n");
    let made = 0, failed = 0;
    for (const c of todo) {
      try {
        const r = await env.AI.run(AI_MODEL, { temperature: 0.1, max_tokens: 160, messages: [
          { role: "system", content: `会員サイトの動画を、次のジャンルのどれか 1 つに仕分ける。\n${menu}\n答えは JSON だけ：{"n": ジャンルの番号, "why": "理由を 30 文字以内"}` },
          { role: "user", content: `題名：${c.title}\n要約：${String(c.summary || "").slice(0, 600)}` },
        ] });
        const text = String((r && (r.response ?? r.result?.response)) || "");
        const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]);
        const g = genres[Number(j.n) - 1];
        if (!g) { failed++; continue; }
        sug[c.id] = { program_id: g.program_id, title: g.title, why: String(j.why || "").slice(0, 60), at: new Date().toISOString() };
        made++;
      } catch { failed++; }
    }
    if (made) await writeSug(env, sug);
    return { ok: true, looked: todo.length, made, failed, remaining: pending.filter((c) => !sug[c.id]).length };
  }

  /** 承認：items = [{ id: コンテンツ, program_id: ジャンル }]。そのジャンルの最初のコースに、収録日の並びの番号で入れる */
  async function approve(env, items = []) {
    const { genres, pending } = await state(env);
    const pend = new Map(pending.map((c) => [c.id, c]));
    const rows = [];
    for (const it of (Array.isArray(items) ? items : []).slice(0, 200)) {
      const c = pend.get(String(it.id || ""));
      const g = genres.find((x) => x.program_id === String(it.program_id || ""));
      if (!c || !g || !ID_RE.test(c.id)) continue;
      rows.push({ content_id: c.id, course_id: g.course_id, sort: dateSeq(c) });
    }
    if (!rows.length) return { ok: false, error: "nothing" };
    await db(env, "POST", `${T.links}?on_conflict=content_id,course_id`, rows, "resolution=merge-duplicates,return=minimal");
    const sug = await readSug(env);
    for (const r of rows) delete sug[r.content_id];
    await writeSug(env, sug);
    return { ok: true, done: rows.length };
  }

  return { list, suggest, approve };
}

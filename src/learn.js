// B の便 6a：寄せる（見る側）。
//  ・学ぶくんの本物の教材を、写さずに見る表 b_mn_lessons から読む。見られるかは b_mn_access（学ぶくんの受講の結び）で決める。
//    シアニン用の画面に入れるメール（b_admins）は全部見られる。
//  ・公開の面：公式サイトの表（tl_contents）の公開中の記事と、教材の数だけを返す（中身や動画は出さない）。
//  ・添削の指摘（長文用）：原文の一部を引用し、番号で結ぶ。引用は原文に必ずある文字列でなければ受け付けない。
// デモの置き場（B_STORE が無い）には学ぶくんの表も公式サイトの表も無いので、今までどおり b_lessons の仮の教材を返す。

export const LESSON_ID_RE = /^[0-9a-z-]{2,40}$/i;
export const NOTE_MAX = 30;
const SUMMARY_MAX = 400;

// 見る表の行を「プログラム → コース → 教材」の入れ子にする。並びは表の並びの番号どおり
export function groupLessons(rows) {
  const sorted = [...rows].sort((a, b) =>
    (a.program_sort ?? 0) - (b.program_sort ?? 0) || (a.course_sort ?? 0) - (b.course_sort ?? 0) ||
    (a.sort ?? 0) - (b.sort ?? 0) || String(a.title).localeCompare(String(b.title), "ja"));
  const programs = [];
  const pIndex = new Map();
  const cIndex = new Map();
  const ids = new Set();
  for (const r of sorted) {
    if (!pIndex.has(r.program_id)) {
      const p = { id: r.program_id, title: r.program_title, courses: [] };
      pIndex.set(r.program_id, p); programs.push(p);
    }
    const ckey = r.program_id + "/" + r.course_id;
    if (!cIndex.has(ckey)) {
      const c = { id: r.course_id, title: r.course_title, lessons: [] };
      cIndex.set(ckey, c); pIndex.get(r.program_id).courses.push(c);
    }
    cIndex.get(ckey).lessons.push({
      id: r.lesson_id, title: r.title,
      summary: String(r.summary || "").slice(0, SUMMARY_MAX),
      youtube_id: r.youtube_id || null, mindmap_url: safeUrl(r.mindmap_url),
    });
    ids.add(r.lesson_id);
  }
  return { programs, lesson_count: ids.size, row_count: rows.length };
}

// http(s) の住所だけを通す（本文の中の住所をそのまま画面のリンクにするため）
export function safeUrl(u) {
  const s = String(u || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

// 指摘（長文用）を確かめて整える。引用は原文の中に必ずある文字列。番号は 1 から順に振り直す
export function normalizeNotes(notes, original) {
  if (notes === undefined || notes === null) return { ok: true, notes: [] };
  if (!Array.isArray(notes)) return { ok: false, error: "bad_notes" };
  if (notes.length > NOTE_MAX) return { ok: false, error: "too_many_notes", max: NOTE_MAX };
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i] || {};
    const quote = String(n.quote ?? "").trim();
    const text = String(n.text ?? "").trim();
    if (!quote && !text) continue; // 空の行は捨てる
    if (!text) return { ok: false, error: "note_without_text", index: i };
    if (quote && !String(original).includes(quote)) return { ok: false, error: "quote_not_in_original", index: i };
    if (quote.length > 2000 || text.length > 4000) return { ok: false, error: "note_too_long", index: i };
    out.push({ n: out.length + 1, quote, text });
  }
  return { ok: true, notes: out };
}

export function makeLearn(h) {
  const { db } = h;

  async function isAdminEmail(env, email) {
    const rows = await db(env, "GET", `admins?select=email&email=eq.${encodeURIComponent(String(email || "").toLowerCase())}`);
    return rows.length > 0;
  }

  // 1 人が見られる教材。返すのは { source, member, programs, lesson_count, flat }
  async function lessonsFor(env, customer, email) {
    if (!env.B_STORE) {
      const flat = await db(env, "GET", "lessons?select=id,sort,title,summary,minutes,youtube_id&published=eq.true&order=sort.asc");
      return { source: "demo", member: true, programs: [], lesson_count: flat.length, flat };
    }
    const admin = await isAdminEmail(env, email);
    let curricula;
    if (admin) {
      curricula = null; // 全部
    } else {
      const acc = await db(env, "GET", `mn_access?select=curriculum_id&member_id=eq.${customer.id}`);
      curricula = [...new Set(acc.map((a) => a.curriculum_id))];
      if (!curricula.length) return { source: "manabu", member: false, programs: [], lesson_count: 0, flat: [] };
    }
    let q = "mn_lessons?select=curriculum_id,program_id,program_title,program_sort,course_id,course_title,course_sort,lesson_id,sort,title,summary,youtube_id,mindmap_url&limit=5000";
    if (curricula) q += `&curriculum_id=in.(${curricula.map(encodeURIComponent).join(",")})`;
    const rows = await db(env, "GET", q);
    const g = groupLessons(rows);
    return { source: "manabu", member: true, admin, programs: g.programs, lesson_count: g.lesson_count, flat: [] };
  }

  // AI の道具：教材の数（プログラムとコースごと）。person_id を渡すとその人に見える分だけ
  async function listLessons(env, { person_id } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", note: "デモの置き場には学ぶくんの表が無い", count: 0, programs: [] };
    let customer = null, curricula = null;
    if (person_id) {
      [customer] = await db(env, "GET", `customers?select=id,email&id=eq.${encodeURIComponent(person_id)}`);
      if (!customer) return { ok: true, found: false };
      const acc = await db(env, "GET", `mn_access?select=curriculum_id&member_id=eq.${customer.id}`);
      curricula = [...new Set(acc.map((a) => a.curriculum_id))];
      if (!curricula.length) return { ok: true, found: true, member: false, count: 0, programs: [] };
    }
    let q = "mn_lessons?select=curriculum_id,program_id,program_title,program_sort,course_id,course_title,course_sort,lesson_id,sort,title,summary,youtube_id,mindmap_url&limit=5000";
    if (curricula) q += `&curriculum_id=in.(${curricula.map(encodeURIComponent).join(",")})`;
    const rows = await db(env, "GET", q);
    const g = groupLessons(rows);
    return {
      ok: true, found: true, member: true, count: g.lesson_count, rows: g.row_count,
      with_video: new Set(rows.filter((r) => r.youtube_id).map((r) => r.lesson_id)).size,
      programs: g.programs.map((p) => ({ title: p.title, courses: p.courses.map((c) => ({ title: c.title, count: c.lessons.length })) })),
    };
  }

  // 公開の面：公式サイトの公開中の記事と、教材の数（題名や動画は出さない）
  async function publicFront(env) {
    if (!env.B_STORE) return { ok: true, store: "demo", articles: [], catalog: [], lesson_count: 0 };
    const [articles, rows] = await Promise.all([
      db(env, "GET", "tl_contents?select=kind,slug,title,summary,tags,published_at&status=eq.published&order=published_at.desc&limit=5"),
      db(env, "GET", "mn_lessons?select=program_id,program_title,program_sort,course_id,course_title,course_sort,lesson_id,sort,title,curriculum_id&limit=5000"),
    ]);
    const g = groupLessons(rows);
    return {
      ok: true,
      articles: articles.map((a) => ({ kind: a.kind, title: a.title, summary: a.summary || "", tags: Array.isArray(a.tags) ? a.tags : [], published_at: a.published_at })),
      catalog: g.programs.map((p) => ({ title: p.title, count: new Set(p.courses.flatMap((c) => c.lessons.map((l) => l.id))).size })),
      lesson_count: g.lesson_count,
      site_url: "https://evolab.shia2n.jp/",
    };
  }

  return { lessonsFor, listLessons, publicFront, isAdminEmail };
}

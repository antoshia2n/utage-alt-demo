// 会員サイトの「ジャンルの仕分け」（2026-11-15 Naoki OK 15:35）
//  ・ジャンル＝セミナーアーカイブ以外のプログラム（今ある「○○力」）。生徒の教材の「ジャンルから探す」がそのまま読む
//  ・セミナーアーカイブにしか入っていないコンテンツを「仕分け前」として並べ、AI（Workers AI）がどのジャンルに入るかの案を出す
//  ・Naoki が承認すると、そのジャンルの最初のコースに入る（並びの番号は収録日の 8 桁＝生徒の画面では「関連するセミナー」に並ぶ）
//  ・案は R2（IMAGES）の site/genre_suggest.json に置く。承認するまで生徒の画面は何も変わらない
import { AI_MODEL } from "./chatai.js";

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
  const base = String(c.publish_at || c.created_at || c.updated_at || "").slice(0, 10).replace(/-/g, "");
  // 年の無い「10月28日」「11/1」は、作った日の年で読む（作った日より先の日付なら前の年）
  const md = String(c.title || "").match(/(?:^|[^\d])(\d{1,2})(?:月|\/)(\d{1,2})日?/);
  if (md && /^\d{8}$/.test(base)) { let y = Number(base.slice(0, 4)); const v = Number(md[1]) * 100 + Number(md[2]); if (v > Number(base.slice(4))) y--; if (Number(md[1]) >= 1 && Number(md[1]) <= 12) return y * 10000 + v; }
  const d = String(c.publish_at || c.created_at || c.updated_at || "").slice(0, 10).replace(/-/g, "");
  return /^\d{8}$/.test(d) ? Number(d) : 20000101;
}

// AI へ渡すジャンルの中身（2026-11-15 開発部が既存 290 本を精査して決めた線引き）
const HINT = [
  [/習慣力/, "習慣化・自己管理・健康・記録・先延ばし・継続の仕組み"],
  [/思考力/, "思考整理・問い・フレームワーク・目標設定と計画・読書とインプット・マインドマップ"],
  [/マインドセット/, "やる気・行動力・継続の心構え・ブレない心・成果が出る人の考え方"],
  [/AI活用力/, "ChatGPT などの AI ツールの使い方・AI で時短する方法"],
  [/仕事力/, "タスクとスケジュール管理・メモ術・作業の生産性"],
  [/ライティング力/, "言語化・文章術・コピー・ストーリー・伝え方と話し方（X や記事に限らない書く力）"],
  [/影響力/, "X・SNS の運用・ポスト・図解・X 記事・バズ・フォロワー獲得・X の収益化"],
  [/ビジネスモデル/, "商品設計・マネタイズ・オンラインビジネスの全体像・事業戦略・note やメンバーシップの設計"],
  [/マーケティング力/, "ペルソナ・顧客理解・リサーチ・ファン化・ファネル・プロモーション・ポジショニング"],
  [/セールス力/, "セールスライティング・LP・オファー・セミナーセールス・販売の流れ"],
];
const hintOf = (t) => (HINT.find(([re]) => re.test(t)) || [null, ""])[1];

export function makeGenres({ db }) {
  const get = (env, q) => db(env, "GET", q);

  // 案の置き場は R2（IMAGES）の 1 つのファイル（b_settings は 1 行 500 文字までで入らないため）
  const SUG_KEY = "site/genre_suggest.json";
  async function readSug(env) {
    try { const o = env.IMAGES && (await env.IMAGES.get(SUG_KEY)); return o ? JSON.parse(await o.text()) : {}; } catch { return {}; }
  }
  async function writeSug(env, v) {
    if (!env.IMAGES) throw new Error("no_r2");
    await env.IMAGES.put(SUG_KEY, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });
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
    // 仕分けに出すのは生徒に見えている（公開中の）ものだけ。下書きは公開したときに出る（2026-11-15）
    const pending = contents.filter((c) => { const ps = by.get(c.id); return c.status !== "draft" && ps && [...ps].some((p) => archive.has(p)) && ![...ps].some((p) => gset.has(p)); });
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
    const menu = genres.map((g, i) => `${i + 1}. ${g.title}：${hintOf(g.title) || g.course_title}`).join("\n");
    let made = 0, failed = 0, lastErr = "";
    for (const c of todo) {
      try {
        const r = await env.AI.run(AI_MODEL, { temperature: 0.1, max_tokens: 160, messages: [
          { role: "system", content: `会員サイトの動画を、次のジャンルのどれか 1 つに仕分ける。題名の言葉（「マインド」「ライティング」など）に引っぱられず、動画で身につく力で選ぶ。\n${menu}\n答えは JSON だけ：{"n": ジャンルの番号, "why": "理由を 30 文字以内"}` },
          { role: "user", content: `題名：${c.title}\n要約：${String(c.summary || "").slice(0, 600)}` },
        ] });
        const text = typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r?.result?.response ?? "");
        const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]);
        const g = genres[Number(j.n) - 1];
        if (!g) { failed++; lastErr = "no_genre:" + text.slice(0, 80); continue; }
        sug[c.id] = { program_id: g.program_id, title: g.title, why: String(j.why || "").slice(0, 60), at: new Date().toISOString() };
        made++;
      } catch (e) { failed++; lastErr = String((e && e.message) || e).slice(0, 160); }
    }
    if (made) await writeSug(env, sug);
    return { ok: true, looked: todo.length, made, failed, ...(lastErr ? { last_error: lastErr } : {}), remaining: pending.filter((c) => !sug[c.id]).length };
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

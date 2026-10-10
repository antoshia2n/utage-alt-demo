// B の便 15：教材の質問とメモ（2026-10-10 Naoki「進めて」）。表は増やさない。
//   質問 … 生徒が教材の下で書く。添削ルームと同じ部屋に出来事 room_chat（from student）として積み、payload.lesson（id・title）でどの教材かを残す
//   答え … シアニンが部屋から返す。room_chat（from cyanin）に reply_to（質問の出来事の番号）と同じ lesson を付ける。部屋と教材の下の両方に出る
//   メモ … 本人だけが見る。出来事 lesson_memo（lesson_id・text）。いちばん新しいものが今のメモ。空にすると消える
// 生徒は自分が見られる教材にだけ質問とメモを書ける（見られるかは学ぶくんの受講の結び・src/learn.js と同じ決め）。

import { LESSON_ID_RE } from "./learn.js";

export const MEMO_MAX = 4000;
export const QUESTION_MAX = 4000;

const isQuestion = (e) => e.type === "room_chat" && e.payload && e.payload.from === "student" && e.payload.lesson && e.payload.lesson.id;
const isAnswer = (e) => e.type === "room_chat" && e.payload && e.payload.from === "cyanin" && e.payload.reply_to != null;

// 1 つの教材の質問と答え（古い順）。evs は 1 人の部屋の出来事
export function lessonThreads(evs, lessonId) {
  const qs = evs.filter((e) => isQuestion(e) && String(e.payload.lesson.id) === String(lessonId));
  const ids = new Set(qs.map((q) => String(q.id)));
  const answers = evs.filter((e) => isAnswer(e) && ids.has(String(e.payload.reply_to)));
  return qs.map((q) => ({
    id: q.id, at: q.occurred_at, text: q.payload.text || "",
    answers: answers.filter((a) => String(a.payload.reply_to) === String(q.id)).map((a) => ({ id: a.id, at: a.occurred_at, text: a.payload.text || "" })),
  }));
}

// まだ答えていない教材の質問（部屋の一覧の印に使う）
export function openLessonQuestions(evs) {
  const answered = new Set(evs.filter(isAnswer).map((e) => String(e.payload.reply_to)));
  return evs.filter((e) => isQuestion(e) && !answered.has(String(e.id)));
}

export function makeLessonQA(h) {
  const { db, addEvent, learn } = h;

  // 生徒が見られる教材なら { id, title }、見られなければ null
  async function lessonInfo(env, customer, email, lessonId) {
    if (!LESSON_ID_RE.test(String(lessonId || ""))) return null;
    const id = String(lessonId);
    if (!env.B_STORE) {
      const [l] = await db(env, "GET", `lessons?select=id,title&id=eq.${encodeURIComponent(id)}&published=eq.true`);
      return l ? { id: String(l.id), title: l.title || "" } : null;
    }
    let q = `mn_lessons?select=lesson_id,title&lesson_id=eq.${encodeURIComponent(id)}&limit=1`;
    if (!(await learn.isAdminEmail(env, email))) {
      const acc = await db(env, "GET", `mn_access?select=curriculum_id&member_id=eq.${customer.id}`);
      const cur = [...new Set(acc.map((a) => a.curriculum_id))];
      if (!cur.length) return null;
      q += `&curriculum_id=in.(${cur.map(encodeURIComponent).join(",")})`;
    }
    const [l] = await db(env, "GET", q);
    return l ? { id: String(l.lesson_id), title: l.title || "" } : null;
  }

  async function memoOf(env, customerId, lessonId) {
    const [m] = await db(env, "GET", `events?select=payload,occurred_at&customer_id=eq.${customerId}&type=eq.lesson_memo&payload->>lesson_id=eq.${encodeURIComponent(lessonId)}&order=id.desc&limit=1`);
    return m && m.payload && m.payload.text ? { text: m.payload.text, at: m.occurred_at } : null;
  }

  // 生徒の教材の下：自分の質問と答え・自分のメモ
  async function notes(env, customer, email, lessonId, roomEvents) {
    const lesson = await lessonInfo(env, customer, email, lessonId);
    if (!lesson) return { ok: false, error: "lesson_not_found" };
    return { ok: true, lesson, questions: lessonThreads(await roomEvents(env, customer.id), lesson.id), memo: await memoOf(env, customer.id, lesson.id) };
  }

  async function setMemo(env, customer, email, { lesson_id, text }) {
    const lesson = await lessonInfo(env, customer, email, lesson_id);
    if (!lesson) return { ok: false, error: "lesson_not_found" };
    const t = String(text ?? "").trim();
    if (t.length > MEMO_MAX) return { ok: false, error: "too_long", max: MEMO_MAX };
    const cur = await memoOf(env, customer.id, lesson.id);
    if ((cur ? cur.text : "") === t) return { ok: true, changed: false, memo: cur };
    await addEvent(env, customer.id, "lesson_memo", { lesson_id: lesson.id, text: t }, "site");
    return { ok: true, changed: true, memo: t ? { text: t } : null };
  }

  return { lessonInfo, notes, setMemo };
}

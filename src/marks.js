// 便 B2（2026-11-06 Naoki OK 19:05）：生徒の印（お気に入り・視聴済み・自分のラベル）
// 出来事 lesson_mark（lesson_id・star・done・labels）。教材ごとにいちばん新しいものが今の印（メモ lesson_memo と同じ持ち方）。
// 本人だけが見る。ラベルは全角半角・空白・大文字小文字だけ違うものを同じラベルにまとめる（スワイプくんと同じ決まり）。

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const LABEL_MAX = 30, LABELS_MAX = 20;
export const labelKey = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 新しい順の出来事から、教材ごとの今の印 { lesson_id: { star, done, labels } } */
export function latestMarks(events) {
  const out = {};
  for (const e of events || []) {
    const p = e && e.payload;
    if (!p || !p.lesson_id || out[p.lesson_id]) continue;
    out[p.lesson_id] = { star: !!p.star, done: !!p.done, labels: Array.isArray(p.labels) ? p.labels.map(String) : [] };
  }
  return out;
}

/** ラベルの名前をそろえる。have（今あるラベル）に同じものがあればその名前にする */
export function cleanLabels(list, have = []) {
  const byKey = new Map(have.map((l) => [labelKey(l), l]));
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = String(raw || "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
    const k = labelKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(byKey.get(k) || t);
    if (out.length >= LABELS_MAX) break;
  }
  return out;
}

export function makeMarks({ db, addEvent }) {
  async function all(env, customerId) {
    const ev = await db(env, "GET", `events?select=payload&customer_id=eq.${customerId}&type=eq.lesson_mark&order=id.desc&limit=5000`);
    return latestMarks(ev);
  }
  const haveLabels = (marks) => [...new Set(Object.values(marks).flatMap((m) => m.labels))];

  /** 1 本の印を直す。送られた欄だけ変える */
  async function set(env, customer, b = {}) {
    const lessonId = String(b.lesson_id || "");
    if (!ID_RE.test(lessonId)) return { ok: false, error: "bad_lesson" };
    const marks = await all(env, customer.id);
    const cur = marks[lessonId] || { star: false, done: false, labels: [] };
    const next = {
      star: "star" in b ? !!b.star : cur.star,
      done: "done" in b ? !!b.done : cur.done,
      labels: "labels" in b ? cleanLabels(b.labels, haveLabels(marks)) : cur.labels,
    };
    await addEvent(env, customer.id, "lesson_mark", { lesson_id: lessonId, ...next }, "site");
    return { ok: true, lesson_id: lessonId, mark: next };
  }

  /** ラベルの名前を変える・削除する（付いている教材すべて） */
  async function editLabel(env, customer, b = {}) {
    const from = labelKey(b.from);
    if (!from) return { ok: false, error: "bad_label" };
    const marks = await all(env, customer.id);
    let to = null;
    if (b.action === "rename") {
      to = cleanLabels([b.to])[0];
      if (!to) return { ok: false, error: "bad_label" };
    } else if (b.action !== "delete") return { ok: false, error: "bad_action" };
    let changed = 0;
    for (const [lessonId, m] of Object.entries(marks)) {
      if (!m.labels.some((l) => labelKey(l) === from)) continue;
      const labels = cleanLabels(m.labels.map((l) => (labelKey(l) === from ? to : l)).filter(Boolean));
      await addEvent(env, customer.id, "lesson_mark", { lesson_id: lessonId, star: m.star, done: m.done, labels }, "site");
      changed++;
    }
    return { ok: true, changed, to };
  }

  return { all, set, editLabel };
}

// B の便 9：Lab OS の「使い方」の画面の裏側。
// できることリストは、道具の一覧（src/index.js の TOOLS の screen・say）と権限の表（b_permissions）から毎回組み立てる。
// 手で書いた一覧を持たない（便のたびに古くなるため）。画面に出す言葉に、表の名前・道具の名前・英語の設定名を入れない。
// あわせて、承認待ちの中身を読める言葉に直すための引き当て（人の名前・一斉配信の件名と宛先）もここで行う。

// Lab OS の左のメニューにある画面（data-view）。"ai_only" は画面に無く、AI に頼むときだけ使うもの
export const SCREENS = ["home", "blueprint", "people", "forms", "deals", "refer", "deliver", "connect", "products", "rooms", "ai", "settings", "ai_only"];

// 画面に出す言い方として認めない字（英字の並び・下線）。道具の名前や英語の設定名が混ざるのを試験と画面の両方で弾く
const INNER_NAME = /[A-Za-z]+_[A-Za-z_]+|[a-z]{4,}/;
// ただし画面にそのまま出ている語（Google・Web など）は通す
const ALLOWED_WORDS = ["Google", "note", "Naoki", "Lab OS"];

export function sayProblem(t) {
  if (!t.say || !String(t.say).trim()) return "say_missing";
  if (!SCREENS.includes(t.screen)) return "screen_missing";
  let s = String(t.say);
  for (const w of ALLOWED_WORDS) s = s.split(w).join("");
  if (INNER_NAME.test(s)) return "say_has_inner_name";
  return null;
}

// 道具ごとの「画面での言い方」。承認待ちの見出しやスマホの知らせにも同じものを使う（言い方を 1 か所にする）
export function sayOf(tools, name) {
  const t = tools.find((x) => x.name === name);
  return (t && t.say) || "（説明がまだ無い操作）";
}

// できることリスト。返すのは画面ごとの行（name は画面の内部で承認の見出しと結ぶためだけに使い、表には出さない）
export function buildGuide(tools, permissions) {
  const modeOf = Object.fromEntries((permissions || []).map((p) => [p.tool, p.mode]));
  const rows = tools.map((t) => {
    const problem = sayProblem(t);
    return {
      name: t.name,
      screen: SCREENS.includes(t.screen) ? t.screen : "ai_only",
      say: problem ? "（説明がまだ無い操作）" : t.say,
      ai: modeOf[t.name] || "none", // auto＝AI に頼むとそのまま動く／approve＝承認が要る／deny・none＝AI には頼めない
      problem,
    };
  });
  const missing = rows.filter((r) => r.problem).length;
  return { ok: true, count: rows.length, missing, rows };
}

// 承認待ちの中身を、人の名前・一斉配信の件名と宛先に引き当てる（中の番号のままだと Naoki が決められないため）
export function makeExplain({ db }) {
  return async function explainApprovals(env, approvals) {
    if (!approvals || !approvals.length) return approvals;
    const ids = (k) => [...new Set(approvals.map((a) => (a.args || {})[k]).filter((v) => /^[0-9a-f-]{36}$/i.test(String(v || ""))))];
    const people = ids("person_id");
    const bcIds = [...new Set(approvals.filter((a) => ["queue_broadcast", "cancel_broadcast"].includes(a.tool)).map((a) => (a.args || {}).id).filter((v) => /^[0-9a-f-]{36}$/i.test(String(v || ""))))];
    const pmap = {}, bmap = {};
    try {
      if (people.length) for (const p of await db(env, "GET", `customers?select=id,name,email&id=in.(${people.join(",")})`)) pmap[p.id] = { name: p.name || "", email: p.email };
    } catch { /* 引けなくても承認の一覧は出す */ }
    try {
      if (bcIds.length) for (const b of await db(env, "GET", `b_broadcasts?select=id,subject,filter,status,target_count&id=in.(${bcIds.join(",")})`)) bmap[b.id] = { subject: b.subject, filter: b.filter || {}, status: b.status, target_count: b.target_count };
    } catch { /* 同上 */ }
    return approvals.map((a) => {
      const args = a.args || {};
      const ref = {};
      if (pmap[args.person_id]) ref.person = pmap[args.person_id];
      if (bmap[args.id]) ref.broadcast = bmap[args.id];
      return { ...a, ref };
    });
  };
}

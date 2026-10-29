// マーケくん便 6（2026-10-27）：顧客管理に、しあらぼの生徒をしあらぼ管理の呼び名で出す。
//  ・正本はしあらぼ管理の生徒の表（shr_students）。マーケくんは毎回読むだけで、名前を書き写さない
//  ・結び方はメール：生徒の連絡先（contact・自由な書き方）からメールを取り出し、顧客（member）のメールと突き合わせる
//  ・連絡先そのものは画面にも AI にも返さない。返すのは呼び名と、結べなかった人の呼び名だけ
//  ・生徒の行は呼び名を先に出す。マーケくんの中で入った名前は profile_name に残し、探す欄ではどちらでも出る（2026-10-27 22:51 Naoki「OK」）

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NAME_MAX = 60;

// 自由な書き方の連絡先から、メールを小文字で取り出す（同じものは 1 つに）
export function emailsIn(text) {
  return [...new Set((String(text ?? "").match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
}

// 生徒の行 → { byEmail: メール → 呼び名, students: [{ name, emails }] }。先に出た生徒が勝つ
export function indexStudents(rows) {
  const byEmail = new Map();
  const students = [];
  for (const r of rows || []) {
    const name = String(r.name ?? "").trim().slice(0, NAME_MAX);
    if (!name) continue;
    const emails = emailsIn(r.contact);
    students.push({ name, emails });
    for (const e of emails) if (!byEmail.has(e)) byEmail.set(e, name);
  }
  return { byEmail, students };
}

// 顧客の行に呼び名を当てる（行を直接書き換える）
export function applyNames(people, byEmail) {
  for (const p of people || []) {
    const n = byEmail.get(String(p.email || "").toLowerCase());
    if (!n) continue;
    p.profile_name = p.name || "";
    p.student_name = n;
    p.name = n;
  }
  return people;
}

export function makeStudents({ db }) {
  // 本番の置き場だけ（デモの置き場に生徒の表は無い）。読めなければ空で返し、一覧は今までどおり出す
  async function load(env) {
    try {
      const rows = await db(env, "GET", "shr_students?select=name,contact&archived=eq.false&or=(deleted.is.null,deleted.eq.false)&limit=1000");
      return indexStudents(rows);
    } catch (e) {
      console.error("[students] load failed:", e);
      return { ...indexStudents([]), error: "students_unreadable" };
    }
  }

  // 呼び名に query を含む生徒のメール（探す欄で使う）
  function emailsForQuery(idx, query) {
    const s = String(query ?? "").trim().toLowerCase();
    if (!s) return [];
    return [...new Set(idx.students.filter((x) => x.name.toLowerCase().includes(s)).flatMap((x) => x.emails))];
  }

  // 結べなかった生徒の呼び名（連絡先にメールが無い・顧客にいない）
  async function unmatched(env, idx) {
    const all = [...idx.byEmail.keys()];
    const have = new Set();
    for (let i = 0; i < all.length; i += 50) {
      const part = all.slice(i, i + 50);
      const rows = await db(env, "GET", `customers?select=email&email=in.(${part.map((e) => encodeURIComponent(e)).join(",")})&limit=1000`);
      for (const r of rows) have.add(String(r.email || "").toLowerCase());
    }
    return idx.students
      .filter((x) => !x.emails.some((e) => have.has(e)))
      .map((x) => ({ name: x.name, why: x.emails.length ? "マーケくんに同じメールの人がいない" : "連絡先にメールが無い" }));
  }

  return { load, emailsForQuery, unmatched };
}

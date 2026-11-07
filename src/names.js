// チャットの便 C2b-2（2026-11-07 Naoki OK 13:14）：名前の 3 種類。
//  ・本名     … しあらぼ管理の呼び名（無ければ登録した名前）。マーケくんでは書き換えない
//  ・ニックネーム … 項目 nickname（b_fields と b_person_values の 1 行。表は増やさない）。生徒がグループで初めて送るときに決める。シアニンも直せる
//  ・LINE 名   … 結ばれた LINE の表示名（src/line.js の personLinks が読む）。書き換えない
//  ・グループでは、ほかの生徒にはニックネームだけを出す（無い人は「メンバー」）。本名は出さない
export const NICK_KEY = "nickname";
export const NICK_MAX = 20;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function nickOk(v) {
  const n = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.length > NICK_MAX || /[<>]/.test(n) || /@/.test(n)) return null;
  return n;
}

export function makeNames({ db }) {
  async function ensureField(env) {
    const [f] = await db(env, "GET", `b_fields?select=key&key=eq.${NICK_KEY}`);
    if (!f) await db(env, "POST", "b_fields", [{ key: NICK_KEY, label: "ニックネーム", type: "text", options: [], sort: 0, updated_by: "system" }], "return=minimal");
  }
  // 番号の並び → 番号 → ニックネーム（無い人は入らない）
  async function nicknames(env, ids) {
    const u = [...new Set((ids || []).filter((x) => UUID_RE.test(String(x))))];
    if (!u.length) return {};
    try {
      const rows = await db(env, "GET", `b_person_values?select=customer_id,value&key=eq.${NICK_KEY}&customer_id=in.(${u.join(",")})`);
      return Object.fromEntries(rows.filter((r) => r.value).map((r) => [r.customer_id, r.value]));
    } catch (_) { return {}; }
  }
  async function nickname(env, id) { return (await nicknames(env, [id]))[id] || ""; }
  // 決める・直す（空なら消す）
  async function setNickname(env, id, value) {
    if (!UUID_RE.test(String(id || ""))) return { ok: false, error: "bad_person_id" };
    const n = nickOk(value);
    if (n === null) return { ok: false, error: "bad_nickname", max: NICK_MAX, note: "20 字まで・メールや < > は使えない" };
    await ensureField(env);
    if (!n) { await db(env, "DELETE", `b_person_values?customer_id=eq.${id}&key=eq.${NICK_KEY}`, undefined, "return=minimal"); return { ok: true, nickname: "" }; }
    await db(env, "POST", "b_person_values?on_conflict=customer_id,key", [{ customer_id: id, key: NICK_KEY, value: n, updated_at: new Date().toISOString() }], "resolution=merge-duplicates,return=minimal");
    return { ok: true, nickname: n };
  }
  return { nicknames, nickname, setNickname };
}

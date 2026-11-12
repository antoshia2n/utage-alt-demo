// X攻略くんの知らせのメール。走らせ方：node --test tests/xkmail.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, buildMail, makeXkMail } from "../src/xkmail.js";

const jst = (s) => Date.parse(s.replace(" ", "T") + ":00Z") - 9 * 3600e3;
const snap = { wk: "11月2週", rate: 72, rows: [{ t: "セルフ引用", plan: 28, done: 9 }], next: "8レビュー：今週の分析", sos: "【X攻略くんから相談】\n状況：x", vids: [{ t: "全体像", u: "https://x.test/v" }], rev: ["今週の分析"], cm: [], at: new Date(jst("2026-11-15 10:00")).toISOString() };

test("送る時刻は日曜 20 時台と月曜 7 時台だけ", () => {
  assert.equal(slotOf(jst("2026-11-15 20:07")), "week");
  assert.equal(slotOf(jst("2026-11-16 07:07")), "mon");
  assert.equal(slotOf(jst("2026-11-15 19:07")), null);
  assert.equal(slotOf(jst("2026-11-16 20:07")), null);
});
test("週のまとめに実行率・打ち手・相談文・動画・開く住所が入る", () => {
  const m = buildMail("week", snap, jst("2026-11-15 20:07"));
  assert.match(m.subject, /11月2週のまとめ/);
  for (const w of ["72%", "セルフ引用：9 / 28", "【X攻略くんから相談】", "https://x.test/v", "x-koryaku.shia2n.jp"]) assert.ok(m.text.includes(w), w);
  assert.ok(!m.text.includes("開いたときの状態"));
});
test("月曜はコミットが無ければ決める案内、古い下書きは日付を添える", () => {
  const m = buildMail("mon", snap, jst("2026-11-23 07:07"));
  assert.match(m.text, /まだ決めていません/); assert.match(m.text, /11\/15 に開いたときの状態/);
});
test("宛先は member から引き、下書きの無い人と宛先の無い人には送らない", async () => {
  const sent = [], logs = [];
  const rows = { xa: [{ user_id: "u1", ladder: { mail: snap } }, { user_id: "u2", ladder: {} }, { user_id: "u3", ladder: { mail: snap } }] };
  const rawDb = async (env, m, q) => q.startsWith("xa_settings") ? rows.xa : q.includes("u1") ? [{ email: "a@x.test" }] : [];
  const x = makeXkMail({ rawDb, logInbound: async (...a) => logs.push(a), send: async (env, msg) => { sent.push(msg); return { ok: true }; } });
  const r = await x.run({}, { now: jst("2026-11-15 20:07") });
  assert.deepEqual([r.sent, r.no_snap, r.no_mail], [1, 1, 1]); assert.equal(sent[0].to, "a@x.test"); assert.equal(logs.length, 1);
  assert.deepEqual(await x.run({}, { now: jst("2026-11-15 12:07") }), { skipped: true });
});

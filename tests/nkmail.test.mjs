// note攻略くんの知らせのメール。走らせ方：node --test tests/nkmail.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, buildMail, makeNkMail } from "../src/nkmail.js";

const jst = (s) => Date.parse(s.replace(" ", "T") + ":00Z") - 9 * 3600e3;
const snap = { mo: "11月", pmo: "10月", rate: 50, prate: 72, rows: [{ t: "メンシプ記事", plan: 4, done: 2 }], prows: [{ t: "入口の記事", plan: 4, done: 3 }], next: "②分析：10月の各人の点数", sos: "【note攻略くんから相談】\n止まっているところ：x", vids: [{ t: "全体像", u: "https://x.test/v" }], rev: ["今月の分析"], cm: ["メンシプ記事 4 本"], at: new Date(jst("2026-11-29 10:00")).toISOString() };

test("送る時刻は毎月 2 日と月末の 20 時台だけ", () => {
  assert.equal(slotOf(jst("2026-12-02 20:07")), "start");
  assert.equal(slotOf(jst("2026-11-30 20:07")), "end");
  assert.equal(slotOf(jst("2027-02-28 20:07")), "end");
  assert.equal(slotOf(jst("2026-12-02 19:07")), null);
  assert.equal(slotOf(jst("2026-11-29 20:07")), null);
});
test("2 日は先月の実行率・打ち手・残り・コミット・相談文・動画・開く住所", () => {
  const m = buildMail("start", snap, jst("2026-12-02 20:07"));
  assert.match(m.subject, /10月の数字が入りました/);
  for (const w of ["72%", "入口の記事：3 / 4", "今月の分析", "メンシプ記事 4 本", "【note攻略くんから相談】", "https://x.test/v", "note-koryaku.shia2n.jp"]) assert.ok(m.text.includes(w), w);
  assert.match(m.text, /11\/29 に開いたときの状態/);
});
test("月末は今月の実行率と記録の残り", () => {
  const m = buildMail("end", snap, jst("2026-11-30 20:07"));
  assert.match(m.subject, /11月のまとめ/);
  for (const w of ["50%", "メンシプ記事：2 / 4", "有料記事の売れた数"]) assert.ok(m.text.includes(w), w);
  assert.ok(!m.text.includes("開いたときの状態"));
});
test("宛先は member から引き、下書きの無い人と宛先の無い人には送らない", async () => {
  const sent = [], logs = [];
  const rows = [{ user_id: "u1", ladder: { mail: snap } }, { user_id: "u2", ladder: {} }, { user_id: "u3", ladder: { mail: snap } }];
  const rawDb = async (env, m, q) => q.startsWith("na_settings") ? rows : q.includes("u1") ? [{ email: "a@x.test" }] : [];
  const x = makeNkMail({ rawDb, logInbound: async (...a) => logs.push(a), send: async (env, msg) => { sent.push(msg); return { ok: true }; } });
  const r = await x.run({}, { now: jst("2026-11-30 20:07") });
  assert.deepEqual([r.sent, r.no_snap, r.no_mail], [1, 1, 1]);
  assert.equal(sent[0].to, "a@x.test");
  assert.equal(logs[0][1], "nk_mail");
  assert.deepEqual(await x.run({}, { now: jst("2026-11-29 20:07") }), { skipped: true });
});

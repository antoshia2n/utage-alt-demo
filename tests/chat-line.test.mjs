// チャットの便 C2a-2：チャットの人と LINE の友だちを手で結ぶ・外す（src/line.js の linkMaps・linkManual・personLinks）
// 走らせ方：node --test tests/chat-line.test.mjs（見本 https://claude.ai/artifact/K13LWaLKTHvgWFkF8vJesV・Naoki OK 12:29）
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeLine, linkMaps } from "../src/line.js";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const U1 = "U" + "1".repeat(32), U2 = "U" + "2".repeat(32);
function setup() {
  const s = fakeStore();
  s.table("customers").push({ id: A }, { id: B });
  s.table("customer_summary").push({ id: A, name: "佐藤", email: "a@x" }, { id: B, name: "森", email: "b@x" });
  s.table("settings").push({ key: "line_forward_shianin", value: "https://utage-system.com/x" }, { key: "line_forward_college_ops", value: "https://utage-system.com/y" });
  let n = 0;
  const addEvent = async (env, cid, type, payload, actor) => { const e = { id: ++n, customer_id: cid, type, payload, actor }; s.table("events").push(e); return e; };
  const line = makeLine({ db: s.db, logInbound: async () => {}, changes: null, addEvent, registerPerson: async () => ({}), audience: async () => ({ people: [] }), fetch: async () => { throw new Error("no net"); } });
  return { s, line };
}

test("結びの読み方：結び直すと前の人・前の番号は外れる。外す印で外れる", () => {
  const ev = (id, cid, type, user) => ({ id, customer_id: cid, type, payload: { account: "shianin", user } });
  let m = linkMaps([ev(1, A, "line_linked", U1), ev(2, B, "line_linked", U1)]);
  assert.equal(m.byUser.get(U1), B);
  assert.equal(m.byPerson.has(A), false); // A は外れる（前は A にも残っていた）
  m = linkMaps([ev(1, A, "line_linked", U1), ev(2, A, "line_linked", U2)]);
  assert.equal(m.byUser.has(U1), false);
  assert.equal(m.byPerson.get(A), U2);
  m = linkMaps([ev(1, A, "line_linked", U1), ev(2, A, "line_unlinked", U1)]);
  assert.equal(m.byUser.size + m.byPerson.size, 0);
});

test("手で結ぶ：ほかの人に結ばれた番号は断る。知らないアカウントは断る。外せる。personLinks に出る", async () => {
  const { line } = setup();
  assert.equal((await line.linkManual({}, { person_id: A, account: "nope", user: U1 }, "n@x")).error, "bad_account");
  assert.equal((await line.linkManual({}, { person_id: A, account: "shianin", user: "bad" }, "n@x")).error, "bad_user");
  assert.ok((await line.linkManual({}, { person_id: A, account: "shianin", user: U1 }, "n@x")).linked);
  assert.equal((await line.linkManual({}, { person_id: A, account: "shianin", user: U1 }, "n@x")).already, true);
  const r = await line.linkManual({}, { person_id: B, account: "shianin", user: U1 }, "n@x");
  assert.equal(r.error, "linked_to_other");
  assert.equal(r.other.name, "佐藤");
  let pl = await line.personLinks({}, A);
  assert.deepEqual(pl.links, [{ account: "shianin", user: U1, name: "" }]); // 鍵が無いので LINE 名は空
  assert.deepEqual(pl.accounts, ["college_ops", "shianin"]);
  assert.ok((await line.linkManual({}, { person_id: A, account: "shianin", unlink: true }, "n@x")).unlinked);
  pl = await line.personLinks({}, A);
  assert.deepEqual(pl.links, []);
  assert.ok((await line.linkManual({}, { person_id: B, account: "shianin", user: U1 }, "n@x")).linked); // 外したので B に結べる
});

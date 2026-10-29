// マイページ（src/mypage.js）：印に中身を入れる・次にやること・生徒ごとの中身・公開の住所では出さない・ページの一覧に混ぜない
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMypage, fillMarks, pickNext, marksIn, partsHtml, STARTER_HTML, MARKS } from "../src/mypage.js";
import { makePages } from "../src/pages.js";
import { makeLearn } from "../src/learn.js";
import { fakeStore } from "./fake-store.mjs";

const PID = "11111111-2222-4333-8444-555555555555";
function setup() {
  const st = fakeStore();
  const env = { B_STORE: true };
  const pages = makePages({ db: st.db, addEvent: async () => {}, logInbound: async () => {}, forms: {}, sell: null });
  const learn = makeLearn({ db: st.db });
  const names = async () => ({ byEmail: new Map([["a@example.com", "あおい"]]) });
  const mp = makeMypage({ db: st.db, pages, learn, names });
  st.table("admins");
  st.table("b_page_requests");
  const base = { curriculum_id: "p1", program_id: "p1", program_title: "P1", course_id: "c1", course_title: "C1", summary: "" };
  st.table("mn_lessons").push({ ...base, lesson_id: "t1", sort: 0, title: "一本目", status: "published" }, { ...base, lesson_id: "t2", sort: 1, title: "二本目", status: "published" }, { ...base, lesson_id: "t3", sort: 2, title: "三本目", status: "published" });
  st.table("mn_access").push({ member_id: PID, curriculum_id: "p1", opened_at: "2026-09-01T00:00:00Z" });
  st.table("member_entitlement").push({ member_id: PID, key: "shiarabo_basic", expires_at: null }, { member_id: PID, key: "shiarabo_pilot", expires_at: "2000-01-01T00:00:00Z" });
  st.table("member_access").push({ entitlement_key: "shiarabo_basic", target: "mindmap" }, { entitlement_key: "shiarabo_pilot", target: "x-koryaku" });
  st.table("announcements").push({ id: 1, title: "11 月のセミナー", body: "日程が決まりました", published_at: "2026-10-28T00:00:00Z" });
  return { st, env, mp, pages };
}

test("印：中身だけを置き換え、ほかの部分と属性は残す・注意書きの中は数えない", () => {
  const h = `<p class="x" data-lab-part="mypage:name">ここ</p><div data-lab-part='mypage:apps'><i>仮</i></div><!-- data-lab-part="mypage:news" -->`;
  const out = fillMarks(h, { name: "あおい", apps: "<b>札</b>" });
  assert.equal(out, `<p class="x" data-lab-part="mypage:name">あおい</p><div data-lab-part='mypage:apps'><b>札</b></div><!-- data-lab-part="mypage:news" -->`);
  assert.deepEqual(marksIn(h), ["name", "apps"]);
  assert.deepEqual(marksIn(STARTER_HTML), MARKS);
});

test("次にやること：最後に開いたものの次・まだ何も見ていなければ最初・全部見たら null", () => {
  const programs = [{ title: "P", courses: [{ title: "C", lessons: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] }] }];
  assert.equal(pickNext(programs, []).item.l.id, "a");
  assert.equal(pickNext(programs, []).started, false);
  assert.equal(pickNext(programs, ["a"]).item.l.id, "b");
  assert.equal(pickNext(programs, ["b", "a"]).item.l.id, "c");
  assert.equal(pickNext(programs, ["c"]).item.l.id, "a");
  const all = pickNext(programs, ["c", "b", "a"]);
  assert.equal(all.item, null);
  assert.equal(all.done, true);
});

test("中身の断片は文字を逃がす（題名に < があっても HTML にならない）", () => {
  const p = partsHtml({ name: "<x>", next: { item: { l: { id: "t1", title: "<b>" }, p: { title: "P" }, c: { title: "C" } }, started: true }, apps: [], news: null });
  assert.equal(p.name, "&lt;x&gt;");
  assert.match(p.next, /&lt;b&gt;/);
  assert.match(p.next, /href="\/app#lesson\/t1" target="_top"/);
});

test("作成画面：無ければひな形で作る（公開はしない）・保存すると版が増える・公開すると生徒に出る", async () => {
  const { st, env, mp } = setup();
  const g = await mp.adminGet(env, {}, "admin:x");
  assert.equal(g.ok, true);
  assert.equal(g.version, 1);
  assert.equal(g.page.status, "draft");
  assert.equal(st.table("b_pages")[0].purpose, "mypage");
  const cust = { id: PID, name: "台帳の名前" };
  assert.equal((await mp.forStudent(env, cust, "a@example.com")).html, null);
  const s = await mp.save(env, { html: `<html><body><h1 data-lab-part="mypage:name"></h1><div data-lab-part="mypage:next"></div><div data-lab-part="mypage:apps"></div><div data-lab-part="mypage:news"></div></body></html>`, note: "直した" }, "admin:x");
  assert.equal(s.version, 2);
  assert.deepEqual(s.marks, MARKS);
  assert.equal((await mp.publish(env, { version: 2 }, "admin:x")).status, "published");
  st.table("events").push({ customer_id: PID, type: "lesson_viewed", payload: { lesson_id: "t1" }, occurred_at: "2026-10-28T00:00:00Z" });
  const r = await mp.forStudent(env, cust, "a@example.com");
  assert.match(r.html, /<h1 data-lab-part="mypage:name">あおい<\/h1>/);
  assert.match(r.html, /二本目/);
  assert.match(r.html, /思考整理くん/);
  assert.doesNotMatch(r.html, /X攻略くん/); // 期限切れの権利で開くアプリは出さない
  assert.match(r.html, /11 月のセミナー/);
  assert.match(r.html, /labMypageHeight/);
});

test("マイページは公開の住所で出さず、ページの一覧と設計図にも混ぜない・デモの置き場では作らない", async () => {
  const { env, mp, pages } = setup();
  await mp.adminGet(env, {}, "admin:x");
  await mp.publish(env, { version: 1 }, "admin:x");
  assert.equal(await pages.serve(env, "mypage-shiarabo"), null);
  assert.equal((await pages.listPages(env)).count, 0);
  assert.equal((await pages.forPlan(env)).pages.length, 0);
  assert.equal((await mp.adminGet({}, {}, "x")).error, "demo_store");
  assert.equal((await mp.forStudent({}, { id: PID }, "a@example.com")).html, null);
});

// 会員サイトの管理（src/site.js）と、生徒の側の公開のしかた（src/learn.js の入会から日数で開く）
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSite, checkContent, dripOpen } from "../src/site.js";
import { makeLearn } from "../src/learn.js";
import { fakeStore } from "./fake-store.mjs";

const env = { B_STORE: true };
function setup() {
  const st = fakeStore();
  st.table("b_site_sites").push({ id: "shiarabo", name: "しあらぼ", active: true, sort: 0 });
  st.table("b_site_programs").push({ id: "p1", site_id: "shiarabo", title: "P1", active: true, sort: 0 });
  st.table("b_site_courses").push({ id: "c1", program_id: "p1", title: "2026年", active: true, sort: 0 }, { id: "c2", program_id: "p1", title: "2025年", active: true, sort: 1 });
  st.table("b_site_contents").push({ id: "t1", title: "A", status: "published", active: true }, { id: "t2", title: "B", status: "published", active: true });
  st.table("b_site_content_courses").push({ content_id: "t1", course_id: "c1", sort: 0 }, { content_id: "t2", course_id: "c1", sort: 1 });
  return { st, site: makeSite({ db: st.db }) };
}

test("コンテンツの確かめ：題名が要る・日時を決めて公開は日時が要る・日数は 0 以上の整数・動画は YouTube だけ・目次の時刻の形", () => {
  assert.equal(checkContent({ title: " " }).error, "title_required");
  assert.equal(checkContent({ title: "x", status: "scheduled" }).error, "publish_at_required");
  assert.equal(checkContent({ title: "x", status: "drip", drip_days: -1 }).error, "bad_drip_days");
  assert.equal(checkContent({ title: "x", video_url: "https://vimeo.com/1" }).error, "bad_video_url");
  assert.equal(checkContent({ title: "x", toc: [{ at: "12分", label: "本題" }] }).error, "bad_toc_time");
  assert.equal(checkContent({ title: "x", files: [{ label: "資料", url: "javascript:alert(1)" }] }).error, "bad_file_url");
  const ok = checkContent({ title: "x", status: "drip", drip_days: 7, minutes: "90", toc: [{ at: "0:00", label: "はじめに" }, { at: "", label: "" }], can_ask: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.drip_days, 7);
  assert.equal(ok.row.minutes, 90);
  assert.deepEqual(ok.row.toc, [{ at: "0:00", label: "はじめに" }]);
  assert.equal(ok.row.can_ask, false);
  assert.equal(ok.row.publish_at, null);
  assert.equal(checkContent({ title: "x", status: "なにか" }).row.status, "draft");
});

test("入会から日数で開く：開けるようになった日＋日数を過ぎたら見える。ほかの公開のしかたはそのまま通す", () => {
  const at = Date.parse("2026-10-29T00:00:00Z");
  assert.equal(dripOpen({ status: "drip", drip_days: 7 }, "2026-10-20T00:00:00Z", at), true);
  assert.equal(dripOpen({ status: "drip", drip_days: 7 }, "2026-10-25T00:00:00Z", at), false);
  assert.equal(dripOpen({ status: "drip", drip_days: 0 }, null, at), false);
  assert.equal(dripOpen({ status: "published" }, null, at), true);
});

test("作る：所属するコースが要り、入ったコースでは末尾に並ぶ", async () => {
  const { st, site } = setup();
  assert.equal((await site.saveContent(env, { title: "新しい" })).error, "course_required");
  const r = await site.saveContent(env, { title: "新しい", status: "draft", courses: ["c1", "c2"] }, "admin:x");
  assert.equal(r.ok, true);
  const links = st.table("b_site_content_courses").filter((l) => l.content_id === r.id);
  assert.deepEqual(links.map((l) => [l.course_id, l.sort]).sort(), [["c1", 2], ["c2", 0]]);
  assert.equal(st.table("b_site_contents").find((x) => x.id === r.id).status, "draft");
});

test("直す：所属を減らすとそのコースから外れるだけ（中身は残る）・空にはできない", async () => {
  const { st, site } = setup();
  assert.equal((await site.saveContent(env, { id: "t1", title: "A", status: "published", courses: [] })).error, "course_required");
  const r = await site.saveContent(env, { id: "t1", title: "A2", status: "published", courses: ["c2"] }, "admin:x");
  assert.equal(r.ok, true);
  assert.deepEqual(st.table("b_site_content_courses").filter((l) => l.content_id === "t1").map((l) => l.course_id), ["c2"]);
  assert.equal(st.table("b_site_contents").find((x) => x.id === "t1").title, "A2");
});

test("コースの並び：渡した並びにそろう・並びに無いものは外れる", async () => {
  const { st, site } = setup();
  assert.equal((await site.setCourseContents(env, { course_id: "c1", content_ids: ["t2", "t1"] })).ok, true);
  const order = st.table("b_site_content_courses").filter((l) => l.course_id === "c1").sort((a, b) => a.sort - b.sort).map((l) => l.content_id);
  assert.deepEqual(order, ["t2", "t1"]);
  await site.setCourseContents(env, { course_id: "c1", content_ids: ["t2"] });
  assert.deepEqual(st.table("b_site_content_courses").filter((l) => l.course_id === "c1").map((l) => l.content_id), ["t2"]);
  assert.equal(st.table("b_site_contents").length, 2);
});

test("コースの並べ替え：プログラムのコースが全部そろっていないと受けない", async () => {
  const { st, site } = setup();
  assert.equal((await site.orderCourses(env, { program_id: "p1", course_ids: ["c2"] })).error, "list_mismatch");
  assert.equal((await site.orderCourses(env, { program_id: "p1", course_ids: ["c2", "c1"] })).ok, true);
  assert.equal(st.table("b_site_courses").find((c) => c.id === "c2").sort, 0);
});

test("カリキュラム：作ると下書き・プログラムの並びと権利をそのまま入れ替える", async () => {
  const { st, site } = setup();
  const r = await site.saveCurriculum(env, { site_id: "shiarabo", title: "新しい", programs: ["p1"], rights: ["shiarabo_basic"] }, "admin:x");
  assert.equal(r.ok, true);
  assert.equal(st.table("b_site_curricula").find((k) => k.id === r.id).active, false);
  assert.deepEqual(st.table("b_site_curriculum_rights").map((x) => x.entitlement_key), ["shiarabo_basic"]);
  await site.saveCurriculum(env, { id: r.id, title: "新しい", active: true, rights: [] }, "admin:x");
  assert.equal(st.table("b_site_curriculum_rights").length, 0);
  assert.equal(st.table("b_site_curriculum_programs").length, 1);
  assert.equal((await site.saveCurriculum(env, { id: r.id, title: "x", rights: ["Bad Key"] })).error, "bad_key");
});

test("まとめて公開・下書き：2 つだけ受ける・デモの置き場では読む書くとも止める", async () => {
  const { st, site } = setup();
  assert.equal((await site.setStatus(env, { ids: ["t1", "t2"], status: "draft" })).count, 2);
  assert.ok(st.table("b_site_contents").every((x) => x.status === "draft"));
  assert.equal((await site.setStatus(env, { ids: ["t1"], status: "drip" })).error, "bad_status");
  assert.equal((await site.tree({})).error, "demo_store");
  assert.equal((await site.saveContent({}, { title: "x", courses: ["c1"] })).error, "demo_store");
});

test("生徒の側：入会から日数で開くものは、日数がたつまで出ない。目次・資料・見る時間・質問の可否が届く", async () => {
  const st = fakeStore();
  const PID = "11111111-2222-4333-8444-555555555555";
  st.table("admins");
  st.table("mn_access").push({ member_id: PID, curriculum_id: "p1", opened_at: new Date(Date.now() - 3 * 864e5).toISOString() });
  const base = { curriculum_id: "p1", program_id: "p1", program_title: "P1", course_id: "c1", course_title: "C1", summary: "", youtube_id: null, mindmap_url: null };
  st.table("mn_lessons").push(
    { ...base, lesson_id: "t1", sort: 0, title: "すぐ", status: "published", minutes: 90, toc: [{ at: "0:00", label: "はじめに" }], files: [{ label: "資料", url: "https://example.com/a" }], can_ask: false },
    { ...base, lesson_id: "t2", sort: 1, title: "2 日後", status: "drip", drip_days: 2 },
    { ...base, lesson_id: "t3", sort: 2, title: "7 日後", status: "drip", drip_days: 7 });
  const learn = makeLearn({ db: st.db });
  const r = await learn.lessonsFor({ B_STORE: true }, { id: PID }, "a@example.com");
  const ls = r.programs[0].courses[0].lessons;
  assert.deepEqual(ls.map((l) => l.title), ["すぐ", "2 日後"]);
  assert.equal(ls[0].minutes, 90);
  assert.deepEqual(ls[0].toc, [{ at: "0:00", label: "はじめに" }]);
  assert.deepEqual(ls[0].files, [{ label: "資料", url: "https://example.com/a" }]);
  assert.equal(ls[0].can_ask, false);
  assert.equal(ls[1].can_ask, true);
});

test("動画の住所からまとめて作る：題名は oEmbed から・読めなければ仮の題名・下書きで末尾に並ぶ", async () => {
  const { st, site } = setup();
  const fetcher = async (u) => (u.includes("aaaaaaaaaaa") ? { ok: true, json: async () => ({ title: "動画の題名" }) } : { ok: false });
  assert.equal((await site.fromVideos(env, { course_id: "c1", urls: ["https://vimeo.com/1"] }, "x", fetcher)).error, "bad_urls");
  const r = await site.fromVideos(env, { course_id: "c1", urls: ["https://youtu.be/aaaaaaaaaaa", "https://www.youtube.com/watch?v=bbbbbbbbbbb"] }, "x", fetcher);
  assert.equal(r.count, 2);
  const made = st.table("b_site_contents").filter((x) => r.ids.includes(x.id));
  assert.deepEqual(made.map((x) => [x.title, x.status]), [["動画の題名", "draft"], ["新しいコンテンツ 2", "draft"]]);
  assert.deepEqual(st.table("b_site_content_courses").filter((l) => r.ids.includes(l.content_id)).map((l) => l.sort), [2, 3]);
});

// 出し先のスイッチ（2026-11-12）：会員サイトへ入れる処理（routeRun）
import test from "node:test";
import assert from "node:assert/strict";
import { recordings } from "../src/recordings.js";

const COURSE = "11111111-2222-3333-4444-555555555555";
const tree = (contents = [], links = []) => ({
  sites: [{ id: "s1", name: "会員サイト" }],
  programs: [{ id: "p1", site_id: "s1", title: "しあらぼ", sort: 0 }],
  curricula: [], cprog: [], rights: [],
  courses: [{ id: COURSE, program_id: "p1", title: "セミナー録画", sort: 0 }],
  contents, links,
});
const row = (id, route, extra = {}) => ({ id, title: `2026-11-12｜セミナー｜${id}`, kai: "セミナー", youtube_url: null, route: { youtube: false, site: true, youtube_possible: true, auto: true, course_id: null, done_at: null, content_id: null, ...route }, ...extra });

function setup(rows, { courses = { "セミナー": COURSE }, t = tree() } = {}) {
  const done = [], saved = [], mails = [];
  const env = {
    PUBLIC_ORIGIN: "https://lab.shia2n.jp",
    ZOOM: {
      shelf: async () => ({ ok: true, rows }),
      route_config: async () => ({ ok: true, courses }),
      route_done: async (id, cid) => { done.push([id, cid]); return { ok: true }; },
      member_info: async (id) => ({ ok: true, id, title: "録画 " + id, summary: "要約", toc: [], minutes: 60 }),
    },
  };
  const site = { tree: async () => t, saveContent: async (_e, b) => { saved.push(b); return { ok: true, id: "c-" + b.rec_id }; } };
  const notify = async (_e, m) => { mails.push(m); return { sent: 1 }; };
  return { env, site, notify, done, saved, mails };
}

test("会員サイトがオン・YouTube がオフ：R2 のまま下書きで入れて知らせる", async () => {
  const s = setup([row("a", {})]);
  const r = await recordings.routeRun(s.env, s.site, s.notify);
  assert.equal(r.put, 1);
  assert.equal(s.saved[0].status, "draft");
  assert.equal(s.saved[0].video_url, undefined);
  assert.deepEqual(s.saved[0].courses, [COURSE]);
  assert.deepEqual(s.done, [["a", "c-a"]]);
  assert.match(s.mails[0].text, /録画の棚（R2）から流す/);
  assert.match(s.mails[0].text, /admin#recording\/a/);
});

test("YouTube もオン：上がるまで待ち、上がったら YouTube の住所を付けて入れる", async () => {
  const wait = setup([row("b", { youtube: true })]);
  const r1 = await recordings.routeRun(wait.env, wait.site, wait.notify);
  assert.equal(r1.waiting_youtube, 1);
  assert.equal(wait.saved.length, 0);
  assert.equal(wait.done.length, 0);

  const up = setup([row("b", { youtube: true }, { youtube_url: "https://www.youtube.com/watch?v=abcdefghijk" })]);
  const r2 = await recordings.routeRun(up.env, up.site, up.notify);
  assert.equal(r2.put, 1);
  assert.equal(up.saved[0].video_url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.match(up.mails[0].text, /YouTube（限定公開）を埋め込み/);
});

test("会員サイトがオフ・入れ終えた録画・入れ先が無い録画は入れない", async () => {
  const s = setup([row("c", { site: false }), row("d", { done_at: "2026-11-12T00:00:00Z" }), row("e", {}, { kai: "打ち合わせ" })]);
  const r = await recordings.routeRun(s.env, s.site, s.notify);
  assert.equal(r.put, 0);
  assert.equal(r.no_course, 1);
  assert.equal(s.mails.length, 0);
});

test("すでに同じコースに入っている録画は入れ直さず、印だけ付ける", async () => {
  const s = setup([row("f", {})], { t: tree([{ id: "c-old", rec_id: "f", active: true }], [{ content_id: "c-old", course_id: COURSE }]) });
  const r = await recordings.routeRun(s.env, s.site, s.notify);
  assert.equal(r.already, 1);
  assert.equal(s.saved.length, 0);
  assert.deepEqual(s.done, [["f", "c-old"]]);
});

test("録画ごとに指定したコースが、会の種類の決まりより先", async () => {
  const s = setup([row("g", { course_id: COURSE }, { kai: "打ち合わせ" })], { courses: {} });
  const r = await recordings.routeRun(s.env, s.site, s.notify);
  assert.equal(r.put, 1);
});

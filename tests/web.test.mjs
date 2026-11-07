// 便 S1・S2（2026-11-07）：公開サイトの見た目と部品の試験
// 走らせ方：node --test tests/web.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeWeb, bucketOf, normLook, lookCss, normRule, pickRule } from "../src/web.js";
import { parseParts, EMBED_JS } from "../src/pages.js";
import { DEFAULT_MODES } from "../src/guard.js";

function setup({ lanes = {} } = {}) {
  const s = fakeStore();
  s.table("settings");
  s.table("b_forms").push({ slug: "zukai-seminar-2611", title: "図解セミナー 申込", active: true, created_at: "2026-10-09" }, { slug: "old-form", title: "閉じた", active: false, created_at: "2026-10-01" });
  const web = makeWeb({
    db: s.db, logInbound: async () => {},
    readPersonToken: async (env, u) => (u && u.startsWith("tok-") ? u.slice(4) : null),
    laneOf: async (env, cid) => lanes[cid] ?? null,
  });
  return { s, web, env: {} };
}
const RULES = {
  new: { title: "シートを無料で", text: "メールで届きます", form: "zukai-seminar-2611" },
  list: { title: "次は図解セミナーへ", btn: "日程を見る", href: "https://lp.shia2n.jp/zukai-seminar-2611" },
  member: { title: "会員サイトの続き", href: "https://lab.shia2n.jp/app" },
  _default: { title: "ほかの記事も読む", href: "https://lp.shia2n.jp/blog" },
};
const VID = "abcdefgh1234";

test("段階の 4 つ：台帳にいない人は new、レーンから list・consult・member", () => {
  assert.equal(bucketOf(null), "new");
  assert.equal(bucketOf("signup"), "list"); assert.equal(bucketOf("warm"), "list");
  assert.equal(bucketOf("consult"), "consult"); assert.equal(bucketOf("buy"), "consult");
  assert.equal(bucketOf("learn"), "member"); assert.equal(bucketOf("refer"), "member");
});

test("見た目：知らない値は既定に戻し、テーマを替えると色もそのテーマに戻る。CSS に変数と装飾が入る", async () => {
  assert.deepEqual(normLook("{bad"), { theme: "simple", c: "#1c1917", c2: "#f59e0b", width: 720 });
  const { web, env, s } = setup();
  assert.equal((await web.setLook(env, { c: "#123456" }, "a")).look.c, "#123456");
  const r = await web.setLook(env, { theme: "note" }, "a");
  assert.equal(r.look.theme, "note"); assert.equal(r.look.c, "#292524"); assert.equal(r.look.c2, "#16a34a");
  assert.equal((await web.setLook(env, { width: 999 }, "a")).error, "bad_width");
  assert.equal((await web.setLook(env, { c: "red" }, "a")).error, "bad_color");
  assert.equal(s.t.settings.length, 1, "表 b_settings の 1 行だけ");
  const css = await web.css(env);
  assert.match(css, /--lab-c:#292524/); assert.match(css, /\.lab-toc/); assert.match(css, /\.lab-fuki/); assert.match(css, /\.lab-part/);
  assert.match(lookCss({ theme: "magazine" }), /border-bottom:3px solid var\(--lab-c\)/);
});

test("部品の中身：題が要る・住所は https・フォームは公開中だけ・押す先が無いと止める", () => {
  assert.equal(normRule({ title: "" }).error, "need_title");
  assert.equal(normRule({ title: "a", href: "http://x" }).error, "bad_href");
  assert.equal(normRule({ title: "a", form: "old-form" }, ["zukai-seminar-2611"]).error, "form_not_found");
  assert.equal(normRule({ title: "a" }).error, "need_action");
  assert.equal(normRule({ title: "a", href: "https://x.jp" }).rule.btn, "詳しく見る");
  assert.equal(pickRule({ list: { title: "x" } }, "member"), null, "当たる段も既定も無ければ出さない");
  assert.equal(pickRule({ _default: { title: "d" } }, "member").variant, "default");
});

test("部品を作る・編集・削除。印の名前の形と、どれか 1 段が要る", async () => {
  const { web, env, s } = setup();
  assert.equal((await web.savePart(env, { slug: "Bad_ID", name: "x", rules: RULES }, "a")).error, "bad_id");
  assert.equal((await web.savePart(env, { slug: "gift", name: "特典", rules: {} }, "a")).error, "need_rule");
  assert.equal((await web.savePart(env, { slug: "gift", name: "特典", rules: { new: { title: "x", form: "old-form" } } }, "a")).error, "form_not_found");
  const made = await web.savePart(env, { slug: "gift", name: "記事の特典", place: "mid", rules: RULES }, "a");
  assert.equal(made.ok, true); assert.equal(made.part.snippet, '<div data-lab-part="part:gift"></div>');
  assert.deepEqual(made.part.variants, ["new", "list", "member", "_default"]);
  const ed = await web.savePart(env, { id: "gift", name: "記事の特典（改）" }, "a");
  assert.equal(ed.part.name, "記事の特典（改）"); assert.equal(Object.keys(ed.part.rules).length, 4, "rules を渡さなければ中身はそのまま");
  const g = await web.get(env);
  assert.equal(g.parts.length, 1); assert.deepEqual(g.forms.map((f) => f.slug), ["zukai-seminar-2611"]);
  assert.equal((await web.savePart(env, { id: "gift", remove: true }, "a")).removed, "gift");
  assert.equal(s.t.b_web_parts.length, 0);
});

test("読者の段階で中身が変わる。見たは 1 回ずつ数え、押した・登録は段ごとに数える", async () => {
  const { web, env } = setup({ lanes: { p1: "signup", p2: "learn", p3: "consult" } });
  await web.savePart(env, { slug: "gift", name: "特典", rules: RULES }, "a");
  const a = await web.publicPart(env, "gift", { vid: VID });
  assert.equal(a.part.variant, "new"); assert.equal(a.part.form, "zukai-seminar-2611");
  assert.equal((await web.publicPart(env, "gift", { u: "tok-p1", vid: VID })).part.variant, "list");
  assert.equal((await web.publicPart(env, "gift", { u: "tok-p2", vid: VID })).part.title, "会員サイトの続き");
  const c = await web.publicPart(env, "gift", { u: "tok-p3", vid: VID });
  assert.equal(c.part.variant, "default", "個別相談の段が無ければ既定");
  assert.equal((await web.partHit(env, { part: "gift", kind: "signup", variant: "new", vid: VID })).ok, true);
  assert.equal((await web.partHit(env, { part: "gift", kind: "click", variant: "list", vid: VID })).ok, true);
  assert.equal((await web.partHit(env, { part: "gift", kind: "evil", vid: VID })).error, "bad_kind");
  assert.equal((await web.partHit(env, { part: "nope", kind: "click", vid: VID })).error, "not_found");
  const g = await web.get(env);
  const w = g.parts[0].week;
  assert.equal(w.view, 1, "見た人は端末ごとに 1"); assert.equal(w.click, 1); assert.equal(w.signup, 1);
  assert.equal(w.by.new.signup, 1); assert.equal(w.by.list.click, 1);
});

test("止めた部品と知らない部品は出さない", async () => {
  const { web, env } = setup();
  await web.savePart(env, { slug: "bar", name: "帯", active: false, rules: { _default: { title: "x", href: "https://x.jp" } } }, "a");
  assert.equal((await web.publicPart(env, "bar", { vid: VID })).ok, false);
  assert.equal((await web.publicPart(env, "../x", { vid: VID })).ok, false);
});

test("ページの印 part: を拾い、embed.js は見た目の CSS を読ませて部品を差し込む", () => {
  const p = parseParts('<div data-lab-part="part:gift"></div><div data-lab-part="part:Bad"></div>');
  assert.deepEqual(p.web_parts, ["gift"]); assert.equal(p.bad.length, 1);
  assert.match(EMBED_JS, /\/_lab\/look\.css/); assert.match(EMBED_JS, /\/api\/p\/part\//); assert.match(EMBED_JS, /\/api\/p\/part-hit/);
});

test("AI の道具：読むのは自動、読者の画面が変わるものは承認", () => {
  assert.equal(DEFAULT_MODES.get_web, "auto");
  assert.equal(DEFAULT_MODES.set_web_look, "approve");
  assert.equal(DEFAULT_MODES.save_web_part, "approve");
});

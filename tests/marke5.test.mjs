// マーケくん便 5：アプリの公開スイッチ（src/bridge.js の accessList・setAccess）
// 走らせ方：node --test tests/marke5.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeBridge, PILOT_KEY, PUBLISH_APPS, KNOWN_KEYS } from "../src/bridge.js";
import { fakeStore } from "./fake-store.mjs";

function setup() {
  const st = fakeStore();
  // いまの表に近い形：basic で開いているもの・試しの行・関門を通っていないアプリの行
  st.table("member_access").push(
    { entitlement_key: "shiarabo_basic", target: "portal", created_at: "2026-10-27T00:00:00Z" },
    { entitlement_key: "x_tester", target: "x-koryaku", created_at: "2026-10-27T09:00:00Z" },
    { entitlement_key: PILOT_KEY, target: "haaku", created_at: "2026-10-27T09:00:00Z" },
  );
  st.table("member_entitlement").push(
    { id: 1, member_id: "m1", key: PILOT_KEY, source: "manual", expires_at: null },
    { id: 2, member_id: "m2", key: PILOT_KEY, source: "manual", expires_at: "2000-01-01T00:00:00Z" }, // 期限切れは数えない
    { id: 3, member_id: "m3", key: "shiarabo_basic", source: "payment", expires_at: null },
  );
  const bridge = makeBridge({ db: st.db, rawDb: st.db, addEvent: async () => ({}), secretHeaders: () => ({}) });
  return { st, bridge, env: { B_STORE: true } };
}

test("先行で試すの名前は、人に付けられる名前の一覧に入っている", () => {
  assert.equal(PILOT_KEY, "shiarabo_pilot");
  assert.ok(KNOWN_KEYS.includes(PILOT_KEY));
});

test("公開できるアプリは関門 1〜7 が全部 ○ の 5 本だけ（名前は各アプリが門番の apps で探す名前）", () => {
  assert.deepEqual(PUBLISH_APPS.map((a) => a.target), ["x-koryaku", "note-koryaku", "swipe-file", "mindmap", "content-os"]);
});

test("一覧：3 本とも閉じている・ほかの権利の行は見るだけで出る・人数は期限内の人だけ", async () => {
  const { bridge, env } = setup();
  const r = await bridge.accessList(env);
  assert.equal(r.ok, true);
  assert.equal(r.holders, 1);
  assert.deepEqual(r.apps.map((a) => [a.target, a.on]), [["x-koryaku", false], ["note-koryaku", false], ["swipe-file", false], ["mindmap", false], ["content-os", false]]);
  assert.deepEqual(r.apps.find((a) => a.target === "x-koryaku").others, ["x_tester"]);
  assert.equal(r.apps.some((a) => a.target === "haaku" || a.target === "portal"), false);
});

test("オンにすると先行で試すの行が 1 つ入り、もう一度オンにしても増えない", async () => {
  const { st, bridge, env } = setup();
  const r = await bridge.setAccess(env, { target: "x-koryaku", on: true });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.apps.find((a) => a.target === "x-koryaku").on, true);
  const again = await bridge.setAccess(env, { target: "x-koryaku", on: true });
  assert.equal(again.changed, false);
  assert.equal(st.table("member_access").filter((x) => x.entitlement_key === PILOT_KEY && x.target === "x-koryaku").length, 1);
});

test("オフにすると先行で試すの行だけが消え、ほかの権利の行は残る", async () => {
  const { st, bridge, env } = setup();
  await bridge.setAccess(env, { target: "x-koryaku", on: true });
  const r = await bridge.setAccess(env, { target: "x-koryaku", on: false });
  assert.equal(r.ok, true);
  assert.equal(r.apps.find((a) => a.target === "x-koryaku").on, false);
  const left = st.table("member_access").map((x) => x.entitlement_key + "×" + x.target).sort();
  assert.deepEqual(left, ["shiarabo_basic×portal", "shiarabo_pilot×haaku", "x_tester×x-koryaku"]);
});

test("関門を通っていないアプリ・おかしな指定は書かない。デモの置き場では動かない", async () => {
  const { st, bridge, env } = setup();
  const before = st.table("member_access").length;
  assert.equal((await bridge.setAccess(env, { target: "haaku", on: true })).error, "unknown_app");
  assert.equal((await bridge.setAccess(env, { target: "portal", on: false })).error, "unknown_app");
  assert.equal((await bridge.setAccess(env, { target: "x-koryaku", on: "yes" })).error, "bad_on");
  assert.equal((await bridge.setAccess(env, { target: "x-koryaku,portal", on: true })).error, "unknown_app");
  assert.equal(st.table("member_access").length, before);
  assert.equal((await bridge.setAccess({}, { target: "x-koryaku", on: true })).error, "demo_store");
  assert.equal((await bridge.accessList({})).error, "demo_store");
});

test("入口：公開スイッチの口はシアニン用の確認（/api/admin/ の下）の内側にある", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf-8");
  const gate = src.indexOf('if (path.startsWith("/api/admin/")) {');
  const route = src.indexOf('path === "/api/admin/access"');
  assert.ok(gate > 0 && route > gate);
});

test("画面：左のメニューに「アプリの公開」があり、画面の箱と切り替えの一覧に入っている", () => {
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf-8");
  const js = readFileSync(new URL("../public/js/admin.js", import.meta.url), "utf-8");
  assert.ok(html.includes('data-view="access"'));
  assert.ok(html.includes('id="view-access"'));
  assert.match(js, /const VIEWS = \[[^\]]*"access"/);
});

test("ゲストも切り替えられる・ほかの権利は切り替えられない", async () => {
  const { bridge, env, st } = setup();
  const r = await bridge.setAccess(env, { target: "x-koryaku", on: true, key: "guest" });
  assert.equal(r.ok, true); assert.equal(r.key, "guest");
  assert.ok(st.table("member_access").some((x) => x.entitlement_key === "guest" && x.target === "x-koryaku"));
  assert.equal((await bridge.accessList(env, { key: "guest" })).apps.find((a) => a.target === "x-koryaku").on, true);
  assert.equal((await bridge.accessList(env)).apps.find((a) => a.target === "x-koryaku").on, false);
  assert.equal((await bridge.setAccess(env, { target: "x-koryaku", on: true, key: "shiarabo_basic" })).error, "unknown_key");
});

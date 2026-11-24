// 無料会員の権利 free（2026-11-24・便 A）：メール登録で自動で付く・二重に付けない・付けられなければ失敗を返す・会員には数えない
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBridge, KNOWN_KEYS, MEMBER_KEYS, FREE_KEY, FREE_REASON, appAccess, memberWaiting, gateView } from "../src/bridge.js";
import { fakeStore } from "./fake-store.mjs";

const PID = "11111111-2222-4333-8444-555555555555";
function setup(dbOverride) {
  const st = fakeStore();
  st.table("member").push({ id: PID, email: "a@example.com" });
  const evs = [];
  const db = dbOverride ? dbOverride(st.db) : st.db;
  const bridge = makeBridge({ db, rawDb: db, addEvent: async (env, id, type, payload, actor) => { evs.push({ id, type, payload, actor }); return { id: evs.length }; }, secretHeaders: () => ({}) });
  return { st, bridge, evs, env: { B_STORE: true } };
}

test("free は付けられる名前の一覧にあり、会員の名前には入らない", () => {
  assert.equal(FREE_KEY, "free");
  assert.ok(KNOWN_KEYS.includes("free"));
  assert.equal(KNOWN_KEYS.length, 7);
  assert.ok(!MEMBER_KEYS.includes("free"));
});

test("登録で付ける：行が 1 つ・理由つき・出来事 entitlement_granted が 1 件", async () => {
  const { st, bridge, evs, env } = setup();
  const r = await bridge.grantFree(env, PID, { via: "form:x-roadmap" });
  assert.equal(r.ok, true); assert.equal(r.granted, true);
  const rows = st.table("member_entitlement").filter((x) => x.member_id === PID && x.key === "free");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "manual"); assert.equal(rows[0].reason, FREE_REASON); assert.equal(rows[0].expires_at, null);
  const g = evs.filter((e) => e.type === "entitlement_granted");
  assert.equal(g.length, 1); assert.equal(g[0].payload.key, "free"); assert.equal(g[0].payload.via, "form:x-roadmap"); assert.equal(g[0].payload.auto, true);
});

test("2 回目の登録では付けない（行は 1 つのまま・出来事も増えない）", async () => {
  const { st, bridge, evs, env } = setup();
  await bridge.grantFree(env, PID, {});
  const r = await bridge.grantFree(env, PID, {});
  assert.equal(r.ok, true); assert.equal(r.granted, false); assert.equal(r.already, true);
  assert.equal(st.table("member_entitlement").filter((x) => x.key === "free").length, 1);
  assert.equal(evs.filter((e) => e.type === "entitlement_granted").length, 1);
});

test("付けられなかったら失敗を返し、出来事 entitlement_grant_failed を残す（0 件とは別）", async () => {
  const { bridge, evs, env } = setup((db) => async (env2, method, path, body, prefer) => {
    if (method === "POST" && String(path).startsWith("member_entitlement")) throw new Error("db POST member_entitlement 400: check");
    return db(env2, method, path, body, prefer);
  });
  const r = await bridge.grantFree(env, PID, { via: "register" });
  assert.equal(r.ok, false); assert.equal(r.error, "free_grant_failed");
  assert.match(r.detail, /400/);
  const f = evs.filter((e) => e.type === "entitlement_grant_failed");
  assert.equal(f.length, 1); assert.equal(f[0].payload.key, "free");
});

test("free だけの人はマイページは今までどおり（全部は開かず・会員待ちにもならない）", () => {
  const ent = gateView({ items: [], grants: [] }, ["free"]);
  assert.equal(ent.member, false);
  assert.equal(appAccess(ent, false), "contract");
  assert.equal(memberWaiting(ent), false);
});

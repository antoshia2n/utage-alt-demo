// マーケくん便 2：顧客管理の画面から権利を手で付け外しする（src/bridge.js の grantManual・revokeManual）
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBridge, checkGrant, parseUntil, KNOWN_KEYS } from "../src/bridge.js";
import { fakeStore } from "./fake-store.mjs";

const PID = "11111111-2222-4333-8444-555555555555";
function setup() {
  const st = fakeStore();
  st.table("member").push({ id: PID, email: "a@example.com" });
  st.table("member_entitlement").push({ id: 1, member_id: PID, key: "shiarabo_basic", source: "payment", reason: "UnivaPay", granted_at: "2026-09-01T00:00:00Z", expires_at: null });
  const evs = [];
  const bridge = makeBridge({ db: st.db, rawDb: st.db, addEvent: async (env, id, type, payload, actor) => { evs.push({ id, type, payload, actor }); return { id: evs.length }; }, secretHeaders: () => ({}) });
  return { st, bridge, evs, env: { B_STORE: true } };
}

test("期限：日付だけは日本時間のその日の終わり・空は期限なし・過去は受けない", () => {
  const now = Date.parse("2026-10-24T00:00:00Z");
  assert.equal(parseUntil("2026-11-15", now).value, "2026-11-15T14:59:59.000Z");
  assert.deepEqual(parseUntil("", now), { ok: true, value: null });
  assert.equal(parseUntil("2026-10-01", now).error, "expires_in_past");
  assert.equal(parseUntil("あした", now).error, "bad_expires_at");
});

test("付ける前の確かめ：理由が要る・知らない名前は付けない・手の行は 1 つまで", () => {
  assert.equal(checkGrant({ key: "shiarabo_basic", reason: " " }, KNOWN_KEYS, []).error, "reason_required");
  assert.equal(checkGrant({ key: "shiarabo_basik", reason: "x" }, KNOWN_KEYS, []).error, "unknown_key");
  assert.equal(checkGrant({ key: "Bad Key", reason: "x" }, KNOWN_KEYS, []).error, "bad_key");
  assert.equal(checkGrant({ key: "shiarabo_monitor", reason: "x".repeat(201) }, KNOWN_KEYS, []).error, "reason_too_long");
  assert.equal(checkGrant({ key: "shiarabo_monitor", reason: "x" }, KNOWN_KEYS, [{ key: "shiarabo_monitor", source: "manual" }]).error, "already_manual");
  // 支払いの行が同じ名前であっても、手の行は足せる（表の決まりは人・名前・出どころで 1 行）
  assert.equal(checkGrant({ key: "guest", reason: "〇〇社 試用" }, KNOWN_KEYS, []).error, "expires_required");
  assert.equal(checkGrant({ key: "guest", reason: "〇〇社 試用", expires_at: "2099-01-31" }, KNOWN_KEYS, []).ok, true);
  const ok = checkGrant({ key: "shiarabo_basic", reason: "銀行振込" }, KNOWN_KEYS, [{ key: "shiarabo_basic", source: "payment" }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.row, { key: "shiarabo_basic", source: "manual", reason: "銀行振込", expires_at: null });
});

test("付ける：source=manual の行が 1 つ増え、出来事に残る", async () => {
  const { st, bridge, evs, env } = setup();
  const r = await bridge.grantManual(env, { person_id: PID, key: "shiarabo_next_premium", reason: "NEXT の特典", expires_at: "2099-01-31" });
  assert.equal(r.ok, true);
  assert.equal(r.entitlements.length, 2);
  const row = st.table("member_entitlement").find((x) => x.key === "shiarabo_next_premium");
  assert.equal(row.source, "manual");
  assert.equal(row.reason, "NEXT の特典");
  assert.equal(evs[0].type, "entitlement_granted");
  assert.equal(evs[0].actor, "admin");
  assert.equal(evs[0].payload.key, "shiarabo_next_premium");
});

test("付ける：表にあっても決めた 6 つ以外は付けられない・いない人は found:false・デモの置き場では書かない", async () => {
  const { st, bridge, env } = setup();
  st.table("member_entitlement").push({ id: 9, member_id: "x", key: "monthly_subscriber", source: "payment", reason: "r" });
  assert.equal((await bridge.grantManual(env, { person_id: PID, key: "monthly_subscriber", reason: "手当て" })).error, "unknown_key");
  assert.equal((await bridge.grantManual(env, { person_id: "99999999-2222-4333-8444-555555555555", key: "shiarabo_monitor", reason: "x" })).found, false);
  assert.equal((await bridge.grantManual({}, { person_id: PID, key: "shiarabo_monitor", reason: "x" })).error, "demo_store");
});

test("外す：手で付けた行だけ外せる。理由が要り、出来事に残る", async () => {
  const { st, bridge, evs, env } = setup();
  const g = await bridge.grantManual(env, { person_id: PID, key: "shiarabo_monitor", reason: "招待" });
  const eid = g.entitlement.id;
  assert.equal((await bridge.revokeManual(env, { person_id: PID, entitlement_id: eid, reason: "" })).error, "reason_required");
  assert.equal((await bridge.revokeManual(env, { person_id: PID, entitlement_id: 1, reason: "x" })).error, "not_manual");
  const r = await bridge.revokeManual(env, { person_id: PID, entitlement_id: eid, reason: "退会の申し出" });
  assert.equal(r.ok, true);
  assert.equal(r.removed.key, "shiarabo_monitor");
  assert.deepEqual(st.table("member_entitlement").map((x) => x.id), [1]);
  assert.equal(evs.at(-1).type, "entitlement_revoked");
  assert.equal(evs.at(-1).payload.reason, "退会の申し出");
  assert.equal(evs.at(-1).payload.granted_reason, "招待");
  // 別の人の番号では外れない
  assert.equal((await bridge.revokeManual(env, { person_id: "99999999-2222-4333-8444-555555555555", entitlement_id: 1, reason: "x" })).found, false);
});

test("一覧用：人ごとに権利の行をまとめる", async () => {
  const { bridge, env } = setup();
  await bridge.grantManual(env, { person_id: PID, key: "shiarabo_monitor", reason: "招待" });
  const all = await bridge.gateAll(env);
  assert.deepEqual(all[PID].map((r) => r.key).sort(), ["shiarabo_basic", "shiarabo_monitor"]);
  assert.deepEqual(await bridge.gateAll({}), {});
});

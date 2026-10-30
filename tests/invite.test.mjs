// 招待リンク（2026-10-30）：Google の印の確かめ・作るときの確かめ・受け取りの流れ
import test from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleToken, checkCreate, inviteState, dayEnd, makeInvite, FIREBASE_PROJECT, newToken } from "../src/invite.js";

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const NOW = Date.parse("2026-10-30T01:00:00Z");
async function token(over = {}, kid = "k1") {
  const sec = Math.floor(NOW / 1000);
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const pay = enc({ iss: `https://securetoken.google.com/${FIREBASE_PROJECT}`, aud: FIREBASE_PROJECT, sub: "uid-1", email: "Okazeri@Example.com", email_verified: true, name: "おかぜり", iat: sec - 10, exp: sec + 3600, ...over });
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(head + "." + pay))).toString("base64url");
  return `${head}.${pay}.${sig}`;
}
const opt = { keys: [jwk], now: NOW };

test("Google の印：正しいものは通り、メールは小文字にそろう", async () => {
  const r = await verifyGoogleToken(await token(), opt);
  assert.deepEqual(r, { ok: true, uid: "uid-1", email: "okazeri@example.com", name: "おかぜり" });
});
test("Google の印：書き換え・宛先違い・期限切れ・未確認のメールは通さない", async () => {
  const t = await token();
  const [h, p, s] = t.split(".");
  const forged = `${h}.${enc({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "someone-else" })}.${s}`;
  assert.equal((await verifyGoogleToken(forged, opt)).error, "bad_token");
  assert.equal((await verifyGoogleToken(await token({ aud: "other-project" }), opt)).error, "bad_token");
  assert.equal((await verifyGoogleToken(await token({ exp: Math.floor(NOW / 1000) - 1 }), opt)).error, "token_expired");
  assert.equal((await verifyGoogleToken(await token({ email_verified: false }), opt)).error, "email_not_verified");
  assert.equal((await verifyGoogleToken(await token({}, "nope"), opt)).error, "bad_token");
  assert.equal((await verifyGoogleToken("abc", opt)).error, "bad_token");
});

test("作るときの確かめ：お金を払う権利は選べない・ゲストは期限が要る・日付はその日の終わり", () => {
  const now = Date.parse("2026-10-30T00:00:00Z");
  assert.equal(checkCreate({ name: "x", key: "shiarabo_basic", max_uses: 2, link_until: "2026-11-15", grant_until: "2026-12-31" }, now).error, "key_not_allowed");
  assert.equal(checkCreate({ name: "x", key: "guest", max_uses: 2, link_until: "2026-11-15" }, now).error, "grant_until_required");
  assert.equal(checkCreate({ name: "x", key: "guest", max_uses: 0, link_until: "2026-11-15", grant_until: "2026-12-31" }, now).error, "bad_max_uses");
  assert.equal(checkCreate({ name: "x", key: "guest", max_uses: 2, link_until: "2026-10-01", grant_until: "2026-12-31" }, now).error, "link_until_past");
  assert.equal(checkCreate({ name: "x", key: "guest", max_uses: 2, link_until: "2027-12-01", grant_until: "2026-12-31" }, now).error, "link_until_too_far");
  const ok = checkCreate({ name: " おかぜりさん・るりさん ", key: "guest", max_uses: 2, link_until: "2026-11-15", grant_until: "2026-12-31" }, now);
  assert.equal(ok.ok, true);
  assert.equal(ok.row.name, "おかぜりさん・るりさん");
  assert.equal(ok.row.grant_until, "2026-12-31T14:59:59.000Z");
  assert.equal(checkCreate({ name: "x", key: "shiarabo_pilot", max_uses: 1, link_until: "2026-11-15" }, now).row.grant_until, null);
  assert.equal(dayEnd("bad"), null);
  assert.match(newToken(), /^[A-Za-z0-9_-]{24}$/);
});

test("リンクの状態", () => {
  const base = { active: true, link_until: "2026-11-15T00:00:00Z", used: 0, max_uses: 2 };
  assert.equal(inviteState(null), "not_found");
  assert.equal(inviteState({ ...base, active: false }, NOW), "stopped");
  assert.equal(inviteState({ ...base, link_until: "2026-10-01T00:00:00Z" }, NOW), "expired");
  assert.equal(inviteState({ ...base, used: 2 }, NOW), "used_up");
  assert.equal(inviteState(base, NOW), "ok");
});

// ---------- 受け取りの流れ（偽の表） ----------
function fake() {
  const t = { member: [{ id: "m-old", email: "ruri@example.com", auth_uid: null }], member_entitlement: [], b_invites: [], b_invite_uses: [], member_access: [{ entitlement_key: "guest", target: "x-koryaku" }, { entitlement_key: "guest", target: "mindmap" }, { entitlement_key: "shiarabo_pilot", target: "x-koryaku" }] };
  const ev = [], log = [];
  const q = (path) => { const [tbl, qs = ""] = path.split("?"); const f = {}; for (const part of qs.split("&")) { const m = part.match(/^([a-z_]+)=(eq|is)\.(.*)$/); if (m) f[m[1]] = m[2] === "is" ? null : decodeURIComponent(m[3]); } return { tbl, f }; };
  const hit = (r, f) => Object.entries(f).every(([k, v]) => v === null ? r[k] == null : String(r[k]) === v);
  const db = async (env, method, path, body) => {
    let { tbl, f } = q(path);
    if (tbl === "customers" && method === "POST") { const id = "m-new-" + (t.member.length); t.member.push({ id, email: body[0].email, auth_uid: null, name: body[0].name }); return [{ id }]; }
    if (tbl === "customers") tbl = "member";
    const rows = t[tbl];
    if (method === "GET") return rows.filter((r) => hit(r, f));
    if (method === "PATCH") { const hitRows = rows.filter((r) => hit(r, f)); hitRows.forEach((r) => Object.assign(r, body)); return hitRows; }
    if (method === "POST") { const out = body.map((b) => ({ id: tbl + "-" + rows.length, ...b })); rows.push(...out); return out; }
    throw new Error("no " + method);
  };
  const rpc = async (env, name, { p_token, p_member }) => {
    const v = t.b_invites.find((i) => i.token === p_token);
    if (!v) return "not_found";
    if (t.b_invite_uses.some((u) => u.invite_id === v.id && u.member_id === p_member)) return "already";
    const s = inviteState(v, NOW); if (s !== "ok") return s;
    v.used++; t.b_invite_uses.push({ invite_id: v.id, member_id: p_member }); return "ok";
  };
  const grantManual = async (env, { person_id, key, reason, expires_at }) => { t.member_entitlement.push({ id: "e" + t.member_entitlement.length, member_id: person_id, key, source: "manual", reason, expires_at }); return { ok: true, found: true }; };
  const tokens = {};
  const verify = async (id) => tokens[id] || { ok: false, error: "bad_token" };
  const inv = makeInvite({ db, rpc, grantManual, verify, addEvent: async (env, id, type, p) => ev.push({ id, type, p }), logInbound: async (...a) => log.push(a), appUrls: { "x-koryaku": "https://x-koryaku.shia2n.jp/", mindmap: "https://mindmap.shia2n.jp/" }, origin: () => "https://lab.shia2n.jp", mailcfg: {}, mailText: (s) => s, mailHtml: (s) => s });
  return { t, ev, log, inv, tokens };
}
const TOK = "AbCdEfGhIjKlMnOpQrStUvWx";
const guestInvite = (over = {}) => ({ id: "i1", token: TOK, name: "おかぜりさん・るりさん", key: "guest", grant_until: "2026-12-31T14:59:59.000Z", max_uses: 2, used: 0, link_until: "2026-11-15T14:59:59.000Z", active: true, ...over });

test("受け取り：新しい人は会員の行ができ、Google の番号が結ばれ、ゲストが期限つきで付く", async () => {
  const { t, ev, inv, tokens } = fake();
  t.b_invites.push(guestInvite());
  tokens.g1 = { ok: true, uid: "uid-oka", email: "okazeri@example.com", name: "おかぜり" };
  const r = await inv.accept({}, { token: TOK, id_token: "g1" });
  assert.equal(r.ok, true);
  assert.equal(r.is_new, true);
  assert.deepEqual(r.apps.map((a) => a.name), ["X攻略くん", "思考整理くん"]);
  const m = t.member.find((x) => x.email === "okazeri@example.com");
  assert.equal(m.auth_uid, "uid-oka");
  assert.deepEqual(t.member_entitlement.map((e) => [e.member_id, e.key, e.expires_at]), [[m.id, "guest", "2026-12-31T14:59:59.000Z"]]);
  assert.equal(t.b_invites[0].used, 1);
  assert.ok(ev.some((e) => e.type === "invite_accepted"));
});

test("受け取り：台帳にいる人はその行を使う・同じ人の 2 回目は数えない・人数を使い切ると新しい人は入れない", async () => {
  const { t, inv, tokens } = fake();
  t.b_invites.push(guestInvite({ max_uses: 1 }));
  tokens.r = { ok: true, uid: "uid-ruri", email: "ruri@example.com", name: "るり" };
  tokens.x = { ok: true, uid: "uid-x", email: "x@example.com", name: "x" };
  const a = await inv.accept({}, { token: TOK, id_token: "r" });
  assert.equal(a.ok, true); assert.equal(a.is_new, false);
  assert.equal(t.member.find((m) => m.id === "m-old").auth_uid, "uid-ruri");
  const again = await inv.accept({}, { token: TOK, id_token: "r" });
  assert.equal(again.ok, true); assert.equal(again.again, true);
  assert.equal(t.b_invites[0].used, 1);
  assert.equal(t.member_entitlement.length, 1);
  const x = await inv.accept({}, { token: TOK, id_token: "x" });
  assert.equal(x.error, "used_up");
  assert.equal(t.member.some((m) => m.email === "x@example.com"), false, "使えないリンクで会員の行を作らない");
});

test("受け取り：同じ Google の番号を持つ人を先に使う・埋まっている番号は書き換えない・手当ての期限は遅いほうへ延ばす", async () => {
  const { t, inv, tokens } = fake();
  t.member.push({ id: "m-g", email: "other@example.com", auth_uid: "uid-g" });
  t.member_entitlement.push({ id: "e-g", member_id: "m-g", key: "guest", source: "manual", expires_at: "2026-11-30T00:00:00Z" });
  t.b_invites.push(guestInvite());
  tokens.g = { ok: true, uid: "uid-g", email: "ruri@example.com", name: "" };
  const r = await inv.accept({}, { token: TOK, id_token: "g" });
  assert.equal(r.ok, true);
  assert.equal(t.member.find((m) => m.id === "m-old").auth_uid, null, "メールが同じ別の行には結ばない");
  assert.equal(t.member_entitlement.length, 1);
  assert.equal(t.member_entitlement[0].expires_at, "2026-12-31T14:59:59.000Z");
});

test("受け取り：止めた・期限切れ・印が偽物・知らないリンク", async () => {
  const { t, inv, tokens } = fake();
  t.b_invites.push(guestInvite({ active: false }));
  tokens.n = { ok: true, uid: "uid-n", email: "n@example.com", name: "" };
  assert.equal((await inv.accept({}, { token: TOK, id_token: "n" })).error, "stopped");
  assert.equal((await inv.accept({}, { token: TOK, id_token: "forged" })).error, "bad_token");
  assert.equal((await inv.accept({}, { token: "ZZZZZZZZZZZZZZZZZZZZZZZZ", id_token: "n" })).error, "not_found");
  assert.equal((await inv.accept({}, { token: "../x", id_token: "n" })).error, "not_found");
  assert.equal(t.member.length, 1);
});

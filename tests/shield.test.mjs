// 便 R1：公開の入口の守りの試験。Worker の入口（src/index.js）を、Supabase と Turnstile への fetch を手元で真似て呼ぶ。
// 見ること：ロボット判定（両方の鍵がそろったときだけ・印が無い／通らない／届かないは止める）・同じ接続元の回数・同じ住所の回数
//   ・外へ返すエラーから中身を外す（Naoki の画面と AI の窓口は残す）・AI の窓口はヘッダーの合言葉だけ・GET で道具を呼べない
//   ・ページの人の印の期限・台帳にいない住所へログインのメールを送らない
// 走らせ方：node --test tests/shield.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";
import { personToken, readPersonToken } from "../src/pages.js";
import { makeShield, stripDetail, isPrivatePath, botCheckOn, SITEVERIFY_URL } from "../src/shield.js";

const s = fakeStore();
const realFetch = globalThis.fetch;
let verify = { success: true }; // Turnstile の答え（null なら届かない）
let verifyCalls = [];
let dbBroken = false;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.toString() === SITEVERIFY_URL) {
    verifyCalls.push(init.body);
    if (verify === null) throw new Error("connect refused");
    return new Response(JSON.stringify(verify), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.hostname !== "db.example") return realFetch(input, init);
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + u.search;
  if (dbBroken && pq.startsWith("b_forms")) return new Response("relation b_forms does not exist", { status: 500 });
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (pq.startsWith("rpc/b_register")) {
    const ex = s.table("b_customers").find((c) => c.email === body.p_email);
    if (ex) return Response.json({ id: ex.id, is_new: false });
    const id = crypto.randomUUID();
    s.table("b_customers").push({ id, email: body.p_email, name: body.p_name, source: body.p_source });
    return Response.json({ id, is_new: true });
  }
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

const HOOK_SECRET = Buffer.from("hook-secret-for-tests-0123456789").toString("base64");
const sent = [];
const baseEnv = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  B_AUTH_HOOK_SECRET: "v1,whsec_" + HOOK_SECRET,
  EMAIL: { send: async (m) => { sent.push(m); return { messageId: "m" + sent.length }; } },
  ASSETS: { fetch: async () => new Response("asset") },
};
const withKeys = { ...baseEnv, TURNSTILE_SITE_KEY: "0x4AAAAAAAtestsite", TURNSTILE_SECRET_KEY: "0x4AAAAAAAtestsecret" };
const call = (env, url, init) => worker.fetch(new Request(url, init), env, { waitUntil() {} });
let ipSeq = 0;
const post = (env, url, body, ip) => call(env, url, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip || `203.0.113.${++ipSeq % 250}` }, body: JSON.stringify(body) });

s.table("b_fields").push({ key: "x_account", label: "X のアカウント", type: "text", options: [] });
s.table("b_forms").push({ id: "00000000-0000-4000-8000-0000000000f1", slug: "seminar-2611", title: "図解セミナー", intro: "", thanks: "受け取りました", items: [], ask_name: true, active: true });
s.table("b_settings").push({ key: "mail_from", value: "info@mail.shia2n.jp" }, { key: "mail_scope", value: "login" });
s.table("b_admins").push({ email: "naoki@example.com" });
const shieldLogs = () => s.table("b_inbound_log").filter((x) => x.channel === "shield");
const formBody = (email, extra = {}) => ({ email, name: "試し", consent: true, answers: {}, ...extra });

test("判定の鍵が片方だけなら判定しない（入れる順番で申込が止まらない）", () => {
  assert.equal(botCheckOn(baseEnv), false);
  assert.equal(botCheckOn({ TURNSTILE_SECRET_KEY: "x" }), false);
  assert.equal(botCheckOn({ TURNSTILE_SITE_KEY: "x" }), false);
  assert.equal(botCheckOn(withKeys), true);
});

test("鍵が無いとき：lp のフォームは今までどおり受け付け、表示用の鍵は返さない", async () => {
  const g = await call(baseEnv, "https://lp.shia2n.jp/api/p/form/seminar-2611");
  assert.equal((await g.json()).bot_site_key, null);
  const r = await post(baseEnv, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("a1@example.com"));
  assert.equal(r.status, 200);
  assert.equal(verifyCalls.length, 0, "判定の口を呼ばない");
});

test("鍵がそろったとき：表示用の鍵を返し、印の無い申込は 403 で止め、台帳に入れない", async () => {
  const g = await call(withKeys, "https://lp.shia2n.jp/api/p/form/seminar-2611");
  assert.equal((await g.json()).bot_site_key, "0x4AAAAAAAtestsite");
  const before = s.table("b_customers").length;
  const r = await post(withKeys, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("bot1@example.com"));
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { ok: false, error: "bot_check_failed" });
  assert.equal(s.table("b_customers").length, before, "台帳に増えない");
  assert.equal(shieldLogs().at(-1).request.reason, "bot_missing");
});

test("鍵がそろったとき：判定が通れば受け付け、通らない・届かないは止める（届かないときも通さない）", async () => {
  verify = { success: true }; verifyCalls = [];
  const ok = await post(withKeys, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("human1@example.com", { turnstile: "tok-ok" }));
  assert.equal(ok.status, 200);
  assert.equal(verifyCalls.length, 1);
  assert.equal(verifyCalls[0].get("secret"), "0x4AAAAAAAtestsecret");
  assert.equal(verifyCalls[0].get("response"), "tok-ok");
  verify = { success: false, "error-codes": ["invalid-input-response"] };
  const ng = await post(withKeys, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("bot2@example.com", { turnstile: "tok-bad" }));
  assert.equal(ng.status, 403);
  assert.equal(shieldLogs().at(-1).request.reason, "bot_rejected");
  verify = null;
  const down = await post(withKeys, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("bot3@example.com", { turnstile: "tok" }));
  assert.equal(down.status, 403);
  assert.equal(shieldLogs().at(-1).request.reason, "bot_unreachable");
  verify = { success: true };
});

test("判定は lab のフォームと登録にも掛かる。ログインの準備と LINE を結ぶ口には掛けない", async () => {
  const f = await post(withKeys, "https://lab.shia2n.jp/api/forms/seminar-2611", formBody("bot4@example.com"));
  assert.equal(f.status, 403);
  const reg = await post(withKeys, "https://lab.shia2n.jp/api/register", { email: "bot5@example.com", name: "x", consent: true });
  assert.equal(reg.status, 403);
  const cfg = await (await call(withKeys, "https://lab.shia2n.jp/api/config")).json();
  assert.equal(cfg.botSiteKey, "0x4AAAAAAAtestsite");
  const lp = await post(withKeys, "https://lab.shia2n.jp/api/login/prepare", { email: "nobody@example.com" });
  assert.equal(lp.status, 200);
});

test("同じ住所は 10 分に 3 回まで。4 回目は 429 で受け付けず、出来事も増えない", async () => {
  const email = "same@example.com";
  for (let i = 0; i < 3; i++) {
    const r = await post(baseEnv, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody(email));
    assert.equal(r.status, 200, `${i + 1} 回目`);
  }
  const id = s.table("b_customers").find((c) => c.email === email).id;
  const n = s.table("b_events").filter((e) => e.customer_id === id).length;
  const r4 = await post(baseEnv, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody(email));
  assert.equal(r4.status, 429);
  assert.deepEqual(await r4.json(), { ok: false, error: "too_many" });
  assert.equal(s.table("b_events").filter((e) => e.customer_id === id).length, n);
  const log = shieldLogs().at(-1);
  assert.equal(log.request.reason, "email_limit");
  assert.equal(log.request.to_domain, "example.com");
  assert.ok(!JSON.stringify(log).includes("same@"), "記録に住所そのものを残さない");
});

test("同じ住所の 1 日の上限（10 回）：10 分より前の受付も数える", async () => {
  const shield = makeShield({ db: s.db, logInbound: async () => {} });
  const id = crypto.randomUUID();
  s.table("customers").push({ id, email: "day@example.com" });
  for (let i = 0; i < 10; i++) s.table("events").push({ customer_id: id, type: "register_again", occurred_at: new Date(Date.now() - (30 + i) * 60e3).toISOString() });
  assert.deepEqual(await shield.emailAllowed({}, "day@example.com"), { ok: false, minutes: 1440, max: 10 });
  assert.deepEqual(await shield.emailAllowed({}, "new@example.com"), { ok: true }, "台帳にいない住所は 0 回");
});

test("同じ接続元の回数：Cloudflare の回数制限が断ったら 429。記録は増やさない", async () => {
  const keys = [];
  const env = { ...baseEnv, PUBLIC_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: false }; } }, HIT_LIMIT: { limit: async () => ({ success: true }) } };
  const before = shieldLogs().length;
  const r = await post(env, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("ip@example.com"), "198.51.100.7");
  assert.equal(r.status, 429);
  assert.equal(keys[0], "public:198.51.100.7");
  assert.equal(shieldLogs().length, before);
  const h = await (await call(env, "https://lab.shia2n.jp/api/health")).json();
  assert.equal(h.shield.ip_limit, true);
  assert.equal(h.shield.bot_check, false);
});

test("外から誰でも呼べる口のエラーは中身を返さず、記録にだけ残す", async () => {
  dbBroken = true;
  const r = await post(baseEnv, "https://lp.shia2n.jp/api/p/form/seminar-2611", formBody("err@example.com"));
  dbBroken = false;
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.deepEqual(j, { ok: false, error: "internal_error" });
  const log = s.table("b_inbound_log").filter((x) => x.channel === "error_detail").at(-1);
  assert.match(log.response.detail, /b_forms/);
});

test("中身を外すのは一番上の detail だけ。Naoki の画面と AI の窓口は外さない", async () => {
  assert.equal(isPrivatePath("/api/admin/people"), true);
  assert.equal(isPrivatePath("/mcp"), true);
  assert.equal(isPrivatePath("/api/p/form/x"), false);
  const res = await stripDetail(Response.json({ ok: false, error: "x", detail: "secret table", notices: [{ detail: "見せてよい" }] }, { status: 400 }));
  assert.deepEqual(await res.json(), { ok: false, error: "x", notices: [{ detail: "見せてよい" }] });
});

test("AI の窓口：住所の中の合言葉は 404、ヘッダーなしは 401、GET で道具は呼べない、POST はヘッダーで通る", async () => {
  assert.equal((await call(baseEnv, "https://lab.shia2n.jp/mcp/test-secret")).status, 404);
  assert.equal((await call(baseEnv, "https://lab.shia2n.jp/mcp/test-secret", { method: "POST", body: "{}" })).status, 404);
  assert.equal((await call(baseEnv, "https://lab.shia2n.jp/mcp")).status, 401);
  const auth = { authorization: "Bearer test-secret" };
  const g = await (await call(baseEnv, "https://lab.shia2n.jp/mcp?tool=stats", { headers: auth })).json();
  assert.equal(g.name, "utage-alt-demo");
  assert.ok(Array.isArray(g.tools), "道具の一覧だけ返す");
  assert.equal(g.customers, undefined, "道具は呼ばれていない");
  const p = await call(baseEnv, "https://lab.shia2n.jp/mcp", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.deepEqual(await p.json(), { jsonrpc: "2.0", id: 1, result: {} });
});

test("ページの人の印：期限内は読め、期限切れと期限の無い前の形は知らない人", async () => {
  const env = { MCP_SECRET: "test-secret" };
  const cid = "11111111-1111-4111-8111-111111111111";
  assert.equal(await readPersonToken(env, await personToken(env, cid)), cid);
  assert.equal(await readPersonToken(env, await personToken(env, cid, -1000)), null, "期限切れ");
  const old = `${cid}.${createHmac("sha256", "x").update("y").digest("hex").slice(0, 32)}`;
  assert.equal(await readPersonToken(env, old), null, "前の形");
  const t = await personToken(env, cid);
  const [id, exp, sig] = t.split(".");
  assert.equal(await readPersonToken(env, `${id}.${Number(exp) + 86400}.${sig}`), null, "期限を書き換えると署名が合わない");
});

function hookRequest(email, type = "signup") {
  const raw = JSON.stringify({ user: { email }, email_data: { email_action_type: type, token_hash: "th", token: "123456", redirect_to: "https://lab.shia2n.jp/app" } });
  const id = "msg_1", ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(HOOK_SECRET, "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }, body: raw };
}

test("ログインのメール：台帳にいない住所へは送らない。台帳にいる人とシアニンには送る", async () => {
  sent.length = 0;
  const r1 = await call(baseEnv, "https://lab.shia2n.jp/api/auth/send-email", hookRequest("stranger@example.com"));
  assert.equal(r1.status, 400);
  assert.equal(sent.length, 0);
  assert.equal(s.table("b_inbound_log").filter((x) => x.channel === "auth_email").at(-1).response.error, "not_in_ledger");
  const r2 = await call(baseEnv, "https://lab.shia2n.jp/api/auth/send-email", hookRequest("human1@example.com", "magiclink"));
  assert.equal(r2.status, 200);
  const r3 = await call(baseEnv, "https://lab.shia2n.jp/api/auth/send-email", hookRequest("naoki@example.com", "magiclink"));
  assert.equal(r3.status, 200);
  assert.equal(sent.length, 2);
});

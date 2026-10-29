// 関門 3：生徒の画面の口（11 本＋/api/me・/api/booking）を実際に叩き、ご契約だけの人には中身を返さないことを見る。
// 走らせ方：node --test tests/gate3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";

const s = fakeStore();
const TOKENS = { con: "contract@example.com", mem: "member@example.com", pil: "pilot@example.com", gst: "guest@example.com" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "db.example") return realFetch(input, init);
  if (u.pathname === "/auth/v1/user") {
    const tok = String((init.headers && (init.headers.authorization || init.headers.Authorization)) || "").replace(/^Bearer /, "");
    return TOKENS[tok] ? new Response(JSON.stringify({ email: TOKENS[tok] }), { status: 200 }) : new Response("{}", { status: 401 });
  }
  // 名前の側（payload->>lesson_id など）は fetch で % に変わるので戻す。値の側は入れ物が戻す
  const search = u.search ? "?" + u.search.slice(1).split("&").map((p) => { const i = p.indexOf("="); return decodeURIComponent(p.slice(0, i)) + "=" + p.slice(i + 1); }).join("&") : "";
  const pq = decodeURIComponent(u.pathname.replace(/^[/]rest[/]v1[/]/, "")) + search;
  const prefer = (init.headers && (init.headers.prefer || init.headers.Prefer)) || "";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const out = await s.db({}, init.method || "GET", pq, body, prefer);
  return new Response(out == null ? "" : JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", MCP_SECRET: "test-secret",
  B_SUPABASE_URL: "https://db.example", B_SUPABASE_PUBLISHABLE_KEY: "pk", B_SUPABASE_SECRET_KEY: "sk",
  PUBLIC_ORIGIN: "https://lab.shia2n.jp", PAGES_ORIGIN: "https://lp.shia2n.jp",
  ASSETS: { fetch: async () => new Response("asset") },
};
const call = (path, tok, init = {}) => worker.fetch(new Request("https://lab.shia2n.jp" + path, {
  ...init, headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...(init.headers || {}) },
  body: init.body ? JSON.stringify(init.body) : undefined,
}), env, { waitUntil() {} });


// 関門 3：生徒の画面の口を 1 本ずつ叩き、権利の無い人（ご契約だけの人）には中身を返さないことを見る
const CON = "33333333-3333-4333-8333-333333333333", MEM = "44444444-4444-4444-8444-444444444444";
const PIL = "55555555-5555-4555-8555-555555555555", GST = "66666666-6666-4666-8666-666666666666";
s.table("b_customers").push({ id: CON, email: TOKENS.con, name: "契約だけ" }, { id: MEM, email: TOKENS.mem, name: "会員" }, { id: PIL, email: TOKENS.pil, name: "先行" }, { id: GST, email: TOKENS.gst, name: "ゲスト" });
s.table("member_entitlement").push(
  { id: "g1", member_id: MEM, key: "shiarabo_basic", source: "manual" },
  { id: "g2", member_id: PIL, key: "shiarabo_pilot", source: "manual" },
  { id: "g3", member_id: GST, key: "guest", source: "manual" },
);
const LID = "77777777-7777-4777-8777-777777777777";
const GATED = [
  ["GET", "/api/mypage"],
  ["GET", `/api/lesson/notes?lesson_id=${LID}`],
  ["POST", "/api/lesson/memo", { lesson_id: LID, text: "x" }],
  ["GET", "/api/room"],
  ["POST", "/api/room", { text: "x" }],
  ["POST", "/api/room/read", {}],
  ["POST", "/api/room/images", {}],
  ["GET", "/api/room/image?key=x"],
  ["POST", "/api/booking", {}],
  ["POST", "/api/booking/cancel", {}],
  ["POST", "/api/seminars/s1/register", {}],
];

for (const [method, path, body] of GATED) {
  test(`ご契約だけの人：${method} ${path} は 403`, async () => {
    const r = await call(path, "con", { method, body });
    assert.equal(r.status, 403);
  });
  test(`ログインしていない人：${method} ${path} は 401`, async () => {
    const r = await call(path, "nobody", { method, body });
    assert.equal(r.status, 401);
  });
}

test("ご契約だけの人：GET /api/me は access contract で教材も部屋も空", async () => {
  const j = await (await call("/api/me", "con")).json();
  assert.equal(j.access, "contract");
  assert.ok(!j.lessons || j.lessons.length === 0);
});

test("ご契約だけの人：GET /api/booking は「準備中」だけ", async () => {
  const j = await (await call("/api/booking", "con")).json();
  assert.equal(j.ready, false);
});

for (const tok of ["mem", "pil", "gst"]) {
  test(`権利のある人（${tok}）：マイページ・教材の質問・部屋は会員向けの 403 にならない`, async () => {
    for (const [method, path, body] of GATED.slice(0, 5)) {
      const r = await call(path, tok, { method, body });
      const j = await r.json().catch(() => ({}));
      assert.notEqual(j.error, "not_member", `${method} ${path}`);
    }
    assert.equal((await (await call("/api/me", tok)).json()).access, "full");
  });
}

// 便 2（関門 5）：右上の「アプリ一覧」に出すアプリは、その人の権利 × 開くものの表だけ
test("/api/me の apps は、その人の権利で開いているアプリだけ", async () => {
  s.table("member_access").push({ entitlement_key: "shiarabo_pilot", target: "x-koryaku" }, { entitlement_key: "shiarabo_basic", target: "mindmap" });
  assert.deepEqual((await (await call("/api/me", "pil")).json()).apps, ["x-koryaku"]);
  assert.deepEqual((await (await call("/api/me", "mem")).json()).apps, ["mindmap"]);
  const c = await (await call("/api/me", "con")).json();
  assert.deepEqual(c.apps, []);
  assert.equal(c.admin, false);
});

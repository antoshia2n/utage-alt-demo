// 無料会員の便 B（2026-11-24）：権利 free だけの人は、チャット（やり取り・グループ）と free に開いた棚だけ。添削・マイページの HTML・目標は閉じる
// 走らせ方：node --test tests/free2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import worker from "../src/index.js";

const s = fakeStore();
const TOKENS = { fre: "free@example.com", fm: "freemember@example.com", con: "contract@example.com" };
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


// 無料会員の便 B（2026-11-24）：権利 free だけの人は、チャット（やり取り・グループ）と free に開いた棚だけ。添削・マイページの HTML・目標は閉じる

const FRE = "88888888-8888-4888-8888-888888888888", FM = "99999999-9999-4999-8999-999999999999", CON = "33333333-3333-4333-8333-333333333333";
s.table("b_customers").push({ id: FRE, email: TOKENS.fre, name: "無料会員" }, { id: FM, email: TOKENS.fm, name: "生徒で無料会員" }, { id: CON, email: TOKENS.con, name: "契約だけ" });
s.table("member_entitlement").push(
  { id: "f1", member_id: FRE, key: "free", source: "manual", reason: "メール登録で自動（無料会員）" },
  { id: "f2", member_id: FM, key: "free", source: "manual", reason: "メール登録で自動（無料会員）" },
  { id: "f3", member_id: FM, key: "shiarabo_basic", source: "manual" },
);

import { studentTier, gateView } from "../src/bridge.js";
// 2026-11-25 08:16 Naoki：無料会員に会員サイトのログインは渡さない（便 B の free の段をやめた）。free だけの人は「ご契約」の画面で公式サイトへ案内する
test("段の決め方：free だけ → contract（会員サイトは開かない）・生徒の権利もある → contract・先行は full・何も無い → contract", () => {
  assert.equal(studentTier(gateView(null, ["free"]), false), "contract");
  assert.equal(studentTier(gateView(null, ["free", "shiarabo_basic"]), false), "contract");
  assert.equal(studentTier(gateView(null, ["free", "shiarabo_pilot"]), false), "full");
  assert.equal(studentTier(gateView(null, []), false), "contract");
  assert.equal(studentTier(gateView(null, ["free"]), true), "full");
});

test("無料会員：/api/me はご契約の画面で、公式サイトのログインへの案内（site_member）を返す", async () => {
  const j = await (await call("/api/me", "fre")).json();
  assert.equal(j.ok, true);
  assert.equal(j.access, "contract");
  assert.equal(j.site_member, true);
  assert.equal(j.site_login_url, "https://lp.shia2n.jp/login");
  assert.deepEqual(j.apps, []);
});

test("無料会員：会員サイトの部屋（チャット・添削）は 403", async () => {
  const ng = await call("/api/room", "fre", { method: "POST", body: { text: "質問です", kind: "chat" } });
  assert.equal(ng.status, 403);
  assert.ok(!s.table("b_events").some((e) => e.customer_id === FRE && e.type === "room_chat"));
  assert.equal((await call("/api/room", "fre")).status, 403);
});

test("無料会員：マイページの HTML と目標は今までどおり 403", async () => {
  assert.equal((await call("/api/mypage", "fre")).status, 403);
  assert.equal((await call("/api/me/goals", "fre")).status, 403);
});

test("生徒の権利もある人は free を持っていても今までどおり（ご契約だけ・部屋は 403）", async () => {
  const j = await (await call("/api/me", "fm")).json();
  assert.equal(j.access, "contract");
  assert.equal(j.member_waiting, true);
  assert.equal(j.site_member, false);
  assert.equal((await call("/api/room", "fm")).status, 403);
});

test("何も無い人は今までどおり（ご契約だけ・部屋は 403）", async () => {
  assert.equal((await (await call("/api/me", "con")).json()).access, "contract");
  assert.equal((await call("/api/room", "con", { method: "POST", body: { text: "x", kind: "chat" } })).status, 403);
});

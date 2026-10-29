// ムダ 10 の 1 段目：本番の Supabase の値が欠けたら、旧デモへ黙って戻らずに止まる
// 走らせ方：node --test tests/store10.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const OLD = { SUPABASE_URL: "https://old-demo.supabase.co", SUPABASE_PUBLISHABLE_KEY: "old-pub", SUPABASE_SECRET_KEY: "old-secret", MCP_SECRET: "m".repeat(32) };

test("B_SUPABASE_SECRET_KEY が欠けたら、旧デモへは 1 回も聞きに行かず、欠けた名前を返す", async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, ...rest) => { calls.push(String(u)); return orig(u, ...rest); };
  try {
    const env = { ...OLD, B_SUPABASE_URL: "https://prod.supabase.co", B_SUPABASE_PUBLISHABLE_KEY: "pub" };
    const res = await worker.fetch(new Request("https://lab.shia2n.jp/api/health"), env, { waitUntil() {} });
    const j = await res.json();
    assert.ok(j.missing_settings.includes("B_SUPABASE_SECRET_KEY"), JSON.stringify(j.missing_settings));
    assert.equal(calls.filter((u) => u.includes("old-demo")).length, 0, "旧デモへ聞きに行った");
    assert.notEqual(j.store, "demo");
  } finally { globalThis.fetch = orig; }
});

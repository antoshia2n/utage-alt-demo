// UTAGE の写し（2026-11-06 開発部・UTAGE 解約の便 U1・Naoki OK 19:47／19:56「アーカイブ的に写して、あとで AI とかで参考にできる形で」）
// 写しの正本は shia2n-mcp（保管庫の utage-archive/）。ここは結び UTAGE（entrypoint UtageReader）の archive_* で読むだけで、表は持たない。
// 個人の情報（読者・LINE 友だち・申込者・受講生・売上）は shia2n-mcp が数しか返さない。
function reader(env) {
  if (!env.UTAGE || typeof env.UTAGE.archive_status !== "function") throw Object.assign(new Error("shia2n-mcp の UTAGE の写し（v1.68.0）につながっていません"), { code: "no_binding" });
  return env.UTAGE;
}
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e.code || "archive_failed", message: String(e.message || e).slice(0, 300) };
  }
}
export const utageCopy = {
  status: (env) => safe(() => reader(env).archive_status()),
  doc: (env, name) => safe(() => reader(env).archive_doc(String(name || "overview").slice(0, 40))),
  search: (env, words, kind) => safe(() => reader(env).archive_search({ words: String(words || "").slice(0, 100), kind: kind ? String(kind).slice(0, 40) : undefined, limit: 50 })),
  item: (env, ref) => safe(() => reader(env).archive_item(String(ref || "").slice(0, 120), false)),
};

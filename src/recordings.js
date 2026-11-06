// 録画（録画の棚）2026-11-06 開発部・Naoki「R2 の動画を整理されて、あとで共有リンクを発行しやすくしておきたい」
// → 作る前の 1 枚とデモに OK（14:21）・置き場はマーケくんのシアニン用画面（15:02 OK）。
//
// 録画の中身と共有リンクの正本は zoom-to-youtube（R2）。ここは結び ZOOM（entrypoint ArchiveApi）で読む・頼むだけで、表は持たない。
//   shelf        棚の一覧（全部の録画・共有の状態・整理の案・点検）
//   share_issue  共有リンクを出す（すでにあればそれを返す）
//   share_set    共有を止める・期限
//   meta_set     名前と会の種類（まとめて）
//   suggest_kai  「その他」の録画に会の種類の案を AI で付ける（少しずつ）
//   search       文字起こしの中の言葉で探す（多くても 50 件）
// 見る画面と短いリンクは v.shia2n.jp（zoom-to-youtube）。

export const KAIS = ["セミナー", "打ち合わせ", "個別相談", "Zoom添削", "その他"];

function zoom(env) {
  if (!env.ZOOM) throw Object.assign(new Error("録画の保管（zoom-to-youtube）への結び ZOOM がありません"), { code: "no_binding" });
  return env.ZOOM;
}

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e.code || "zoom_failed", message: String(e.message || e).slice(0, 300) };
  }
}

export const recordings = {
  list: (env) => safe(() => zoom(env).shelf()),

  /** AI 向け：棚を絞って小さく返す */
  find: (env, args = {}) =>
    safe(async () => {
      const r = await zoom(env).shelf();
      if (!r.ok) return r;
      let rows = r.rows;
      const words = String(args.words || "").split(/[\s　]+/).filter(Boolean);
      if (args.kai) rows = rows.filter((x) => x.kai === args.kai);
      if (args.date_from) rows = rows.filter((x) => x.date >= args.date_from);
      if (args.date_to) rows = rows.filter((x) => x.date <= args.date_to);
      if (words.length) rows = rows.filter((x) => words.every((w) => x.title.includes(w)));
      if (args.shared === true) rows = rows.filter((x) => x.share && x.share.state === "on");
      if (args.shared === false) rows = rows.filter((x) => !x.share);
      if (args.with_issues) rows = rows.filter((x) => x.issues.length);
      if (args.with_suggestions) rows = rows.filter((x) => x.suggest_kai || x.suggest_name);
      if (args.transcript_words) {
        const hit = await zoom(env).search({ transcript_words: args.transcript_words, kai: args.kai, date_from: args.date_from, date_to: args.date_to, limit: 50 });
        const ids = new Set((hit.rows || []).map((x) => x.rec_id));
        rows = rows.filter((x) => ids.has(x.id));
      }
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 30));
      return { ok: true, matched: rows.length, counts: r.counts, short_link_ready: r.short_link_ready, rows: rows.slice(0, limit) };
    }),

  search: (env, words) =>
    safe(async () => {
      const w = String(words || "").trim().slice(0, 100);
      if (!w) return { ok: false, error: "words_required" };
      const r = await zoom(env).search({ transcript_words: w, limit: 50 });
      return { ok: true, ids: (r.rows || []).map((x) => x.rec_id), hits: Object.fromEntries((r.rows || []).filter((x) => x.transcript_hit).map((x) => [x.rec_id, x.transcript_hit])), note: r.note || null };
    }),

  issue: (env, id) => safe(() => zoom(env).share_issue(String(id || ""))),

  setLink: (env, id, { stopped, expires } = {}) =>
    safe(() => {
      const opts = {};
      if (typeof stopped === "boolean") opts.stopped = stopped;
      if (expires !== undefined) opts.expires = expires === null ? "" : String(expires);
      return zoom(env).share_set(String(id || ""), opts);
    }),

  setMeta: (env, items) =>
    safe(() => {
      const list = (Array.isArray(items) ? items : []).slice(0, 600).map((m) => {
        const o = { id: String(m.id || "") };
        if (m.title !== undefined) o.title = String(m.title);
        if (m.kai !== undefined) o.kai = String(m.kai);
        return o;
      });
      if (!list.length) return { ok: false, error: "items_required" };
      return zoom(env).meta_set(list);
    }),

  suggest: (env, limit) => safe(() => zoom(env).suggest_kai(Math.max(1, Math.min(20, Number(limit) || 8)))),
};

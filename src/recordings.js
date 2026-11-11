// 録画（録画の棚）2026-11-06 開発部・Naoki「R2 の動画を整理されて、あとで共有リンクを発行しやすくしておきたい」
// → 作る前の 1 枚とデモに OK（14:21）・置き場はマーケくんのシアニン用画面（15:02 OK）。
//
// 録画の中身と共有リンクの正本は zoom-to-youtube（R2）。ここは結び ZOOM（entrypoint ArchiveApi）で読む・頼むだけで、表は持たない。
//   shelf        棚の一覧（全部の録画・共有の状態・整理の案・点検）
//   share_issue  共有リンクを出す（すでにあればそれを返す）
//   share_set    共有を止める・期限
//   meta_set     名前と会の種類（まとめて）
//   suggest_kai  「その他」の録画に会の種類の案を AI で付ける（少しずつ。5 分ごとの処理も 6 本ずつ出す）
//   labels_edit  ラベルの名前を変える・削除（便 A・2026-11-06）
//   search       文字起こしの中の言葉で探す（多くても 50 件）
//   route_*      出し先のスイッチ（2026-11-12 Naoki OK）：録画ごとに YouTube・会員サイトを入り切り。会員サイトへ入れるのはここ（routeRun・1 時間ごと）
//   upload_*     便 C（2026-11-06 Naoki OK 19:47）：Zoom 以外の動画・音声を 16MB ずつ R2 へ入れ、棚に「アップロード」で並べる
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

// 便B（2026-11-06）：会員サイトのコースの一覧（名前の道筋と、見られる権利）
function coursePaths(t) {
  const siteName = new Map(t.sites.map((x) => [x.id, x.name]));
  const prog = new Map(t.programs.map((x) => [x.id, x]));
  const cur = new Map(t.curricula.map((x) => [x.id, x]));
  const rightsOf = (programId) => {
    const ks = new Set();
    t.cprog.filter((x) => x.program_id === programId).forEach((x) => { if (cur.get(x.curriculum_id)?.active !== false) t.rights.filter((r) => r.curriculum_id === x.curriculum_id).forEach((r) => ks.add(r.entitlement_key)); });
    return [...ks];
  };
  return t.courses.filter((c) => c.active !== false && prog.get(c.program_id)?.active !== false).map((c) => {
    const p = prog.get(c.program_id);
    return { id: c.id, path: [siteName.get(p?.site_id), p?.title, c.title].filter(Boolean).join(" › "), rights: rightsOf(c.program_id), sort: [p?.sort ?? 0, c.sort ?? 0] };
  }).sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1]).map(({ sort, ...x }) => x);
}

export const recordings = {
  list: (env) => safe(() => zoom(env).shelf()),

  /** 便B：この録画がどのコースに入っているか・入れられるコース・写す中身 */
  member: (env, site, id) =>
    safe(async () => {
      const t = await site.tree(env);
      const paths = new Map(coursePaths(t).map((c) => [c.id, c]));
      const rec = (id && String(id)) || "";
      const placed = [];
      for (const c of t.contents.filter((x) => x.rec_id && (!rec || x.rec_id === rec) && x.active !== false)) {
        for (const l of t.links.filter((x) => x.content_id === c.id)) placed.push({ rec_id: c.rec_id, content_id: c.id, title: c.title, status: c.status, course_id: l.course_id, path: paths.get(l.course_id)?.path || "" });
      }
      if (!rec) return { ok: true, placed };
      const info = await zoom(env).member_info(rec);
      if (!info.ok) return info;
      return { ok: true, info, placed, courses: [...paths.values()] };
    }),

  /** 便B：録画を会員サイトのコースに入れる（コンテンツを 1 本作る。要約と目次は録画から写す） */
  putInSite: (env, site, by, b = {}) =>
    safe(async () => {
      const info = await zoom(env).member_info(String(b.id || ""));
      if (!info.ok) return info;
      const status = b.status === "published" ? "published" : "draft";
      const minutes = Number.isFinite(info.minutes) ? Math.min(1440, Math.max(0, Math.round(info.minutes))) : null;
      const r = await site.saveContent(env, {
        title: String(b.title || "").trim() || info.title, summary: info.summary || "", status,
        minutes, toc: info.toc || [], files: [], can_ask: true, rec_id: info.id, courses: [String(b.course_id || "")],
        // 出し先のスイッチ：YouTube に上がっていれば、生徒の画面は YouTube の埋め込みを先に出す
        ...(b.video_url ? { video_url: String(b.video_url) } : {}),
      }, by);
      return r.ok ? { ok: true, content_id: r.id, status } : r;
    }),

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
      if (args.label) rows = rows.filter((x) => (x.labels || []).some((l) => l.normalize("NFKC").toLowerCase() === String(args.label).normalize("NFKC").toLowerCase()));
      if (args.month) rows = rows.filter((x) => x.date.startsWith(String(args.month)));
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

  /** 便 C：手で上げる。始める（同じファイルの書きかけがあれば続きを返す） */
  uploadStart: (env, b = {}, by = "") =>
    safe(() => zoom(env).upload_start({
      file_name: String(b.file_name || ""), size: Number(b.size), date: String(b.date || ""), title: String(b.title || ""),
      kai: KAIS.includes(b.kai) ? b.kai : "その他", labels: Array.isArray(b.labels) ? b.labels.slice(0, 20).map(String) : [], by,
    })),
  /** 1 片（届いた本文の流れをそのまま渡す） */
  uploadPart: (env, id, n, body) => safe(() => zoom(env).upload_part(String(id || ""), Number(n), body)),
  uploadComplete: (env, id) => safe(() => zoom(env).upload_complete(String(id || ""))),
  uploadAbort: (env, id) => safe(() => zoom(env).upload_abort(String(id || ""))),

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
        if (Array.isArray(m.labels_add)) o.labels_add = m.labels_add.slice(0, 20).map(String);
        if (Array.isArray(m.labels_remove)) o.labels_remove = m.labels_remove.slice(0, 20).map(String);
        return o;
      });
      if (!list.length) return { ok: false, error: "items_required" };
      return zoom(env).meta_set(list);
    }),

  /** ラベルの名前を変える（action: rename・from・to）・削除（action: delete・from） */
  labels: (env, { action, from, to } = {}) =>
    safe(() => {
      if (!["rename", "delete"].includes(action)) return { ok: false, error: "bad_action" };
      return zoom(env).labels_edit({ action, from: String(from || ""), ...(action === "rename" ? { to: String(to || "") } : {}) });
    }),

  /** 出し先のスイッチ：YouTube・会員サイト・入れるコース（reset で会の種類からの値に戻す） */
  routeSet: (env, id, b = {}) =>
    safe(() => {
      const o = {};
      if (typeof b.youtube === "boolean") o.youtube = b.youtube;
      if (typeof b.site === "boolean") o.site = b.site;
      if (b.course_id !== undefined) o.course_id = b.course_id === null ? null : String(b.course_id);
      if (b.reset === true) o.reset = true;
      return zoom(env).route_set(String(id || ""), o);
    }),

  /** 会の種類ごとの入れ先のコース（読む・変える）。コースの一覧も返す */
  routeConfig: (env, site) =>
    safe(async () => {
      const [c, t] = await Promise.all([zoom(env).route_config(), site.tree(env)]);
      if (!c.ok) return c;
      return { ...c, kais: KAIS, course_list: coursePaths(t) };
    }),
  routeConfigSet: (env, courses) => safe(() => zoom(env).route_config_set(courses && typeof courses === "object" ? courses : {})),

  /**
   * スイッチで「会員サイトに入れる」がオンの録画を、会員サイトに下書きで入れ、Naoki にメールで知らせる（1 時間ごと・画面の「今すぐ通す」）。
   * YouTube もオンの録画は、YouTube に上がるまで待ち、上がったら YouTube の埋め込みを先に出す形で入れる。
   * すでに同じコースに入っている録画は、入れ直さずに印だけ付ける。1 回に多くて 10 本。
   */
  routeRun: (env, site, notify) =>
    safe(async () => {
      const [shelf, cfg] = await Promise.all([zoom(env).shelf(), zoom(env).route_config()]);
      if (!shelf.ok) return shelf;
      const courses = (cfg && cfg.courses) || {};
      const todo = shelf.rows.filter((r) => r.route && r.route.site && !r.route.done_at);
      const res = { ok: true, looked: todo.length, put: 0, already: 0, waiting_youtube: 0, no_course: 0, failed: 0, notes: [] };
      if (!todo.length) return res;
      const t = await site.tree(env);
      const paths = new Map(coursePaths(t).map((c) => [c.id, c.path]));
      const origin = env.PUBLIC_ORIGIN || "https://lab.shia2n.jp";
      let n = 0;
      for (const r of todo) {
        if (n >= 10) break;
        if (r.route.youtube && r.route.youtube_possible && !r.youtube_url) { res.waiting_youtube++; continue; }
        const course = r.route.course_id || courses[r.kai] || "";
        if (!course || !paths.has(course)) { res.no_course++; continue; }
        n++;
        const had = t.contents.find((c) => c.rec_id === r.id && c.active !== false && t.links.some((l) => l.content_id === c.id && l.course_id === course));
        let contentId = had ? had.id : "";
        if (!had) {
          const p = await recordings.putInSite(env, site, "auto:録画の棚", { id: r.id, course_id: course, status: "draft", video_url: r.route.youtube ? r.youtube_url : "" });
          if (!p.ok) { res.failed++; res.notes.push(`${r.title}：${p.error || "入れられなかった"}`); continue; }
          contentId = p.content_id;
          res.put++;
        } else res.already++;
        const video = r.route.youtube && r.youtube_url ? `YouTube（限定公開）を埋め込み\n${r.youtube_url}` : "録画の棚（R2）から流す";
        const text = [
          had ? "録画は、すでに会員サイトに入っていました（入れ直していません）。" : "録画を会員サイトに下書きで入れました。生徒にはまだ見えません。",
          "",
          `録画：${r.title}`,
          `入れた先：${paths.get(course)}`,
          `動画：${video}`,
          "",
          "公開する（録画の詳細の「会員サイト」から公開を押す）：",
          `${origin}/admin#recording/${encodeURIComponent(r.id)}`,
        ].join("\n");
        try { if (notify) await notify(env, { subject: `【マーケくん】会員サイトに入れました：${r.title}`.slice(0, 120), text }); } catch { /* 知らせが送れなくても印は付ける（入れ直さないため） */ }
        await zoom(env).route_done(r.id, contentId);
      }
      return res;
    }),

  suggest: (env, limit) => safe(() => zoom(env).suggest_kai(Math.max(1, Math.min(20, Number(limit) || 8)))),
};

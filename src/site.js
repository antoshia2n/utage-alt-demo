// 会員サイトの管理（2026-10-29 Naoki「OK」・会員サイトとマイページの 2 回目）。
//  ・表は supabase/b21_site_shape.sql と b22_site_publish.sql が正本：サイト › カリキュラム › プログラム › コース › コンテンツ。
//    名前は学ぶくんと同じ。権利はカリキュラムに付く。コンテンツは複数のコースに並べられる（中身は 1 つ）。
//  ・ここはシアニン用の画面（/api/admin/site/*）から呼ぶ。生徒が読む側は src/learn.js（見る表 b_site_rows・b_site_member_access）。
//  ・デモの置き場（B_STORE が無い）には表が無いので、読む・書くとも demo_store を返す。
//  ・受講生は読むだけ。人の情報の正本は顧客管理としあらぼ管理、開け閉めは権利だけ。

export const STATUSES = ["published", "draft", "scheduled", "drip"];
const KEY_RE = /^[a-z0-9_]{2,40}$/;
const ID_RE = /^[0-9a-z_-]{2,40}$/i;
const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const LIST_MAX = 60;

const T = {
  sites: "b_site_sites", curricula: "b_site_curricula", cprog: "b_site_curriculum_programs", rights: "b_site_curriculum_rights",
  programs: "b_site_programs", courses: "b_site_courses", contents: "b_site_contents", links: "b_site_content_courses",
};
const CONTENT_LIST = "id,title,summary,status,active,publish_at,drip_days,minutes,video_url,can_ask,files,updated_at";
const CONTENT_FULL = CONTENT_LIST + ",toc,body";
const inList = (ids) => `in.(${ids.map((x) => `"${encodeURIComponent(String(x))}"`).join(",")})`;
const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").trim().slice(0, max);

// コンテンツの欄を確かめて整える（画面から来た値）。返すのは { ok, row } か { ok:false, error, field }
export function checkContent(b = {}) {
  const title = str(b.title, TITLE_MAX);
  if (!title) return { ok: false, error: "title_required", field: "title" };
  const status = STATUSES.includes(b.status) ? b.status : "draft";
  let publish_at = null, drip_days = null;
  if (status === "scheduled") {
    const t = Date.parse(b.publish_at || "");
    if (!Number.isFinite(t)) return { ok: false, error: "publish_at_required", field: "publish_at" };
    publish_at = new Date(t).toISOString();
  }
  if (status === "drip") {
    const d = Number(b.drip_days);
    if (!Number.isInteger(d) || d < 0 || d > 3650) return { ok: false, error: "bad_drip_days", field: "drip_days" };
    drip_days = d;
  }
  const m = b.minutes === "" || b.minutes == null ? null : Number(b.minutes);
  if (m != null && (!Number.isInteger(m) || m < 0 || m > 1440)) return { ok: false, error: "bad_minutes", field: "minutes" };
  const video_url = str(b.video_url, 500) || null;
  if (video_url && !/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(video_url)) return { ok: false, error: "bad_video_url", field: "video_url" };
  const toc = [];
  for (const r of Array.isArray(b.toc) ? b.toc.slice(0, LIST_MAX) : []) {
    const at = str(r && r.at, 10), label = str(r && r.label, 200);
    if (!at && !label) continue;
    if (!/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(at)) return { ok: false, error: "bad_toc_time", field: "toc" };
    toc.push({ at, label });
  }
  const files = [];
  for (const r of Array.isArray(b.files) ? b.files.slice(0, LIST_MAX) : []) {
    const label = str(r && r.label, 200), url = str(r && r.url, 1000);
    if (!label && !url) continue;
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return { ok: false, error: "bad_file_url", field: "files" };
    files.push({ label: label || url, url });
  }
  return {
    ok: true,
    row: { title, summary: str(b.summary, TEXT_MAX), status, publish_at, drip_days, minutes: m, video_url, toc, files, can_ask: b.can_ask !== false, active: true },
  };
}

// ある人が、そのプログラムの「入会から日数で開く」コンテンツを今見られるか
export function dripOpen(row, openedAt, at = Date.now()) {
  if (row.status !== "drip") return true;
  const t = Date.parse(openedAt || "");
  if (!Number.isFinite(t)) return false;
  return t + (Number(row.drip_days) || 0) * 864e5 <= at;
}

export function makeSite({ db }) {
  const demo = (env) => (!env.B_STORE ? { ok: false, error: "demo_store" } : null);
  const get = (env, q) => db(env, "GET", q);
  const newId = () => crypto.randomUUID();

  // 画面に要るものをまとめて返す（本文と目次は 1 本を開くときに読む）
  async function tree(env) {
    const d = demo(env); if (d) return d;
    const [sites, curricula, cprog, rights, programs, courses, contents, links] = await Promise.all([
      get(env, `${T.sites}?select=id,name,description,active,sort&order=sort.asc`),
      get(env, `${T.curricula}?select=id,site_id,title,description,active,sort&order=sort.asc`),
      get(env, `${T.cprog}?select=curriculum_id,program_id,sort&order=sort.asc&limit=5000`),
      get(env, `${T.rights}?select=curriculum_id,entitlement_key&limit=5000`),
      get(env, `${T.programs}?select=id,site_id,title,description,active,sort&order=sort.asc&limit=5000`),
      get(env, `${T.courses}?select=id,program_id,title,description,active,sort&order=sort.asc&limit=5000`),
      get(env, `${T.contents}?select=${CONTENT_LIST}&limit=10000`),
      get(env, `${T.links}?select=content_id,course_id,sort&order=sort.asc&limit=20000`),
    ]);
    return { ok: true, sites, curricula, cprog, rights, programs, courses, contents, links };
  }

  async function content(env, id) {
    const d = demo(env); if (d) return d;
    if (!ID_RE.test(String(id || ""))) return { ok: false, error: "bad_id" };
    const [row] = await get(env, `${T.contents}?select=${CONTENT_FULL}&id=eq.${encodeURIComponent(id)}`);
    if (!row) return { ok: false, error: "not_found" };
    const links = await get(env, `${T.links}?select=course_id,sort&content_id=eq.${encodeURIComponent(id)}`);
    return { ok: true, content: row, courses: links.map((l) => l.course_id) };
  }

  async function saveSite(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const name = str(b.name, 100);
    if (!name) return { ok: false, error: "name_required", field: "name" };
    if (!ID_RE.test(String(b.id || ""))) return { ok: false, error: "bad_id" };
    const rows = await db(env, "PATCH", `${T.sites}?id=eq.${encodeURIComponent(b.id)}`, { name, description: str(b.description, TEXT_MAX), active: b.active !== false, updated_at: now(), updated_by: by });
    return rows.length ? { ok: true, site: rows[0] } : { ok: false, error: "not_found" };
  }

  async function saveCurriculum(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const title = str(b.title, TITLE_MAX);
    if (!title) return { ok: false, error: "title_required", field: "title" };
    const fields = { title, description: str(b.description, TEXT_MAX), active: b.active !== false, updated_at: now(), updated_by: by };
    let id = b.id;
    if (id) {
      if (!ID_RE.test(String(id))) return { ok: false, error: "bad_id" };
      const rows = await db(env, "PATCH", `${T.curricula}?id=eq.${encodeURIComponent(id)}`, fields);
      if (!rows.length) return { ok: false, error: "not_found" };
    } else {
      if (!ID_RE.test(String(b.site_id || ""))) return { ok: false, error: "bad_site" };
      id = newId();
      const all = await get(env, `${T.curricula}?select=sort&site_id=eq.${encodeURIComponent(b.site_id)}`);
      await db(env, "POST", T.curricula, [{ id, site_id: b.site_id, sort: all.reduce((a, r) => Math.max(a, r.sort || 0), 0) + 1, ...fields, active: b.active === true }], "return=minimal");
    }
    if (Array.isArray(b.programs)) {
      const ids = [...new Set(b.programs.map(String))];
      if (ids.some((x) => !ID_RE.test(x))) return { ok: false, error: "bad_program" };
      await db(env, "DELETE", `${T.cprog}?curriculum_id=eq.${encodeURIComponent(id)}`);
      if (ids.length) await db(env, "POST", T.cprog, ids.map((program_id, i) => ({ curriculum_id: id, program_id, sort: i })), "return=minimal");
    }
    if (Array.isArray(b.rights)) {
      const keys = [...new Set(b.rights.map(String))];
      if (keys.some((k) => !KEY_RE.test(k))) return { ok: false, error: "bad_key" };
      await db(env, "DELETE", `${T.rights}?curriculum_id=eq.${encodeURIComponent(id)}`);
      if (keys.length) await db(env, "POST", T.rights, keys.map((entitlement_key) => ({ curriculum_id: id, entitlement_key })), "return=minimal");
    }
    return { ok: true, id };
  }

  async function saveProgram(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const title = str(b.title, TITLE_MAX);
    if (!title) return { ok: false, error: "title_required", field: "title" };
    const fields = { title, description: str(b.description, TEXT_MAX), active: b.active !== false, updated_at: now(), updated_by: by };
    if (b.id) {
      if (!ID_RE.test(String(b.id))) return { ok: false, error: "bad_id" };
      const rows = await db(env, "PATCH", `${T.programs}?id=eq.${encodeURIComponent(b.id)}`, fields);
      return rows.length ? { ok: true, id: b.id } : { ok: false, error: "not_found" };
    }
    if (!ID_RE.test(String(b.site_id || ""))) return { ok: false, error: "bad_site" };
    const id = newId();
    const all = await get(env, `${T.programs}?select=sort&site_id=eq.${encodeURIComponent(b.site_id)}`);
    await db(env, "POST", T.programs, [{ id, site_id: b.site_id, sort: all.reduce((a, r) => Math.max(a, r.sort || 0), 0) + 1, ...fields, active: b.active === true }], "return=minimal");
    const courses = (Array.isArray(b.courses) ? b.courses : []).map((t) => str(t, TITLE_MAX)).filter(Boolean).slice(0, 20);
    if (courses.length) await db(env, "POST", T.courses, courses.map((t, i) => ({ id: newId(), program_id: id, title: t, sort: i, active: true, updated_by: by })), "return=minimal");
    if (b.curriculum_id) {
      if (!ID_RE.test(String(b.curriculum_id))) return { ok: false, error: "bad_curriculum" };
      const cp = await get(env, `${T.cprog}?select=sort&curriculum_id=eq.${encodeURIComponent(b.curriculum_id)}`);
      await db(env, "POST", T.cprog, [{ curriculum_id: b.curriculum_id, program_id: id, sort: cp.reduce((a, r) => Math.max(a, r.sort || 0), -1) + 1 }], "return=minimal");
    }
    return { ok: true, id };
  }

  async function saveCourse(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const title = str(b.title, TITLE_MAX);
    if (!title) return { ok: false, error: "title_required", field: "title" };
    const fields = { title, active: b.active !== false, updated_at: now(), updated_by: by };
    if (b.id) {
      if (!ID_RE.test(String(b.id))) return { ok: false, error: "bad_id" };
      const rows = await db(env, "PATCH", `${T.courses}?id=eq.${encodeURIComponent(b.id)}`, fields);
      return rows.length ? { ok: true, id: b.id } : { ok: false, error: "not_found" };
    }
    if (!ID_RE.test(String(b.program_id || ""))) return { ok: false, error: "bad_program" };
    const id = newId();
    const all = await get(env, `${T.courses}?select=sort&program_id=eq.${encodeURIComponent(b.program_id)}`);
    await db(env, "POST", T.courses, [{ id, program_id: b.program_id, sort: all.reduce((a, r) => Math.max(a, r.sort || 0), -1) + 1, ...fields }], "return=minimal");
    return { ok: true, id };
  }

  // プログラムの中のコースの並び
  async function orderCourses(env, { program_id, course_ids } = {}) {
    const d = demo(env); if (d) return d;
    const ids = Array.isArray(course_ids) ? course_ids.map(String) : [];
    if (!ID_RE.test(String(program_id || "")) || ids.some((x) => !ID_RE.test(x))) return { ok: false, error: "bad_id" };
    const have = await get(env, `${T.courses}?select=id&program_id=eq.${encodeURIComponent(program_id)}`);
    const set = new Set(have.map((r) => r.id));
    if (ids.length !== set.size || ids.some((x) => !set.has(x))) return { ok: false, error: "list_mismatch" };
    for (let i = 0; i < ids.length; i++) await db(env, "PATCH", `${T.courses}?id=eq.${encodeURIComponent(ids[i])}`, { sort: i }, "return=minimal");
    return { ok: true };
  }

  // コースに並ぶコンテンツを、渡した並びにそろえる（並べ替え・外す・移すに使う）。並びに無いものは、このコースから外れるだけで消えない
  async function setCourseContents(env, { course_id, content_ids } = {}) {
    const d = demo(env); if (d) return d;
    const ids = [...new Set((Array.isArray(content_ids) ? content_ids : []).map(String))];
    if (!ID_RE.test(String(course_id || "")) || ids.some((x) => !ID_RE.test(x))) return { ok: false, error: "bad_id" };
    const cur = await get(env, `${T.links}?select=content_id&course_id=eq.${encodeURIComponent(course_id)}`);
    const drop = cur.map((r) => r.content_id).filter((x) => !ids.includes(x));
    if (drop.length) await db(env, "DELETE", `${T.links}?course_id=eq.${encodeURIComponent(course_id)}&content_id=${inList(drop)}`);
    if (ids.length) await db(env, "POST", `${T.links}?on_conflict=content_id,course_id`, ids.map((content_id, i) => ({ content_id, course_id, sort: i })), "resolution=merge-duplicates,return=minimal");
    return { ok: true };
  }

  // コンテンツ 1 本を作る・直す。courses（所属するコースの番号の並び）を渡すと、所属をそれにそろえる（新しく入るコースでは末尾に並ぶ）
  async function saveContent(env, b = {}, by) {
    const d = demo(env); if (d) return d;
    const c = checkContent(b);
    if (!c.ok) return c;
    const courses = Array.isArray(b.courses) ? [...new Set(b.courses.map(String))] : null;
    if (courses && !courses.length) return { ok: false, error: "course_required", field: "courses" };
    if (courses && courses.some((x) => !ID_RE.test(x))) return { ok: false, error: "bad_course" };
    let id = b.id;
    if (id) {
      if (!ID_RE.test(String(id))) return { ok: false, error: "bad_id" };
      const rows = await db(env, "PATCH", `${T.contents}?id=eq.${encodeURIComponent(id)}`, { ...c.row, updated_at: now(), updated_by: by });
      if (!rows.length) return { ok: false, error: "not_found" };
    } else {
      if (!courses) return { ok: false, error: "course_required", field: "courses" };
      id = newId();
      await db(env, "POST", T.contents, [{ id, ...c.row, content_type: c.row.video_url ? "video" : "text", updated_by: by }], "return=minimal");
    }
    if (courses) {
      const cur = await get(env, `${T.links}?select=course_id&content_id=eq.${encodeURIComponent(id)}`);
      const have = cur.map((r) => r.course_id);
      const drop = have.filter((x) => !courses.includes(x));
      if (drop.length) await db(env, "DELETE", `${T.links}?content_id=eq.${encodeURIComponent(id)}&course_id=${inList(drop)}`);
      for (const course_id of courses.filter((x) => !have.includes(x))) {
        const inCourse = await get(env, `${T.links}?select=sort&course_id=eq.${encodeURIComponent(course_id)}`);
        await db(env, "POST", T.links, [{ content_id: id, course_id, sort: inCourse.reduce((a, r) => Math.max(a, r.sort || 0), -1) + 1 }], "return=minimal");
      }
    }
    return { ok: true, id };
  }

  // 何本かの公開のしかたをまとめて変える（公開にする・下書きに戻す）
  async function setStatus(env, { ids, status } = {}, by) {
    const d = demo(env); if (d) return d;
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!list.length || list.length > 500 || list.some((x) => !ID_RE.test(x))) return { ok: false, error: "bad_ids" };
    if (status !== "published" && status !== "draft") return { ok: false, error: "bad_status" };
    await db(env, "PATCH", `${T.contents}?id=${inList(list)}`, { status, active: true, publish_at: null, drip_days: null, updated_at: now(), updated_by: by }, "return=minimal");
    return { ok: true, count: list.length };
  }

  // 受講生（読むだけ）：カリキュラムを開ける権利を今持っている人
  async function studentsOf(env, { names } = {}) {
    const d = demo(env); if (d) return d;
    const rights = await get(env, `${T.rights}?select=curriculum_id,entitlement_key&limit=5000`);
    const keys = [...new Set(rights.map((r) => r.entitlement_key))];
    if (!keys.length) return { ok: true, students: [] };
    const ents = await get(env, `member_entitlement?select=member_id,key,granted_at,expires_at&key=${inList(keys)}&limit=10000`);
    const t = Date.now();
    const live = ents.filter((e) => !e.expires_at || Date.parse(e.expires_at) > t);
    const ids = [...new Set(live.map((e) => e.member_id))];
    const people = [];
    for (let i = 0; i < ids.length; i += 100) {
      people.push(...await get(env, `customers?select=id,email,name&id=${inList(ids.slice(i, i + 100))}&limit=1000`));
    }
    const viewed = await get(env, "events?select=customer_id,payload,occurred_at&type=eq.lesson_viewed&order=occurred_at.desc&limit=20000");
    const last = new Map(), seen = new Map();
    for (const v of viewed) {
      if (!last.has(v.customer_id)) last.set(v.customer_id, v.occurred_at);
      const lid = v.payload && v.payload.lesson_id;
      if (lid) (seen.get(v.customer_id) || seen.set(v.customer_id, new Set()).get(v.customer_id)).add(lid);
    }
    const byId = new Map(people.map((p) => [p.id, p]));
    const students = ids.map((id) => {
      const p = byId.get(id) || {};
      const mine = live.filter((e) => e.member_id === id);
      const email = String(p.email || "").toLowerCase();
      return {
        id, email, name: (names && names.get(email)) || p.name || "",
        rights: [...new Set(mine.map((e) => e.key))],
        curricula: [...new Set(rights.filter((r) => mine.some((e) => e.key === r.entitlement_key)).map((r) => r.curriculum_id))],
        since: mine.reduce((a, e) => (!a || e.granted_at < a ? e.granted_at : a), null),
        last_viewed_at: last.get(id) || null,
        viewed_ids: seen.has(id) ? [...seen.get(id)] : [],
      };
    });
    students.sort((a, b) => String(b.last_viewed_at || "").localeCompare(String(a.last_viewed_at || "")) || a.name.localeCompare(b.name, "ja"));
    return { ok: true, students };
  }

  // 動画の住所からまとめて作る：1 本ずつ下書きのコンテンツにし、コースの末尾に並べる。題名は YouTube の oEmbed から読む（読めなければ仮の題名）
  async function fromVideos(env, { course_id, urls } = {}, by, fetcher = fetch) {
    const d = demo(env); if (d) return d;
    if (!ID_RE.test(String(course_id || ""))) return { ok: false, error: "bad_course" };
    const list = (Array.isArray(urls) ? urls : []).map((u) => String(u).trim()).filter(Boolean);
    if (!list.length || list.length > 30) return { ok: false, error: "bad_urls" };
    if (list.some((u) => !/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u))) return { ok: false, error: "bad_urls" };
    const titles = await Promise.all(list.map(async (u, i) => {
      try {
        const r = await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`);
        if (r.ok) { const j = await r.json(); if (j && j.title) return str(j.title, TITLE_MAX); }
      } catch { /* 読めなければ仮の題名 */ }
      return `新しいコンテンツ ${i + 1}`;
    }));
    const inCourse = await get(env, `${T.links}?select=sort&course_id=eq.${encodeURIComponent(course_id)}`);
    let sort = inCourse.reduce((a, r) => Math.max(a, r.sort || 0), -1) + 1;
    const rows = list.map((u, i) => ({ id: newId(), title: titles[i], summary: "", status: "draft", active: true, video_url: u, content_type: "video", toc: [], files: [], can_ask: true, updated_by: by }));
    await db(env, "POST", T.contents, rows, "return=minimal");
    await db(env, "POST", T.links, rows.map((r) => ({ content_id: r.id, course_id, sort: sort++ })), "return=minimal");
    return { ok: true, count: rows.length, ids: rows.map((r) => r.id) };
  }

  return { tree, content, fromVideos, saveSite, saveCurriculum, saveProgram, saveCourse, orderCourses, setCourseContents, saveContent, setStatus, studentsOf };
}

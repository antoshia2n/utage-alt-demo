// 便 12a：試験で使う PostgREST の真似（eq・is.null・not.is.null・in・gte・lte・payload->>・or・order・limit・on_conflict）。
// pages.test.mjs と pages-host.test.mjs で使う
export function fakeStore() {
  const t = {};
  let seq = 100;
  const table = (n) => (t[n] = t[n] || []);
  const val = (row, k) => {
    const m = k.match(/^(\w+)->>(\w+)$/);
    if (m) { const o = row[m[1]]; return o == null || o[m[2]] == null ? null : String(o[m[2]]); }
    return row[k];
  };
  const test1 = (row, k, v) => {
    const x = val(row, k);
    if (v === "is.null") return x == null;
    if (v === "not.is.null") return x != null;
    if (v.startsWith("eq.")) return x != null && String(x) === v.slice(3);
    if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(x));
    if (v.startsWith("gte.")) return x != null && String(x) >= v.slice(4);
    if (v.startsWith("lte.")) return x != null && String(x) <= v.slice(4);
    throw new Error("fake: 知らない条件 " + k + "=" + v);
  };
  const parse = (pq) => {
    const [name, qs = ""] = pq.split("?");
    const conds = []; let onConflict = null, order = null, limit = null;
    for (const part of qs.split("&").filter(Boolean)) {
      const i = part.indexOf("=");
      const k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
      if (k === "select") continue;
      if (k === "order") { order = v; continue; }
      if (k === "limit") { limit = Number(v); continue; }
      if (k === "on_conflict") { onConflict = v.split(","); continue; }
      conds.push([k, v]);
    }
    return { name, conds, onConflict, order, limit };
  };
  const hit = (row, conds) => conds.every(([k, v]) => {
    if (k === "or") return v.slice(1, -1).split(",").some((c) => { const [a, op, ...rest] = c.split("."); return test1(row, a, op + "." + rest.join(".")); });
    return test1(row, k, v);
  });
  async function db(env, method, pq, body, prefer = "") {
    const { name, conds, onConflict, order, limit } = parse(pq);
    const rows = table(name);
    if (method === "GET") {
      let out = rows.filter((r) => hit(r, conds)).map((r) => structuredClone(r));
      if (order) {
        const [k, dir] = order.split(",")[0].split(".");
        out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "desc" ? -1 : 1));
      }
      return limit ? out.slice(0, limit) : out;
    }
    if (method === "POST") {
      const out = [];
      for (const b of (Array.isArray(body) ? body : [body])) {
        if (onConflict) {
          const ex = rows.find((r) => onConflict.every((c) => r[c] === b[c]));
          if (ex) { if (!String(prefer).includes("ignore")) Object.assign(ex, b); out.push(ex); continue; }
        }
        const row = { ...b };
        if (row.id == null && name !== "b_page_versions") row.id = name === "b_pages" ? crypto.randomUUID() : seq++;
        if (name === "b_page_hits") row.at = row.at || new Date().toISOString();
        if (name === "b_page_requests") row.created_at = new Date().toISOString();
        if (name === "b_page_versions") row.created_at = new Date().toISOString();
        if (name === "b_pages") Object.assign(row, { created_at: new Date().toISOString(), updated_at: row.updated_at || new Date().toISOString(), published_version: row.published_version ?? null, status: row.status || "draft" }, b);
        if (name === "events" || name === "b_events") row.occurred_at = row.occurred_at || new Date(Date.now() + seq).toISOString();
        rows.push(row); out.push(row);
      }
      return String(prefer).includes("minimal") ? null : out.map((r) => structuredClone(r));
    }
    if (method === "PATCH") { const out = rows.filter((r) => hit(r, conds)); out.forEach((r) => Object.assign(r, body)); return String(prefer).includes("minimal") ? null : out.map((r) => structuredClone(r)); }
    if (method === "DELETE") { const keep = rows.filter((r) => !hit(r, conds)); t[name] = keep; return null; }
    throw new Error("unknown " + method);
  }
  return { t, db, table };
}


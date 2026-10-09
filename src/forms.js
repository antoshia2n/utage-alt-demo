// B の便 11a：人の項目とフォーム（2026-10-09 Naoki「進めて」）。
// 表は 4 本（supabase/b11a_forms.sql）。
//   b_fields        … 人の項目の決め（key・名前・型・選択肢）。項目を足すのにコードの直しは要らない
//   b_forms         … フォーム（題名・住所の名前 slug・並べる項目・公開中か）。公開の住所は /form?f=slug
//   b_answers       … フォームの回答（いつ・誰が・何と答えたか）。月次アンケートのように毎月の答えが履歴で残る
//   b_person_values … 人ごとの項目の最新の値。回答が来るたびに上書きする。配信の宛先の条件はこれを見る
// 回答が来たら、出来事 form_submitted（form_id・slug・answer_id）を人の行に積む（設計図とラベルの材料）。
// フォームから来た人がまだ台帳にいなければ、無料登録と同じ道（registerPerson）で台帳に入れる。

export const FIELD_TYPES = { text: "1 行の文字", textarea: "長い文", number: "数", date: "日付", select: "選ぶ" };
export const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_FIELDS = 30;
const MAX_TEXT = { text: 200, textarea: 4000, number: 30, date: 10, select: 200 };
export const FIELD_OPS = ["eq", "contains", "gte", "lte", "empty", "not_empty"];

// 1 つの答えを型どおりに直す。合わなければ { error } を返す
export function cleanValue(field, raw) {
  if (raw === undefined || raw === null) return { value: "" };
  let v = String(raw).trim();
  if (!v) return { value: "" };
  if (v.length > (MAX_TEXT[field.type] || 200)) return { error: "too_long" };
  if (field.type === "number") {
    const n = Number(v.replace(/[,，円¥\s]/g, ""));
    if (!Number.isFinite(n)) return { error: "not_number" };
    return { value: String(n) };
  }
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + "T00:00:00Z").getTime())) return { error: "not_date" };
    return { value: v };
  }
  if (field.type === "select") {
    const opts = Array.isArray(field.options) ? field.options.map(String) : [];
    if (!opts.includes(v)) return { error: "not_option" };
  }
  return { value: v };
}

// 宛先の条件 fields：[{ key, op, value }]。値は人の最新の値（b_person_values）で比べる
export function normFieldConds(list) {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const out = [];
  for (const c of arr.slice(0, 10)) {
    if (!c || !KEY_RE.test(String(c.key || "")) || !FIELD_OPS.includes(c.op)) continue;
    const item = { key: String(c.key), op: c.op };
    if (!["empty", "not_empty"].includes(c.op)) item.value = String(c.value ?? "").slice(0, 200);
    out.push(item);
  }
  return out;
}
export function matchField(value, cond) {
  const v = value == null ? "" : String(value);
  if (cond.op === "empty") return v === "";
  if (cond.op === "not_empty") return v !== "";
  if (v === "") return false;
  if (cond.op === "eq") return v === cond.value;
  if (cond.op === "contains") return v.includes(cond.value);
  const a = Number(v), b = Number(cond.value);
  if (Number.isFinite(a) && Number.isFinite(b)) return cond.op === "gte" ? a >= b : a <= b;
  return cond.op === "gte" ? v >= cond.value : v <= cond.value; // 日付（YYYY-MM-DD）は文字の比べで足りる
}

export function makeForms(h) {
  const { db, addEvent, logInbound, registerPerson } = h;
  const now = () => new Date().toISOString();

  async function listFields(env, { include_archived } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, fields: [], types: FIELD_TYPES };
    let q = "b_fields?select=*&order=sort.asc,created_at.asc";
    if (!include_archived) q += "&archived_at=is.null";
    const fields = await db(env, "GET", q);
    return { ok: true, count: fields.length, fields, types: FIELD_TYPES };
  }

  async function setField(env, args = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const key = String(args.key || "").trim();
    if (!KEY_RE.test(key)) return { ok: false, error: "bad_key", note: "英小文字で始まり、英小文字・数字・下線の 2〜31 字" };
    const [cur] = await db(env, "GET", `b_fields?select=*&key=eq.${key}`);
    const row = { updated_at: now(), updated_by: by };
    if ("label" in args || !cur) {
      const label = String(args.label || "").trim();
      if (!label || label.length > 40) return { ok: false, error: "bad_label" };
      row.label = label;
    }
    if ("type" in args || !cur) {
      if (!FIELD_TYPES[args.type]) return { ok: false, error: "bad_type", types: Object.keys(FIELD_TYPES) };
      if (cur && cur.type !== args.type) return { ok: false, error: "type_locked", note: "型はあとから変えられない（答えの意味が変わるため）。別の項目を足す" };
      row.type = args.type;
    }
    const type = row.type || cur.type;
    if ("options" in args) {
      const opts = (Array.isArray(args.options) ? args.options : String(args.options || "").split(/[\n,、]/)).map((x) => String(x).trim()).filter(Boolean);
      if (type === "select" && !opts.length) return { ok: false, error: "need_options" };
      if (opts.length > 30 || opts.some((x) => x.length > 60)) return { ok: false, error: "bad_options" };
      row.options = [...new Set(opts)];
    } else if (!cur && type === "select") return { ok: false, error: "need_options" };
    if ("sort" in args) row.sort = Number.parseInt(args.sort, 10) || 0;
    if ("archived" in args) row.archived_at = args.archived ? now() : null;
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_fields?key=eq.${key}`, row, "return=representation");
    else [out] = await db(env, "POST", "b_fields", [{ key, options: [], sort: 0, ...row }], "return=representation");
    await logInbound(env, "change", { kind: "field", key, before: cur || null, after: out, by }, { ok: true }, 200);
    return { ok: true, created: !cur, field: out };
  }

  async function fieldMap(env) {
    const rows = await db(env, "GET", "b_fields?select=*");
    return new Map(rows.map((f) => [f.key, f]));
  }

  // フォームに並べる項目の形をそろえる（無い項目・しまった項目は外す）
  function shapeItems(items, fm) {
    const arr = Array.isArray(items) ? items : [];
    const seen = new Set();
    const out = [];
    for (const it of arr.slice(0, MAX_FIELDS)) {
      const key = String(it && it.key || "");
      const f = fm.get(key);
      if (!f || f.archived_at || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, required: !!(it && it.required) });
    }
    return out;
  }

  async function listForms(env, { origin = "" } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, forms: [] };
    const forms = await db(env, "GET", "b_forms?select=*&order=created_at.desc");
    const ans = await db(env, "GET", "b_answers?select=form_id,submitted_at&limit=20000");
    for (const f of forms) {
      const mine = ans.filter((a) => a.form_id === f.id);
      f.answers = mine.length;
      f.last_answer_at = mine.reduce((m, a) => (a.submitted_at > m ? a.submitted_at : m), "") || null;
      f.url = (origin || "") + "/form?f=" + f.slug;
    }
    return { ok: true, count: forms.length, forms };
  }

  async function setForm(env, args = {}, by = "admin") {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const fm = await fieldMap(env);
    let cur = null;
    if (args.id) {
      if (!UUID_RE.test(String(args.id))) return { ok: false, error: "bad_id" };
      [cur] = await db(env, "GET", `b_forms?select=*&id=eq.${args.id}`);
      if (!cur) return { ok: false, error: "not_found" };
    }
    const row = { updated_at: now(), updated_by: by };
    if ("title" in args || !cur) {
      const t = String(args.title || "").trim();
      if (!t || t.length > 80) return { ok: false, error: "bad_title" };
      row.title = t;
    }
    if ("slug" in args || !cur) {
      const s = String(args.slug || "").trim().toLowerCase();
      if (!SLUG_RE.test(s)) return { ok: false, error: "bad_slug", note: "英小文字・数字・ハイフンの 2〜41 字" };
      const dup = await db(env, "GET", `b_forms?select=id&slug=eq.${s}`);
      if (dup.some((d) => !cur || d.id !== cur.id)) return { ok: false, error: "slug_taken" };
      row.slug = s;
    }
    for (const k of ["intro", "thanks"]) if (k in args) {
      const v = String(args[k] || "");
      if (v.length > 2000) return { ok: false, error: "too_long", field: k };
      row[k] = v;
    }
    if ("items" in args || "fields" in args) {
      const items = shapeItems(args.items || args.fields, fm);
      if (!items.length) return { ok: false, error: "need_items", note: "項目を 1 つ以上選ぶ（先に set_field で項目を作る）" };
      row.items = items;
    } else if (!cur) return { ok: false, error: "need_items" };
    if ("ask_name" in args) row.ask_name = !!args.ask_name;
    if ("active" in args) row.active = !!args.active;
    let out;
    if (cur) [out] = await db(env, "PATCH", `b_forms?id=eq.${cur.id}`, row, "return=representation");
    else [out] = await db(env, "POST", "b_forms", [{ intro: "", thanks: "", ask_name: true, active: false, ...row }], "return=representation");
    await logInbound(env, "change", { kind: "form", id: out.id, before: cur, after: out, by }, { ok: true }, 200);
    return { ok: true, created: !cur, form: out, url: "/form?f=" + out.slug };
  }

  // 公開の面：開いているフォームの中身（項目の名前・型・選択肢・必須）。人のことは何も返さない
  async function publicForm(env, slug) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const s = String(slug || "").toLowerCase();
    if (!SLUG_RE.test(s)) return { ok: false, error: "not_found" };
    const [f] = await db(env, "GET", `b_forms?select=id,slug,title,intro,thanks,items,ask_name,active&slug=eq.${s}`);
    if (!f || !f.active) return { ok: false, error: "not_found" };
    const fm = await fieldMap(env);
    const items = (f.items || []).map((it) => {
      const d = fm.get(it.key);
      return d && !d.archived_at ? { key: it.key, label: d.label, type: d.type, options: d.type === "select" ? d.options : undefined, required: !!it.required } : null;
    }).filter(Boolean);
    return { ok: true, form: { slug: f.slug, title: f.title, intro: f.intro, thanks: f.thanks, ask_name: f.ask_name, items } };
  }

  async function submit(env, slug, body = {}) {
    const pf = await publicForm(env, slug);
    if (!pf.ok) return pf;
    const form = pf.form;
    const [frow] = await db(env, "GET", `b_forms?select=id&slug=eq.${form.slug}`);
    const raw = body.answers && typeof body.answers === "object" ? body.answers : {};
    const values = {};
    const bad = [];
    for (const it of form.items) {
      const r = cleanValue(it, raw[it.key]);
      if (r.error) bad.push({ key: it.key, error: r.error });
      else if (it.required && r.value === "") bad.push({ key: it.key, error: "required" });
      else values[it.key] = r.value;
    }
    if (bad.length) return { ok: false, error: "bad_answers", fields: bad };
    // 便 12a：公開のページ（lp の住所）から来たときは、経路（route）とページ（page_id）も一緒に残す
    const fromPage = UUID_RE.test(String(body.page_id || "")) ? String(body.page_id) : undefined;
    const route = /^[\p{L}\p{N}][\p{L}\p{N}_\-ー・]{0,39}$/u.test(String(body.route || "")) ? String(body.route) : undefined; // pages.js の ROUTE_RE と同じ
    const reg = await registerPerson(env, { email: body.email, name: form.ask_name ? body.name : "", source: body.source, consent: body.consent, ref: body.ref, via: "form:" + form.slug, route, page_id: fromPage });
    if (!reg.ok) return reg;
    const [ans] = await db(env, "POST", "b_answers", [{ form_id: frow.id, customer_id: reg.id, answers: values }], "return=representation");
    const upserts = Object.entries(values).filter(([, v]) => v !== "").map(([key, value]) => ({ customer_id: reg.id, key, value, updated_at: now() }));
    if (upserts.length) await db(env, "POST", "b_person_values?on_conflict=customer_id,key", upserts, "resolution=merge-duplicates,return=minimal");
    await addEvent(env, reg.id, "form_submitted", { form_id: frow.id, slug: form.slug, title: form.title, answer_id: ans.id, ...(fromPage ? { page_id: fromPage } : {}), ...(route ? { route } : {}) }, "site");
    await logInbound(env, "form", { slug: form.slug, keys: Object.keys(values) }, { ok: true, is_new: reg.is_new, answer_id: ans.id }, 200);
    return { ok: true, thanks: form.thanks || "", is_new: reg.is_new, id: reg.id };
  }

  // 回答の一覧（フォームごと、または人ごと）。答えは項目の名前つきで返す
  async function listAnswers(env, { form_id, person_id, limit } = {}) {
    if (!env.B_STORE) return { ok: true, store: "demo", count: 0, answers: [] };
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    let q = `b_answers?select=*&order=submitted_at.desc&limit=${lim}`;
    if (form_id) { if (!UUID_RE.test(String(form_id))) return { ok: false, error: "bad_form_id" }; q += `&form_id=eq.${form_id}`; }
    if (person_id) { if (!UUID_RE.test(String(person_id))) return { ok: false, error: "bad_person_id" }; q += `&customer_id=eq.${person_id}`; }
    const rows = await db(env, "GET", q);
    const fm = await fieldMap(env);
    const forms = new Map((await db(env, "GET", "b_forms?select=id,title,slug")).map((f) => [f.id, f]));
    const ids = [...new Set(rows.map((r) => r.customer_id))];
    const people = ids.length ? new Map((await db(env, "GET", `customers?select=id,name,email&id=in.(${ids.join(",")})`)).map((p) => [p.id, p])) : new Map();
    const answers = rows.map((r) => ({
      id: r.id, submitted_at: r.submitted_at,
      form: forms.get(r.form_id) ? { id: r.form_id, title: forms.get(r.form_id).title } : { id: r.form_id, title: "（消えたフォーム）" },
      person: people.get(r.customer_id) ? { id: r.customer_id, name: people.get(r.customer_id).name, email: people.get(r.customer_id).email } : { id: r.customer_id },
      items: Object.entries(r.answers || {}).map(([key, value]) => ({ key, label: fm.get(key) ? fm.get(key).label : key, value })),
    }));
    return { ok: true, count: answers.length, answers };
  }

  // 人の 1 枚：項目の最新の値（項目の並び順）と、回答の履歴
  async function personValues(env, person_id) {
    if (!env.B_STORE) return { ok: true, store: "demo", values: [], answers: [] };
    if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
    const rows = await db(env, "GET", `b_person_values?select=key,value,updated_at&customer_id=eq.${person_id}`);
    const fields = (await db(env, "GET", "b_fields?select=*&order=sort.asc,created_at.asc"));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const values = fields.filter((f) => byKey.has(f.key)).map((f) => ({ key: f.key, label: f.label, type: f.type, value: byKey.get(f.key).value, updated_at: byKey.get(f.key).updated_at }));
    const answers = (await listAnswers(env, { person_id, limit: 50 })).answers || [];
    return { ok: true, values, answers };
  }

  // 宛先の絞り込み（deliver の audience から呼ぶ）
  async function filterByFields(env, people, conds) {
    if (!conds.length) return people;
    const keys = [...new Set(conds.map((c) => c.key))];
    const rows = await db(env, "GET", `b_person_values?select=customer_id,key,value&key=in.(${keys.join(",")})&limit=50000`);
    const map = new Map();
    for (const r of rows) { if (!map.has(r.customer_id)) map.set(r.customer_id, {}); map.get(r.customer_id)[r.key] = r.value; }
    return people.filter((p) => conds.every((c) => matchField((map.get(p.id) || {})[c.key], c)));
  }

  return { listFields, setField, listForms, setForm, publicForm, submit, listAnswers, personValues, filterByFields };
}

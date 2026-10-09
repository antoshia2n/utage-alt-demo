// 便 11a：人の項目とフォームの試験。表は手元の入れ物で真似る（PostgREST の eq・is.null・in だけ）。
// 走らせ方：node --test tests/forms.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeForms, cleanValue, normFieldConds, matchField } from "../src/forms.js";

function fakeDb() {
  const t = { b_fields: [], b_forms: [], b_answers: [], b_person_values: [], customers: [], events: [] };
  let seq = 1;
  const parse = (pq) => {
    const [table, qs = ""] = pq.split("?");
    const conds = [];
    let onConflict = null;
    for (const part of qs.split("&").filter(Boolean)) {
      const i = part.indexOf("=");
      const k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
      if (["select", "order", "limit"].includes(k)) continue;
      if (k === "on_conflict") { onConflict = v.split(","); continue; }
      conds.push([k, v]);
    }
    return { table, conds, onConflict };
  };
  const hit = (row, conds) => conds.every(([k, v]) => {
    if (v === "is.null") return row[k] == null;
    if (v.startsWith("eq.")) return String(row[k]) === v.slice(3);
    if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(row[k]));
    return true;
  });
  async function db(env, method, pq, body) {
    const { table, conds, onConflict } = parse(pq);
    const rows = t[table];
    if (method === "GET") return rows.filter((r) => hit(r, conds)).map((r) => ({ ...r }));
    if (method === "POST") {
      const out = [];
      for (const b of (Array.isArray(body) ? body : [body])) {
        if (onConflict) {
          const ex = rows.find((r) => onConflict.every((c) => r[c] === b[c]));
          if (ex) { Object.assign(ex, b); out.push(ex); continue; }
        }
        const row = { ...b };
        if (table === "b_forms" && !row.id) row.id = "00000000-0000-4000-8000-00000000000" + seq++;
        if (table === "b_answers") { row.id = seq++; row.submitted_at = new Date(Date.now() + seq).toISOString(); }
        rows.push(row); out.push(row);
      }
      return out.map((r) => ({ ...r }));
    }
    if (method === "PATCH") { const out = rows.filter((r) => hit(r, conds)); out.forEach((r) => Object.assign(r, body)); return out.map((r) => ({ ...r })); }
    throw new Error("unknown " + method);
  }
  return { t, db };
}

function setup() {
  const { t, db } = fakeDb();
  const env = { B_STORE: true };
  const forms = makeForms({
    db,
    addEvent: async (e, id, type, payload) => { t.events.push({ customer_id: id, type, payload }); },
    logInbound: async () => {},
    registerPerson: async (e, b) => {
      if (b.consent !== true) return { ok: false, error: "need_consent" };
      const email = String(b.email || "").toLowerCase();
      let c = t.customers.find((x) => x.email === email);
      if (!c) { c = { id: "11111111-1111-4111-8111-" + String(t.customers.length + 1).padStart(12, "0"), email, name: b.name || "" }; t.customers.push(c); return { ok: true, id: c.id, is_new: true }; }
      return { ok: true, id: c.id, is_new: false };
    },
  });
  return { t, env, forms };
}

test("答えを型どおりに直す", () => {
  assert.deepEqual(cleanValue({ type: "number" }, "¥120,000"), { value: "120000" });
  assert.equal(cleanValue({ type: "number" }, "たくさん").error, "not_number");
  assert.equal(cleanValue({ type: "date" }, "2026-10-31").value, "2026-10-31");
  assert.equal(cleanValue({ type: "date" }, "10/31").error, "not_date");
  assert.equal(cleanValue({ type: "select", options: ["A", "B"] }, "C").error, "not_option");
  assert.equal(cleanValue({ type: "text" }, "x".repeat(201)).error, "too_long");
  assert.deepEqual(cleanValue({ type: "text" }, "  "), { value: "" });
});

test("宛先の条件をそろえ、値で当てる", () => {
  assert.deepEqual(normFieldConds([{ key: "sales", op: "gte", value: 100000 }, { key: "Bad", op: "eq" }, { key: "x_account", op: "not_empty", value: "z" }]),
    [{ key: "sales", op: "gte", value: "100000" }, { key: "x_account", op: "not_empty" }]);
  assert.equal(matchField("150000", { op: "gte", value: "100000" }), true);
  assert.equal(matchField("90000", { op: "gte", value: "100000" }), false);
  assert.equal(matchField("", { op: "empty" }), true);
  assert.equal(matchField(undefined, { op: "eq", value: "a" }), false);
  assert.equal(matchField("2026-10-31", { op: "lte", value: "2026-11-01" }), true);
  assert.equal(matchField("@cyanine_x", { op: "contains", value: "cyan" }), true);
});

test("項目を足す：key と型の決まり・型は変えられない", async () => {
  const { forms, env } = setup();
  assert.equal((await forms.setField(env, { key: "X", label: "x", type: "text" })).error, "bad_key");
  assert.equal((await forms.setField(env, { key: "plan", label: "プラン", type: "select" })).error, "need_options");
  const a = await forms.setField(env, { key: "x_account", label: "X アカウント名", type: "text" });
  assert.equal(a.ok, true); assert.equal(a.created, true);
  assert.equal((await forms.setField(env, { key: "x_account", type: "number" })).error, "type_locked");
  const b = await forms.setField(env, { key: "x_account", label: "X のアカウント" });
  assert.equal(b.field.label, "X のアカウント"); assert.equal(b.created, false);
});

test("月次アンケート：作る → 公開 → 答える → 人の 1 枚と宛先に出る（2 回答えると履歴が 2 つ・値は新しい方）", async () => {
  const { forms, env, t } = setup();
  await forms.setField(env, { key: "x_account", label: "X アカウント名", type: "text" });
  await forms.setField(env, { key: "sales", label: "先月の売上", type: "number" });
  await forms.setField(env, { key: "goal", label: "今月の目標", type: "textarea" });
  assert.equal((await forms.setForm(env, { title: "月次", slug: "monthly", items: [] })).error, "need_items");
  const f = await forms.setForm(env, { title: "月次アンケート", slug: "monthly", items: [{ key: "x_account", required: true }, { key: "sales" }, { key: "goal" }, { key: "nope" }] });
  assert.equal(f.ok, true); assert.equal(f.form.items.length, 3);
  assert.equal((await forms.setForm(env, { title: "別", slug: "monthly", items: [{ key: "sales" }] })).error, "slug_taken");
  assert.equal((await forms.publicForm(env, "monthly")).error, "not_found"); // 公開前は見えない
  await forms.setForm(env, { id: f.form.id, active: true });
  const pub = await forms.publicForm(env, "monthly");
  assert.equal(pub.ok, true); assert.deepEqual(pub.form.items.map((i) => i.label), ["X アカウント名", "先月の売上", "今月の目標"]);

  assert.equal((await forms.submit(env, "monthly", { email: "a@ex.jp", consent: true, answers: { sales: "100" } })).error, "bad_answers"); // 必須が空
  assert.equal((await forms.submit(env, "monthly", { email: "a@ex.jp", answers: { x_account: "@a" } })).error, "need_consent");
  const r1 = await forms.submit(env, "monthly", { email: "a@ex.jp", name: "A", consent: true, answers: { x_account: "@a", sales: "¥80,000", goal: "10万" } });
  assert.equal(r1.ok, true); assert.equal(r1.is_new, true);
  const r2 = await forms.submit(env, "monthly", { email: "A@ex.jp", consent: true, answers: { x_account: "@a", sales: "120000" } });
  assert.equal(r2.is_new, false);
  await forms.submit(env, "monthly", { email: "b@ex.jp", consent: true, answers: { x_account: "@b", sales: "50000" } });

  const me = t.customers.find((c) => c.email === "a@ex.jp");
  const pv = await forms.personValues(env, me.id);
  assert.equal(pv.answers.length, 2);
  assert.deepEqual(pv.values.map((v) => [v.key, v.value]), [["x_account", "@a"], ["sales", "120000"], ["goal", "10万"]]);
  assert.equal(t.events.filter((e) => e.type === "form_submitted").length, 3);

  const all = t.customers.map((c) => ({ id: c.id }));
  const hit = await forms.filterByFields(env, all, normFieldConds([{ key: "sales", op: "gte", value: "100000" }]));
  assert.deepEqual(hit.map((p) => p.id), [me.id]);
  const list = await forms.listForms(env, {});
  assert.equal(list.forms[0].answers, 3);
  const ans = await forms.listAnswers(env, { form_id: f.form.id });
  assert.equal(ans.count, 3); assert.equal(ans.answers[0].items.find((i) => i.key === "sales").label, "先月の売上");
});

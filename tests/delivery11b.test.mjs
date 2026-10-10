// 便 11b：配信の強化の試験。メールの型・開いたかの計測・開いた／開いていないの条件・別の自動の動きへ移す・人の項目に値を書く。
// 走らせ方：node --test tests/delivery11b.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeDeliver } from "../src/deliver.js";
import { makeForms } from "../src/forms.js";
import { mailHtml, mailText, PIXEL_GIF } from "../src/mailhtml.js";
import { buildEdges, partKeyOf } from "../src/plan.js";

const env = { B_STORE: true, MCP_SECRET: "test-secret", PUBLIC_ORIGIN: "https://lab.shia2n.jp" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const BC = "33333333-3333-4333-8333-333333333333";

function setup() {
  const s = fakeStore();
  const addEvent = async (e, id, type, payload, actor = "site") => {
    const [row] = await s.db(e, "POST", "events", [{ customer_id: id, type, payload, actor, occurred_at: new Date().toISOString() }], "return=representation");
    return row;
  };
  const sent = [];
  const bin3 = {
    async sendMail(e, person, m) {
      sent.push({ to: person.email, ...m });
      await addEvent(e, person.id, "email_sent", { kind: m.kind, ...(m.extra || {}) });
      return { result: "sent" };
    },
  };
  const forms = makeForms({ db: s.db, addEvent, logInbound: async () => {}, registerPerson: async () => ({ ok: false }) });
  const deliver = makeDeliver({
    db: s.db, addEvent, logInbound: async () => {}, bin3, forms,
    sell: { entitlementMap: async () => ({}) },
    mailcfg: { get: async () => ({ scope: "all" }) },
    connect: { labelMap: async () => new Map(), notifyAdmins: async () => ({ sent: 1 }), addLabel: async () => ({ ok: true, changed: true }) },
  });
  for (const [id, email, name] of [[A, "a@example.com", "A"], [B, "b@example.com", "B"]]) {
    s.table("customers").push({ id, email, name });
    s.table("customer_summary").push({ id, email, name, source: "direct", note_member: false, created_at: "2026-10-01T00:00:00Z" });
  }
  s.table("b_fields").push({ key: "seminar_status", label: "セミナーの状況", type: "select", options: ["申込", "参加", "欠席"], sort: 1 });
  return { ...s, deliver, sent, addEvent };
}

// 動かした時刻を昔に戻す（試験の中で、作ったあとの出来事を拾わせるため）
const wake = (s) => s.table("b_steps").forEach((r) => { r.active_since = "2000-01-01T00:00:00.000Z"; });

test("メールの型：ボタン・押せるリンク・文字の逃がし・開いたかの画像。文字だけのメールではボタンが「文字：住所」になる", () => {
  const text = "こんにちは <b>A</b> さん\n[[申し込む|https://lp.shia2n.jp/zukai?r=mail]]\n詳しくは https://lab.shia2n.jp/app へ";
  const html = mailHtml(text, { footHtml: "末尾", openUrl: "https://lab.shia2n.jp/o/broadcast/x?c=1&s=2" });
  assert.match(html, /<a href="https:\/\/lp\.shia2n\.jp\/zukai\?r=mail"[^>]*>申し込む<\/a>/);
  assert.match(html, /<a href="https:\/\/lab\.shia2n\.jp\/app"/);
  assert.ok(html.includes("&lt;b&gt;A&lt;/b&gt;"), "本文の山かっこは文字のまま");
  assert.ok(!html.includes("[[申し込む"), "ボタンの書き方は残らない");
  assert.match(html, /<img src="https:\/\/lab\.shia2n\.jp\/o\/broadcast\/x\?c=1&amp;s=2" width="1"/);
  assert.match(html, /末尾/);
  assert.equal(mailText("[[申し込む|https://x.example/a]]"), "申し込む：https://x.example/a");
  assert.ok(!mailHtml("本文").includes("<img"), "openUrl が無ければ画像は付けない");
});

test("ステップのメール：ボタンの住所も押したかを数える住所に置き換わり、閉じ括弧は住所に入らない。開いたかの住所が付く", async () => {
  const st = setup();
  const r = await st.deliver.setStep(env, { name: "受付", trigger: "registered", action: "send_email", subject: "受付", body: "[[セミナーへ|https://lp.shia2n.jp/zukai]]", active: true }, "test");
  assert.equal(r.ok, true, JSON.stringify(r));
  wake(st);
  await st.addEvent(env, A, "registered", {});
  await st.deliver.run(env);
  assert.equal(st.sent.length, 1);
  assert.match(st.sent[0].text, /^\[\[セミナーへ\|https:\/\/lab\.shia2n\.jp\/r\/[0-9a-f]{12}\?c=[0-9a-f-]{36}&s=[0-9a-f]{16}\]\]$/);
  assert.equal(st.table("b_links")[0].url, "https://lp.shia2n.jp/zukai", "] は住所に入らない");
  assert.match(st.sent[0].openUrl, new RegExp(`^https://lab\\.shia2n\\.jp/o/step/${r.step.id}\\?c=${A}&s=[0-9a-f]{16}$`));
});

test("開いたかの画像：印が合えば 1 人 1 通につき 1 回だけ積む。印が違っても画像は返し、記録しない", async () => {
  const st = setup();
  const r = await st.deliver.setStep(env, { name: "受付", trigger: "registered", action: "send_email", subject: "s", body: "b", active: true }, "test");
  wake(st);
  await st.addEvent(env, A, "registered", {});
  await st.deliver.run(env);
  const u = new URL(st.sent[0].openUrl);
  for (let i = 0; i < 2; i++) {
    const res = await st.deliver.handleOpen(env, u, "step", String(r.step.id));
    assert.equal(res.headers.get("content-type"), "image/gif");
    assert.equal((await res.arrayBuffer()).byteLength, PIXEL_GIF.length);
  }
  const bad = new URL(u); bad.searchParams.set("s", "0".repeat(16));
  const res = await st.deliver.handleOpen(env, bad, "step", String(r.step.id));
  assert.equal(res.headers.get("content-type"), "image/gif");
  const opened = st.table("events").filter((e) => e.type === "email_opened");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].payload.step_id, r.step.id);
  const list = await st.deliver.listSteps(env);
  assert.equal(list.steps[0].opened_people, 1);
});

test("宛先の条件：開いた人・開いていない人。読めない値は捨てる。一斉配信の一覧に開いた人の数", async () => {
  const st = setup();
  st.table("b_broadcasts").push({ id: BC, subject: "11 月のご案内", body: "x", filter: {}, status: "done", created_at: "2026-10-10T00:00:00Z" });
  await st.addEvent(env, A, "email_opened", { kind: "broadcast", ref: BC, broadcast_id: BC });
  const f = st.deliver.normFilter({ opened: ["broadcast:" + BC, "bad"], not_opened: "step:abc" });
  assert.deepEqual(f, { opened: ["broadcast:" + BC] });
  const yes = await st.deliver.audience(env, { opened: ["broadcast:" + BC] });
  const no = await st.deliver.audience(env, { not_opened: ["broadcast:" + BC] });
  assert.deepEqual(yes.people.map((p) => p.id), [A]);
  assert.deepEqual(no.people.map((p) => p.id), [B]);
  const lb = await st.deliver.listBroadcasts(env, {});
  assert.equal(lb.broadcasts[0].opened_people, 1);
});

test("別の自動の動きへ移す → 移された先が動いて人の項目に値を書く。設計図に「移す」の線", async () => {
  const st = setup();
  const target = await st.deliver.setStep(env, { name: "参加の印", trigger: "moved", action: "set_field", action_args: { field: "seminar_status", value: "申込" }, active: true }, "test");
  assert.equal(target.ok, true, JSON.stringify(target));
  const src = await st.deliver.setStep(env, { name: "申込の人を移す", trigger: "registered", action: "move_to", action_args: { step_id: target.step.id }, active: true }, "test");
  assert.equal(src.ok, true, JSON.stringify(src));
  wake(st);
  await st.addEvent(env, A, "registered", {});
  await st.deliver.run(env);
  await st.deliver.run(env);
  const entered = st.table("events").filter((e) => e.type === "step_entered");
  assert.equal(entered.length, 1, "同じきっかけで 2 回は移さない");
  assert.equal(entered[0].payload.to, target.step.id);
  assert.equal(entered[0].payload.depth, 1);
  const v = st.table("b_person_values").find((r) => r.customer_id === A && r.key === "seminar_status");
  assert.equal(v && v.value, "申込");
  assert.equal(st.table("events").filter((e) => e.type === "field_set").length, 1);
  assert.equal(partKeyOf(entered[0]), `step:${target.step.id}`);
  const edges = buildEdges([
    { key: `step:${src.step.id}`, type: "step", trigger: "registered", action: "move_to", action_args: { step_id: target.step.id } },
    { key: `step:${target.step.id}`, type: "step", trigger: "moved", action: "set_field", action_args: {} },
  ]);
  assert.ok(edges.some((e) => e.from === `step:${src.step.id}` && e.to === `step:${target.step.id}` && e.label === "移す"));
});

test("移す・移されるが回り続けても 5 段で止まる", async () => {
  const st = setup();
  const x = await st.deliver.setStep(env, { name: "X", trigger: "moved", action: "send_email", subject: "s", body: "b", active: false }, "test");
  const y = await st.deliver.setStep(env, { name: "Y", trigger: "moved", action: "move_to", action_args: { step_id: x.step.id }, active: true }, "test");
  const x2 = await st.deliver.setStep(env, { id: x.step.id, action: "move_to", action_args: { step_id: y.step.id }, active: true }, "test");
  assert.equal(x2.ok, true, JSON.stringify(x2));
  wake(st);
  await st.addEvent(env, A, "step_entered", { step_id: 0, to: x.step.id, depth: 1 });
  for (let i = 0; i < 8; i++) await st.deliver.run(env);
  const entered = st.table("events").filter((e) => e.type === "step_entered");
  assert.ok(entered.length <= 5, `移した数 ${entered.length}`);
  assert.ok(st.table("events").some((e) => e.type === "connector_skipped" && e.payload.reason === "chain_too_long"));
});

test("保存の前の確かめ：移す先は「移された」のきっかけのものだけ・自分へは移せない・知らない項目には書けない", async () => {
  const st = setup();
  const plain = await st.deliver.setStep(env, { name: "登録", trigger: "registered", action: "add_label", action_args: { label: "x" } }, "test");
  assert.equal((await st.deliver.setStep(env, { name: "m", trigger: "registered", action: "move_to", action_args: { step_id: plain.step.id } }, "test")).error, "target_not_moved_trigger");
  assert.equal((await st.deliver.setStep(env, { name: "m", trigger: "registered", action: "move_to", action_args: {} }, "test")).error, "need_action_step");
  const moved = await st.deliver.setStep(env, { name: "受け", trigger: "moved", action: "add_label", action_args: { label: "y" } }, "test");
  assert.equal((await st.deliver.setStep(env, { id: moved.step.id, action: "move_to", action_args: { step_id: moved.step.id } }, "test")).error, "move_to_self");
  assert.equal((await st.deliver.setStep(env, { name: "f", trigger: "registered", action: "set_field", action_args: { field: "no_such", value: "1" } }, "test")).error, "no_field");
  assert.equal((await st.deliver.setStep(env, { name: "f", trigger: "registered", action: "set_field", action_args: { field: "seminar_status" } }, "test")).error, "need_action_field");
});

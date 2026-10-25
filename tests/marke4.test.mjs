// マーケくん便 4：データはフォルダ、まとまりはシナリオ（旧企画）。1 つの部品を何本のシナリオにも入れられる。
// 走らせ方：node --test tests/marke4.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { assemble, runningOwnParts, makePlan, putMember } from "../src/plan.js";
import { makeChanges } from "../src/changes.js";
import { makeFolders, folderView, folderName } from "../src/folders.js";
import { makeBlocks } from "../src/blocks.js";

const STAND = "00000000-0000-4000-8000-000000000001";
const SEM = "00000000-0000-4000-8000-000000000002";
const LAUNCH = "00000000-0000-4000-8000-000000000003";
const OLD = "00000000-0000-4000-8000-000000000004";
const camps = () => [
  { id: STAND, name: "常設", kind: "standing", archived_at: null },
  { id: SEM, name: "2026-11 図解セミナー", kind: "campaign", archived_at: null },
  { id: LAUNCH, name: "2026-12 ローンチ", kind: "campaign", archived_at: null },
  { id: OLD, name: "2026-09 終わった企画", kind: "campaign", archived_at: "2026-10-01T00:00:00Z" },
];
const part = (type, id, state = "running", name = `${type} ${id}`) => ({ key: `${type}:${id}`, type, id, lane: "buy", name, state });

test("1 つの商品が 2 本のシナリオに入る：どちらのシナリオにも出て、数はそれぞれに入り、役目はシナリオごと", () => {
  const parts = [part("product", "next-premium"), part("page", "p1"), part("step", "9")];
  const owners = [
    { part_type: "product", part_id: "next-premium", campaign_id: SEM, role: "セミナーで売る" },
    { part_type: "product", part_id: "next-premium", campaign_id: LAUNCH, role: "ローンチで売る" },
    { part_type: "page", part_id: "p1", campaign_id: SEM, role: "" },
  ];
  const base = { parts, edges: [], campaigns: camps(), owners, week: {} };
  const sem = assemble(base, SEM);
  const launch = assemble(base, LAUNCH);
  assert.deepEqual(sem.parts.map((p) => p.key).sort(), ["page:p1", "product:next-premium"]);
  assert.equal(sem.parts.find((p) => p.key === "product:next-premium").role, "セミナーで売る");
  assert.equal(launch.parts.find((p) => p.key === "product:next-premium").role, "ローンチで売る");
  assert.equal(launch.parts.find((p) => p.key === "product:next-premium").campaign_id, LAUNCH);
  const all = assemble(base, "all");
  const prod = all.parts.find((p) => p.key === "product:next-premium");
  assert.deepEqual(prod.campaigns.map((c) => c.name).sort(), ["2026-11 図解セミナー", "2026-12 ローンチ"]);
  assert.equal(all.campaigns.find((c) => c.id === SEM).parts, 2);
  assert.equal(all.campaigns.find((c) => c.id === LAUNCH).parts, 1);
  assert.equal(all.unassigned_count, 1, "step:9 だけがどこにも入っていない");
  assert.deepEqual(assemble(base, "unassigned").parts.map((p) => p.key), ["step:9"]);
});

test("代表の 1 つ：しまっていないシナリオを先に、常設より企画を先に。しまったシナリオだけの止まった部品は全部の表示から外れ、動いている部品は残って「入っていない」に数える", () => {
  const parts = [part("product", "a"), part("page", "old", "stopped"), part("product", "selling")];
  const owners = [
    { part_type: "product", part_id: "a", campaign_id: STAND },
    { part_type: "product", part_id: "a", campaign_id: OLD },
    { part_type: "product", part_id: "a", campaign_id: LAUNCH },
    { part_type: "page", part_id: "old", campaign_id: OLD },
    { part_type: "product", part_id: "selling", campaign_id: OLD },
  ];
  const base = { parts, edges: [], campaigns: camps(), owners, week: {} };
  const all = assemble(base, "all");
  assert.equal(all.parts.find((p) => p.key === "product:a").campaign_name, "2026-12 ローンチ");
  assert.equal(all.parts.some((p) => p.key === "page:old"), false);
  assert.equal(all.parts.some((p) => p.key === "product:selling"), true, "売っている商品はしまったシナリオだけでも消さない");
  assert.equal(all.unassigned_count, 2);
  assert.deepEqual(assemble(base, "unassigned").parts.map((p) => p.key).sort(), ["page:old", "product:selling"]);
});

test("しまえるか：そのシナリオだけに入って動いている配信・ステップだけが止める。借りている商品・ページは止めない", () => {
  const parts = [part("step", "1"), part("step", "2"), part("broadcast", "b1", "draft"), part("product", "x"), part("page", "p")];
  const owners = [
    { part_type: "step", part_id: "1", campaign_id: SEM },
    { part_type: "step", part_id: "2", campaign_id: SEM },
    { part_type: "step", part_id: "2", campaign_id: LAUNCH },
    { part_type: "broadcast", part_id: "b1", campaign_id: SEM },
    { part_type: "product", part_id: "x", campaign_id: SEM },
    { part_type: "page", part_id: "p", campaign_id: SEM },
  ];
  assert.deepEqual(runningOwnParts({ parts, campaigns: camps(), owners }, SEM).map((p) => p.key), ["step:1"]);
  // しまったシナリオに入っていても「ほかで使っている」には数えない
  const owners2 = owners.map((o) => (o.campaign_id === LAUNCH ? { ...o, campaign_id: OLD } : o));
  assert.deepEqual(runningOwnParts({ parts, campaigns: camps(), owners: owners2 }, SEM).map((p) => p.key), ["step:1", "step:2"]);
});

function planSetup() {
  const st = fakeStore();
  for (const c of camps()) st.table("b_campaigns").push({ ...c, created_at: "2026-10-01" });
  st.table("b_products").push({ id: "next-premium", name: "シアラボNEXTプレミアム", active: true, grants: [], sort: 1 });
  st.table("b_steps").push({ id: 9, name: "買った人へ", trigger: "purchase", product_id: "next-premium", subject: "ようこそ", active: true, action: "send_email", sort: 1 });
  const logs = [];
  const changes = makeChanges({ db: st.db, logInbound: async (e, ch, req) => { logs.push({ ch, req }); st.table("inbound_log").push({ id: logs.length, channel: ch, request: req, at: new Date().toISOString() }); } });
  const plan = makePlan({ db: st.db, logInbound: async (e, ch, req) => { if (ch === "change") st.table("inbound_log").push({ id: st.table("inbound_log").length + 1, channel: ch, request: req, at: "" }); }, communityLink: async () => ({ url: "" }), changes });
  return { st, plan, changes, env: { B_STORE: true } };
}

test("入れる：ほかのシナリオから外さずに足す。役目を省くと今のまま。remove でそのシナリオだけ外す・空で全部外す", async () => {
  const { st, plan, env } = planSetup();
  const P = { part_type: "product", part_id: "next-premium" };
  assert.equal((await plan.setPartCampaign(env, { ...P, campaign_id: SEM, role: "セミナーで売る" }, "t")).ok, true);
  const r = await plan.setPartCampaign(env, { ...P, campaign_id: LAUNCH }, "t");
  assert.deepEqual(r.campaigns.map((c) => c.id).sort(), [SEM, LAUNCH].sort());
  assert.equal(st.table("b_campaign_parts").length, 2);
  await plan.setPartCampaign(env, { ...P, campaign_id: SEM, block_name: "申込" }, "t");
  const semRow = st.table("b_campaign_parts").find((x) => x.campaign_id === SEM);
  assert.deepEqual([semRow.role, semRow.block_name], ["セミナーで売る", "申込"], "役目を省いたので前の役目のまま");
  assert.equal(st.table("b_campaign_parts").length, 2, "同じシナリオに 2 行は作らない");
  const rm = await plan.setPartCampaign(env, { ...P, campaign_id: SEM, remove: true }, "t");
  assert.deepEqual(rm.campaigns.map((c) => c.id), [LAUNCH]);
  assert.equal((await plan.setPartCampaign(env, { ...P, campaign_id: OLD }, "t")).error, "campaign_archived");
  await plan.setPartCampaign(env, { ...P, campaign_id: SEM }, "t");
  const none = await plan.setPartCampaign(env, { ...P, campaign_id: null }, "t");
  assert.equal(none.removed, 2);
  assert.equal(st.table("b_campaign_parts").length, 0);
});

test("元に戻す：足したのを戻すと外れ、外したのを戻すと戻る。前の 1 部品 1 企画の『移した』記録も戻せる", async () => {
  const { st, plan, changes, env } = planSetup();
  const P = { part_type: "product", part_id: "next-premium" };
  await plan.setPartCampaign(env, { ...P, campaign_id: SEM, role: "売る" }, "t");
  await plan.setPartCampaign(env, { ...P, campaign_id: LAUNCH }, "t");
  let list = (await changes.list(env, {})).changes;
  // 新しいほうから戻す（ローンチへ足した → 外れる）
  assert.equal((await changes.undo(env, { id: list[0].id }, "t")).ok, true);
  assert.deepEqual(st.table("b_campaign_parts").map((x) => x.campaign_id), [SEM]);
  // 前の形の記録：常設 → 図解セミナーへ移した。戻すと図解セミナーから外れて常設に戻る
  st.table("inbound_log").push({ id: 99, channel: "change", request: { kind: "part", target: "product:next-premium", before: { campaign_id: STAND, role: "" }, after: { campaign_id: SEM, role: "売る" } }, at: "" });
  assert.equal((await changes.undo(env, { id: 99 }, "t")).ok, true);
  assert.deepEqual(st.table("b_campaign_parts").map((x) => x.campaign_id), [STAND]);
});

test("入れ先の 1 行は「消してから入れる」（主キーを変える SQL の前でも後でも同じに動く）", async () => {
  const st = fakeStore();
  const env = {};
  await putMember(st.db, env, { campaign_id: SEM, part_type: "page", part_id: "p1", role: "a" });
  await putMember(st.db, env, { campaign_id: SEM, part_type: "page", part_id: "p1", role: "b" });
  await putMember(st.db, env, { campaign_id: LAUNCH, part_type: "page", part_id: "p1", role: "c" });
  assert.deepEqual(st.table("b_campaign_parts").map((x) => [x.campaign_id, x.role]), [[SEM, "b"], [LAUNCH, "c"]]);
});

test("しまう：借りている売り中の商品があってもしまえる。そのシナリオだけの動いているステップがあればしまえない", async () => {
  const { st, plan, env } = planSetup();
  await plan.setPartCampaign(env, { part_type: "product", part_id: "next-premium", campaign_id: LAUNCH }, "t");
  assert.equal((await plan.archiveCampaign(env, { campaign_id: LAUNCH }, "t")).ok, true);
  st.table("b_campaigns").find((c) => c.id === LAUNCH).archived_at = null;
  await plan.setPartCampaign(env, { part_type: "step", part_id: "9", campaign_id: LAUNCH }, "t");
  const r = await plan.archiveCampaign(env, { campaign_id: LAUNCH }, "t");
  assert.equal(r.error, "running_parts");
  assert.deepEqual(r.running.map((x) => x.key), ["step:9"]);
  await plan.setPartCampaign(env, { part_type: "step", part_id: "9", campaign_id: SEM }, "t");
  assert.equal((await plan.archiveCampaign(env, { campaign_id: LAUNCH }, "t")).ok, true, "図解セミナーにも入っているので止めない");
});

test("複製：ステップと一斉配信は下書きで写し、商品・ページは写さずに新しいシナリオにも入れる", async () => {
  const st = fakeStore();
  const env = { B_STORE: true };
  for (const c of camps()) st.table("b_campaigns").push({ ...c, starts_on: null });
  st.table("b_steps").push({ id: 9, name: "買った人へ", trigger: "purchase", subject: "ようこそ", body: "本文", active: true });
  st.table("b_broadcasts").push({ id: "11111111-1111-4111-8111-111111111111", subject: "締切", body: "本文", filter: {}, status: "done" });
  for (const r of [
    { part_type: "step", part_id: "9", role: "お礼", block_name: "買ったあと" },
    { part_type: "broadcast", part_id: "11111111-1111-4111-8111-111111111111", role: "締切の知らせ", block_name: "" },
    { part_type: "product", part_id: "next-premium", role: "売る", block_name: "申込" },
    { part_type: "page", part_id: "p1", role: "申込のページ", block_name: "申込" },
  ]) st.table("b_campaign_parts").push({ ...r, campaign_id: SEM });
  let next = 100;
  const draftFlow = async (e, { campaign_title, connectors }) => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    if (!st.table("b_campaigns").some((c) => c.id === id)) st.table("b_campaigns").push({ id, name: "2026-12 " + campaign_title, kind: "campaign" });
    const ids = connectors.map(() => next++);
    for (const sid of ids) st.table("b_campaign_parts").push({ part_type: "step", part_id: String(sid), campaign_id: id, role: "", block_name: "" });
    return { ok: true, campaign_id: id, campaign_name: "2026-12 " + campaign_title, step_ids: ids };
  };
  const deliver = { draftBroadcast: async (e, a) => { const row = { id: "22222222-2222-4222-8222-222222222222", ...a, status: "draft" }; st.table("b_broadcasts").push(row); return { ok: true, broadcast: row }; } };
  const blocks = makeBlocks({ db: st.db, logInbound: async () => {}, plan: { createCampaign: async () => ({ ok: false }) }, deliver, draftFlow });
  const r = await blocks.copyCampaign(env, { campaign_id: SEM, title: "図解セミナー再演" }, "t");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.shared, 2);
  const mine = st.table("b_campaign_parts").filter((x) => x.campaign_id === r.campaign_id);
  assert.deepEqual(mine.map((x) => `${x.part_type}:${x.part_id}`).sort(), ["broadcast:22222222-2222-4222-8222-222222222222", "page:p1", "product:next-premium", "step:100"]);
  assert.equal(mine.find((x) => x.part_id === "100").block_name, "買ったあと");
  assert.equal(mine.find((x) => x.part_type === "product").role, "売る");
  assert.equal(st.table("b_broadcasts").find((b) => b.id.startsWith("2222")).status, "draft");
  // 元のシナリオの行はそのまま
  assert.equal(st.table("b_campaign_parts").filter((x) => x.campaign_id === SEM).length, 4);
});

test("フォルダ：種類ごと・名前の重なりは断る・入れると前のフォルダから出る・消すと中は「入っていない」に戻る", async () => {
  const st = fakeStore();
  const env = { B_STORE: true };
  const f = makeFolders({ db: st.db, logInbound: async () => {} });
  const a = await f.save(env, { part_type: "product", name: "  シアラボ   本体 " }, "t");
  assert.equal(a.folder.name, "シアラボ 本体");
  const b = await f.save(env, { part_type: "product", name: "NEXT" }, "t");
  assert.equal((await f.save(env, { part_type: "product", name: "NEXT" }, "t")).error, "name_taken");
  assert.equal((await f.save(env, { part_type: "page", name: "NEXT" }, "t")).ok, true, "種類が違えば同じ名前でよい");
  assert.equal((await f.save(env, { part_type: "nope", name: "x" }, "t")).error, "bad_part_type");
  await f.assign(env, { part_type: "product", part_ids: ["next-premium", "next-monthly"], folder_id: a.folder.id }, "t");
  await f.assign(env, { part_type: "product", part_id: "next-premium", folder_id: b.folder.id }, "t");
  let v = await f.list(env, { part_type: "product" });
  assert.deepEqual(v.folders.map((x) => [x.name, x.count]), [["NEXT", 1], ["シアラボ 本体", 1]]);
  assert.equal(v.items["next-premium"], b.folder.id);
  const page = (await f.list(env, { part_type: "page" })).folders[0];
  assert.equal((await f.assign(env, { part_type: "product", part_id: "x", folder_id: page.id }, "t")).error, "other_type_folder");
  await f.save(env, { id: a.folder.id, remove: true }, "t");
  v = await f.list(env, { part_type: "product" });
  assert.deepEqual(v.folders.map((x) => x.name), ["NEXT"]);
  assert.equal(v.items["next-monthly"], undefined);
  await f.assign(env, { part_type: "product", part_id: "next-premium", folder_id: null }, "t");
  assert.equal(st.table("b_folder_items").length, 0);
});

test("フォルダの表がまだ無い（SQL の前）：一覧は空で返し、作るのは need_sql で断る", async () => {
  const db = async (e, m, pq) => { if (pq.startsWith("b_folder")) throw new Error(`db ${m} b_folders 404: {"code":"PGRST205","message":"Could not find the table"}`); return []; };
  const f = makeFolders({ db, logInbound: async () => {} });
  const env = { B_STORE: true };
  const l = await f.list(env, { part_type: "page" });
  assert.deepEqual([l.ok, l.folders, l.note], [true, [], "need_sql"]);
  assert.equal((await f.save(env, { part_type: "page", name: "a" }, "t")).error, "need_sql");
  assert.equal((await f.assign(env, { part_type: "page", part_id: "p1", folder_id: null }, "t")).error, "need_sql");
});

test("フォルダの名前と数の形", () => {
  assert.equal(folderName("  a　 b "), "a b");
  const v = folderView([{ id: "f1", part_type: "page", name: "b", sort: 0 }, { id: "f2", part_type: "page", name: "a", sort: 0 }, { id: "f3", part_type: "product", name: "c" }],
    [{ part_type: "page", part_id: "p1", folder_id: "f1" }, { part_type: "page", part_id: "p2", folder_id: "gone" }], "page");
  assert.deepEqual(v, { folders: [{ id: "f2", name: "a", count: 0 }, { id: "f1", name: "b", count: 1 }], items: { p1: "f1" } });
});

test("SQL の前：2 本目のシナリオに入れると need_sql で断り、複製は商品・ページを入れられなかった数を返して止まらない", async () => {
  // 主キーが部品だけの表の真似（同じ部品の 2 行目は 409）
  const { st, plan, env } = planSetup();
  const realDb = st.db;
  const oldKey = async (e, m, pq, body, prefer) => {
    if (m === "POST" && pq.startsWith("b_campaign_parts")) {
      for (const r of [].concat(body)) if (st.table("b_campaign_parts").some((x) => x.part_type === r.part_type && String(x.part_id) === String(r.part_id))) throw new Error('db POST b_campaign_parts 409: {"code":"23505","message":"duplicate key value"}');
    }
    return realDb(e, m, pq, body, prefer);
  };
  const plan2 = makePlan({ db: oldKey, logInbound: async () => {}, communityLink: async () => ({ url: "" }) });
  const P = { part_type: "product", part_id: "next-premium" };
  assert.equal((await plan2.setPartCampaign(env, { ...P, campaign_id: SEM }, "t")).ok, true);
  assert.equal((await plan2.setPartCampaign(env, { ...P, campaign_id: SEM, role: "直した" }, "t")).ok, true, "同じシナリオの役目は直せる");
  assert.equal((await plan2.setPartCampaign(env, { ...P, campaign_id: LAUNCH }, "t")).error, "need_sql");
  assert.deepEqual(st.table("b_campaign_parts").map((x) => [x.campaign_id, x.role]), [[SEM, "直した"]]);
  const blocks = makeBlocks({ db: oldKey, logInbound: async () => {}, plan: { createCampaign: async () => { st.table("b_campaigns").push({ id: "00000000-0000-4000-8000-0000000000bb", name: "2026-12 再演", kind: "campaign" }); return { ok: true, campaign: { id: "00000000-0000-4000-8000-0000000000bb", name: "2026-12 再演" } }; } }, deliver: null, draftFlow: async () => ({ ok: false }) });
  const r = await blocks.copyCampaign(env, { campaign_id: SEM, title: "再演" }, "t");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.shared, r.shared_failed], [0, 1]);
});

test("元に戻す：記録に無いブロックと作った元のテンプレは、いまの行の値を残す。外したのを戻すとテンプレも戻る", async () => {
  const { st, plan, changes, env } = planSetup();
  const T = "33333333-3333-4333-8333-333333333333";
  st.table("b_campaign_parts").push({ part_type: "step", part_id: "9", campaign_id: SEM, role: "お礼", block_name: "買ったあと", template_id: T, template_version: 2 });
  await plan.setPartCampaign(env, { part_type: "step", part_id: "9", campaign_id: SEM, remove: true }, "t");
  assert.equal(st.table("b_campaign_parts").length, 0);
  let list = (await changes.list(env, {})).changes;
  await changes.undo(env, { id: list[0].id }, "t");
  const row = st.table("b_campaign_parts")[0];
  assert.deepEqual([row.role, row.block_name, row.template_id, row.template_version], ["お礼", "買ったあと", T, 2]);
  // 前の形の記録（ブロックもテンプレも書いていない）：役目だけ戻し、ほかはいまの値のまま
  st.table("inbound_log").push({ id: 199, channel: "change", request: { kind: "part", target: "step:9", before: { campaign_id: SEM, role: "前の役目" }, after: { campaign_id: SEM, role: "お礼" } }, at: "" });
  await changes.undo(env, { id: 199 }, "t");
  const row2 = st.table("b_campaign_parts")[0];
  assert.deepEqual([row2.role, row2.block_name, row2.template_id], ["前の役目", "買ったあと", T]);
});

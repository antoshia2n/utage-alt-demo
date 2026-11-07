// チャットの便 C2a：フォルダ（作る・名前・並べ替え・消す・入れる）・フォルダの中で探す・資料（自動で集める・入れる・外す）・顧客管理に残す
// 走らせ方：node --test tests/chat-c2a.test.mjs（画面は手元の試し台で PC・スマホを確かめた）
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeStore } from "./fake-store.mjs";
import { makeChat, parseFolders, formatFolders, folderNameOk, folderOf, vaultOf, FOLDER_KEY } from "../src/chat.js";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
function setup() {
  const s = fakeStore();
  s.table("customers").push({ id: A, name: "佐藤" }, { id: B, name: "森" });
  s.table("customer_summary").push({ id: A, name: "佐藤", email: "a@example.com" }, { id: B, name: "森", email: "b@example.com" });
  let n = 100;
  const addEvent = async (env, cid, type, payload, actor) => { const e = { id: ++n, customer_id: cid, type, payload, actor, occurred_at: new Date(Date.now() + n).toISOString() }; s.table("events").push(e); return e; };
  const rooms = [{ person_id: A, last_from: "student" }, { person_id: B, last_from: "cyanin" }];
  const msgs = (pid) => s.table("events").filter((e) => e.customer_id === pid && e.type === "room_chat").map((e) => ({ id: e.id, kind: "chat", from: e.payload.from, at: e.occurred_at, text: e.payload.text || "", images: e.payload.images || [] }));
  const core = {
    listRooms: async () => ({ ok: true, rooms }),
    getRoom: async (env, { person_id }) => ({ ok: true, found: true, person: { id: person_id }, messages: msgs(person_id), notices: [], unreplied: [] }),
    getTimeline: async () => ({ person: { name: "" }, stage: { label: "" }, entitlements: [], purchases: [], events: [] }),
    findPeople: async () => ({ people: [] }),
  };
  const chat = makeChat({ db: s.db, addEvent, core, logInbound: async () => {} });
  return { s, chat, addEvent };
}

test("フォルダの行：「番号 名前」の行で持つ。壊れた行は飛ばす。名前は 1〜20 字（空白はそろえる）", () => {
  const fs = [{ id: "ab12", name: "NEXT 受講生" }, { id: "cd34", name: "VIP" }];
  assert.deepEqual(parseFolders(formatFolders(fs)), fs);
  assert.deepEqual(parseFolders("ab12 A\nこわれた行\nZZ B"), [{ id: "ab12", name: "A" }]);
  assert.equal(folderNameOk("  NEXT   受講生 "), "NEXT 受講生");
  assert.equal(folderNameOk(""), null);
  assert.equal(folderNameOk("あ".repeat(21)), null);
  // いちばん新しい印が効く。消したフォルダの印は「なし」
  const ev = [{ id: 1, type: "chat_folder", payload: { folder: "ab12" } }, { id: 2, type: "chat_folder", payload: { folder: "cd34" } }];
  assert.equal(folderOf(ev, new Set(["ab12", "cd34"])), "cd34");
  assert.equal(folderOf(ev, new Set(["ab12"])), null);
  assert.equal(folderOf([...ev, { id: 3, type: "chat_folder", payload: { folder: null } }]), null);
});

test("フォルダを作る・名前を変える・並べ替える・消す。同じ名前は断る。消すと中のチャットは「フォルダなし」", async () => {
  const { s, chat } = setup();
  const a = await chat.saveFolder({}, { name: "VIP" }, "n@x");
  const b = await chat.saveFolder({}, { name: "NEXT" }, "n@x");
  assert.ok(a.ok && b.ok);
  assert.equal((await chat.saveFolder({}, { name: "VIP" })).error, "name_taken");
  assert.equal((await chat.saveFolder({}, { name: "" })).error, "bad_name");
  assert.equal(s.table("settings").find((r) => r.key === FOLDER_KEY).value.split("\n").length, 2);
  assert.deepEqual((await chat.saveFolder({}, { id: b.folder.id, move: "up" })).folders.map((f) => f.name), ["NEXT", "VIP"]);
  assert.equal((await chat.saveFolder({}, { id: a.folder.id, name: "VIP 生" })).folder.name, "VIP 生");
  assert.ok((await chat.setFolder({}, { person_id: A, folder_id: a.folder.id })).ok);
  assert.equal((await chat.setFolder({}, { person_id: A, folder_id: "zzzz" })).error, "folder_not_found");
  let l = await chat.list({});
  assert.equal(l.chats.find((c) => c.person_id === A).folder_id, a.folder.id);
  assert.deepEqual(l.folders.map((f) => [f.name, f.count, f.need]), [["NEXT", 0, 0], ["VIP 生", 1, 1]]);
  await chat.saveFolder({}, { id: a.folder.id, remove: true });
  l = await chat.list({});
  assert.equal(l.chats.find((c) => c.person_id === A).folder_id, null);
  assert.deepEqual(l.folders.map((f) => f.name), ["NEXT"]);
});

test("フォルダの中で探す：そのフォルダのチャットだけ。空のフォルダは 0 件", async () => {
  const { chat, addEvent } = setup();
  await addEvent({}, A, "room_chat", { from: "student", text: "台本の相談です" });
  await addEvent({}, B, "room_chat", { from: "student", text: "台本ができました" });
  const f = (await chat.saveFolder({}, { name: "VIP" })).folder;
  const g = (await chat.saveFolder({}, { name: "空" })).folder;
  await chat.setFolder({}, { person_id: B, folder_id: f.id });
  assert.equal((await chat.search({}, { q: "台本" })).count, 2);
  const r = await chat.search({}, { q: "台本", folder_id: f.id });
  assert.deepEqual(r.hits.map((h) => h.person_id), [B]);
  assert.equal((await chat.search({}, { q: "台本", folder_id: g.id })).count, 0);
  assert.equal((await chat.search({}, { q: "台本", folder_id: "zzzz" })).error, "folder_not_found");
});

test("資料：リンクと画像は自動で集まる（同じ住所は 1 つ）。入れたものは先頭。外すと消える", async () => {
  const msgs = [
    { id: 1, kind: "chat", from: "student", at: "t1", text: "これです https://docs.google.com/x）見てください", images: ["room/a/1.jpg"] },
    { id: 2, kind: "chat", from: "cyanin", at: "t2", text: "同じ https://docs.google.com/x", images: [] },
  ];
  const notes = [{ id: 3, at: "t3", text: "メモ https://example.com/y" }];
  let v = vaultOf(msgs, notes, []);
  assert.deepEqual(v.map((x) => x.kind + ":" + (x.url || x.key)), ["link:https://example.com/y", "link:https://docs.google.com/x", "image:room/a/1.jpg"]);
  assert.equal(v[1].event_id, 2); // 新しいほうを残す
  const saved = [{ id: 10, type: "chat_saved", payload: { event_id: 1, text: "これです", from: "生徒" } }];
  v = vaultOf(msgs, notes, saved);
  assert.equal(v[0].kind, "saved");
  v = vaultOf(msgs, notes, [...saved, { id: 11, type: "chat_saved", payload: { event_id: 1, off: true } }]);
  assert.ok(!v.some((x) => x.kind === "saved"));
});

test("資料に入れる：ほかの人のメッセージは断る。get の資料に出る。外すと消える", async () => {
  const { chat, addEvent } = setup();
  const m = await addEvent({}, A, "room_chat", { from: "student", text: "質問があります" });
  const other = await addEvent({}, B, "room_chat", { from: "student", text: "森の" });
  assert.equal((await chat.keep({}, { person_id: A, event_id: other.id })).error, "message_not_found");
  assert.ok((await chat.keep({}, { person_id: A, event_id: m.id })).kept);
  const g = await chat.get({}, { person_id: A });
  assert.equal(g.vault[0].kind, "saved");
  assert.equal(g.vault[0].from, "生徒");
  assert.equal((await chat.keep({}, { person_id: A, event_id: m.id, off: true })).kept, false);
  assert.ok(!(await chat.get({}, { person_id: A })).vault.some((x) => x.kind === "saved"));
});

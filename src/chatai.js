// チャットの便 C3（2026-11-07 Naoki OK 13:23）：右の「AI」タブ。Workers AI（結び AI）で、要約・返信の下書き・見落とし・自由な質問・メッセージの分析・言い換えて探す。
//  ・アプリから Claude の API は呼ばない（2026-10-21 の決まり）。Cloudflare の中の Workers AI だけを使い、外の AI にデータを出さない
//  ・AI は送らない。下書きは「入力欄に入れる」まで。送るのは Naoki が押したときだけ
//  ・材料：1 対 1 は直近のやり取りとメモ・右のカード・履歴、グループは直近の本流とスレッド。生徒の発言はシアニンの画面と同じ呼び名で渡す
//  ・答えも材料も残さない（記録には種類と長さだけ）。残したいときは画面の「メモに残す」で chat_note にする
export const AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const MODES = ["summary", "draft", "gaps", "free", "message"];
const LINES_MAX = 80;
const Q_MAX = 1000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const pad = (n) => String(n).padStart(2, "0");
export function jst(iso) {
  const d = new Date(Date.parse(iso) + 9 * 3600e3);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

// 1 対 1：get_chat の答え → 材料の文
export function contextOfChat(c) {
  const name = (c.names && (c.names.nickname || c.names.real)) || (c.card && c.card.name) || "生徒";
  const lines = [];
  for (const m of c.messages || []) {
    if (m.kind === "chat") lines.push({ id: m.id, t: `[${jst(m.at)}] #${m.id} ${m.from === "student" ? name : "シアニン"}：${clip(m.text, 400)}${(m.images || []).length ? "（画像あり）" : ""}${m.lesson ? `（教材「${m.lesson.title}」への${m.from === "student" ? "質問" : "答え"}）` : ""}` });
    else if (m.from === "student") lines.push({ id: m.id, t: `[${jst(m.at)}] #${m.id} ${name}：（添削の依頼）${clip(m.text, 200)}${m.replied ? "（返信済み）" : "（未返信）"}` });
    else lines.push({ id: m.id, t: `[${jst(m.at)}] #${m.id} シアニン：（添削を返した）${clip(m.comment || m.corrected, 200)}` });
  }
  for (const n of c.notes || []) lines.push({ id: n.id, t: `[${jst(n.at)}] #${n.id} シアニンのメモ（生徒には見えない）：${clip(n.text, 300)}` });
  lines.sort((a, b) => a.id - b.id);
  const card = c.card || {};
  const head = [
    `生徒：${name}${c.names && c.names.real && c.names.nickname ? `（本名 ${c.names.real}）` : ""}`,
    card.stage ? `段階：${card.stage}` : "",
    (card.entitlements || []).length ? `権利：${card.entitlements.map((e) => e.key).join("、")}` : "",
    card.next_booking ? `次の予約：${card.next_booking.title} ${jst(card.next_booking.slot)}` : "",
    card.last_purchase ? `最後の購入：${card.last_purchase.name}` : "",
  ].filter(Boolean).join("\n");
  const hist = (c.history || []).slice(0, 15).map((h) => `${jst(h.at)} ${h.cat}：${h.type}`).join("\n");
  return { title: `${name}さんとの 1 対 1`, head, body: lines.slice(-LINES_MAX).map((x) => x.t).join("\n"), hist };
}

// グループ：get_chat_group の答え → 材料の文（スレッドは元のメッセージの下に字下げ）
export function contextOfGroup(g) {
  const out = [];
  for (const m of g.messages || []) {
    out.push(`[${jst(m.at)}] #${m.id} ${m.name}：${clip(m.text, 400)}${m.images.length ? "（画像あり）" : ""}`);
    for (const r of m.replies || []) out.push(`    ↳ [${jst(r.at)}] #${r.id} ${r.name}：${clip(r.text, 300)}`);
  }
  return { title: `グループ「${g.group.name}」（メンバー ${g.members.length} 人）`, head: `グループ名：${g.group.name}\nメンバー：${g.members.map((x) => x.name).join("、")}`, body: out.slice(-LINES_MAX).join("\n"), hist: "" };
}

const SYS = `あなたは、オンライン講座「しあらぼ」を運営するシアニン（講師）の秘書です。シアニンと受講生のチャットを読んで、シアニンを手伝います。
決まり：
- 日本語で、短く、具体的に書く。前置きやあいさつは書かない
- チャットに書かれていないことを事実として書かない。推測は「たぶん」と書く
- メッセージを指すときは #番号 を添える
- 見出しや太字の記号（# や **）は使わない。箇条書きは「・」で始める`;

export function promptFor(mode, ctx, { question = "", message = null } = {}) {
  const base = `${ctx.title}\n\n${ctx.head}\n\n【やり取り（古い順）】\n${ctx.body || "（まだやり取りはありません）"}${ctx.hist ? `\n\n【最近の出来事】\n${ctx.hist}` : ""}`;
  const ask = {
    summary: "このチャットの流れを 5 行以内で要約してください。最後に「いま必要なこと：」として 1 行で書いてください。",
    draft: "最後の受講生のメッセージに、シアニンとして返す文の下書きを 1 つ書いてください。シアニンの口調は、ていねいだけど親しみのある話し言葉です。下書きの文だけを書いてください（説明は要りません）。",
    gaps: "見落としを探してください。①受講生の質問でまだ答えていないもの ②シアニンが約束したのにまだのこと ③気持ちが落ちている・止まっているサイン。それぞれ「・」で、無ければ「なし」と書いてください。",
    free: `次の質問に答えてください：${question}`,
    message: message ? `次のメッセージ（#${message.id}）を分析してください。受講生が本当に困っていること・その背景・返し方の案を、それぞれ 1〜2 行で。\n「${clip(message.text, 600)}」` : "",
  }[mode];
  return [{ role: "system", content: SYS }, { role: "user", content: `${base}\n\n【お願い】\n${ask}` }];
}

// 言い換えの答え（JSON か、「・」の並び）→ 言葉の並び（最大 5）
export function parseWords(text, q) {
  const s = String(text || "");
  let arr = null;
  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { arr = JSON.parse(m[0]); } catch (_) { arr = null; } }
  if (!Array.isArray(arr)) arr = s.split(/[\n、,]/).map((x) => x.replace(/^[\s・\-*\d.）)]+/, ""));
  const words = [q, ...arr].map((x) => String(x || "").replace(/["「」]/g, "").trim()).filter((x) => x && x.length <= 20);
  return [...new Set(words)].slice(0, 6);
}

export function makeChatAi({ chat, groups, logInbound }) {
  async function run(env, messages, max = 700) {
    if (!env.AI || typeof env.AI.run !== "function") return { ok: false, error: "no_ai", note: "wrangler.jsonc の ai（binding AI）が要る" };
    try {
      const r = await env.AI.run(AI_MODEL, { messages, max_tokens: max, temperature: 0.3 });
      const text = String((r && (r.response ?? (r.result && r.result.response))) || "").trim();
      if (!text) return { ok: false, error: "ai_empty" };
      return { ok: true, text };
    } catch (e) { return { ok: false, error: "ai_failed", detail: String((e && e.message) || e).slice(0, 160) }; }
  }

  async function ask(env, { person_id, group_id, mode, question, message_id }) {
    if (!MODES.includes(mode)) return { ok: false, error: "bad_mode", modes: MODES };
    if (mode === "free" && !String(question || "").trim()) return { ok: false, error: "need_question" };
    if (String(question || "").length > Q_MAX) return { ok: false, error: "too_long", max: Q_MAX };
    let ctx, message = null;
    if (group_id) {
      if (!UUID_RE.test(String(group_id))) return { ok: false, error: "bad_group_id" };
      const g = await groups.get(env, { group_id, mark_read: false });
      if (!g.ok || !g.found) return { ok: false, error: "not_found" };
      ctx = contextOfGroup(g);
      if (mode === "message") { for (const m of g.messages) { if (m.id === Number(message_id)) message = m; for (const r of m.replies) if (r.id === Number(message_id)) message = r; } }
    } else {
      if (!UUID_RE.test(String(person_id || ""))) return { ok: false, error: "bad_person_id" };
      const c = await chat.get(env, { person_id });
      if (!c.ok || !c.found) return { ok: false, error: "not_found" };
      ctx = contextOfChat(c);
      if (mode === "message") message = [...(c.messages || []), ...(c.notes || [])].map((m) => ({ id: m.id, text: m.text || m.comment || m.corrected || "" })).find((m) => m.id === Number(message_id)) || null;
    }
    if (mode === "message" && !message) return { ok: false, error: "message_not_found" };
    const r = await run(env, promptFor(mode, ctx, { question: String(question || "").trim(), message }));
    if (logInbound) await logInbound(env, "chat_ai", { mode, target: group_id ? "group" : "person", lines: ctx.body.split("\n").length }, { ok: r.ok, chars: r.ok ? r.text.length : 0, error: r.error || null }, r.ok ? 200 : 502);
    return r.ok ? { ok: true, mode, text: r.text.replace(/\*\*/g, "").replace(/^#+\s*/gm, ""), model: AI_MODEL } : r;
  }

  // 言葉を AI に広げてもらい、今の検索で引いて合わせる
  async function search(env, { q }) {
    const s = String(q || "").trim();
    if (!s) return { ok: false, error: "need_q" };
    if (s.length > 100) return { ok: false, error: "too_long", max: 100 };
    const r = await run(env, [{ role: "system", content: "あなたは検索の言葉を広げる係です。答えは JSON の文字列の配列だけ。前置きは書かない。" },
      { role: "user", content: `講座のチャットを探します。「${s}」と同じ意味や近い話題で、チャットに書かれていそうな短い言葉（2〜8 字）を 5 つ。例：["言葉1","言葉2"]` }], 120);
    const words = r.ok ? parseWords(r.text, s) : [s];
    const seen = new Set(), hits = [];
    for (const w of words) {
      const x = await chat.search(env, { q: w, limit: 30 });
      for (const h of (x.hits || [])) { const k = (h.group_id || h.person_id) + ":" + h.event_id; if (seen.has(k)) continue; seen.add(k); hits.push({ ...h, word: w }); }
    }
    hits.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { ok: true, words, count: hits.length, hits: hits.slice(0, 60), ...(r.ok ? {} : { note: r.error }) };
  }

  return { ask, search };
}

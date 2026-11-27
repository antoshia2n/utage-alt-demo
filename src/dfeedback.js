// デザインフィードバック 便 2（2026-11-27 Naoki OK 10:31）：自分の画像を見立てる・直した画像と比べる
// - AI はマーケくんの Workers AI（画像を読めるモデル・chatai.js の AI_MODEL）。Claude の API は呼ばない
// - 画像は保存しない。AI に渡したら捨てる（画面の側で長い辺 1024px の JPEG にしてから送る）
// - 登録していない人は、その端末で見立て 1 回だけ（印は cookie lab_df）。比べるとコピーは無料会員
// - 無料会員は見立てと比べるを合わせて 1 日 DF_DAILY 回まで（出来事 df_look・df_compare を数える）
import { AI_MODEL } from "./chatai.js";
import { KOTOBA_RULES, KOTOBA_SCENES, KOTOBA_WORDS } from "./kotoba-data.js";

export const DF_DAILY = 20;
// 2026-11-27 便 2 の試し：今のモデル（AI_MODEL）は見本 3 枚とも外れた。比べるモデルは無料会員のときだけ選べる（一覧の外は使わない）
export const DF_MODELS = [AI_MODEL, "@cf/google/gemma-4-26b-a4b-it", "@cf/moonshotai/kimi-k2.6", "@cf/mistralai/mistral-small-3.1-24b-instruct"];
export const DF_GUEST_COOKIE = "lab_df";
export const DF_IMAGE_MAX = 1_600_000; // data URL の長さの上限（1024px の JPEG は多くて 400KB ほど）
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const rule = (n) => KOTOBA_RULES.find((r) => r[0] === Number(n));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);

export function lookPrompt({ kind = "own", scene = "", wish = "" } = {}) {
  const sc = KOTOBA_SCENES.find((x) => x.id === scene);
  const where = sc ? `場面：${sc.name}（${sc.sub}）` : "場面：画像から一番合うものを選ぶ";
  const w = clean(wish, 300) || "（なし）";
  if (kind === "ref") {
    return `あなたは日本語で話すアートディレクターです。添付の画像は、使う人が「参考にしたい他人の作品」です。写すとパクリになるので、直す指示は出さず、良さを言葉にしてください。
${where}
使う人のコメント：${w}
次の JSON だけを返してください。前後に文を付けないでください。
{"scene":"post|thumb|zukai|lp|slide のどれか（画像に一番合う場面）","good":["なぜ効いているかを『〇〇だから、△△になっている』の形で1文。3つ"],"borrow":["借りてよい層（目的と構成・構図・トーン）を一般の言葉で。2つまで"],"avoid":["借りてはいけない、この作品の固有の表現（絵柄の癖・配色の組み合わせ・文言など）。2〜3つ"]}
人名・作品名・ブランド名は書かないでください。`;
  }
  const cards = KOTOBA_RULES.map((r) => `${r[0]}|${r[1]}|${r[2]}|${r[3]}`).join("\n");
  return `あなたは日本語で話すアートディレクターです。添付の画像は、使う人の自分の作品です。下の「直す指示の一覧」から、この画像で直すと一番良くなるものを3〜5枚、効く順に選んでください。
${where}
使う人のコメント：${w}
直す指示の一覧（番号|見るところ|気になる所|デザイナーの言葉）：
${cards}
表現の言葉の一覧：${KOTOBA_WORDS.map((x) => x[0]).join("、")}
次の JSON だけを返してください。前後に文を付けないでください。
{"scene":"post|thumb|zukai|lp|slide のどれか（画像に一番合う場面）","good":"この画像の良い所を1文","picks":[{"id":番号,"where":"画像のどこのことか（例：上の見出し）を短く","reason":"この画像で、なぜそう見たかを1文"}],"wish":"使う人のコメントを、デザイナーの言葉で言い直した1文（コメントが無ければ空の文字）","changes":[{"title":"変える方向の名前（短く）","why":"この画像でこの方向が合う理由を1文","steps":["画像を作る AI にそのまま渡せる、具体的な変え方。2〜4つ"],"words":["表現の言葉の一覧から1〜3つ"]}]}
picks は一覧に無い番号を使わず、実際に画像に見えていることだけを根拠にしてください。画像に無いものを指摘しないでください。
changes は「直す」ではなく「今と違う見せ方に変えるなら」の案を2〜3つ出してください。コメントがあれば、1つ目はコメントにまっすぐ答える案にしてください。「スタイリッシュ」「高級感」のような抽象的な言葉は使わず、書体・余白・色・配置・写真や絵の扱いなど、具体的な言葉で書いてください。人名・作品名・ブランド名は書かないでください。`;
}

export function comparePrompt(points) {
  return `1枚目が直す前、2枚目が直した後の画像です。次の点が直ったかを見比べてください。
${points.map((p) => `${p.key}|${p.text}`).join("\n")}
次の JSON だけを返してください。前後に文を付けないでください。
{"items":[{"key":"上の行の先頭の記号（p6 など）","ok":true か false,"note":"どう変わったか、まだならどこが残っているかを1文"}],"summary":"全体として良くなった点を1文"}`;
}

// AI の答えを読み、決まった形と長さに切りそろえる（一覧に無い番号・言葉は捨てる）
export function shapeLook(kind, j) {
  if (!j || typeof j !== "object") return null;
  const scene = KOTOBA_SCENES.some((x) => x.id === j.scene) ? j.scene : "";
  if (kind === "ref") {
    const good = arr(j.good).map((x) => clean(x, 140)).filter(Boolean).slice(0, 3);
    const borrow = arr(j.borrow).map((x) => clean(x, 140)).filter(Boolean).slice(0, 2);
    const avoid = arr(j.avoid).map((x) => clean(x, 140)).filter(Boolean).slice(0, 3);
    return good.length ? { kind, scene, good, borrow, avoid } : null;
  }
  const seen = new Set();
  const picks = arr(j.picks).map((p) => ({ id: Number(p && p.id), where: clean(p && p.where, 30), reason: clean(p && p.reason, 140) }))
    .filter((p) => rule(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, 5);
  const words = new Set(KOTOBA_WORDS.map((w) => w[0]));
  const changes = arr(j.changes).map((c) => ({
    title: clean(c && c.title, 30), why: clean(c && c.why, 140),
    steps: arr(c && c.steps).map((s) => clean(s, 140)).filter(Boolean).slice(0, 4),
    words: arr(c && c.words).map((w) => clean(w, 20)).filter((w) => words.has(w)).slice(0, 3),
  })).filter((c) => c.title && c.steps.length).slice(0, 3);
  if (!picks.length) return null;
  return { kind: "own", scene, good: clean(j.good, 140), wish: clean(j.wish, 140), picks, changes };
}

export function shapeCompare(points, j) {
  if (!j || typeof j !== "object") return null;
  const keys = new Map(points.map((p) => [p.key, p]));
  const items = arr(j.items).map((it) => ({ key: clean(it && it.key, 6), ok: !!(it && it.ok === true), note: clean(it && it.note, 140) }))
    .filter((it) => keys.has(it.key)).map((it) => ({ ...it, label: keys.get(it.key).label }));
  return items.length ? { items, summary: clean(j.summary, 140) } : null;
}

// AI の答えの文から JSON を読む。前後の文・```json の囲み・末尾の余分なカンマを外してから読む
export function rawText(r) {
  const ch = r && Array.isArray(r.choices) && r.choices[0] && r.choices[0].message;
  if (ch && typeof ch.content === "string") return ch.content;
  if (r && typeof r.response === "object" && r.response) return JSON.stringify(r.response);
  return typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r?.result?.response ?? "");
}
export function parseLoose(raw) {
  const t = String(raw || "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const body = t.slice(a, b + 1);
  try { return JSON.parse(body); } catch (_) {}
  try { return JSON.parse(body.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"')); } catch (_) { return null; }
}

// h：{ db, addEvent, logInbound }
export function makeDesignFeedback(h) {
  const { db, addEvent, logInbound } = h;
  async function usedToday(env, cid) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const rows = await db(env, "GET", `events?select=id&customer_id=eq.${cid}&type=in.(df_look,df_compare)&occurred_at=gte.${encodeURIComponent(since)}&limit=${DF_DAILY + 1}`);
    return rows.length;
  }
  async function ask(env, prompt, images, max, model = AI_MODEL) {
    if (!env.AI || typeof env.AI.run !== "function") return { error: "no_ai" };
    const content = [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))];
    let r;
    try {
      r = await env.AI.run(model, { messages: [{ role: "user", content }], max_tokens: max, temperature: 0.2 });
    } catch (e) {
      await logInbound(env, "df_ai", { model }, { error: String((e && e.message) || e).slice(0, 300) }, 500).catch(() => {});
      return { error: "ai_failed" };
    }
    const raw = rawText(r);
    const json = parseLoose(raw);
    // 読めなかったときは、直すために AI の答えの頭を残す（画像は残さない）
    if (!json) await logInbound(env, "df_ai", { model }, { error: "unreadable", raw: raw.slice(0, 1500) }, 502).catch(() => {});
    return { json };
  }
  const imgOk = (v) => typeof v === "string" && v.length <= DF_IMAGE_MAX && IMG_RE.test(v);

  // person：無料会員なら { id }、そうでなければ null。guestUsed：その端末で見立てを 1 回使ったか
  async function look(env, person, guestUsed, body = {}) {
    if (!imgOk(body.image)) return { ok: false, error: "bad_image" };
    if (!person && guestUsed) return { ok: false, error: "need_member" };
    if (person && (await usedToday(env, person.id)) >= DF_DAILY) return { ok: false, error: "daily_limit", max: DF_DAILY };
    const kind = body.kind === "ref" ? "ref" : "own";
    const scene = KOTOBA_SCENES.some((x) => x.id === body.scene) ? body.scene : "";
    const model = person && DF_MODELS.includes(body.model) ? body.model : AI_MODEL;
    const r = await ask(env, lookPrompt({ kind, scene, wish: body.wish }), [body.image], 3000, model);
    if (r.error) return { ok: false, error: r.error };
    const res = shapeLook(kind, r.json);
    if (!res) return { ok: false, error: "ai_unreadable" };
    if (!res.scene) res.scene = scene || "post";
    if (person) await addEvent(env, person.id, "df_look", { kind, scene: res.scene, picks: (res.picks || []).map((p) => p.id), wish: !!clean(body.wish, 300) }, "site");
    const left = person ? Math.max(0, DF_DAILY - (await usedToday(env, person.id))) : 0;
    return { ok: true, result: res, left, guest: !person, model };
  }

  async function compare(env, person, body = {}) {
    if (!person) return { ok: false, error: "need_member" };
    if (!imgOk(body.before) || !imgOk(body.after)) return { ok: false, error: "bad_image" };
    const points = [];
    for (const id of arr(body.picks).slice(0, 5)) { const r = rule(id); if (r) points.push({ key: "p" + r[0], label: r[2], text: `${r[2]}：${r[5]}` }); }
    arr(body.changes).slice(0, 3).forEach((c, i) => { const t = clean(c && c.title, 30); if (t) points.push({ key: "c" + i, label: t, text: `${t}：${arr(c.steps).map((s) => clean(s, 140)).filter(Boolean).slice(0, 4).join("／")}` }); });
    if (!points.length) return { ok: false, error: "no_points" };
    if ((await usedToday(env, person.id)) >= DF_DAILY) return { ok: false, error: "daily_limit", max: DF_DAILY };
    const r = await ask(env, comparePrompt(points), [body.before, body.after], 700);
    if (r.error) return { ok: false, error: r.error };
    const res = shapeCompare(points, r.json);
    if (!res) return { ok: false, error: "ai_unreadable" };
    await addEvent(env, person.id, "df_compare", { ok: res.items.filter((x) => x.ok).length, all: res.items.length }, "site");
    return { ok: true, result: res, left: Math.max(0, DF_DAILY - (await usedToday(env, person.id))) };
  }

  return { look, compare };
}

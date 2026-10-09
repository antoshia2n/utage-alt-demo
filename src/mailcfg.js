// B の便 7c-1：メールの送り方の設定（送り元・表示名・返信先・誰に送るか）を表 b_settings に置く。
// 運用で変える値を Cloudflare の値（環境変数）に置かない（予防の行）。変えるのはシアニン用の画面か、承認が要る AI の道具。
// デモの置き場（B_STORE が無い）では今までどおり Cloudflare の値 MAIL_FROM・MAIL_OPEN を読む。
//
// 誰に送るか（mail_scope）は 3 段：
//   test  … テスト宛て（b_admins のメールと + 付きの別名・MAIL_ALLOW）だけ。既定
//   login … ログインのメールと手続きのメール（購入・予約・添削の知らせ・承認済みの 1 通）は誰にでも。お知らせ（一斉配信・ステップ）はテスト宛てだけ
//   all   … お知らせも誰にでも
// お知らせの種類は MARKETING_KINDS。それ以外は手続きのメールとして扱う。

export const MAIL_KEYS = ["mail_from", "mail_from_name", "mail_reply_to", "mail_scope"];
export const MAIL_SCOPES = ["test", "login", "all"];
export const MARKETING_KINDS = ["broadcast", "step"];
// 送り元に使ってよい住所。Cloudflare の Email Sending に登録した下の住所だけ（shia2n.jp そのものは XServer の送信の決まりがあるので使わない）
export const SENDER_DOMAINS = ["mail.shia2n.jp", "demo.shia2n.jp"];

// 特商法の表記（UTAGE のファネル「特商法・プライバシーポリシー」のステップ「特商法」・2023-11-25 版から写した）。メールの末尾に使う
export const ORG = {
  brand: "シアラボ",
  company: "株式会社Best Life Consulting",
  address: "〒530-0001 大阪府大阪市北区梅田一丁目1番3号 大阪駅前第3ビル11階2号室", // 2026-10-10 Naoki が新しい住所を渡した（本店）。東京の住所は特商法の頁に並べる
  contact: "bestlifeconsulting.inc@gmail.com",
};

const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}[.][a-z]{2,}$/;
const cache = new WeakMap();

export function makeMailCfg(h) {
  const { db, logInbound, changes } = h;

  // いまの設定。1 回の呼び出しの中では表を 1 回だけ読む
  async function get(env) {
    if (cache.has(env)) return cache.get(env);
    let cfg;
    if (!env.B_STORE) {
      cfg = { from: env.MAIL_FROM || "", from_name: "", reply_to: "", scope: env.MAIL_OPEN === "1" ? "all" : "test", store: "demo", updated_at: null, updated_by: null };
    } else {
      const rows = await db(env, "GET", `settings?select=key,value,updated_at,updated_by&key=in.(${MAIL_KEYS.join(",")})`);
      const m = Object.fromEntries(rows.map((r) => [r.key, r]));
      const v = (k) => (m[k] ? String(m[k].value || "") : "");
      const last = rows.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;
      cfg = {
        from: v("mail_from") || env.MAIL_FROM || "",
        from_name: v("mail_from_name"),
        reply_to: v("mail_reply_to"),
        scope: MAIL_SCOPES.includes(v("mail_scope")) ? v("mail_scope") : "test",
        store: "production",
        updated_at: last ? last.updated_at : null, updated_by: last ? last.updated_by : null,
      };
    }
    cache.set(env, cfg);
    return cfg;
  }

  // 送る道具に渡す形。表示名があれば { email, name }
  function fromField(cfg) {
    return cfg.from_name ? { email: cfg.from, name: cfg.from_name } : cfg.from;
  }

  // 誰にでも送ってよいか（テスト宛ての判定は bin3 の mailAllowed が行う）
  function openFor(cfg, kind) {
    if (cfg.scope === "all") return true;
    if (cfg.scope === "login") return !MARKETING_KINDS.includes(String(kind || ""));
    return false;
  }

  function checkEmail(v, { allowSender = false } = {}) {
    const s = String(v || "").trim().toLowerCase();
    if (!EMAIL_RE.test(s)) return { ok: false };
    if (allowSender && !SENDER_DOMAINS.includes(s.split("@")[1])) return { ok: false, sender_domain: true };
    return { ok: true, value: s };
  }

  // 差し替える。渡した欄だけ変える。actor は画面ならメール、AI なら mcp
  async function set(env, patch = {}, actor) {
    if (!env.B_STORE) return { ok: false, error: "demo_store" };
    const rows = [];
    const now = new Date().toISOString();
    const by = String(actor || "").slice(0, 200);
    if ("from" in patch) {
      const c = checkEmail(patch.from, { allowSender: true });
      if (!c.ok) return { ok: false, error: c.sender_domain ? "sender_domain_not_allowed" : "bad_from", allowed_domains: SENDER_DOMAINS };
      rows.push({ key: "mail_from", value: c.value });
    }
    if ("from_name" in patch) {
      const s = String(patch.from_name == null ? "" : patch.from_name).trim();
      if (s.length > 40 || /[<>"\r\n]/.test(s)) return { ok: false, error: "bad_from_name", note: "40 文字まで。< > \" と改行は使えない" };
      rows.push({ key: "mail_from_name", value: s });
    }
    if ("reply_to" in patch) {
      const raw = String(patch.reply_to == null ? "" : patch.reply_to).trim();
      if (raw) {
        const c = checkEmail(raw);
        if (!c.ok) return { ok: false, error: "bad_reply_to", note: "メールの住所。外すときは空にする" };
        rows.push({ key: "mail_reply_to", value: c.value });
      } else rows.push({ key: "mail_reply_to", value: "" });
    }
    if ("scope" in patch) {
      if (!MAIL_SCOPES.includes(String(patch.scope))) return { ok: false, error: "bad_scope", allowed: MAIL_SCOPES };
      rows.push({ key: "mail_scope", value: String(patch.scope) });
    }
    if (!rows.length) return { ok: false, error: "nothing_to_change", fields: ["from", "from_name", "reply_to", "scope"] };
    const before = await get(env);
    await db(env, "POST", "settings?on_conflict=key", rows.map((r) => ({ ...r, updated_at: now, updated_by: by })), "resolution=merge-duplicates,return=minimal");
    cache.delete(env);
    const after = await get(env);
    const changed = ["from", "from_name", "reply_to", "scope"].filter((k) => before[k] !== after[k]);
    await logInbound(env, "mail_settings_set", { actor: by, changed }, { ok: true }, 200);
    // 便 8d：変えた記録（前と後）。元に戻すと前の値を表に書き戻す
    if (changes) {
      const KEY = { from: "mail_from", from_name: "mail_from_name", reply_to: "mail_reply_to", scope: "mail_scope" };
      const LABEL = { from: "送り元", from_name: "表示名", reply_to: "返信先", scope: "誰に送るか" };
      for (const k of changed) await changes.record(env, { kind: "setting", target: KEY[k], before: before[k] ?? "", after: after[k] ?? "", summary: `メールの${LABEL[k]}を変えた`, actor: by });
    }
    return { ok: true, changed, settings: view(after) };
  }

  function view(cfg) {
    return { from: cfg.from, from_name: cfg.from_name, reply_to: cfg.reply_to, scope: cfg.scope, store: cfg.store, updated_at: cfg.updated_at, updated_by: cfg.updated_by };
  }

  // メールの末尾（特定電子メール法の表記と配信停止）。テキストと HTML の 2 つ
  function footer(env, cfg, unsubUrl) {
    if (!env.B_STORE) {
      return {
        text: `\n\n――――\n言語化ラボ（デモ）— 架空の事業者です。このメールはデモの試しで送っています。\n配信を止める：${unsubUrl}`,
        html: "言語化ラボ（デモ）— 架空の事業者です。このメールはデモの試しで送っています。<br><a href=\"" + unsubUrl + "\">配信を止める</a>",
      };
    }
    const origin = env.PUBLIC_ORIGIN || "https://utage-alt-demo.gameister1.workers.dev";
    const contact = cfg.reply_to || ORG.contact;
    const law = `${origin}/legal/tokushoho.html`;
    return {
      text: `\n\n――――\n${ORG.brand}（${ORG.company}）\n${ORG.address}\nお問い合わせ：${contact}\n特定商取引法に基づく表記：${law}\n配信を止める：${unsubUrl}`,
      html: `${esc(ORG.brand)}（${esc(ORG.company)}）<br>${esc(ORG.address)}<br>お問い合わせ：${esc(contact)}<br><a href="${law}">特定商取引法に基づく表記</a>　<a href="${unsubUrl}">配信を止める</a>`,
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { get, set, view, fromField, openFor, footer, checkEmail };
}

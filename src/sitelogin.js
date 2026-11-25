// 公式サイトの作り直し 便 1（2026-11-25 Naoki OK）：公式サイト（lp.shia2n.jp）だけで効くログイン
// - 会員サイト（ラボシアニン・lab.shia2n.jp）のログインとは別。メールに届く 6 けたの確認コードで入り、印（cookie lab_site）は lp の住所だけに付く
// - 台帳（customers）にいる人だけにコードを送る。いない住所にも同じ返事を返す（登録の有無を外に出さない）
// - 記録は出来事（events）に 1 件ずつ残す：site_login_code（送った）・site_login_failed（違うコード）・site_login（入った）
// - 送る数：1 人 10 分に 3 通・1 日に 10 通まで。コードの期限は 10 分・試せるのは 1 つのコードに 5 回まで
export const SITE_CODE_MINUTES = 10;
export const SITE_CODE_TRIES = 5;
export const SITE_CODE_LIMITS = [{ minutes: 10, max: 3 }, { minutes: 1440, max: 10 }];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sixDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}

// h：{ db, addEvent, mail(env, { to, subject, text }), codeHash(env, cid, eventKey, code), siteToken(env, cid) }
export function makeSiteLogin(h) {
  const { db, addEvent } = h;

  async function personByEmail(env, email) {
    const [c] = await db(env, "GET", `customers?select=id,email,name&email=eq.${encodeURIComponent(email)}`);
    return c || null;
  }
  async function eventsSince(env, cid, types, minutes) {
    const since = new Date(Date.now() - minutes * 60e3).toISOString();
    return db(env, "GET", `events?select=id,type,payload,occurred_at&customer_id=eq.${cid}&type=in.(${types.join(",")})&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=200`);
  }

  async function sendCode(env, { email } = {}) {
    const e = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return { ok: false, error: "bad_email" };
    const c = await personByEmail(env, e);
    if (!c) return { ok: true }; // 台帳にいない住所にも同じ返事
    const longest = Math.max(...SITE_CODE_LIMITS.map((l) => l.minutes));
    const sent = await eventsSince(env, c.id, ["site_login_code"], longest);
    for (const l of SITE_CODE_LIMITS) {
      const from = Date.now() - l.minutes * 60e3;
      if (sent.filter((r) => Date.parse(r.occurred_at) >= from).length >= l.max) return { ok: false, error: "too_many", minutes: l.minutes };
    }
    const code = sixDigits();
    const key = crypto.randomUUID();
    const exp = new Date(Date.now() + SITE_CODE_MINUTES * 60e3).toISOString();
    await addEvent(env, c.id, "site_login_code", { key, hash: await h.codeHash(env, c.id, key, code), exp }, "site");
    const text = `シアニン公式サイトのログインの確認コードです。\n\n${code}\n\n${SITE_CODE_MINUTES} 分以内に、ログインの画面に入力してください。\nお心当たりがなければ、このメールは破棄してください。`;
    const m = await h.mail(env, { to: c.email, subject: `確認コード ${code}（シアニン公式サイトのログイン）`, text });
    if (!m.ok) return { ok: false, error: "send_failed" };
    return { ok: true };
  }

  async function verify(env, { email, code } = {}) {
    const e = String(email || "").trim().toLowerCase();
    const k = String(code || "").trim();
    if (!EMAIL_RE.test(e)) return { ok: false, error: "bad_email" };
    if (!/^\d{6}$/.test(k)) return { ok: false, error: "bad_code" };
    const c = await personByEmail(env, e);
    if (!c) return { ok: false, error: "bad_code" };
    const rows = await eventsSince(env, c.id, ["site_login_code", "site_login_failed", "site_login"], SITE_CODE_MINUTES);
    const last = rows.find((r) => r.type === "site_login_code");
    if (!last || !last.payload || Date.parse(last.payload.exp) <= Date.now()) return { ok: false, error: "no_code" };
    const key = last.payload.key;
    if (rows.some((r) => r.type === "site_login" && r.payload && r.payload.key === key)) return { ok: false, error: "no_code" }; // 使ったコード
    const fails = rows.filter((r) => r.type === "site_login_failed" && r.payload && r.payload.key === key).length;
    if (fails >= SITE_CODE_TRIES) return { ok: false, error: "too_many_tries" };
    if ((await h.codeHash(env, c.id, key, k)) !== last.payload.hash) {
      await addEvent(env, c.id, "site_login_failed", { key }, "site");
      return { ok: false, error: "bad_code", left: Math.max(0, SITE_CODE_TRIES - fails - 1) };
    }
    await addEvent(env, c.id, "site_login", { key }, "site");
    return { ok: true, token: await h.siteToken(env, c.id), name: c.name || "" };
  }

  return { sendCode, verify };
}

// 戻り先は同じ住所の中の道すじだけ（外の住所へは飛ばさない）
export function safeNext(v) {
  const s = String(v || "");
  return /^[/](?![/\\])[^\s]*$/.test(s) && s.length <= 300 ? s : "/";
}

// 公式サイトのログインの画面（草案 v0.7 の見た目：紙の白・墨・赤ペン 1 色）
export function siteLoginHtml({ next = "/", lab = "https://lab.shia2n.jp" } = {}) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = esc(safeNext(next));
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>ログイン｜シアニン</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
*{box-sizing:border-box}
body{margin:0;background:#fcfbf8;color:#1a1a1a;font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;font-size:16px;line-height:1.8}
a{color:#1a1a1a}
:focus-visible{outline:3px solid #1a1a1a;outline-offset:3px}
header{border-bottom:1px solid #d9d6cf}
header div{max-width:1280px;margin:0 auto;padding:16px 24px}
header a{font-weight:700;font-size:24px;text-decoration:none}
main{max-width:480px;margin:0 auto;padding:64px 24px 96px}
h1{margin:0 0 8px;font-size:32px;line-height:1.4}
p{margin:0 0 24px}
form{display:flex;flex-direction:column;gap:8px;margin:0 0 24px}
label{font-weight:700}
input{font:inherit;font-size:16px;padding:8px 16px;min-height:48px;border:2px solid #8a867d;border-radius:8px;background:#fff;width:100%}
input[aria-invalid=true]{border-color:#c8102e}
button{margin-top:8px;font:inherit;font-weight:700;font-size:16px;min-height:48px;border:0;border-radius:8px;background:#c8102e;color:#fff;cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}
.err{margin:0;color:#c8102e;font-weight:700;min-height:1.8em}
.note{font-size:14px;color:#555}
.sub{border-top:1px solid #d9d6cf;padding-top:24px}
.link{background:none;color:#1a1a1a;text-decoration:underline;font-weight:400;min-height:44px;padding:0;text-align:left;margin:0}
[hidden]{display:none!important}
</style>
</head>
<body>
<header><div><a href="/">シアニン</a></div></header>
<main>
<h1>ログイン</h1>
<p>ご登録のメールアドレスに、確認コードをお送りします。</p>
<form id="f1" novalidate>
<label for="email">メールアドレス</label>
<input id="email" type="email" autocomplete="email" required aria-describedby="e1">
<p id="e1" class="err" aria-live="polite"></p>
<button type="submit" id="b1">確認コードを送る</button>
</form>
<form id="f2" novalidate hidden>
<p id="sent" class="note" aria-live="polite"></p>
<label for="code">確認コード（6けた）</label>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required aria-describedby="e2">
<p id="e2" class="err" aria-live="polite"></p>
<button type="submit" id="b2">ログイン</button>
<button type="button" class="link" id="again">メールアドレスを入力し直す</button>
</form>
<div class="sub">
<p class="note">まだ登録していない方は、<a href="/">トップページの無料会員登録</a>からご登録いただけます。</p>
<p class="note">このログインは公式サイト専用です。しあらぼの会員の方は、<a href="${esc(lab)}/app">しあらぼ会員サイトのログイン</a>をご利用ください。</p>
</div>
</main>
<script>
{
const NEXT = "${n}";
const $ = (id) => document.getElementById(id);
const WHY = { bad_email: "メールアドレスの形が正しくありません。「@」を含めて入力してください。", too_many: "確認コードを続けて送りすぎました。しばらく時間をおいてから、もう一度お試しください。", send_failed: "メールを送れませんでした。時間をおいて、もう一度お試しください。", bad_code: "確認コードが違います。メールに書かれた6けたの数字を入力してください。", no_code: "確認コードの期限が切れたか、すでに使われています。「メールアドレスを入力し直す」から、新しいコードを受け取ってください。", too_many_tries: "続けて間違えたため、このコードは使えなくなりました。新しいコードを受け取ってください。" };
const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({ ok: false, error: "send_failed" }));
let email = "";
$("f1").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  email = $("email").value.trim();
  $("e1").textContent = ""; $("email").removeAttribute("aria-invalid");
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { $("e1").textContent = WHY.bad_email; $("email").setAttribute("aria-invalid", "true"); $("email").focus(); return; }
  $("b1").disabled = true;
  const r = await post("/api/p/login/code", { email });
  $("b1").disabled = false;
  if (!r.ok) { $("e1").textContent = WHY[r.error] || WHY.send_failed; $("email").focus(); return; }
  $("f1").hidden = true; $("f2").hidden = false;
  $("sent").textContent = email + " に確認コードをお送りしました（ご登録がある場合だけ届きます）。届かないときは、迷惑メールのフォルダもご確認ください。";
  $("code").focus();
});
$("f2").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("e2").textContent = ""; $("code").removeAttribute("aria-invalid");
  $("b2").disabled = true;
  const r = await post("/api/p/login/verify", { email, code: $("code").value.trim() });
  $("b2").disabled = false;
  if (r.ok) { location.href = NEXT; return; }
  $("e2").textContent = (WHY[r.error] || WHY.bad_code) + (r.left != null && r.error === "bad_code" ? "（あと " + r.left + " 回）" : "");
  $("code").setAttribute("aria-invalid", "true"); $("code").focus();
});
$("again").addEventListener("click", () => { $("f2").hidden = true; $("f1").hidden = false; $("code").value = ""; $("e2").textContent = ""; $("email").focus(); });
}
</script>
</body>
</html>`;
}

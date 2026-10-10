// 便 R1：ロボット判定（Cloudflare Turnstile）を lab の公開の頁（フォーム・登録）に出す。
// 表示用の鍵はサーバーが返したときだけ使う（判定を掛けていないときは何も出さない）
let loading = null;
function loadTurnstile() {
  if (!loading) {
    loading = new Promise((res) => {
      if (window.turnstile) { res(window.turnstile); return; }
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => res(window.turnstile || null);
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }
  return loading;
}

// box：判定の欄を出す要素。戻り値は null（判定なし）か { get, reset, broken }
export async function mountBotCheck(box, siteKey) {
  if (!box || !siteKey) return null;
  const ts = await loadTurnstile();
  if (!ts) return { get: () => "", reset() {}, broken: true };
  let token = "";
  const id = ts.render(box, {
    sitekey: siteKey,
    callback: (t) => { token = t; },
    "expired-callback": () => { token = ""; },
    "error-callback": () => { token = ""; },
  });
  return { get: () => token, reset() { token = ""; try { ts.reset(id); } catch (_) {} } };
}

// 送る前の確かめ。止めるときは画面に出す文を返し、通すときは空の文字
export function botWaitMessage(bot) {
  if (!bot || bot.get()) return "";
  return bot.broken ? "確認のチェックを読み込めませんでした。ページを開き直してください" : "確認のチェックが終わるまでお待ちください";
}

export const BOT_ERROR_MESSAGE = {
  bot_check_failed: "確認のチェックが通りませんでした。チェックをやり直してから、もう一度送ってください",
  too_many: "短い時間に何度も送られています。時間をおいてもう一度お試しください",
};

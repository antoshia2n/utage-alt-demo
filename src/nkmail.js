// note攻略くんの知らせのメール（2026-11-12 note攻略くん 攻略の8段 便4・X攻略くんの xkmail.js と同じ形を月で回す）。
// note攻略くんは、メールをオンにした人が開いているあいだに今の状態を na_settings.ladder.mail に残す。
// ここはそれを読んで、毎月 2 日の 20 時台（数字が入った・月次レビューを始める）と、月末の 20 時台（今月の記録を埋める）に、ログインのメールアドレスへ送るだけ。
// 中身は数えない（数えるのは note攻略くんの画面と同じ式で、向こうに 1 か所）。宛先は member の auth_uid から引く（自分で宛先を書かせない）。
const APP = "https://note-koryaku.shia2n.jp";
const JST = 9 * 3600e3;

export function slotOf(now) {
  const d = new Date(now + JST), h = d.getUTCHours(), day = d.getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (h !== 20) return null;
  if (day === 2) return "start";
  if (day === last) return "end";
  return null;
}
const jstDay = (iso) => { const t = Date.parse(iso || ""); if (!t) return ""; const d = new Date(t + JST); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const rowsOf = (lines, rows) => { if ((rows || []).length) { lines.push("", "打ち手ごと（予約・公開した数 / 月の型の数）"); rows.forEach((r) => lines.push(`・${r.t}：${r.done} / ${r.plan}`)); } };

export function buildMail(kind, m, now) {
  const lines = [], old = m.at && now - Date.parse(m.at) > 2 * 864e5 ? `（中身は ${jstDay(m.at)} に開いたときの状態）` : "";
  const tail = () => {
    if (m.next) lines.push("", `次にやること：${m.next}`);
    if (m.sos) lines.push("", "止まっているところがあります。下の相談文をシアニンに送ってください", "", m.sos);
    if ((m.vids || []).length) { lines.push("", "参考動画"); m.vids.forEach((v) => lines.push(`・${v.t || "動画"}　${v.u}`)); }
    lines.push("", `[[note攻略くんを開く|${APP}]]`);
    if (old) lines.push("", old);
  };
  if (kind === "start") {
    lines.push(`見る相手の${m.pmo || "先月"}の数字が入りました。月次レビューで先月を締めて、今月を決めてください`);
    lines.push("", `${m.pmo || "先月"}の実行率：${m.prate == null ? "出せない（④戦術の月の型でマスに打ち手を結ぶ）" : m.prate + "%"}　目安は 85%`);
    rowsOf(lines, m.prows);
    if ((m.rev || []).length) lines.push("", `月次レビューの残り：${m.rev.join("・")}`);
    lines.push("", "今月のコミット");
    if ((m.cm || []).length) m.cm.forEach((t) => lines.push(`・${t}`)); else lines.push("まだ決めていません。④戦術の「今月のコミット」で決めてください");
    tail();
    return { subject: `【note攻略くん】${m.pmo || "先月"}の数字が入りました・月次レビュー`, text: lines.join("\n") };
  }
  lines.push(`${m.mo || "今月"}の実行率：${m.rate == null ? "出せない（④戦術の月の型でマスに打ち手を結ぶ）" : m.rate + "%"}　目安は 85%`);
  rowsOf(lines, m.rows);
  lines.push("", "今月の記録を埋めてください：⑦記録の有料記事の売れた数・ダッシュボードのスクショ");
  tail();
  return { subject: `【note攻略くん】${m.mo || "今月"}のまとめと、記録の残り`, text: lines.join("\n") };
}

export function makeNkMail({ rawDb, logInbound, send }) {
  async function run(env, { now = Date.now(), kind } = {}) {
    const k = kind || slotOf(now); if (!k) return { skipped: true };
    const rows = await rawDb(env, "GET", "na_settings?select=user_id,ladder&ladder->ntf->>mailOn=eq.true");
    const out = { kind: k, sent: 0, no_mail: 0, no_snap: 0, failed: 0 };
    for (const r of rows || []) {
      const m = r.ladder && r.ladder.mail;
      if (!m || !m.mo) { out.no_snap++; continue; }
      const [mem] = await rawDb(env, "GET", `member?select=email&auth_uid=eq.${encodeURIComponent(r.user_id)}&limit=1`);
      if (!mem || !mem.email) { out.no_mail++; continue; }
      const { subject, text } = buildMail(k, m, now);
      const res = await send(env, { to: mem.email, subject, text });
      if (res && res.ok) out.sent++; else { out.failed++; out.error = res && res.error; }
    }
    await logInbound(env, "nk_mail", { kind: k }, out, out.failed ? 500 : 200);
    return out;
  }
  return { run };
}

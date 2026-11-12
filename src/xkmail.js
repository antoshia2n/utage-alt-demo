// X攻略くんの知らせのメール（2026-11-12 X攻略くん便 5・Naoki「週次レビューや実行の記録なども通知」）。
// X攻略くんは、メールをオンにした人が開いているあいだに今の状態を xa_settings.ladder.mail に残す。
// ここはそれを読んで、日曜 20 時台（週のまとめ）と月曜 7 時台（今週のコミット）に、ログインのメールアドレスへ送るだけ。
// 中身は数えない（数えるのは X攻略くんの画面と同じ式で、向こうに 1 か所）。宛先は member の auth_uid から引く（自分で宛先を書かせない）。
const APP = "https://x-koryaku.shia2n.jp";
const JST = 9 * 3600e3;

export function slotOf(now) {
  const d = new Date(now + JST), dow = d.getUTCDay(), h = d.getUTCHours();
  if (dow === 0 && h === 20) return "week";
  if (dow === 1 && h === 7) return "mon";
  return null;
}
const jstDay = (iso) => { const t = Date.parse(iso || ""); if (!t) return ""; const d = new Date(t + JST); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

export function buildMail(kind, m, now) {
  const lines = [], old = m.at && now - Date.parse(m.at) > 2 * 864e5 ? `（中身は ${jstDay(m.at)} に開いたときの状態）` : "";
  if (kind === "week") {
    lines.push(`${m.wk}の実行率：${m.rate == null ? "まだ出せない（④戦術で打ち手の本数を決める）" : m.rate + "%"}　目安は 85%`);
    if ((m.rows || []).length) { lines.push("", "打ち手ごと"); m.rows.forEach((r) => lines.push(`・${r.t}：${r.done} / ${r.plan}`)); }
    if ((m.rev || []).length) lines.push("", `週次レビューの残り：${m.rev.join("・")}`);
    if (m.next) lines.push("", `次にやること：${m.next}`);
    if (m.sos) lines.push("", "止まっているところがあります。下の相談文をシアニンに送ってください", "", m.sos);
    if ((m.vids || []).length) { lines.push("", "参考動画"); m.vids.forEach((v) => lines.push(`・${v.t || "動画"}　${v.u}`)); }
    lines.push("", `[[X攻略くんを開く|${APP}]]`);
    if (old) lines.push("", old);
    return { subject: `【X攻略くん】${m.wk}のまとめと、次にやること`, text: lines.join("\n") };
  }
  lines.push("今週のコミット");
  if ((m.cm || []).length) m.cm.forEach((t) => lines.push(`・${t}`)); else lines.push("まだ決めていません。④戦術の「今週のコミット」で決めてください");
  if (m.next) lines.push("", `次にやること：${m.next}`);
  lines.push("", `[[X攻略くんを開く|${APP}]]`);
  if (old) lines.push("", old);
  return { subject: "【X攻略くん】今週のコミット", text: lines.join("\n") };
}

export function makeXkMail({ rawDb, logInbound, send }) {
  async function run(env, { now = Date.now(), kind } = {}) {
    const k = kind || slotOf(now); if (!k) return { skipped: true };
    const rows = await rawDb(env, "GET", "xa_settings?select=user_id,ladder&ladder->ntf->>mailOn=eq.true");
    const out = { kind: k, sent: 0, no_mail: 0, no_snap: 0, failed: 0 };
    for (const r of rows || []) {
      const m = r.ladder && r.ladder.mail;
      if (!m || !m.wk) { out.no_snap++; continue; }
      const [mem] = await rawDb(env, "GET", `member?select=email&auth_uid=eq.${encodeURIComponent(r.user_id)}&limit=1`);
      if (!mem || !mem.email) { out.no_mail++; continue; }
      const { subject, text } = buildMail(k, m, now);
      const res = await send(env, { to: mem.email, subject, text });
      if (res && res.ok) out.sent++; else { out.failed++; out.error = res && res.error; }
    }
    await logInbound(env, "xk_mail", { kind: k }, out, out.failed ? 500 : 200);
    return out;
  }
  return { run };
}

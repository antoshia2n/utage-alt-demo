// スキルズの管理 3便目（2026-11-15 Naoki OK 15:45）：生徒に出しているスキルを受け取るカード。2026-11-27 ChatGPT での入れ方を足した。
// 正本は GitHub の shia2n-skills の public の枝（生徒に出す版だけ）。zip は押したときにその場で作る（shia2n-mcp の SkillsReader）。
// 生徒の画面の 2 つの版（最新・生徒用）の両方から読む。中で読む部品は common.js だけ。
import { api, esc } from "/js/common.js";

const STEPS = `<ol class="note" style="margin:8px 0 0;padding-left:1.4em;line-height:1.7">
  <li>下の「ダウンロード」で zip を受け取る（開かずにそのまま）</li>
  <li>Claude（claude.ai）の「設定」→「機能」→「スキル」で、その zip を上げる</li>
  <li>新しいチャットで、スキル名を添えて頼む（例：「cyaninn-x-article-zero-to-one で、このメモから X 記事を書いて」）</li>
</ol>
<p class="note" style="margin:8px 0 0">ChatGPT で使うとき：zip を開き、中の SKILL.md を ChatGPT の「プロジェクト」のファイルに入れる。そのプロジェクトの新しいチャットで、スキル名を添えて頼む</p>`;

export async function mountSkills(box, token) {
  if (!box) return;
  const r = await api("/api/me/skills", { token });
  if (!r.ok || !Array.isArray(r.skills) || !r.skills.length) return;
  const card = (s) => `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid var(--line,#e5e5e5);padding-top:10px;margin-top:10px;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><b>${esc(s.name)}</b> <span class="pill">版 ${esc(s.version || "")}</span><div class="note" style="margin:2px 0 0">${esc(s.purpose || "")}</div></div>
      <button class="btn small" type="button" data-skill="${esc(s.name)}">ダウンロード</button>
    </div>`;
  box.insertAdjacentHTML("beforeend", `<div class="card" id="skills-card"><h3>シアニンのスキル</h3>
    <p class="note" style="margin:0">自分の Claude に入れて使えます。版が上がったら、ここからもう一度受け取ってください。</p>${STEPS}
    ${r.skills.map(card).join("")}<p class="note hidden" id="skills-msg" style="margin:8px 0 0"></p></div>`);
  const msg = box.querySelector("#skills-msg");
  box.querySelectorAll("[data-skill]").forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.skill;
    b.disabled = true; const label = b.textContent; b.textContent = "用意しています…";
    msg.classList.add("hidden");
    try {
      const res = await fetch(`/api/me/skills/${encodeURIComponent(name)}.zip`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const fn = (/filename="([^"]+)"/.exec(cd) || [])[1] || `${name}.zip`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      b.textContent = "受け取りました";
      setTimeout(() => { b.textContent = label; b.disabled = false; }, 2500);
    } catch (e) {
      b.textContent = label; b.disabled = false;
      msg.textContent = "受け取れませんでした。少し待ってからもう一度押してください。"; msg.classList.remove("hidden");
    }
  }));
}

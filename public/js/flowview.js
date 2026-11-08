// 便 T5（2026-11-08 Naoki OK 09:23）：シナリオの「流れ」。部品を相手が通る順に 1 列に並べる。
//   カードごとに：相手に見える中身・状態・配信タイミング・「Naoki が作るもの」・承認待ち（その場で承認／差し戻し）・編集・AI と作る。
//   データは /api/admin/campaigns/<id>/flow。AI の案は b_ai_drafts（src/flow.js）。
const STATE = {
  running: ["公開中", "fl-on"], test: ["配信中・テスト配信", "fl-on"], draft: ["下書き", "fl-off"], stopped: ["停止中", "fl-off"],
};

export function makeFlowView({ $, api, esc, getToken, fail, openPart }) {
  let campId = null;
  let data = null;
  let onlyMine = false;
  const editing = new Set();
  const asking = new Set();
  let status = "";
  let root = null;

  async function load(el, id) {
    root = el; campId = id;
    if (!id || id === "all") {
      root.innerHTML = '<p class="note">シナリオを 1 つ選ぶと、相手が通る順に部品が並びます。</p>';
      return;
    }
    const r = await api(`/api/admin/campaigns/${encodeURIComponent(id)}/flow`, { token: getToken() });
    if (!r.ok) { root.innerHTML = `<p class="note">読めませんでした（${esc(r.error || r.status)}）。表 b_ai_drafts が無いときは、SQL Editor で bt5_ai_drafts.sql を流すと出ます。</p>`; return; }
    data = r;
    render();
  }

  const lines = (t) => esc(t || "");
  function card(c, n, stageStart) {
    const st = c.approvals.length ? ["承認待ち", "fl-wait"] : (STATE[c.state] || [c.state, "fl-off"]);
    const k = esc(c.key);
    const todo = c.todos.length ? `<div class="fl-todo"><div class="fl-todo-h">Naoki が作るもの</div><ul>${c.todos.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : "";
    const isEdit = editing.has(c.key);
    const body = c.text && !isEdit ? `<div class="fl-text">${lines(c.text)}</div>` : "";
    const edit = isEdit ? `<div class="fl-edit"><label for="fl-e-${k}">本文（⌘／Ctrl＋Enter で保存）</label>
        <textarea id="fl-e-${k}" data-edit="${k}" rows="7">${esc(c.text)}</textarea>
        <div class="fl-row fl-end"><button type="button" class="btn ghost small" data-cancel="${k}">キャンセル</button><button type="button" class="btn small" data-save="${k}">保存</button></div></div>` : "";
    const ap = c.approvals.map((x) => `<div class="fl-ap"><b>承認待ち</b><span>${esc(x.what)}</span>${x.body != null ? `<div class="fl-text fl-ap-body">${lines(x.body)}</div>` : ""}
        <span class="fl-row fl-end"><button type="button" class="btn ghost small" data-decide="${esc(x.id)}" data-d="reject">差し戻す</button><button type="button" class="btn small" data-decide="${esc(x.id)}" data-d="approve">承認して実行</button></span></div>`).join("");
    const ai = c.ai;
    let aiBox = "";
    if (asking.has(c.key)) {
      aiBox = `<div class="fl-ai"><label for="fl-n-${k}">AI へのひとこと（どう直したいか）</label>
        <textarea id="fl-n-${k}" rows="2" placeholder="例：失敗談から入って、最後にブログへ誘導。メンシプは一言だけ"></textarea>
        <div class="note">依頼文に入るもの：シナリオの名前・この配信と前後の配信・配信タイミング・ひとこと。AI はマーケくんの道具で前後を読みます</div>
        <div class="fl-row fl-end"><button type="button" class="btn ghost small" data-aiclose="${k}">キャンセル</button><button type="button" class="btn small" data-aiask="${k}">依頼文をコピー</button></div></div>`;
    } else if (ai && ai.status === "asked") {
      aiBox = `<div class="fl-ai fl-ai-wait"><span>AI の案を待っています（ひとこと：${esc(ai.note || "なし")}）。依頼文を claude.ai のチャットに貼ってください。</span>
        <span class="fl-row"><button type="button" class="btn ghost small" data-aicopy="${k}">依頼文をもう一度コピー</button><button type="button" class="btn ghost small" data-aidrop="${esc(ai.id)}">取り消す</button><button type="button" class="btn ghost small" data-reload>読み直す</button></span></div>`;
    } else if (ai && ai.status === "ready") {
      aiBox = `<div class="fl-ai fl-ai-has"><div class="fl-row"><b>AI の案</b><span class="note">ひとこと：${esc(ai.note || "なし")}</span></div>
        <div class="fl-two"><div><div class="note">今の本文</div><div class="fl-text">${lines(c.text)}</div></div>
        <div><label class="note" for="fl-d-${k}">AI の案（直してから採用できる）</label><textarea id="fl-d-${k}" rows="9">${esc(ai.draft || "")}</textarea></div></div>
        <div class="fl-row fl-end"><button type="button" class="btn ghost small" data-aiagain="${k}">もう一度（ひとことを足す）</button><button type="button" class="btn ghost small" data-aidrop="${esc(ai.id)}">採用しない</button><button type="button" class="btn small" data-aiadopt="${esc(ai.id)}" data-key="${k}">${c.state === "running" || c.state === "test" ? "採用（配信中の本文を入れ替える）" : "採用"}</button></div></div>`;
    }
    const acts = [
      c.editable && !isEdit ? `<button type="button" class="btn ghost small" data-editon="${k}">編集</button>` : "",
      c.ai_ok && !isEdit && !asking.has(c.key) && !(ai && ai.status === "ready") ? `<button type="button" class="btn small fl-aibtn" data-aiopen="${k}">AI と作る</button>` : "",
      c.type === "page" || c.type === "form" || c.type === "booking" ? `<button type="button" class="btn ghost small" data-open="${k}">開く</button>` : "",
    ].join("");
    const meta = [c.audience ? `配信対象：${c.audience}` : "", c.note || "", c.uses_default ? "決まった文のまま" : ""].filter(Boolean).map(esc).join("・");
    return `${stageStart ? `<div class="fl-stage">${esc(c.stage)}</div>` : ""}
      <div class="fl-item"><div class="fl-rail"><div class="fl-n">${n}</div><div class="fl-line" aria-hidden="true"></div></div>
      <article class="fl-card${c.todos.length ? " fl-hastodo" : ""}${c.approvals.length ? " fl-haswait" : ""}" aria-label="${esc(c.name)}">
        <div class="fl-row"><span class="fl-kind">${esc(c.kind)}</span><b class="fl-name">${esc(c.name)}</b><span class="fl-st ${st[1]}">${esc(st[0])}</span><span class="fl-when">${esc(c.when || "")}</span></div>
        ${todo}${body}${edit}${ap}${aiBox}
        <div class="fl-row">${acts}<span class="note">${meta}</span></div>
      </article></div>`;
  }

  function render() {
    if (!root || !data) return;
    const cards = onlyMine ? data.cards.filter((c) => c.todos.length || c.approvals.length || (c.ai && c.ai.status === "ready")) : data.cards;
    let prev = "";
    const items = cards.map((c, i) => { const s = c.stage !== prev; prev = c.stage; return card(c, data.cards.indexOf(c) + 1, s); }).join("");
    root.innerHTML = `
      <div class="fl-sum">
        <div class="fl-box"><div class="note">部品</div><b>${data.counts.parts}</b></div>
        <div class="fl-box"><div class="note">Naoki が作る</div><b class="fl-ink">${data.counts.todo}</b></div>
        <div class="fl-box"><div class="note">承認待ち</div><b>${data.counts.pending}</b></div>
        <div class="fl-box"><div class="note">AI の案</div><b>${data.cards.filter((c) => c.ai && c.ai.status === "ready").length}</b></div>
      </div>
      <div class="fl-row"><button type="button" class="btn ghost small" id="fl-mine" aria-pressed="${onlyMine}">${onlyMine ? "✓ " : ""}Naoki が作るもの・承認待ちだけ</button>
        ${data.other_pending ? `<span class="note">このシナリオ以外の承認待ち ${data.other_pending} 件は「AI と承認」にあります</span>` : ""}</div>
      <div role="status" class="fl-status" id="fl-status">${esc(status)}</div>
      <div class="fl-list">${items || '<p class="note">当たる部品がありません</p>'}</div>`;
    wire();
  }

  const findCard = (key) => data.cards.find((c) => c.key === key);
  const say = (t) => { status = t; const el = $("fl-status"); if (el) el.textContent = t; };
  async function reload(msg) { if (msg) status = msg; await load(root, campId); }

  async function saveText(c, text) {
    let r;
    if (c.type === "step") r = await api("/api/admin/steps", { method: "POST", token: getToken(), body: { id: Number(c.id), body: text } });
    else if (c.type === "line_invite") r = await api("/api/admin/line/invite", { method: "POST", token: getToken(), body: { account: c.id, text } });
    else return fail("この部品はここでは編集できません。「開く」から編集してください");
    if (!r.ok) return fail("保存できませんでした（" + (r.error || r.status) + "）");
    editing.delete(c.key);
    await reload(`「${c.name}」を編集で保存しました`);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  }

  function wire() {
    $("fl-mine").addEventListener("click", () => { onlyMine = !onlyMine; render(); });
    root.querySelectorAll("[data-editon]").forEach((b) => b.addEventListener("click", () => { editing.add(b.dataset.editon); render(); const t = root.querySelector(`[data-edit="${CSS.escape(b.dataset.editon)}"]`); if (t) t.focus(); }));
    root.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => { editing.delete(b.dataset.cancel); render(); const e = root.querySelector(`[data-editon="${CSS.escape(b.dataset.cancel)}"]`); if (e) e.focus(); }));
    root.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => { const c = findCard(b.dataset.save); const t = root.querySelector(`[data-edit="${CSS.escape(c.key)}"]`); saveText(c, t.value); }));
    root.querySelectorAll("[data-edit]").forEach((t) => t.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); saveText(findCard(t.dataset.edit), t.value); }
      if (ev.key === "Escape") { editing.delete(t.dataset.edit); render(); }
    }));
    root.querySelectorAll("[data-decide]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await api(`/api/admin/approvals/${b.dataset.decide}`, { method: "POST", token: getToken(), body: { decision: b.dataset.d } });
      if (!r.ok) { b.disabled = false; return fail("できませんでした（" + (r.error || r.status) + "）"); }
      await reload(b.dataset.d === "approve" ? "承認して実行しました" : "差し戻しました");
    }));
    root.querySelectorAll("[data-aiopen]").forEach((b) => b.addEventListener("click", () => { asking.add(b.dataset.aiopen); render(); const t = $("fl-n-" + b.dataset.aiopen); if (t) t.focus(); }));
    root.querySelectorAll("[data-aiagain]").forEach((b) => b.addEventListener("click", () => { asking.add(b.dataset.aiagain); render(); const c = findCard(b.dataset.aiagain); const t = $("fl-n-" + c.key); if (t) { t.value = (c.ai && c.ai.note ? c.ai.note + "\n" : ""); t.focus(); } }));
    root.querySelectorAll("[data-aiclose]").forEach((b) => b.addEventListener("click", () => { asking.delete(b.dataset.aiclose); render(); }));
    const ask = async (key, note) => {
      const c = findCard(key);
      const r = await api("/api/admin/ai-drafts", { method: "POST", token: getToken(), body: { part_type: c.type, part_id: String(c.id), note, campaign_id: campId } });
      if (!r.ok) return fail("依頼を作れませんでした（" + (r.error || r.status) + "）");
      const ok = await copy(r.prompt);
      asking.delete(key);
      try { sessionStorage.setItem("fl-prompt-" + key, r.prompt); } catch (_) {}
      await reload(ok ? "依頼文をコピーしました。claude.ai のチャットに貼ってください" : "コピーできませんでした。「依頼文をもう一度コピー」を押してください");
    };
    root.querySelectorAll("[data-aiask]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.aiask, ($("fl-n-" + b.dataset.aiask) || {}).value || "")));
    root.querySelectorAll("[data-aicopy]").forEach((b) => b.addEventListener("click", async () => {
      let t = null; try { t = sessionStorage.getItem("fl-prompt-" + b.dataset.aicopy); } catch (_) {}
      if (!t) return ask(b.dataset.aicopy, (findCard(b.dataset.aicopy).ai || {}).note || "");
      say((await copy(t)) ? "依頼文をコピーしました" : "コピーできませんでした");
    }));
    root.querySelectorAll("[data-aidrop]").forEach((b) => b.addEventListener("click", async () => {
      const r = await api(`/api/admin/ai-drafts/${b.dataset.aidrop}`, { method: "POST", token: getToken(), body: { action: "drop" } });
      if (!r.ok) return fail("できませんでした（" + (r.error || r.status) + "）");
      await reload("AI の案を採用しませんでした");
    }));
    root.querySelectorAll("[data-aiadopt]").forEach((b) => b.addEventListener("click", async () => {
      const t = $("fl-d-" + b.dataset.key);
      b.disabled = true;
      const r = await api(`/api/admin/ai-drafts/${b.dataset.aiadopt}`, { method: "POST", token: getToken(), body: { action: "adopt", body: t ? t.value : undefined } });
      if (!r.ok) { b.disabled = false; return fail("採用できませんでした（" + (r.error || r.status) + "）"); }
      await reload("AI の案を採用しました");
    }));
    root.querySelectorAll("[data-reload]").forEach((b) => b.addEventListener("click", () => reload("読み直しました")));
    root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPart && openPart(b.dataset.open)));
  }

  return { load };
}

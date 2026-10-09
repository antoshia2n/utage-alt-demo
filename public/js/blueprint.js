// B の便 8c：設計図（見る）と企画。
// 部品を出会う → 登録 → 温める → 相談 → 購入 → 受講 → 紹介のレーンに並べ（便 8d で 7 つ）、実際の設定から引いた線を引く。線の数字は先週 7 日の数。
// 便 8d：商品は UTAGE の商品ごとのまとまり 1 箱にたたむ（押すと売り方が開く）。片付け案（承認 1 回で当てる）と、変えた記録・元に戻す。
// 箱を押すと右の欄に中の名前・外の名前・入口と出口・持ち主の企画が出る。持ち主と役目はここで変える。
// 線を引き直す・一言で下書きするのは 8e・8g。ここでは見ることと、企画の整理だけ。

const TYPE_LABEL = { page: "ページ", step: "ステップ", broadcast: "一斉配信", seminar: "セミナー", booking: "予約", product: "商品", course: "教材", room: "添削", community: "オプチャ" };
const STATE_LABEL = { running: "動いている", draft: "下書き", stopped: "止まっている" };
// 「開いて直す」で開く左のメニューの項目
const EDIT_VIEW = { step: "deliver", broadcast: "deliver", seminar: "deals", booking: "deals", product: "products", room: "rooms", community: "settings" };

export function makeBlueprint({ $, api, esc, getToken, fail, openView }) {
  let view = "all";
  let data = null;
  let selected = null;
  let campaigns = [];
  const openGroups = new Set();

  async function load() {
    const r = await api(`/api/admin/blueprint?campaign=${encodeURIComponent(view)}`, { token: getToken() });
    if (!r.ok) {
      if (r.error === "campaign_not_found") { view = "all"; return load(); }
      $("bp-canvas").innerHTML = `<p class="note">読めませんでした（${esc(r.error || r.status)}）。表 b_campaigns が無いときは、SQL Editor で b8c_plan.sql を流すと出ます。</p>`;
      return;
    }
    data = r;
    campaigns = r.campaigns;
    renderChips();
    renderCanvas();
    if (selected && !data.parts.some((p) => p.key === selected)) selected = null;
    renderPanel();
  }

  function renderChips() {
    const showArchived = $("bp-show-archived").checked;
    const chip = (id, label, n, extra = "") => `<button type="button" class="chip${view === id ? " on" : ""}${extra}" data-c="${esc(id)}">${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ""}</button>`;
    const list = campaigns.filter((c) => showArchived || !c.archived_at);
    $("bp-chips").innerHTML = chip("all", "すべて", null)
      + list.map((c) => chip(c.id, c.name + (c.archived_at ? "（しまった）" : ""), c.parts, c.archived_at ? " archived" : c.kind === "standing" ? " standing" : "")).join("")
      + chip("unassigned", "企画に入っていない", data.unassigned_count, data.unassigned_count ? " warn" : "");
    document.querySelectorAll("#bp-chips .chip").forEach((b) => b.addEventListener("click", () => { view = b.dataset.c; selected = null; load(); }));
    const cur = campaigns.find((c) => c.id === view);
    const arch = $("bp-archive");
    arch.classList.toggle("hidden", !cur || cur.kind === "standing");
    if (cur) arch.textContent = cur.archived_at ? "この企画を戻す" : "この企画をしまう";
  }

  function renderCanvas() {
    const lanes = data.lanes;
    const byLane = Object.fromEntries(lanes.map((l) => [l.id, []]));
    for (const p of data.parts) (byLane[p.lane] || (byLane[p.lane] = [])).push(p);
    for (const k in byLane) byLane[k].sort((a, b) => (!!a.outside - !!b.outside) || (a.type === b.type ? 0 : a.type < b.type ? -1 : 1));
    const node = (p) => `<button type="button" class="bp-node ${p.state}${p.isolated ? " iso" : ""}${p.outside ? " outside" : ""}${selected === p.key ? " sel" : ""}" data-key="${esc(p.key)}">
        <span class="t">${esc(TYPE_LABEL[p.type] || p.type)}${p.outside ? " ・別の企画" : ""}</span>
        <span class="nm">${esc(p.name)}</span>
        <span class="in">${esc(p.inner_name)}</span>
        ${p.week ? `<span class="wk">先週 ${p.week}</span>` : ""}
      </button>`;
    // 商品は、売り方が 2 つ以上あるまとまりだけ 1 箱にたたむ
    const laneHtml = (items) => {
      const out = [], seen = new Set();
      for (const p of items) {
        if (p.type === "product" && p.group && p.group_size > 1) {
          if (seen.has(p.group)) continue;
          seen.add(p.group);
          const members = items.filter((x) => x.type === "product" && x.group === p.group);
          const open = members.some((x) => x.key === selected) || openGroups.has(p.group);
          const running = members.filter((x) => x.state === "running").length;
          const wk = members.reduce((n, x) => n + (x.week || 0), 0);
          out.push(`<details class="bp-group" data-group="${esc(p.group)}"${open ? " open" : ""}>
            <summary class="bp-node ${running ? "running" : "stopped"}"><span class="t">商品のまとまり</span><span class="nm">${esc(p.group_name)}</span><span class="n">売り方 ${members.length}（売っている ${running}）</span>${wk ? `<span class="wk">先週 ${wk}</span>` : ""}</summary>
            ${members.map(node).join("")}
          </details>`);
        } else out.push(node(p));
      }
      return out.join("");
    };
    $("bp-canvas").innerHTML = `<div class="bp-lanes" id="bp-lanes">
        <svg class="bp-lines" id="bp-lines" aria-hidden="true"></svg>
        ${lanes.map((l) => `<div class="bp-lane"><h4>${esc(l.label)}</h4>${laneHtml(byLane[l.id] || []) || `<p class="note bp-empty">${l.id === "refer" ? "紹介は左のメニュー「紹介」で見ます" : "まだ部品がありません"}</p>`}</div>`).join("")}
      </div>
      ${data.parts.length === 0 ? '<p class="note">この企画にはまだ部品がありません。「企画に入っていない」から部品を選び、右の欄で持ち主をこの企画にしてください。</p>' : ""}
      ${data.stopped_products_hidden ? `<p class="note" style="margin:8px 0 0">売っていない商品 ${data.stopped_products_hidden} 本は出していません（企画に入れたものは出ます）。</p>` : ""}`;
    document.querySelectorAll("#bp-canvas button.bp-node").forEach((b) => b.addEventListener("click", () => { selected = b.dataset.key; renderCanvas(); renderPanel(); }));
    document.querySelectorAll("#bp-canvas details.bp-group").forEach((d) => d.addEventListener("toggle", () => {
      if (d.open) openGroups.add(d.dataset.group); else openGroups.delete(d.dataset.group);
      requestAnimationFrame(drawLines);
    }));
    requestAnimationFrame(drawLines);
  }

  function drawLines() {
    const wrap = $("bp-lanes");
    const svg = $("bp-lines");
    if (!wrap || !svg || !data) return;
    const base = wrap.getBoundingClientRect();
    svg.setAttribute("width", wrap.scrollWidth);
    svg.setAttribute("height", wrap.scrollHeight);
    const box = (key) => {
      let el = wrap.querySelector(`.bp-node[data-key="${CSS.escape(key)}"]`);
      if (!el) return null;
      const shut = el.closest("details.bp-group:not([open])");
      if (shut) el = shut.querySelector("summary"); // たたんだまとまりの線は、まとまりの箱から引く
      const r = el.getBoundingClientRect();
      return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cy: (r.top + r.bottom) / 2 - base.top, cx: (r.left + r.right) / 2 - base.left };
    };
    let out = '<defs><marker id="bp-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>';
    for (const e of data.edges) {
      const a = box(e.from), b = box(e.to);
      if (!a || !b) continue;
      let d, lx, ly;
      if (b.l > a.r) { // 右のレーンへ
        const mx = (a.r + b.l) / 2;
        d = `M${a.r},${a.cy} C${mx},${a.cy} ${mx},${b.cy} ${b.l - 2},${b.cy}`; lx = mx; ly = (a.cy + b.cy) / 2;
      } else if (Math.abs(a.cx - b.cx) < 4) { // 同じレーン
        const down = b.t > a.b;
        d = down ? `M${a.cx},${a.b} L${b.cx},${b.t - 2}` : `M${a.cx},${a.t} L${b.cx},${b.b + 2}`; lx = a.cx + 6; ly = down ? (a.b + b.t) / 2 : (a.t + b.b) / 2;
      } else { // 左へ戻る
        const y = Math.max(a.b, b.b) + 18;
        d = `M${a.cx},${a.b} C${a.cx},${y} ${b.cx},${y} ${b.cx},${b.b + 2}`; lx = (a.cx + b.cx) / 2; ly = y - 4;
      }
      // 数は常に出す。「権利」などの言葉は、押した箱の線にだけ出す（重なって読めなくなるため）
      const on = selected && (e.from === selected || e.to === selected);
      const label = e.week ? String(e.week) : on ? e.label : "";
      out += `<path d="${d}" class="ln${on ? " on" : selected ? " dim" : ""}" marker-end="url(#bp-ah)"/>`;
      if (label) out += `<text x="${lx}" y="${ly - 4}" class="lb${e.week ? " num" : ""}" text-anchor="middle">${esc(label)}</text>`;
    }
    svg.innerHTML = out;
  }

  function renderPanel() {
    const p = selected && data.parts.find((x) => x.key === selected);
    if (!p) {
      const cur = campaigns.find((c) => c.id === view);
      $("bp-panel").innerHTML = cur
        ? `<h3>${esc(cur.name)}</h3><p class="note">部品 ${cur.parts} 個${cur.starts_on ? `・開催日 ${esc(cur.starts_on)}` : ""}${cur.kind === "standing" ? "・長く使うものの置き場（しまえない）" : ""}</p><p class="note">点線の外の箱は、線でつながる別の企画の部品です。</p>`
        : '<p class="note">箱を押すと、中の名前・外の名前・入口と出口・先週の数が出ます。持ち主の企画と役目もここで変えます。</p>';
      return;
    }
    const name = (k) => { const q = data.parts.find((x) => x.key === k); return q ? q.name : k; };
    const ins = data.edges.filter((e) => e.to === p.key);
    const outs = data.edges.filter((e) => e.from === p.key);
    const live = campaigns.filter((c) => !c.archived_at);
    $("bp-panel").innerHTML = `
      <div class="pill gray" style="margin-bottom:6px">${esc(TYPE_LABEL[p.type] || p.type)}・${esc(STATE_LABEL[p.state] || p.state)}</div>
      <dl class="bp-dl">
        <dt>外の名前（生徒に見える）</dt><dd>${esc(p.name)}</dd>
        <dt>中の名前（シアニンだけに見える・自動）</dt><dd>${esc(p.inner_name)}</dd>
        <dt>持ち主の企画</dt><dd>${esc(p.campaign_name || "企画に入っていない")}</dd>
        <dt>線でつながる別の企画</dt><dd>${p.used_by.length ? p.used_by.map((c) => esc(c.name)).join("・") : "なし"}</dd>
        <dt>入口</dt><dd>${ins.length ? ins.map((e) => `${esc(name(e.from))}（${esc(e.label)}）`).join("<br>") : "なし"}</dd>
        <dt>出口</dt><dd>${outs.length ? outs.map((e) => `${esc(name(e.to))}（${esc(e.label)}）`).join("<br>") : "なし"}</dd>
        <dt>先週 7 日</dt><dd>${p.week}</dd>
      </dl>
      <form id="bp-assign" class="stack" style="margin-top:12px">
        <div><label for="bp-camp">持ち主の企画を変える</label><select id="bp-camp" class="inline" style="width:100%">
          <option value="">企画から外す</option>
          ${live.map((c) => `<option value="${esc(c.id)}"${c.id === p.campaign_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
        <div><label for="bp-role">役目（中の名前の最後に入る・空なら外の名前）</label><input id="bp-role" type="text" maxlength="60" value="${esc(p.role || "")}" placeholder="例 申込者フォロー"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn small" type="submit">保存</button>
          ${EDIT_VIEW[p.type] ? '<button class="btn ghost small" type="button" id="bp-open">開いて直す</button>' : ""}
          ${p.url ? `<a class="btn ghost small" href="${esc(p.url)}" target="_blank" rel="noopener">ページを見る</a>` : ""}
          <span class="note" id="bp-assign-status"></span>
        </div>
        ${p.type === "course" ? '<p class="note" style="margin:0">教材の中身は学ぶくんで直します。</p>' : ""}
      </form>`;
    $("bp-assign").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("bp-assign-status").textContent = "保存しています…";
      const r = await api("/api/admin/campaigns/assign", { method: "POST", token: getToken(), body: { part_type: p.type, part_id: p.id, campaign_id: $("bp-camp").value || null, role: $("bp-role").value } });
      if (!r.ok) { $("bp-assign-status").textContent = "保存できませんでした（" + (r.error || r.status) + "）"; return; }
      await load();
      const s = $("bp-assign-status"); if (s) s.textContent = "保存しました";
    });
    const open = $("bp-open");
    if (open) open.addEventListener("click", () => openView(EDIT_VIEW[p.type]));
  }

  // 便 8d：片付け案（企画に入っていない部品を常設へ入れる案。当てると 1 件ずつ変えた記録に残り、元に戻せる）
  async function showTidy() {
    selected = null;
    $("bp-panel").innerHTML = '<p class="note">片付け案を作っています…</p>';
    const r = await api("/api/admin/tidy", { token: getToken() });
    if (!r.ok) { $("bp-panel").innerHTML = `<p class="note">作れませんでした（${esc(r.error || r.status)}）</p>`; return; }
    if (!r.count) { $("bp-panel").innerHTML = '<h3>片付け案</h3><p class="note">企画に入っていない部品はありません。</p>'; return; }
    $("bp-panel").innerHTML = `<h3>片付け案</h3>
      <p class="note">企画に入っていない部品 ${r.count} 個を、下の役目で「${esc(r.assignments[0].campaign_name || "常設")}」に入れます。あとから「変えた記録」で 1 件ずつ元に戻せます。企画へ入れたいものは、当てたあとに箱を押して持ち主を変えてください。</p>
      <ul class="bp-list">${r.assignments.map((x) => `<li><span>${esc(x.name)}<br><span class="sub">役目：${esc(x.role || "（外の名前）")}</span></span></li>`).join("")}</ul>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px"><button class="btn small" type="button" id="bp-tidy-apply">この案で当てる</button><span class="note" id="bp-tidy-status"></span></div>`;
    $("bp-tidy-apply").addEventListener("click", async () => {
      $("bp-tidy-status").textContent = "当てています…";
      const a = await api("/api/admin/tidy", { method: "POST", token: getToken(), body: { assignments: r.assignments } });
      if (!a.ok && !a.applied) { $("bp-tidy-status").textContent = "当てられませんでした（" + (a.error || (a.failed && a.failed[0] && a.failed[0].error) || a.status) + "）"; return; }
      view = "all";
      await load();
      $("bp-panel").innerHTML = `<h3>片付け案</h3><p class="note">${a.applied} 個を当てました${a.failed && a.failed.length ? `（当てられなかったもの ${a.failed.length}）` : ""}。戻すときは「変えた記録」から。</p>`;
    });
  }

  // 便 8d：変えた記録と元に戻す
  async function showChanges() {
    selected = null;
    $("bp-panel").innerHTML = '<p class="note">読み込んでいます…</p>';
    const r = await api("/api/admin/changes?limit=50", { token: getToken() });
    if (!r.ok) { $("bp-panel").innerHTML = `<p class="note">読めませんでした（${esc(r.error || r.status)}）</p>`; return; }
    const who = (a) => a === "mcp" ? "AI" : esc(a || "");
    $("bp-panel").innerHTML = `<h3>変えた記録</h3>
      <p class="note">設定（メールの送り方・オプチャの招待リンク）と部品の持ち主の変更。AI の変更も、ここで元に戻せます。</p>
      ${r.count ? `<ul class="bp-list">${r.changes.map((c) => `<li><span>${esc(c.summary || c.target)}<br><span class="sub">${who(c.actor)}・${esc(new Date(c.at).toLocaleString("ja-JP"))}${c.undone ? "・戻した" : ""}</span></span>${c.undone ? "" : `<button class="btn ghost small" type="button" data-undo="${esc(c.id)}">元に戻す</button>`}</li>`).join("")}</ul>` : '<p class="note">まだ記録はありません。</p>'}
      <p class="note" id="bp-undo-status"></p>`;
    document.querySelectorAll("#bp-panel [data-undo]").forEach((b) => b.addEventListener("click", async () => {
      $("bp-undo-status").textContent = "戻しています…";
      const u = await api("/api/admin/changes/undo", { method: "POST", token: getToken(), body: { id: Number(b.dataset.undo) } });
      if (!u.ok) {
        const why = { newer_change: "同じものに、あとの変更があります。あとのほうを先に戻してください", already_undone: "もう戻してあります" };
        $("bp-undo-status").textContent = (why[u.error] || "戻せませんでした") + "（" + (u.error || u.status) + "）";
        return;
      }
      await load();
      await showChanges();
    }));
  }

  function wire() {
    $("bp-tidy").addEventListener("click", showTidy);
    $("bp-changes").addEventListener("click", showChanges);
    $("bp-show-archived").addEventListener("change", () => data && renderChips());
    $("bp-new").addEventListener("click", () => { $("bp-new-form").classList.toggle("hidden"); $("bp-title").focus(); });
    $("bp-new-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const date = $("bp-date").value.trim();
      const r = await api("/api/admin/campaigns", { method: "POST", token: getToken(), body: { title: $("bp-title").value, starts_on: date || null } });
      if (!r.ok) {
        const why = { name_taken: "同じ名前の企画があります", bad_title: "名前は 1〜60 文字です", bad_starts_on: "開催日は 2026-11-28 の形で入れてください" };
        $("bp-new-status").textContent = (why[r.error] || "つくれませんでした") + "（" + (r.error || r.status) + "）";
        return;
      }
      $("bp-title").value = ""; $("bp-date").value = ""; $("bp-new-status").textContent = "";
      $("bp-new-form").classList.add("hidden");
      view = r.campaign.id; selected = null;
      await load();
    });
    $("bp-archive").addEventListener("click", async () => {
      const cur = campaigns.find((c) => c.id === view);
      if (!cur) return;
      const restore = !!cur.archived_at;
      const r = await api("/api/admin/campaigns/archive", { method: "POST", token: getToken(), body: { campaign_id: cur.id, restore } });
      if (!r.ok) {
        if (r.error === "running_parts") return fail("動いている部品があるのでしまえません：" + r.running.map((x) => x.name).join("・") + "。止めるか、別の企画へ移してからしまってください。");
        return fail("できませんでした（" + (r.error || r.status) + "）");
      }
      if (!restore) { view = "all"; }
      await load();
    });
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(drawLines, 120); });
  }
  wire();

  return { load };
}

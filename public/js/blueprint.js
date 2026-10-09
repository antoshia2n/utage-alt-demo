// B の便 8c：設計図（見る）と企画。
// 部品を集客 → リストイン → アプローチ → 個別相談 → オファー → 受講 → 紹介の段に並べ（便 8d で 7 つ・便 13b で名前を直し、上から下へ降りる並びにした）、実際の設定から引いた線を引く。線の数字は先週 7 日の数。
// 便 8d：商品は UTAGE の商品ごとのまとまり 1 箱にたたむ（押すと売り方が開く）。片付け案（承認 1 回で当てる）と、変えた記録・元に戻す。
// 箱を押すと右の欄に中の名前・外の名前・入口と出口・持ち主の企画が出る。持ち主と役目はここで変える。
// 線を引き直す・一言で下書きするのは 8e・8g。ここでは見ることと、企画の整理だけ。

const TYPE_LABEL = { page: "ページ", step: "ステップ", broadcast: "一斉配信", seminar: "セミナー", booking: "予約", product: "商品", course: "教材", room: "添削", community: "オプチャ", form: "フォーム" };
const STATE_LABEL = { running: "動いている", draft: "下書き", stopped: "止まっている" };
// 「開いて直す」で開く左のメニューの項目
const EDIT_VIEW = { form: "forms", step: "connect", broadcast: "deliver", seminar: "deals", booking: "deals", product: "products", room: "rooms", community: "settings" };
// 便 12a：Claude が作ったページ（lp）は「ページ」の画面で開く。トップの LP と無料登録は固定なので開く先が無い
const editView = (p) => (p.type === "page" ? (p.lp ? "pages" : null) : EDIT_VIEW[p.type]);

export function makeBlueprint({ $, api, esc, getToken, fail, openView }) {
  let view = "all";
  let mode = "flow"; // 便 8g-3：flow（レーンと線）／list（一覧の表）
  let query = "";
  let data = null;
  // 便 8g-4：ブロック（企画の中の部品のまとまり）。既定はたたんで 1 箱。開いたものだけ中の部品を並べる
  const openBlocks = new Set();
  let selectedBlock = null;
  const blockIdOf = (p) => (p.block_name && !p.outside && p.campaign_id ? `${p.campaign_id}|${p.block_name}` : null);
  function blockGroups() {
    const g = new Map();
    for (const p of data.parts) { const id = blockIdOf(p); if (!id) continue; if (!g.has(id)) g.set(id, { id, campaign_id: p.campaign_id, campaign_name: p.campaign_name, block_name: p.block_name, members: [] }); g.get(id).members.push(p); }
    for (const b of g.values()) {
      const inside = new Set(b.members.map((m) => m.key));
      b.ins = data.edges.filter((e) => inside.has(e.to) && !inside.has(e.from));
      b.outs = data.edges.filter((e) => inside.has(e.from) && !inside.has(e.to));
    }
    return g;
  }
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

  // 便 8g-3：一覧の見方。部品を段階の順に 1 行ずつ。入る線・出る線と、それぞれの先週の人数
  function renderList() {
    const order = Object.fromEntries(data.lanes.map((l, i) => [l.id, i]));
    const laneName = Object.fromEntries(data.lanes.map((l) => [l.id, l.label]));
    const nm = (k) => { const q = data.parts.find((x) => x.key === k); return q ? q.name : k; };
    const q = query.trim().toLowerCase();
    const rows = data.parts
      .filter((p) => !q || [p.name, p.inner_name, p.campaign_name || "", TYPE_LABEL[p.type] || ""].some((s) => String(s).toLowerCase().includes(q)))
      .sort((a, b) => (order[a.lane] ?? 99) - (order[b.lane] ?? 99) || String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name)));
    const lineCell = (list, side) => list.length
      ? list.map((e) => `<div>${esc(nm(side === "in" ? e.from : e.to))}${e.counted === "none" ? "" : ` <b class="num">${e.week}</b>`}</div>`).join("")
      : '<span class="note">なし</span>';
    $("bp-canvas").innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input id="bp-q" type="search" placeholder="名前・企画で絞る" value="${esc(query)}" style="max-width:280px"><span class="note">${rows.length} 個</span></div>
      <div class="bp-table-wrap"><table class="bp-table">
        <thead><tr><th>段階</th><th>種類</th><th>外の名前／中の名前</th><th>企画</th><th>状態</th><th class="r">先週</th><th>入る線（人数）</th><th>出る線（人数）</th></tr></thead>
        <tbody>${rows.map((p) => `<tr data-key="${esc(p.key)}" class="${selected === p.key ? "sel" : ""}${p.isolated ? " iso" : ""}">
          <td>${esc(laneName[p.lane] || p.lane)}</td><td>${esc(TYPE_LABEL[p.type] || p.type)}</td>
          <td><div>${esc(p.name)}</div><div class="note">${esc(p.inner_name)}</div></td>
          <td>${esc(p.campaign_name || "（企画に入っていない）")}${p.outside ? '<div class="note">別の企画</div>' : ""}</td>
          <td><span class="pill ${p.state === "running" ? "" : "gray"}">${esc(STATE_LABEL[p.state] || p.state)}</span></td>
          <td class="r num">${p.week}</td>
          <td>${lineCell(data.edges.filter((e) => e.to === p.key), "in")}</td>
          <td>${lineCell(data.edges.filter((e) => e.from === p.key), "out")}</td>
        </tr>`).join("") || '<tr><td colspan="8" class="note">当たる部品がありません</td></tr>'}</tbody>
      </table></div>`;
    $("bp-q").addEventListener("input", (ev) => { query = ev.target.value; const pos = ev.target.selectionStart; renderList(); const i = $("bp-q"); i.focus(); try { i.setSelectionRange(pos, pos); } catch (_) {} });
    document.querySelectorAll("#bp-canvas tr[data-key]").forEach((tr) => tr.addEventListener("click", () => { selected = tr.dataset.key; renderList(); renderPanel(); }));
  }

  function renderCanvas() {
    if (mode === "list") return renderList();
    const lanes = data.lanes;
    const byLane = Object.fromEntries(lanes.map((l) => [l.id, []]));
    const laneIdx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
    const groups = blockGroups();
    const blockBoxes = Object.fromEntries(lanes.map((l) => [l.id, []]));
    for (const b of groups.values()) {
      if (openBlocks.has(b.id)) continue;
      const first = [...b.members].sort((x, y) => (laneIdx[x.lane] ?? 99) - (laneIdx[y.lane] ?? 99))[0];
      (blockBoxes[first.lane] || (blockBoxes[first.lane] = [])).push(b);
    }
    for (const p of data.parts) {
      const bid = blockIdOf(p);
      if (bid && !openBlocks.has(bid)) continue; // たたんだブロックの中の部品は出さない
      (byLane[p.lane] || (byLane[p.lane] = [])).push(p);
    }
    for (const k in byLane) byLane[k].sort((a, b) => (!!a.outside - !!b.outside) || (a.type === b.type ? 0 : a.type < b.type ? -1 : 1));
    const blockNode = (b) => {
      const running = b.members.filter((m) => m.state === "running").length, drafts = b.members.filter((m) => m.state === "draft").length;
      const wk = b.members.reduce((n, m) => n + (m.week || 0), 0);
      return `<button type="button" class="bp-node bp-block ${running ? "running" : drafts ? "draft" : "stopped"}${selectedBlock === b.id ? " sel" : ""}${b.ins.length > 4 || b.outs.length > 4 ? " iso" : ""}" data-block="${esc(b.id)}">
        <span class="t">ブロック・${esc(b.campaign_name || "")}</span><span class="nm">${esc(b.block_name)}</span>
        <span class="n">部品 ${b.members.length}${drafts ? `（下書き ${drafts}）` : ""}・入口 ${b.ins.length}・出口 ${b.outs.length}</span>${wk ? `<span class="wk">先週 ${wk}</span>` : ""}</button>`;
    };
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
        ${lanes.map((l) => `<div class="bp-lane"><h4>${esc(l.label)}</h4><div class="bp-row">${((blockBoxes[l.id] || []).map(blockNode).join("") + laneHtml(byLane[l.id] || [])) || `<p class="note bp-empty">${l.id === "refer" ? "紹介は左のメニュー「紹介」で見ます" : "まだ部品がありません"}</p>`}</div></div>`).join("")}
      </div>
      ${data.parts.length === 0 ? '<p class="note">この企画にはまだ部品がありません。「企画に入っていない」から部品を選び、右の欄で持ち主をこの企画にしてください。</p>' : ""}
      ${data.stopped_products_hidden ? `<p class="note" style="margin:8px 0 0">売っていない商品 ${data.stopped_products_hidden} 本は出していません（企画に入れたものは出ます）。</p>` : ""}`;
    document.querySelectorAll("#bp-canvas button.bp-node[data-key]").forEach((b) => b.addEventListener("click", () => { selected = b.dataset.key; selectedBlock = null; renderCanvas(); renderPanel(); }));
    document.querySelectorAll("#bp-canvas button.bp-node[data-block]").forEach((b) => b.addEventListener("click", () => { selectedBlock = b.dataset.block; selected = null; renderCanvas(); renderPanel(); }));
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
    const shutBlock = {};
    for (const p of data.parts) { const id = blockIdOf(p); if (id && !openBlocks.has(id)) shutBlock[p.key] = id; }
    const box = (key) => {
      let el = wrap.querySelector(`.bp-node[data-key="${CSS.escape(key)}"]`);
      if (!el && shutBlock[key]) el = wrap.querySelector(`.bp-node[data-block="${CSS.escape(shutBlock[key])}"]`); // たたんだブロックの線は、ブロックの箱から引く
      if (!el) return null;
      const shut = el.closest("details.bp-group:not([open])");
      if (shut) el = shut.querySelector("summary"); // たたんだまとまりの線は、まとまりの箱から引く
      const r = el.getBoundingClientRect();
      return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cy: (r.top + r.bottom) / 2 - base.top, cx: (r.left + r.right) / 2 - base.left };
    };
    let out = '<defs><marker id="bp-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>';
    for (const e of data.edges) {
      if (shutBlock[e.from] && shutBlock[e.from] === shutBlock[e.to]) continue; // たたんだブロックの中の線は引かない
      const a = box(e.from), b = box(e.to);
      if (!a || !b) continue;
      let d, lx, ly;
      // 便 13b：上から下へ。下の段へは箱の下の真ん中から次の箱の上の真ん中へ、同じ段は横、上へ戻るときは右側を回る
      if (b.t > a.b - 2) { // 下の段へ
        const my = (a.b + b.t) / 2;
        d = `M${a.cx},${a.b} C${a.cx},${my} ${b.cx},${my} ${b.cx},${b.t - 2}`; lx = (a.cx + b.cx) / 2; ly = my + 4;
      } else if (Math.abs(a.cy - b.cy) < (a.b - a.t) / 2) { // 同じ段
        const toRight = b.l > a.r;
        d = toRight ? `M${a.r},${a.cy} L${b.l - 2},${b.cy}` : `M${a.l},${a.cy} L${b.r + 2},${b.cy}`; lx = toRight ? (a.r + b.l) / 2 : (a.l + b.r) / 2; ly = a.cy - 2;
      } else { // 上の段へ戻る
        const x = Math.max(a.r, b.r) + 18;
        d = `M${a.r},${a.cy} C${x},${a.cy} ${x},${b.cy} ${b.r + 2},${b.cy}`; lx = x; ly = (a.cy + b.cy) / 2;
      }
      // 数は常に出す。「権利」などの言葉は、押した箱の線にだけ出す（重なって読めなくなるため）
      const on = (selected && (e.from === selected || e.to === selected)) || (selectedBlock && (shutBlock[e.from] === selectedBlock || shutBlock[e.to] === selectedBlock));
      const label = e.week ? String(e.week) : on ? e.label : "";
      out += `<path d="${d}" class="ln${on ? " on" : selected || selectedBlock ? " dim" : ""}" marker-end="url(#bp-ah)"/>`;
      if (label) out += `<text x="${lx}" y="${ly - 4}" class="lb${e.week ? " num" : ""}" text-anchor="middle">${esc(label)}</text>`;
    }
    svg.innerHTML = out;
  }

  // 便 8g-4：ブロックの欄。中の部品・入口と出口（先週の人数）・開く／たたむ・テンプレとして保存・まとめて動かす
  function renderBlockPanel(b) {
    const nm = (k) => { const q = data.parts.find((x) => x.key === k); return q ? q.name : k; };
    const line = (e, side) => `${esc(nm(side === "in" ? e.from : e.to))}（${esc(e.label)}${e.counted === "none" ? "" : `・先週 ${e.week} 人`}）`;
    const drafts = b.members.filter((m) => m.type === "step" && m.state === "draft").length;
    $("bp-panel").innerHTML = `
      <div class="pill gray" style="margin-bottom:6px">ブロック・${esc(b.campaign_name || "")}</div>
      <h3 style="margin:0 0 6px">${esc(b.block_name)}</h3>
      <dl class="bp-dl">
        <dt>中の部品（${b.members.length}）</dt><dd>${b.members.map((m) => `<a href="#" data-goto="${esc(m.key)}">${esc(m.name)}</a>（${esc(STATE_LABEL[m.state] || m.state)}）`).join("<br>")}</dd>
        <dt>入口（${b.ins.length}）</dt><dd>${b.ins.map((e) => line(e, "in")).join("<br>") || "なし"}</dd>
        <dt>出口（${b.outs.length}）</dt><dd>${b.outs.map((e) => line(e, "out")).join("<br>") || "なし"}</dd>
      </dl>
      ${b.ins.length > 4 || b.outs.length > 4 ? '<p class="note" style="color:var(--warn)">入口か出口が 4 本を超えています。ブロックを分けると読みやすくなります。</p>' : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn ghost small" type="button" id="bk-toggle">${openBlocks.has(b.id) ? "たたむ" : "開いて中を並べる"}</button>
        ${drafts ? `<button class="btn small" type="button" id="bk-publish">下書き ${drafts} 個をまとめて動かす</button>` : ""}
      </div>
      <div id="bk-preview" class="stack" style="margin-top:8px"></div>
      <form id="bk-save" class="stack" style="margin-top:12px">
        <div><label for="bk-tname">テンプレとして保存（同じ名前なら版が 1 つ上がる）</label><input id="bk-tname" type="text" maxlength="80" value="${esc(b.block_name)}"></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn ghost small" type="submit">保存</button><span class="note" id="bk-status"></span></div>
      </form>`;
    document.querySelectorAll("#bp-panel [data-goto]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); openBlocks.add(b.id); selected = a.dataset.goto; selectedBlock = null; renderCanvas(); renderPanel(); }));
    $("bk-toggle").addEventListener("click", () => { if (openBlocks.has(b.id)) openBlocks.delete(b.id); else openBlocks.add(b.id); renderCanvas(); renderPanel(); });
    $("bk-save").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("bk-status").textContent = "保存しています…";
      const r = await api("/api/admin/templates", { method: "POST", token: getToken(), body: { name: $("bk-tname").value, kind: "block", campaign_id: b.campaign_id, block_name: b.block_name } });
      $("bk-status").textContent = r.ok ? `保存しました（版 ${r.version}）` : "保存できませんでした（" + (r.error || r.status) + "）";
    });
    const pub = $("bk-publish");
    if (pub) pub.addEventListener("click", async () => {
      // 先に一覧（種類・名前・宛先の人数）を見せ、確かめてから動かす
      const pre = await api("/api/admin/blocks/preview", { method: "POST", token: getToken(), body: { campaign_id: b.campaign_id, block_name: b.block_name } });
      if (!pre.ok) { $("bk-preview").innerHTML = `<p class="note">動かせません（${esc(pre.error || pre.status)}${pre.note ? "・" + esc(pre.note) : ""}）</p>`; return; }
      const a = pre.args;
      $("bk-preview").innerHTML = `<div class="bp-table-wrap"><table class="bp-table" style="min-width:0"><thead><tr><th>種類</th><th>名前</th><th class="r">宛先の人数</th></tr></thead>
        <tbody>${a._preview.map((x) => `<tr><td>${esc(x.type)}</td><td>${esc(x.name)}</td><td class="r num">${x.audience == null ? "—" : x.audience}</td></tr>`).join("")}</tbody></table></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn small" type="button" id="bk-go">この ${a._preview.length} 個を動かす</button><span class="note" id="bk-go-status"></span></div>`;
      $("bk-go").addEventListener("click", async () => {
        $("bk-go").disabled = true;
        const r = await api("/api/admin/blocks/publish", { method: "POST", token: getToken(), body: { campaign_id: a.campaign_id, block_name: a.block_name, step_ids: a.step_ids } });
        $("bk-go-status").textContent = r.ok ? `動かしました ${r.started} 個${r.skipped.length ? `・動かさなかった ${r.skipped.length} 個` : ""}` : "動かせませんでした（" + (r.error || r.status) + "）";
        if (r.ok) await load();
      });
    });
  }

  function renderPanel() {
    if (selectedBlock) {
      const b = blockGroups().get(selectedBlock);
      if (b) return renderBlockPanel(b);
      selectedBlock = null;
    }
    const p = selected && data.parts.find((x) => x.key === selected);
    if (!p) {
      const cur = campaigns.find((c) => c.id === view);
      $("bp-panel").innerHTML = cur
        ? `<h3>${esc(cur.name)}</h3><p class="note">部品 ${cur.parts} 個${cur.starts_on ? `・開催日 ${esc(cur.starts_on)}` : ""}${cur.kind === "standing" ? "・長く使うものの置き場（しまえない）" : ""}</p><p class="note">点線の外の箱は、線でつながる別の企画の部品です。</p>
          ${cur.kind === "standing" ? "" : `<form id="bp-copy" class="stack" style="margin-top:12px">
            <div><label for="bp-copy-title">この企画を下書きで複製（新しい名前・年月は頭に自動）</label><input id="bp-copy-title" type="text" maxlength="60" placeholder="例 図解セミナー"></div>
            <div><label for="bp-copy-date">開催日${cur.starts_on ? "（元に開催日があるので要る）" : "（任意）"}</label><input id="bp-copy-date" type="text" inputmode="numeric" placeholder="2026-12-12"></div>
            <div style="display:flex;gap:8px;align-items:center"><button class="btn ghost small" type="submit">複製する</button><span class="note" id="bp-copy-status"></span></div>
          </form>`}`
        : '<p class="note">箱を押すと、中の名前・外の名前・入口と出口・先週の数が出ます。持ち主の企画と役目もここで変えます。</p>';
      const cf = $("bp-copy");
      if (cf) cf.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        $("bp-copy-status").textContent = "複製しています…";
        const r = await api("/api/admin/campaigns/copy", { method: "POST", token: getToken(), body: { campaign_id: cur.id, title: $("bp-copy-title").value, starts_on: $("bp-copy-date").value.trim() || null } });
        if (!r.ok) { $("bp-copy-status").textContent = "複製できませんでした（" + (r.error || r.status) + "）"; return; }
        view = r.campaign_id; selected = null; await load();
      });
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
        <dt>入口</dt><dd>${ins.length ? ins.map((e) => `${esc(name(e.from))}（${esc(e.label)}${e.counted === "none" ? "" : `・先週 ${e.week} 人`}）`).join("<br>") : "なし"}</dd>
        <dt>出口</dt><dd>${outs.length ? outs.map((e) => `${esc(name(e.to))}（${esc(e.label)}${e.counted === "none" ? "" : `・先週 ${e.week} 人`}）`).join("<br>") : "なし"}</dd>
        <dt>先週 7 日</dt><dd>${p.week}</dd>
      </dl>
      <form id="bp-assign" class="stack" style="margin-top:12px">
        <div><label for="bp-camp">持ち主の企画を変える</label><select id="bp-camp" class="inline" style="width:100%">
          <option value="">企画から外す</option>
          ${live.map((c) => `<option value="${esc(c.id)}"${c.id === p.campaign_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
        <div><label for="bp-role">役目（中の名前の最後に入る・空なら外の名前）</label><input id="bp-role" type="text" maxlength="60" value="${esc(p.role || "")}" placeholder="例 申込者フォロー"></div>
        <div><label for="bp-block">ブロック（同じ名前の部品が 1 箱にまとまる・空ならブロックに入れない）</label><input id="bp-block" type="text" maxlength="60" value="${esc(p.block_name || "")}" placeholder="例 申込から当日まで"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn small" type="submit">保存</button>
          ${editView(p) ? '<button class="btn ghost small" type="button" id="bp-open">開いて直す</button>' : ""}
          ${p.url ? `<a class="btn ghost small" href="${esc(p.url)}" target="_blank" rel="noopener">ページを見る</a>` : ""}
          <span class="note" id="bp-assign-status"></span>
        </div>
        ${p.type === "course" ? '<p class="note" style="margin:0">教材の中身は学ぶくんで直します。</p>' : ""}
      </form>`;
    $("bp-assign").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("bp-assign-status").textContent = "保存しています…";
      const r = await api("/api/admin/campaigns/assign", { method: "POST", token: getToken(), body: { part_type: p.type, part_id: p.id, campaign_id: $("bp-camp").value || null, role: $("bp-role").value, block_name: $("bp-block").value } });
      if (!r.ok) { $("bp-assign-status").textContent = "保存できませんでした（" + (r.error || r.status) + "）"; return; }
      await load();
      const s = $("bp-assign-status"); if (s) s.textContent = "保存しました";
    });
    const open = $("bp-open");
    if (open) open.addEventListener("click", () => openView(editView(p), p));
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
    document.querySelectorAll("#bp-mode [data-mode]").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      document.querySelectorAll("#bp-mode [data-mode]").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
      if (data) renderCanvas();
    }));
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

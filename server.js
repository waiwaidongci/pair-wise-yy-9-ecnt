import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as intake from "./desk/intake.js";
import * as decision from "./desk/decision.js";
import * as archive from "./desk/archive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "cyanotype-negative-room.json");
const port = Number(process.env.PORT || 3040);
const seed = {
  "items": [
    {
      "code": "CN-001",
      "plateSize": "18x24cm",
      "chemicalBatch": "B-0620",
      "exposure": "8分钟",
      "waterSource": "井水过滤",
      "box": "蓝盒A-03",
      "status": "冲洗中",
      "defect": "边角显影不均",
      "logs": [
        {
          "at": "2026-06-20",
          "step": "曝光",
          "note": "阴天补时2分钟"
        }
      ]
    }
  ],
  "copyGrants": [
    {
      "id": "CG-SEED-1",
      "negativeCode": "CN-001",
      "customer": "省美术馆",
      "purpose": "馆藏图录出版",
      "size": "18x24cm",
      "deadline": "2026-10-15",
      "handler": "周明",
      "box": "蓝盒A-03",
      "status": "待复制",
      "rejectReason": "",
      "reviews": [],
      "history": [
        {
          "at": "2026-09-20T02:00:00.000Z",
          "action": "登记",
          "note": "登记用途「馆藏图录出版」，期限至 2026-10-15",
          "by": "周明"
        }
      ],
      "createdAt": "2026-09-20T02:00:00.000Z",
      "updatedAt": "2026-09-20T02:00:00.000Z"
    }
  ]
};
const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
const stages = ["待曝光","冲洗中","待入盒","已交付"];
const statLabels = ["待曝光","冲洗中","待入盒","已交付"];
const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["repair","修补记录"],["note","备注"]];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "CN-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}
function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .tabs { display:flex; gap:8px; align-items:center; } .tabs button { background:#dfe6da; color:var(--ink); } .tabs button.active { background:var(--accent); color:#fff; }
    .checks { display:flex; gap:14px; flex-wrap:wrap; margin:8px 0; } .checks label { display:flex; gap:6px; align-items:center; margin:0; color:var(--ink); font-size:13px; } .checks input { width:auto; }
    .inline { border:1px dashed var(--line); border-radius:6px; padding:10px; display:grid; gap:4px; background:#fafbf8; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; } .actions button { padding:7px 11px; font-size:13px; }
    .badge { display:inline-block; border-radius:999px; padding:3px 8px; font-size:12px; background:#e7efe1; color:var(--accent); font-weight:700; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">底片任务、工艺步骤、缺陷和入盒交付 · 复制授权台</div></div><div class="tabs"><button id="tabItems" class="active">底片整理</button><button id="tabDesk">复制授权台</button><button id="reload">刷新</button></div></header>
  <main id="itemsMain">
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存底片</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>记录工艺步骤</h2><label>选择底片</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>创建蓝晒任务后，按涂布、晾干、曝光、冲洗、复晒、入盒记录每一步历史。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <main id="deskMain" hidden>
    <section>
      <form id="grantForm"><h2>登记复制授权</h2>
        <label>底片编号</label><select name="negativeCode" id="grantNegative"></select>
        <label>复制客户</label><input name="customer" required placeholder="取片的复制客户">
        <label>用途</label><input name="purpose" required placeholder="展览 / 出版 / 研究…">
        <label>复制尺寸</label><input name="size" required placeholder="如 18x24cm">
        <label>期限</label><input name="deadline" type="date" required>
        <label>经办人</label><input name="handler" required>
        <label>存放盒位</label><input name="box" placeholder="留空取底片当前盒位">
        <button>提交登记</button>
        <div class="meta">同一底片只留一条未完成授权；过期或已排给别家即拒绝；复制件不出馆。</div>
      </form>
    </section>
    <section>
      <div class="stats" id="grantStats"></div>
      <div class="toolbar"><select id="grantStatusFilter"></select><input id="grantSearch" placeholder="搜索客户 / 用途 / 盒位"></div>
      <div class="panel"><h2>授权台账</h2><div class="grid" id="grantCards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ["待曝光","冲洗中","待入盒","已交付"];
    const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["repair","修补记录"],["note","备注"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function render() {
      itemSelect.innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
    }
    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+t.position+' · '+t.status+' · '+t.tension+'</div>').join('');
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+'</span>'+main+tasks+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    async function load() { items = await api('/api/items'); render(); }
    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = () => { load(); if (!deskMain.hidden) loadGrants(); };
    // ===== 复制授权台 =====
    const GRANT_STATUSES = ['待复制','待复验','已归档','已撤回','已拒绝'];
    const deskMain = document.querySelector('#deskMain');
    const itemsMain = document.querySelector('#itemsMain');
    const tabItems = document.querySelector('#tabItems');
    const tabDesk = document.querySelector('#tabDesk');
    const grantForm = document.querySelector('#grantForm');
    const grantNegative = document.querySelector('#grantNegative');
    const grantCards = document.querySelector('#grantCards');
    const grantStats = document.querySelector('#grantStats');
    const grantStatusFilter = document.querySelector('#grantStatusFilter');
    const grantSearch = document.querySelector('#grantSearch');
    let grants = [];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function showTab(which) {
      itemsMain.hidden = which !== 'items';
      deskMain.hidden = which !== 'desk';
      tabItems.classList.toggle('active', which === 'items');
      tabDesk.classList.toggle('active', which === 'desk');
      if (which === 'desk') loadGrants();
    }
    tabItems.onclick = () => showTab('items');
    tabDesk.onclick = () => showTab('desk');
    async function loadGrants() {
      grants = await api('/api/copy-grants');
      renderGrantOptions();
      renderGrants();
    }
    function renderGrantOptions() {
      grantNegative.innerHTML = items.map(i => '<option value="'+esc(i.code)+'">'+esc(i.code)+' · '+esc(i.plateSize || '')+'</option>').join('');
      prefillSize();
    }
    function prefillSize() {
      const neg = items.find(i => i.code === grantNegative.value);
      if (neg && !grantForm.size.value) grantForm.size.value = neg.plateSize || '';
    }
    grantNegative.onchange = prefillSize;
    function renderGrantStats() {
      grantStats.innerHTML = GRANT_STATUSES.map(s => '<div class="stat"><span>'+s+'</span><strong>'+grants.filter(g => g.status === s).length+'</strong></div>').join('');
    }
    function renderGrants() {
      renderGrantStats();
      const status = grantStatusFilter.value;
      const q = grantSearch.value.trim();
      const visible = grants.filter(g => (!status || g.status === status) && (!q || [g.negativeCode, g.customer, g.purpose, g.handler, g.box, g.size].join(' ').includes(q)));
      grantCards.innerHTML = visible.map(grantCardHtml).join('') || '<div class="meta">暂无授权记录</div>';
    }
    function grantCardHtml(g) {
      const open = g.status === '待复制' || g.status === '待复验';
      const head = '<h3>'+esc(g.negativeCode)+' · '+esc(g.id)+'</h3><span class="pill">'+esc(g.status)+'</span>'
        + (g.expired && open ? '<span class="warn">已过期</span>' : '')
        + (g.status === '已归档' ? '<span class="badge">复制件留存馆内 · 不出馆</span>' : '');
      const info = '<div><b>客户</b> '+esc(g.customer)+'</div><div><b>用途</b> '+esc(g.purpose)+'</div>'
        + '<div><b>尺寸</b> '+esc(g.size)+' · <b>盒位</b> '+esc(g.box)+'</div>'
        + '<div><b>期限</b> '+esc(g.deadline)+' · <b>经办人</b> '+esc(g.handler)+'</div>';
      const rejected = g.status === '已拒绝' && g.rejectReason ? '<div class="warn">拒绝：'+esc(g.rejectReason)+'</div>' : '';
      const lastReview = (g.reviews || []).slice(-1)[0];
      const reviewLine = lastReview
        ? '<div class="meta">最近复核：'+esc(lastReview.verifier)+' · '+(lastReview.passed ? '通过' : '未过（'+esc((lastReview.problems || []).join('、'))+'）')+' · '+esc(String(lastReview.at).slice(0,10))+'</div>'
        : '';
      const hist = (g.history || []).slice(-3).map(h => '<div>'+esc(h.action)+'：'+esc(h.note)+'</div>').join('');
      const actions = open
        ? '<div class="actions"><button data-act="review" data-id="'+esc(g.id)+'">复核</button><button class="secondary" data-act="amend" data-id="'+esc(g.id)+'">修正</button><button class="secondary" data-act="withdraw" data-id="'+esc(g.id)+'">撤回</button></div>'
        : '';
      const reviewForm = open
        ? '<form class="inline" data-form="review" data-id="'+esc(g.id)+'" hidden><b>复核（须另一人核对）</b><label>复核人</label><input name="verifier" required placeholder="不能是经办人 '+esc(g.handler)+'"><label>复制人</label><input name="copiedBy" placeholder="留空视为经办人"><div class="checks"><label><input type="checkbox" name="sampleOk" checked>样片已收</label><label><input type="checkbox" name="sizeOk" checked>尺寸一致</label><label><input type="checkbox" name="boxOk" checked>盒位一致</label></div><label>备注</label><input name="note"><button>提交复核</button></form>'
        : '';
      const amendForm = open
        ? '<form class="inline" data-form="amend" data-id="'+esc(g.id)+'" hidden><b>修正（旧授权与结论退回重算）</b><label>用途</label><input name="purpose" value="'+esc(g.purpose)+'"><label>期限</label><input name="deadline" type="date" value="'+esc(g.deadline)+'"><label>尺寸</label><input name="size" value="'+esc(g.size)+'"><label>盒位</label><input name="box" value="'+esc(g.box)+'"><label>修正经办人</label><input name="by" required><button>提交修正</button></form>'
        : '';
      const withdrawForm = open
        ? '<form class="inline" data-form="withdraw" data-id="'+esc(g.id)+'" hidden><b>撤回授权</b><label>经办人</label><input name="by" required><label>原因</label><input name="reason"><button>确认撤回</button></form>'
        : '';
      return '<article class="card">'+head+info+rejected+reviewLine+actions+reviewForm+amendForm+withdrawForm+'<div class="logs meta">'+(hist || '暂无记录')+'</div></article>';
    }
    grantCards.onclick = event => {
      const btn = event.target.closest('button[data-act]');
      if (!btn) return;
      const card = btn.closest('.card');
      card.querySelectorAll('form.inline').forEach(f => { f.hidden = f.dataset.form !== btn.dataset.act || !f.hidden; });
    };
    grantCards.onsubmit = async event => {
      const form = event.target.closest('form.inline');
      if (!form) return;
      event.preventDefault();
      const id = form.dataset.id;
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        if (form.dataset.form === 'review') {
          data.sampleOk = form.sampleOk.checked; data.sizeOk = form.sizeOk.checked; data.boxOk = form.boxOk.checked;
          await api('/api/copy-grants/'+id+'/review', { method:'POST', body: JSON.stringify(data) });
        } else if (form.dataset.form === 'amend') {
          await api('/api/copy-grants/'+id, { method:'PATCH', body: JSON.stringify(data) });
        } else if (form.dataset.form === 'withdraw') {
          await api('/api/copy-grants/'+id+'/withdraw', { method:'POST', body: JSON.stringify(data) });
        }
        await loadGrants();
      } catch (err) { alert(err.message); }
    };
    grantForm.onsubmit = async event => {
      event.preventDefault();
      try {
        await api('/api/copy-grants', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(grantForm).entries())) });
        grantForm.reset();
        await loadGrants();
      } catch (err) { alert(err.message); }
    };
    grantStatusFilter.innerHTML = '<option value="">全部状态</option>' + GRANT_STATUSES.map(s => '<option>'+s+'</option>').join('');
    grantStatusFilter.onchange = renderGrants;
    grantSearch.oninput = renderGrants;
    renderForms(); load();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    // ===== 复制授权台（入口 desk/intake.js · 判定 desk/decision.js · 存档 desk/archive.js）=====
    if (req.method === "GET" && url.pathname === "/api/copy-grants") {
      const today = intake.todayStr();
      const rows = archive.listGrants(db, {
        status: url.searchParams.get("status") || "",
        negativeCode: url.searchParams.get("negativeCode") || "",
      });
      return send(res, 200, rows.map((g) => archive.grantView(g, today)));
    }
    if (req.method === "POST" && url.pathname === "/api/copy-grants") {
      const raw = await body(req);
      if (intake.takeOutRequested(raw)) {
        return send(res, 403, { error: "copy_must_stay_in_building", message: "复制件不出馆" });
      }
      const negative = db.items.find((x) => x.code === intake.clean(raw.negativeCode));
      if (!negative) return send(res, 404, { error: "negative_not_found", message: "底片不存在" });
      const { data, errors } = intake.parseApply(raw, negative.box);
      if (errors.length) return send(res, 400, { error: "invalid_grant", message: errors.join("；") });
      const verdict = decision.decideApply(data, archive.ensureGrants(db));
      const grant = archive.createGrant(db, data, verdict, new Date().toISOString());
      await saveDb(db);
      if (!verdict.ok) {
        return send(res, 409, { error: verdict.code, message: verdict.message, grant: archive.grantView(grant, intake.todayStr()) });
      }
      return send(res, 201, archive.grantView(grant, intake.todayStr()));
    }
    const grantOne = url.pathname.match(/^\/api\/copy-grants\/([^/]+)$/);
    if (grantOne && req.method === "GET") {
      const grant = archive.findGrant(db, grantOne[1]);
      if (!grant) return send(res, 404, { error: "grant_not_found", message: "授权不存在" });
      return send(res, 200, archive.grantView(grant, intake.todayStr()));
    }
    if (grantOne && req.method === "PATCH") {
      const raw = await body(req);
      if (intake.takeOutRequested(raw)) {
        return send(res, 403, { error: "copy_must_stay_in_building", message: "复制件不出馆" });
      }
      const grant = archive.findGrant(db, grantOne[1]);
      if (!grant) return send(res, 404, { error: "grant_not_found", message: "授权不存在" });
      const { patch, by, errors } = intake.parseAmend(raw);
      if (errors.length) return send(res, 400, { error: "invalid_amend", message: errors.join("；") });
      const verdict = decision.decideAmend(grant, patch);
      if (!verdict.ok) return send(res, 409, { error: verdict.code, message: verdict.message });
      archive.applyAmend(db, grant, verdict.patch, by, new Date().toISOString());
      await saveDb(db);
      return send(res, 200, archive.grantView(grant, intake.todayStr()));
    }
    const grantReview = url.pathname.match(/^\/api\/copy-grants\/([^/]+)\/review$/);
    if (grantReview && req.method === "POST") {
      const raw = await body(req);
      if (intake.takeOutRequested(raw)) {
        return send(res, 403, { error: "copy_must_stay_in_building", message: "复制件不出馆" });
      }
      const grant = archive.findGrant(db, grantReview[1]);
      if (!grant) return send(res, 404, { error: "grant_not_found", message: "授权不存在" });
      const { data, errors } = intake.parseReview(raw);
      if (errors.length) return send(res, 400, { error: "invalid_review", message: errors.join("；") });
      const verdict = decision.decideReview(grant, data);
      if (!verdict.ok) return send(res, 409, { error: verdict.code, message: verdict.message });
      archive.applyReview(db, grant, data, verdict, new Date().toISOString());
      await saveDb(db);
      return send(res, 200, archive.grantView(grant, intake.todayStr()));
    }
    const grantWithdraw = url.pathname.match(/^\/api\/copy-grants\/([^/]+)\/withdraw$/);
    if (grantWithdraw && req.method === "POST") {
      const grant = archive.findGrant(db, grantWithdraw[1]);
      if (!grant) return send(res, 404, { error: "grant_not_found", message: "授权不存在" });
      const { data, errors } = intake.parseWithdraw(await body(req));
      if (errors.length) return send(res, 400, { error: "invalid_withdraw", message: errors.join("；") });
      const verdict = decision.decideWithdraw(grant);
      if (!verdict.ok) return send(res, 409, { error: verdict.code, message: verdict.message });
      archive.applyWithdraw(db, grant, data.by, data.reason, new Date().toISOString());
      await saveDb(db);
      return send(res, 200, archive.grantView(grant, intake.todayStr()));
    }
    const grantTakeOut = url.pathname.match(/^\/api\/copy-grants\/([^/]+)\/take-out$/);
    if (grantTakeOut && req.method === "POST") {
      return send(res, 403, { error: "copy_must_stay_in_building", message: "复制件不出馆，任何情况下不得办理出馆" });
    }
    // ===== 复制授权台结束 =====
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建底片" }] };
      
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = db.items.find(x => x.id === patch[1] || x.code === patch[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      Object.assign(item, await body(req));
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = db.items.find(x => x.id === log[1] || x.code === log[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = db.items.find(x => x.id === action[1] || x.code === action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.steps ||= [];
      item.steps.push({ at: new Date().toISOString(), ...input });
      if (input.defect) item.defect = input.defect;
      if (input.step === "冲洗") item.status = "冲洗中";
      else if (input.step === "入盒") item.status = "待入盒";
      else if (input.step === "交付") item.status = "已交付";
      else item.status = "待曝光";
      item.logs.push({ at: new Date().toISOString(), step: input.step || "工艺", note: input.note || input.developStatus || "步骤记录" });
      await saveDb(db);
      return send(res, 201, item);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));

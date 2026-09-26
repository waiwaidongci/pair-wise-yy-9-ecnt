import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS_ORDER, ReproError, reproView } from "./repro/shared.js";
import { apply, withdraw, amend } from "./repro/intake.js";
import { judge, review } from "./repro/decision.js";

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
  "repros": []
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
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.repros ||= []; // 复制授权台数据
  return db;
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
    .tabs { display:flex; gap:10px; align-items:center; } .tabs button.on { background:var(--accent); } .tabs button.off { background:#69736a; }
    .actions { display:grid; gap:6px; border-top:1px solid var(--line); padding-top:8px; } .row { display:flex; gap:8px; } .row > * { flex:1; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>古法蓝晒底片整理室</h1><div class="meta">底片任务、工艺步骤、缺陷和入盒交付 · 复制授权台</div></div>
    <div class="tabs"><button id="tabNeg" class="on">底片整理</button><button id="tabRepro" class="off">复制授权台</button><button id="reload">刷新</button></div>
  </header>
  <div id="view-neg">
  <main>
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
  </div>
  <div id="view-repro" hidden>
  <main>
    <section>
      <form id="reproForm"><h2>登记复制授权</h2>
        <label>底片</label><select name="itemRef" id="reproItemSelect"></select>
        <label>复制客户</label><input name="client" required>
        <label>用途</label><input name="purpose" required placeholder="如 展览图录 / 研究出版">
        <label>复制尺寸</label><input name="size" required placeholder="如 24x30cm">
        <label>授权期限</label><input name="term" type="date" required>
        <label>经办人</label><input name="handler" required>
        <label>授权盒位（留空取底片现盒位）</label><input name="box">
        <button>提交申请</button>
      </form>
      <form id="amendForm" style="margin-top:14px"><h2>修正授权</h2>
        <label>选择未完成授权单</label><select name="id" id="amendSelect"></select>
        <label>复制客户</label><input name="client">
        <label>用途</label><input name="purpose">
        <label>复制尺寸</label><input name="size">
        <label>授权期限</label><input name="term" type="date">
        <label>盒位</label><input name="box">
        <label>经办人</label><input name="handler">
        <p class="meta">修正用途、期限、尺寸或盒位后，旧授权与复核结论退回重算。</p>
        <button>提交修正</button>
      </form>
    </section>
    <section>
      <div class="stats" id="reproStats"></div>
      <div class="toolbar"><select id="reproStatusFilter"></select><input id="reproSearch" placeholder="搜索客户、用途、单号"></div>
      <div class="panel"><h2>授权单列表：申请、判定、复核、撤回与存档全程留痕；复核合格前复制件不出馆。</h2><div class="grid" id="reproCards"></div></div>
    </section>
  </main>
  </div>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ["待曝光","冲洗中","待入盒","已交付"];
    const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["repair","修补记录"],["note","备注"]];
    const reproStatuses = ["待判定","已授权","待复验","已完成","已拒绝","已撤回"];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    const reproForm = document.querySelector('#reproForm');
    const amendForm = document.querySelector('#amendForm');
    const reproItemSelect = document.querySelector('#reproItemSelect');
    const amendSelect = document.querySelector('#amendSelect');
    const reproCards = document.querySelector('#reproCards');
    const reproStatsEl = document.querySelector('#reproStats');
    let items = [];
    let repros = [];
    let view = 'neg';
    function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || '请求失败');
      return data;
    }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
      document.querySelector('#reproStatusFilter').innerHTML = '<option value="">全部状态</option>' + reproStatuses.map(s => '<option>'+s+'</option>').join('');
    }
    function render() {
      const options = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      itemSelect.innerHTML = options;
      reproItemSelect.innerHTML = items.map(item => '<option value="'+esc(item.code || item.id)+'">'+esc(item.code || item.id)+' · 现盒位 '+esc(item.box || '—')+'</option>').join('');
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

    // ===== 复制授权台 =====
    function reproCardHtml(r) {
      const logs = (r.logs || []).slice(-5).map(l => '<div>'+l.step+'：'+esc(l.note)+'</div>').join('');
      let warn = '';
      if (r.expired && r.unfinished) warn += '<div class="warn">授权期限 '+r.term+' 已过期，判定将拒绝</div>';
      if (r.conflict) warn += '<div class="warn">底片已排给别家：'+r.conflict.no+'（'+esc(r.conflict.client)+'，'+r.conflict.status+'）</div>';
      const decision = r.decision ? '<div class="meta">判定：'+esc(r.decision.judge)+' · '+r.decision.result+' · '+esc(r.decision.reason)+'</div>' : '';
      const reviews = (r.reviews || []).map(v => '<div class="meta">复核：'+esc(v.checker)+' · '+(v.problems.length ? '未通过（'+esc(v.problems.join('；'))+'）' : '通过')+'</div>').join('');
      const archive = r.archive ? '<div class="meta">存档：'+esc(r.archive.location)+' · 复制件不出馆</div>' : '';
      let actions = '';
      if (r.status === '待判定') {
        actions += '<div class="actions"><label>判定人</label><input data-judge-name="'+r.id+'"><div class="row"><button data-grant="'+r.id+'">判定通过</button><button class="secondary" data-deny="'+r.id+'">判定拒绝</button></div></div>';
      }
      if (r.status === '已授权' || r.status === '待复验') {
        actions += '<div class="actions"><label>复核人（须非经办人）</label><input data-checker="'+r.id+'">'
          + '<label>样片</label><select data-sample="'+r.id+'"><option value="有">样片齐全</option><option value="缺">缺样</option></select>'
          + '<label>实测尺寸</label><input data-asize="'+r.id+'" placeholder="默认 '+esc(r.size)+'">'
          + '<label>实放盒位</label><input data-abox="'+r.id+'" placeholder="默认取母版现盒位">'
          + '<button data-review="'+r.id+'">提交复核</button></div>';
      }
      if (r.unfinished) actions += '<button class="secondary" data-withdraw="'+r.id+'">撤回申请</button>';
      return '<article class="card"><h3>'+r.no+' · '+esc(r.client)+'</h3><span class="pill">'+r.status+'</span>'
        + '<div><b>底片</b> '+esc(r.itemCode)+'（现盒位 '+esc(r.itemBox || '—')+'）</div>'
        + '<div><b>用途</b> '+esc(r.purpose)+'</div>'
        + '<div><b>尺寸</b> '+esc(r.size)+' · <b>期限至</b> '+r.term+'</div>'
        + '<div><b>盒位</b> '+esc(r.box)+' · <b>经办</b> '+esc(r.handler)+'</div>'
        + warn + decision + reviews + archive + actions
        + '<div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function renderRepros() {
      const stats = Object.fromEntries(reproStatuses.map(s => [s, repros.filter(r => r.status === s).length]));
      reproStatsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const unfinished = repros.filter(r => r.unfinished);
      amendSelect.innerHTML = unfinished.map(r => '<option value="'+r.id+'">'+r.no+' · '+esc(r.client)+' · '+r.status+'</option>').join('') || '<option value="">暂无可修正授权</option>';
      const status = document.querySelector('#reproStatusFilter').value;
      const q = document.querySelector('#reproSearch').value.trim();
      const visible = repros.filter(r => (!status || r.status === status) && (!q || JSON.stringify(r).includes(q)));
      reproCards.innerHTML = visible.map(reproCardHtml).join('') || '<p class="meta">暂无授权单</p>';
      bindReproActions();
    }
    function bindReproActions() {
      document.querySelectorAll('[data-grant]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.grant;
        const judge = document.querySelector('[data-judge-name="'+id+'"]').value.trim();
        try { await api('/api/repros/'+id+'/decide', { method:'POST', body: JSON.stringify({ judge, grant:true }) }); await loadRepros(); } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-deny]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.deny;
        const judge = document.querySelector('[data-judge-name="'+id+'"]').value.trim();
        const reason = prompt('拒绝原因') || '';
        try { await api('/api/repros/'+id+'/decide', { method:'POST', body: JSON.stringify({ judge, grant:false, reason }) }); await loadRepros(); } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-review]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.review;
        const payload = {
          checker: document.querySelector('[data-checker="'+id+'"]').value.trim(),
          hasSample: document.querySelector('[data-sample="'+id+'"]').value === '有',
          actualSize: document.querySelector('[data-asize="'+id+'"]').value.trim(),
          actualBox: document.querySelector('[data-abox="'+id+'"]').value.trim(),
        };
        try { await api('/api/repros/'+id+'/review', { method:'POST', body: JSON.stringify(payload) }); await loadRepros(); } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-withdraw]').forEach(btn => btn.onclick = async () => {
        const reason = prompt('撤回原因') || '';
        try { await api('/api/repros/'+btn.dataset.withdraw+'/withdraw', { method:'POST', body: JSON.stringify({ reason }) }); await loadRepros(); } catch (e) { alert(e.message); }
      });
    }
    async function loadRepros() { repros = await api('/api/repros'); renderRepros(); }
    reproForm.onsubmit = async event => {
      event.preventDefault();
      try {
        await api('/api/repros', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(reproForm).entries())) });
        reproForm.reset(); await loadRepros();
      } catch (e) { alert(e.message); }
    };
    amendForm.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(amendForm).entries());
      const id = data.id; delete data.id;
      Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
      if (!id) return alert('请选择授权单');
      try { await api('/api/repros/'+id, { method:'PATCH', body: JSON.stringify(data) }); amendForm.reset(); await loadRepros(); } catch (e) { alert(e.message); }
    };
    document.querySelector('#reproStatusFilter').onchange = renderRepros;
    document.querySelector('#reproSearch').oninput = renderRepros;

    function show(v) {
      view = v;
      document.querySelector('#view-neg').hidden = v !== 'neg';
      document.querySelector('#view-repro').hidden = v !== 'repro';
      document.querySelector('#tabNeg').className = v === 'neg' ? 'on' : 'off';
      document.querySelector('#tabRepro').className = v === 'repro' ? 'on' : 'off';
      if (v === 'repro') loadRepros();
    }
    document.querySelector('#tabNeg').onclick = () => show('neg');
    document.querySelector('#tabRepro').onclick = () => show('repro');

    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = () => (view === 'repro' ? loadRepros() : load());
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
    // ===== 复制授权台：入口 / 判定 / 存档 =====
    if (req.method === "GET" && url.pathname === "/api/repros") {
      const status = url.searchParams.get("status");
      const q = (url.searchParams.get("q") || "").trim();
      let list = db.repros.map((r) => reproView(r, db));
      if (status) list = list.filter((r) => r.status === status);
      if (q) list = list.filter((r) => JSON.stringify(r).includes(q));
      return send(res, 200, list);
    }
    if (req.method === "POST" && url.pathname === "/api/repros") {
      const auth = apply(db, await body(req));
      await saveDb(db);
      return send(res, 201, reproView(auth, db));
    }
    const reproOne = url.pathname.match(/^\/api\/repros\/([^/]+)$/);
    if (reproOne && req.method === "PATCH") {
      const auth = amend(db, reproOne[1], await body(req));
      await saveDb(db);
      return send(res, 200, reproView(auth, db));
    }
    const reproAct = url.pathname.match(/^\/api\/repros\/([^/]+)\/(decide|review|withdraw)$/);
    if (reproAct && req.method === "POST") {
      const input = await body(req);
      const auth =
        reproAct[2] === "decide" ? judge(db, reproAct[1], input)
        : reproAct[2] === "review" ? review(db, reproAct[1], input)
        : withdraw(db, reproAct[1], input);
      await saveDb(db);
      return send(res, 200, reproView(auth, db));
    }
    if (req.method === "GET" && url.pathname === "/api/repros/stats") {
      const stats = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
      for (const r of db.repros) if (stats[r.status] !== undefined) stats[r.status] += 1;
      return send(res, 200, stats);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ReproError) return send(res, error.status, { error: error.code, message: error.message });
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));

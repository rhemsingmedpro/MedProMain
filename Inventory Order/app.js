'use strict';
/* MedPro Inventory Orders - TEST build.
   Data goes through `Store` only. At go-live, replace Store (local Excel helper) with SharePoint/Graph
   and replace the test user picker with MS365 sign-in (MSAL). */

// ============================ Store (swap at go-live) ============================
const Store = window.DemoStore || {
  async load() { const r = await fetch('/api/data'); if (!r.ok) throw new Error('Cannot load data'); return (await r.json()).tables; },
  async save(ops, user) {
    const r = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, ops }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
  },
  async nextId(kind, prefix) { const r = await fetch(`/api/nextid?kind=${kind}&prefix=${encodeURIComponent(prefix || '')}`); return (await r.json()).id; },
  async audit(q, table) { const r = await fetch(`/api/audit?q=${encodeURIComponent(q || '')}&table=${encodeURIComponent(table || '')}`); return (await r.json()).rows; },
  async reloadSource() { await fetch('/api/reload'); }
};
const Mailer = { // TEST: emails are only written to the Outbox sheet. Go-live: Graph sendMail / Power Automate.
  queue(tx, to, subject, body) { tx.put('Outbox', { Created: nowTs(), To: to, Subject: subject, Body: body, Mode: 'SIMULATED (test)' }); }
};

// ============================ Helpers ============================
const KEYS = { Items: ['Part'], OfficeItems: ['Office', 'Part'], Offices: ['Office'], Users: ['Email'], Orders: ['OrderNo'], OrderLines: ['OrderNo', 'Line'], Shipments: ['ShipmentID'], ShipmentLines: ['ShipmentID', 'Line'], Settings: ['Key'] };
const CYCLE_DAYS = { Weekly: 7, Monthly: 30, Quarterly: 91 };
const OPEN = ['Submitted', 'Backordered', 'Partially Shipped', 'Shipped'];
const S = { dnoReason: {}, pick: new Set(), data: null, user: null, office: null, view: null, cart: [], draft: { type: 'Office Stock', pname: '', pphone: '', note: '' }, dupOk: new Set(), countPrompted: new Set(), admTab: 'users', fl: {} };
const $ = s => document.querySelector(s);
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTs = () => { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const n0 = v => (v === null || v === '' || v === undefined) ? null : Number(v);
const slug = s => String(s).replace(/\s+/g, '');
const badge = s => `<span class="badge b-${slug(s)}">${e(s)}</span>`;
const addDays = (iso, d) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const T = name => S.data[name];
const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', bad ? 6000 : 3500); }
function modal(html, wide) { const o = $('#overlay'); o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`; o.classList.add('on'); }
function closeModal() { const o = $('#overlay'); o.classList.remove('on'); o.innerHTML = ''; }

class Tx {
  constructor() { this.ops = new Map(); }
  put(table, row) {
    const k = KEYS[table]; let target = null;
    if (k) target = T(table).find(r => k.every(c => String(r[c]) === String(row[c])));
    if (target) Object.assign(target, row); else { target = { ...row }; T(table).push(target); }
    if (!this.ops.has(table)) this.ops.set(table, new Set());
    this.ops.get(table).add(target);
  }
  async commit() {
    const ops = [...this.ops].map(([table, rows]) => ({ table, rows: [...rows] }));
    if (!ops.length) return;
    try { await Store.save(ops, S.user.Name); } catch (err) { toast(err.message, true); await loadData(); throw err; }
    await loadData();
  }
}

async function loadData() { S.data = await Store.load(); }

// ============================ Domain logic ============================
const roleOf = () => S.user.Role;
const isAdmin = () => S.user.Admin === 'Y';
const isShipper = () => roleOf() === 'Shipper';
const canOrder = () => ['Office Staff', 'Field Staff'].includes(roleOf());
const canCount = () => roleOf() === 'Office Staff';
const canReceive = () => ['Office Staff', 'Field Staff'].includes(roleOf());
const offices = () => T('Offices').filter(o => o.Active !== 'N');
const officeName = c => (T('Offices').find(o => o.Office === c) || {}).Name || c;
function userOffices(u) { const all = offices().map(o => o.Office); return u.Offices === 'ALL' ? all : u.Offices.split(';').map(s => s.trim()).filter(x => all.includes(x)); }
function curOffice() { return S.office === 'ALL' ? null : S.office; }
const linesOf = no => T('OrderLines').filter(l => l.OrderNo === no).sort((a, b) => a.Line - b.Line);
const orderOf = no => T('Orders').find(o => o.OrderNo === no);
const effQty = l => l.QtyOrdered - l.QtyCancelled;
const outstanding = l => effQty(l) - l.QtyShipped;

function transitMap() {
  const ids = new Set(T('Shipments').filter(s => s.Status === 'In Transit').map(s => s.ShipmentID));
  const m = new Map();
  for (const sl of T('ShipmentLines')) if (ids.has(sl.ShipmentID)) { const k = sl.OrderNo + '|' + sl.Line; m.set(k, (m.get(k) || 0) + sl.QtyShipped); }
  return m;
}
function lineStatus(l, tm) {
  const out = outstanding(l);
  if (effQty(l) <= 0) return 'Cancelled';
  if (l.QtyShipped === 0) return l.Backorder === 'Y' ? 'Backordered' : 'Submitted';
  if (out > 0) return l.Backorder === 'Y' ? 'Backordered' : 'Partially Shipped';
  return (tm.get(l.OrderNo + '|' + l.Line) || 0) > 0 ? 'Shipped' : 'Received';
}
function orderStatus(no, tm) {
  const ls = linesOf(no).filter(l => lineStatus(l, tm) !== 'Cancelled');
  if (!ls.length) return 'Cancelled';
  const outs = ls.filter(l => outstanding(l) > 0);
  if (!outs.length) return ls.some(l => (tm.get(l.OrderNo + '|' + l.Line) || 0) > 0) ? 'Shipped' : 'Closed';
  if (ls.some(l => l.QtyShipped > 0)) return 'Partially Shipped';
  return outs.some(l => l.Backorder === 'Y') ? 'Backordered' : 'Submitted';
}
function refreshOrder(tx, no) {
  const tm = transitMap(), now = nowTs();
  for (const l of linesOf(no)) {
    const st = lineStatus(l, tm);
    if (st !== l.LineStatus) tx.put('OrderLines', { ...l, LineStatus: st, LastUpdated: now, UpdatedBy: S.user.Name });
  }
  const o = orderOf(no), os = orderStatus(no, tm);
  if (os !== o.Status) tx.put('Orders', { ...o, Status: os, LastUpdated: now });
}
function bumpLine(tx, l, patch) { tx.put('OrderLines', { ...l, ...patch, LastUpdated: nowTs(), UpdatedBy: S.user.Name }); }

// qty already on its way to an office for a part (outstanding on open orders + in transit)
function onOrderMap(office) {
  const m = new Map(), tm = transitMap();
  const open = new Set(T('Orders').filter(o => o.Office === office && OPEN.includes(o.Status)).map(o => o.OrderNo));
  for (const l of T('OrderLines')) if (open.has(l.OrderNo)) {
    const q = Math.max(0, outstanding(l)) + (tm.get(l.OrderNo + '|' + l.Line) || 0);
    if (q > 0) m.set(l.Part, (m.get(l.Part) || 0) + q);
  }
  return m;
}
function openLinesFor(office, part) {
  const tm = transitMap(); const res = [];
  for (const o of T('Orders')) if (o.Office === office && OPEN.includes(o.Status))
    for (const l of linesOf(o.OrderNo)) if (l.Part === part && (outstanding(l) > 0 || (tm.get(l.OrderNo + '|' + l.Line) || 0) > 0)) res.push({ o, l, transit: tm.get(l.OrderNo + '|' + l.Line) || 0 });
  return res;
}
const oiOf = (office, part) => T('OfficeItems').find(r => r.Office === office && r.Part === part);
const itemOf = part => T('Items').find(i => i.Part === part);
function isDue(oi) { if (!oi.LastCounted) return true; return today() >= addDays(oi.LastCounted, CYCLE_DAYS[oi.CountCycle] || 91); }
function dueList(office) {
  const items = new Map(T('Items').filter(i => i.Active !== 'N').map(i => [i.Part, i]));
  return T('OfficeItems').filter(r => r.Office === office && items.has(r.Part) && isDue(r)).map(r => ({ ...r, item: items.get(r.Part) }))
    .sort((a, b) => cmp(a.item.Category, b.item.Category) || cmp(a.Part, b.Part));
}
const setting = k => (T('Settings').find(s => s.Key === k) || {}).Value || '';
const carriers = () => { const l = (setting('Carriers') || 'Purolator;Canada Post;FedEx;UPS').split(';').map(s => s.trim()).filter(Boolean); return l.length ? l : ['Purolator']; }; // first = default
const serialList = s => String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
const serialsOf = (sid, line) => { const x = T('ShipmentLines').find(y => y.ShipmentID === sid && y.Line === line); return x ? serialList(x.Serials) : []; };

// ============================ Shell / navigation ============================
function tabs() {
  const r = roleOf(); let t = [];
  if (r === 'Shipper') t = [['queue', 'Shipping Queue'], ['backorders', 'Backorders by Item'], ['issues', 'Receipt Issues'], ['orders', 'All Orders'], ['stock', 'Stock Levels']];
  else if (r === 'Office Staff') t = [['home', 'Home'], ['neworder', 'New Order'], ['orders', 'Orders'], ['receiving', 'Receiving'], ['stock', 'Stock & Counts']];
  else t = [['neworder', 'New Order'], ['orders', 'Orders'], ['receiving', 'Receiving'], ['stock', 'Stock Levels']];
  if (isAdmin()) t.push(['admin', 'Admin']);
  return t;
}
function go(v) { S.view = v; render(); window.scrollTo(0, 0); }

function render() {
  const app = $('#app');
  if (!S.user) { app.innerHTML = loginHtml(); return; }
  const tb = tabs(); if (!S.view || !tb.find(t => t[0] === S.view)) S.view = tb[0][0];
  const offs = offices(), mine = userOffices(S.user);
  const optOff = c => `<option value="${c}" ${S.office === c ? 'selected' : ''}>${e(officeName(c))}</option>`;
  const officeSel = `<select id="officeSel">${(isShipper() || isAdmin()) ? `<option value="ALL" ${S.office === 'ALL' ? 'selected' : ''}>All offices</option>` : ''}
    ${mine.length && S.user.Offices !== 'ALL' ? `<optgroup label="My offices">${mine.map(optOff).join('')}</optgroup><optgroup label="Other offices">${offs.filter(o => !mine.includes(o.Office)).map(o => optOff(o.Office)).join('')}</optgroup>` : offs.map(o => optOff(o.Office)).join('')}</select>`;
  app.innerHTML = `<div class="testbar">${window.DemoStore ? 'DEMO - sample data stored only in this browser (nothing is shared or sent). Sign-in is a user picker. <a href="#" data-act="demoReset">Reset demo data</a>' : 'TEST MODE - data is saved to InventoryData.xlsx on this PC. Sign-in is a user picker; MS365 login and SharePoint replace this at go-live.'}</div>
  <header class="top"><img src="MedPro-logo.png" alt="MedPro Respiratory Care"><span class="title">Inventory Orders</span>
    <div class="ctl">Office${officeSel}</div>
    <div class="ctl">Signed in (test) - ${e(S.user.Role)}<select id="userSel">${T('Users').filter(u => u.Active !== 'N').map(u => `<option value="${e(u.Email)}" ${u.Email === S.user.Email ? 'selected' : ''}>${e(u.Name)}</option>`).join('')}</select></div>
  </header>
  <nav class="tabs">${tb.map(t => `<button data-act="nav" data-v="${t[0]}" class="${S.view === t[0] ? 'on' : ''}">${t[1]}${tabBadge(t[0])}</button>`).join('')}</nav>
  <main id="main"></main>`;
  $('#officeSel').onchange = ev => { S.office = ev.target.value; S.cart = []; S.dnoReason = {}; S.dupOk = new Set(); render(); maybeCountPrompt(); };
  $('#userSel').onchange = ev => signIn(ev.target.value);
  renderView();
}
function tabBadge(v) {
  if (v === 'issues') { const n = issues().length; return n ? ` <span class="badge b-low">${n}</span>` : ''; }
  if (v === 'receiving' && curOffice()) { const n = T('Shipments').filter(s => s.Office === curOffice() && s.Status === 'In Transit').length; return n ? ` <span class="badge b-Shipped">${n}</span>` : ''; }
  if (v === 'queue') { const n = T('Orders').filter(o => ['Submitted', 'Partially Shipped', 'Backordered'].includes(o.Status)).length; return n ? ` <span class="badge b-Submitted">${n}</span>` : ''; }
  return '';
}
function renderView() {
  const m = $('#main');
  const V = { home: vHome, neworder: vNewOrder, orders: vOrders, receiving: vReceiving, stock: vStock, queue: vQueue, backorders: vBackorders, issues: vIssues, admin: vAdmin };
  m.innerHTML = ''; V[S.view](m);
}
function needOffice(m, what) {
  if (curOffice()) return false;
  m.innerHTML = `<div class="alert info">Select a specific office (top right) to ${what}.</div>`; return true;
}

// ============================ Login (test) ============================
function loginHtml() {
  return `<div class="login card"><img src="MedPro-logo.png" height="50" alt=""><h2>Inventory Orders (test)</h2>
  <p class="muted">At go-live you sign in with your MS365 account. For testing, pick a user:</p>
  ${T('Users').filter(u => u.Active !== 'N').map(u => `<button data-act="login" data-email="${e(u.Email)}"><b>${e(u.Name)}</b><br><span class="muted small">${e(u.Role)}${u.Admin === 'Y' ? ' + Admin' : ''} - ${e(u.Offices)}</span></button>`).join('')}</div>`;
}
function signIn(email) {
  S.user = T('Users').find(u => u.Email === email); localStorage.setItem('inv_user', email);
  const mine = userOffices(S.user); S.office = (S.user.Offices === 'ALL') ? 'ALL' : (mine[0] || offices()[0].Office);
  S.cart = []; S.dupOk = new Set(); S.countPrompted = new Set(); S.view = null; S.draft = { type: 'Office Stock', pname: '', pphone: '', note: '' };
  render(); maybeCountPrompt();
}

// ============================ Home ============================
function vHome(m) {
  const o = curOffice(); if (needOffice(m, 'see your dashboard')) return;
  const due = dueList(o).length, om = onOrderMap(o);
  const below = T('OfficeItems').filter(r => r.Office === o && n0(r.Min) !== null && r.OnHand < r.Min && (itemOf(r.Part) || {}).Orderable === 'Yes' && r.OnHand + (om.get(r.Part) || 0) < r.Min).length;
  const openN = T('Orders').filter(x => x.Office === o && OPEN.includes(x.Status)).length;
  const back = T('OrderLines').filter(l => orderOf(l.OrderNo).Office === o && l.Backorder === 'Y' && outstanding(l) > 0).length;
  const inc = T('Shipments').filter(s => s.Office === o && s.Status === 'In Transit').length;
  m.innerHTML = `<h2>${e(officeName(o))}</h2><div class="cards">
    <div class="stat ${due ? 'warn' : 'good'}" data-act="countDue"><div class="n">${due}</div><div class="l">items due for counting</div></div>
    <div class="stat ${below ? 'bad' : 'good'}" data-act="nav" data-v="neworder"><div class="n">${below}</div><div class="l">items below minimum (not yet on order)</div></div>
    <div class="stat" data-act="nav" data-v="orders"><div class="n">${openN}</div><div class="l">open orders</div></div>
    <div class="stat ${back ? 'warn' : ''}" data-act="nav" data-v="orders"><div class="n">${back}</div><div class="l">backordered lines</div></div>
    <div class="stat ${inc ? 'warn' : ''}" data-act="nav" data-v="receiving"><div class="n">${inc}</div><div class="l">shipments to receive</div></div></div>
    <div class="card"><b>Quick links:</b> <button class="btn" data-act="nav" data-v="neworder">Place an order</button> <button class="btn ghost" data-act="countDue">Count items now</button> <button class="btn ghost" data-act="nav" data-v="receiving">Receive a shipment</button></div>`;
}

// ============================ Counting ============================
function maybeCountPrompt() {
  const o = curOffice(); if (!S.user || !canCount() || !o || S.countPrompted.has(o)) return;
  S.countPrompted.add(o);
  if (dueList(o).length) openCounts(dueList(o), true);
}
function openCounts(list, login) {
  const o = curOffice();
  modal(`<h2>${login ? 'Stock counts due - ' : 'Count stock - '}${e(officeName(o))}</h2>
  <p class="muted">${list.length} item(s). Enter the quantity on the shelf. Use the tick if it matches the expected quantity.${login ? ' You can skip this now; it will be shown again at your next login.' : ''}</p>
  <div class="row"><button class="btn ghost sm" data-act="countAllMatch">All match expected</button></div>
  <div class="tablewrap" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Part #</th><th>Description</th><th>Category</th><th class="num">Expected</th><th>Counted</th><th></th></tr></thead><tbody>
  ${list.map(r => `<tr><td>${e(r.Part)}</td><td>${e(r.item.Description)}</td><td class="small">${e(r.item.Category)}</td><td class="num">${r.OnHand}</td>
    <td><input type="number" min="0" class="cnt" data-part="${e(r.Part)}" data-exp="${r.OnHand}"></td><td><button class="btn sm ghost" data-act="countMatch" title="Matches expected">&#10003;</button></td></tr>`).join('')}</tbody></table></div>
  <div class="foot"><button class="btn ghost" data-act="closeModal">${login ? 'Skip for now' : 'Cancel'}</button><button class="btn green" data-act="saveCounts">Save counts</button></div>`, true);
}
async function saveCounts() {
  const o = curOffice(), tx = new Tx(); let n = 0;
  document.querySelectorAll('.cnt').forEach(inp => {
    if (inp.value === '') return; const cnt = Math.max(0, Math.round(Number(inp.value))), part = inp.dataset.part, exp = Number(inp.dataset.exp);
    const oi = oiOf(o, part); tx.put('OfficeItems', { ...oi, OnHand: cnt, LastCounted: today(), LastCountedBy: S.user.Name });
    tx.put('CountLog', { Date: nowTs(), Office: o, Part: part, Expected: exp, Counted: cnt, By: S.user.Name }); n++;
  });
  if (!n) { toast('Nothing entered to save.'); return; }
  await tx.commit(); closeModal(); toast(`${n} count(s) saved.`); render();
}

// ============================ Stock ============================
function vStock(m) {
  const o = curOffice(); if (needOffice(m, 'view stock levels')) return;
  const f = S.fl.stock = S.fl.stock || { q: '', cat: '', flag: '' };
  const om = onOrderMap(o), cats = [...new Set(T('Items').map(i => i.Category))].sort();
  m.innerHTML = `<h2>Stock - ${e(officeName(o))}</h2>
  <div class="row"><label class="f grow">Search<input id="sq" value="${e(f.q)}" placeholder="Part # or description"></label>
  <label class="f">Category<select id="scat"><option value="">All</option>${cats.map(c => `<option ${f.cat === c ? 'selected' : ''}>${e(c)}</option>`).join('')}</select></label>
  <label class="f">Show<select id="sflag">${[['', 'All'], ['low', 'Below minimum'], ['high', 'Above maximum'], ['due', 'Count due']].map(x => `<option value="${x[0]}" ${f.flag === x[0] ? 'selected' : ''}>${x[1]}</option>`).join('')}</select></label>
  ${canCount() ? `<button class="btn green" data-act="countDue">Count due items (${dueList(o).length})</button>` : ''}</div>
  <div class="tablewrap card" style="padding:0"><table><thead><tr><th>Part #</th><th>Description</th><th>Category</th><th class="num">On hand</th><th class="num">Min</th><th class="num">Max</th><th class="num">On order</th><th>Count cycle</th><th>Last counted</th><th>Flags</th>${canCount() ? '<th></th>' : ''}</tr></thead><tbody id="stockBody"></tbody></table></div>`;
  const draw = () => {
    f.q = $('#sq').value; f.cat = $('#scat').value; f.flag = $('#sflag').value; const q = f.q.toLowerCase();
    const rows = T('OfficeItems').filter(r => r.Office === o).map(r => ({ r, it: itemOf(r.Part) })).filter(x => x.it && x.it.Active !== 'N')
      .filter(x => (!q || (x.r.Part + ' ' + x.it.Description).toLowerCase().includes(q)) && (!f.cat || x.it.Category === f.cat))
      .map(x => ({ ...x, low: n0(x.r.Min) !== null && x.r.OnHand < x.r.Min, high: n0(x.r.Max) !== null && x.r.OnHand > x.r.Max, due: isDue(x.r) }))
      .filter(x => !f.flag || x[f.flag]).sort((a, b) => cmp(a.it.Category, b.it.Category) || cmp(a.r.Part, b.r.Part));
    $('#stockBody').innerHTML = rows.map(x => `<tr class="${x.it.Orderable === 'DNO' ? 'dno' : ''}"><td>${e(x.r.Part)}</td><td>${e(x.it.Description)}</td><td class="small">${e(x.it.Category)}</td><td class="num"><b>${x.r.OnHand}</b></td><td class="num">${x.r.Min ?? '-'}</td><td class="num">${x.r.Max ?? '-'}</td><td class="num">${om.get(x.r.Part) || ''}</td><td class="small">${e(x.r.CountCycle)}</td><td class="small">${e(x.r.LastCounted || 'never')}</td>
      <td>${x.low ? '<span class="badge b-low">Below min</span> ' : ''}${x.high ? '<span class="badge b-high">Over max</span> ' : ''}${x.due ? '<span class="badge b-due">Count due</span> ' : ''}${x.it.Orderable === 'DNO' ? '<span class="badge b-dno">Do not order</span>' : ''}</td>
      ${canCount() ? `<td><button class="btn sm ghost" data-act="countOne" data-part="${e(x.r.Part)}">Count</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="11" class="muted">No items match.</td></tr>';
  };
  ['#sq', '#scat', '#sflag'].forEach(s => $(s).oninput = draw); draw();
}

// ============================ New order ============================
function vNewOrder(m) {
  if (!canOrder()) { m.innerHTML = '<div class="alert info">Only Office Staff and Field Staff place orders.</div>'; return; }
  const o = curOffice(); if (needOffice(m, 'place an order')) return;
  const f = S.fl.no = S.fl.no || { q: '', cat: '' };
  const cats = [...new Set(T('Items').filter(i => i.Active !== 'N').map(i => i.Category))].sort();
  m.innerHTML = `<h2>New inventory order - ${e(officeName(o))}</h2><div class="two"><div>
    <div class="card"><div class="row"><label class="f grow">Search by description or part #<input id="nq" value="${e(f.q)}" placeholder="e.g. nasal mask, 625 101..." autocomplete="off"></label>
    <label class="f">Or browse by category<select id="ncat"><option value="">- choose -</option>${cats.map(c => `<option ${f.cat === c ? 'selected' : ''}>${e(c)}</option>`).join('')}</select></label>
    <button class="btn ghost" data-act="addSuggested">Add items below minimum</button></div>
    <div id="results"></div></div></div>
    <div class="card" id="cartBox"></div></div>`;
  const draw = () => { f.q = $('#nq').value; f.cat = $('#ncat').value; drawResults(); };
  $('#nq').oninput = draw; $('#ncat').onchange = () => { if ($('#ncat').value) $('#nq').value = ''; draw(); };
  drawResults(); drawCart();
}
function drawResults() {
  const o = curOffice(), f = S.fl.no, box = $('#results'); if (!box) return; const q = f.q.trim().toLowerCase();
  if (q.length < 2 && !f.cat) { box.innerHTML = '<p class="muted">Type at least 2 characters or choose a category to see items.</p>'; return; }
  const om = onOrderMap(o);
  let rows = T('Items').filter(i => i.Active !== 'N' && (q.length >= 2 ? (i.Part + ' ' + i.Description).toLowerCase().includes(q) : i.Category === f.cat));
  const total = rows.length; rows = rows.sort((a, b) => cmp(a.Category, b.Category) || cmp(a.Part, b.Part)).slice(0, 80);
  box.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Part #</th><th>Description</th><th class="num">On hand</th><th class="num">Min/Max</th><th class="num">On order</th><th>Qty</th><th></th></tr></thead><tbody>${rows.map(i => {
    const oi = oiOf(o, i.Part) || { OnHand: 0, Min: null, Max: null }, ord = om.get(i.Part) || 0, dno = i.Orderable !== 'Yes';
    const low = n0(oi.Min) !== null && oi.OnHand < oi.Min;
    return `<tr class="${dno ? 'dno' : ''}"><td>${e(i.Part)}</td><td>${e(i.Description)}${i.Notes ? `<div class="small muted">${e(i.Notes)}</div>` : ''}${dno ? '<div class="small bad"><b>Do not order - contact Head Office.</b> An override is allowed with a reason.</div>' : ''}</td>
      <td class="num">${oi.OnHand}${low ? ' <span class="badge b-low">low</span>' : ''}</td><td class="num">${oi.Min ?? '-'}/${oi.Max ?? '-'}</td><td class="num">${ord ? `<span class="badge b-ord">${ord}</span>` : ''}</td>
      <td><input type="number" min="1" value="1" id="q_${e(i.Part)}" style="width:64px"></td><td>${dno ? `<button class="btn sm ghost" data-act="dnoOverride" data-part="${e(i.Part)}">Override...</button>` : `<button class="btn sm green" data-act="addItem" data-part="${e(i.Part)}">Add</button>`}</td></tr>`;
  }).join('')}</tbody></table></div>${total > 80 ? `<p class="muted small">Showing first 80 of ${total} - refine your search.</p>` : ''}`;
}
function drawCart() {
  const box = $('#cartBox'); if (!box) return; const o = curOffice(), d = S.draft, om = onOrderMap(o);
  box.innerHTML = `<h3 style="margin-top:0">Order (${S.cart.length} line${S.cart.length === 1 ? '' : 's'})</h3>
  ${S.cart.length ? `<table><tbody>${S.cart.map((c, i) => {
    const it = itemOf(c.part), oi = oiOf(o, c.part) || { OnHand: 0 }, mx = n0(oi.Max), proj = oi.OnHand + (om.get(c.part) || 0) + c.qty;
    return `<tr><td><b>${e(c.part)}</b><div class="small">${e(it.Description)}</div>${c.reason ? `<div class="small bad"><b>DNO override:</b> ${e(c.reason)}</div>` : ''}${mx !== null && proj > mx ? `<div class="small warn">Above max (${mx}): on hand ${oi.OnHand} + on order ${om.get(c.part) || 0} + this order ${c.qty} = ${proj}</div>` : ''}</td>
    <td style="white-space:nowrap"><input type="number" min="1" value="${c.qty}" data-in="cartQty" data-i="${i}" style="width:64px"> <button class="btn sm danger" data-act="cartDel" data-i="${i}">&times;</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">No items yet. Search or browse and press Add.</p>'}
  <h3>Order for</h3>
  <label class="f"><select id="otype"><option ${d.type === 'Office Stock' ? 'selected' : ''}>Office Stock</option><option ${d.type === 'Patient' ? 'selected' : ''}>Patient</option></select></label>
  ${d.type === 'Patient' ? `<label class="f">Patient name *<input id="pname" value="${e(d.pname)}"></label><label class="f">Patient contact # *<input id="pphone" value="${e(d.pphone)}"></label>` : ''}
  <label class="f">Note (optional)<textarea id="onote">${e(d.note)}</textarea></label>
  <button class="btn green" data-act="submitOrder" ${S.cart.length ? '' : 'disabled'}>Submit order to Head Office</button>
  ${S.cart.length ? '<button class="btn ghost" data-act="clearCart">Clear</button>' : ''}`;
  $('#otype').onchange = ev => { syncDraft(); S.draft.type = ev.target.value; drawCart(); };
}
function syncDraft() { const g = id => $(id) ? $(id).value : null; const d = S.draft; if (g('#pname') !== null) d.pname = g('#pname'); if (g('#pphone') !== null) d.pphone = g('#pphone'); if (g('#onote') !== null) d.note = g('#onote'); }
function addToCart(part, qty, skipDup) {
  const reason = S.dnoReason[part], c = S.cart.find(x => x.part === part); if (c) { c.qty += qty; if (reason) c.reason = reason; } else S.cart.push({ part, qty, reason });
  S.dupOk.add(part); drawCart(); toast(`Added ${part}`);
}
function tryAdd(part, qty) {
  const o = curOffice(), it = itemOf(part); if (it.Orderable !== 'Yes' && !S.dnoReason[part]) return;
  const dup = S.dupOk.has(part) ? [] : openLinesFor(o, part);
  if (!dup.length) return addToCart(part, qty);
  modal(`<h2>Already on order</h2><p><b>${e(part)}</b> - ${e(it.Description)} is already on an open order for ${e(officeName(o))}:</p>
  <table><thead><tr><th>Order</th><th>Date</th><th class="num">Qty outstanding</th><th class="num">In transit</th><th>Status</th><th>Note</th><th>Updated</th></tr></thead><tbody>${dup.map(d => `<tr><td>${e(d.o.OrderNo)}</td><td>${e(d.o.Placed.slice(0, 10))}</td><td class="num">${Math.max(0, outstanding(d.l))}</td><td class="num">${d.transit}</td><td>${badge(d.l.LineStatus)}</td><td>${e(d.l.BackorderNote || d.o.Note)}</td><td>${e(d.l.LastUpdated.slice(0, 10))}</td></tr>`).join('')}</tbody></table>
  <p>Do you want to add another order for this item?</p><div class="foot"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn green" data-act="dupAdd" data-part="${e(part)}" data-qty="${qty}">Add anyway</button></div>`, true);
}
function addSuggested() {
  const o = curOffice(), om = onOrderMap(o); let added = 0, skipped = 0;
  for (const r of T('OfficeItems').filter(r => r.Office === o)) {
    const it = itemOf(r.Part), mn = n0(r.Min); if (!it || it.Active === 'N' || it.Orderable !== 'Yes' || mn === null || r.OnHand >= mn) continue;
    const ord = om.get(r.Part) || 0; if (r.OnHand + ord >= mn) { skipped++; continue; }
    const target = n0(r.Max) ?? mn; const qty = Math.max(1, target - r.OnHand - ord);
    if (!S.cart.find(c => c.part === r.Part)) { S.cart.push({ part: r.Part, qty }); S.dupOk.add(r.Part); added++; }
  }
  drawCart(); toast(`${added} below-minimum item(s) added (order-up-to max). ${skipped ? skipped + ' already on order.' : ''}`);
}
async function submitOrder() {
  syncDraft(); const d = S.draft, o = curOffice();
  if (!S.cart.length) return;
  if (d.type === 'Patient' && (!d.pname.trim() || !d.pphone.trim())) { toast('Patient name and contact # are required for a patient order.', true); return; }
  const over = S.cart.filter(c => { const oi = oiOf(o, c.part) || { OnHand: 0 }, mx = n0(oi.Max); return mx !== null && oi.OnHand + (onOrderMap(o).get(c.part) || 0) + c.qty > mx; });
  if (over.length && !confirm(`${over.length} item(s) will take stock above the maximum:\n${over.map(c => c.part).join(', ')}\n\nPlace the order anyway?`)) return;
  const no = await Store.nextId('order', o), now = nowTs(), tx = new Tx(), patient = d.type === 'Patient';
  tx.put('Orders', { OrderNo: no, Office: o, PlacedBy: S.user.Email, PlacedByName: S.user.Name, Placed: now, Type: d.type, PatientName: patient ? d.pname.trim() : '', PatientPhone: patient ? d.pphone.trim() : '', Note: d.note.trim(), Status: 'Submitted', LastUpdated: now });
  S.cart.forEach((c, i) => { const it = itemOf(c.part); tx.put('OrderLines', { OrderNo: no, Line: i + 1, Part: c.part, Description: it.Description, Category: it.Category, QtyOrdered: c.qty, QtyCancelled: 0, QtyShipped: 0, QtyReceived: 0, Backorder: 'N', BackorderNote: '', LineStatus: 'Submitted', LineNote: c.reason ? `DNO override: ${c.reason}` : '', PatientName: patient ? d.pname.trim() : '', PatientPhone: patient ? d.pphone.trim() : '', LastUpdated: now, UpdatedBy: S.user.Name }); });
  const shippers = T('Users').filter(u => u.Role === 'Shipper' && u.Active !== 'N');
  const body = `New inventory order ${no}\nOffice: ${officeName(o)}\nPlaced by: ${S.user.Name}\nType: ${d.type}${patient ? ` - ${d.pname} (${d.pphone})` : ''}\nNote: ${d.note || '-'}\n\nLines:\n${S.cart.map(c => `  ${c.qty} x ${c.part} - ${itemOf(c.part).Description}${c.reason ? `  ** DO-NOT-ORDER OVERRIDE: ${c.reason}` : ''}`).join('\n')}\n\nOpen the Inventory Orders app (Shipping Queue) to process it.`;
  shippers.forEach(s => Mailer.queue(tx, s.Email, `New inventory order ${no} - ${officeName(o)}`, body));
  await tx.commit();
  S.cart = []; S.dnoReason = {}; S.dupOk = new Set(); S.draft = { type: 'Office Stock', pname: '', pphone: '', note: '' };
  modal(`<h2>Order ${e(no)} submitted</h2><p>Head Office has been notified by email (${shippers.length} shipper${shippers.length === 1 ? '' : 's'}; simulated in test mode - see Admin &gt; Outbox).</p><div class="foot"><button class="btn ghost" data-act="printSlip" data-order="${e(no)}">Print order form</button><button class="btn green" data-act="closeModal" data-then="orders">View orders</button></div>`);
}

// ============================ Orders list / detail ============================
function vOrders(m) {
  const f = S.fl.ord = S.fl.ord || { status: 'Open', q: '' };
  m.innerHTML = `<h2>Orders${curOffice() ? ' - ' + e(officeName(curOffice())) : ' - all offices'}</h2>
  <div class="row"><label class="f">Status<select id="ost">${['Open', 'All', 'Submitted', 'Partially Shipped', 'Backordered', 'Shipped', 'Closed', 'Cancelled'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
  <label class="f grow">Search order #, patient, part #, tracking #<input id="oq" value="${e(f.q)}"></label></div><div class="card tablewrap" style="padding:0" id="ordBox"></div>`;
  const draw = () => {
    f.status = $('#ost').value; f.q = $('#oq').value; const q = f.q.toLowerCase(), off = curOffice();
    const rows = T('Orders').filter(o => (!off || o.Office === off) && (f.status === 'All' || (f.status === 'Open' ? OPEN.includes(o.Status) : o.Status === f.status)) &&
      (!q || (o.OrderNo + ' ' + o.PatientName + ' ' + linesOf(o.OrderNo).map(l => l.Part).join(' ') + ' ' + T('Shipments').filter(s => s.OrderNo === o.OrderNo).map(s => s.Tracking).join(' ')).toLowerCase().includes(q))).sort((a, b) => b.Placed.localeCompare(a.Placed));
    $('#ordBox').innerHTML = `<table><thead><tr><th>Order #</th>${off ? '' : '<th>Office</th>'}<th>Placed</th><th>For</th><th>Status</th><th>Lines</th><th>Last updated</th></tr></thead><tbody>${rows.map(o => { const ls = linesOf(o.OrderNo); const bo = ls.some(l => l.Backorder === 'Y' && outstanding(l) > 0);
      return `<tr class="click" data-act="openOrder" data-order="${e(o.OrderNo)}"><td><b>${e(o.OrderNo)}</b></td>${off ? '' : `<td>${e(officeName(o.Office))}</td>`}<td>${e(o.Placed.slice(0, 16))}</td><td>${o.Type === 'Patient' ? 'Patient: ' + e(o.PatientName) : 'Office stock'}</td><td>${badge(o.Status)}${bo ? ' <span class="badge b-Backordered">backorder</span>' : ''}</td><td>${ls.length}</td><td>${e(o.LastUpdated.slice(0, 16))}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No orders found.</td></tr>'}</tbody></table>`;
  };
  $('#ost').onchange = draw; $('#oq').oninput = draw; draw();
}
function openOrder(no) {
  const pf = S.prefill; S.prefill = null; // set by "Backorder arrived" to pre-fill ship quantities for one item
  const o = orderOf(no), ls = linesOf(no), tm = transitMap(), ships = T('Shipments').filter(s => s.OrderNo === no).sort((a, b) => a.ShipmentID.localeCompare(b.ShipmentID));
  const ship = isShipper(), req = canOrder() || isAdmin(), canEdit = req && !ship;
  const hasOut = ls.some(l => outstanding(l) > 0 && effQty(l) > 0);
  modal(`<h2>${e(no)} ${badge(o.Status)}</h2>
  <div class="kv"><div><span>Office</span>${e(officeName(o.Office))}</div><div><span>Placed</span>${e(o.Placed.slice(0, 16))} by ${e(o.PlacedByName)}</div><div><span>For</span>${o.Type === 'Patient' ? `Patient: ${e(o.PatientName)} (${e(o.PatientPhone)})` : 'Office stock'}</div><div><span>Note</span>${e(o.Note || '-')}</div></div>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>Part #</th><th>Description</th><th class="num">Ordered</th><th class="num">Shipped</th><th class="num">Received</th><th class="num">Outstanding</th><th>Status</th>${ship ? '<th>Ship now</th><th>Backorder / note</th>' : '<th>Note</th>'}<th>Updated</th>${canEdit ? '<th>Edit</th>' : ''}</tr></thead><tbody>
  ${ls.map(l => { const out = outstanding(l), eff = effQty(l), live = out > 0 && eff > 0; return `<tr><td>${l.Line}</td><td>${e(l.Part)}</td><td>${e(l.Description)}${l.LineNote ? `<div class="small bad"><b>${e(l.LineNote)}</b></div>` : ""}</td><td class="num">${eff}${l.QtyCancelled ? `<div class="small muted">(${l.QtyOrdered} - ${l.QtyCancelled} cancelled)</div>` : ''}</td><td class="num">${l.QtyShipped}</td><td class="num">${l.QtyReceived}</td><td class="num">${eff > 0 ? Math.max(0, out) : '-'}</td><td>${badge(lineStatus(l, tm))}</td>
    ${ship ? (live ? `<td><input type="number" min="0" max="${out}" value="${pf ? (pf.part === l.Part ? Math.min(out, pf.qty) : 0) : out}" class="shipq" data-line="${l.Line}" style="width:64px"><br><input class="serials" data-line="${l.Line}" placeholder="Serial #(s), if any" style="width:150px;margin-top:4px"></td><td><label class="small"><input type="checkbox" class="boflag" data-line="${l.Line}" ${l.Backorder === 'Y' ? 'checked' : ''}> backorder remainder</label><br><input class="bonote" data-line="${l.Line}" value="${e(l.BackorderNote)}" placeholder="note" style="width:150px"> <button class="btn sm danger" data-act="shipCancelLine" data-order="${e(no)}" data-line="${l.Line}">cancel rest</button></td>` : `<td></td><td class="small">${e(l.BackorderNote)}</td>`) : `<td class="small">${l.Backorder === 'Y' && out > 0 ? '<span class="badge b-Backordered">BACKORDERED</span> ' : ''}${e(l.BackorderNote)}</td>`}
    <td class="small">${e(l.LastUpdated.slice(0, 16))}</td>${canEdit ? `<td style="white-space:nowrap">${live ? `<input type="number" min="${Math.max(1, l.QtyShipped)}" value="${eff}" class="editq" data-line="${l.Line}" style="width:60px"> <button class="btn sm ghost" data-act="saveQty" data-order="${e(no)}" data-line="${l.Line}">Set</button> <button class="btn sm danger" data-act="cancelLine" data-order="${e(no)}" data-line="${l.Line}">Cancel</button>` : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>
  ${ship && hasOut ? `<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Record shipment</h3><div class="row"><label class="f">Ship date<input type="date" id="shDate" value="${today()}"></label><label class="f">Carrier<select id="shCar">${carriers().map(c => `<option>${e(c)}</option>`).join('')}<option value="__other">Other...</option></select></label><label class="f">If Other<input id="shCarOther" style="width:130px"></label><label class="f grow">Tracking # (required when shipping)<input id="shTrack"></label></div>
  <p class="muted small">Set "Ship now" per line (default = full outstanding). Tick backorder for any remainder that cannot be sent yet; it carries forward until shipped or cancelled.</p><button class="btn green" data-act="recordShipment" data-order="${e(no)}">Save shipment / backorder update</button></div>` : ''}
  ${ships.length ? `<h3>Shipments</h3><table><thead><tr><th>ID</th><th>Date</th><th>Carrier / Tracking</th><th>Status</th><th>Contents</th><th></th></tr></thead><tbody>${ships.map(s => `<tr><td>${e(s.ShipmentID)}</td><td>${e(s.ShipDate)}</td><td>${e(s.Carrier)} ${e(s.Tracking)}</td><td>${badge(s.Status === 'Received' ? 'Received' : 'Shipped')}${s.Variance === 'Y' ? ' <span class="badge b-low">variance</span>' : ''}${s.ReceiveNote ? `<div class="small muted">${e(s.ReceiveNote)}</div>` : ''}</td><td class="small">${T('ShipmentLines').filter(x => x.ShipmentID === s.ShipmentID).map(x => `${x.Part}: ${x.QtyShipped}${s.Status === 'Received' ? ' (rec ' + x.QtyReceived + ')' : ''}${x.Serials ? ' - S/N ' + e(x.Serials) : ''}`).join('<br>')}</td><td><button class="btn sm ghost" data-act="printSlip" data-order="${e(no)}" data-ship="${e(s.ShipmentID)}">Packing slip</button></td></tr>`).join('')}</tbody></table>` : ''}
  <div class="foot"><button class="btn ghost" data-act="showAudit" data-order="${e(no)}">History</button><button class="btn ghost" data-act="printSlip" data-order="${e(no)}">Print order form</button>${canEdit && o.Status !== 'Cancelled' && o.Status !== 'Closed' && hasOut ? `<button class="btn danger" data-act="cancelOrder" data-order="${e(no)}">Cancel unshipped items</button>` : ''}<button class="btn" data-act="closeModal">Close</button></div>`, true);
}
async function editLine(no, line, fn) {
  const l = linesOf(no).find(x => x.Line === Number(line)), tx = new Tx(); fn(tx, l); refreshOrder(tx, no);
  await tx.commit(); openOrder(no); renderView();
}
async function saveQty(no, line) {
  const inp = document.querySelector(`.editq[data-line="${line}"]`), v = Math.round(Number(inp.value));
  const l = linesOf(no).find(x => x.Line === Number(line)); if (!(v >= Math.max(1, l.QtyShipped))) { toast('Quantity cannot be below what is already shipped (or less than 1).', true); return; }
  await editLine(no, line, (tx, l) => bumpLine(tx, l, { QtyOrdered: v + l.QtyCancelled })); toast('Quantity updated.');
}
async function cancelLine(no, line, byShipper) {
  if (!confirm('Cancel the unshipped quantity on this line?')) return;
  await editLine(no, line, (tx, l) => bumpLine(tx, l, { QtyCancelled: l.QtyCancelled + outstanding(l), Backorder: 'N', BackorderNote: byShipper ? 'Cancelled by Head Office' : l.BackorderNote })); toast('Line cancelled.');
}
async function cancelOrder(no) {
  if (!confirm(`Cancel all unshipped items on ${no}?`)) return; const tx = new Tx();
  linesOf(no).filter(l => outstanding(l) > 0 && effQty(l) > 0).forEach(l => bumpLine(tx, l, { QtyCancelled: l.QtyCancelled + outstanding(l), Backorder: 'N' })); refreshOrder(tx, no);
  await tx.commit(); openOrder(no); renderView(); toast('Unshipped items cancelled.');
}
async function recordShipment(no) {
  const ls = linesOf(no), tx = new Tx(), now = nowTs(), qty = {}; let any = false;
  document.querySelectorAll('.shipq').forEach(i => { const l = ls.find(x => x.Line === Number(i.dataset.line)), v = Math.round(Number(i.value) || 0); if (v < 0 || v > outstanding(l)) { qty.bad = true; } qty[l.Line] = v; if (v > 0) any = true; });
  if (qty.bad) { toast('Ship qty must be between 0 and the outstanding quantity.', true); return; }
  let car = $('#shCar').value; if (car === '__other') car = $('#shCarOther').value.trim();
  const date = $('#shDate').value, trk = $('#shTrack').value.trim();
  for (const l of ls) { const si = document.querySelector(`.serials[data-line="${l.Line}"]`); if (si && serialList(si.value).length > (qty[l.Line] || 0)) { toast(`Line ${l.Line}: more serial numbers than the quantity shipped.`, true); return; } }
  if (any && !trk) { toast('Enter the tracking # to record a shipment.', true); return; }
  let sid = '';
  if (any) { sid = await Store.nextId('shipment'); tx.put('Shipments', { ShipmentID: sid, OrderNo: no, Office: orderOf(no).Office, ShipDate: date, Tracking: trk, Carrier: car, ShippedBy: S.user.Name, Status: 'In Transit', ReceivedBy: '', ReceivedDate: '', ReceiveNote: '', Variance: '', VarianceResolved: '' }); }
  for (const l of ls) {
    const row = document.querySelector(`.shipq[data-line="${l.Line}"]`); if (!row) continue;
    const v = qty[l.Line] || 0, rem = outstanding(l) - v, bo = rem > 0 && document.querySelector(`.boflag[data-line="${l.Line}"]`).checked ? 'Y' : 'N', bn = document.querySelector(`.bonote[data-line="${l.Line}"]`).value.trim();
    if (v > 0) tx.put('ShipmentLines', { ShipmentID: sid, OrderNo: no, Line: l.Line, Part: l.Part, QtyShipped: v, QtyReceived: 0, Serials: serialList(document.querySelector(`.serials[data-line="${l.Line}"]`).value).join(', ') });
    if (v > 0 || bo !== l.Backorder || bn !== l.BackorderNote) bumpLine(tx, l, { QtyShipped: l.QtyShipped + v, Backorder: bo, BackorderNote: rem > 0 ? bn : '' });
  }
  refreshOrder(tx, no); await tx.commit();
  toast(any ? `Shipment ${sid} recorded.` : 'Backorder update saved.');
  if (any && confirm('Shipment saved. Open the packing slip to print and include in the box?')) printSlip(no, sid);
  openOrder(no); renderView();
}
async function showAudit(no) {
  const rows = await Store.audit(no);
  modal(`<h2>History - ${e(no)}</h2><div class="tablewrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Field</th><th>Old</th><th>New</th></tr></thead><tbody>${rows.map(r => `<tr><td>${e(r.Timestamp)}</td><td>${e(r.User)}</td><td class="small">${e(r.Table)} ${e(r.Key)}</td><td>${e(r.Field)}</td><td>${e(r.Old)}</td><td>${e(r.New)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No history.</td></tr>'}</tbody></table></div><div class="foot"><button class="btn" data-act="openOrder" data-order="${e(no)}">Back</button></div>`, true);
}

// ============================ Receiving ============================
function vReceiving(m) {
  if (!canReceive()) { m.innerHTML = '<div class="alert info">Receiving is done by the satellite office.</div>'; return; }
  const o = curOffice(); if (needOffice(m, 'receive shipments')) return;
  const ships = T('Shipments').filter(s => s.Office === o && s.Status === 'In Transit').sort((a, b) => a.ShipDate.localeCompare(b.ShipDate));
  m.innerHTML = `<h2>Receiving - ${e(officeName(o))}</h2>${ships.length ? '' : '<div class="alert info">No shipments are waiting to be received.</div>'}` + ships.map(s => {
    const sl = T('ShipmentLines').filter(x => x.ShipmentID === s.ShipmentID), ord = orderOf(s.OrderNo);
    return `<div class="card"><div class="row" style="justify-content:space-between;margin:0"><div><b>${e(s.ShipmentID)}</b> for order <a href="#" data-act="openOrder" data-order="${e(s.OrderNo)}">${e(s.OrderNo)}</a> ${ord.Type === 'Patient' ? `<span class="badge b-ord">Patient: ${e(ord.PatientName)}</span>` : ''}<div class="muted small">Shipped ${e(s.ShipDate)} - ${e(s.Carrier)} ${e(s.Tracking)}</div></div>
    <div><button class="btn green" data-act="receiveAll" data-ship="${e(s.ShipmentID)}">Confirm received as sent</button> <button class="btn ghost" data-act="toggleAdj" data-ship="${e(s.ShipmentID)}">Adjust quantities...</button></div></div>
    <table style="margin-top:8px"><thead><tr><th>Part #</th><th>Description</th><th class="num">Sent</th><th class="adj" data-ship="${e(s.ShipmentID)}" hidden>Received</th></tr></thead><tbody>${sl.map(x => `<tr><td>${e(x.Part)}</td><td>${e((itemOf(x.Part) || {}).Description)}${x.Serials ? `<div class="small"><b>S/N:</b> ${e(x.Serials)}</div>` : ''}</td><td class="num">${x.QtyShipped}</td><td class="adj" data-ship="${e(s.ShipmentID)}" hidden><input type="number" min="0" value="${x.QtyShipped}" class="recq" data-ship="${e(s.ShipmentID)}" data-line="${x.Line}"></td></tr>`).join('')}</tbody></table>
    <div class="adj" data-ship="${e(s.ShipmentID)}" hidden><label class="f">Note (short, damaged, wrong item...)<input class="recnote" data-ship="${e(s.ShipmentID)}"></label><button class="btn green" data-act="receiveAdj" data-ship="${e(s.ShipmentID)}">Confirm adjusted receipt</button> <span class="small muted">Head Office will see any difference as a receipt issue.</span></div></div>`;
  }).join('');
}
async function receive(sid, adjusted) {
  const s = T('Shipments').find(x => x.ShipmentID === sid), sl = T('ShipmentLines').filter(x => x.ShipmentID === sid), tx = new Tx(); let variance = false;
  const noteEl = document.querySelector(`.recnote[data-ship="${sid}"]`), note = adjusted && noteEl ? noteEl.value.trim() : '';
  for (const x of sl) {
    let rec = x.QtyShipped;
    if (adjusted) { const inp = document.querySelector(`.recq[data-ship="${sid}"][data-line="${x.Line}"]`); rec = Math.max(0, Math.round(Number(inp.value))); }
    if (rec !== x.QtyShipped) variance = true;
    tx.put('ShipmentLines', { ...x, QtyReceived: rec });
    let oi = oiOf(s.Office, x.Part); if (oi) tx.put('OfficeItems', { ...oi, OnHand: oi.OnHand + rec }); else tx.put('OfficeItems', { Office: s.Office, Part: x.Part, Min: null, Max: null, OnHand: rec, CountCycle: 'Quarterly', LastCounted: '', LastCountedBy: '' });
    const l = linesOf(s.OrderNo).find(y => y.Line === x.Line); bumpLine(tx, l, { QtyReceived: l.QtyReceived + rec });
  }
  if (variance && !note) { if (!confirm('The received quantities differ from what was sent. Continue without a note?')) return; }
  tx.put('Shipments', { ...s, Status: 'Received', ReceivedBy: S.user.Name, ReceivedDate: today(), ReceiveNote: note, Variance: variance ? 'Y' : 'N', VarianceResolved: variance ? 'N' : '' });
  refreshOrder(tx, s.OrderNo); await tx.commit();
  toast(variance ? 'Receipt saved. Head Office has been flagged about the difference.' : 'Received - on-hand counts updated.'); renderView();
}

// ============================ Shipper views ============================
function issues() { return T('Shipments').filter(s => s.Variance === 'Y' && s.VarianceResolved !== 'Y'); }
function vQueue(m) {
  const f = S.fl.q = S.fl.q || { status: 'Needs shipping', q: '' };
  const all = T('Orders'), cnt = s => all.filter(o => o.Status === s).length;
  const boItems = new Set(T('OrderLines').filter(l => l.Backorder === 'Y' && outstanding(l) > 0 && effQty(l) > 0).map(l => l.Part)).size; // same rule as the Backorders by Item tab
  m.innerHTML = `<h2>Shipping queue${curOffice() ? ' - ' + e(officeName(curOffice())) : ''}</h2><div class="cards">
  <div class="stat ${cnt('Submitted') ? 'warn' : 'good'}"><div class="n">${cnt('Submitted')}</div><div class="l">new orders</div></div><div class="stat ${cnt('Partially Shipped') ? 'warn' : ''}"><div class="n">${cnt('Partially Shipped')}</div><div class="l">partially shipped</div></div>
  <div class="stat ${boItems ? 'warn' : ''}" data-act="nav" data-v="backorders"><div class="n">${boItems}</div><div class="l">items on backorder</div></div><div class="stat"><div class="n">${cnt('Shipped')}</div><div class="l">shipped, awaiting receipt</div></div>
  <div class="stat ${issues().length ? 'bad' : 'good'}" data-act="nav" data-v="issues"><div class="n">${issues().length}</div><div class="l">receipt issues</div></div></div>
  <div class="row"><label class="f">Show<select id="qst">${['Needs shipping', 'All open', 'Submitted', 'Partially Shipped', 'Backordered', 'Shipped'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="f grow">Search order #, patient, part #<input id="qq" value="${e(f.q)}"></label></div>
  <div class="row"><button class="btn green" id="pickBtn" data-act="pickList">Picking list (0 selected)</button><button class="btn ghost" data-act="pickAll">Select all shown (same office)</button><button class="btn ghost" data-act="pickNone">Clear selection</button><span class="muted small">Tick orders going to the same office to print one combined picking list.</span></div>
  <div class="card tablewrap" style="padding:0" id="qBox"></div>`;
  const draw = () => {
    f.status = $('#qst').value; f.q = $('#qq').value; const q = f.q.toLowerCase(), off = curOffice();
    const ok = o => f.status === 'Needs shipping' ? ['Submitted', 'Partially Shipped', 'Backordered'].includes(o.Status) : f.status === 'All open' ? OPEN.includes(o.Status) : o.Status === f.status;
    const rows = T('Orders').filter(o => ok(o) && (!off || o.Office === off) && (!q || (o.OrderNo + ' ' + o.PatientName + ' ' + linesOf(o.OrderNo).map(l => l.Part + ' ' + l.Description).join(' ')).toLowerCase().includes(q))).sort((a, b) => a.Placed.localeCompare(b.Placed));
    S.shownQueue = rows.map(o => o.OrderNo);
    $('#qBox').innerHTML = `<table><thead><tr><th></th><th>Order #</th><th>Office</th><th>Placed</th><th>For</th><th>Status</th><th>Items outstanding</th><th>Last updated</th></tr></thead><tbody>${rows.map(o => { const ls = linesOf(o.OrderNo).filter(l => effQty(l) > 0 && outstanding(l) > 0);
      return `<tr class="click" data-act="openOrder" data-order="${e(o.OrderNo)}"><td><input type="checkbox" class="pk" data-act="pickToggle" data-order="${e(o.OrderNo)}" ${S.pick.has(o.OrderNo) ? 'checked' : ''}></td><td><b>${e(o.OrderNo)}</b></td><td>${e(officeName(o.Office))}</td><td>${e(o.Placed.slice(0, 16))}</td><td>${o.Type === 'Patient' ? 'Patient: ' + e(o.PatientName) : 'Office stock'}</td><td>${badge(o.Status)}</td><td class="small">${ls.map(l => `${outstanding(l)} x ${e(l.Part)}${l.Backorder === 'Y' ? ' (BO)' : ''}`).slice(0, 4).join('<br>')}${ls.length > 4 ? `<br>+${ls.length - 4} more` : ''}</td><td>${e(o.LastUpdated.slice(0, 16))}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Nothing here - all caught up.</td></tr>'}</tbody></table>`;
    updPick();
  };
  $('#qst').onchange = draw; $('#qq').oninput = draw; draw();
}
function updPick() { const b = $('#pickBtn'); if (b) b.textContent = `Picking list (${S.pick.size} selected)`; }

// Combined picking list for orders going to one office (orders are NOT merged, only listed together)
function printPicking(nos) {
  const orders = nos.map(orderOf).filter(Boolean), offs = [...new Set(orders.map(o => o.Office))];
  if (!orders.length) { toast('Tick at least one order first.', true); return; }
  if (offs.length > 1) { toast('Selected orders go to different offices (' + offs.map(officeName).join(', ') + '). Select one office at a time.', true); return; }
  const off = T('Offices').find(x => x.Office === offs[0]) || {}, g = new Map(), bo = [];
  for (const o of orders) for (const l of linesOf(o.OrderNo)) {
    const out = outstanding(l); if (effQty(l) <= 0 || out <= 0) continue;
    if (l.Backorder === 'Y') { bo.push({ o, l, out }); continue; }
    if (!g.has(l.Part)) g.set(l.Part, { part: l.Part, desc: l.Description, cat: l.Category, qty: 0, refs: [] });
    const x = g.get(l.Part); x.qty += out; x.refs.push({ o, out });
  }
  const rows = [...g.values()].sort((a, b) => cmp(a.cat, b.cat) || cmp(a.part, b.part));
  let lastCat = null, body = '';
  for (const x of rows) {
    if (x.cat !== lastCat) { body += `<tr><td colspan="6" class="cat">${e(x.cat)}</td></tr>`; lastCat = x.cat; }
    body += `<tr><td class="box">&#9744;</td><td>${e(x.part)}</td><td>${e(x.desc)}</td><td class="n"><b>${x.qty}</b></td><td class="small">${x.refs.map(r => `${e(r.o.OrderNo)} &times;${r.out}${r.o.Type === 'Patient' ? ` <b>(PATIENT: ${e(r.o.PatientName)})</b>` : ''}`).join('<br>')}</td><td class="sn"></td></tr>`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Picking List - ${e(off.Name || offs[0])}</title><style>
  body{font-family:Segoe UI,Arial,sans-serif;color:#1D2B3A;margin:24px;font-size:13px}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #50B948;padding-bottom:10px}.hd img{height:62px}.hd h1{margin:0;color:#003D79;font-size:26px;text-align:right}.hd div.r{text-align:right}
  table{border-collapse:collapse;width:100%;margin-top:10px}th{background:#003D79;color:#fff;text-align:left;padding:6px;font-size:11px}td{border-bottom:1px solid #dde4ea;padding:6px;vertical-align:top}td.n,th.n{text-align:right;font-size:15px}
  td.cat{background:#eef3f8;color:#003D79;font-weight:700;font-size:12px}td.box{font-size:20px;width:26px}.small{font-size:12px}.sn{width:150px;border-left:1px dashed #aaa}
  .bar{margin-bottom:12px}button{padding:8px 16px;font-size:14px}h3{color:#003D79}@media print{.bar{display:none}body{margin:10mm}}</style></head><body>
  <div class="bar"><button onclick="window.print()">Print</button></div>
  <div class="hd"><img src="${new URL("MedPro-logo.png", location.href).href}" alt="MedPro Respiratory Care"><div class="r"><h1>PICKING LIST</h1><div><b>Ship to: ${e(off.Name || offs[0])}</b></div><div>${e(off.ShipTo || '')}</div><div>Printed ${e(nowTs().slice(0, 16))} by ${e(S.user.Name)}</div></div></div>
  <p><b>Orders:</b> ${orders.map(o => e(o.OrderNo)).join(', ')} &nbsp; | &nbsp; <b>${rows.length}</b> item lines, <b>${rows.reduce((a, x) => a + x.qty, 0)}</b> units</p>
  <table><thead><tr><th></th><th>Part #</th><th>Description</th><th class="n">Qty to pick</th><th>For order(s)</th><th>Serial #(s) / notes</th></tr></thead><tbody>${body || '<tr><td colspan="6">Nothing to pick on the selected orders.</td></tr>'}</tbody></table>
  ${bo.length ? `<h3>Not included - flagged backorder</h3><table><thead><tr><th>Order</th><th>Part #</th><th>Description</th><th class="n">Qty</th><th>Note</th></tr></thead><tbody>${bo.map(x => `<tr><td>${e(x.o.OrderNo)}</td><td>${e(x.l.Part)}</td><td>${e(x.l.Description)}</td><td class="n">${x.out}</td><td>${e(x.l.BackorderNote)}</td></tr>`).join('')}</tbody></table>` : ''}
  </body></html>`;
  const w = window.open('', '_blank'); if (!w) { toast('Pop-up blocked - allow pop-ups to print.', true); return; } w.document.write(html); w.document.close();
}

// "Backorder arrived": pick an item + qty received, see waiting orders oldest-first with a suggested split
function waitingLines(part) {
  const res = [];
  for (const o of T('Orders')) if (OPEN.includes(o.Status)) for (const l of linesOf(o.OrderNo)) if (l.Part === part && effQty(l) > 0 && outstanding(l) > 0) res.push({ o, l, out: outstanding(l) });
  const pri = r => r.o.Type === 'Patient' ? 0 : 1; // patient orders first, then office stock; each group oldest first
  return res.sort((a, b) => pri(a) - pri(b) || a.o.Placed.localeCompare(b.o.Placed) || a.o.OrderNo.localeCompare(b.o.OrderNo));
}
function bkArrivalHtml() {
  const off = curOffice(), parts = new Map();
  for (const o of T('Orders')) if (OPEN.includes(o.Status) && (!off || o.Office === off)) for (const l of linesOf(o.OrderNo)) if (effQty(l) > 0 && outstanding(l) > 0) parts.set(l.Part, l.Description);
  return `<div class="card"><h3 style="margin-top:0">Backorder arrived at Head Office</h3><p class="muted small">Pick the item and enter how many you received. Orders still waiting for it are listed with a suggested split: patient orders first, then office stock, each oldest first.</p>
  <div class="row"><label class="f grow">Item (part # or description)<input id="bkItem" list="bkParts" autocomplete="off" placeholder="start typing..."><datalist id="bkParts">${[...parts].sort((a, b) => cmp(a[0], b[0])).map(([p, d]) => `<option value="${e(p)}">${e(d)}</option>`).join('')}</datalist></label>
  <label class="f">Qty received<input id="bkQty" type="number" min="0" value="1" style="width:90px"></label></div><div id="bkResult"></div></div>`;
}
function bkShow() {
  const box = $('#bkResult'); if (!box) return;
  const txt = $('#bkItem').value.trim().toLowerCase(); if (!txt) { box.innerHTML = ''; return; }
  let it = T('Items').find(i => i.Part.toLowerCase() === txt);
  if (!it) { const m = T('Items').filter(i => (i.Part + ' ' + i.Description).toLowerCase().includes(txt)); if (m.length === 1) it = m[0]; else { box.innerHTML = `<p class="muted">${m.length ? m.length + ' items match - choose one from the list.' : 'No matching item.'}</p>`; return; } }
  const off = curOffice(), qty = Math.max(0, Math.round(Number($('#bkQty').value) || 0));
  const rows = waitingLines(it.Part).filter(r => !off || r.o.Office === off); let left = qty;
  const alloc = rows.map(r => { const a = Math.min(left, r.out); left -= a; return a; });
  const needed = rows.reduce((a, r) => a + r.out, 0);
  box.innerHTML = `<h3>${e(it.Part)} - ${e(it.Description)}</h3>
  <div class="alert ${qty >= needed ? 'ok' : 'info'}">Received <b>${qty}</b>. Waiting on ${rows.length} order(s) for <b>${needed}</b> in total. ${qty >= needed ? (qty > needed ? `All orders can be filled; ${qty - needed} left over.` : 'Exactly enough to fill every order.') : `Fills patient orders first, then office stock (oldest first); <b>${needed - qty}</b> still short.`}</div>
  ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Order date</th><th>Order #</th><th>Office</th><th>For</th><th>Status</th><th class="num">Waiting</th><th class="num">Suggested send</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${alloc[i] ? '' : 'dno'}"><td>${i + 1}</td><td>${e(r.o.Placed.slice(0, 16))}</td><td><b>${e(r.o.OrderNo)}</b></td><td>${e(officeName(r.o.Office))}</td><td>${r.o.Type === 'Patient' ? `<span class="badge b-ord">Patient: ${e(r.o.PatientName)}</span>` : 'Office stock'}</td><td>${badge(r.l.LineStatus)}${r.l.BackorderNote ? `<div class="small muted">${e(r.l.BackorderNote)}</div>` : ''}</td><td class="num">${r.out}</td><td class="num"><b>${alloc[i] || '-'}</b></td><td><button class="btn sm ${alloc[i] ? 'green' : 'ghost'}" data-act="bkOpen" data-order="${e(r.o.OrderNo)}" data-part="${e(it.Part)}" data-qty="${alloc[i]}">Open &amp; ship</button></td></tr>`).join('')}</tbody></table></div><p class="muted small">Suggested split: patient orders first, then office stock, each oldest first. Adjust the quantity on an order if needed. "Open &amp; ship" fills in the ship quantity for this item only.</p>` : '<p class="muted">No open orders are waiting for this item.</p>'}`;
}

function vBackorders(m) {
  const off = curOffice(), g = new Map();
  for (const l of T('OrderLines')) { const o = orderOf(l.OrderNo); if (l.Backorder !== 'Y' || outstanding(l) <= 0 || (off && o.Office !== off)) continue;
    if (!g.has(l.Part)) g.set(l.Part, { part: l.Part, desc: l.Description, qty: 0, lines: [], oldest: '9', upd: '' });
    const x = g.get(l.Part); x.qty += outstanding(l); x.lines.push({ l, o }); if (o.Placed < x.oldest) x.oldest = o.Placed; if (l.LastUpdated > x.upd) x.upd = l.LastUpdated; }
  const rows = [...g.values()].sort((a, b) => a.oldest.localeCompare(b.oldest));
  m.innerHTML = `<h2>Backorders by item</h2>${bkArrivalHtml()}${rows.length ? '' : '<div class="alert ok">No backordered items.</div>'}<div class="card tablewrap" style="padding:0"><table><thead><tr><th>Part #</th><th>Description</th><th class="num">Total backordered</th><th>Offices / orders</th><th>Oldest order</th><th>Last updated</th><th>Notes</th></tr></thead><tbody>${rows.map(x => `<tr><td><b>${e(x.part)}</b></td><td>${e(x.desc)}</td><td class="num"><b>${x.qty}</b></td><td>${x.lines.map(y => `${e(officeName(y.o.Office))}: <a href="#" data-act="openOrder" data-order="${e(y.o.OrderNo)}">${e(y.o.OrderNo)}</a> (${outstanding(y.l)})`).join('<br>')}</td><td>${e(x.oldest.slice(0, 10))}</td><td>${e(x.upd.slice(0, 16))}</td><td class="small">${[...new Set(x.lines.map(y => y.l.BackorderNote).filter(Boolean))].map(e).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}
function vIssues(m) {
  const rows = issues();
  m.innerHTML = `<h2>Receipt issues</h2><p class="muted">Offices received a different quantity than was shipped.</p>${rows.length ? '' : '<div class="alert ok">No unresolved receipt issues.</div>'}` + rows.map(s => `<div class="card"><b>${e(s.ShipmentID)}</b> - order <a href="#" data-act="openOrder" data-order="${e(s.OrderNo)}">${e(s.OrderNo)}</a> - ${e(officeName(s.Office))} - tracking ${e(s.Tracking)}<div class="muted small">Received ${e(s.ReceivedDate)} by ${e(s.ReceivedBy)}</div>
  <div class="alert warn">${e(s.ReceiveNote || '(no note)')}</div><table><thead><tr><th>Part #</th><th class="num">Sent</th><th class="num">Received</th></tr></thead><tbody>${T('ShipmentLines').filter(x => x.ShipmentID === s.ShipmentID && x.QtyReceived !== x.QtyShipped).map(x => `<tr><td>${e(x.Part)}</td><td class="num">${x.QtyShipped}</td><td class="num bad"><b>${x.QtyReceived}</b></td></tr>`).join('')}</tbody></table><div style="margin-top:8px"><button class="btn green" data-act="resolveIssue" data-ship="${e(s.ShipmentID)}">Mark resolved</button></div></div>`).join('');
}

// ============================ Admin ============================
async function vAdmin(m) {
  const tabsA = [['users', 'Users'], ['offices', 'Offices'], ['minmax', 'Min / Max'], ['audit', 'Audit log'], ['outbox', 'Outbox (test)'], ['data', 'Data']];
  m.innerHTML = `<h2>Admin</h2><div class="row">${tabsA.map(t => `<button class="btn ${S.admTab === t[0] ? '' : 'ghost'}" data-act="admTab" data-v="${t[0]}">${t[1]}</button>`).join('')}</div><div id="admBody"></div>`;
  const b = $('#admBody'), A = S.admTab, offs = T('Offices');
  if (A === 'users') {
    const chips = (u, id) => `<div class="chips"><label><input type="checkbox" class="uoff" data-id="${id}" value="ALL" ${u.Offices === 'ALL' ? 'checked' : ''}> ALL</label>${offs.map(o => `<label><input type="checkbox" class="uoff" data-id="${id}" value="${e(o.Office)}" ${u.Offices === 'ALL' || u.Offices.split(';').includes(o.Office) ? 'checked' : ''}> ${e(o.Office)}</label>`).join('')}</div>`;
    const row = (u, id) => `<tr data-uid="${id}"><td><input class="ue" value="${e(u.Email)}" ${u.Email ? 'readonly' : ''} style="width:210px"></td><td><input class="un" value="${e(u.Name)}"></td><td><select class="ur">${['Shipper', 'Office Staff', 'Field Staff'].map(r => `<option ${u.Role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${chips(u, id)}</td><td><input type="checkbox" class="ua" ${u.Admin === 'Y' ? 'checked' : ''}></td><td><input type="checkbox" class="uc" ${u.Active !== 'N' ? 'checked' : ''}></td><td><button class="btn sm green" data-act="saveUser" data-uid="${id}">Save</button></td></tr>`;
    b.innerHTML = `<div class="card tablewrap"><p class="muted small">Admins set each person's role and offices. "ALL" gives access to every office (Shippers always see all offices). Sign-in uses the person's MS365 email at go-live.</p><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Offices</th><th>Admin</th><th>Active</th><th></th></tr></thead><tbody>${T('Users').map((u, i) => row(u, 'u' + i)).join('')}${row({ Email: '', Name: '', Role: 'Office Staff', Offices: '', Admin: 'N', Active: 'Y' }, 'new')}</tbody></table><p class="small muted">Last row adds a new user.</p></div>`;
  } else if (A === 'offices') {
    b.innerHTML = `<div class="card tablewrap"><table><thead><tr><th>Code</th><th>Name</th><th>Ship-to address</th><th>Email</th><th>Active</th><th></th></tr></thead><tbody>${[...offs, { Office: '', Name: '', ShipTo: '', Email: '', Active: 'Y' }].map((o, i) => `<tr data-oid="${i}"><td><input class="oc" value="${e(o.Office)}" ${o.Office ? 'readonly' : 'placeholder="new code e.g. NEL"'} style="width:90px"></td><td><input class="on" value="${e(o.Name)}"></td><td><input class="os" value="${e(o.ShipTo)}" style="width:260px"></td><td><input class="oe" value="${e(o.Email)}"></td><td><input type="checkbox" class="oa" ${o.Active !== 'N' ? 'checked' : ''}></td><td><button class="btn sm green" data-act="saveOffice" data-oid="${i}">Save</button></td></tr>`).join('')}</tbody></table><p class="small muted">A new office automatically gets every catalog item (Min/Max blank - set them under Min / Max, or copy from another office).</p></div>`;
  } else if (A === 'minmax') {
    const o = (S.fl.mmOff && S.fl.mmOff !== 'ALL') ? S.fl.mmOff : (curOffice() || offs[0].Office); S.fl.mmOff = o;
    b.innerHTML = `<div class="card"><div class="row"><label class="f">Office<select id="mmOff">${offs.map(x => `<option value="${e(x.Office)}" ${x.Office === o ? 'selected' : ''}>${e(x.Name)}</option>`).join('')}</select></label><label class="f grow">Search<input id="mmq"></label>
    <label class="f">Copy Min/Max from<select id="mmSrc">${offs.filter(x => x.Office !== o).map(x => `<option value="${e(x.Office)}">${e(x.Name)}</option>`).join('')}</select></label><button class="btn ghost" data-act="copyMinMax">Copy to ${e(officeName(o))}</button><button class="btn green" data-act="saveMinMax">Save changes</button></div>
    <div class="tablewrap" style="max-height:65vh;overflow:auto"><table><thead><tr><th>Part #</th><th>Description</th><th>Category</th><th>Min</th><th>Max</th><th>Count cycle</th></tr></thead><tbody id="mmBody"></tbody></table></div></div>`;
    $('#mmOff').onchange = ev => { S.fl.mmOff = ev.target.value; vAdmin(m); };
    const draw = () => { const q = $('#mmq').value.toLowerCase(); $('#mmBody').innerHTML = T('OfficeItems').filter(r => r.Office === o).map(r => ({ r, it: itemOf(r.Part) })).filter(x => x.it && x.it.Active !== 'N' && (!q || (x.r.Part + x.it.Description).toLowerCase().includes(q))).sort((a, b) => cmp(a.it.Category, b.it.Category) || cmp(a.r.Part, b.r.Part))
      .map(x => `<tr><td>${e(x.r.Part)}</td><td>${e(x.it.Description)}</td><td class="small">${e(x.it.Category)}</td><td><input type="number" min="0" class="mm" data-part="${e(x.r.Part)}" data-f="Min" value="${x.r.Min ?? ''}"></td><td><input type="number" min="0" class="mm" data-part="${e(x.r.Part)}" data-f="Max" value="${x.r.Max ?? ''}"></td><td><select class="mm" data-part="${e(x.r.Part)}" data-f="CountCycle">${Object.keys(CYCLE_DAYS).map(c => `<option ${x.r.CountCycle === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td></tr>`).join(''); S.mmDirty = new Set(); };
    $('#mmq').oninput = draw; draw();
  } else if (A === 'audit') {
    b.innerHTML = `<div class="card"><div class="row"><label class="f grow">Search (order #, part, user, field)<input id="auq" placeholder="e.g. KAM-00001 or OfficeItems"></label><button class="btn" data-act="runAudit">Search</button></div><div id="auBody" class="tablewrap"></div></div>`;
  } else if (A === 'outbox') {
    b.innerHTML = `<div class="card tablewrap"><p class="muted small">Test mode: emails are recorded here instead of being sent. At go-live these go out through Outlook (Microsoft Graph / Power Automate).</p><table><thead><tr><th>Created</th><th>To</th><th>Subject</th><th>Body</th></tr></thead><tbody>${[...T('Outbox')].reverse().slice(0, 100).map(x => `<tr><td>${e(x.Created)}</td><td>${e(x.To)}</td><td>${e(x.Subject)}</td><td class="small"><pre style="margin:0;white-space:pre-wrap">${e(x.Body)}</pre></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>'}</tbody></table></div>`;
  } else {
    b.innerHTML = `<div class="card"><h3 style="margin-top:0">Shipping carriers</h3><p class="muted small">Separate with semicolons. The first one is the default on the shipping form.</p><div class="row"><input id="carrList" class="grow" value="${e(carriers().join('; '))}"><button class="btn green" data-act="saveCarriers">Save carriers</button></div></div>
    <div class="card"><h3 style="margin-top:0">Data</h3><p>All data lives in <b>InventoryData.xlsx</b> in the project folder. To add new products, add rows to the <b>Items</b> sheet (Part, Description, Category, Orderable = Yes or DNO, Active = Y), save the file, then press Reload. Every office gets the new item automatically (count due immediately, Min/Max blank).</p><button class="btn" data-act="reloadSource">Reload from Excel</button></div>`;
  }
}

// ============================ Packing slip ============================
function printSlip(no, sid) {
  const o = orderOf(no), ls = linesOf(no), ships = T('Shipments').filter(s => s.OrderNo === no).sort((a, b) => a.ShipmentID.localeCompare(b.ShipmentID));
  const cur = sid ? ships.find(s => s.ShipmentID === sid) : null, off = T('Offices').find(x => x.Office === o.Office) || {}, tm = transitMap();
  const shipQty = (id, line) => { const x = T('ShipmentLines').find(y => y.ShipmentID === id && y.Line === line); return x ? x.QtyShipped : 0; };
  const rows = ls.map(l => {
    const eff = effQty(l), out = outstanding(l), now = cur ? shipQty(cur.ShipmentID, l.Line) : 0;
    const prev = cur ? ships.filter(s => s.ShipmentID < cur.ShipmentID).reduce((a, s) => a + shipQty(s.ShipmentID, l.Line), 0) : 0;
    const toDate = cur ? prev + now : l.QtyShipped;
    const bal = eff <= 0 ? '<i>Cancelled</i>' : out > 0 ? (l.Backorder === 'Y' ? `<b>${out} BACKORDERED</b>` : `${out} not yet shipped`) : '-';
    const sn = cur ? serialsOf(cur.ShipmentID, l.Line) : [];
    const snAll = cur ? [] : ships.map(s => [s, serialsOf(s.ShipmentID, l.Line)]).filter(x => x[1].length);
    const snHtml = sn.length ? `<div class="sn"><b>Serial #:</b> ${sn.map(e).join(', ')}</div>` : snAll.map(x => `<div class="sn"><b>Serial # (${e(x[0].ShipmentID)}):</b> ${x[1].map(e).join(', ')}</div>`).join('');
    return `<tr><td>${l.Line}</td><td>${e(l.Part)}</td><td>${e(l.Description)}${snHtml}</td><td class="n">${l.QtyOrdered}</td><td class="n">${l.QtyCancelled ? l.QtyCancelled : ''}</td>${cur ? `<td class="n"><b>${now}</b></td>` : ''}<td class="n">${toDate}</td><td>${bal}</td><td>${e([l.LineNote, l.BackorderNote].filter(Boolean).join(' | '))}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${cur ? 'Packing Slip' : 'Order Form'} ${e(no)}</title><style>
  body{font-family:Segoe UI,Arial,sans-serif;color:#1D2B3A;margin:24px;font-size:13px}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #50B948;padding-bottom:10px}
  .hd img{height:62px}.hd h1{margin:0;color:#003D79;font-size:26px;text-align:right}.hd div.r{text-align:right}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:14px 0}.grid div{border:1px solid #cfd8e1;border-radius:6px;padding:8px}.grid span{display:block;font-size:10px;text-transform:uppercase;color:#5A6B7B;margin-bottom:2px}
  table{border-collapse:collapse;width:100%;margin-top:6px}th{background:#003D79;color:#fff;text-align:left;padding:6px;font-size:11px}td{border-bottom:1px solid #dde4ea;padding:6px;vertical-align:top}td.n,th.n{text-align:right}
  .sn{font-size:12px;margin-top:3px;color:#003D79}.foot{margin-top:18px;font-size:11px;color:#5A6B7B}.sig{margin-top:26px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #777;padding-top:4px;font-size:11px}
  .bar{margin-bottom:12px}button{padding:8px 16px;font-size:14px}@media print{.bar{display:none}body{margin:10mm}}</style></head><body>
  <div class="bar"><button onclick="window.print()">Print</button></div>
  <div class="hd"><img src="${new URL("MedPro-logo.png", location.href).href}" alt="MedPro Respiratory Care"><div class="r"><h1>${cur ? 'PACKING SLIP' : 'INVENTORY ORDER FORM'}</h1><div><b>Order ${e(no)}</b></div>${cur ? `<div>Shipment ${e(cur.ShipmentID)}</div>` : ''}</div></div>
  <div class="grid"><div><span>Ship to</span><b>${e(off.Name || o.Office)}</b><br>${e(off.ShipTo || '')}</div><div><span>Order placed</span>${e(o.Placed.slice(0, 16))}<br>by ${e(o.PlacedByName)}</div><div><span>Order for</span>${o.Type === 'Patient' ? `PATIENT: <b>${e(o.PatientName)}</b><br>${e(o.PatientPhone)}` : 'Office stock'}</div>
  ${cur ? `<div><span>Ship date</span>${e(cur.ShipDate)}</div><div><span>Carrier / tracking #</span>${e(cur.Carrier)}<br><b>${e(cur.Tracking)}</b></div><div><span>Shipped by</span>${e(cur.ShippedBy)}<br>${e(setting('ShipperContact'))}</div>` : `<div><span>Order status</span>${e(o.Status)}</div>`}</div>
  ${o.Note ? `<p><b>Order note:</b> ${e(o.Note)}</p>` : ''}
  <table><thead><tr><th>#</th><th>Part #</th><th>Description</th><th class="n">Ordered</th><th class="n">Cancelled</th>${cur ? '<th class="n">Shipped (this box)</th>' : ''}<th class="n">Shipped to date</th><th>Balance / backorder</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
  ${!cur && ships.length ? `<p><b>Shipments:</b> ${ships.map(s => `${e(s.ShipmentID)} (${e(s.ShipDate)}, ${e(s.Carrier)} ${e(s.Tracking)})`).join('; ')}</p>` : ''}
  <div class="sig"><div>Received by (name)</div><div>Date received</div></div><p class="foot">${e(setting('PackingSlipFooter'))}</p></body></html>`;
  const w = window.open('', '_blank'); if (!w) { toast('Pop-up blocked - allow pop-ups to print.', true); return; } w.document.write(html); w.document.close();
}

// ============================ Event wiring ============================
const ACT = {
  login: t => signIn(t.dataset.email), nav: t => go(t.dataset.v), closeModal: t => { closeModal(); if (t.dataset.then) go(t.dataset.then); else render(); },
  countDue: () => { const l = dueList(curOffice()); l.length ? openCounts(l) : toast('Nothing is due for counting.'); },
  countOne: t => { const o = curOffice(), r = oiOf(o, t.dataset.part); openCounts([{ ...r, item: itemOf(r.Part) }]); },
  countMatch: t => { const i = t.closest('tr').querySelector('.cnt'); i.value = i.dataset.exp; },
  countAllMatch: () => document.querySelectorAll('.cnt').forEach(i => i.value = i.dataset.exp),
  saveCounts: () => saveCounts(),
  addItem: t => { const q = Math.max(1, Math.round(Number($('#q_' + CSS.escape(t.dataset.part)).value) || 1)); tryAdd(t.dataset.part, q); },
  dupAdd: t => { S.dupOk.add(t.dataset.part); closeModal(); addToCart(t.dataset.part, Number(t.dataset.qty)); },
  dnoOverride: t => {
    const p = t.dataset.part, it = itemOf(p), q = Math.max(1, Math.round(Number($('#q_' + CSS.escape(p)).value) || 1));
    modal(`<h2>Do-not-order item</h2><p><b>${e(p)}</b> - ${e(it.Description)}</p><div class="alert warn">This item is on the Do Not Order list${it.Notes ? ` (${e(it.Notes)})` : ''}. Head Office will see the override and your reason on the order.</div>
    <label class="f">Reason for ordering anyway *<input id="dnoWhy" placeholder="e.g. special request for patient, approved by ..."></label>
    <div class="foot"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn green" data-act="dnoConfirm" data-part="${e(p)}" data-qty="${q}">Add to order</button></div>`);
  },
  dnoConfirm: t => { const why = $('#dnoWhy').value.trim(); if (!why) { toast('A reason is required to override.', true); return; } S.dnoReason[t.dataset.part] = why; closeModal(); tryAdd(t.dataset.part, Number(t.dataset.qty)); },
  addSuggested: () => addSuggested(), cartDel: t => { delete S.dnoReason[S.cart[Number(t.dataset.i)].part]; S.cart.splice(Number(t.dataset.i), 1); drawCart(); }, clearCart: () => { S.cart = []; S.dnoReason = {}; drawCart(); },
  submitOrder: () => submitOrder(), openOrder: (t, ev) => { ev && ev.preventDefault(); openOrder(t.dataset.order); },
  saveQty: t => saveQty(t.dataset.order, t.dataset.line), cancelLine: t => cancelLine(t.dataset.order, t.dataset.line), shipCancelLine: t => cancelLine(t.dataset.order, t.dataset.line, true),
  cancelOrder: t => cancelOrder(t.dataset.order), recordShipment: t => recordShipment(t.dataset.order), showAudit: t => showAudit(t.dataset.order),
  printSlip: t => printSlip(t.dataset.order, t.dataset.ship),
  pickToggle: t => { t.checked ? S.pick.add(t.dataset.order) : S.pick.delete(t.dataset.order); updPick(); },
  pickNone: () => { S.pick.clear(); document.querySelectorAll('.pk').forEach(c => c.checked = false); updPick(); },
  pickAll: () => { const sh = (S.shownQueue || []).map(orderOf), off = (S.pick.size ? orderOf([...S.pick][0]) : sh[0] || {}).Office; sh.filter(o => o.Office === off).forEach(o => S.pick.add(o.OrderNo)); document.querySelectorAll('.pk').forEach(c => c.checked = S.pick.has(c.dataset.order)); updPick(); if (off) toast(`Selected ${officeName(off)} orders. Use the office selector to narrow further.`); },
  pickList: () => printPicking([...S.pick]),
  bkOpen: t => { S.prefill = { part: t.dataset.part, qty: Number(t.dataset.qty) }; openOrder(t.dataset.order); },
  receiveAll: t => receive(t.dataset.ship, false), receiveAdj: t => receive(t.dataset.ship, true), toggleAdj: t => document.querySelectorAll(`.adj[data-ship="${t.dataset.ship}"]`).forEach(x => x.hidden = !x.hidden),
  resolveIssue: async t => { const tx = new Tx(), s = T('Shipments').find(x => x.ShipmentID === t.dataset.ship); tx.put('Shipments', { ...s, VarianceResolved: 'Y' }); await tx.commit(); render(); toast('Marked resolved.'); },
  admTab: t => { S.admTab = t.dataset.v; renderView(); },
  saveUser: async t => {
    const tr = t.closest('tr'), id = tr.dataset.uid, email = tr.querySelector('.ue').value.trim().toLowerCase(), name = tr.querySelector('.un').value.trim();
    if (!email || !name) { toast('Email and name are required.', true); return; }
    const chosen = [...tr.querySelectorAll('.uoff:checked')].map(x => x.value), offs = chosen.includes('ALL') ? 'ALL' : chosen.join(';');
    const tx = new Tx(); tx.put('Users', { Email: email, Name: name, Role: tr.querySelector('.ur').value, Offices: offs, Admin: tr.querySelector('.ua').checked ? 'Y' : 'N', Active: tr.querySelector('.uc').checked ? 'Y' : 'N' });
    await tx.commit(); if (S.user.Email === email) S.user = T('Users').find(u => u.Email === email); render(); toast('User saved.');
  },
  saveOffice: async t => {
    const tr = t.closest('tr'), code = tr.querySelector('.oc').value.trim().toUpperCase(), name = tr.querySelector('.on').value.trim();
    if (!/^[A-Z]{2,5}$/.test(code) || !name) { toast('Office code (2-5 letters) and name are required.', true); return; }
    const isNew = !T('Offices').find(o => o.Office === code), tx = new Tx();
    tx.put('Offices', { Office: code, Name: name, ShipTo: tr.querySelector('.os').value.trim(), Email: tr.querySelector('.oe').value.trim(), Active: tr.querySelector('.oa').checked ? 'Y' : 'N' });
    await tx.commit(); if (isNew) { await Store.reloadSource(); await loadData(); } render(); toast('Office saved.');
  },
  saveMinMax: async () => {
    const o = S.fl.mmOff, byPart = new Map(); document.querySelectorAll('.mm').forEach(i => { const p = i.dataset.part; if (!byPart.has(p)) byPart.set(p, {}); byPart.get(p)[i.dataset.f] = i.tagName === 'SELECT' ? i.value : (i.value === '' ? null : Math.round(Number(i.value))); });
    const tx = new Tx(); let n = 0;
    for (const [p, v] of byPart) { const r = oiOf(o, p); if (!r) continue; if (String(r.Min ?? '') !== String(v.Min ?? '') || String(r.Max ?? '') !== String(v.Max ?? '') || r.CountCycle !== v.CountCycle) { tx.put('OfficeItems', { ...r, ...v }); n++; } }
    if (!n) { toast('No changes.'); return; } await tx.commit(); toast(`${n} item(s) updated.`); renderView();
  },
  copyMinMax: async () => {
    const o = S.fl.mmOff, src = $('#mmSrc').value; if (!confirm(`Overwrite ALL Min/Max/count cycles for ${officeName(o)} with ${officeName(src)}'s values?`)) return;
    const tx = new Tx(); for (const r of T('OfficeItems').filter(x => x.Office === src)) { const d = oiOf(o, r.Part); if (d) tx.put('OfficeItems', { ...d, Min: r.Min, Max: r.Max, CountCycle: r.CountCycle }); } await tx.commit(); toast('Copied.'); renderView();
  },
  runAudit: async () => { const rows = await Store.audit($('#auq').value); $('#auBody').innerHTML = `<table><thead><tr><th>When</th><th>Who</th><th>Table</th><th>Key</th><th>Field</th><th>Old</th><th>New</th></tr></thead><tbody>${rows.reverse().map(r => `<tr><td>${e(r.Timestamp)}</td><td>${e(r.User)}</td><td>${e(r.Table)}</td><td>${e(r.Key)}</td><td>${e(r.Field)}</td><td>${e(r.Old)}</td><td>${e(r.New)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No entries.</td></tr>'}</tbody></table>`; },
  demoReset: (t, ev) => { ev.preventDefault(); if (confirm('Erase all demo orders and restore the sample data?')) Store.reset(); },
  saveCarriers: async () => {
    const v = $('#carrList').value.split(/[;,]/).map(s => s.trim()).filter(Boolean).join(';'); if (!v) { toast('Enter at least one carrier.', true); return; }
    const tx = new Tx(); tx.put('Settings', { Key: 'Carriers', Value: v }); await tx.commit(); toast('Carriers saved.'); renderView();
  },
  reloadSource: async () => { await Store.reloadSource(); await loadData(); toast('Reloaded from Excel.'); render(); }
};
document.addEventListener('click', ev => { const t = ev.target.closest('[data-act]'); if (!t || !ACT[t.dataset.act]) return; Promise.resolve(ACT[t.dataset.act](t, ev)).catch(err => { console.error(err); toast(err.message || 'Something went wrong', true); }); });
document.addEventListener('input', ev => { if (ev.target.id === 'bkItem' || ev.target.id === 'bkQty') bkShow(); });
document.addEventListener('change', ev => { const t = ev.target; if (t.dataset.in === 'cartQty') { syncDraft(); S.cart[Number(t.dataset.i)].qty = Math.max(1, Math.round(Number(t.value) || 1)); drawCart(); } });

(async function init() {
  try { await loadData(); } catch (err) { $('#app').innerHTML = `<div class="login card"><h2>Cannot reach the data helper</h2><p>Start <b>Start Inventory App (test).bat</b> and reload this page.</p><p class="muted">${e(err.message)}</p></div>`; return; }
  const saved = localStorage.getItem('inv_user');
  if (saved && T('Users').find(u => u.Email === saved && u.Active !== 'N')) signIn(saved); else render();
})();

/* DEMO storage for GitHub Pages: replaces the Excel helper with browser memory (localStorage).
   Seed data comes from data.json. Nothing leaves the browser. */
(function () {
  const KEY = 'inv_demo_v1';
  let mem = null;
  const ts = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const read = () => { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { } return mem; };
  const write = st => { mem = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } };
  async function state() {
    let st = read();
    if (!st) { const r = await fetch('data.json'); st = await r.json(); st.tables.AuditLog = st.tables.AuditLog || []; write(st); }
    return st;
  }
  const keyOf = (sc, t, row) => sc[t].key.length ? sc[t].key.map(c => String(row[c])).join('|') : null;

  window.DemoStore = {
    async load() { const st = await state(); const t = JSON.parse(JSON.stringify(st.tables)); delete t.AuditLog; return t; },
    async save(ops, user) {
      const st = await state(), sc = st.schema, now = ts(), noAudit = ['CountLog', 'Outbox', 'AuditLog'];
      for (const op of ops) {
        const t = op.table, cols = sc[t].cols, num = sc[t].num;
        for (const r of op.rows) {
          const clean = {};
          cols.forEach(c => { let v = r[c]; clean[c] = num.includes(c) ? ((v === null || v === undefined || v === '') ? null : Number(v)) : ((v === null || v === undefined) ? '' : String(v)); });
          const k = keyOf(sc, t, clean), ex = k === null ? null : st.tables[t].find(x => keyOf(sc, t, x) === k);
          if (ex) {
            cols.forEach(c => { if (c in r && String(ex[c] ?? '') !== String(clean[c] ?? '')) { if (!noAudit.includes(t)) st.tables.AuditLog.push({ Timestamp: now, User: user, Table: t, Key: k, Field: c, Old: String(ex[c] ?? ''), New: String(clean[c] ?? '') }); ex[c] = clean[c]; } });
          } else {
            st.tables[t].push(clean);
            if (!noAudit.includes(t)) st.tables.AuditLog.push({ Timestamp: now, User: user, Table: t, Key: k, Field: '(created)', Old: '', New: '' });
          }
        }
      }
      write(st);
    },
    async nextId(kind, prefix) {
      const st = await state(), table = kind === 'shipment' ? 'Shipments' : 'Orders', col = kind === 'shipment' ? 'ShipmentID' : 'OrderNo', pre = kind === 'shipment' ? 'SH' : prefix;
      let max = 0; const re = new RegExp('^' + pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
      st.tables[table].forEach(r => { const m = re.exec(r[col]); if (m) max = Math.max(max, Number(m[1])); });
      return pre + '-' + String(max + 1).padStart(5, '0');
    },
    async audit(q, table) {
      const st = await state(), ql = (q || '').toLowerCase();
      return st.tables.AuditLog.filter(a => (!table || a.Table === table) && (!ql || (a.Key + ' ' + a.User + ' ' + a.Table + ' ' + a.Field).toLowerCase().includes(ql))).slice(-500);
    },
    async reloadSource() { },
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem('inv_user'); } catch (e) { } mem = null; location.reload(); }
  };
})();

// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';
const { db } = require('../core/db');
let ready = false, lastCleanup = 0;
const listeners = new Set();
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function init() {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS metis_mcp_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, le TEXT NOT NULL, account INTEGER NOT NULL, client TEXT NOT NULL,
    method TEXT NOT NULL, tool TEXT NOT NULL, status INTEGER NOT NULL, failed INTEGER NOT NULL,
    input_bytes INTEGER NOT NULL, output_bytes INTEGER NOT NULL, duration_ms REAL NOT NULL, result_code TEXT);
    CREATE TABLE IF NOT EXISTS metis_mcp_hourly (
    hour TEXT NOT NULL, account INTEGER NOT NULL, client TEXT NOT NULL, method TEXT NOT NULL, tool TEXT NOT NULL,
    calls INTEGER NOT NULL, errors INTEGER NOT NULL, input_bytes INTEGER NOT NULL, output_bytes INTEGER NOT NULL,
    duration_ms REAL NOT NULL, max_ms REAL NOT NULL, PRIMARY KEY(hour,account,client,method,tool));
    CREATE INDEX IF NOT EXISTS idx_metis_calls_le ON metis_mcp_calls(le);
    CREATE TABLE IF NOT EXISTS metis_lab_activity (
      call_id INTEGER PRIMARY KEY, le TEXT NOT NULL, account INTEGER NOT NULL, client TEXT NOT NULL,
      tool TEXT NOT NULL, mutation INTEGER NOT NULL, audit_id TEXT NOT NULL,
      result_code TEXT NOT NULL, resources TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_metis_lab_activity_le ON metis_lab_activity(le);`);
  if (!db.prepare('PRAGMA table_info(metis_mcp_calls)').all().some(c => c.name === 'result_code')) db.exec('ALTER TABLE metis_mcp_calls ADD COLUMN result_code TEXT');
  ready = true;
}
function record(event) {
  init();
  const le = new Date().toISOString(), hour = le.slice(0, 13) + ':00:00.000Z';
  // Les noms viennent de la liste des méthodes/outils admis, jamais des arguments.
  const vals = [Number(event.account) || 0, String(event.client || 'unknown').slice(0, 80), event.method, event.tool];
  const numbers = [event.failed ? 1 : 0, event.input_bytes || 0, event.output_bytes || 0, event.duration_ms || 0];
  db.exec('SAVEPOINT metis_usage');
  try {
    const code = process.env.METIS_COMMAND_OBSERVATORY_ENABLED === '1' && event.failed ? require('./metis-outcome-code').normalize(event.result_code) : null;
    const inserted = db.prepare('INSERT INTO metis_mcp_calls(le,account,client,method,tool,status,failed,input_bytes,output_bytes,duration_ms,result_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(le, ...vals, event.status, ...numbers, code);
    if (event.lab) {
      db.prepare('INSERT INTO metis_lab_activity VALUES(?,?,?,?,?,?,?,?,?)').run(Number(inserted.lastInsertRowid), le, vals[0], vals[1], event.tool,
        event.lab.mutation ? 1 : 0, String(event.lab.audit_id || '').slice(0, 100), String(event.lab.result_code || '').slice(0, 80), JSON.stringify(event.lab.resources || {}));
    }
    db.prepare('DELETE FROM metis_mcp_calls WHERE id <= (SELECT COALESCE(MAX(id),0)-10000 FROM metis_mcp_calls)').run();
    db.prepare('DELETE FROM metis_lab_activity WHERE call_id NOT IN (SELECT id FROM metis_mcp_calls)').run();
    db.prepare(`INSERT INTO metis_mcp_hourly VALUES(?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(hour,account,client,method,tool) DO UPDATE SET
      calls=calls+1, errors=errors+excluded.errors, input_bytes=input_bytes+excluded.input_bytes,
      output_bytes=output_bytes+excluded.output_bytes,duration_ms=duration_ms+excluded.duration_ms,max_ms=MAX(max_ms,excluded.max_ms)`)
      .run(hour, ...vals, ...numbers, numbers[3]);
    if (Date.now() - lastCleanup > 3600000) {
      db.prepare('DELETE FROM metis_mcp_calls WHERE le < ?').run(new Date(Date.now() - 30 * 86400e3).toISOString());
      db.prepare('DELETE FROM metis_mcp_hourly WHERE hour < ?').run(new Date(Date.now() - 90 * 86400e3).toISOString());
      db.prepare('DELETE FROM metis_lab_activity WHERE le < ?').run(new Date(Date.now() - 30 * 86400e3).toISOString());
      lastCleanup = Date.now();
    }
    db.exec('RELEASE metis_usage');
  } catch (e) { db.exec('ROLLBACK TO metis_usage; RELEASE metis_usage'); throw e; }
  // Ne signaler que les mesures enregistrées ; un onglet fermé ne doit pas
  // empêcher la collecte des appels MCP.
  for (const listener of listeners) { try { listener(); } catch { /* flux fermé */ } }
}
function stats(user, { days = 7 } = {}) {
  if (!require('./metisdocs').estMaster(user)) return null;
  init();
  if (![1, 7, 30, 90].includes(days)) days = 7;
  // Fenêtres alignées sur l'heure, même granularité que les agrégats.
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 13) + ':00:00.000Z';
  const sum = `SUM(calls) calls, SUM(errors) errors, SUM(input_bytes) input_bytes, SUM(output_bytes) output_bytes,
    SUM(duration_ms)/SUM(calls) avg_ms, MAX(max_ms) max_ms`;
  const totals = db.prepare('SELECT ' + sum + ' FROM metis_mcp_hourly WHERE hour >= ?').get(since);
  for (const k of Object.keys(totals)) if (totals[k] == null) totals[k] = 0;
  const identities = new Map();
  const identify = row => {
    const key = row.account + ':' + row.client;
    if (!identities.has(key)) {
      const account = row.account ? require('./players').getRow(row.account) : null;
      const client = require('./oauth-clients').resolve(row.client);
      identities.set(key, { account_name: account ? account.pseudo : row.account ? '#' + row.account : 'Non authentifié', client_name: client ? client.name : row.client });
    }
    return { ...row, ...identities.get(key) };
  };
  return { days, since, totals,
    tools: db.prepare('SELECT method,tool,' + sum + ' FROM metis_mcp_hourly WHERE hour >= ? GROUP BY method,tool ORDER BY calls DESC').all(since),
    clients: db.prepare('SELECT account,client,' + sum + ' FROM metis_mcp_hourly WHERE hour >= ? GROUP BY account,client ORDER BY calls DESC').all(since).map(identify),
    hours: db.prepare('SELECT hour,' + sum + ' FROM metis_mcp_hourly WHERE hour >= ? GROUP BY hour ORDER BY hour').all(since),
    recent: db.prepare('SELECT le,account,client,method,tool,status,failed,input_bytes,output_bytes,duration_ms FROM metis_mcp_calls WHERE le >= ? ORDER BY id DESC LIMIT 100').all(since).map(identify),
    lab_activity: db.prepare('SELECT * FROM metis_lab_activity WHERE le >= ? ORDER BY call_id DESC LIMIT 50').all(since).map(r => identify({ ...r, resources: JSON.parse(r.resources) })),
    retention: { recent_days: 30, recent_max_calls: 10000, aggregates_days: 90 },
    byte_scope: 'Corps HTTP applicatifs, UTF-8, avant compression réseau ; hors en-têtes et TLS.' };
}
module.exports = { id: 'metisusage', init, record, stats, subscribe };


};

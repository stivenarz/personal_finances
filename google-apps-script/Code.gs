/**
 * FINANZAS PERSONALES — Backend en Google Apps Script
 * ===================================================
 * Convierte una hoja de cálculo de Google en la base de datos de la app.
 * Guía paso a paso: docs/google-sheets-guide.html
 *
 * Cada colección de la app es una pestaña con las columnas:
 *   id | updatedAt | deleted | seq | data (JSON del registro)
 *
 *  - updatedAt: marca de tiempo (ms) del cliente. Gana la escritura más reciente.
 *  - deleted:   1 si el registro fue eliminado (se conserva para propagar el borrado).
 *  - seq:       contador del servidor; permite que todos los dispositivos reciban
 *               los cambios de forma incremental aunque sus relojes difieran.
 *
 * Endpoints (los usa src/services/providers/sheets.js):
 *   GET  ?action=ping
 *   GET  ?action=pull&since=<seq>
 *   POST {action:'batch', ops:[{op:'save'|'patch'|'remove', c, id, data|fields, updatedAt}]}
 */

var APP_ID = 'finanzas-sheets';
var COLLECTIONS = [
  'accounts', 'categories', 'transactions', 'debts', 'debtPayments',
  'goals', 'recurringExpenses', 'paymentPlans', 'settings'
];
var HEADERS = ['id', 'updatedAt', 'deleted', 'seq', 'data'];

// ---------------------------------------------------------------- entradas HTTP

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.action === 'ping') return json_({ ok: true, app: APP_ID, version: getVersion_() });
    if (params.action === 'pull') return json_(pull_(Number(params.since) || 0));
    return json_({ ok: false, error: 'Acción no soportada' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'batch') return json_({ ok: false, error: 'Acción no soportada' });
    return json_(applyBatch_(body.ops || []));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/** Ejecútala una vez a mano para crear las pestañas y autorizar los permisos. */
function setup() {
  COLLECTIONS.forEach(function (name) { getSheet_(name); });
  Logger.log('Listo: pestañas creadas. Ahora despliega como Aplicación web.');
}

// ---------------------------------------------------------------- lectura

function pull_(since) {
  var version = getVersion_();
  if (since >= version) return { ok: true, version: version, rows: [] };

  var rows = [];
  COLLECTIONS.forEach(function (name) {
    var sheet = getSheet_(name);
    var last = sheet.getLastRow();
    if (last < 2) return;
    var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    values.forEach(function (row) {
      var seq = Number(row[3]) || 0;
      if (seq <= since) return;
      var data = {};
      try { data = JSON.parse(row[4] || '{}'); } catch (ignored) {}
      rows.push({
        c: name,
        id: String(row[0]),
        updatedAt: Number(row[1]) || 0,
        deleted: isTrue_(row[2]),
        seq: seq,
        data: data
      });
    });
  });
  return { ok: true, version: version, rows: rows };
}

// ---------------------------------------------------------------- escritura

function applyBatch_(ops) {
  var version = getVersion_();
  var tables = {};

  function table(name) {
    if (!tables[name]) tables[name] = loadTable_(name);
    return tables[name];
  }

  ops.forEach(function (op) {
    if (COLLECTIONS.indexOf(op.c) < 0 || !op.id) return;
    var t = table(op.c);
    var existing = t.index[op.id];
    var ts = Number(op.updatedAt) || 0;

    if (op.op === 'save') {
      if (existing && existing.updatedAt > ts) return;
      version++;
      write_(t, op.id, ts, false, version, JSON.stringify(op.data || { id: op.id }));

    } else if (op.op === 'patch') {
      if (existing && existing.deleted) return;
      var base = existing ? parse_(t.sheet.getRange(existing.row, 5).getValue()) : { id: op.id };
      var merged = {};
      Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
      Object.keys(op.fields || {}).forEach(function (k) { merged[k] = op.fields[k]; });
      merged.id = op.id;
      version++;
      write_(t, op.id, Math.max(existing ? existing.updatedAt : 0, ts), false, version, JSON.stringify(merged));

    } else if (op.op === 'remove') {
      if (existing && existing.updatedAt > ts) return;
      var data = existing ? t.sheet.getRange(existing.row, 5).getValue() : '{}';
      version++;
      write_(t, op.id, ts, true, version, data || '{}');
    }
  });

  setVersion_(version);
  return { ok: true, version: version };
}

function loadTable_(name) {
  var sheet = getSheet_(name);
  var last = sheet.getLastRow();
  var index = {};
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, 4).getValues();
    values.forEach(function (row, i) {
      index[String(row[0])] = { row: i + 2, updatedAt: Number(row[1]) || 0, deleted: isTrue_(row[2]) };
    });
  }
  return { sheet: sheet, index: index, next: Math.max(last, 1) + 1 };
}

function write_(t, id, updatedAt, deleted, seq, dataJson) {
  var existing = t.index[id];
  var row = existing ? existing.row : t.next++;
  t.sheet.getRange(row, 1, 1, HEADERS.length).setValues([[id, updatedAt, deleted ? 1 : 0, seq, dataJson]]);
  t.index[id] = { row: row, updatedAt: updatedAt, deleted: deleted };
}

// ---------------------------------------------------------------- utilidades

function getSheet_(name) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.getRange('A:A').setNumberFormat('@');
    sheet.getRange('E:E').setNumberFormat('@');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getVersion_() {
  return Number(PropertiesService.getScriptProperties().getProperty('version')) || 0;
}

function setVersion_(version) {
  PropertiesService.getScriptProperties().setProperty('version', String(version));
}

function parse_(text) {
  try { return JSON.parse(text || '{}'); } catch (ignored) { return {}; }
}

function isTrue_(value) {
  return value === true || value === 1 || value === '1' || value === 'TRUE';
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

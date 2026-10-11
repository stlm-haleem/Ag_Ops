/**
 * Payment Ops Monitor - Google Apps Script Web App
 * ------------------------------------------------
 * Primary source : the Google Sheet (tabs BDT-SSG-AGENT, BDT-SSG-PERSONAL, ...)
 * Backup storage : Google Drive folder "PaymentOpsMonitor" (JSON per tab, replaced on every Excel import)
 *
 * DATA MODE (stored in Script Properties)
 *   auto  -> read the live Google Sheet; if it fails or is empty, fall back to the Drive backup
 *   drive -> always read the Drive backup (set automatically after an Excel import)
 *
 * Every request must carry ?token=<API_TOKEN> (set in Script Properties). The Vercel proxy adds it,
 * so the token never reaches the browser.
 *
 * SETUP: see SETUP.md in the project root.
 */

var FOLDER_NAME = 'PaymentOpsMonitor';
var DATA_SHEETS = ['BDT-SSG-AGENT', 'BDT-SSG-PERSONAL', 'BDT-SSG-VIP', 'BDT-SSG-WITHDRAWAL-ONLY'];
var ANALYTICS_SHEET = 'Analytics';
var ANALYTICS_HEADER = ['DATE', 'CURRENCY', 'GATEWAY', 'DEPOSIT', 'WITHDRAWAL', 'NOTE'];

/* ------------------------------ entry points ------------------------------ */

function doGet(e) {
  return handle_(e, null);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'Invalid JSON body' }); }
  return handle_(e, body);
}

function handle_(e, body) {
  try {
    var p = e.parameter || {};
    if (!authorized_(p.token)) return json_({ error: 'Unauthorized' });
    var action = p.action || 'manifest';

    switch (action) {
      case 'ping':       return json_({ ok: true, time: new Date().toISOString() });
      case 'manifest':   return json_(manifest_());
      case 'rows':       return json_(rows_(p.sheet, Number(p.offset || 0), Number(p.limit || 5000)));
      case 'setMode':    props_().setProperty('DATA_MODE', p.mode === 'drive' ? 'drive' : 'auto'); return json_({ ok: true, mode: mode_() });
      case 'importChunk':  return json_(importChunk_(body));
      case 'importCommit': return json_(importCommit_(body));
      case 'saveAnalytics': return json_(saveAnalytics_(body));
      case 'saveSettings':  writeJson_('settings.json', body.settings || {}); return json_({ ok: true });
      default: return json_({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  }
}

/* --------------------------------- reading --------------------------------- */

function manifest_() {
  var mode = mode_();
  var out = { mode: mode, source: null, updatedAt: null, sheets: [], analytics: [], settings: readJson_('settings.json') || {}, sheetError: null };

  var live = null;
  if (mode === 'auto') {
    try {
      live = liveManifest_();
      if (!live.sheets.length) { out.sheetError = 'No data rows found in the Google Sheet'; live = null; }
    } catch (err) {
      out.sheetError = String(err && err.message ? err.message : err);
      live = null;
    }
  }

  if (live) {
    out.source = 'sheet';
    out.sheets = live.sheets;
    out.updatedAt = new Date().toISOString();
    backupIfStale_(live);          // keep Drive copy fresh (at most once an hour)
  } else {
    var meta = readJson_('meta.json');
    if (!meta) throw new Error('No data available: Google Sheet unreachable/empty and no Drive backup yet. ' + (out.sheetError || ''));
    out.source = 'drive';
    out.updatedAt = meta.importedAt || meta.backedUpAt;
    out.sheets = meta.sheets; // [{name, header, rowCount}]
  }
  out.analytics = readAnalytics_();
  return out;
}

function liveManifest_() {
  var ss = spreadsheet_();
  var sheets = [];
  DATA_SHEETS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sheets.push({ name: name, header: header, rowCount: last - 1 });
  });
  return { sheets: sheets };
}

function rows_(sheetName, offset, limit) {
  if (DATA_SHEETS.indexOf(sheetName) < 0) throw new Error('Unknown sheet');
  var useLive = mode_() === 'auto';
  if (useLive) {
    try {
      var sh = spreadsheet_().getSheetByName(sheetName);
      if (sh && sh.getLastRow() >= 2) {
        var total = sh.getLastRow() - 1;
        var n = Math.max(0, Math.min(limit, total - offset));
        var vals = n > 0 ? sh.getRange(2 + offset, 1, n, sh.getLastColumn()).getValues() : [];
        return { rows: vals.map(cleanRow_) };
      }
    } catch (err) { /* fall through to Drive */ }
  }
  var data = readJson_('data-' + sheetName + '.json');
  if (!data) throw new Error('No Drive backup for ' + sheetName);
  return { rows: data.rows.slice(offset, offset + limit) };
}

function cleanRow_(r) {
  return r.map(function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
    return v;
  });
}

/* --------------------------- Drive backup of the sheet --------------------------- */

function backupIfStale_(live) {
  try {
    var meta = readJson_('meta.json');
    var now = Date.now();
    if (meta && meta.backedUpAtMs && now - meta.backedUpAtMs < 60 * 60 * 1000) return;
    if (meta && meta.fromExcel) return; // never overwrite an Excel import with a sheet backup silently
    var ss = spreadsheet_();
    var sheets = [];
    live.sheets.forEach(function (s) {
      var sh = ss.getSheetByName(s.name);
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().map(cleanRow_);
      writeJson_('data-' + s.name + '.json', { header: s.header, rows: vals });
      sheets.push({ name: s.name, header: s.header, rowCount: vals.length });
    });
    writeJson_('meta.json', { sheets: sheets, backedUpAt: new Date().toISOString(), backedUpAtMs: now, fromExcel: false });
  } catch (err) { /* backup is best-effort */ }
}

/* ------------------------------ Excel import (chunked) ------------------------------ */

// body: {sheet, index, header?, rows}
function importChunk_(b) {
  if (DATA_SHEETS.indexOf(b.sheet) < 0) throw new Error('Unknown sheet: ' + b.sheet);
  var name = 'stage-' + b.sheet + '.json';
  var stage = b.index === 0 ? { header: b.header, rows: [] } : readJson_(name);
  if (!stage) throw new Error('Missing staging data for ' + b.sheet + ' (chunk ' + b.index + ')');
  stage.rows = stage.rows.concat(b.rows);
  writeJson_(name, stage);
  return { ok: true, sheet: b.sheet, received: stage.rows.length };
}

// body: {sheets:[{name,header,rowCount}], fileName}
function importCommit_(b) {
  var sheets = [];
  b.sheets.forEach(function (s) {
    var stage = readJson_('stage-' + s.name + '.json');
    if (!stage) throw new Error('Nothing staged for ' + s.name);
    if (stage.rows.length !== s.rowCount) throw new Error(s.name + ': expected ' + s.rowCount + ' rows, got ' + stage.rows.length);
    writeJson_('data-' + s.name + '.json', stage);          // replaces the previous copy
    trash_('stage-' + s.name + '.json');
    sheets.push({ name: s.name, header: stage.header, rowCount: stage.rows.length });
  });
  // drop backups for tabs that are not part of the new import
  DATA_SHEETS.forEach(function (n) {
    if (!sheets.some(function (s) { return s.name === n; })) trash_('data-' + n + '.json');
  });
  writeJson_('meta.json', { sheets: sheets, importedAt: new Date().toISOString(), fileName: b.fileName || '', fromExcel: true });
  props_().setProperty('DATA_MODE', 'drive');               // serve the imported data until switched back
  return { ok: true, mode: 'drive', sheets: sheets };
}

/* ---------------------------------- analytics ---------------------------------- */

function analyticsSheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(ANALYTICS_SHEET);
  if (!sh) sh = ss.insertSheet(ANALYTICS_SHEET);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, ANALYTICS_HEADER.length).setValues([ANALYTICS_HEADER]);
  return sh;
}

function readAnalytics_() {
  try {
    var sh = analyticsSheet_();
    if (sh.getLastRow() >= 2) {
      return sh.getRange(2, 1, sh.getLastRow() - 1, ANALYTICS_HEADER.length).getValues()
        .filter(function (r) { return r[0] !== ''; })
        .map(function (r) {
          return { date: dateStr_(r[0]), currency: String(r[1] || 'BDT'), gateway: String(r[2] || 'SSG'),
                   deposit: Number(r[3]) || 0, withdrawal: Number(r[4]) || 0, note: String(r[5] || '') };
        });
    }
  } catch (err) { /* fall back to Drive copy */ }
  return readJson_('analytics.json') || [];
}

// body: {entries:[{date,currency,gateway,deposit,withdrawal,note}]}  -> upsert by date+currency+gateway
function saveAnalytics_(b) {
  var all = readAnalytics_();
  b.entries.forEach(function (en) {
    var i = -1;
    for (var k = 0; k < all.length; k++) {
      if (all[k].date === en.date && all[k].currency === en.currency && all[k].gateway === en.gateway) { i = k; break; }
    }
    if (i >= 0) all[i] = en; else all.push(en);
  });
  all.sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; });
  writeJson_('analytics.json', all);
  try {
    var sh = analyticsSheet_();
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ANALYTICS_HEADER.length).clearContent();
    if (all.length) {
      var vals = all.map(function (a) { return [a.date, a.currency, a.gateway, a.deposit, a.withdrawal, a.note || '']; });
      sh.getRange(2, 1, vals.length, ANALYTICS_HEADER.length).setValues(vals);
    }
  } catch (err) { /* sheet mirror is best-effort; Drive copy is saved */ }
  return { ok: true, count: all.length };
}

function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

/* --------------------------------- helpers --------------------------------- */

function props_() { return PropertiesService.getScriptProperties(); }
function mode_() { return props_().getProperty('DATA_MODE') === 'drive' ? 'drive' : 'auto'; }

function authorized_(token) {
  var expected = props_().getProperty('API_TOKEN');
  return !!expected && token === expected;
}

function spreadsheet_() {
  var id = props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function file_(name) {
  var it = folder_().getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function readJson_(name) {
  var f = file_(name);
  return f ? JSON.parse(f.getBlob().getDataAsString()) : null;
}

function writeJson_(name, obj) {
  var text = JSON.stringify(obj);
  var f = file_(name);
  if (f) f.setContent(text); else folder_().createFile(name, text, MimeType.PLAIN_TEXT);
}

function trash_(name) {
  var f = file_(name);
  if (f) f.setTrashed(true);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: sets a random API token and prints it in the log. */
function setupToken() {
  var t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props_().setProperty('API_TOKEN', t);
  Logger.log('API_TOKEN = ' + t);
}

/** Run once from the editor to authorize Drive + Sheets access. */
function authorize() {
  folder_();
  spreadsheet_();
  Logger.log('Authorized. Drive folder: ' + folder_().getUrl());
}

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
var DATA_SHEETS = ['BDT-SSG-AGENT', 'BDT-SSG-PERSONAL', 'BDT-SSG-VIP', 'BDT-SSG-WITHDRAWAL-ONLY', 'BDT-SSG-PERMANENT-STOP', 'BDT-MCG', 'PKR-SSG', 'PKR-BJ-BKK', 'PKR-JB-BKK', 'PKR-6S-BKK', 'PKR-LOCALBANK'];
// Tabs filled by a script sync (not by Excel import). A full-workbook import must never clear them.
var SYNCED_SHEETS = ['PKR-SSG', 'PKR-BJ-BKK', 'PKR-JB-BKK', 'PKR-6S-BKK', 'PKR-LOCALBANK'];
var BKK_SHEETS = ['PKR-BJ-BKK', 'PKR-JB-BKK', 'PKR-6S-BKK'];

// PKR-SSG is synced into the spreadsheet in ACCTLIST_DESTINATION_SPREADSHEET_ID (defined further down), which can be a
// different file from the one in SHEET_ID that holds the BDT tabs. Read every tab from the spreadsheet it really lives in.
function spreadsheetFor_(name) {
  if (BKK_SHEETS.indexOf(name) >= 0) return SpreadsheetApp.openById(BJSM_DESTINATION_SPREADSHEET_ID);
  if (SYNCED_SHEETS.indexOf(name) >= 0) return SpreadsheetApp.openById(ACCTLIST_DESTINATION_SPREADSHEET_ID);
  return spreadsheet_();
}
var ANALYTICS_SHEET = 'Analytics';
var ANALYTICS_HEADER = ['DATE', 'CURRENCY', 'GATEWAY', 'DEPOSIT', 'WITHDRAWAL', 'NOTE'];
var BACKUP_ROWS_PER_CHUNK = 1000;
// Gateways whose daily deposit / withdrawal totals are recorded automatically (feeds the dashboard line chart).
// Keyed by currency-gateway; each entry is saved to Analytics as date + currency + gateway.
var DAILY_GATEWAYS = {
  'BDT-SSG': { currency: 'BDT', gateway: 'SSG', sheets: ['BDT-SSG-AGENT', 'BDT-SSG-PERSONAL', 'BDT-SSG-VIP', 'BDT-SSG-WITHDRAWAL-ONLY', 'BDT-SSG-PERMANENT-STOP'] },
  'BDT-MCG': { currency: 'BDT', gateway: 'MCG', sheets: ['BDT-MCG'] },
  'PKR-SSG': { currency: 'PKR', gateway: 'SSG', sheets: ['PKR-SSG'] },
  'PKR-BKK': { currency: 'PKR', gateway: 'BKK', sheets: ['PKR-BJ-BKK', 'PKR-JB-BKK', 'PKR-6S-BKK'] }
};

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
      case 'recordDaily':   return json_(recordDailyTotals_(false));
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
  var out = { mode: mode, source: null, updatedAt: null, revision: null, sheets: [], analytics: [], settings: readJson_('settings.json') || {}, sheetError: null };
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
    out.updatedAt = live.updatedAt;
    out.revision = 'sheet:' + live.revision;
    // Drive backups run from a time-driven trigger so dashboard initialization does not wait for backup I/O.
  } else {
    var meta = readJson_('meta.json');
    if (!meta) throw new Error('No data available: Google Sheet unreachable/empty and no Drive backup yet. ' + (out.sheetError || ''));
    out.source = 'drive';
    out.updatedAt = meta.importedAt || meta.backedUpAt;
    out.revision = 'drive:' + (meta.revision || meta.importedAt || meta.backedUpAt || 'unknown');
    out.sheets = meta.sheets.map(function (s) { return { name: s.name, header: s.header, rowCount: s.rowCount, revision: s.revision || (meta.revision || meta.importedAt || meta.backedUpAt || 'legacy') }; });
  }
  out.analytics = readAnalytics_();
  return out;
}

function liveManifest_() {
  var ss = spreadsheet_();
  var sheets = [];
  DATA_SHEETS.forEach(function (name) {
    var sh = spreadsheetFor_(name).getSheetByName(name);
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sheets.push({ name: name, header: header, rowCount: last - 1 });
  });
  var fileUpdated = DriveApp.getFileById(ss.getId()).getLastUpdated().getTime();
  sheets.forEach(function (s) { s.revision = sheetRevision_(s.name, fileUpdated); });
  var shape = sheets.map(function (s) { return s.name + ':' + s.rowCount + ':' + s.header.length + ':' + s.revision; }).join('|');
  // Revision is based on monitored tabs, not the whole spreadsheet file, so saving daily analytics
  // does not force a redownload of all operational records.
  return { sheets: sheets, revision: shape, updatedAt: new Date(fileUpdated).toISOString() };
}

function sheetRevisionKey_(name) { return 'SHEET_REV_' + String(name).replace(/[^A-Za-z0-9_]/g, '_'); }
function sheetRevision_(name, fallback) {
  var p = props_();
  var key = sheetRevisionKey_(name);
  var value = p.getProperty(key);
  if (!value) { value = String(fallback || Date.now()); p.setProperty(key, value); }
  return value;
}

// Simple trigger: track edits made directly by a user in a monitored source tab.
function onEdit(e) {
  try {
    var sh = e && e.range ? e.range.getSheet() : null;
    if (sh && DATA_SHEETS.indexOf(sh.getName()) >= 0) props_().setProperty(sheetRevisionKey_(sh.getName()), String(Date.now()));
  } catch (err) { /* manifest also falls back to a full refresh if revisions cannot be tracked */ }
}

function rows_(sheetName, offset, limit) {
  if (DATA_SHEETS.indexOf(sheetName) < 0) throw new Error('Unknown sheet');
  offset = Math.max(0, Number(offset) || 0);
  limit = Math.max(0, Math.min(10000, Number(limit) || 5000));
  var useLive = mode_() === 'auto';
  if (useLive) {
    try {
      var sh = spreadsheetFor_(sheetName).getSheetByName(sheetName);
      if (sh && sh.getLastRow() >= 2) {
        var total = sh.getLastRow() - 1;
        var n = Math.max(0, Math.min(limit, total - offset));
        var vals = n > 0 ? sh.getRange(2 + offset, 1, n, sh.getLastColumn()).getValues() : [];
        return { rows: vals.map(cleanRow_) };
      }
      if (sh) return { rows: [] };
    } catch (err) { /* fall through to Drive */ }
  }
  var meta = readJson_('meta.json');
  var desc = meta && meta.sheets ? meta.sheets.filter(function (s) { return s.name === sheetName; })[0] : null;
  if (desc && desc.chunks && desc.chunks.length) {
    var out = [];
    var end = offset + limit;
    desc.chunks.forEach(function (c) {
      var chunkStart = Number(c.startRow) || 0;
      var chunkRows = Number(c.rowCount) || 0;
      if (chunkStart >= end || chunkStart + chunkRows <= offset) return;
      var part = readJson_(c.name);
      if (!part || !Array.isArray(part.rows)) throw new Error('Drive backup chunk missing: ' + c.name);
      var from = Math.max(0, offset - chunkStart);
      var to = Math.min(part.rows.length, end - chunkStart);
      if (to > from) out = out.concat(part.rows.slice(from, to));
    });
    return { rows: out };
  }
  // Backward compatibility with the previous single-JSON-file backup format.
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

// Run once from the Apps Script editor to keep Drive backups fresh without slowing manifest requests.
function setupBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scheduledBackup') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('scheduledBackup').timeBased().everyHours(1).create();
  Logger.log('Hourly Drive backup trigger installed.');
}

function scheduledBackup() {
  try {
    var live = liveManifest_();
    if (live.sheets.length) backupIfStale_(live);
  } catch (err) { console.error('Scheduled backup failed: ' + err); }
}

function backupIfStale_(live) {
  try {
    var meta = readJson_('meta.json');
    if (meta && meta.revision === live.revision && meta.sheets && meta.sheets.length) return;
    var ss = spreadsheet_();
    var backupId = String(live.revision).replace(/[^A-Za-z0-9]/g, '').slice(-18) + '_' + Date.now();
    var newSheets = [];
    live.sheets.forEach(function (s) {
      var sh = spreadsheetFor_(s.name).getSheetByName(s.name);
      if (!sh || sh.getLastRow() < 2) return;
      var chunks = [];
      var rowCount = sh.getLastRow() - 1;
      for (var offset = 0, idx = 0; offset < rowCount; offset += BACKUP_ROWS_PER_CHUNK, idx++) {
        var count = Math.min(BACKUP_ROWS_PER_CHUNK, rowCount - offset);
        var vals = sh.getRange(2 + offset, 1, count, sh.getLastColumn()).getValues().map(cleanRow_);
        var name = 'data-' + s.name + '-' + backupId + '-' + idx + '.json';
        writeJson_(name, { sheet: s.name, startRow: offset, rows: vals });
        chunks.push({ name: name, startRow: offset, rowCount: vals.length });
      }
      newSheets.push({ name: s.name, header: s.header, rowCount: rowCount, revision: s.revision, chunks: chunks });
    });
    var oldMeta = meta;
    writeJson_('meta.json', { sheets: newSheets, backedUpAt: new Date().toISOString(), revision: live.revision, fromExcel: false });
    trashOldDataFiles_(oldMeta, newSheets);
  } catch (err) { /* best-effort backup; the live Google Sheet remains the source of truth */ }
}

function trashOldDataFiles_(oldMeta, newSheets) {
  try {
    var keep = {};
    var keepSheets = {};
    newSheets.forEach(function (s) {
      keepSheets[s.name] = true;
      (s.chunks || []).forEach(function (c) { keep[c.name] = true; });
    });
    if (oldMeta && oldMeta.sheets) oldMeta.sheets.forEach(function (s) {
      (s.chunks || []).forEach(function (c) { if (!keep[c.name]) trash_(c.name); });
      // Keep a legacy single-file backup for an untouched tab during an individual import.
      if (!s.chunks && !keepSheets[s.name]) trash_('data-' + s.name + '.json');
    });
    // Remove legacy single-file backups only for tabs now represented by new chunk files.
    newSheets.forEach(function (s) { if (s.chunks && s.chunks.length) trash_('data-' + s.name + '.json'); });
  } catch (err) { /* cleanup can be retried on a later backup */ }
}

/* ------------------------------ Excel import (chunked, selected-tab aware) ------------------------------ */

function safeImportId_(id) {
  var v = String(id || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw new Error('Invalid import ID');
  return v;
}

function stageChunkName_(importId, sheet, index) {
  return 'stage-' + importId + '-' + sheet + '-' + index + '.json';
}

// body: {importId,sheet,index,header?,startRow,rows}; each chunk is stored separately to avoid rewriting a growing JSON file.
function importChunk_(b) {
  var importId = safeImportId_(b.importId);
  if (DATA_SHEETS.indexOf(b.sheet) < 0) throw new Error('Unknown sheet: ' + b.sheet);
  if (!Array.isArray(b.rows) || !Number.isInteger(Number(b.index)) || Number(b.index) < 0) throw new Error('Invalid import chunk');
  var index = Number(b.index);
  if (index === 0 && (!Array.isArray(b.header) || !b.header.length)) throw new Error('The first chunk must include a header');
  var chunk = { importId: importId, sheet: b.sheet, index: index, startRow: Number(b.startRow) || 0,
    header: index === 0 ? b.header : undefined, rows: b.rows };
  writeJson_(stageChunkName_(importId, b.sheet, index), chunk);
  return { ok: true, importId: importId, sheet: b.sheet, index: index, received: b.rows.length };
}

function ensureSheetSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function replaceGoogleSheetFromChunks_(sheetName, header, chunks, importId) {
  var ss = spreadsheet_();
  var target = ss.getSheetByName(sheetName);
  var created = !target;
  if (!target) target = ss.insertSheet(sheetName);
  var backup = null;
  var succeeded = false;
  try {
    if (!created) {
      backup = target.copyTo(ss);
      backup.setName(('__backup_' + importId + '_' + sheetName).slice(0, 99));
    }
    var totalRows = 1 + chunks.reduce(function (sum, c) { return sum + c.rowCount; }, 0);
    ensureSheetSize_(target, Math.max(1, totalRows), Math.max(1, header.length));
    target.clearContents();
    target.getRange(1, 1, 1, header.length).setValues([header]);
    var writeAt = 2;
    chunks.forEach(function (c) {
      var data = readJson_(c.stageName);
      if (!data || !Array.isArray(data.rows)) throw new Error('Staged chunk missing: ' + c.stageName);
      for (var i = 0; i < data.rows.length; i += BACKUP_ROWS_PER_CHUNK) {
        var batch = data.rows.slice(i, i + BACKUP_ROWS_PER_CHUNK).map(function (row) {
          var fixed = row.slice(0, header.length);
          while (fixed.length < header.length) fixed.push('');
          return fixed;
        });
        if (batch.length) {
          ensureSheetSize_(target, writeAt + batch.length - 1, header.length);
          target.getRange(writeAt, 1, batch.length, header.length).setValues(batch);
          writeAt += batch.length;
        }
      }
    });
    succeeded = true;
  } catch (err) {
    if (backup) {
      try {
        target.clearContents();
        var oldRange = backup.getDataRange();
        ensureSheetSize_(target, oldRange.getNumRows(), oldRange.getNumColumns());
        oldRange.copyTo(target.getRange(1, 1), { contentsOnly: true });
      } catch (restoreErr) {
        throw new Error('Sheet replacement failed and automatic restore also failed. Recovery copy remains as ' + backup.getName() + '. Original error: ' + err);
      }
    }
    throw err;
  } finally {
    if (succeeded && backup) ss.deleteSheet(backup);
    if (!succeeded && created) {
      // Leave a newly-created tab in place only if the caller needs to inspect the failed import.
    }
  }
}

// body: {importId,sheets:[{name,rowCount,chunkCount}],fileName,replaceMode:'selected'|'all',targetSheet}
function importCommit_(b) {
  var importId = safeImportId_(b.importId);
  if (!Array.isArray(b.sheets) || !b.sheets.length) throw new Error('No sheets supplied for import');
  var selected = b.replaceMode === 'selected';
  if (selected && (b.sheets.length !== 1 || b.sheets[0].name !== b.targetSheet)) throw new Error('Selected-tab import target does not match uploaded data');

  // Validate every staged chunk before touching the live sheet.
  var prepared = b.sheets.map(function (s) {
    if (DATA_SHEETS.indexOf(s.name) < 0) throw new Error('Unknown sheet: ' + s.name);
    var chunkCount = Number(s.chunkCount);
    if (!Number.isInteger(chunkCount) || chunkCount < 1) throw new Error(s.name + ': invalid chunk count');
    var chunks = [];
    var expectedStart = 0;
    var header = null;
    for (var i = 0; i < chunkCount; i++) {
      var name = stageChunkName_(importId, s.name, i);
      var part = readJson_(name);
      if (!part || part.importId !== importId || part.sheet !== s.name || Number(part.index) !== i || !Array.isArray(part.rows)) {
        throw new Error(s.name + ': missing or invalid staged batch ' + (i + 1));
      }
      if (Number(part.startRow) !== expectedStart) throw new Error(s.name + ': staged batches are not contiguous');
      if (i === 0) header = part.header;
      expectedStart += part.rows.length;
      chunks.push({ stageName: name, index: i, startRow: Number(part.startRow), rowCount: part.rows.length });
    }
    if (!header || !header.length) throw new Error(s.name + ': missing header');
    if (expectedStart !== Number(s.rowCount)) throw new Error(s.name + ': expected ' + s.rowCount + ' rows, received ' + expectedStart);
    return { name: s.name, header: header, rowCount: expectedStart, chunks: chunks };
  });

  // Back up existing Google Sheets tabs and then replace only the target tab(s).
  prepared.forEach(function (s) { replaceGoogleSheetFromChunks_(s.name, s.header, s.chunks, importId); });

  // Promote staged chunks to versioned Drive backup files. The metadata switch happens only after sheet writes succeed.
  var newDescriptors = prepared.map(function (s) {
    var sheetRevision = String(Date.now());
    props_().setProperty(sheetRevisionKey_(s.name), sheetRevision);
    var chunks = s.chunks.map(function (c) {
      var stageFile = file_(c.stageName);
      if (!stageFile) throw new Error('Staged Drive file missing before promotion: ' + c.stageName);
      var finalName = 'data-' + s.name + '-' + importId + '-' + c.index + '.json';
      stageFile.setName(finalName);
      return { name: finalName, startRow: c.startRow, rowCount: c.rowCount };
    });
    return { name: s.name, header: s.header, rowCount: s.rowCount, revision: sheetRevision, chunks: chunks };
  });

  var oldMeta = readJson_('meta.json') || { sheets: [] };
  var finalSheets;
  if (selected) {
    finalSheets = (oldMeta.sheets || []).filter(function (old) { return old.name !== newDescriptors[0].name; }).concat(newDescriptors);
  } else {
    finalSheets = newDescriptors;
    // A full workbook replacement clears tabs omitted from the uploaded workbook.
    DATA_SHEETS.forEach(function (name) {
      if (newDescriptors.some(function (s) { return s.name === name; })) return;
      if (SYNCED_SHEETS.indexOf(name) >= 0) return; // filled by a script sync, not by Excel imports
      var sh = spreadsheet_().getSheetByName(name);
      if (sh) sh.clearContents();
      trash_('data-' + name + '.json');
    });
  }
  var ss = spreadsheet_();
  var fileUpdated = DriveApp.getFileById(ss.getId()).getLastUpdated().getTime();
  var live = liveManifest_();
  writeJson_('meta.json', { sheets: finalSheets, importedAt: new Date().toISOString(), fileName: b.fileName || '',
    revision: live.revision, fromExcel: false, backedUpAt: new Date().toISOString() });
  // Old versions are no longer referenced by meta.json; remove them after the new version is committed.
  trashOldDataFiles_(oldMeta, finalSheets);
  props_().setProperty('DATA_MODE', 'auto');
  return { ok: true, mode: 'auto', sheets: finalSheets.map(function (s) { return { name: s.name, rowCount: s.rowCount }; }), revision: 'sheet:' + live.revision };
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
  persistAnalytics_(all);
  return { ok: true, count: all.length };
}

function persistAnalytics_(all) {
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
}

/* --------------------- automatic end-of-day deposit / withdrawal totals --------------------- */

function timezone_() { return props_().getProperty('TIMEZONE') || Session.getScriptTimeZone() || 'Asia/Dhaka'; }

function numVal_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/[, ]/g, ''));
  return isFinite(n) ? n : 0;
}

// Sum the DEPOSIT and WITHDRAWAL columns (matched by header name, any case) of one tab.
function sumTab_(sh) {
  var out = { deposit: 0, withdrawal: 0 };
  var last = sh.getLastRow();
  if (last < 2) return out;
  // PKR-BKK tabs have a two-row header (group title on row 1, JAZZCASH / UPAISA / NAYAPAY on row 2), data from row 3.
  // Deposit = the TOTAL DEPOSIT column; Withdrawal = the WITHDRAWAL column (stored negative, so summed as amounts out).
  var topRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toUpperCase(); });
  var subRow = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toUpperCase(); });
  if (subRow.indexOf('JAZZCASH') >= 0 && subRow.indexOf('UPAISA') >= 0) {
    var depC = -1;
    for (var ci = 0; ci < subRow.length; ci++) { if (subRow[ci] === 'TOTAL DEPOSIT' || subRow[ci] === 'DEPOSIT') { depC = ci + 1; break; } }
    var wdC = topRow.indexOf('WITHDRAWAL') + 1;
    if (last >= 3) {
      if (depC > 0) sh.getRange(3, depC, last - 2, 1).getValues().forEach(function (r) { out.deposit += numVal_(r[0]); });
      if (wdC > 0) sh.getRange(3, wdC, last - 2, 1).getValues().forEach(function (r) { out.withdrawal += Math.abs(numVal_(r[0])); });
    }
    return out;
  }
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toUpperCase(); });
  var dCol = header.indexOf('DEPOSIT') + 1, wCol = header.indexOf('WITHDRAWAL') + 1;
  if (dCol > 0) sh.getRange(2, dCol, last - 1, 1).getValues().forEach(function (r) { out.deposit += numVal_(r[0]); });
  if (wCol > 0) sh.getRange(2, wCol, last - 1, 1).getValues().forEach(function (r) { out.withdrawal += numVal_(r[0]); });
  return out;
}

/**
 * Records today's total deposit and withdrawal for every gateway in DAILY_GATEWAYS.
 * - Row key is date + currency + gateway; automatic rows carry the note "auto" and are refreshed on every run.
 * - A row saved by hand (any other note) is never overwritten.
 * - fromTrigger=true: a run just after midnight (00:00-00:59) belongs to the day that just ended.
 */
function recordDailyTotals_(fromTrigger) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tz = timezone_();
    var when = new Date();
    if (fromTrigger && Number(Utilities.formatDate(when, tz, 'H')) === 0) when = new Date(when.getTime() - 3600 * 1000);
    var date = Utilities.formatDate(when, tz, 'yyyy-MM-dd');
    var ss = spreadsheet_();
    var all = readAnalytics_();
    var recorded = [], skipped = [];
    Object.keys(DAILY_GATEWAYS).forEach(function (key) {
      var cfg = DAILY_GATEWAYS[key];
      var gw = cfg.gateway;
      var label = key;
      var dep = 0, wd = 0, found = 0;
      cfg.sheets.forEach(function (name) {
        var sh = spreadsheetFor_(name).getSheetByName(name);
        if (!sh) return;
        found++;
        var t = sumTab_(sh);
        dep += t.deposit; wd += t.withdrawal;
      });
      if (!found) { skipped.push(label + ' (no tabs found)'); return; }
      var entry = { date: date, currency: cfg.currency, gateway: gw, deposit: Math.round(dep * 100) / 100, withdrawal: Math.round(wd * 100) / 100, note: 'auto' };
      var i = -1;
      for (var k = 0; k < all.length; k++) {
        if (all[k].date === date && all[k].currency === cfg.currency && all[k].gateway === gw) { i = k; break; }
      }
      if (i >= 0 && all[i].note !== 'auto') { skipped.push(label + ' (manual entry kept)'); return; }
      if (i >= 0) all[i] = entry; else all.push(entry);
      recorded.push(entry);
    });
    if (recorded.length) persistAnalytics_(all);
    return { ok: true, date: date, recorded: recorded, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

// Time-driven trigger target.
function recordDailyTotals() {
  try { recordDailyTotals_(true); } catch (err) { console.error('Daily totals failed: ' + err); }
}

/** Run once from the editor: installs the daily trigger (runs between 23:50 and 00:05 in the script time zone). */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recordDailyTotals') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordDailyTotals').timeBased().atHour(23).nearMinute(50).everyDays(1).inTimezone(timezone_()).create();
  Logger.log('Daily totals trigger installed (time zone: ' + timezone_() + ').');
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




/**
 * Sync BJ SM from Google Sheet B
 * into PKR-BKK in Google Sheet C.
 * Copies values only, every minute.
 */

const BJSM_SOURCE_SPREADSHEET_ID = "1rZaHE1DXOws8rq73IavbTXxClSyPYk3scNwn4EcOdpY";
const BJSM_DESTINATION_SPREADSHEET_ID = "1veUwMw7f9-R_XdyT6yuD3eQO8q6JezV2wJeMiCzymmQ";




function syncBJSMtoPKRBKK() {
  const sourceSS = SpreadsheetApp.openById(
    BJSM_SOURCE_SPREADSHEET_ID
  );
  const destinationSS = SpreadsheetApp.openById(
    BJSM_DESTINATION_SPREADSHEET_ID
  );

  const source = sourceSS.getSheetByName("BJ SM");
  const destination = destinationSS.getSheetByName("PKR-BJ-BKK");

  if (!source) throw new Error('Source tab "BJ SM" not found.');
  if (!destination) throw new Error('Destination tab "PKR-BJ-BKK" not found.');

  const sourceRange = source.getDataRange();
  const rows = Math.max(sourceRange.getNumRows(), 1);
  const cols = Math.max(sourceRange.getNumColumns(), 1);

  // Make sure the destination has enough rows and columns.
  if (destination.getMaxRows() < rows) {
    destination.insertRowsAfter(
      destination.getMaxRows(),
      rows - destination.getMaxRows()
    );
  }

  if (destination.getMaxColumns() < cols) {
    destination.insertColumnsAfter(
      destination.getMaxColumns(),
      cols - destination.getMaxColumns()
    );
  }

  // Remove old destination content and formatting.
  // Remember whether the data really changed, so the dashboard only re-downloads this tab when needed.
  const bkkChanged = JSON.stringify(destination.getDataRange().getValues()) !== JSON.stringify(sourceRange.getValues());

  const oldRange = destination.getDataRange();
  oldRange.breakApart();
  oldRange.clear();

  const targetRange = destination.getRange(1, 1, rows, cols);

  // Copy values.
  targetRange.setValues(sourceRange.getValues());

  // Copy common formatting.
  targetRange.setBackgrounds(sourceRange.getBackgrounds());
  targetRange.setFontColors(sourceRange.getFontColors());
  targetRange.setFontFamilies(sourceRange.getFontFamilies());
  targetRange.setFontSizes(sourceRange.getFontSizes());
  targetRange.setFontWeights(sourceRange.getFontWeights());
  targetRange.setFontStyles(sourceRange.getFontStyles());
  targetRange.setFontLines(sourceRange.getFontLines());
  targetRange.setHorizontalAlignments(
    sourceRange.getHorizontalAlignments()
  );
  targetRange.setVerticalAlignments(
    sourceRange.getVerticalAlignments()
  );
  targetRange.setNumberFormats(sourceRange.getNumberFormats());
  targetRange.setWraps(sourceRange.getWraps());
  targetRange.setTextRotations(sourceRange.getTextRotations());

  // Copy merged cells.
  source.getDataRange().getMergedRanges().forEach(function (merged) {
    destination
      .getRange(
        merged.getRow(),
        merged.getColumn(),
        merged.getNumRows(),
        merged.getNumColumns()
      )
      .merge();
  });

  // Copy column widths and row heights.
  for (let c = 1; c <= cols; c++) {
    destination.setColumnWidth(c, source.getColumnWidth(c));
  }

  for (let r = 1; r <= rows; r++) {
    destination.setRowHeight(r, source.getRowHeight(r));
  }

  // The onEdit trigger does not fire for script writes, so tell the dashboard that this tab changed.
  if (bkkChanged) props_().setProperty(sheetRevisionKey_("PKR-BJ-BKK"), String(Date.now()));

  Logger.log(
    "Sync completed: " + rows + " rows, " + cols + " columns."
  );
}




function setupBJSMMinuteSync() {
  // Remove duplicate triggers for this sync only.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncBJSMtoPKRBKK")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("syncBJSMtoPKRBKK")
    .timeBased()
    .everyMinutes(1)
    .create();

  // Perform the initial sync immediately.
  syncBJSMtoPKRBKK();
}













// Sync ACCT LIST from the source spreadsheet
// into PKR-SSG in the destination spreadsheet.

const ACCTLIST_SOURCE_SPREADSHEET_ID =
  "1MRnikVuHUnZDxKBOAvWZm1sCDA3HYZZG1b8mM_nc5iU";

const ACCTLIST_DESTINATION_SPREADSHEET_ID =
  "1veUwMw7f9-R_XdyT6yuD3eQO8q6JezV2wJeMiCzymmQ";


function syncACCTLISTtoPKRSSG() {
  const sourceSS = SpreadsheetApp.openById(
    ACCTLIST_SOURCE_SPREADSHEET_ID
  );

  const destinationSS = SpreadsheetApp.openById(
    ACCTLIST_DESTINATION_SPREADSHEET_ID
  );

  const source = sourceSS.getSheetByName("ACCT LIST");
  const destination = destinationSS.getSheetByName("PKR-SSG");

  if (!source) {
    throw new Error('Source tab "ACCT LIST" not found.');
  }

  if (!destination) {
    throw new Error('Destination tab "PKR-SSG" not found.');
  }

  const sourceRange = source.getDataRange();
  const rows = Math.max(sourceRange.getNumRows(), 1);
  const cols = Math.max(sourceRange.getNumColumns(), 1);

  // Ensure the destination has enough space.
  if (destination.getMaxRows() < rows) {
    destination.insertRowsAfter(
      destination.getMaxRows(),
      rows - destination.getMaxRows()
    );
  }

  if (destination.getMaxColumns() < cols) {
    destination.insertColumnsAfter(
      destination.getMaxColumns(),
      cols - destination.getMaxColumns()
    );
  }

  // Compare with what is already in PKR-SSG, so the dashboard is told about real changes only.
  const newValues = sourceRange.getValues();
  const oldValues = destination.getDataRange().getValues();
  const changed = JSON.stringify(oldValues) !== JSON.stringify(newValues);

  // Clear old destination data and formatting.
  const oldRange = destination.getDataRange();
  oldRange.breakApart();
  oldRange.clear();

  const targetRange = destination.getRange(1, 1, rows, cols);

  // Copy values.
  targetRange.setValues(newValues);

  // Copy common formatting.
  targetRange.setBackgrounds(sourceRange.getBackgrounds());
  targetRange.setFontColors(sourceRange.getFontColors());
  targetRange.setFontFamilies(sourceRange.getFontFamilies());
  targetRange.setFontSizes(sourceRange.getFontSizes());
  targetRange.setFontWeights(sourceRange.getFontWeights());
  targetRange.setFontStyles(sourceRange.getFontStyles());
  targetRange.setFontLines(sourceRange.getFontLines());
  targetRange.setHorizontalAlignments(
    sourceRange.getHorizontalAlignments()
  );
  targetRange.setVerticalAlignments(
    sourceRange.getVerticalAlignments()
  );
  targetRange.setNumberFormats(sourceRange.getNumberFormats());
  targetRange.setWraps(sourceRange.getWraps());
  targetRange.setTextRotations(sourceRange.getTextRotations());

  // Copy merged cells.
  sourceRange.getMergedRanges().forEach(function (merged) {
    destination.getRange(
      merged.getRow(),
      merged.getColumn(),
      merged.getNumRows(),
      merged.getNumColumns()
    ).merge();
  });

  // Copy column widths and row heights.
  for (let c = 1; c <= cols; c++) {
    destination.setColumnWidth(c, source.getColumnWidth(c));
  }

  for (let r = 1; r <= rows; r++) {
    destination.setRowHeight(r, source.getRowHeight(r));
  }

  // The onEdit trigger does not fire for script writes, so tell the dashboard that PKR-SSG changed.
  // Without this the web app keeps serving its cached copy of the tab.
  if (changed) props_().setProperty(sheetRevisionKey_("PKR-SSG"), String(Date.now()));

  Logger.log(
    "ACCT LIST sync completed" + (changed ? " (data changed): " : " (no change): ") +
    rows + " rows, " + cols + " columns."
  );
}


// Run this setup function once to install the automatic sync.
function setupACCTLISTMinuteSync() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === "syncACCTLISTtoPKRSSG";
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger("syncACCTLISTtoPKRSSG")
    .timeBased()
    .everyMinutes(1)
    .create();

  // Run the first sync immediately.
  syncACCTLISTtoPKRSSG();
}


// New BKK syncs: JB SM and 6S SM
// Uses the same source and destination spreadsheets as the existing sync.

function syncJBtoPKRJB_BKK() {
  syncBKKTab_("JB SM", "PKR-JB-BKK");
}

function sync6StoPKR6SBKK() {
  syncBKKTab_("6S SM", "PKR-6S-BKK");
}

function syncBKKTab_(sourceTabName, destinationTabName) {
  const sourceSS = SpreadsheetApp.openById(
    BJSM_SOURCE_SPREADSHEET_ID
  );
  const destinationSS = SpreadsheetApp.openById(
    BJSM_DESTINATION_SPREADSHEET_ID
  );

  const source = sourceSS.getSheetByName(sourceTabName);
  const destination = destinationSS.getSheetByName(destinationTabName);

  if (!source) {
    throw new Error('Source tab "' + sourceTabName + '" not found.');
  }
  if (!destination) {
    throw new Error(
      'Destination tab "' + destinationTabName + '" not found.'
    );
  }

  const sourceRange = source.getDataRange();
  const rows = Math.max(sourceRange.getNumRows(), 1);
  const cols = Math.max(sourceRange.getNumColumns(), 1);

  if (destination.getMaxRows() < rows) {
    destination.insertRowsAfter(
      destination.getMaxRows(),
      rows - destination.getMaxRows()
    );
  }

  if (destination.getMaxColumns() < cols) {
    destination.insertColumnsAfter(
      destination.getMaxColumns(),
      cols - destination.getMaxColumns()
    );
  }

  // Remember whether the data really changed, so the dashboard only re-downloads this tab when needed.
  const bkkChanged = JSON.stringify(destination.getDataRange().getValues()) !== JSON.stringify(sourceRange.getValues());

  const oldRange = destination.getDataRange();
  oldRange.breakApart();
  oldRange.clear();

  const targetRange = destination.getRange(1, 1, rows, cols);

  targetRange.setValues(sourceRange.getValues());
  targetRange.setBackgrounds(sourceRange.getBackgrounds());
  targetRange.setFontColors(sourceRange.getFontColors());
  targetRange.setFontFamilies(sourceRange.getFontFamilies());
  targetRange.setFontSizes(sourceRange.getFontSizes());
  targetRange.setFontWeights(sourceRange.getFontWeights());
  targetRange.setFontStyles(sourceRange.getFontStyles());
  targetRange.setFontLines(sourceRange.getFontLines());
  targetRange.setHorizontalAlignments(
    sourceRange.getHorizontalAlignments()
  );
  targetRange.setVerticalAlignments(
    sourceRange.getVerticalAlignments()
  );
  targetRange.setNumberFormats(sourceRange.getNumberFormats());
  targetRange.setWraps(sourceRange.getWraps());
  targetRange.setTextRotations(sourceRange.getTextRotations());

  sourceRange.getMergedRanges().forEach(function (merged) {
    destination.getRange(
      merged.getRow(),
      merged.getColumn(),
      merged.getNumRows(),
      merged.getNumColumns()
    ).merge();
  });

  for (let c = 1; c <= cols; c++) {
    destination.setColumnWidth(c, source.getColumnWidth(c));
  }

  for (let r = 1; r <= rows; r++) {
    destination.setRowHeight(r, source.getRowHeight(r));
  }

  if (bkkChanged) props_().setProperty(sheetRevisionKey_(destinationTabName), String(Date.now()));

  Logger.log(
    sourceTabName + " -> " + destinationTabName +
    ": synced " + rows + " rows and " + cols + " columns."
  );
}


// Run once after both manual tests succeed.
// Installs 5-minute triggers for the two new syncs only.
function setupNewBKKSyncs() {
  const handlers = [
    "syncJBtoPKRJB_BKK",
    "sync6StoPKR6SBKK"
  ];

  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return handlers.indexOf(trigger.getHandlerFunction()) !== -1;
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger("syncJBtoPKRJB_BKK")
    .timeBased()
    .everyMinutes(5)
    .create();

  ScriptApp.newTrigger("sync6StoPKR6SBKK")
    .timeBased()
    .everyMinutes(5)
    .create();
}










// PKR Local Bank source spreadsheet.
const LOCALBANK_SOURCE_SPREADSHEET_ID =
  "1fUF513D2mxIAaqtb7M5DsTUjrnVgS_SrqYaXKS2Twks";

// Sync MONITORING -> PKR-LOCALBANK.
function syncLocalBankToPKRLocalBank() {
  const sourceSS = SpreadsheetApp.openById(
    LOCALBANK_SOURCE_SPREADSHEET_ID
  );

  const destinationSS = SpreadsheetApp.openById(
    ACCTLIST_DESTINATION_SPREADSHEET_ID
  );

  const source = sourceSS.getSheetByName("MONITORING");
  const destination = destinationSS.getSheetByName("PKR-LOCALBANK");

  if (!source) {
    throw new Error('Source tab "MONITORING" not found.');
  }

  if (!destination) {
    throw new Error('Destination tab "PKR-LOCALBANK" not found.');
  }

  const sourceRange = source.getDataRange();
  const newValues = sourceRange.getValues();

  const rows = Math.max(sourceRange.getNumRows(), 1);
  const cols = Math.max(sourceRange.getNumColumns(), 1);

  // Ensure the destination has enough space.
  if (destination.getMaxRows() < rows) {
    destination.insertRowsAfter(
      destination.getMaxRows(),
      rows - destination.getMaxRows()
    );
  }

  if (destination.getMaxColumns() < cols) {
    destination.insertColumnsAfter(
      destination.getMaxColumns(),
      cols - destination.getMaxColumns()
    );
  }

  // Detect data changes for the dashboard cache.
  const oldValues = destination.getDataRange().getValues();
  const changed =
    JSON.stringify(oldValues) !== JSON.stringify(newValues);

  // Clear old destination content and formatting.
  const oldRange = destination.getDataRange();
  oldRange.breakApart();
  oldRange.clear();

  const targetRange = destination.getRange(1, 1, rows, cols);

  // Copy values.
  targetRange.setValues(newValues);

  // Copy common formatting.
  targetRange.setBackgrounds(sourceRange.getBackgrounds());
  targetRange.setFontColors(sourceRange.getFontColors());
  targetRange.setFontFamilies(sourceRange.getFontFamilies());
  targetRange.setFontSizes(sourceRange.getFontSizes());
  targetRange.setFontWeights(sourceRange.getFontWeights());
  targetRange.setFontStyles(sourceRange.getFontStyles());
  targetRange.setFontLines(sourceRange.getFontLines());
  targetRange.setHorizontalAlignments(
    sourceRange.getHorizontalAlignments()
  );
  targetRange.setVerticalAlignments(
    sourceRange.getVerticalAlignments()
  );
  targetRange.setNumberFormats(sourceRange.getNumberFormats());
  targetRange.setWraps(sourceRange.getWraps());
  targetRange.setTextRotations(sourceRange.getTextRotations());

  // Copy merged cells.
  sourceRange.getMergedRanges().forEach(function (merged) {
    destination.getRange(
      merged.getRow(),
      merged.getColumn(),
      merged.getNumRows(),
      merged.getNumColumns()
    ).merge();
  });

  // Copy column widths and row heights.
  for (let c = 1; c <= cols; c++) {
    destination.setColumnWidth(c, source.getColumnWidth(c));
  }

  for (let r = 1; r <= rows; r++) {
    destination.setRowHeight(r, source.getRowHeight(r));
  }

  // Notify the dashboard when the data changes.
  if (changed) {
    props_().setProperty(
      sheetRevisionKey_("PKR-LOCALBANK"),
      String(Date.now())
    );
  }

  Logger.log(
    "Local Bank sync completed: " +
    rows + " rows, " + cols + " columns."
  );
}


// Run once to install the five-minute trigger.
function setupPKRLocalBankFiveMinuteSync() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() ===
        "syncLocalBankToPKRLocalBank";
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger("syncLocalBankToPKRLocalBank")
    .timeBased()
    .everyMinutes(5)
    .create();

  // Perform the initial sync immediately.
  syncLocalBankToPKRLocalBank();
}




function testLocalBankL12() {
  const ss = SpreadsheetApp.openById(
    "1fUF513D2mxIAaqtb7M5DsTUjrnVgS_SrqYaXKS2Twks"
  );

  const sheet = ss.getSheetByName("MONITORING");

  SpreadsheetApp.flush();
  Utilities.sleep(2000);

  const cell = sheet.getRange("L12");

  Logger.log("Formula: " + cell.getFormula());
  Logger.log("Raw value: " + cell.getValue());
  Logger.log("Displayed value: " + cell.getDisplayValue());
  Logger.log("Spreadsheet timezone: " + ss.getSpreadsheetTimeZone());
}


function checkLocalBankTimezones() {
  const ss = SpreadsheetApp.openById(
    "1fUF513D2mxIAaqtb7M5DsTUjrnVgS_SrqYaXKS2Twks"
  );

  Logger.log("Spreadsheet timezone: " + ss.getSpreadsheetTimeZone());
  Logger.log("Script timezone: " + Session.getScriptTimeZone());

  Logger.log(
    "Spreadsheet date: " +
    Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd")
  );

  Logger.log(
    "Sri Lanka date: " +
    Utilities.formatDate(new Date(), "Asia/Colombo", "yyyy-MM-dd")
  );
}
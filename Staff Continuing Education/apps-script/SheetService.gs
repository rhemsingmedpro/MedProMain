/**
 * Generic sheet-as-objects helpers. Every other backend file reads/writes
 * sheets through these — don't hand-roll range math elsewhere.
 */

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/** Returns every data row (below the header) as an array of {column: value} objects. */
function getRows(sheetName) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      // Sheets silently converts date-looking strings (e.g. "2026-08-24") into
      // real Date objects on write. Normalize back to plain yyyy-MM-dd here so
      // every reader gets a consistent string, not a full ISO timestamp.
      obj[headers[c]] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone() || 'America/Vancouver', 'yyyy-MM-dd') : v;
    }
    obj._row = i + 2; // 1-indexed sheet row, for updates/deletes
    rows.push(obj);
  }
  return rows;
}

/** Appends one row, matching column order to the sheet's header row. Returns the row number. */
function appendRow(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** Updates the row at obj._row (as returned by getRows) with the given field updates. */
function updateRowByIndex(sheetName, rowIndex, updates) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  for (var col = 0; col < headers.length; col++) {
    var h = headers[col];
    if (updates.hasOwnProperty(h)) {
      sheet.getRange(rowIndex, col + 1).setValue(updates[h]);
    }
  }
}

/** Finds the first row where column == value, or null. */
function findRow(sheetName, column, value) {
  var rows = getRows(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][column] === value) return rows[i];
  }
  return null;
}

function deleteRowByIndex(sheetName, rowIndex) {
  getSheet_(sheetName).deleteRow(rowIndex);
}

/** Generates the next sequential ID like "STF-0007" for a given prefix + ID column. */
function nextId(sheetName, idColumn, prefix) {
  var rows = getRows(sheetName);
  var max = 0;
  rows.forEach(function (r) {
    var id = String(r[idColumn] || '');
    var m = id.match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var next = max + 1;
  var padded = ('0000' + next).slice(-4);
  return prefix + '-' + padded;
}

function todayISO_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Vancouver', 'yyyy-MM-dd');
}

/**
 * One-time Sheet provisioner. Bind this script to a blank Google Sheet, then
 * run setup() once from the Apps Script editor (Run > setup). Safe to re-run —
 * it skips any tab that already exists rather than overwriting it.
 */

var SHEET_SCHEMAS = {
  Staff: ['StaffID', 'Name', 'Position', 'Username', 'Email', 'PasswordSalt', 'PasswordHash', 'ManagerAdminID', 'Active'],
  Admins: ['AdminID', 'Name', 'Email', 'Username', 'PasswordSalt', 'PasswordHash'],
  Records: ['RecordID', 'StaffID', 'EventDescription', 'Location', 'DateAttended', 'Role', 'HoursClaimed', 'DocumentURL', 'DocumentName', 'AdditionalRemarks', 'Status', 'SubmittedDate', 'SignedDate', 'SignedByAdminID']
};

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SHEET_SCHEMAS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      Logger.log('Skipping existing sheet: ' + name);
      return;
    }
    sheet = ss.insertSheet(name);
    var headers = SHEET_SCHEMAS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
    Logger.log('Created sheet: ' + name);
  });

  // Remove the default blank "Sheet1" if it's still sitting there empty.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  fixDateColumnFormats();
  Logger.log('Setup complete.');
}

/**
 * Forces the Records date columns to Plain Text formatting, so Sheets stops
 * silently converting "2026-08-24"-style strings into real Date objects on
 * write (which would otherwise come back as full ISO timestamps and break
 * the report date-range filter). Safe to re-run any time.
 */
function fixDateColumnFormats() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Records');
  if (!sheet) return;
  ['DateAttended', 'SubmittedDate', 'SignedDate'].forEach(function (col) {
    var colIndex = SHEET_SCHEMAS.Records.indexOf(col) + 1;
    sheet.getRange(1, colIndex, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  Logger.log('Records date columns set to plain text.');
}

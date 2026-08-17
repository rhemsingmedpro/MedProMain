/**
 * Web app entry point. doPost-only JSON API — deploy as "Execute as: Me",
 * "Who has access: Anyone". The frontends POST {action, payload} with
 * Content-Type: text/plain;charset=utf-8 (not application/json) so the
 * request stays a CORS "simple request" and skips a preflight OPTIONS call,
 * which Apps Script web apps can't answer with custom CORS headers anyway.
 *
 * Every action handler below is a plain function name — add a new action by
 * adding a case here and a function in the relevant file (Records.gs,
 * Auth.gs, GitHubService.gs).
 */

function doPost(e) {
  var response;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var payload = body.payload || {};
    var data = routeAction_(action, payload);
    response = { ok: true, data: data };
  } catch (err) {
    response = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeAction_(action, p) {
  switch (action) {
    // --- Auth ---
    case 'staffLogin': return authenticateStaff(p.username, p.password);
    case 'adminLogin': return authenticateAdmin(p.username, p.password);
    case 'setStaffPassword': return setStaffPassword(p.staffId, p.newPassword);
    case 'setAdminPassword': return setAdminPassword(p.adminId, p.newPassword);

    // --- Staff-facing records ---
    case 'getStaffRecords': return getStaffRecords(p.staffId);
    case 'submitRecord': return submitRecord(p.staffId, p.record);

    // --- Admin: staff ---
    case 'listStaff': return listStaff();
    case 'addStaff': return addStaff(p.staff, p.initialPassword);
    case 'updateStaff': return updateStaff(p.staffId, p.updates);
    case 'setStaffActive': return setStaffActive(p.staffId, p.active);

    // --- Admin: admins ---
    case 'listAdmins': return listAdmins();
    case 'addAdmin': return addAdmin(p.admin, p.initialPassword);
    case 'updateAdmin': return updateAdmin(p.adminId, p.updates);

    // --- Admin: records ---
    case 'getAllRecords': return getAllRecords();
    case 'signOffRecord': return signOffRecord(p.recordId, p.adminId);
    case 'deleteRecord': return deleteRecord(p.recordId);

    // --- Reporting (both apps) ---
    case 'getReport': return getReport(p.fromDate, p.toDate, p.staffId || null);

    default: throw new Error('Unknown action: ' + action);
  }
}

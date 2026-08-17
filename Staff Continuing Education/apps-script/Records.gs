/**
 * Staff / admin CRUD, CE record CRUD, submit + sign-off workflow, and the
 * date-range report query. Used by both frontends via Code.gs's router.
 */

// ---- Staff ----

function listStaff() {
  return getRows('Staff').map(stripAuthFields_);
}

function addStaff(staff, initialPassword) {
  var id = nextId('Staff', 'StaffID', 'STF');
  var salt = makeSalt_();
  var username = String(staff.Email || '').trim().toLowerCase();
  appendRow('Staff', {
    StaffID: id,
    Name: staff.Name,
    Position: staff.Position || '',
    Username: username,
    Email: username,
    PasswordSalt: salt,
    PasswordHash: hashPassword_(initialPassword, salt),
    ManagerAdminID: staff.ManagerAdminID || '',
    Active: true
  });
  return id;
}

function updateStaff(staffId, updates) {
  var row = findRow('Staff', 'StaffID', staffId);
  if (!row) throw new Error('Staff not found: ' + staffId);
  var safeUpdates = {};
  ['Name', 'Position', 'ManagerAdminID', 'Active'].forEach(function (k) {
    if (updates.hasOwnProperty(k)) safeUpdates[k] = updates[k];
  });
  if (updates.hasOwnProperty('Email')) {
    var username = String(updates.Email || '').trim().toLowerCase();
    safeUpdates.Email = username;
    safeUpdates.Username = username;
  }
  updateRowByIndex('Staff', row._row, safeUpdates);
}

function setStaffActive(staffId, active) {
  updateStaff(staffId, { Active: active });
}

// ---- Admins ----

function listAdmins() {
  return getRows('Admins').map(stripAuthFields_);
}

function addAdmin(admin, initialPassword) {
  var id = nextId('Admins', 'AdminID', 'ADM');
  var salt = makeSalt_();
  var username = String(admin.Email || '').trim().toLowerCase();
  appendRow('Admins', {
    AdminID: id,
    Name: admin.Name,
    Email: username,
    Username: username,
    PasswordSalt: salt,
    PasswordHash: hashPassword_(initialPassword, salt)
  });
  return id;
}

// ---- CE Records ----

function attachStaffInfo_(record) {
  var staff = findRow('Staff', 'StaffID', record.StaffID);
  record.StaffName = staff ? staff.Name : 'Unknown';
  record.StaffPosition = staff ? staff.Position : '';
  return record;
}

/** Staff-facing: this staff member's own records, newest DateAttended first. */
function getStaffRecords(staffId) {
  return getRows('Records')
    .filter(function (r) { return r.StaffID === staffId; })
    .sort(function (a, b) { return (b.DateAttended || '').localeCompare(a.DateAttended || ''); });
}

/** Admin-facing: every record across all staff, newest DateAttended first, with staff name attached. */
function getAllRecords() {
  return getRows('Records')
    .map(attachStaffInfo_)
    .sort(function (a, b) { return (b.DateAttended || '').localeCompare(a.DateAttended || ''); });
}

/**
 * Staff submits a new CE record. Sets Status = "Pending Signoff" and emails
 * the staff member's assigned manager (if one is set and has an email). If
 * record.FileBase64/FileName are present, the attachment is committed to
 * GitHub first (path keyed off the new RecordID) so the whole submission —
 * document included — happens in one API round trip from the client.
 */
function submitRecord(staffId, record) {
  var staff = findRow('Staff', 'StaffID', staffId);
  if (!staff) throw new Error('Staff not found: ' + staffId);

  var id = nextId('Records', 'RecordID', 'REC');
  var submitted = todayISO_();

  var documentUrl = '';
  var documentName = '';
  if (record.FileBase64 && record.FileName) {
    documentName = record.FileName;
    var repoPath = 'records/' + staffId + '/' + id + '-' + record.FileName;
    documentUrl = commitFileToGitHub(repoPath, record.FileBase64, 'Add CE document for ' + id);
  }

  appendRow('Records', {
    RecordID: id,
    StaffID: staffId,
    EventDescription: record.EventDescription,
    Location: record.Location || '',
    DateAttended: record.DateAttended,
    Role: record.Role,
    HoursClaimed: record.HoursClaimed,
    DocumentURL: documentUrl,
    DocumentName: documentName,
    AdditionalRemarks: record.AdditionalRemarks || '',
    Status: 'Pending Signoff',
    SubmittedDate: submitted,
    SignedDate: '',
    SignedByAdminID: ''
  });

  if (staff.ManagerAdminID) {
    var manager = findRow('Admins', 'AdminID', staff.ManagerAdminID);
    if (manager) notifyManagerNewRecord(manager, staff, record);
  }

  return id;
}

/** Admin signs off a pending record. */
function signOffRecord(recordId, adminId) {
  var row = findRow('Records', 'RecordID', recordId);
  if (!row) throw new Error('Record not found: ' + recordId);
  var admin = findRow('Admins', 'AdminID', adminId);
  if (!admin) throw new Error('Admin not found: ' + adminId);

  updateRowByIndex('Records', row._row, {
    Status: 'Signed',
    SignedDate: todayISO_(),
    SignedByAdminID: adminId
  });

  var staff = findRow('Staff', 'StaffID', row.StaffID);
  if (staff) notifyStaffSignedOff(staff, row, admin);
}

function deleteRecord(recordId) {
  var row = findRow('Records', 'RecordID', recordId);
  if (!row) throw new Error('Record not found: ' + recordId);
  deleteRowByIndex('Records', row._row);
}

/**
 * Report query: records with DateAttended in [fromDate, toDate] (inclusive,
 * both "yyyy-MM-dd"), optionally restricted to one staffId. Used by both the
 * staff report tab (own records only) and the admin report tab (any/all
 * staff). Filtering is on DateAttended, not SubmittedDate, so a
 * late-logged-but-in-period event still shows up on the right period's
 * compliance report.
 */
function getReport(fromDate, toDate, staffId) {
  var rows = getRows('Records').map(attachStaffInfo_).filter(function (r) {
    if (staffId && r.StaffID !== staffId) return false;
    var d = r.DateAttended || '';
    return d >= fromDate && d <= toDate;
  });
  rows.sort(function (a, b) { return (a.DateAttended || '').localeCompare(b.DateAttended || ''); });
  var totalHours = rows.reduce(function (sum, r) { return sum + (Number(r.HoursClaimed) || 0); }, 0);
  return { records: rows, totalHours: totalHours };
}

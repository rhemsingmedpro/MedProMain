/**
 * Email + password auth for both staff and admins. Passwords are never
 * stored or returned in plaintext — only a salted SHA-256 hash. There is no
 * "forgot password" lookup by design; admins reset a password by setting a
 * new one for that account.
 */

function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + String(salt));
  return digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Returns the staff record (without password fields) on success, or null. */
function authenticateStaff(username, password) {
  var row = findRow('Staff', 'Username', String(username || '').trim().toLowerCase());
  if (!row) return null;
  if (row.Active !== true && row.Active !== 'Y' && row.Active !== 'TRUE') return null;
  if (hashPassword_(password, row.PasswordSalt) !== row.PasswordHash) return null;
  return stripAuthFields_(row);
}

/** Returns the admin record (without password fields) on success, or null. */
function authenticateAdmin(username, password) {
  var row = findRow('Admins', 'Username', String(username || '').trim().toLowerCase());
  if (!row) return null;
  if (hashPassword_(password, row.PasswordSalt) !== row.PasswordHash) return null;
  return stripAuthFields_(row);
}

function stripAuthFields_(row) {
  var copy = {};
  Object.keys(row).forEach(function (k) {
    if (k === 'PasswordSalt' || k === 'PasswordHash' || k === '_row') return;
    copy[k] = row[k];
  });
  return copy;
}

/** Admin action: set/reset a staff member's password. */
function setStaffPassword(staffId, newPassword) {
  var row = findRow('Staff', 'StaffID', staffId);
  if (!row) throw new Error('Staff not found: ' + staffId);
  var salt = makeSalt_();
  updateRowByIndex('Staff', row._row, { PasswordSalt: salt, PasswordHash: hashPassword_(newPassword, salt) });
}

/** Admin action: set/reset an admin's own or another admin's password. */
function setAdminPassword(adminId, newPassword) {
  var row = findRow('Admins', 'AdminID', adminId);
  if (!row) throw new Error('Admin not found: ' + adminId);
  var salt = makeSalt_();
  updateRowByIndex('Admins', row._row, { PasswordSalt: salt, PasswordHash: hashPassword_(newPassword, salt) });
}

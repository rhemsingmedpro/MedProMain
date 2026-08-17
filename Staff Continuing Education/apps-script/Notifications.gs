/**
 * MailApp notifications: manager alert on a new CE submission, staff
 * confirmation once a manager signs off. Fails soft — a missing/blank Email
 * shouldn't block the submit or sign-off action from completing.
 */

function notifyManagerNewRecord(manager, staff, record) {
  if (!manager || !manager.Email) return;
  try {
    MailApp.sendEmail({
      to: manager.Email,
      subject: 'CE record needs signoff: ' + staff.Name,
      body: 'Hi ' + manager.Name + ',\n\n' +
        staff.Name + ' has submitted a new continuing education record that needs your signoff:\n\n' +
        '  Event: ' + record.EventDescription + '\n' +
        '  Date attended: ' + record.DateAttended + '\n' +
        '  Hours claimed: ' + record.HoursClaimed + '\n\n' +
        'Sign in to the MedPro Continuing Education admin app to review and sign off.\n'
    });
  } catch (e) {
    Logger.log('notifyManagerNewRecord failed for ' + manager.Email + ': ' + e);
  }
}

function notifyStaffSignedOff(staff, record, admin) {
  if (!staff || !staff.Email) return;
  try {
    MailApp.sendEmail({
      to: staff.Email,
      subject: 'Your CE record was signed off: ' + record.EventDescription,
      body: 'Hi ' + staff.Name + ',\n\n' +
        (admin ? admin.Name : 'Your manager') + ' signed off your continuing education record:\n\n' +
        '  Event: ' + record.EventDescription + '\n' +
        '  Date attended: ' + record.DateAttended + '\n' +
        '  Hours claimed: ' + record.HoursClaimed + '\n\n' +
        'No further action needed — it now shows as Signed in the app.\n'
    });
  } catch (e) {
    Logger.log('notifyStaffSignedOff failed for ' + staff.Email + ': ' + e);
  }
}

# MedPro Respiratory — Staff Continuing Education Tracker
## Specification Document (v1.0)

---

## 1. Purpose

A web-based tool for MedPro staff to log continuing education / competency events (the
digital equivalent of the paper "Continuing Education and Competency Record" form), attach
supporting documents or certifications, and have a designated manager sign off on each
entry. Admins manage staff accounts and can run compliance reports over any date range,
exportable as a branded PDF. Same proven architecture as the North Wood Group Orientation
Tracker and other MedPro internal tools: self-contained static HTML frontends calling a
Google Apps Script backend, backed by a Google Sheet, hosted on GitHub Pages.

---

## 2. Source document

Digitizes `Continuing Education Record template.pdf` (MedPro form, May 2012):
Employee Name/Position, Education Event Description, Location, Date Attended,
Attendee/Presenter + Hours Claimed, Employee Signature, Supervisor/Employer Signature,
Additional Remarks. The paper form's two signature lines become the app's submit
(employee) → sign-off (manager) workflow; there's no separate "employee signature" capture
since submitting the record from a logged-in account is the equivalent act.

---

## 3. Users & Roles

| Role | Access |
|---|---|
| **Staff** | Sign in with **email + password**. Log new CE events, attach a document/certificate, view their own history and status (Pending Signoff / Signed), run their own date-range report and export it as PDF. |
| **Admin** | Multiple admins, equal permissions (matches NorthWood precedent). Add/edit/deactivate staff, set each staff member's assigned manager (drawn from the Admins list), view and sign off any staff member's CE records, run reports across any staff member or all staff for any date range, export PDF. |

No self-registration — admins provision all staff and admin accounts, including their
initial password.

---

## 4. Core Features

### 4.1 Staff-facing app
- Sign in (email + password).
- Dashboard: list of their own CE records, newest first, with status badge.
- "Add Education Record" form: Event Description, Location, Date Attended, Role
  (Attendee / Presenter), Hours Claimed, Additional Remarks, optional file attachment
  (PDF/image — e.g. a certificate).
- Submitting a record emails the staff member's assigned manager for signoff.
- Report tab: From/To date pickers (default Jan 1 – Dec 31 of the current year), shows
  matching records with total hours, "Export PDF" button.

### 4.2 Admin app
- **Staff management**: add/edit/deactivate staff — Name, Position, Email (=username),
  initial password, assigned Manager (dropdown of Admins).
- **Admin management**: add/edit admins — Name, Email, password.
- **Records dashboard**: every staff member's CE records, filterable by staff/status,
  Pending entries highlighted. "Sign Off" action records which admin signed and when.
- **Reporting**: From/To date range (same default as staff view), filter by one staff
  member or all, totals, "Export PDF" button — same branded layout as the staff report so
  either can go straight into a personnel file.

### 4.3 Notifications
- **New record submitted → email to the staff member's assigned manager**, with a direct
  link into the admin app.
- **Record signed off → email to the staff member**, confirming signoff (parallels the
  paper form's instruction that signed documentation goes into the personnel file).

---

## 5. Data model (Google Sheets)

**Staff** tab

| Column | Notes |
|---|---|
| StaffID | unique key |
| Name | |
| Position | |
| Username | staff's email address, used to sign in |
| Email | same as Username — kept as a separate column for notification sends without re-deriving |
| PasswordSalt / PasswordHash | salted SHA-256, never plaintext (see §8) |
| ManagerAdminID | FK into Admins — who gets emailed on new submissions |
| Active | Y/N — deactivate without deleting history |

**Admins** tab

| Column | Notes |
|---|---|
| AdminID | unique key |
| Name | |
| Email | |
| Username | |
| PasswordSalt / PasswordHash | |

**Records** tab (core tracking table)

| Column | Notes |
|---|---|
| RecordID | unique key |
| StaffID | |
| EventDescription | |
| Location | |
| DateAttended | |
| Role | `Attendee` or `Presenter` |
| HoursClaimed | numeric |
| DocumentURL | GitHub Pages URL of uploaded cert, blank if none |
| DocumentName | original filename, for display |
| AdditionalRemarks | |
| Status | `Pending Signoff` \| `Signed` |
| SubmittedDate | |
| SignedDate | blank until signed |
| SignedByAdminID | which admin signed |

---

## 6. Technical architecture

Same pattern as North Wood Group tracker:
- **Backend**: Google Apps Script web app, single `doPost` JSON API (`{action, payload}`,
  `Content-Type: text/plain` to dodge CORS preflight — Apps Script web apps can't set
  custom CORS headers). Handles auth, Sheet reads/writes, MailApp notifications, and
  committing uploaded certs to GitHub via the Contents API (PAT in Script Properties).
- **Frontend**: two self-contained HTML files, `staff-app/index.html` and
  `admin-app/index.html`, no build step, no framework — calling the Apps Script backend via
  a `CONFIG.API_URL` constant.
- **Content hosting**: certs/documents committed to a GitHub repo under
  `records/{StaffID}/{RecordID}-{filename}`, served via GitHub Pages (raw.githubusercontent
  doesn't reliably set `Content-Type` for binaries — same gotcha NorthWood hit).
- **PDF export**: client-side, via jsPDF + jsPDF-AutoTable loaded from CDN (fine for a
  GitHub Pages–hosted static site — this isn't a sandboxed Artifact). Report layout mirrors
  the existing Timesheet app's PDF style: navy header bar with the MedPro logo, green accent
  rule, light blue-grey table headers, signature line at the bottom.

---

## 7. Decisions made (equivalent to NorthWood spec's "Open Items" section, resolved up front)

- **Password, not PIN, and hashed.** User explicitly asked for a full password rather than
  a PIN. Stored as salted SHA-256 (`PasswordSalt` + `PasswordHash`), same treatment
  NorthWood's PINs ended up with — never plaintext. Consequence: admins can't look up a
  forgotten password, only reset it.
- **"Manager admin" = an existing Admin, assigned per staff member**, not a separate
  restricted role tier. Every admin can see and sign off every staff member's records
  (matches NorthWood's "all admins equal permission" precedent) — the manager assignment
  only determines *who gets emailed* when their staff submits a new record. This keeps the
  build simple; if staff volume later demands admins only seeing their own reports, that's
  a scoped follow-up, not a v1 requirement.
- **One role, one hours field per record** (`Attendee` or `Presenter` + a single
  `HoursClaimed`), rather than mirroring the paper form's two separate Attendee/Presenter
  lines with independent hours. Simplifies data entry; if a person genuinely both attended
  and presented at the same event, they'd log it as two records.
- **New dedicated GitHub repo** (`medpro-continuing-education` suggested name), same as
  NorthWood — built locally first, no repo/Sheet provisioned yet as of this build. See
  `SETUP.md`.
- **Electronic signature = the Signed status + SignedByAdminID/SignedDate audit trail**,
  not a drawn/typed signature image. Matches how the rest of these tools handle "signoff."

## 8. Out of scope (v1)

- Staff self-registration
- Quiz/training-content delivery (this tracks *external* CE events, not in-app training —
  different problem from the NorthWood orientation tracker)
- SSO / Google account login
- Per-manager restricted visibility (see §7)
- Multi-language support

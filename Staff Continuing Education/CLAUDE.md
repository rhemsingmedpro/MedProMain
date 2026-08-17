# CLAUDE.md — Staff Continuing Education Tracker

Architecture and decision reference for this project. Read this before making structural
changes. The original spec is `staff-continuing-education-spec.md` in this folder — this
file tracks what was actually decided/built, extending §7 of the spec where the build
surfaced new details.

## Data model (as built — see `apps-script/Setup.gs` for the authoritative column list)

**Staff**: `StaffID, Name, Position, Username, Email, PasswordSalt, PasswordHash,
ManagerAdminID, Active`

**Admins**: `AdminID, Name, Email, Username, PasswordSalt, PasswordHash`

**Records**: `RecordID, StaffID, EventDescription, Location, DateAttended, Role,
HoursClaimed, DocumentURL, DocumentName, AdditionalRemarks, Status, SubmittedDate,
SignedDate, SignedByAdminID`
- `Role`: `Attendee | Presenter`
- `Status`: `Pending Signoff | Signed` — written by the backend only. Signing off sets
  `Status`, `SignedDate`, `SignedByAdminID` together in one call; nothing flips it back.

## Backend (Apps Script, `apps-script/`)

Single web app, `doPost`-only JSON API, same shape as NorthWood's: body is
`{action, payload}` sent as `Content-Type: text/plain;charset=utf-8` to avoid a CORS
preflight (Apps Script web apps can't emit custom CORS headers), `Code.gs` dispatches on
`action`. Deploy as "Execute as: Me", "Who has access: Anyone" — auth is at the application
layer (email + password), not Google account.

Files:
- `Code.gs` — `doPost` router, wraps every response as JSON, catches and reports errors
  without leaking stack traces to the client.
- `Setup.gs` — `setup()` one-time tab/header provisioner, safe to re-run (skips existing
  tabs).
- `SheetService.gs` — generic sheet-as-objects helpers (`getRows`, `appendRow`, `updateRow`,
  `nextId`). Every other file uses these instead of hand-rolled range math.
- `Auth.gs` — `hashPassword`/`makeSalt`/`authenticateStaff`/`authenticateAdmin`.
- `Records.gs` — record CRUD, submit (triggers manager email), sign-off (triggers staff
  email), report query (date range + optional staff filter).
- `Notifications.gs` — `MailApp` senders for new-submission and signed-off emails.
- `GitHubService.gs` — commits a base64 file to the records repo via the GitHub Contents
  API, PAT read from `PropertiesService.getScriptProperties().GITHUB_TOKEN`, never logged or
  returned. Returns a GitHub Pages URL (`https://{owner}.github.io/{repo}/{path}`), not
  `raw.githubusercontent.com` — same `Content-Type` gotcha NorthWood hit with PDFs.

## Frontends

Both single self-contained HTML files, no build step, no framework — same pattern as Form
Builder / Patient Handouts / NorthWood. Each has a `CONFIG.API_URL` constant near the top of
its `<script>` block that must be set to the deployed Apps Script web app URL before use.

- `staff-app/index.html` — sign-in (email+password), dashboard of own records, add-record
  form with file attach, report tab (date range + PDF export).
- `admin-app/index.html` — staff CRUD (incl. manager assignment), admin CRUD, all-staff
  records dashboard with sign-off action, report tab (any staff or all, date range + PDF
  export).

PDF export in both is client-side via jsPDF + jsPDF-AutoTable (CDN `<script>` tags — this is
a plain GitHub Pages site, not a sandboxed Artifact, so CDN loads are fine). Layout mirrors
the existing Timesheet app's exported PDF: navy (`#003D79`) header bar with the MedPro logo
and a green (`#50B948`) accent rule under it, light blue-grey table header row, signature
line at the bottom.

## Branding

Reused `assets/MedPro-logo.png` (same file already used in Patient Education Emailing)
rather than re-extracting the logo from the source PDF. Brand colors pulled from the
existing Staff Portal hub page (`Index page/index.html`): `--navy: #003D79`,
`--navy-dark: #002B57`, `--green: #50B948`, `--green-dark: #3d9636`.

## Deployment target (open item)

Built as its own self-contained folder here, matching the NorthWood pattern (own future
repo `medpro-continuing-education`). The existing Staff Portal hub
(`Index page/index.html`) links to some tools as relative subfolders of its own deployed
repo (`patient-handouts/`, `timesheet/`, etc.) rather than separate repos — that hub repo
isn't cloned locally, so which pattern this project ends up using is the user's call at
deploy time (see `SETUP.md`). Either way the app code itself is unaffected — only the hub
card's `href` and where the folders get uploaded change.

## Known gaps / not yet wired up

- No automated tests — consistent with every other project in this family; verification is
  manual per `SETUP.md`.
- Report date-range filtering happens server-side in `Records.gs` off `DateAttended`, not
  `SubmittedDate` — a record attended in-range but logged late still shows up correctly on a
  compliance report for that period.

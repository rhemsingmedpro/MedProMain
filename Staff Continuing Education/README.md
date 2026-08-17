# MedPro Respiratory — Staff Continuing Education Tracker

Digitizes the paper "Continuing Education and Competency Record" form: staff log CE events
(with an optional attached certificate/document), their assigned manager gets emailed and
signs off, and admins can pull a date-range compliance report — for one staff member or
everyone — and export it as a branded PDF.

Same architecture as this org's other internal tools (Form Builder, Patient Handouts,
North Wood Group Orientation Tracker): self-contained static HTML frontends calling a
Google Apps Script backend, backed by a Google Sheet, hosted on GitHub Pages.

## Structure

- `staff-app/index.html` — sign in (email + password), log CE records, view own history and
  status, run/export own date-range report.
- `admin-app/index.html` — manage staff and admins (incl. manager assignment), view and sign
  off any staff member's records, run/export a report for any staff member or everyone.
- `apps-script/` — the backend (deploy into a Google Sheet-bound Apps Script project — see
  `SETUP.md`).
- `assets/` — MedPro logo + the shared PDF report generator (`medpro-pdf-report.js`) used by
  both frontends.
- `staff-continuing-education-spec.md` — full spec.
- `CLAUDE.md` — architecture/decision reference, read this before making structural changes.
- `SETUP.md` — one-time deployment steps (Sheet, Apps Script, GitHub repo, Pages).

## Before this is usable

Nothing is deployed yet — no Sheet provisioned, no Apps Script web app deployed, no GitHub
repo created, `CONFIG.API_URL` in both frontends is still a placeholder
(`PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`). Follow `SETUP.md` start to finish before
handing this to real staff.

## Adding a card to the Staff Portal hub

If you deploy this as its own repo (see `SETUP.md` §4) and want it linked from the existing
Staff Portal hub page (`Index page/index.html`), add a card like this alongside the existing
ones, then re-upload `index.html` to that hub's repo:

```html
<a class="card accent-navy" href="https://<your-org>.github.io/medpro-continuing-education/staff-app/" target="_blank" rel="noopener noreferrer">
  <div>
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"></path>
        <path d="M6 12v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"></path>
      </svg>
    </div>
    <div class="card-title">Continuing Education</div>
    <div class="card-desc">Log CE events, track manager signoff, and run compliance reports.</div>
  </div>
  <div class="card-arrow">Open<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></div>
</a>
```

If instead you deploy this as a subfolder of the hub repo itself (the alternative described
in `SETUP.md` §4), use a relative `href="continuing-education/"` instead, matching the
pattern the hub already uses for `patient-handouts/` and `timesheet/`.

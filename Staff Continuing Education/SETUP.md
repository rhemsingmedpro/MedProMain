# Setup & Deployment

One-time steps to take this from local files to a working app. Do these roughly in order —
later steps depend on earlier ones.

## 1. Create the Google Sheet + Apps Script project

1. Create a new blank Google Sheet (e.g. "MedPro Continuing Education — Data").
2. In the Sheet, go to **Extensions → Apps Script**. This opens a bound Apps Script project.
3. Delete the default empty `Code.gs` content, then copy in the contents of each file from
   this project's `apps-script/` folder as its own file in the Apps Script project (same
   filenames: `Code.gs`, `Setup.gs`, `SheetService.gs`, `Auth.gs`, `Records.gs`,
   `Notifications.gs`, `GitHubService.gs`).
4. In the Apps Script editor, select the `setup` function from the function dropdown and
   click **Run**. First run will prompt for authorization — approve it (it's your own
   script acting on your own Sheet). This creates the `Staff`, `Admins`, and `Records` tabs
   with headers.
5. Add yourself as the first admin. Don't add a row to the `Admins` tab by hand —
   `PasswordHash` has to be computed, not typed in. The Apps Script editor's Run button only
   runs a chosen function with zero arguments, so instead add a temporary wrapper function
   with your real values baked in:
   ```js
   function createFirstAdmin() {
     addAdmin({ Name: 'Your Name', Email: 'you@medprorespiratory.com' }, 'ChangeThisPassword123');
   }
   ```
   Save, pick `createFirstAdmin` from the function dropdown in the toolbar, click **Run**,
   approve the authorization prompt on first run, then check the `Admins` tab for the new
   row. Delete (or comment out) `createFirstAdmin` afterward so it doesn't get run again by
   accident and create a duplicate. There's no self-service password change yet — reset via
   another admin's "Reset Password" button in the admin app, or the same wrapper-function
   trick with `setAdminPassword('ADM-0001', 'newpassword')`.

## 2. Deploy the Apps Script as a web app

1. In the Apps Script editor: **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**. (Auth is handled at the application layer via
   email+password — this is intentional, see `CLAUDE.md`.)
5. Deploy, then copy the **Web app URL** (ends in `/exec`).
6. Paste that URL into `CONFIG.API_URL` near the top of the `<script>` block in both
   `staff-app/index.html` and `admin-app/index.html` (replacing
   `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`).
7. Any time you edit the Apps Script source, you need a **new version** under
   **Deploy → Manage deployments → Edit → New version** for changes to take effect on the
   existing URL.

## 3. GitHub repo + document upload

Staff attaching a certificate/document when they submit a CE record commits that file
directly into a GitHub repo via the GitHub API, so it needs a repo to commit into.
Everything below is done by clicking through github.com in your browser — no command line
needed.

### 3a. Create the repo

1. Go to [github.com/new](https://github.com/new) (sign in first if needed).
2. **Repository name**: `medpro-continuing-education` (or whatever you'd like — update the
   name below to match if you pick something else).
3. Set it to **Private** (recommended — this handles internal MedPro staff records).
4. Leave "Add a README file" and everything else under "Initialize this repository"
   **unchecked**.
5. Click **Create repository**. You'll land on a mostly-empty repo page with a "Quick
   setup" box.

### 3b. Upload the project files

1. On that same page, click the **"uploading an existing file"** link in the Quick setup
   box (if you've navigated away, use the **Add file → Upload files** button instead).
2. Open File Explorer to the `Staff Continuing Education` folder, select everything
   *inside* it (`README.md`, `CLAUDE.md`, `SETUP.md`,
   `staff-continuing-education-spec.md`, and the `staff-app`, `admin-app`, `apps-script`,
   `assets` folders) — not the `Staff Continuing Education` folder itself, just its
   contents.
3. Drag that whole selection into the browser drop zone (Chrome and Edge both support
   dragging folders this way). GitHub will show a file list building up as it processes
   the drop — give it a moment for everything to appear.
4. Scroll down to "Commit changes", leave it committing directly to `main`, and click
   **Commit changes**.

Note: the GitHub API creates a folder path automatically the first time a file is committed
into it — the first staff document upload into `records/{StaffID}/...` creates that folder
on the spot, nothing needs to exist ahead of time.

### 3c. Create the access token

1. Click your profile picture (top right) → **Settings**.
2. Scroll all the way down the left sidebar → **Developer settings**.
3. **Personal access tokens → Fine-grained tokens** → **Generate new token**.
4. **Token name**: something like `medpro-ce-uploader`.
5. **Expiration**: max is 1 year — set a calendar reminder to rotate it before it expires
   (an expired token fails silently and just looks like a broken document upload later).
6. **Repository access**: choose **Only select repositories** → pick
   `medpro-continuing-education`.
7. **Permissions → Repository permissions**: find **Contents**, set it to
   **Read and write**. Leave every other permission at **No access**.
8. Click **Generate token**, then **copy it immediately** — GitHub only shows it once.

### 3d. Give the token to Apps Script

1. Back in the Apps Script editor (from Section 1): click the gear icon in the left
   sidebar → **Project Settings**.
2. Scroll to **Script Properties** → **Add script property**, and add each of these as its
   own row:
   - `GITHUB_TOKEN` — paste the token from 3c.
   - `GITHUB_OWNER` — your GitHub username (or org name, if you created the repo under one).
   - `GITHUB_REPO` — `medpro-continuing-education` (exactly as you named it in 3a).
   - `GITHUB_BRANCH` — optional; only add this one if you're not using `main`.
3. Click **Save script properties**.

If the token is ever suspected compromised: go back to Developer Settings → Fine-grained
tokens, revoke it, and generate a replacement — repeat 3c/3d. Blast radius is small since
it's scoped to one repo with Contents-only access.

Until this whole section is done, everything else still works — submitting a CE record
without an attached document works fine; attaching a document will fail with a clear error
until the token is configured.

## 4. Enable GitHub Pages (to actually serve the two apps)

1. In the repo: **Settings → Pages**.
2. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Staff app will be live at
   `https://<your-org>.github.io/medpro-continuing-education/staff-app/` and admin app at
   `.../admin-app/`.

Alternative: instead of its own repo, these two folders can be uploaded as subfolders of
the existing MedPro Staff Portal hub repo (the one behind `Index page/index.html`, which
already serves `patient-handouts/`, `timesheet/`, etc. as sibling folders) — either works,
this is your call. If you go that route, add a card linking to `continuing-education/` on
the hub's `index.html` (a draft card is included below in this repo's `README.md` for
convenience) and skip creating a separate repo in step 3a — commit the GitHub token/repo
Script Properties against that hub repo instead.

## 5. Add real staff, admins, and manager assignments

Once signed into the admin app:
1. **Admins** tab — add any additional admins (managers who'll be signing off records need
   an admin account here, since "manager" = an existing admin, see `CLAUDE.md`).
2. **Staff** tab — add staff with their email, an initial password, and their assigned
   Manager (picked from the Admins list). Give staff their email + initial password
   out-of-band (there's no self-service "forgot password").

## Verifying it works end-to-end

- Sign into the staff app as a test staff member, submit a CE record with a small test PDF
  attached, confirm it appears under "My Records" as **Pending Signoff** and the document
  link opens.
- Check the assigned manager's email inbox for the new-submission notification (requires
  `Email` to be set on both the Staff row and the Admins row for that manager).
- Sign into the admin app, find that record under **Records**, click **Sign Off**, confirm
  it flips to **Signed** and the staff member's email inbox gets the signed-off
  confirmation.
- On the **Report** tab (either app), run a report over a date range that includes the test
  record, confirm it shows up with the right total hours, and click **Export PDF** —
  confirm the download opens and looks right (MedPro navy header, green accent, table,
  total).

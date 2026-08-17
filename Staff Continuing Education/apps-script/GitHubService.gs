/**
 * Commits CE record attachments (certificates/documents) to the records repo
 * via the GitHub Contents API. Requires Script Properties: GITHUB_TOKEN
 * (fine-grained PAT, Contents: read/write, scoped to this repo only — see
 * SETUP.md), GITHUB_OWNER, GITHUB_REPO, and optionally GITHUB_BRANCH
 * (defaults to "main"). The token is read at runtime only — never logged,
 * never returned to the client.
 */

function githubConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var owner = props.getProperty('GITHUB_OWNER');
  var repo = props.getProperty('GITHUB_REPO');
  if (!token || !owner || !repo) {
    throw new Error('Document upload is not configured yet — set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in Script Properties.');
  }
  return {
    token: token,
    owner: owner,
    repo: repo,
    branch: props.getProperty('GITHUB_BRANCH') || 'main'
  };
}

function githubApiUrl_(cfg, path) {
  return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
}

function githubExistingSha_(cfg, path) {
  var res = UrlFetchApp.fetch(githubApiUrl_(cfg, path) + '?ref=' + cfg.branch, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    return JSON.parse(res.getContentText()).sha;
  }
  return null;
}

/**
 * Commits (creates or updates) a file at `repoPath` (e.g.
 * "records/STF-0003/REC-0012-certificate.pdf") with `base64Content`. Returns
 * a GitHub Pages URL (not raw.githubusercontent.com — that host doesn't
 * reliably serve correct Content-Type for binaries like PDFs, so browsers
 * can't render them inline).
 */
function commitFileToGitHub(repoPath, base64Content, commitMessage) {
  var cfg = githubConfig_();
  var sha = githubExistingSha_(cfg, repoPath);

  var payload = {
    message: commitMessage || ('Add ' + repoPath),
    content: base64Content,
    branch: cfg.branch
  };
  if (sha) payload.sha = sha;

  var res = UrlFetchApp.fetch(githubApiUrl_(cfg, repoPath), {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub commit failed (' + code + '): ' + res.getContentText());
  }

  return 'https://' + cfg.owner + '.github.io/' + cfg.repo + '/' + repoPath;
}

/**
 * Run this manually from the Apps Script editor (select it in the function
 * dropdown, click Run) when uploads fail with a GitHub error. Logs exactly
 * what owner/repo/branch the script is configured with, and what GitHub says
 * back for a plain repo lookup and a branch listing — a 404 on either of
 * those means the token can't see the repo (wrong repo selected on the
 * token, org approval pending, or a typo in Script Properties), not a
 * problem with any particular file. Check View > Logs (or Ctrl+Enter) after
 * running.
 */
function debugGitHubAccess() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('GITHUB_OWNER = ' + props.getProperty('GITHUB_OWNER'));
  Logger.log('GITHUB_REPO = ' + props.getProperty('GITHUB_REPO'));
  Logger.log('GITHUB_BRANCH = ' + (props.getProperty('GITHUB_BRANCH') || '(not set, defaults to main)'));
  Logger.log('GITHUB_TOKEN present = ' + !!props.getProperty('GITHUB_TOKEN'));

  var cfg = githubConfig_();
  var headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' };

  var repoRes = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo, { headers: headers, muteHttpExceptions: true });
  Logger.log('Repo lookup: ' + repoRes.getResponseCode() + ' ' + repoRes.getContentText());

  var branchRes = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/branches', { headers: headers, muteHttpExceptions: true });
  Logger.log('Branches: ' + branchRes.getResponseCode() + ' ' + branchRes.getContentText());
}

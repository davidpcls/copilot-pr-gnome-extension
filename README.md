# GitHub Review Requests GNOME Extension

Show open pull requests where you are requested for review in one GitHub organization.

## What It Shows

- Panel count: `PR: N`
- Dropdown list of up to 10 open review-requested PRs
- Click any PR to open it in your browser
- Works with `github.com` or GitHub Enterprise Server hostnames

## Requirements

- GNOME Shell 45, 46, 47, 48, 49, 50, or 51
- GitHub API token stored in extension settings (saved to login keyring via libsecret)
- Token with access to the target org and repos (private repos require appropriate scopes/permissions)

## Query Used

The extension calls GitHub Search API with org filter:

`is:open is:pr review-requested:@me org:{ORG} archived:false`

## Settings

- `Organization Slug`: required (single org)
- `GitHub Host`: `github.com` or your GHES host
- `Refresh Interval`: seconds between polls
- `GitHub API Token`: stored in login keyring

## Installation

From `github-review-requests-extension` directory:

```bash
./update
```

The script installs to:

```text
${XDG_DATA_HOME:-~/.local/share}/gnome-shell/extensions/github-review-requests@davidpcls
```

## Troubleshooting

- `Set organization slug in settings`: add org slug in preferences.
- `Set GitHub host in settings`: set host (`github.com` or GHES).
- `Set API token in settings`: token missing.
- `Invalid API token`: token rejected by API.
- `Token lacks access to org PR review requests`: token has insufficient access for org/private repos.

## License

MIT

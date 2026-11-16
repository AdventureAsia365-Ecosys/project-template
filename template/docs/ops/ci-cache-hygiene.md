# CI cache hygiene

GitHub Actions keeps at most 10 GB of caches per repository. Past that, it evicts the least recently used entries, and
a busy repo starts to lose the caches its builds need.

## What to count

- **Count only workflow caches** (the entries your workflows save with `actions/cache` or a setup action) against the
  budget you watch. Caches that a GitHub-managed feature saves for itself, such as **CodeQL default setup**, are
  evicted first by the least-recently-used rule and refill on their own; counting them makes a healthy repo look full.
- Keep each workflow cache keyed by its lock file (`hashFiles('**/requirements*.txt')`, `package-lock.json`) so a
  change makes a new entry instead of an ever-growing one.
- Save caches from the default branch only; pull request runs restore them. A cache saved by every PR run fills the
  budget with entries nobody restores.

## Check

```bash
gh cache list --limit 100 --sort size_in_bytes --order desc
```

Act when workflow caches pass about 80 % of the budget: delete stale PR caches (`gh cache delete <id>`), then look for
a key that changes on every run. Turn a repeated cause into a CI check, not a recurring clean-up.

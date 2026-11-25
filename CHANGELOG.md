# Changelog

All notable changes of the template. Written by release-please from the Conventional Commit titles merged to `main`
([`VERSIONING.md`](VERSIONING.md)).

## 1.1.0 (2026-11-25)

### Features

- Stop hook (question `stop_hook`, on by default unless the team is engineers only): an agent may not end its turn
  while the open-work file (`.tmp-session/S<nnn>-checklist.md`) lists items without a blocked marker and its last
  message asks the user nothing. It nudges once per turn; settings in `.claude/hooks/stop-open-work.json`; red-team
  tests in `test_stop_open_work.py`.
- Personal-data guard (question `pii_guard`, on by default): a PreToolUse hook on shell commands that refuses SQL
  which would print personal columns, a star or a whole row (`psql -c`, `-f` files, heredocs, Python scripts that import
  a database driver; counts and `IS NULL` tests pass). The tables and columns are listed in
  `.claude/hooks/pii-guard.json`, with a conservative default (common personal column names, star reads refused on
  every table); red-team tests in `test_pii_guard.py`. The project edits both hook settings files: its tests check
  their shape, and the render matrix checks that a fresh project's files equal the code defaults.
- API contract check (question `api_contract`, Python API projects, on by default): `api-contract.yml` exports the
  OpenAPI document of the base branch and of the PR and compares them with oasdiff (pinned, sha256 checked). A
  breaking change on a public path fails unless the PR is labelled `api-breaking` or has a `type!:` title;
  `/admin/` paths only warn. The gate script has tests with a stub, and the render matrix runs it with the real tool.
- UI smoke workflow (question `ui_smoke`, Next.js web projects, on by default): `ui-smoke.yml` runs Playwright over
  the routes of `web/e2e/smoke-routes.json` on a deployed URL (on demand, or called after a verified deploy): status
  below 400, no page or console error, the route's selector visible, a screenshot per page.
- Template CI: the render matrix has a fifth variant with the optional parts off, checks that each optional file is
  there exactly when its question is on, runs the API contract gate with a real oasdiff, and updates a project
  generated from the previous release with `copier update` (no `.rej` file, no conflict marker).

### Upgrade note

`copier update` asks the four new questions (with `--defaults` it takes the defaults). Each default adds files; answer
no to keep a part out. No new check fails on a project that passed before: the API contract check passes until a PR
changes the API in a breaking way, and the UI smoke never runs on a PR. `.claude/settings.json` is now rendered from
a template; an untouched project updates without a conflict. Fill `.claude/hooks/pii-guard.json` from the privacy
register after the update.

### Not in this release

Parts of the kit design that 1.1.0 does not ship yet (planned for a later minor release):

- Web skeleton: a UI kit of shared components.
- API skeleton: database-backed job and settings stores (in-memory stores, SQL tables and the claim query ship).
- Multi-tenant: the tenant-scoped connection pool and the fair-share job gate.
- AI features: the model gateway core (only the model-call ledger ships).
- UAT: a runnable harness (a README ships under `tools/uat/`).

## 1.0.0 (2026-11-16)

### Features

- Copier questionnaire for day 1: name and slug, repo layout, stacks, multi-tenant, AI features, cloud, tracker,
  issue and migration key prefixes, languages, team shape, default branch, license.
- Playbook pages, doc templates and generic agent skills copied from the source repo under the byte-copy guard
  (`kit-sources.txt`, `tools/kit_copies.py`).
- Agent guardrail hooks with red-team tests: subagent command and MCP write guards, generic shell-mistake guard.
- Generated CI: fast checks, API, web, Lambda and migration jobs, PR title, docs lint, gitleaks (pinned version and
  sha256), workflow lint (actionlint pinned, actions pinned by commit SHA), release-please, post-deploy verify.
- Skeletons: FastAPI API (health with commit SHA, readiness, deploy gate, settings registry with audited admin
  changes, job table and worker), SQL migration 001 (schema, roles, schema versions, settings, job table; tenancy with
  FORCE row-level security and an isolation probe; model-call ledger), Next.js 16 web (security headers, cross-site
  write guard), Lambda handler, Terraform root (tags, budget alert, GitHub OIDC deploy role, S3 state backend).
- Template CI: byte-copy guard, resource-ID lint, leak scan with an external denylist over the files and the commit
  metadata, gitleaks, render matrix that runs the generated project's checks, release-please.

### Not in this release

Parts of the kit design that 1.0.0 does not ship yet (planned for later minor releases):

- Hooks: the stop hook while unblocked work remains; the personal-data guard.
- Workflows: API contract check; UI smoke test.
- Web skeleton: a UI kit of shared components.
- API skeleton: database-backed job and settings stores (in-memory stores, SQL tables and the claim query ship).
- Multi-tenant: the tenant-scoped connection pool and the fair-share job gate.
- AI features: the model gateway core (only the model-call ledger ships).
- UAT: a runnable harness (a README ships under `tools/uat/`).

# Changelog

All notable changes of the template. Written by release-please from the Conventional Commit titles merged to `main`
([`VERSIONING.md`](VERSIONING.md)).

## 1.3.0 (2026-11-25)

### Features

- UI kit (Next.js web projects): shared components under `web/app/_kit/`, imported from `@/app/_kit`: neutral design
  tokens for light and dark (no brand; `tokens.css`), `Button` and `ButtonLink`, `Table` with server paging (the page
  reads `?page=` with `parsePage`, reads one page and the total; `pageHref` keeps the other query parameters),
  `EmptyState`, `Drawer` (Escape, overlay click, focus in and back), `ToastProvider` with `useToast` (a polite live
  region; error toasts stay until dismissed), `PageHeader`, link `Tabs` and a status `Badge`. Every component that
  renders an element passes the other HTML attributes to it, `data-testid` included (`ToastProvider` renders none of
  its own; `_kit/attributes.test.ts` checks the rest). A gallery page at `/kit` shows each component with invented
  rows, and the UI smoke route list opens it.
- Kit lint (`web/lib/kitLint.ts`, run by `npm test`): a page or app component outside the kit fails on an inline
  style, a stylesheet of its own, a class that is not a kit class, a raw `<button>`, `<table>` or `<dialog>`, or a
  page that imports nothing from the kit; a real exception carries `kit-lint: ignore <rule>` with its reason.
  `web/kit-lint-baseline.json` (empty in a fresh project) counts accepted findings per file and rule: the lint fails
  on a finding beyond them and on a count above what it finds. `npm run kit-lint` prints the findings.
- UAT harness (web projects): `tools/uat/run.ts` plays JSON scenarios (`tools/uat/scenarios/`, format and checks in
  `lib/scenario.ts`) in Playwright's Chromium against a running app: an action and at least one expectation per step
  (visible, hidden, contains, count, URL), every wait capped by the scenario's `step_timeout_ms`, page and console
  errors fail the step, a screenshot per step, an optional video (`--video`), WebVTT captions per step, the build's
  commit from `/api/health`, and a report index (`tools/uat/out/index.html`) where a failing take is listed as FAIL.
  A password or one-time code never sits in a scenario file: a `fill` or `select` reads it with `value_env` from a
  `UAT_*` environment variable (a missing one stops the run, exit 2), and a secret step's field is masked in every
  screenshot, shown as dots in the video and redacted from `result.json` and the step log; the workflow maps the
  optional repository secrets `UAT_USERNAME` and `UAT_PASSWORD`. One example scenario walks the UI kit gallery and
  checks the components' test ids. Free local tools only; narration, when used, reads the captions with
  a free local text-to-speech engine. `.github/workflows/uat.yml` runs it on a deployed URL on demand and keeps the
  takes as a run artifact.
- Generated CI: the web job runs the kit lint with the web unit tests and installs, typechecks and tests the UAT
  harness; `scripts/pre-push.sh` runs the web unit tests, the kit lint and the harness tests when node is on the
  path. Template CI: the render matrix checks the kit and the harness files against the stacks answer and runs their
  tests per variant, and a new job builds and starts the generated web app and plays the example scenario (it must
  pass, with its video, captions and index) and a scenario that must fail (exit 1, listed as FAIL).

Every part of the kit design now ships, so this release has no "Not in this release" list.

### Upgrade note

`copier update` adds `web/app/_kit/`, the gallery `web/app/kit/`, `web/lib/kitLint.ts`, the UAT harness under
`tools/uat/` and `.github/workflows/uat.yml`, and changes `web/app/layout.tsx` (imports the kit styles and the toast
provider), `web/app/page.tsx`, `web/package.json` (the `test` and `kit-lint` scripts) and the UI smoke route list.
It does not add `web/kit-lint-baseline.json`, so the kit lint of an updated project only reports its findings in the
`npm test` output and fails nothing that passed before. To turn it on, run `npm run kit-lint -- --write-baseline` in
`web/` and commit the file: today's findings are accepted, a new one fails, and the counts go down as pages move onto
the kit. Copier 9.6 or later is needed (`_min_copier_version`). The harness is a separate package: run `npm install`
and `npm run browser` in `tools/uat/` once.

## 1.2.0 (2026-11-25)

### Features

- Database-backed stores (Python API projects): `PostgresSettingsStore` (a change and its audit row commit together)
  and `PostgresJobStore` (claims with `FOR UPDATE SKIP LOCKED`, an idempotency key that adds a job once (scoped to
  the tenant in multi-tenant projects; reusing a key for another kind raises `IdempotencyConflict`), `run_after`,
  attempts, a retry delay, a finish fenced on the claim so a worker whose lease expired cannot close a job another
  worker took again, clean-up of finished jobs after `jobs.retention_days`) behind the same interfaces as the
  in-memory stores, which stay for tests. `api/app/wiring.py` picks the database stores when `DATABASE_URL` is set;
  the API opens the pool at start-up and `/health/ready` checks it. Migration `<prefix>-002` (expand) adds the job
  columns and indexes. New setting `jobs.retry_delay_seconds`.
- Multi-tenant (question `multi_tenant`): `TenantScopedPool.transaction(tenant_id)` runs each tenant query in one
  transaction with `SET LOCAL app.tenant_id` (and the app role) and refuses a missing or malformed tenant before any
  query; a fair-share job gate keeps one tenant to `jobs.max_running_per_tenant` running jobs (a setting), with
  claims serialised by an advisory lock so parallel workers cannot pass it.
- AI features (question `ai_features`): the model gateway core `api/app/gateway.py`: routing by role (routes are
  data in `model_route`, changed by an administrator at `/admin/model-routes` with the provider picked from the
  registered ones and every change audited in `model_route_audit`; read on every call), ordered fallback across
  providers, monthly spend caps (`ai.monthly_cap_usd` and one `ai.monthly_cap_usd.<provider>` per
  provider, settings) checked against the ledger before each call and fail-closed, and one ledger row per attempt
  with the billed fields. `FakeProvider` for tests; no real provider or key ships.
- Generated CI: the API job runs on a throwaway Postgres service with the migrations applied, so the integration
  tests of the stores, the tenant pool and the ledger run on every PR. Template CI: the render matrix applies every
  migration twice and runs the API integration tests per variant on a Postgres service, checks the new files against
  their questions, and updates a project generated from 1.1.0.

### Upgrade note

`copier update` adds migration `<prefix>-002`, `api/app/wiring.py` and the database tests, and changes `jobs.py`,
`settings_registry.py` and `main.py`. Nothing changes until `DATABASE_URL` is set: without it the API keeps the
in-memory stores. Apply `<prefix>-002` before deploying the new code with `DATABASE_URL`. The job store interface
gained keyword arguments with defaults, so existing callers keep working; `finish` now returns False (and writes
nothing) when the job is no longer running under the caller's claim, and `MemoryJobStore` hands out copies like the
database does (compare jobs by `id`, not identity); a retried job now waits
`jobs.retry_delay_seconds` (default 30) before its next attempt. New dependencies: `psycopg` and `psycopg-pool`
(`asyncpg` stays for projects that use it).

### Not in this release

- Web skeleton: a UI kit of shared components.
- UAT: a runnable harness (a README ships under `tools/uat/`).

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

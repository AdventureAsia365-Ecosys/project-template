# Changelog

All notable changes of the template. Written by release-please from the Conventional Commit titles merged to `main`
([`VERSIONING.md`](VERSIONING.md)).

## [1.1.0](https://github.com/AdventureAsia365-Ecosys/project-template/compare/v1.0.0...v1.1.0) (2026-11-16)


### Features

* project template with the day-1 questionnaire, kit copies, guardrails and skeletons ([de194b4](https://github.com/AdventureAsia365-Ecosys/project-template/commit/de194b4e41823ecd0ae23561fb9ff9ba44c76383))

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

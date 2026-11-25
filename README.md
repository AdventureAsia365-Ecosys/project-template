# project-template

A [Copier](https://copier.readthedocs.io/) template that starts a new software project with its whole lifecycle in
place on day 1: a nine-phase playbook with gates, doc templates, agent instructions and guardrails for a team of one
tech lead and several AI coding agents, CI with secret and leak scans, and optional skeletons for a Python API, a
Next.js web app, an AWS Lambda function, SQL migrations and a Terraform root.

The playbook is a thin profile over named standards (UK GDS phases, ISO/IEC/IEEE 12207, ISO/IEC 25010, PRINCE2
tolerances, Kanban flow, DORA, Google SRE, arc42 and C4, MADR, AGENTS.md, Twelve-Factor, OWASP ASVS and SAMM, FinOps).
Each page says what it keeps or drops.

## Generate a project

```bash
pipx install copier==9.19.1
copier copy --vcs-ref v1.1.0 gh:<org>/project-template my-project
cd my-project && less docs/day-1.md
```

Copier asks the day-1 questionnaire:

| Question | Values | Default |
|---|---|---|
| Project name and slug | text | none |
| Repo layout | single repo; root repo of several; app repo | single repo |
| Stacks | Python API, Next.js web, Lambda | Python API and Next.js web |
| Multi-tenant | yes / no (row-level security with FORCE, isolation probe; no fair-share job gate yet) | no |
| AI features | yes / no (model-call ledger, AI use and prompt registers, eval workflow; no model gateway core yet) | no |
| Cloud | AWS / none | AWS |
| Tracker | Linear / GitHub Issues / Jira | Linear |
| Issue key prefix | text | none (GH for GitHub Issues) |
| Migration key prefix | text | the issue key prefix in lowercase |
| Languages | primary, secondary (translations as `<page>.<code>.md`) | English, none |
| Team shape | tech lead plus agents; several engineers plus agents; engineers only | tech lead plus agents |
| Stop hook | yes / no (an agent may not end its turn while the open-work file lists unblocked items) | yes, unless engineers only |
| Personal-data guard | yes / no (refuses shell commands whose SQL would print personal columns or whole rows) | yes |
| API contract check | yes / no, Python API only (OpenAPI diff against the base branch; breaking fails unless labelled) | yes |
| UI smoke | yes / no, Next.js web only (Playwright over a route list on a deployed URL) | yes |
| Default branch, license | text; none / MIT / Apache 2.0 | main, none |

The answers and the template version are recorded in `.copier-answers.yml`; `copier update` pulls later template
releases into the project as a normal PR ([`VERSIONING.md`](VERSIONING.md)).

## What a generated project gets

| Path | What |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Lean agent instructions with the hard rules and the project parameters the skills read |
| `CONTEXT.md` | The architecture on the arc42 canvas with C4 views |
| `docs/playbook/` | The lifecycle: phases, gates, roles, tolerances, the agent operating model, adoption, metrics |
| `docs/templates/` | Discovery brief, charter, RAID, cost sheet, ADR, threat model, runbook, postmortem, delivery metrics report and more |
| `docs/day-1.md` | The day-1 checklist as a tracked list |
| `.claude/` | Guardrail hooks (subagents never push, merge, apply or delete; MCP writes blocked for subagents; shell-mistake refusals; optional stop hook and personal-data guard) with their red-team tests, and the generic skills |
| `.github/` | CI, PR title, docs lint, secret scan (gitleaks, pinned and checksum-verified), workflow lint, release-please, post-deploy verify, optional API contract check and UI smoke; code-health and coverage ratchets |
| `api/`, `db/`, `web/`, `lambda/`, `infra/` | Skeletons for the chosen stacks. The API's job and settings stores are in-memory; the SQL tables and the claim query are there, the database-backed stores are not |
| `tools/uat/` | A note on the UAT harness (how scenarios are laid out and recorded); no runnable harness yet |

### Not in 1.1.0

The kit design names these parts; this release does not ship them yet. Each one is planned for a later minor
release (a new optional file or check, [`VERSIONING.md`](VERSIONING.md)) and listed in [`CHANGELOG.md`](CHANGELOG.md).

- Web: a UI kit (shared components) in the web skeleton; `AGENTS.md` only names its path as a project parameter.
- API: database-backed job and settings stores (the skeleton ships in-memory stores, the SQL tables and the claim
  query).
- Multi-tenant: the tenant-scoped connection pool and the fair-share gate that keeps one tenant's jobs from
  starving the others.
- AI features: the model gateway core (one client with routing, fallback and caps); only the model-call ledger
  ships.
- UAT: a runnable harness under `tools/uat/` (today a README).

## How this repo works

- **Copies, not forks.** The docs templates, playbook pages, generic skills and hooks are copied from one source repo
  (`kit-sources.txt`). Every copy must equal the source after the kit transform (`tools/kit_transform.py`), byte for
  byte; CI checks it against the source commit recorded in `.kit-source-ref`. Change the source, then run
  `python3 tools/kit_copies.py sync --source <source checkout>`; never edit a copy.
- **No live identifiers.** CI runs the resource-ID lint, gitleaks and a leak scan with a denylist kept outside this
  repo, over the files and over the commit metadata (author, committer, message), so no account ID, resource ID,
  secret or source-project name reaches it.
- **Every change is checked by generating.** CI renders the template with the defaults and with every option on, then
  runs the generated project's own checks.

See [`CHANGELOG.md`](CHANGELOG.md) for releases and [`VERSIONING.md`](VERSIONING.md) for the release policy.

## License

[MIT](LICENSE). A generated project chooses its own license in the questionnaire.

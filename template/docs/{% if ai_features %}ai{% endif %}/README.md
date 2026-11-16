# AI features

Rules for every feature that calls a model. The playbook pages on build and test hold the reasons.

## Model calls

- Every call goes through one client and writes one row to the model-call ledger (`model_call_log`, migration 001),
  refused and failed calls included, with the billed input and output tokens and the cost. A call without a ledger
  row is a bug: cost that is not recorded cannot be traced.
- Paid runs follow the batch ladder: 3 items, then at most 50, then the rest, each step with its cost quoted first
  (`.claude/skills/project-batch-run/SKILL.md`).
- Tests never call a model: they use a fake client.

## AI use register

One row per feature that uses a model.

| Feature | Model and provider | Data sent | Human check | Owner |
|---|---|---|---|---|

## Prompt register

Prompts live in the repo, versioned; a prompt change is a PR with its eval result.

| Prompt | File | Version | Eval set | Last eval |
|---|---|---|---|---|

## Evals

`.github/workflows/eval-regression.yml` runs the eval set on every PR that changes a prompt or the model client, with
the model calls faked or recorded; a score below the recorded floor fails the PR.

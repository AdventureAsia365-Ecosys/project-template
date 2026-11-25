# AI features

Rules for every feature that calls a model. The playbook pages on build and test hold the reasons.

## Model calls

- Every call goes through one client, the gateway (`api/app/gateway.py`), and writes one row to the model-call
  ledger (`model_call_log`, migration 001), refused and failed calls included, with the billed input and output
  tokens and the cost (`billed_fields(resp)`). A call without a ledger row is a bug: cost that is not recorded cannot
  be traced.
- Code asks for a role (`gateway.generate("writer", stage, request)`), never for a provider. A role names an ordered
  list of targets (provider and model); a failed target falls back to the next one, and a `FatalProviderError` (a
  request no provider would accept) stops the chain.
- Routes are data, not code: an administrator lists and changes them at `/admin/model-routes` (the provider is
  picked from the registered ones; every change is written to `model_route_audit` with who, when, before and after).
  They live in `model_route` (migration 002); the gateway reads a role's route on every call, so a change takes
  effect at once. Register a provider in `api/app/wiring.py` (`MODEL_PROVIDERS` and `model_providers()`): it gets its
  cap setting there, and the gateway refuses to start when a registered provider has none.
- Spend caps are settings an administrator edits (`/admin/settings`): `ai.monthly_cap_usd` for all providers and
  `ai.monthly_cap_usd.<provider>` for each registered one (`MODEL_PROVIDERS` in `api/app/wiring.py` adds it to
  `ALL_SETTINGS`); a cap of 0 turns a provider off. Before each call the gateway adds the provider's estimate to the month's spend in the ledger:
  over the provider's cap it falls back to the next target, over the total cap it refuses the call. When the ledger
  cannot be read, it makes no call (fail-closed).
- A provider is a small adapter in its own module (`complete` and `estimate_cost_usd`). It reads its key from the
  secret store at run time; a key never sits in the repo, an environment file or a test.
- Paid runs follow the batch ladder: 3 items, then at most 50, then the rest, each step with its cost quoted first
  (`.claude/skills/project-batch-run/SKILL.md`).
- Tests never call a model: they use `FakeProvider` (`api/tests/test_gateway.py`).

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

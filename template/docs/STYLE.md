# Docs style

- **Language.** Pages are written in the primary language. A translation is a sibling file `<page>.<code>.md` with the
  same content; the primary page is changed first and the translation in the same PR.
- **Plain words, short sentences.** Name roles ("tech lead", "business owner", "engineer on duty"), not people.
- **One home per fact.** Link to the page that owns a fact; do not copy it.
- **No live identifiers.** No account ID, resource ID, ARN, host of a private endpoint, secret value or personal data
  (`tools/resource_id_lint.py` and gitleaks enforce it). Write the name of the thing and how to look it up.
- **Single-line cloud CLI commands** (no backslash continuations).
- **Front matter** on catalog pages: `id`, `title`, `description`, `type` (how-to, reference, explanation),
  `status`, `owner` (a role), `last_reviewed`, `review_every_days`. Templates under `templates/` show the shape.
- **Lint:** markdownlint (`.markdownlint-cli2.jsonc`) and the offline link check (`tools/check_links.py`) run in CI.

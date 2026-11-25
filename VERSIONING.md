# Versioning and release policy

| Item | Rule |
|---|---|
| Version scheme | Semantic version tags `vMAJOR.MINOR.PATCH`. Copier generates and updates from git tags |
| Patch | Wording and link fixes in templates or docs, or a pinned dependency moved to a fixed release (a security advisory, a bug); no file added, moved or removed |
| Minor | A new optional file, check or Copier question with a default that keeps today's output |
| Major (breaking) | A renamed or removed file or question, a new folder layout, or a new check that fails on a project that passed before. Ships a Copier migration (`_migrations` in `copier.yml`) and an upgrade note in the changelog |
| Release | release-please keeps a release PR open from the Conventional Commit titles merged to `main`; merging it tags the version and writes `CHANGELOG.md`. A release is cut after each change to the copied sources, because the byte-copy guard keeps CI red until the copies match |
| Reaching projects | Each project's monthly check compares the version in its `.copier-answers.yml` with the latest tag and opens an issue when it is one major or more than one minor behind. The project runs `copier update` on a branch, resolves conflicts like a merge, and ships it as a normal PR |
| Support | Only the latest major gets fixes. A major stays the latest for at least 30 days after its release note before the next major ships |

## Commit titles

`feat:` makes a minor release, `fix:` and `docs:` a patch, and `feat!:` or a `BREAKING CHANGE:` footer a major.
`chore:`, `ci:`, `test:` and `refactor:` do not release on their own.

## Updating a generated project

```bash
git switch -c chore/template-update
copier update --vcs-ref v<new version> --defaults
git diff   # resolve .rej files and conflict markers like a merge
```

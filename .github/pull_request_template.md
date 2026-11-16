## What and why

<!-- The title is a Conventional Commit title: feat (minor), fix or docs (patch), feat! (major); see VERSIONING.md. -->

## Checks

- [ ] A copied file changed only through its source and `tools/kit_copies.py sync`
- [ ] `python3 tests/render_matrix.py` green locally (or the Render matrix job)
- [ ] A breaking change has a `_migrations` entry in `copier.yml` and an upgrade note

# UAT harness

Scripted walks for business sign-off recordings (`.claude/skills/project-uat/SKILL.md`, report template
`docs/templates/uat-report.md`). One scenario per file under `scenarios/`, played in Chromium by Playwright, with an
assertion on every step: a failed assertion fails the take, the steps after it are skipped, and a failing take is never
published as a pass.

```text
tools/uat/
  run.ts                          the runner (npm run uat)
  lib/scenario.ts                 the scenario file format, checked before the browser starts
  lib/report.ts                   take results, captions and the report index
  scenarios/<nn>-<slug>.json      one scenario: a title, a viewport, a step timeout and the steps
  out/                            takes (git-ignored)
    <yyyymmdd-hhmmss>-<scenario>/ one take: result.json, captions.vtt, a screenshot per step, video.webm (--video)
    index.html                    every take with its verdict, build and links
```

## Run

```bash
cd tools/uat
npm install
npm run browser                     # once: Playwright's Chromium (free, local)
npm test                            # the format and report tests (no browser)
npm run uat -- --base-url http://127.0.0.1:3000 --scenario 01-kit-gallery --video
```

Start the web app first (`cd web && npm run build && npm start`), or point `--base-url` at a deployed preview. The
runner reads the build's commit from `<base-url>/api/health` into each take. Without `--scenario` it plays every file
in `scenarios/`. Exit code 0 means every take passed, 1 a failing take, 2 a bad scenario file or argument. On GitHub,
the `UAT` workflow runs the same command on a deployed URL and keeps the `out/` folder as a run artifact.

## Write a scenario

Copy `scenarios/01-kit-gallery.json` (a walk through the web app's UI kit gallery). Each step has a caption (what the
user does and should see, in the reader's language), an optional action and at least one expectation:

| Part | Forms |
|---|---|
| Target | `{"role": "button", "name": "Save"}`, `{"text": "..."}`, `{"label": "Email"}`, `{"testId": "..."}`, `{"css": "..."}` |
| Action | `goto` (a path on the same host), `click`, `fill` + `value` or `value_env`, `press` + `key`, `select` + `value` or `value_env`, `check` |
| Expectation | `visible`, `hidden`, `contains` + `in`, `count` + `of`, `url_contains` |

Prefer role and name targets: they survive layout changes. `step_timeout_ms` is the ceiling of every wait in a step,
so a missing element fails the step instead of hanging. A page or console error fails the step unless the scenario sets
`allow_console_errors`. `step_hold_ms` (optional) keeps each passed step on screen a little longer, so a recording
can be followed; the captions run from one step's start to the next; `color_scheme` (`light` or `dark`) picks the
theme the browser asks for. A screenshot shows the viewport, as the video does. Pick rows by a condition the walk needs (an
open slot, a draft item), not the first row of a list that old test data may hold. Use invented data only, never a
real customer's.

## Sign-in and other secrets

A password, a one-time code or any other secret is never a literal in a scenario file (the repo may be public). A
`fill` or `select` reads it from the environment instead: `{"fill": {"label": "Password"}, "value_env": "UAT_PASSWORD"}`
(names start with `UAT_`). Locally, set the variable in the shell for the one run; on GitHub, store it as a repository
secret (`UAT_USERNAME` and `UAT_PASSWORD` are mapped in `.github/workflows/uat.yml`; add another name there). A
variable that is unset or empty stops the run before the browser starts (exit 2). A `value_env` step is secret, and
`"secret": true` makes any other fill or select secret (a one-time code typed into a plain field). For a secret step
the runner:

- masks the field in that step's screenshot and every screenshot after it;
- shows the field's characters as dots before typing, so the video never shows them;
- replaces the value with `[secret]` in errors and console messages it keeps (`result.json`, the step log, the index).

A secret `select` shows its chosen option, so a scenario with one refuses `--video`. The runner cannot hide a secret
that the page itself prints elsewhere (a "your code is 123456" banner): keep such a page out of a recorded walk.

## Recording rules

Record only when the business owner signs off a feature, a pilot customer is onboarded, or for a drill; routine
changes get screenshots in the PR instead. Sign in with a test account, never a real person's account, through
`value_env` steps (above). Narration,
when used, is read from the take's `captions.vtt` by a free text-to-speech engine that runs locally (open source); no
paid voice service. Package each take folder with its `result.json` and list it in the UAT report.

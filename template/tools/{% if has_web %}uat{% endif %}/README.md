# UAT harness

Scripts for business sign-off recordings (`.claude/skills/project-uat/SKILL.md`, report template
`docs/templates/uat-report.md`). One scenario per file under `scenarios/`, driven by an automated browser
(Playwright), with an assertion on every step: a failed assertion fails the take, and a failing take is never
published as a pass.

```text
tools/uat/
  scenarios/<nn>-<slug>.spec.ts   one scenario, steps with assertions and captions
  out/                            takes (git-ignored): video, captions, the step log
```

Record only when the business owner signs off a feature, a pilot customer is onboarded, or for a drill; routine
changes get screenshots in the PR instead. Sign in with a test account, never a real person's account. Narration,
when used, comes from a free local text-to-speech engine.

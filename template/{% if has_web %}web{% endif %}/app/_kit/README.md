# UI kit

The shared components every page builds from: one design system, no one-off styles per page. The gallery at `/kit`
(`app/kit/page.tsx`) shows each component with invented data, in the system's light or dark theme.

| Component | Use |
|---|---|
| `tokens.css` | Design tokens: neutral colours for light and dark, type, spacing, radius. A brand is one edit here |
| `kit.css` | Component styles and the layout classes pages may use: `kit-page`, `kit-stack`, `kit-row`, `kit-section`, `kit-muted` |
| `Button`, `ButtonLink` | An action; a navigation that looks like a button. Variants primary, secondary, ghost, danger |
| `Table` | Rows with server paging: the page reads `?page=` with `parsePage`, reads one page and the total, passes both |
| `EmptyState` | What a list or panel shows when it has nothing yet |
| `Drawer` | A side panel for a detail or a short form, without leaving the list |
| `ToastProvider`, `useToast` | Short confirmations and errors after an action (the provider is in `app/layout.tsx`) |
| `PageHeader` | The page's one heading, description and actions |
| `Tabs` | Tabs as links, so the open tab is in the URL |
| `Badge` | A status label with a tone (neutral, info, success, warning, danger) |

Pages import from `@/app/_kit`. `lib/kitLint.ts` runs in `npm test` and fails on an inline style, a stylesheet of a
page's own, a class outside the kit, a raw `<button>`, `<table>` or `<dialog>`, or a page that imports nothing from
the kit. A real exception carries the comment `kit-lint: ignore <rule>` with its reason on the same line.

`kit-lint-baseline.json` (next to `package.json`) lists findings a project accepted when it adopted the kit, counted
per file and rule; it is empty in a fresh project. The lint fails on a finding beyond those counts and on a count
above what it finds, so the list only shrinks. A project updated from a template release before the kit has no
baseline file: its lint only reports (in the `npm test` output) until `npm run kit-lint -- --write-baseline` writes
one. `npm run kit-lint` prints the findings on their own.

A component the pages need and the kit lacks is added here, with its gallery entry, in its own PR. Every component
that renders an element passes the other HTML attributes to it (a `data-testid` included), so tests can target them;
`ToastProvider` renders none of its own. `_kit/attributes.test.ts` checks this for every component.

// Kit lint: pages and app components build from the UI kit (app/_kit), not from ad-hoc styles. Run by
// kitLint.test.ts (npm test), so CI and the pre-push hook fail on a finding. Rules, for every .ts / .tsx / .css file
// under app/ and components/ outside app/_kit/:
//   inline-style    a style={...} attribute;
//   stylesheet      a stylesheet file, or an import of one other than the kit's own (app/_kit/kit.css);
//   raw-element     a raw <button>, <table> or <dialog> (use Button, Table, Drawer);
//   class           a className literal with a class that is not a kit class (kit-...);
//   page-import     a page.tsx that imports nothing from the kit.
// A line that must break a rule carries the comment "kit-lint: ignore <rule>" with the reason next to it.
//
// Baseline (kit-lint-baseline.json next to package.json): the findings a project accepted when it adopted the kit,
// counted per file and rule. A fresh project starts with an empty one, so every finding fails. npm test fails on a
// finding beyond these counts and on a count above what is found (the list only shrinks). A project updated from a
// template release before the kit has no baseline file (Copier creates it on a fresh copy only): the lint then only
// reports its findings, and `npm run kit-lint -- --write-baseline` writes the file and turns enforcement on.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type KitFinding = { file: string; line: number; rule: string; message: string };

const KIT_DIR = "app/_kit/";
const SCANNED_ROOTS = ["app", "components"];
const SOURCE = /\.(tsx?|css|scss|sass|less)$/;
const STYLESHEET = /\.(css|scss|sass|less)$/;
const KIT_IMPORT = /from\s+["'](?:@\/app\/_kit|(?:\.\.?\/)+(?:app\/)?_kit)(?:\/[A-Za-z]+)?["']/;

function ignored(line: string, rule: string): boolean {
  return new RegExp(`kit-lint: ignore ${rule}\\b`).test(line);
}

function lineRules(file: string, line: string, n: number): KitFinding[] {
  const out: KitFinding[] = [];
  const add = (rule: string, message: string) => {
    if (!ignored(line, rule)) out.push({ file, line: n, rule, message });
  };
  if (/\bstyle=\{/.test(line)) add("inline-style", "inline style: use a kit component or a kit layout class");
  const css = line.match(/^\s*import\s+(?:[^"']*from\s+)?["']([^"']+\.(?:css|scss|sass|less))["']/);
  if (css && !css[1].includes("_kit/")) add("stylesheet", `stylesheet import ${css[1]}: styles live in app/_kit/kit.css`);
  const raw = line.match(/<(button|table|dialog)[\s>]/);
  if (raw) add("raw-element", `raw <${raw[1]}>: use the kit's ${{ button: "Button", table: "Table", dialog: "Drawer" }[raw[1]]}`);
  for (const m of line.matchAll(/className=(?:"([^"]*)"|\{\s*["'`]([^"'`]*)["'`]\s*\})/g)) {
    const bad = (m[1] ?? m[2]).split(/\s+/).filter((c) => c && !c.startsWith("kit-"));
    if (bad.length) add("class", `class ${bad.join(" ")} is not a kit class: use a kit component or kit-* layout class`);
  }
  return out;
}

/** The findings of one file; `file` is its path relative to the web root, with forward slashes. */
export function lintSource(file: string, text: string): KitFinding[] {
  if (file.startsWith(KIT_DIR)) return [];
  if (STYLESHEET.test(file)) {
    return [{ file, line: 1, rule: "stylesheet", message: "a stylesheet outside the kit: styles live in app/_kit/kit.css" }];
  }
  const lines = text.split("\n");
  const out = lines.flatMap((line, i) => lineRules(file, line, i + 1));
  if (path.basename(file) === "page.tsx" && !KIT_IMPORT.test(text) && !/kit-lint: ignore page-import\b/.test(text)) {
    out.push({ file, line: 1, rule: "page-import", message: "a page that imports nothing from the kit (@/app/_kit)" });
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
}

/** Every finding under the web root's app/ and components/ folders. */
export function lintTree(webRoot: string): KitFinding[] {
  const files: string[] = [];
  for (const root of SCANNED_ROOTS) {
    const dir = path.join(webRoot, root);
    try {
      if (statSync(dir).isDirectory()) walk(dir, files);
    } catch {
      // the folder does not exist yet
    }
  }
  return files.flatMap((f) => lintSource(path.relative(webRoot, f).split(path.sep).join("/"), readFileSync(f, "utf8")));
}

export function formatFindings(findings: KitFinding[]): string {
  return findings.map((f) => `${f.file}:${f.line}: ${f.rule}: ${f.message}`).join("\n");
}

/** Accepted findings: file -> rule -> count. */
export type KitBaseline = Record<string, Record<string, number>>;

export const BASELINE_FILE = "kit-lint-baseline.json";

const BASELINE_COMMENT =
  "Kit lint baseline (lib/kitLint.ts): findings accepted when the project adopted the kit, counted per file and rule. " +
  "npm test fails on a finding beyond these counts and on a count above what is found, so the list only shrinks. " +
  "A fresh project starts empty. Rewrite: npm run kit-lint -- --write-baseline";

export function countFindings(findings: KitFinding[]): KitBaseline {
  const out: KitBaseline = {};
  for (const f of findings) {
    out[f.file] ??= {};
    out[f.file][f.rule] = (out[f.file][f.rule] ?? 0) + 1;
  }
  return out;
}

/** The project's baseline, or null when the file is missing (report-only mode). A malformed file throws. */
export function readBaseline(webRoot: string): KitBaseline | null {
  const file = path.join(webRoot, BASELINE_FILE);
  if (!existsSync(file)) return null;
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  const accepted = (raw as { accepted?: unknown } | null)?.accepted;
  const fail = () => {
    throw new Error(`${BASELINE_FILE}: "accepted" maps a file to { rule: count } with whole counts above 0`);
  };
  if (typeof accepted !== "object" || accepted === null || Array.isArray(accepted)) fail();
  for (const rules of Object.values(accepted as object)) {
    if (typeof rules !== "object" || rules === null || Array.isArray(rules)) fail();
    for (const n of Object.values(rules as object)) if (!Number.isInteger(n) || (n as number) < 1) fail();
  }
  return accepted as KitBaseline;
}

export function baselineJson(findings: KitFinding[]): string {
  const counts = countFindings(findings);
  const accepted: KitBaseline = {};
  for (const file of Object.keys(counts).sort()) {
    accepted[file] = {};
    for (const rule of Object.keys(counts[file]).sort()) accepted[file][rule] = counts[file][rule];
  }
  return JSON.stringify({ _comment: BASELINE_COMMENT, accepted }, null, 2) + "\n";
}

export function writeBaseline(webRoot: string, findings: KitFinding[]): string {
  const file = path.join(webRoot, BASELINE_FILE);
  writeFileSync(file, baselineJson(findings));
  return file;
}

/** What fails against the baseline: findings beyond an accepted count (all of that file and rule are listed, since
 * the new one cannot be told apart), and accepted counts above what is found (lower them). Empty when it passes. */
export function compareToBaseline(findings: KitFinding[], baseline: KitBaseline): string[] {
  const counts = countFindings(findings);
  const problems: string[] = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, found] of Object.entries(rules)) {
      const accepted = baseline[file]?.[rule] ?? 0;
      if (found > accepted) {
        problems.push(`${file}: ${rule}: ${found} found, the baseline accepts ${accepted}:`);
        problems.push(...findings.filter((f) => f.file === file && f.rule === rule).map((f) => `  ${formatFindings([f])}`));
      }
    }
  }
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, accepted] of Object.entries(rules)) {
      const found = counts[file]?.[rule] ?? 0;
      if (found < accepted) {
        problems.push(`${file}: ${rule}: the baseline accepts ${accepted}, ${found} found: lower it in ${BASELINE_FILE}`);
      }
    }
  }
  return problems;
}

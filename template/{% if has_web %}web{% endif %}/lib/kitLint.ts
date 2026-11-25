// Kit lint: pages and app components build from the UI kit (app/_kit), not from ad-hoc styles. Run by
// kitLint.test.ts (npm test), so CI and the pre-push hook fail on a finding. Rules, for every .ts / .tsx / .css file
// under app/ and components/ outside app/_kit/:
//   inline-style    a style={...} attribute;
//   stylesheet      a stylesheet file, or an import of one other than the kit's own (app/_kit/kit.css);
//   raw-element     a raw <button>, <table> or <dialog> (use Button, Table, Drawer);
//   class           a className literal with a class that is not a kit class (kit-...);
//   page-import     a page.tsx that imports nothing from the kit.
// A line that must break a rule carries the comment "kit-lint: ignore <rule>" with the reason next to it.
import { readdirSync, readFileSync, statSync } from "node:fs";
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

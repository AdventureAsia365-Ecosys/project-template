// node --test --experimental-strip-types lib/*.test.ts (npm test). Invented file names.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  baselineJson,
  compareToBaseline,
  formatFindings,
  lintSource,
  lintTree,
  readBaseline,
  type KitFinding,
} from "./kitLint.ts";

const rules = (file: string, text: string) => lintSource(file, text).map((f) => f.rule);

test("the app builds from the kit (whole tree, against kit-lint-baseline.json)", (t) => {
  const webRoot = fileURLToPath(new URL("..", import.meta.url));
  const findings = lintTree(webRoot);
  const baseline = readBaseline(webRoot);
  if (baseline === null) {
    // A project updated from a template release before the kit: report only, until it writes its baseline.
    t.diagnostic(`kit lint: report only (no kit-lint-baseline.json): ${findings.length} finding(s)`);
    if (findings.length) t.diagnostic(formatFindings(findings));
    t.diagnostic("npm run kit-lint -- --write-baseline accepts today's findings and fails on any new one");
    return;
  }
  assert.equal(compareToBaseline(findings, baseline).join("\n"), "");
});

test("a page that uses the kit passes", () => {
  const page = [
    'import { PageHeader, Table } from "@/app/_kit";',
    "export default function Orders() {",
    '  return <main className="kit-page"><PageHeader title="Orders" /></main>;',
    "}",
  ].join("\n");
  assert.deepEqual(rules("app/orders/page.tsx", page), []);
  assert.deepEqual(rules("app/orders/page.tsx", 'import { Badge } from "../_kit";\nexport default () => null;'), []);
});

test("each rule finds its case", () => {
  assert.deepEqual(rules("app/a/page.tsx", 'import { Badge } from "@/app/_kit";\n<div style={{ color: "red" }} />'), ["inline-style"]);
  assert.deepEqual(rules("app/a/Widget.tsx", 'import "./widget.css";'), ["stylesheet"]);
  assert.deepEqual(rules("app/a/Widget.tsx", 'import styles from "./widget.module.css";'), ["stylesheet"]);
  assert.deepEqual(rules("app/a/widget.css", ".x { color: red }"), ["stylesheet"]);
  assert.deepEqual(rules("app/a/Widget.tsx", "<button onClick={go}>Go</button>\n<table>\n<dialog open>"), [
    "raw-element",
    "raw-element",
    "raw-element",
  ]);
  assert.deepEqual(rules("app/a/Widget.tsx", '<div className="kit-row flex gap-2" />'), ["class"]);
  assert.deepEqual(rules("app/a/Widget.tsx", "<div className={'card'} />"), ["class"]);
  assert.deepEqual(rules("app/a/page.tsx", "export default function A() { return null; }"), ["page-import"]);
});

test("the kit itself, tests and an explained exception are not findings", () => {
  assert.deepEqual(rules("app/_kit/Button.tsx", '<button style={{ x: 1 }} className="other" />'), []);
  assert.deepEqual(rules("app/_kit/kit.css", ".kit-button {}"), []);
  assert.deepEqual(rules("app/layout.tsx", 'import "./_kit/kit.css";'), []);
  const line = '<iframe style={{ border: 0 }} /> {/* kit-lint: ignore inline-style (third-party embed size) */}';
  assert.deepEqual(rules("app/a/Embed.tsx", line), []);
});

const finding = (file: string, rule: string, line = 1): KitFinding => ({ file, line, rule, message: "invented" });

test("the baseline accepts counted findings and fails on a new one or a stale count", () => {
  const today = [finding("app/a/page.tsx", "inline-style", 3), finding("app/a/page.tsx", "inline-style", 9), finding("app/b/Card.tsx", "class")];
  const baseline = JSON.parse(baselineJson(today)).accepted;
  assert.deepEqual(baseline, { "app/a/page.tsx": { "inline-style": 2 }, "app/b/Card.tsx": { class: 1 } });
  assert.deepEqual(compareToBaseline(today, baseline), []);
  // a third inline style in the same file, and a rule the file did not break before
  const more = [...today, finding("app/a/page.tsx", "inline-style", 12), finding("app/a/page.tsx", "raw-element", 4)];
  const problems = compareToBaseline(more, baseline);
  assert.ok(problems.some((p) => p.startsWith("app/a/page.tsx: inline-style: 3 found, the baseline accepts 2")), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("app/a/page.tsx: raw-element: 1 found, the baseline accepts 0")), problems.join("\n"));
  // a fixed finding lowers the count: the baseline only shrinks
  const fixed = compareToBaseline(today.slice(1), baseline);
  assert.deepEqual(fixed, ["app/a/page.tsx: inline-style: the baseline accepts 2, 1 found: lower it in kit-lint-baseline.json"]);
  // an empty baseline (a fresh project) fails on every finding
  assert.equal(compareToBaseline(today, {}).filter((p) => !p.startsWith("  ")).length, 2);
});

test("a missing baseline file is report-only; a malformed one fails", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kit-lint-"));
  try {
    assert.equal(readBaseline(dir), null);
    writeFileSync(path.join(dir, "kit-lint-baseline.json"), baselineJson([]));
    assert.deepEqual(readBaseline(dir), {});
    writeFileSync(path.join(dir, "kit-lint-baseline.json"), JSON.stringify({ accepted: { "app/x.tsx": { class: 0 } } }));
    assert.throws(() => readBaseline(dir), /whole counts above 0/);
    writeFileSync(path.join(dir, "kit-lint-baseline.json"), JSON.stringify({ accepted: [] }));
    assert.throws(() => readBaseline(dir), /"accepted" maps a file/);
    mkdirSync(path.join(dir, "app", "orders"), { recursive: true });
    writeFileSync(path.join(dir, "app", "orders", "page.tsx"), "export default () => <div style={{ margin: 4 }} />;");
    assert.deepEqual(lintTree(dir).map((f) => f.rule), ["inline-style", "page-import"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// node --test --experimental-strip-types lib/*.test.ts (npm test). Invented file names.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatFindings, lintSource, lintTree } from "./kitLint.ts";

const rules = (file: string, text: string) => lintSource(file, text).map((f) => f.rule);

test("the app builds from the kit (whole tree)", () => {
  const findings = lintTree(fileURLToPath(new URL("..", import.meta.url)));
  assert.equal(formatFindings(findings), "");
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

// node --test --experimental-strip-types app/_kit/*.test.ts (npm test). Every kit component that renders an element of
// its own passes the other HTML attributes through (data-testid included), so a test or a UAT step can target it.
// TypeScript accepts any hyphenated JSX attribute, so a component that drops them still compiles: this reads each
// component's source instead (no install needed). The UAT example scenario checks the same test ids in a browser.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Components that render no element of their own to put an attribute on.
const NO_ROOT = new Set(["ToastProvider"]);

type Component = { file: string; name: string; body: string };

/** The props take "...rest" and the markup spreads {...rest}. */
function passesThrough(body: string): boolean {
  const signature = body.split(") {")[0];
  return /\.\.\.rest\b/.test(signature) && /\{\.\.\.rest\}/.test(body);
}

function components(): Component[] {
  const dir = new URL("./", import.meta.url);
  const out: Component[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx")).sort()) {
    const text = readFileSync(new URL(file, dir), "utf8");
    const starts = [...text.matchAll(/^export function ([A-Z][A-Za-z]*)\b/gm)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
      out.push({ file, name: m[1], body: text.slice(m.index, end) });
    });
  }
  return out;
}

test("the kit has components to check", () => {
  const names = components().map((c) => c.name);
  for (const expected of ["Badge", "Button", "ButtonLink", "Drawer", "EmptyState", "PageHeader", "Table", "Tabs"]) {
    assert.ok(names.includes(expected), `${expected} not found in app/_kit/*.tsx`);
  }
});

test("every component passes the other HTML attributes to its element", () => {
  const missing = components()
    .filter((c) => !NO_ROOT.has(c.name))
    .filter((c) => !passesThrough(c.body))
    .map((c) => `${c.file}: ${c.name} needs "...rest" in its props, spread as {...rest} on its root element`);
  assert.deepEqual(missing, []);
});

test("a component that drops its attributes is caught", () => {
  const body = 'export function Widget({ title }: { title: string }) {\n  return <div className="kit-x">{title}</div>;\n}';
  assert.equal(passesThrough(body), false);
  assert.equal(passesThrough(body.replace("{ title }", "{ title, ...rest }")), false); // taken but not spread
  assert.equal(passesThrough(body.replace("{ title }", "{ title, ...rest }").replace("<div ", "<div {...rest} ")), true);
});

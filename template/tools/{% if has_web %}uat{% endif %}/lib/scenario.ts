// The UAT scenario file format (scenarios/<nn>-<slug>.json), checked before a browser opens: a bad row fails with its
// path ("steps[2].expect[0]: ...") instead of a confusing browser error. Pure code, tested by scenario.test.ts.
//
// {
//   "title": "What the business owner signs off",
//   "viewport": { "width": 1280, "height": 800 },
//   "step_timeout_ms": 10000,                 // the ceiling of every wait in a step (each wait has its own)
//   "allow_console_errors": false,            // optional; a page or console error fails the step by default
//   "steps": [
//     { "caption": "What the user does and should see",
//       "action": { "goto": "/path" },        // optional; one of goto, click, fill, press, select, check
//       "expect": [ { "visible": { "role": "heading", "name": "Orders" } } ] }   // at least one per step
//   ]
// }
// Targets: { "role": <ARIA role>, "name"?: <accessible name>, "exact"?: bool } | { "text": ... } | { "label": ... }
//          | { "testId": ... } | { "css": ... }. Prefer role and name: they survive layout changes.
// Actions: { "goto": "/path" } | { "click": T } | { "fill": T, "value": "..." } | { "press": T, "key": "Enter" }
//          | { "select": T, "value": "..." } | { "check": T }.
// Expectations: { "visible": T } | { "hidden": T } | { "contains": "...", "in": T } | { "count": n, "of": T }
//          | { "url_contains": "..." }.

export type Target =
  | { role: string; name?: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { label: string }
  | { testId: string }
  | { css: string };

export type Action =
  | { kind: "goto"; path: string }
  | { kind: "click"; target: Target }
  | { kind: "fill"; target: Target; value: string }
  | { kind: "press"; target: Target; key: string }
  | { kind: "select"; target: Target; value: string }
  | { kind: "check"; target: Target };

export type Expectation =
  | { kind: "visible"; target: Target }
  | { kind: "hidden"; target: Target }
  | { kind: "contains"; target: Target; text: string }
  | { kind: "count"; target: Target; equals: number }
  | { kind: "url_contains"; text: string };

export type Step = { caption: string; action?: Action; expect: Expectation[] };

export type Scenario = {
  title: string;
  viewport: { width: number; height: number };
  stepTimeoutMs: number;
  allowConsoleErrors: boolean;
  steps: Step[];
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function text(v: unknown, where: string): string {
  if (typeof v !== "string" || !v.trim()) fail(where, "needs a non-empty string");
  return v;
}

function whole(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    fail(where, `needs a whole number from ${min} to ${max}`);
  }
  return v;
}

function onlyKeys(o: Obj, allowed: string[], where: string): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k) && k !== "_comment");
  if (extra.length) fail(where, `unknown key(s) ${extra.join(", ")}; allowed: ${allowed.join(", ")}`);
}

export function parseTarget(v: unknown, where: string): Target {
  if (!isObj(v)) fail(where, "a target is an object (role, text, label, testId or css)");
  const kinds = ["role", "text", "label", "testId", "css"].filter((k) => k in v);
  if (kinds.length !== 1) fail(where, "a target names exactly one of role, text, label, testId, css");
  const kind = kinds[0];
  if (kind === "role") {
    onlyKeys(v, ["role", "name", "exact"], where);
    const role = text(v.role, `${where}.role`);
    if (!/^[a-z]+$/.test(role)) fail(`${where}.role`, `not an ARIA role name: ${role}`);
    const t: Target = { role };
    if (v.name !== undefined) t.name = text(v.name, `${where}.name`);
    if (v.exact !== undefined) {
      if (typeof v.exact !== "boolean") fail(`${where}.exact`, "needs true or false");
      t.exact = v.exact;
    }
    return t;
  }
  if (kind === "text") {
    onlyKeys(v, ["text", "exact"], where);
    if (v.exact !== undefined && typeof v.exact !== "boolean") fail(`${where}.exact`, "needs true or false");
    return v.exact === undefined ? { text: text(v.text, `${where}.text`) } : { text: text(v.text, `${where}.text`), exact: v.exact as boolean };
  }
  onlyKeys(v, [kind], where);
  const value = text(v[kind], `${where}.${kind}`);
  if (kind === "label") return { label: value };
  if (kind === "testId") return { testId: value };
  return { css: value };
}

export function parsePath(v: unknown, where: string): string {
  const p = text(v, where);
  if (!p.startsWith("/") || p.startsWith("//")) fail(where, `a path on the same host starts with a single "/": ${p}`);
  return p;
}

const ACTIONS = ["goto", "click", "fill", "press", "select", "check"] as const;

export function parseAction(v: unknown, where: string): Action {
  if (!isObj(v)) fail(where, `an action is an object with one of ${ACTIONS.join(", ")}`);
  const kinds = ACTIONS.filter((k) => k in v);
  if (kinds.length !== 1) fail(where, `an action names exactly one of ${ACTIONS.join(", ")}`);
  const kind = kinds[0];
  switch (kind) {
    case "goto":
      onlyKeys(v, ["goto"], where);
      return { kind, path: parsePath(v.goto, `${where}.goto`) };
    case "fill":
    case "select":
      onlyKeys(v, [kind, "value"], where);
      if (typeof v.value !== "string") fail(`${where}.value`, "needs a string");
      return { kind, target: parseTarget(v[kind], `${where}.${kind}`), value: v.value };
    case "press":
      onlyKeys(v, ["press", "key"], where);
      return { kind, target: parseTarget(v.press, `${where}.press`), key: text(v.key, `${where}.key`) };
    default:
      onlyKeys(v, [kind], where);
      return { kind, target: parseTarget(v[kind], `${where}.${kind}`) };
  }
}

export function parseExpectation(v: unknown, where: string): Expectation {
  if (!isObj(v)) fail(where, "an expectation is an object");
  if ("visible" in v || "hidden" in v) {
    const kind = "visible" in v ? "visible" : "hidden";
    onlyKeys(v, [kind], where);
    return { kind, target: parseTarget(v[kind], `${where}.${kind}`) };
  }
  if ("contains" in v) {
    onlyKeys(v, ["contains", "in"], where);
    return { kind: "contains", text: text(v.contains, `${where}.contains`), target: parseTarget(v.in, `${where}.in`) };
  }
  if ("count" in v) {
    onlyKeys(v, ["count", "of"], where);
    return { kind: "count", equals: whole(v.count, 0, 100000, `${where}.count`), target: parseTarget(v.of, `${where}.of`) };
  }
  if ("url_contains" in v) {
    onlyKeys(v, ["url_contains"], where);
    return { kind: "url_contains", text: text(v.url_contains, `${where}.url_contains`) };
  }
  fail(where, "an expectation is one of visible, hidden, contains + in, count + of, url_contains");
}

function parseStep(v: unknown, where: string): Step {
  if (!isObj(v)) fail(where, "a step is an object");
  onlyKeys(v, ["caption", "action", "expect"], where);
  const step: Step = { caption: text(v.caption, `${where}.caption`), expect: [] };
  if (v.action !== undefined) step.action = parseAction(v.action, `${where}.action`);
  if (!Array.isArray(v.expect) || v.expect.length === 0) {
    fail(`${where}.expect`, "every step needs at least one expectation (a failed one fails the take)");
  }
  step.expect = v.expect.map((e, i) => parseExpectation(e, `${where}.expect[${i}]`));
  return step;
}

export function parseScenario(raw: unknown): Scenario {
  if (!isObj(raw)) fail("scenario", "the file holds one JSON object");
  onlyKeys(raw, ["title", "viewport", "step_timeout_ms", "allow_console_errors", "steps"], "scenario");
  const title = text(raw.title, "title");
  if (!isObj(raw.viewport)) fail("viewport", "needs { width, height }");
  onlyKeys(raw.viewport, ["width", "height"], "viewport");
  const viewport = {
    width: whole(raw.viewport.width, 320, 3840, "viewport.width"),
    height: whole(raw.viewport.height, 320, 2160, "viewport.height"),
  };
  const stepTimeoutMs = whole(raw.step_timeout_ms, 1000, 300000, "step_timeout_ms");
  if (raw.allow_console_errors !== undefined && typeof raw.allow_console_errors !== "boolean") {
    fail("allow_console_errors", "needs true or false");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) fail("steps", "needs a non-empty list");
  const steps = raw.steps.map((s, i) => parseStep(s, `steps[${i}]`));
  if (steps[0].action?.kind !== "goto") fail("steps[0].action", "the first step opens a page (goto)");
  return { title, viewport, stepTimeoutMs, allowConsoleErrors: raw.allow_console_errors === true, steps };
}

/** "role button named Save", for step logs and failure messages. */
export function describeTarget(t: Target): string {
  if ("role" in t) return `role ${t.role}${t.name ? ` named "${t.name}"` : ""}`;
  if ("text" in t) return `text "${t.text}"`;
  if ("label" in t) return `label "${t.label}"`;
  if ("testId" in t) return `test id "${t.testId}"`;
  return `css ${t.css}`;
}

/** The base URL the runner opens: http(s), no path beyond "/", no query. */
export function parseBaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error("--base-url is required (the web app to test, for example http://127.0.0.1:3000)");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`--base-url is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("--base-url must be http or https");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("--base-url is the site root only (no path, query or fragment)");
  }
  return url.origin;
}

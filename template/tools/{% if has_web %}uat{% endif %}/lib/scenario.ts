// The UAT scenario file format (scenarios/<nn>-<slug>.json), checked before a browser opens: a bad row fails with its
// path ("steps[2].expect[0]: ...") instead of a confusing browser error. Pure code, tested by scenario.test.ts.
//
// {
//   "title": "What the business owner signs off",
//   "viewport": { "width": 1280, "height": 800 },
//   "step_timeout_ms": 10000,                 // the ceiling of every wait in a step (each wait has its own)
//   "allow_console_errors": false,            // optional; a page or console error fails the step by default
//   "step_hold_ms": 1500,                     // optional (default 0): time each step stays on screen in a recording
//   "color_scheme": "dark",                   // optional (default light): the theme the browser asks for
//   "steps": [
//     { "caption": "What the user does and should see",
//       "action": { "goto": "/path" },        // optional; one of goto, click, fill, press, select, check
//       "expect": [ { "visible": { "role": "heading", "name": "Orders" } } ],  // at least one per step
//       "secret": true }                     // optional: mask the action's field (automatic with value_env)
//   ]
// }
// Targets: { "role": <ARIA role>, "name"?: <accessible name>, "exact"?: bool } | { "text": ... } | { "label": ... }
//          | { "testId": ... } | { "css": ... }. Prefer role and name: they survive layout changes.
// Actions: { "goto": "/path" } | { "click": T } | { "fill": T, "value": "..." } | { "press": T, "key": "Enter" }
//          | { "select": T, "value": "..." } | { "check": T }.
// Secrets (a test account's password, a one-time code): never a literal in the committed file. A fill or select takes
// { "value_env": "UAT_<NAME>" } instead of "value": the runner reads it from the environment (a missing variable is a
// bad run, exit 2), masks the field in every screenshot, shows its characters as dots in the video, and keeps the value
// out of result.json, the captions and the step log.
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
  | { kind: "fill"; target: Target; value?: string; valueEnv?: string }
  | { kind: "press"; target: Target; key: string }
  | { kind: "select"; target: Target; value?: string; valueEnv?: string }
  | { kind: "check"; target: Target };

export type Expectation =
  | { kind: "visible"; target: Target }
  | { kind: "hidden"; target: Target }
  | { kind: "contains"; target: Target; text: string }
  | { kind: "count"; target: Target; equals: number }
  | { kind: "url_contains"; text: string };

/** `secret`: the action's field is masked in screenshots and its value redacted (set by value_env or "secret": true). */
export type Step = { caption: string; action?: Action; expect: Expectation[]; secret: boolean };

export type Scenario = {
  title: string;
  viewport: { width: number; height: number };
  stepTimeoutMs: number;
  allowConsoleErrors: boolean;
  stepHoldMs: number;
  colorScheme: "light" | "dark";
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
// Only UAT_* names: a scenario cannot read the runner's other variables (a CI token, a cloud key).
const ENV_NAME = /^UAT_[A-Z0-9_]+$/;

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
    case "select": {
      onlyKeys(v, [kind, "value", "value_env"], where);
      const target = parseTarget(v[kind], `${where}.${kind}`);
      if (("value" in v) === ("value_env" in v)) fail(where, `a ${kind} takes exactly one of value, value_env`);
      if ("value_env" in v) {
        const name = v.value_env;
        if (typeof name !== "string" || !ENV_NAME.test(name)) {
          fail(`${where}.value_env`, "names an environment variable UAT_<NAME> (capital letters, digits, _)");
        }
        return { kind, target, valueEnv: name };
      }
      if (typeof v.value !== "string") fail(`${where}.value`, "needs a string");
      return { kind, target, value: v.value };
    }
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
  onlyKeys(v, ["caption", "action", "expect", "secret"], where);
  const step: Step = { caption: text(v.caption, `${where}.caption`), expect: [], secret: false };
  if (v.action !== undefined) step.action = parseAction(v.action, `${where}.action`);
  if (v.secret !== undefined && typeof v.secret !== "boolean") fail(`${where}.secret`, "needs true or false");
  const valued = step.action?.kind === "fill" || step.action?.kind === "select";
  if (v.secret === true && !valued) fail(`${where}.secret`, "masks the field of a fill or select action");
  step.secret = v.secret === true || (valued && "valueEnv" in step.action!);
  if (!Array.isArray(v.expect) || v.expect.length === 0) {
    fail(`${where}.expect`, "every step needs at least one expectation (a failed one fails the take)");
  }
  step.expect = v.expect.map((e, i) => parseExpectation(e, `${where}.expect[${i}]`));
  return step;
}

export function parseScenario(raw: unknown): Scenario {
  if (!isObj(raw)) fail("scenario", "the file holds one JSON object");
  onlyKeys(raw, ["title", "viewport", "step_timeout_ms", "allow_console_errors", "step_hold_ms", "color_scheme", "steps"], "scenario");
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
  const stepHoldMs = raw.step_hold_ms === undefined ? 0 : whole(raw.step_hold_ms, 0, 30000, "step_hold_ms");
  const colorScheme = raw.color_scheme === undefined ? "light" : raw.color_scheme;
  if (colorScheme !== "light" && colorScheme !== "dark") fail("color_scheme", 'needs "light" or "dark"');
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) fail("steps", "needs a non-empty list");
  const steps = raw.steps.map((s, i) => parseStep(s, `steps[${i}]`));
  if (steps[0].action?.kind !== "goto") fail("steps[0].action", "the first step opens a page (goto)");
  return { title, viewport, stepTimeoutMs, allowConsoleErrors: raw.allow_console_errors === true, stepHoldMs, colorScheme, steps };
}

/** The environment variables the scenario's value_env steps read, in step order, each once. */
export function envNames(scenario: Scenario): string[] {
  const names: string[] = [];
  for (const step of scenario.steps) {
    const a = step.action;
    if ((a?.kind === "fill" || a?.kind === "select") && a.valueEnv && !names.includes(a.valueEnv)) names.push(a.valueEnv);
  }
  return names;
}

/** The value each fill or select step types, by step index, read before the browser starts: a value_env variable that
 * is unset or empty fails the run (exit 2) instead of typing an empty password. `secrets` lists every value of a
 * secret step, for redaction. */
export function resolveValues(
  scenario: Scenario,
  env: Record<string, string | undefined>,
): { values: Map<number, string>; secrets: string[] } {
  const missing = envNames(scenario).filter((n) => !env[n]);
  if (missing.length) throw new Error(`environment variable(s) not set: ${missing.join(", ")} (value_env steps)`);
  const values = new Map<number, string>();
  const secrets: string[] = [];
  scenario.steps.forEach((step, i) => {
    const a = step.action;
    if (a?.kind !== "fill" && a?.kind !== "select") return;
    const value = a.valueEnv ? (env[a.valueEnv] as string) : (a.value ?? "");
    values.set(i, value);
    if (step.secret && value && !secrets.includes(value)) secrets.push(value);
  });
  return { values, secrets };
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

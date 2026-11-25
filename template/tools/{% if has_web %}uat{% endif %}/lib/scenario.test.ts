// node --test --experimental-strip-types lib/*.test.ts (npm test). Invented pages and names.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { keptStep, type TakeResult } from "./report.ts";
import { describeTarget, envNames, parseBaseUrl, parseScenario, resolveValues } from "./scenario.ts";

const base = () => ({
  title: "Add a sample order",
  viewport: { width: 1280, height: 800 },
  step_timeout_ms: 5000,
  steps: [
    { caption: "Open the orders page", action: { goto: "/orders" }, expect: [{ visible: { role: "heading", name: "Orders" } }] },
    {
      caption: "Fill the name and save",
      action: { fill: { label: "Name" }, value: "Blue kettle" },
      expect: [{ contains: "Blue kettle", in: { testId: "order-list" } }, { count: 3, of: { css: "li" } }, { url_contains: "orders" }],
    },
  ],
});

test("every shipped scenario is valid", () => {
  const dir = new URL("../scenarios/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.match(f, /^[0-9]{2}-[a-z0-9-]+\.json$/, f);
    parseScenario(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  }
});

test("a valid scenario parses into typed steps", () => {
  const s = parseScenario(base());
  assert.equal(s.stepTimeoutMs, 5000);
  assert.equal(s.allowConsoleErrors, false);
  assert.equal(s.stepHoldMs, 0);
  assert.equal(s.colorScheme, "light");
  assert.equal(parseScenario({ ...base(), color_scheme: "dark" }).colorScheme, "dark");
  assert.equal(parseScenario({ ...base(), step_hold_ms: 1500 }).stepHoldMs, 1500);
  assert.deepEqual(s.steps[0].action, { kind: "goto", path: "/orders" });
  assert.deepEqual(s.steps[1].action, { kind: "fill", target: { label: "Name" }, value: "Blue kettle" });
  assert.deepEqual(s.steps[1].expect.map((e) => e.kind), ["contains", "count", "url_contains"]);
});

test("bad rows fail with their path", () => {
  const cases: [(s: ReturnType<typeof base>) => void, RegExp][] = [
    [(s) => ((s.steps[1] as Record<string, unknown>).expect = []), /steps\[1\]\.expect: every step needs/],
    [(s) => ((s.steps[0] as Record<string, unknown>).action = { goto: "https://other.example.test/" }), /steps\[0\]\.action\.goto/],
    [(s) => ((s.steps[0] as Record<string, unknown>).action = { click: { css: "a" } }), /first step opens a page/],
    [(s) => ((s.steps[1].expect[0] as Record<string, unknown>).in = { role: "Button" }), /steps\[1\]\.expect\[0\]\.in\.role/],
    [(s) => ((s.steps[1].expect[0] as Record<string, unknown>).in = { css: "a", text: "b" }), /exactly one/],
    [(s) => ((s.steps[1].expect[1] as Record<string, unknown>).count = -1), /expect\[1\]\.count/],
    [(s) => ((s.steps[1] as Record<string, unknown>).action = { fill: { label: "Name" } }), /exactly one of value, value_env/],
    [(s) => ((s.steps[1] as Record<string, unknown>).action = { fill: { label: "Name" }, value: "x", value_env: "UAT_X" }), /exactly one of value, value_env/],
    [(s) => ((s.steps[1] as Record<string, unknown>).action = { fill: { label: "Name" }, value_env: "GITHUB_TOKEN" }), /value_env: names an environment variable UAT_/],
    [(s) => ((s.steps[1] as Record<string, unknown>).action = { fill: { label: "Name" }, value: 7 }), /action\.value: needs a string/],
    [(s) => ((s.steps[0] as Record<string, unknown>).secret = true), /secret: masks the field of a fill or select/],
    [(s) => ((s.steps[1] as Record<string, unknown>).secret = "yes"), /secret: needs true or false/],
    [(s) => ((s.steps[1] as Record<string, unknown>).action = { hover: { label: "Name" } }), /exactly one of goto/],
    [(s) => (s.step_timeout_ms = 10), /step_timeout_ms/],
    [(s) => ((s as Record<string, unknown>).step_hold_ms = -5), /step_hold_ms/],
    [(s) => ((s as Record<string, unknown>).color_scheme = "sepia"), /color_scheme/],
    [(s) => ((s as Record<string, unknown>).speed = 2), /unknown key\(s\) speed/],
    [(s) => (s.steps = []), /steps: needs a non-empty list/],
  ];
  for (const [change, error] of cases) {
    const s = base();
    change(s);
    assert.throws(() => parseScenario(s), error);
  }
});

test("targets are described for the step log", () => {
  assert.equal(describeTarget({ role: "button", name: "Save" }), 'role button named "Save"');
  assert.equal(describeTarget({ css: "li" }), "css li");
});

test("the base URL is a site root", () => {
  assert.equal(parseBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(parseBaseUrl("https://preview.example.test/"), "https://preview.example.test");
  assert.throws(() => parseBaseUrl(undefined), /required/);
  assert.throws(() => parseBaseUrl("ftp://x.example.test"), /http or https/);
  assert.throws(() => parseBaseUrl("https://x.example.test/app"), /site root/);
  assert.throws(() => parseBaseUrl("not a url"), /not a URL/);
});

// A sign-in walk: the password comes from the environment, never from the file. TYPED is an invented value.
const TYPED = "Invented-Pass-42";
const signIn = () => ({
  title: "Sign in with the test account",
  viewport: { width: 1280, height: 800 },
  step_timeout_ms: 5000,
  steps: [
    { caption: "Open the sign-in page", action: { goto: "/sign-in" }, expect: [{ visible: { role: "heading", name: "Sign in" } }] },
    { caption: "Type the e-mail", action: { fill: { label: "E-mail" }, value: "tester@example.test" }, expect: [{ visible: { label: "Password" } }] },
    {
      caption: "Type the password and sign in",
      action: { fill: { label: "Password" }, value_env: "UAT_PASSWORD" },
      expect: [{ visible: { role: "button", name: "Sign in" } }],
    },
    { caption: "Type the code", action: { fill: { label: "Code" }, value: "000000" }, secret: true, expect: [{ url_contains: "/sign-in" }] },
  ],
});

test("a value_env step is secret and reads its value from the environment", () => {
  const s = parseScenario(signIn());
  assert.deepEqual(s.steps[2].action, { kind: "fill", target: { label: "Password" }, valueEnv: "UAT_PASSWORD" });
  assert.deepEqual(s.steps.map((st) => st.secret), [false, false, true, true]);
  assert.deepEqual(envNames(s), ["UAT_PASSWORD"]);
  const { values, secrets } = resolveValues(s, { UAT_PASSWORD: TYPED });
  assert.equal(values.get(1), "tester@example.test");
  assert.equal(values.get(2), TYPED);
  assert.deepEqual(secrets, [TYPED, "000000"]);
});

test("a value_env variable that is unset or empty stops the run before the browser", () => {
  const s = parseScenario(signIn());
  assert.throws(() => resolveValues(s, {}), /not set: UAT_PASSWORD/);
  assert.throws(() => resolveValues(s, { UAT_PASSWORD: "" }), /not set: UAT_PASSWORD/);
});

test("a value_env step never puts its value into a take result", () => {
  const s = parseScenario(signIn());
  const { secrets } = resolveValues(s, { UAT_PASSWORD: TYPED });
  // A failing fill whose error and console message echo what was typed.
  const step = keptStep(
    { n: 3, caption: s.steps[2].caption, verdict: "fail", startMs: 0, endMs: 10, error: `console error: bad value "${TYPED}"; code 000000` },
    secrets,
  );
  const take: TakeResult = {
    take: "20310102-030405-02-sign-in",
    scenario: "02-sign-in",
    title: s.title,
    baseUrl: "https://preview.example.test",
    commit: "abc1234",
    startedAt: "2031-01-02T03:04:05Z",
    verdict: "fail",
    steps: [step],
  };
  const json = JSON.stringify(take);
  assert.ok(!json.includes(TYPED), json);
  assert.ok(!json.includes("000000"), json);
  assert.match(step.error ?? "", /bad value "\[secret\]"; code \[secret\]/);
});

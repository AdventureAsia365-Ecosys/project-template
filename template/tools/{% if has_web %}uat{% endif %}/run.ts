// UAT runner: plays each scenario (scenarios/*.json, format in lib/scenario.ts) in Chromium against a running web
// app, checks every expectation of every step, takes a screenshot per step, optionally records a video, and writes a
// take folder per scenario plus the report index (out/index.html). Exit 1 when any take fails.
//
//   npm run uat -- --base-url http://127.0.0.1:3000 [--scenario 01-kit-gallery] [--video] [--headed] [--out out]
//
// Free local tools only: Playwright's bundled Chromium and its video recorder. Narration, when a take needs one,
// comes from captions.vtt read by a free local text-to-speech engine; no paid voice service.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import {
  captionsVtt,
  indexHtml,
  keptStep,
  readTake,
  screenshotName,
  takeId,
  takeVerdict,
  type StepResult,
  type TakeResult,
} from "./lib/report.ts";
import {
  describeTarget,
  parseBaseUrl,
  parseScenario,
  resolveValues,
  type Action,
  type Expectation,
  type Scenario,
  type Target,
} from "./lib/scenario.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 100;

function locate(page: Page, t: Target): Locator {
  if ("role" in t) {
    return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], { name: t.name, exact: t.exact });
  }
  if ("text" in t) return page.getByText(t.text, { exact: t.exact });
  if ("label" in t) return page.getByLabel(t.label);
  if ("testId" in t) return page.getByTestId(t.testId);
  return page.locator(t.css);
}

/** Poll a condition until it holds or the step's ceiling passes (every wait has its own ceiling). */
async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() >= deadline) throw new Error(`${what} (waited ${timeoutMs} ms)`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Show a secret field's characters as dots, so the video and later screenshots never show what is typed. */
async function hideCharacters(target: Locator, timeout: number): Promise<void> {
  await target.evaluate((el) => (el as HTMLElement).style.setProperty("-webkit-text-security", "disc"), undefined, { timeout });
}

async function act(page: Page, a: Action, timeout: number, value: string, secret: boolean): Promise<void> {
  if (a.kind === "goto") {
    const response = await page.goto(a.path, { waitUntil: "load", timeout });
    const status = response?.status() ?? 0;
    if (!response || status >= 400) throw new Error(`${a.path} answered ${status || "nothing"}`);
    return;
  }
  const target = locate(page, a.target).first();
  if (a.kind === "click") await target.click({ timeout });
  else if (a.kind === "fill") {
    if (secret) await hideCharacters(target, timeout);
    await target.fill(value, { timeout });
  } else if (a.kind === "press") await target.press(a.key, { timeout });
  else if (a.kind === "select") await target.selectOption(value, { timeout });
  else await target.check({ timeout });
}

async function expectOne(page: Page, e: Expectation, timeout: number): Promise<void> {
  if (e.kind === "url_contains") {
    await waitUntil(async () => page.url().includes(e.text), timeout, `the URL does not contain "${e.text}": ${page.url()}`);
    return;
  }
  const loc = locate(page, e.target);
  const what = describeTarget(e.target);
  if (e.kind === "visible") await loc.first().waitFor({ state: "visible", timeout });
  else if (e.kind === "hidden") await waitUntil(async () => !(await loc.first().isVisible()), timeout, `${what} is still visible`);
  else if (e.kind === "count") {
    await waitUntil(async () => (await loc.count()) === e.equals, timeout, `${what}: expected ${e.equals}, found ${await loc.count()}`);
  } else {
    await waitUntil(
      async () => (await loc.allInnerTexts()).some((t) => t.includes(e.text)),
      timeout,
      `no ${what} contains "${e.text}"`,
    );
  }
}

async function commitOf(baseUrl: string, timeoutMs: number): Promise<string> {
  try {
    const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await r.json()) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : "unknown";
  } catch {
    return "unknown";
  }
}

async function playTake(
  browser: Browser,
  name: string,
  scenario: Scenario,
  opts: { baseUrl: string; outDir: string; video: boolean; values: Map<number, string>; secrets: string[] },
): Promise<TakeResult> {
  const started = new Date();
  const take = takeId(name, started);
  const dir = path.join(opts.outDir, take);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    baseURL: opts.baseUrl,
    viewport: scenario.viewport,
    colorScheme: scenario.colorScheme,
    recordVideo: opts.video ? { dir, size: scenario.viewport } : undefined,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`page error: ${err.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console error: ${m.text()}`);
  });
  const t0 = Date.now();
  const steps: StepResult[] = [];
  const masks: Locator[] = []; // the secret fields filled so far: masked in every screenshot after
  let failed = false;
  for (const [i, step] of scenario.steps.entries()) {
    const n = i + 1;
    if (failed) {
      steps.push({ n, caption: step.caption, verdict: "skipped", startMs: Date.now() - t0, endMs: Date.now() - t0 });
      continue;
    }
    const startMs = Date.now() - t0;
    const errorsBefore = errors.length;
    let error: string | undefined;
    try {
      // A secret field is masked from this step's screenshot on, even when the fill fails halfway.
      if (step.secret && step.action && step.action.kind !== "goto") masks.push(locate(page, step.action.target).first());
      if (step.action) await act(page, step.action, scenario.stepTimeoutMs, opts.values.get(i) ?? "", step.secret);
      for (const e of step.expect) await expectOne(page, e, scenario.stepTimeoutMs);
      if (!scenario.allowConsoleErrors && errors.length > errorsBefore) error = errors.slice(errorsBefore).join("; ");
    } catch (err) {
      error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    }
    if (!error && scenario.stepHoldMs > 0) await page.waitForTimeout(scenario.stepHoldMs); // on screen for the video
    const shot = screenshotName(n, step.caption);
    await page.screenshot({ path: path.join(dir, shot), mask: masks }).catch(() => undefined);
    failed = error !== undefined;
    const kept = keptStep(
      { n, caption: step.caption, verdict: failed ? "fail" : "pass", startMs, endMs: Date.now() - t0, error, screenshot: shot },
      opts.secrets,
    );
    steps.push(kept);
    console.log(`${failed ? "FAIL" : "ok  "} ${name} step ${n}: ${step.caption}${kept.error ? ` -- ${kept.error}` : ""}`);
  }
  const video = page.video();
  await context.close();
  let videoFile: string | undefined;
  if (video) {
    videoFile = "video.webm";
    await video.saveAs(path.join(dir, videoFile));
    await video.delete();
  }
  const result: TakeResult = {
    take,
    scenario: name,
    title: scenario.title,
    baseUrl: opts.baseUrl,
    commit: await commitOf(opts.baseUrl, scenario.stepTimeoutMs),
    startedAt: started.toISOString().replace(/\.\d{3}Z$/, "Z"),
    verdict: takeVerdict(steps),
    steps,
    video: videoFile,
  };
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(path.join(dir, "captions.vtt"), captionsVtt(steps));
  return result;
}

function writeIndex(outDir: string): string {
  const takes: TakeResult[] = [];
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const t = readTake(JSON.parse(readFileSync(path.join(outDir, entry.name, "result.json"), "utf8")));
      if (t) takes.push(t);
    } catch {
      // a folder without a result (an interrupted take) is not listed
    }
  }
  const file = path.join(outDir, "index.html");
  writeFileSync(file, indexHtml(takes));
  return file;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      scenario: { type: "string", multiple: true },
      video: { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      out: { type: "string", default: path.join(HERE, "out") },
    },
  });
  const baseUrl = parseBaseUrl(values["base-url"]);
  const scenarioDir = path.join(HERE, "scenarios");
  const names = values.scenario?.length
    ? values.scenario.map((s) => path.basename(s, ".json"))
    : readdirSync(scenarioDir).filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json")).sort();
  // Every file, and every value_env variable it reads, is checked before the browser starts: a bad file or a missing
  // variable fails the run (exit 2), not a take halfway.
  const scenarios = names.map((name) => {
    try {
      const scenario = parseScenario(JSON.parse(readFileSync(path.join(scenarioDir, `${name}.json`), "utf8")));
      if (values.video && scenario.steps.some((s) => s.secret && s.action?.kind === "select")) {
        throw new Error("a secret select shows its chosen option in a video: record this scenario without --video");
      }
      return { name, scenario, ...resolveValues(scenario, process.env) };
    } catch (err) {
      throw new Error(`scenarios/${name}.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const outDir = path.resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: !values.headed });
  const results: TakeResult[] = [];
  try {
    for (const { name, scenario, values: typed, secrets } of scenarios) {
      results.push(await playTake(browser, name, scenario, { baseUrl, outDir, video: values.video, values: typed, secrets }));
    }
  } finally {
    await browser.close();
  }
  const index = writeIndex(outDir);
  for (const r of results) console.log(`${r.verdict.toUpperCase()} ${r.scenario}: ${path.join(outDir, r.take)}`);
  console.log(`report index: ${index}`);
  return results.every((r) => r.verdict === "pass") ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);

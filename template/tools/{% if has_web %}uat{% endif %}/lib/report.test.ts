// node --test --experimental-strip-types lib/*.test.ts (npm test). Invented scenarios and hosts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captionsVtt,
  escapeHtml,
  indexHtml,
  keptStep,
  readTake,
  redact,
  screenshotName,
  takeId,
  takeVerdict,
  type StepResult,
  type TakeResult,
} from "./report.ts";

const step = (n: number, verdict: StepResult["verdict"], startMs: number, endMs: number): StepResult => ({
  n,
  caption: `Step ${n} of the walk`,
  verdict,
  startMs,
  endMs,
});

test("a take passes only when every step passed", () => {
  assert.equal(takeVerdict([step(1, "pass", 0, 10), step(2, "pass", 10, 20)]), "pass");
  assert.equal(takeVerdict([step(1, "pass", 0, 10), step(2, "fail", 10, 20), step(3, "skipped", 20, 20)]), "fail");
  assert.equal(takeVerdict([]), "fail");
});

test("names of takes and screenshots", () => {
  assert.equal(takeId("01-kit-gallery", new Date(Date.UTC(2031, 0, 2, 3, 4, 5))), "20310102-030405-01-kit-gallery");
  assert.equal(screenshotName(3, "Open the drawer: Sample item!"), "03-open-the-drawer-sample-item.png");
  assert.equal(screenshotName(12, "???"), "12-step.png");
  assert.equal(screenshotName(4, "Open the drawer: the sample item's panel slides in"), "04-open-the-drawer-the-sample-item-s-panel.png");
});

test("captions are timed per step and skip the steps that did not run", () => {
  const vtt = captionsVtt([step(1, "pass", 0, 250), step(2, "fail", 3725500, 3725900), step(3, "skipped", 0, 0)]);
  assert.equal(
    vtt,
    "WEBVTT\n\n1\n00:00:00.000 --> 01:02:05.500\nStep 1 of the walk\n\n2\n01:02:05.500 --> 01:02:06.500\nStep 2 of the walk\n",
  );
  const quick = captionsVtt([step(1, "pass", 0, 120), step(2, "pass", 120, 2400)]);
  assert.ok(quick.includes("00:00:00.000 --> 00:00:00.120"), "a cue ends where the next step starts");
  assert.ok(quick.includes("00:00:00.120 --> 00:00:02.400"));
});

test("the index escapes text, lists newest first and marks failures", () => {
  const take = (id: string, verdict: "pass" | "fail", title: string): TakeResult => ({
    take: id,
    scenario: "01-sample",
    title,
    baseUrl: "http://app.example.test",
    commit: "abc1234",
    startedAt: "2031-01-02T03:04:05Z",
    verdict,
    steps: verdict === "pass" ? [step(1, "pass", 0, 5)] : [{ ...step(1, "fail", 0, 5), error: "not <visible>" }],
    video: "video.webm",
  });
  const html = indexHtml([take("20310101-000000-a", "pass", "Old <walk>"), take("20310102-000000-b", "fail", "New walk")]);
  assert.ok(html.indexOf("20310102-000000-b") < html.indexOf("20310101-000000-a"), "newest first");
  assert.ok(html.includes("Old &lt;walk&gt;"));
  assert.ok(html.includes("not &lt;visible&gt;"));
  assert.ok(html.includes("2 take(s), 1 failing"));
  assert.ok(html.includes('<span class="fail">FAIL</span>'));
  assert.ok(!html.includes("<walk>"));
  assert.equal(escapeHtml(`a&b"'`), "a&amp;b&quot;&#39;");
});

test("only take results are read back", () => {
  assert.equal(readTake({ take: "x", steps: [], verdict: "pass" })?.take, "x");
  assert.equal(readTake({ take: "x", steps: [], verdict: "maybe" }), null);
  assert.equal(readTake(["x"]), null);
  assert.equal(readTake(null), null);
});

test("secrets are redacted from kept text", () => {
  assert.equal(redact("typed Invented-Pass-42 twice: Invented-Pass-42", ["Invented-Pass-42"]), "typed [secret] twice: [secret]");
  assert.equal(redact("nothing to hide", ["", "Invented-Pass-42"]), "nothing to hide");
  const s = step(1, "pass", 0, 10);
  assert.equal(keptStep(s, ["Invented-Pass-42"]), s);
});

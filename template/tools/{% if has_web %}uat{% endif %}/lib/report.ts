// Take results, captions and the report index. Pure code, tested by report.test.ts; run.ts writes the files.
//   out/<take>/result.json   the take's verdict, build, steps (pass, fail or skipped), timings and errors
//   out/<take>/captions.vtt  one caption per step, timed from the start of the take (fits the video)
//   out/index.html           every take in out/, newest first, with its verdict and links
// A take passes only when every step passed; a failing take is listed as FAIL and never as a pass.

export type StepVerdict = "pass" | "fail" | "skipped";

export type StepResult = {
  n: number;
  caption: string;
  verdict: StepVerdict;
  /** Milliseconds from the start of the take. */
  startMs: number;
  endMs: number;
  error?: string;
  screenshot?: string;
};

export type TakeResult = {
  take: string;
  scenario: string;
  title: string;
  baseUrl: string;
  commit: string;
  startedAt: string;
  verdict: "pass" | "fail";
  steps: StepResult[];
  video?: string;
};

export function takeVerdict(steps: StepResult[]): "pass" | "fail" {
  return steps.length > 0 && steps.every((s) => s.verdict === "pass") ? "pass" : "fail";
}

/** A take folder name: <yyyymmdd-hhmmss>-<scenario>, in UTC so takes sort by time. */
export function takeId(scenario: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${scenario.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`;
}

/** File name of a step's screenshot: 03-open-the-drawer.png. */
export function screenshotName(n: number, caption: string): string {
  const slug = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
  return `${String(n).padStart(2, "0")}-${slug || "step"}.png`;
}

function vttTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const pad = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(t % 1000, 3)}`;
}

/** WebVTT captions, one cue per step that ran. A cue stays until the next step starts (cues never overlap); the
 * last one lasts at least a second so it can be read. */
export function captionsVtt(steps: StepResult[]): string {
  const ran = steps.filter((s) => s.verdict !== "skipped");
  const cues = ran.map((s, i) => {
    const end = i + 1 < ran.length ? ran[i + 1].startMs : Math.max(s.endMs, s.startMs + 1000);
    return `${s.n}\n${vttTime(s.startMs)} --> ${vttTime(end)}\n${s.caption.replace(/\n+/g, " ")}`;
  });
  return ["WEBVTT", ...cues].join("\n\n") + "\n";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(encodeURI(href))}">${escapeHtml(label)}</a>`;
}

function takeRow(t: TakeResult): string {
  const passed = t.steps.filter((s) => s.verdict === "pass").length;
  const failed = t.steps.find((s) => s.verdict === "fail");
  const links = [link(`${t.take}/result.json`, "result"), link(`${t.take}/captions.vtt`, "captions")];
  if (t.video) links.push(link(`${t.take}/${t.video}`, "video"));
  const shots = t.steps
    .filter((s) => s.screenshot)
    .map((s) => link(`${t.take}/${s.screenshot}`, `${s.n}`))
    .join(" ");
  return [
    "<tr>",
    `<td><span class="${t.verdict}">${t.verdict.toUpperCase()}</span></td>`,
    `<td>${escapeHtml(t.title)}<br><small>${escapeHtml(t.scenario)}</small></td>`,
    `<td>${escapeHtml(t.startedAt)}</td>`,
    `<td>${escapeHtml(t.baseUrl)}<br><small>${escapeHtml(t.commit)}</small></td>`,
    `<td>${passed}/${t.steps.length}${failed ? `<br><small>step ${failed.n}: ${escapeHtml(failed.error ?? "failed")}</small>` : ""}</td>`,
    `<td>${links.join(" · ")}${shots ? `<br><small>screens ${shots}</small>` : ""}</td>`,
    "</tr>",
  ].join("");
}

/** The report index over every take, newest first. */
export function indexHtml(takes: TakeResult[]): string {
  const rows = [...takes].sort((a, b) => b.take.localeCompare(a.take)).map(takeRow);
  const failing = takes.filter((t) => t.verdict === "fail").length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UAT takes</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 1.5rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
th, td { border-bottom: 1px solid #8884; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
.pass { color: #1d7a3a; font-weight: 700; }
.fail { color: #b3261e; font-weight: 700; }
</style>
</head>
<body>
<h1>UAT takes</h1>
<p>${takes.length} take(s), ${failing} failing. A failing take is never published as a pass.</p>
<table>
<thead><tr><th>Verdict</th><th>Scenario</th><th>Started (UTC)</th><th>Target and build</th><th>Steps passed</th><th>Files</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</body>
</html>
`;
}

/** A result.json read back for the index; null when it is not a take result. */
export function readTake(raw: unknown): TakeResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Partial<TakeResult>;
  if (typeof t.take !== "string" || !Array.isArray(t.steps) || (t.verdict !== "pass" && t.verdict !== "fail")) return null;
  return t as TakeResult;
}

/** `text` with every secret value replaced by [secret]: an error or a console message can echo what was typed. */
export function redact(text: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((out, s) => out.split(s).join("[secret]"), text);
}

/** The step as it is kept (result.json, captions, step log): its error redacted. */
export function keptStep(step: StepResult, secrets: string[]): StepResult {
  return step.error === undefined ? step : { ...step, error: redact(step.error, secrets) };
}

// npm run kit-lint [-- --write-baseline]: prints the kit lint findings and how they stand against the baseline
// (lib/kitLint.ts). --write-baseline writes kit-lint-baseline.json with the current findings: run it once when a
// project adopts the kit (it turns enforcement on), then fix pages and lower the counts; never to hide a new finding.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBaseline, formatFindings, lintTree, readBaseline, writeBaseline } from "./kitLint.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = lintTree(webRoot);
if (process.argv.includes("--write-baseline")) {
  const file = writeBaseline(webRoot, findings);
  console.log(`kit lint: ${findings.length} finding(s) written to ${path.relative(process.cwd(), file) || file}`);
  process.exit(0);
}
if (findings.length) console.log(formatFindings(findings));
const baseline = readBaseline(webRoot);
if (baseline === null) {
  console.log(`kit lint: ${findings.length} finding(s), report only (no baseline file; --write-baseline turns it on)`);
  process.exit(0);
}
const problems = compareToBaseline(findings, baseline);
if (problems.length) console.log(problems.join("\n"));
console.log(`kit lint: ${findings.length} finding(s), ${problems.length ? "FAILS against" : "within"} the baseline`);
process.exit(problems.length ? 1 : 0);

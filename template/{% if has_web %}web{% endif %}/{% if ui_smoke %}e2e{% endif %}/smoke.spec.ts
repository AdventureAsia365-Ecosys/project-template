// UI smoke: open each route of smoke-routes.json on BASE_URL. A route passes when it answers below 400, the page
// throws no error and logs no console error, and its selector (when given) is visible. One screenshot per page.
// Run: BASE_URL=<deployed URL> npm run smoke   (CI: .github/workflows/ui-smoke.yml)
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parseSmokePlan } from "../lib/smokeRoutes.ts";

const plan = parseSmokePlan(JSON.parse(readFileSync(path.join(__dirname, "smoke-routes.json"), "utf8")));

for (const route of plan.routes) {
  test(`smoke ${route.path}`, async ({ page }) => {
    test.setTimeout(plan.timeoutMs);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const response = await page.goto(route.path, { waitUntil: "load" });
    expect(response, "no response").not.toBeNull();
    expect(response!.status(), `${route.path} status`).toBeLessThan(400);
    if (route.selector) await expect(page.locator(route.selector).first()).toBeVisible();
    const name = route.path === "/" ? "home" : route.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    await page.screenshot({ path: path.join(__dirname, "results", `${name}.png`), fullPage: true });
    expect(errors, "page or console errors").toEqual([]);
  });
}

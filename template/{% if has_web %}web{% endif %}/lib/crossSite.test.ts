// node --test --experimental-strip-types lib/*.test.ts (npm test). Invented host names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCrossSiteWrite } from "./crossSite.ts";

const URL_ = "https://app.example.test/api/items";

test("reads always pass", () => {
  assert.deepEqual(checkCrossSiteWrite("GET", URL_, new Headers({ origin: "https://other.example.test" })), { allowed: true });
});

test("a same-origin write passes", () => {
  const h = new Headers({ origin: "https://app.example.test", "sec-fetch-site": "same-origin" });
  assert.equal(checkCrossSiteWrite("POST", URL_, h).allowed, true);
});

test("a cross-site write is refused", () => {
  assert.equal(checkCrossSiteWrite("POST", URL_, new Headers({ "sec-fetch-site": "cross-site" })).allowed, false);
  assert.equal(checkCrossSiteWrite("DELETE", URL_, new Headers({ origin: "https://other.example.test" })).allowed, false);
});

test("a write with neither header is refused", () => {
  assert.equal(checkCrossSiteWrite("PUT", URL_, new Headers()).allowed, false);
});

// node --test --experimental-strip-types app/_kit/*.test.ts (npm test).
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageHref, pageInfo, pageOffset, pageSummary, parsePage } from "./paging.ts";

test("the page parameter is read leniently", () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage(["4", "9"]), 4);
  for (const bad of ["0", "-2", "2.5", "abc", "", "1e3", "9999999999"]) assert.equal(parsePage(bad), 1, bad);
});

test("page info clamps the page and counts the rows", () => {
  assert.deepEqual(pageInfo(2, 10, 47), {
    page: 2, pageSize: 10, total: 47, pages: 5, first: 11, last: 20, hasPrev: true, hasNext: true,
  });
  const last = pageInfo(9, 10, 47);
  assert.equal(last.page, 5);
  assert.equal(last.first, 41);
  assert.equal(last.last, 47);
  assert.equal(last.hasNext, false);
  const empty = pageInfo(3, 10, 0);
  assert.deepEqual([empty.page, empty.pages, empty.first, empty.last, empty.hasPrev, empty.hasNext], [1, 1, 0, 0, false, false]);
  assert.equal(pageOffset(pageInfo(3, 25, 100)), 50);
});

test("page size and total must be whole numbers", () => {
  assert.throws(() => pageInfo(1, 0, 10), /pageSize/);
  assert.throws(() => pageInfo(1, 2.5, 10), /pageSize/);
  assert.throws(() => pageInfo(1, 10, -1), /total/);
});

test("page links keep the other parameters and drop page 1", () => {
  assert.equal(pageHref("/orders?status=open", 3), "/orders?status=open&page=3");
  assert.equal(pageHref("/orders?page=3&status=open", 1), "/orders?status=open");
  assert.equal(pageHref("/orders", 2, "p"), "/orders?p=2");
  assert.equal(pageHref("/orders?page=2#list", 1), "/orders#list");
});

test("the summary line", () => {
  assert.equal(pageSummary(pageInfo(2, 10, 47)), "Showing 11-20 of 47");
  assert.equal(pageSummary(pageInfo(1, 10, 0)), "No rows");
});

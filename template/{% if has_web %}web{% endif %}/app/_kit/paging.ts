// Server paging helpers of the kit Table: the page comes from the URL (?page=N), the server reads one page of rows,
// and the pager links to the neighbour pages. No client state, so a page of a list is a link people can share.
// Pure functions, tested by paging.test.ts (npm test).

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  /** 1-based index of the first row on this page (0 when there are no rows). */
  first: number;
  /** 1-based index of the last row on this page (0 when there are no rows). */
  last: number;
  hasPrev: boolean;
  hasNext: boolean;
};

function wholeAtLeast(value: number, min: number, what: string): number {
  if (!Number.isInteger(value) || value < min) throw new Error(`${what} must be a whole number of at least ${min}`);
  return value;
}

/** The page asked for in the URL: a positive whole number, otherwise 1 (a bad link opens the first page). */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^[0-9]{1,9}$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 ? page : 1;
}

/** Where a page sits in the list. A page past the end is moved to the last page, so a stale link still shows rows. */
export function pageInfo(page: number, pageSize: number, total: number): PageInfo {
  wholeAtLeast(pageSize, 1, "pageSize");
  wholeAtLeast(total, 0, "total");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = total === 0 ? 0 : Math.min(current * pageSize, total);
  return { page: current, pageSize, total, pages, first, last, hasPrev: current > 1, hasNext: current < pages };
}

/** The offset to read from (SQL OFFSET) for a page. */
export function pageOffset(info: PageInfo): number {
  return (info.page - 1) * info.pageSize;
}

/**
 * The link to another page of the same list: keeps the other query parameters, sets the page parameter, and drops
 * it for page 1 so the first page has one URL. `href` is a path with an optional query ("/orders?status=open").
 */
export function pageHref(href: string, page: number, param = "page"): string {
  const url = new URL(href, "http://kit.invalid");
  if (page <= 1) url.searchParams.delete(param);
  else url.searchParams.set(param, String(page));
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** "Showing 11-20 of 47" (or "No rows"), the pager's summary line. */
export function pageSummary(info: PageInfo): string {
  if (info.total === 0) return "No rows";
  return `Showing ${info.first}-${info.last} of ${info.total}`;
}

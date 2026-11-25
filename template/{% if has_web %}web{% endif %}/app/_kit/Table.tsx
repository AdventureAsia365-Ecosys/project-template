// Table with server paging. The page reads ?page= (parsePage), asks the API or the database for one page of rows and
// the total, and passes both here; the pager links to the neighbour pages (pageHref keeps the other parameters).
// Never page on the client over a partial list: the counts and the filters would only see that list.
// Every other HTML attribute (data-testid included) lands on the wrapper element.
import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { pageHref, pageInfo, pageSummary } from "./paging";

export type Column<Row> = {
  key: string;
  header: string;
  /** The cell content; by default the row's value at `key`. */
  render?: (row: Row) => ReactNode;
  align?: "start" | "end";
};

export type Paging = {
  page: number;
  pageSize: number;
  total: number;
  /** The list's own URL with its filters ("/orders?status=open"); the page parameter is set on it. */
  href: string;
  param?: string;
};

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  paging,
  empty,
  ...rest
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  paging?: Paging;
  empty?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const info = paging ? pageInfo(paging.page, paging.pageSize, paging.total) : null;
  return (
    <div {...rest}>
      <div className="kit-table-wrap">
        {rows.length === 0 ? (
          (empty ?? <EmptyState title="Nothing here yet" />)
        ) : (
          <table className="kit-table">
            <caption className="kit-visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={c.align === "end" ? "kit-align-end" : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === "end" ? "kit-align-end" : undefined}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {info && paging ? (
        <nav className="kit-pager" aria-label={`${caption} pages`}>
          <span>{pageSummary(info)}</span>
          <span className="kit-row">
            <span>
              Page {info.page} of {info.pages}
            </span>
            {info.hasPrev ? (
              <Link className="kit-button kit-button--secondary kit-button--sm" href={pageHref(paging.href, info.page - 1, paging.param)}>
                Previous page
              </Link>
            ) : (
              <span className="kit-button kit-button--secondary kit-button--sm" aria-disabled="true">
                Previous page
              </span>
            )}
            {info.hasNext ? (
              <Link className="kit-button kit-button--secondary kit-button--sm" href={pageHref(paging.href, info.page + 1, paging.param)}>
                Next page
              </Link>
            ) : (
              <span className="kit-button kit-button--secondary kit-button--sm" aria-disabled="true">
                Next page
              </span>
            )}
          </span>
        </nav>
      ) : null}
    </div>
  );
}

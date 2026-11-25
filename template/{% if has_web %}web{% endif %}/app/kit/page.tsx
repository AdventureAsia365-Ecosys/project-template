// UI kit gallery (/kit): every kit component on one page, with invented rows, so a change to the kit is checked by
// eye in both themes and by the UAT example scenario (tools/uat/scenarios/01-kit-gallery.json). It shows no project
// data; keep it, or put it behind the staff sign-in once there is one. The data-testid attributes let the example
// scenario check that the kit components pass HTML attributes through.
import { Badge, type BadgeTone, EmptyState, PageHeader, Table, Tabs, pageInfo, pageOffset, parsePage } from "@/app/_kit";
import { DrawerDemo, ToastDemo } from "./GalleryDemos";

export const metadata = { title: "UI kit", robots: { index: false } };

type SampleRow = { id: string; name: string; status: string; tone: BadgeTone; amount: number };

const STATUSES: { status: string; tone: BadgeTone }[] = [
  { status: "Draft", tone: "neutral" },
  { status: "In review", tone: "info" },
  { status: "Approved", tone: "success" },
  { status: "On hold", tone: "warning" },
  { status: "Rejected", tone: "danger" },
];

// Invented rows standing in for one page read from the API (SQL: ORDER BY ... LIMIT pageSize OFFSET pageOffset).
const SAMPLE_TOTAL = 47;
function samplePage(offset: number, limit: number): SampleRow[] {
  const rows: SampleRow[] = [];
  for (let i = offset; i < Math.min(offset + limit, SAMPLE_TOTAL); i++) {
    const s = STATUSES[i % STATUSES.length];
    rows.push({ id: `row-${i + 1}`, name: `Sample item ${String(i + 1).padStart(2, "0")}`, status: s.status, tone: s.tone, amount: (i + 1) * 12.5 });
  }
  return rows;
}

const TABS = [
  { id: "components", label: "Components", href: "/kit" },
  { id: "empty", label: "Empty states", href: "/kit?tab=empty" },
];

export default async function KitGallery({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const tab = query.tab === "empty" ? "empty" : "components";
  const info = pageInfo(parsePage(query.page), 10, SAMPLE_TOTAL);
  const rows = samplePage(pageOffset(info), info.pageSize);

  return (
    <main className="kit-page">
      <PageHeader
        title="UI kit"
        data-testid="kit-gallery-header"
        description="Every shared component with invented data. Pages build from these only."
        actions={<ToastDemo />}
      />
      <div className="kit-stack">
        <Tabs label="Gallery sections" tabs={TABS} current={tab} data-testid="kit-gallery-tabs" />
        {tab === "components" ? (
          <>
            <section className="kit-section" aria-labelledby="kit-badges">
              <h2 id="kit-badges">Status badges</h2>
              <div className="kit-row">
                {STATUSES.map((s) => (
                  <Badge key={s.status} tone={s.tone}>
                    {s.status}
                  </Badge>
                ))}
              </div>
            </section>
            <section className="kit-section" aria-labelledby="kit-table">
              <h2 id="kit-table">Table with server paging</h2>
              <Table
                caption="Sample items"
                data-testid="kit-sample-table"
                columns={[
                  { key: "name", header: "Name" },
                  { key: "status", header: "Status", render: (r: SampleRow) => <Badge tone={r.tone}>{r.status}</Badge> },
                  { key: "amount", header: "Amount", align: "end", render: (r: SampleRow) => r.amount.toFixed(2) },
                ]}
                rows={rows}
                rowKey={(r) => r.id}
                paging={{ page: info.page, pageSize: info.pageSize, total: SAMPLE_TOTAL, href: "/kit" }}
              />
            </section>
            <section className="kit-section" aria-labelledby="kit-drawer">
              <h2 id="kit-drawer">Drawer</h2>
              <DrawerDemo />
            </section>
          </>
        ) : (
          <section className="kit-section" aria-labelledby="kit-empty">
            <h2 id="kit-empty">Empty state</h2>
            <EmptyState title="No sample items yet" data-testid="kit-sample-empty">Items appear here once someone adds the first one.</EmptyState>
          </section>
        )}
      </div>
    </main>
  );
}

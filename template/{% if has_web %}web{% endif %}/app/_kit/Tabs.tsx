// Tabs as links: each tab is a URL (a route or ?tab=), so the open tab survives a reload and can be shared, and a
// server page renders only the open tab's data.
import Link from "next/link";

export type TabItem = { id: string; label: string; href: string };

export function Tabs({ label, tabs, current }: { label: string; tabs: TabItem[]; current: string }) {
  return (
    <nav className="kit-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className="kit-tab"
          aria-current={tab.id === current ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

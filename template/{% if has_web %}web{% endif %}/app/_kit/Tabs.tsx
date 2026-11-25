// Tabs as links: each tab is a URL (a route or ?tab=), so the open tab survives a reload and can be shared, and a
// server page renders only the open tab's data. Every other HTML attribute (data-testid included) lands on the <nav>.
import Link from "next/link";
import type { HTMLAttributes } from "react";

export type TabItem = { id: string; label: string; href: string };

export function Tabs({
  label,
  tabs,
  current,
  className,
  ...rest
}: { label: string; tabs: TabItem[]; current: string } & Omit<HTMLAttributes<HTMLElement>, "children">) {
  return (
    <nav {...rest} className={["kit-tabs", className ?? ""].filter(Boolean).join(" ")} aria-label={label}>
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

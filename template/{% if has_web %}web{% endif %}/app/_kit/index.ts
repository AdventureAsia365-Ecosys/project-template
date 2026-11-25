// The UI kit: every page builds from these components and the layout classes of kit.css (kit-page, kit-stack,
// kit-row, kit-section, kit-muted). Pages import from "@/app/_kit"; lib/kitLint.ts fails `npm test` when a page uses an
// inline style, its own stylesheet, a class outside the kit or a raw <button> / <table> / <dialog>.
// The gallery at /kit shows each component in both themes.
export { Badge, type BadgeTone } from "./Badge";
export { Button, ButtonLink, type ButtonSize, type ButtonVariant } from "./Button";
export { Drawer } from "./Drawer";
export { EmptyState } from "./EmptyState";
export { PageHeader } from "./PageHeader";
export { Table, type Column, type Paging } from "./Table";
export { Tabs, type TabItem } from "./Tabs";
export { ToastProvider, useToast, type ToastTone } from "./Toast";
export { pageHref, pageInfo, pageOffset, pageSummary, parsePage, type PageInfo } from "./paging";

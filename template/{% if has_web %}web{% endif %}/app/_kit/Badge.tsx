// Status badge: a short label with a tone. Map a domain status to a tone in one place per domain (for example a
// statusTone(order.status) helper next to the API client), not page by page.
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export function Badge({
  tone = "neutral",
  className,
  ...rest
}: { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={["kit-badge", `kit-badge--${tone}`, className ?? ""].filter(Boolean).join(" ")} {...rest} />;
}

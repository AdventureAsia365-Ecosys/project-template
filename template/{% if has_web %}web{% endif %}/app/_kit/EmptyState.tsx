// What a list or a panel shows when it has nothing yet: a title, one line on why, and the action that fills it.
// Every other HTML attribute (data-testid included) lands on its root element.
import type { HTMLAttributes, ReactNode } from "react";

export function EmptyState({
  title,
  children,
  action,
  className,
  ...rest
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children">) {
  return (
    <div role="status" {...rest} className={["kit-empty", className ?? ""].filter(Boolean).join(" ")}>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

// The heading block of a page: the one h1, an optional description and the page's actions on the right.
// Every other HTML attribute (data-testid included) lands on its root element.
import type { HTMLAttributes, ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  className,
  ...rest
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children">) {
  return (
    <div {...rest} className={["kit-page-header", className ?? ""].filter(Boolean).join(" ")}>
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="kit-row">{actions}</div> : null}
    </div>
  );
}

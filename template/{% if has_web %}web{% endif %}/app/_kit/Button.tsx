// Button (an action) and ButtonLink (a navigation that looks like a button). Every other HTML attribute passes
// through, data-testid included, so a test can target a kit button directly.
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type Look = { variant?: ButtonVariant; size?: ButtonSize };

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return ["kit-button", `kit-button--${variant}`, size === "sm" ? "kit-button--sm" : "", extra ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classes(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  href,
  className,
  ...rest
}: Look & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <Link href={href} className={classes(variant, size, className)} {...rest} />;
}

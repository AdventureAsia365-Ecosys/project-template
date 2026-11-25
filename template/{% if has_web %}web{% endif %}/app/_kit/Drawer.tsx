"use client";
// Drawer: a side panel over the page for a detail or a short form, without leaving the list. Escape, the close button
// and a click on the overlay close it; focus moves into the panel when it opens and back to where it was on close.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // The latest onClose, so a parent that passes a new function on every render does not re-run the focus effect.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="kit-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="kit-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>
        <div className="kit-drawer-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </>
  );
}

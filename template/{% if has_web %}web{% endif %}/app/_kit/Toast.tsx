"use client";
// Toasts: short confirmations and errors after an action. Wrap the app once in <ToastProvider> (app/layout.tsx); a
// client component calls useToast().show("Saved", "success"). The region is a polite live region, so screen readers
// read each message. A danger toast stays until it is dismissed; the others leave after `durationMs`.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

export type ToastTone = "info" | "success" | "warning" | "danger";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it (app/layout.tsx)");
  return api;
}

function ToastView({ item, durationMs, onDismiss }: { item: ToastItem; durationMs: number; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (item.tone === "danger") return;
    const timer = setTimeout(() => onDismiss(item.id), durationMs);
    return () => clearTimeout(timer);
  }, [item, durationMs, onDismiss]);
  return (
    <div className={`kit-toast kit-toast--${item.tone}`}>
      <span>{item.message}</span>
      <Button variant="ghost" size="sm" onClick={() => onDismiss(item.id)}>
        Dismiss
      </Button>
    </div>
  );
}

export function ToastProvider({ children, durationMs = 5000 }: { children: ReactNode; durationMs?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const api = useMemo<ToastApi>(
    () => ({
      show: (message, tone = "info") => {
        const id = next.current++;
        setItems((all) => [...all, { id, message, tone }]);
      },
    }),
    [],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="kit-toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <ToastView key={item.id} item={item} durationMs={durationMs} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

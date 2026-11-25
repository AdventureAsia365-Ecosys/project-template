"use client";
// The interactive parts of the kit gallery (/kit): a drawer and the toasts.
import { useState } from "react";
import { Button, Drawer, useToast } from "@/app/_kit";

export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <p className="kit-muted">A side panel for a detail or a short form, without leaving the list.</p>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open drawer
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Sample item 01"
        data-testid="kit-sample-drawer"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                toast.show("Sample item 01 saved", "success");
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <p>Details of the selected row go here.</p>
      </Drawer>
    </>
  );
}

export function ToastDemo() {
  const toast = useToast();
  return (
    <>
      <Button onClick={() => toast.show("Something happened", "info")}>Show a toast</Button>
      <Button variant="danger" onClick={() => toast.show("Something failed", "danger")}>
        Show an error
      </Button>
    </>
  );
}

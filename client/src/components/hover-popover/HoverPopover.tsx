/* HoverPopover — generic hover-triggered floating panel. Renders `content`
   through a portal into document.body so it isn't clipped by an ancestor's
   `overflow: hidden` (the PR list table card needs that overflow for its
   rounded corners), positioned from the trigger's own bounding rect. Visual
   tokens (radius/border/shadow/pop-in) match `@devdigest/ui`'s Dropdown. */
"use client";

import React from "react";
import { createPortal } from "react-dom";

/** Delay before closing on mouse-out, so moving from trigger → panel doesn't flicker. */
const CLOSE_DELAY_MS = 120;

export function HoverPopover({
  trigger,
  content,
  width = 340,
}: {
  trigger: React.ReactNode;
  content: React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };

  const openNow = () => {
    clearCloseTimer();
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  React.useEffect(() => clearCloseTimer, []);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      style={{ display: "inline-flex" }}
    >
      {trigger}
      {open &&
        rect &&
        createPortal(
          <div
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: rect.bottom + 6,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
              width,
              maxHeight: 360,
              overflowY: "auto",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 9,
              boxShadow: "var(--shadow-modal)",
              padding: 10,
              zIndex: 1000,
              animation: "ddpop .12s ease",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

export default HoverPopover;

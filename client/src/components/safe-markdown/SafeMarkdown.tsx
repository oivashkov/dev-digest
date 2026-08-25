/* SafeMarkdown — renders repo-authored Markdown (Project Context documents,
   SPEC-01) with the same escaping @devdigest/ui's `Markdown` gives (no raw-
   HTML passthrough — react-markdown escapes by default, no rehype-raw
   plugin), PLUS a link-protocol allowlist `Markdown` doesn't have: a
   document's links are attacker-influenced content, so `javascript:` and any
   other non-http(s) scheme render as inert text instead of a clickable
   anchor. Not built on top of the vendored `Markdown` (do-not-touch) since
   that component has no href-filtering extension point. */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeHref } from "./helpers";

export function SafeMarkdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <p style={{ margin: "0 0 10px" }}>{c}</p>,
          strong: ({ children: c }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{c}</strong>
          ),
          code: ({ children: c }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {c}
            </code>
          ),
          a: ({ children: c, href }) =>
            href && isSafeHref(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
                {c}
              </a>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>{c}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

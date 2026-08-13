import React from "react";
import { Icon } from "../icons";

/** REAL controlled checkbox (styled). Deliberately NOT a `<label>` wrapping
 *  the `<button>`: a `<button>` is a labelable element, and clicking it
 *  directly while nested in a `<label>` can dispatch TWO click events in
 *  some browsers — one from the direct click, one from the label's native
 *  click-forwarding to its labelable descendant. That fired `onChange`
 *  twice per click here, sending two rapid, different-payload requests
 *  wherever this drove a mutation (e.g. the Skills tab's attach checkboxes).
 *  The `<button>` stays the only focusable/keyboard-operable element; the
 *  wrapping `<div>`'s `onClick` is the single handler both a direct click
 *  and a bubbled keyboard activation reach exactly once. */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
}) {
  return (
    <div
      onClick={() => onChange?.(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
          background: checked ? "var(--accent)" : "transparent",
          display: "grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      {label}
    </div>
  );
}

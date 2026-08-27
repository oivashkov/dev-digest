/**
 * Demo fixture #3 (lab06 walkthrough) — tests for formatCents. Coverage is
 * reasonable but not exhaustive on purpose: positive, negative, and zero
 * are covered; a very large amount (e.g. Number.MAX_SAFE_INTEGER cents, or
 * a value that would overflow typical currency displays) is NOT. Whether
 * that omission is worth flagging is a genuine judgment call — see this
 * pair's header comment.
 */
import { describe, it, expect } from "vitest";
import { formatCents } from "./format-currency";

describe("formatCents", () => {
  it("formats a positive amount", () => {
    expect(formatCents(1050)).toBe("$10.50");
  });

  it("formats a negative amount with a leading sign", () => {
    expect(formatCents(-150)).toBe("-$1.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("pads a single-digit remainder", () => {
    expect(formatCents(105)).toBe("$1.05");
  });
});

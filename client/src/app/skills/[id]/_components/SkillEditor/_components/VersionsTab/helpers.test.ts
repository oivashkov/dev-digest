import { describe, it, expect } from "vitest";
import { diffLines } from "./helpers";

describe("diffLines", () => {
  it("marks every line same when the texts are identical", () => {
    const text = "line one\nline two";
    expect(diffLines(text, text)).toEqual([
      { type: "same", text: "line one" },
      { type: "same", text: "line two" },
    ]);
  });

  it("marks an appended line as an add, leaving the rest same", () => {
    const before = "a\nb";
    const after = "a\nb\nc";
    expect(diffLines(before, after)).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "add", text: "c" },
    ]);
  });

  it("marks a removed line as remove", () => {
    const before = "a\nb\nc";
    const after = "a\nc";
    expect(diffLines(before, after)).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("pairs a changed line as a remove + add rather than reusing it as 'same'", () => {
    const before = "a\nold\nc";
    const after = "a\nnew\nc";
    expect(diffLines(before, after)).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "old" },
      { type: "add", text: "new" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles an empty before or after text", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { type: "add", text: "a" },
      { type: "add", text: "b" },
    ]);
    expect(diffLines("a\nb", "")).toEqual([
      { type: "remove", text: "a" },
      { type: "remove", text: "b" },
    ]);
  });
});

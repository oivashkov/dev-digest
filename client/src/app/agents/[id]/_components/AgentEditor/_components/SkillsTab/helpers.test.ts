import { describe, it, expect } from "vitest";
import { buildInitialOrder, moveItem, reorderTo } from "./helpers";

describe("buildInitialOrder", () => {
  it("puts linked skills first, in their order, then the rest", () => {
    expect(buildInitialOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });

  it("handles no linked skills", () => {
    expect(buildInitialOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("moveItem", () => {
  it("swaps with the previous/next neighbor", () => {
    expect(moveItem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at either edge", () => {
    expect(moveItem(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("reorderTo — drag-and-drop drop semantics", () => {
  it("moves the dragged id to sit immediately before the drop target", () => {
    expect(reorderTo(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("works when dragging from later to earlier in the list", () => {
    expect(reorderTo(["a", "b", "c", "d"], "d", "a")).toEqual(["d", "a", "b", "c"]);
  });

  it("is a no-op when dropped on itself", () => {
    expect(reorderTo(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the target isn't in the list", () => {
    expect(reorderTo(["a", "b", "c"], "a", "ghost")).toEqual(["a", "b", "c"]);
  });
});

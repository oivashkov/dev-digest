/**
 * Demo fixture #4 (lab06 walkthrough) — tests for getCachedPrice. See that
 * file's header comment.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCachedPrice, clearPriceCache } from "./price-cache";

describe("getCachedPrice", () => {
  beforeEach(() => clearPriceCache());

  it("fetches and returns the price", async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue(1999) };
    const price = await getCachedPrice("sku-1", "USD", fetcher);
    expect(price).toBe(1999);
    expect(fetcher.fetch).toHaveBeenCalledWith("sku-1", "USD");
  });

  it("returns the cached price on a second call, without fetching again", async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue(1999) };
    await getCachedPrice("sku-1", "USD", fetcher);
    const price = await getCachedPrice("sku-1", "USD", fetcher);
    expect(price).toBe(1999);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches separately for a different product", async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue(2999) };
    const price = await getCachedPrice("sku-2", "USD", fetcher);
    expect(price).toBe(2999);
  });
});

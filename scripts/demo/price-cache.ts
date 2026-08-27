/**
 * Demo fixture #4 (lab06 walkthrough) — isolated, unimported, zero blast
 * radius. Same rule as the other fixtures in this folder: safe to delete
 * after the walkthrough is recorded. Unlike the other three, this one has
 * no explanatory comment pointing at where the issue is — it's meant to
 * test whether a review agent can find it from the code alone.
 */

export interface PriceFetcher {
  fetch(productId: string, currency: string): Promise<number>;
}

const priceCache = new Map<string, number>();

/** Returns the price for `productId` in `currency`, fetching once per
 *  product and caching the result for subsequent calls. */
export async function getCachedPrice(
  productId: string,
  currency: string,
  fetcher: PriceFetcher,
): Promise<number> {
  const cached = priceCache.get(productId);
  if (cached !== undefined) return cached;
  const price = await fetcher.fetch(productId, currency);
  priceCache.set(productId, price);
  return price;
}

export function clearPriceCache(): void {
  priceCache.clear();
}

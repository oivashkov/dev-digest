/**
 * Demo fixture #5 (lab06 walkthrough) — isolated, unimported, zero blast
 * radius. Same rule as the other fixtures in this folder: safe to delete
 * after the walkthrough is recorded.
 *
 * Inspired by a real incident during this walkthrough: a request to an LLM
 * provider with no timeout and no cancellation path hung for ~10 minutes
 * and took the whole dev server process down with it.
 */

export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Calls a provider's completion endpoint and returns the parsed JSON body. */
export async function callProvider(client: HttpClient, url: string, payload: unknown): Promise<unknown> {
  const res = await client.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Provider request failed: ${res.status}`);
  return res.json();
}

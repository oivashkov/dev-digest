/** True for an `http:`/`https:` URL (absolute or protocol-relative), or a
 *  same-document/relative link with no scheme at all (`#section`, `./x`).
 *  Rejects `javascript:`, `data:`, `vbscript:`, and any other scheme. Parsed
 *  against a dummy base so a relative URL doesn't throw in `new URL()`. */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href, "https://dd-safe-markdown.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

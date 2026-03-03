/**
 * Shared URL validation for navigation.
 *
 * Validates that a URL is well-formed and uses an allowed scheme (http/https).
 * Used by both the MCP navigation tool and the FlowRunner to ensure
 * consistent URL validation.
 */

/**
 * Validate a URL for browser navigation.
 * Rejects non-http(s) schemes (e.g., file://, javascript:) and malformed URLs.
 */
export function validateNavigationUrl(url: string): { href: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid URL "${url}"` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Only http: and https: URLs are allowed, got "${parsed.protocol}"` };
  }
  return { href: parsed.href };
}

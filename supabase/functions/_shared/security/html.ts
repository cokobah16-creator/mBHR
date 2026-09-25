// HTML escaping for email bodies built by edge functions.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// Every value that did not come from the function's own template (a code, a
// name, a message typed by staff, a link) must pass through escapeHtml or
// textToHtml before it is placed in an HTML body, so it is shown as text and
// can never add markup, links, images or scripts to the email.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes the five HTML special characters, so the value is safe in element
 * content and in quoted attribute values. null and undefined become "".
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Plain text for an HTML body: escaped, with each line break (\n, \r\n or
 * \r) turned into <br>. The <br> tags are the only markup in the result.
 */
export function textToHtml(text: unknown): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
}

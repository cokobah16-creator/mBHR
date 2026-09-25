// Reading a paged list (Auth logins, staff records) to the end, with a cap.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.

import type { PortError } from "./portTypes.ts";

export interface PagedItems<T> {
  items: T[];
  /**
   * Not every item was read: the page cap was reached with full pages, or a
   * page failed (then `error` is set too).
   */
  truncated: boolean;
  error: PortError | null;
}

/**
 * Calls fetchPage(1), fetchPage(2), ... until a page is shorter than
 * perPage, a page fails, or maxPages pages have been read. Items read before
 * a failure are kept.
 */
export async function pageAll<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; error: PortError | null }>,
  perPage: number,
  maxPages: number,
): Promise<PagedItems<T>> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(page);
    if (result.error) return { items, truncated: true, error: result.error };
    const pageItems = result.items ?? [];
    items.push(...pageItems);
    if (pageItems.length < perPage) return { items, truncated: false, error: null };
  }
  return { items, truncated: true, error: null };
}

/** The inclusive row range of a 1-based page, for `.range(from, to)`. */
export function pageRange(page: number, perPage: number): { from: number; to: number } {
  const from = (page - 1) * perPage;
  return { from, to: from + perPage - 1 };
}

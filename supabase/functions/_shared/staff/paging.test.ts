import { describe, it, expect, vi } from "vitest";
import { pageAll, pageRange } from "./paging";

/** A fake source of `total` numbered items, served perPage at a time. */
function source(total: number, perPage: number) {
  return vi.fn(async (page: number) => {
    const start = (page - 1) * perPage;
    const items = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => start + i);
    return { items, error: null };
  });
}

describe("pageAll", () => {
  it("stops at the first page shorter than perPage", async () => {
    const fetchPage = source(25, 10);
    const result = await pageAll(fetchPage, 10, 20);
    expect(result.items).toHaveLength(25);
    expect(result.items[24]).toBe(24);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeNull();
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("reads one empty page when there is nothing", async () => {
    const fetchPage = source(0, 10);
    const result = await pageAll(fetchPage, 10, 20);
    expect(result).toEqual({ items: [], truncated: false, error: null });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("reads one more (empty) page when the last page is exactly full", async () => {
    const fetchPage = source(20, 10);
    const result = await pageAll(fetchPage, 10, 20);
    expect(result.items).toHaveLength(20);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("sets truncated when maxPages full pages were read", async () => {
    const fetchPage = source(1000, 10);
    const result = await pageAll(fetchPage, 10, 3);
    expect(result.items).toHaveLength(30);
    expect(result.truncated).toBe(true);
    expect(result.error).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops at an error and keeps what was read before it", async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 1
        ? { items: [1, 2], error: null }
        : { items: [], error: { code: "unexpected_failure", status: 500 } },
    );
    const result = await pageAll(fetchPage, 2, 20);
    expect(result.items).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
    expect(result.error).toEqual({ code: "unexpected_failure", status: 500 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("pageRange", () => {
  it("gives the inclusive row range of a 1-based page", () => {
    expect(pageRange(1, 1000)).toEqual({ from: 0, to: 999 });
    expect(pageRange(3, 10)).toEqual({ from: 20, to: 29 });
  });
});

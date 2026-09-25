import { describe, it, expect, vi, afterEach } from "vitest";
import { clearApiCaches, holdsOnlyAppFiles } from "./clearApiCaches";

function fakeCaches(names: string[]) {
  const remaining = new Set(names);
  return {
    remaining,
    keys: vi.fn(async () => [...remaining]),
    delete: vi.fn(async (name: string) => remaining.delete(name)),
  };
}

describe("holdsOnlyAppFiles", () => {
  it("keeps the service worker precache and the CDN cache", () => {
    expect(holdsOnlyAppFiles("workbox-precache-v2-https://mbhr.app/")).toBe(true);
    expect(holdsOnlyAppFiles("jsdelivr")).toBe(true);
  });

  it("treats every other cache as possibly holding server answers", () => {
    expect(holdsOnlyAppFiles("supabase-rest")).toBe(false);
    expect(holdsOnlyAppFiles("supabase-storage")).toBe(false);
    expect(holdsOnlyAppFiles("workbox-runtime-https://mbhr.app/")).toBe(false);
    expect(holdsOnlyAppFiles("jsdelivr-old")).toBe(false);
  });
});

describe("clearApiCaches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the caches that may hold server answers and keeps the app files", async () => {
    const store = fakeCaches([
      "workbox-precache-v2-https://mbhr.app/",
      "jsdelivr",
      "supabase-rest",
      "supabase-storage",
    ]);
    vi.stubGlobal("caches", store);

    await clearApiCaches();

    expect([...store.remaining]).toEqual([
      "workbox-precache-v2-https://mbhr.app/",
      "jsdelivr",
    ]);
  });

  it("does nothing where Cache Storage is unavailable", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearApiCaches()).resolves.toBeUndefined();
  });

  it("never throws when Cache Storage fails", async () => {
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => {
        throw new DOMException("blocked", "SecurityError");
      }),
      delete: vi.fn(),
    });
    await expect(clearApiCaches()).resolves.toBeUndefined();
  });
});

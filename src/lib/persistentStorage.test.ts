import { describe, it, expect, vi } from "vitest";
import { requestPersistentStorage } from "./persistentStorage";

describe("requestPersistentStorage", () => {
  it("does not ask again once storage is persistent", async () => {
    const storage = {
      persisted: vi.fn(async () => true),
      persist: vi.fn(async () => true),
    };
    await expect(requestPersistentStorage(storage)).resolves.toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it("asks when storage may still be cleared by the browser", async () => {
    const storage = {
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => false),
    };
    await expect(requestPersistentStorage(storage)).resolves.toBe(false);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the browser cannot keep storage", async () => {
    await expect(requestPersistentStorage(null)).resolves.toBe(false);
    await expect(
      requestPersistentStorage({} as unknown as StorageManager),
    ).resolves.toBe(false);
  });

  it("never throws", async () => {
    const storage = {
      persisted: vi.fn(async () => {
        throw new DOMException("denied", "SecurityError");
      }),
      persist: vi.fn(),
    };
    await expect(requestPersistentStorage(storage)).resolves.toBe(false);
  });
});

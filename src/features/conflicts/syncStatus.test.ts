import { describe, it, expect } from "vitest";
import { deriveSyncHeadline, type SyncHeadlineInput } from "./syncStatus";

const base: SyncHeadlineInput = {
  configured: true,
  online: true,
  syncing: false,
  waiting: 0,
  failed: 0,
  errorMessage: null,
  conflicts: 0,
  lastSuccessText: "23 Sept 2026, 09:14",
};

describe("deriveSyncHeadline", () => {
  it("says local-only when cloud sync is not configured", () => {
    expect(deriveSyncHeadline({ ...base, configured: false }).title).toBe("Cloud sync is not set up");
  });

  it("reports offline with the waiting count", () => {
    const h = deriveSyncHeadline({ ...base, online: false, waiting: 3 });
    expect(h.title).toBe("Offline");
    expect(h.detail).toContain("3 changes saved on this device");
  });

  it("puts failures ahead of waiting counts", () => {
    const h = deriveSyncHeadline({ ...base, waiting: 4, failed: 1 });
    expect(h.tone).toBe("danger");
    expect(h.title).toBe("1 change failed to upload");
  });

  it("shows waiting changes as a warning", () => {
    const h = deriveSyncHeadline({ ...base, waiting: 2 });
    expect(h.tone).toBe("warning");
    expect(h.title).toBe("2 changes waiting to upload");
  });

  it("never claims success while conflicts are unknown or open", () => {
    expect(deriveSyncHeadline({ ...base, conflicts: null }).tone).toBe("neutral");
    expect(deriveSyncHeadline({ ...base, conflicts: 2 }).title).toBe("2 conflicts to review");
  });

  it("is neutral when no successful sync is recorded", () => {
    const h = deriveSyncHeadline({ ...base, lastSuccessText: null });
    expect(h.tone).toBe("neutral");
    expect(h.detail).toBe("No successful sync recorded on this device yet.");
  });

  it("only uses success when nothing waits, nothing failed and no conflicts are open", () => {
    const h = deriveSyncHeadline(base);
    expect(h.tone).toBe("success");
    expect(h.title).toBe("Nothing waiting to upload");
    expect(h.title).not.toMatch(/all synced/i);
  });

  it("waits for the count before saying anything is clear", () => {
    expect(deriveSyncHeadline({ ...base, waiting: null }).title).toBe("Checking this device…");
  });
});

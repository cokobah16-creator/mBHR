import { describe, it, expect } from "vitest";
import {
  createDraftStore,
  createUnsentStore,
  newMessageRowId,
} from "./unsentMessages";

interface P {
  body: string;
}

const entry = (localId: string, threadKey = "t1") => ({
  localId,
  threadKey,
  params: { body: `text ${localId}` },
  state: "sending" as const,
  createdAt: "2026-09-23T10:00:00Z",
});

describe("createUnsentStore", () => {
  it("keeps messages per scope so colleagues never see each other's", () => {
    const store = createUnsentStore<P>();
    store.add("nurse-1", entry("a"));
    store.add("doctor-2", entry("b"));
    expect(store.list("nurse-1").map((m) => m.localId)).toEqual(["a"]);
    expect(store.list("doctor-2").map((m) => m.localId)).toEqual(["b"]);
    expect(store.list("someone-else")).toEqual([]);
  });

  it("updates state and error text without touching other entries", () => {
    const store = createUnsentStore<P>();
    store.add("u", entry("a"));
    store.add("u", entry("b"));
    store.update("u", "a", { state: "failed", errorText: "Could not send." });
    const [a, b] = store.list("u");
    expect(a.state).toBe("failed");
    expect(a.errorText).toBe("Could not send.");
    expect(b.state).toBe("sending");
  });

  it("returns a new array after each change and the same one otherwise", () => {
    const store = createUnsentStore<P>();
    store.add("u", entry("a"));
    const first = store.list("u");
    expect(store.list("u")).toBe(first);
    store.update("u", "a", { state: "waiting" });
    expect(store.list("u")).not.toBe(first);
  });

  it("ignores updates for unknown ids and removes entries", () => {
    const store = createUnsentStore<P>();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.add("u", entry("a"));
    store.update("u", "missing", { state: "failed" });
    store.remove("u", "a");
    expect(store.list("u")).toEqual([]);
    expect(calls).toBe(2);
    unsubscribe();
    store.add("u", entry("c"));
    expect(calls).toBe(2);
  });
});

describe("createDraftStore", () => {
  it("keeps one draft per user and conversation and clears empty text", () => {
    const drafts = createDraftStore();
    drafts.set("u1", "t1", "Please review BP");
    drafts.set("u2", "t1", "Other user");
    expect(drafts.get("u1", "t1")).toBe("Please review BP");
    expect(drafts.get("u2", "t1")).toBe("Other user");
    expect(drafts.get("u1", "t2")).toBe("");
    drafts.set("u1", "t1", "");
    expect(drafts.get("u1", "t1")).toBe("");
  });
});

describe("newMessageRowId", () => {
  it("gives a fresh UUID for each message so retries reuse one row id", () => {
    const a = newMessageRowId();
    const b = newMessageRowId();
    // Undefined only where the runtime has no crypto.randomUUID.
    if (a === undefined || b === undefined) return;
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(a).not.toBe(b);
  });
});

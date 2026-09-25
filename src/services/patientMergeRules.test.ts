import { describe, it, expect } from "vitest";
import {
  buildFieldChoices,
  checkMerge,
  deviceFieldsForColumns,
  followMergeChain,
  localPatchFromChoices,
  MAX_MERGE_CHAIN,
  mergeCommandArgs,
  mergeCommandPatients,
  mergeRefusalMessage,
  parseMergeResult,
  type MergeCheckInput,
} from "./patientMergeRules";

describe("buildFieldChoices", () => {
  it("maps device fields to server columns with their source", () => {
    const { choices, skipped } = buildFieldChoices([
      { field: "phone", value: " 08030000000 ", source: "loser" },
      { field: "givenName", value: "Ada", source: "loser" },
      { field: "photoUrl", value: "https://example.test/p.jpg", source: "custom" },
    ]);
    expect(choices).toEqual({
      phone: { source: "loser", value: "08030000000" },
      given_name: { source: "loser", value: "Ada" },
      photo_url: { source: "custom", value: "https://example.test/p.jpg" },
    });
    expect(skipped).toEqual([]);
  });

  it("never sends fields a merge may not change, or an empty required field", () => {
    const { choices, skipped } = buildFieldChoices([
      { field: "portalEnabled", value: 1, source: "loser" },
      { field: "mergeInto", value: "X", source: "loser" },
      { field: "familyName", value: "  ", source: "loser" },
      { field: "dob", value: null, source: "loser" },
      { field: "address", value: "", source: "loser" },
      { field: "state", value: { nested: true }, source: "loser" },
    ]);
    // An empty address may be cleared; names and dates of birth may not.
    expect(choices).toEqual({ address: { source: "loser", value: null } });
    expect(skipped).toEqual(["portalEnabled", "mergeInto", "familyName", "dob", "state"]);
  });

  it("sends a date of birth as a calendar day", () => {
    const { choices } = buildFieldChoices([
      { field: "dob", value: new Date("1990-01-15T00:00:00.000Z"), source: "loser" },
    ]);
    expect(choices.dob).toEqual({ source: "loser", value: "1990-01-15" });
  });
});

describe("localPatchFromChoices", () => {
  it("turns server columns back into device fields and ignores unknown ones", () => {
    expect(
      localPatchFromChoices({
        family_name: { source: "loser", value: "Obi" },
        lga: { source: "custom", value: null },
        merged_into: { source: "custom", value: "X" },
        given_name: { source: "loser", value: null },
      }),
    ).toEqual({ familyName: "Obi", lga: null });
  });
});

describe("deviceFieldsForColumns", () => {
  it("names server columns the way this device does and drops unknown ones", () => {
    expect(deviceFieldsForColumns(["phone", "given_name", "merged_into"])).toEqual([
      "phone",
      "givenName",
    ]);
  });
});

describe("followMergeChain", () => {
  it("follows merge links to the record kept", () => {
    const links: Record<string, string> = { A: "B", B: "C" };
    expect(followMergeChain("A", (id) => links[id])).toBe("C");
    expect(followMergeChain("C", (id) => links[id])).toBe("C");
  });

  it("stops on a loop or a very long chain", () => {
    const loop: Record<string, string> = { A: "B", B: "A" };
    expect(followMergeChain("A", (id) => loop[id])).toBe("B");
    const long = (id: string) => `n${Number(id.slice(1)) + 1}`;
    expect(followMergeChain("n0", long)).toBe(`n${MAX_MERGE_CHAIN}`);
  });
});

describe("checkMerge", () => {
  const base: MergeCheckInput = {
    winnerId: "A",
    loserId: "B",
    winnerExists: true,
    loserExists: true,
    winnerRoot: "A",
    loserRoot: "B",
    loserMergeInto: null,
  };

  it("allows a plain merge and keeps the chosen record", () => {
    expect(checkMerge(base)).toEqual({ ok: true, rootId: "A" });
  });

  it("keeps the record the chosen one was merged into", () => {
    expect(checkMerge({ ...base, winnerRoot: "C" })).toEqual({ ok: true, rootId: "C" });
  });

  it("refuses the same record and records missing on this device", () => {
    expect(checkMerge({ ...base, loserId: "A" })).toEqual({ ok: false, reason: "same_record" });
    expect(checkMerge({ ...base, loserExists: false })).toEqual({ ok: false, reason: "not_on_device" });
  });

  it("refuses a merge loop (B -> A after A -> B)", () => {
    expect(checkMerge({ ...base, winnerRoot: "B" })).toEqual({ ok: false, reason: "cycle" });
  });

  it("reports records already merged together", () => {
    expect(checkMerge({ ...base, loserRoot: "A", loserMergeInto: "A" })).toEqual({
      ok: false,
      reason: "already_merged",
    });
  });

  it("refuses to move a record already merged into someone else", () => {
    expect(checkMerge({ ...base, loserRoot: "C", loserMergeInto: "C" })).toEqual({
      ok: false,
      reason: "loser_merged_elsewhere",
    });
  });
});

describe("parseMergeResult", () => {
  it("reads an applied answer", () => {
    const r = parseMergeResult({
      outcome: "applied",
      merge_id: "m1",
      winner_id: "A",
      loser_id: "B",
      merged_at: "2026-09-23T10:00:00Z",
      already_merged: false,
      moved_counts: { vitals: 2, bad: "x" },
      skipped_fields: ["dob", 3],
    });
    expect(r).toEqual({
      outcome: "applied",
      mergeId: "m1",
      winnerId: "A",
      loserId: "B",
      mergedAt: "2026-09-23T10:00:00Z",
      alreadyMerged: false,
      reason: undefined,
      movedCounts: { vitals: 2 },
      skippedFields: ["dob"],
    });
  });

  it("copes with a missing or odd answer", () => {
    expect(parseMergeResult(null).outcome).toBe("unknown");
    expect(parseMergeResult({ outcome: "rejected", reason: "cycle" }).reason).toBe("cycle");
  });
});

describe("command arguments", () => {
  it("uses the RPC's parameter names and reads them back", () => {
    const args = mergeCommandArgs({
      winnerId: "A",
      loserId: "B",
      fieldChoices: {},
      requestedBy: "u1",
      requestedAt: "2026-09-23T10:00:00.000Z",
      source: "conflict_review",
      mergeId: "m1",
    });
    expect(Object.keys(args).sort()).toEqual([
      "p_field_choices",
      "p_loser_id",
      "p_merge_id",
      "p_requested_at",
      "p_requested_by",
      "p_source",
      "p_winner_id",
    ]);
    expect(mergeCommandPatients(args)).toEqual({ winnerId: "A", loserId: "B" });
  });
});

describe("mergeRefusalMessage", () => {
  it("explains each refusal in plain words", () => {
    for (const reason of [
      "not_permitted",
      "permission_denied",
      "same_record",
      "not_on_device",
      "cycle",
      "loser_merged_elsewhere",
      "already_merged",
      "patient_not_on_server",
      "invalid_request",
      "something_else",
    ]) {
      const message = mergeRefusalMessage(reason);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/_/);
    }
  });
});

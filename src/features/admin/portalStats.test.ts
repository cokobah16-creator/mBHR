import { describe, it, expect } from "vitest";
import {
  portalStatusOf,
  computePortalStats,
  percentOf,
  filterPortalPatients,
  isPortalFilter,
  csvCell,
  buildRunCsv,
  groupFailureReasons,
  type PortalPatientFields,
} from "./portalStats";

function patient(over: Partial<PortalPatientFields> = {}): PortalPatientFields {
  return {
    givenName: "Chidi",
    familyName: "Okafor",
    email: null,
    phone: "08031234567",
    portalEnabled: 0,
    contactVerified: 0,
    lastPortalActivity: null,
    portalInvitation: null,
    ...over,
  };
}

describe("portalStatusOf", () => {
  it("separates not enabled, pending and verified", () => {
    expect(portalStatusOf(patient())).toBe("not-enabled");
    expect(portalStatusOf(patient({ portalEnabled: undefined }))).toBe("not-enabled");
    expect(portalStatusOf(patient({ portalEnabled: 1 }))).toBe("pending");
    expect(portalStatusOf(patient({ portalEnabled: 1, contactVerified: 1 }))).toBe("verified");
  });
});

describe("computePortalStats", () => {
  const now = new Date("2026-09-23T12:00:00Z");

  it("counts an empty device as zeros", () => {
    expect(computePortalStats([], now)).toEqual({
      totalPatients: 0,
      portalEnabled: 0,
      verified: 0,
      active30Days: 0,
      invitationsSent: 0,
      pendingVerification: 0,
    });
  });

  it("counts each measure from the records", () => {
    const stats = computePortalStats(
      [
        patient(),
        patient({ portalEnabled: 1, portalInvitation: { count: 2 } }),
        patient({
          portalEnabled: 1,
          contactVerified: 1,
          lastPortalActivity: "2026-09-20T08:00:00Z",
          portalInvitation: { count: 1 },
        }),
        patient({
          portalEnabled: 1,
          contactVerified: 1,
          lastPortalActivity: "2026-07-01T08:00:00Z",
        }),
      ],
      now,
    );
    expect(stats).toEqual({
      totalPatients: 4,
      portalEnabled: 3,
      verified: 2,
      active30Days: 1,
      invitationsSent: 2,
      pendingVerification: 1,
    });
  });
});

describe("percentOf", () => {
  it("returns null instead of dividing by zero", () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 2)).toBe(100);
  });
});

describe("filterPortalPatients", () => {
  const list = [
    patient({ givenName: "Ngozi", email: "ngozi@example.org" }),
    patient({ givenName: "Musa", portalEnabled: 1 }),
    patient({ givenName: "Tunde", portalEnabled: 1, contactVerified: 1, phone: "07011112222" }),
  ];

  it("searches names, email and phone", () => {
    expect(filterPortalPatients(list, "ngo", "all").map((p) => p.givenName)).toEqual(["Ngozi"]);
    expect(filterPortalPatients(list, "EXAMPLE", "all").map((p) => p.givenName)).toEqual(["Ngozi"]);
    expect(filterPortalPatients(list, "0701", "all").map((p) => p.givenName)).toEqual(["Tunde"]);
  });

  it("counts a verified contact only while portal access is on", () => {
    const stats = computePortalStats([
      patient({ portalEnabled: 0, contactVerified: 1 }),
      patient({ portalEnabled: 1, contactVerified: 1 }),
    ]);
    expect(stats.verified).toBe(1);
    expect(stats.portalEnabled).toBe(1);
    const off = [patient({ givenName: "Off", portalEnabled: 0, contactVerified: 1 })];
    expect(filterPortalPatients(off, "", "verified")).toEqual([]);
    expect(filterPortalPatients(off, "", "disabled")).toHaveLength(1);
  });

  it("filters by portal status", () => {
    const names = (f: Parameters<typeof filterPortalPatients>[2]) =>
      filterPortalPatients(list, "", f).map((p) => p.givenName);
    expect(names("all")).toEqual(["Ngozi", "Musa", "Tunde"]);
    expect(names("enabled")).toEqual(["Musa", "Tunde"]);
    expect(names("disabled")).toEqual(["Ngozi"]);
    expect(names("verified")).toEqual(["Tunde"]);
    expect(names("pending")).toEqual(["Musa"]);
  });

  it("recognises filter ids", () => {
    expect(isPortalFilter("pending")).toBe(true);
    expect(isPortalFilter("nope")).toBe(false);
  });
});

describe("run reports", () => {
  it("quotes CSV cells only when needed", () => {
    expect(csvCell("Okafor")).toBe("Okafor");
    expect(csvCell("Okafor, Chidi")).toBe('"Okafor, Chidi"');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  });

  it("stops spreadsheet formulas in CSV cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`);
    expect(csvCell("Ada-Obi")).toBe("Ada-Obi");
  });

  it("lists every patient in the run with the result", () => {
    const csv = buildRunCsv(
      [
        { id: "a", name: "Ada Obi" },
        { id: "b", name: "Bola, Ade" },
      ],
      [{ patientId: "b", error: "Patient not found" }],
    );
    expect(csv.split("\n")).toEqual([
      "Patient ID,Name,Result,Reason",
      "a,Ada Obi,Succeeded,",
      'b,"Bola, Ade",Failed,Patient not found',
    ]);
  });

  it("groups failure reasons, most common first", () => {
    expect(
      groupFailureReasons([
        { patientId: "1", error: "B" },
        { patientId: "2", error: "A" },
        { patientId: "3", error: "B" },
      ]),
    ).toEqual([
      { reason: "B", count: 2 },
      { reason: "A", count: 1 },
    ]);
  });
});

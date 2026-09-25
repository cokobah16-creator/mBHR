// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalSmartScope,
  formatSmartScope,
  intersectScopes,
  intersectScopeSets,
  MAX_SCOPE_LENGTH,
  parseSmartScope,
  parseSmartScopes,
  smartScopeCovers,
} from "../scopes";
import type { SmartScope } from "../types";

function parsed(token: string): SmartScope {
  const r = parseSmartScope(token);
  if (r.ok === false) throw new Error(`expected ${token} to parse, got ${r.error}`);
  return r.scope;
}

function errorOf(token: string): string | null {
  const r = parseSmartScope(token);
  return r.ok === false ? r.error : null;
}

describe("parseSmartScope: SMART v2 resource scopes", () => {
  it("parses context, type and permissions", () => {
    expect(parsed("patient/Observation.rs")).toEqual({
      kind: "resource",
      context: "patient",
      resourceType: "Observation",
      permissions: ["r", "s"],
      constraints: [],
      syntax: "v2",
    });
    expect(parsed("user/Encounter.r")).toMatchObject({ context: "user", resourceType: "Encounter", permissions: ["r"] });
    expect(parsed("system/Patient.cruds")).toMatchObject({ context: "system", permissions: ["c", "r", "u", "d", "s"] });
  });

  it("accepts every in-order subset of c r u d s", () => {
    for (const p of ["c", "r", "u", "d", "s", "rs", "cr", "cud", "cruds", "rd", "us"]) {
      expect(errorOf(`patient/Observation.${p}`)).toBeNull();
      expect(formatSmartScope(parsed(`patient/Observation.${p}`))).toBe(`patient/Observation.${p}`);
    }
  });

  it("parses granular (query) scopes, sorted and deduplicated", () => {
    const s = parsed("patient/Observation.rs?code=x&category=http://terminology.hl7.org/CodeSystem/observation-category|laboratory&code=x");
    expect(s).toMatchObject({
      constraints: [
        { name: "category", value: "http://terminology.hl7.org/CodeSystem/observation-category|laboratory" },
        { name: "code", value: "x" },
      ],
    });
    expect(formatSmartScope(s)).toBe(
      "patient/Observation.rs?category=http://terminology.hl7.org/CodeSystem/observation-category|laboratory&code=x",
    );
  });

  it("parses the non-resource scopes", () => {
    expect(parsed("openid")).toEqual({ kind: "identity", name: "openid" });
    expect(parsed("fhirUser")).toEqual({ kind: "identity", name: "fhirUser" });
    expect(parsed("profile")).toEqual({ kind: "identity", name: "profile" });
    expect(parsed("offline_access")).toEqual({ kind: "access", name: "offline_access" });
    expect(parsed("online_access")).toEqual({ kind: "access", name: "online_access" });
    expect(parsed("launch")).toEqual({ kind: "launch", context: "ehr" });
    expect(parsed("launch/patient")).toEqual({ kind: "launch", context: "patient" });
    expect(parsed("launch/encounter")).toEqual({ kind: "launch", context: "encounter" });
  });
});

describe("parseSmartScope: v1 forms and v1/v2 equivalence", () => {
  it("maps .read to rs, .write to cud and .* to cruds", () => {
    expect(parsed("patient/Observation.read")).toMatchObject({ permissions: ["r", "s"], syntax: "v1" });
    expect(parsed("user/Patient.write")).toMatchObject({ permissions: ["c", "u", "d"], syntax: "v1" });
    expect(parsed("user/*.*")).toMatchObject({ resourceType: "*", permissions: ["c", "r", "u", "d", "s"], syntax: "v1" });
  });

  it("formats v1 scopes in the canonical v2 form", () => {
    expect(canonicalSmartScope("patient/Observation.read")).toBe("patient/Observation.rs");
    expect(canonicalSmartScope("patient/*.read")).toBe("patient/*.rs");
    expect(canonicalSmartScope("user/Patient.write")).toBe("user/Patient.cud");
    expect(canonicalSmartScope("user/*.*")).toBe("user/*.cruds");
    expect(canonicalSmartScope("patient/Observation.rs")).toBe("patient/Observation.rs");
  });

  it("treats a v1 scope and its v2 equivalent as the same grant", () => {
    const v1 = intersectScopes("patient/Observation.read", "patient/Observation.rs", "patient/*.rs");
    const v2 = intersectScopes("patient/Observation.rs", "patient/Observation.read", "patient/*.read");
    expect(v1.granted).toEqual(["patient/Observation.rs"]);
    expect(v2.granted).toEqual(["patient/Observation.rs"]);
    // Requesting both forms grants one scope, not two.
    expect(intersectScopes("patient/Observation.read patient/Observation.rs", "patient/*.rs", "patient/*.rs").granted).toEqual([
      "patient/Observation.rs",
    ]);
  });

  it("refuses a query on a v1 scope (granular scopes are v2 only)", () => {
    expect(errorOf("patient/Observation.read?category=laboratory")).toBe("query_not_allowed_in_v1");
  });
});

describe("parseSmartScope: malformed input is refused, never repaired", () => {
  const cases: [string, string][] = [
    ["", "empty"],
    [" openid", "invalid_characters"],
    ["openid ", "invalid_characters"],
    ["patient/Observation.rs launch", "invalid_characters"],
    ["patient/Observation.rs\n", "invalid_characters"],
    ["patient/Observação.rs", "invalid_characters"],
    ['patient/Observation.rs?code="x"', "invalid_characters"],
    ["OpenID", "unknown_scope"],
    ["email", "unknown_scope"],
    ["read", "unknown_scope"],
    ["Patient/Observation.rs", "invalid_context"],
    ["practitioner/Observation.rs", "invalid_context"],
    ["/Observation.rs", "invalid_context"],
    ["patient/Observation", "missing_permissions"],
    ["patient/Observation.", "missing_permissions"],
    ["patient/*", "missing_permissions"],
    ["patient/.rs", "invalid_resource_type"],
    ["patient/observation.rs", "invalid_resource_type"],
    ["patient/Observation1.rs", "invalid_resource_type"],
    ["patient/O.rs", "invalid_resource_type"],
    ["patient/Observation.rs.x", "invalid_permissions"],
    ["patient/Observation.rx", "invalid_permissions"],
    ["patient/Observation.READ", "invalid_permissions"],
    ["patient/Observation.readwrite", "invalid_permissions"],
    ["patient/Observation.rr", "invalid_permissions"],
    ["patient/Observation.sr", "permissions_out_of_order"],
    ["patient/Observation.dc", "permissions_out_of_order"],
    ["patient/Observation.rs?", "invalid_query"],
    ["patient/Observation.rs?category", "invalid_query"],
    ["patient/Observation.rs?=laboratory", "invalid_query"],
    ["patient/Observation.rs?category=", "invalid_query"],
    ["patient/Observation.rs?a=b&&c=d", "invalid_query"],
    ["patient/Observation.rs?a=b?c=d", "invalid_query"],
    ["patient/Observation.rs?a=b=c", "invalid_query"],
    ["patient/Observation.rs?a=b#frag", "invalid_query"],
    ["patient/Observation.rs?1a=b", "invalid_query"],
    ["launch/practitioner", "unsupported_launch_context"],
    ["launch/", "unsupported_launch_context"],
  ];
  for (const [token, error] of cases) {
    it(`${JSON.stringify(token)} -> ${error}`, () => {
      expect(errorOf(token)).toBe(error);
    });
  }

  it("refuses over-long tokens and too many constraints", () => {
    expect(errorOf(`patient/Observation.rs?code=${"x".repeat(MAX_SCOPE_LENGTH)}`)).toBe("too_long");
    const eleven = Array.from({ length: 11 }, (_, i) => `code=c${i}`).join("&");
    expect(errorOf(`patient/Observation.rs?${eleven}`)).toBe("invalid_query");
    const ten = Array.from({ length: 10 }, (_, i) => `code=c${i}`).join("&");
    expect(errorOf(`patient/Observation.rs?${ten}`)).toBeNull();
  });

  it("does not treat inherited object keys as scopes", () => {
    expect(errorOf("constructor")).toBe("unknown_scope");
    expect(errorOf("__proto__")).toBe("unknown_scope");
    expect(errorOf("toString")).toBe("unknown_scope");
  });
});

describe("parseSmartScope: wildcards only where the spec allows", () => {
  it("allows * as the whole resource type", () => {
    expect(parsed("patient/*.rs")).toMatchObject({ resourceType: "*" });
    expect(parsed("user/*.read")).toMatchObject({ resourceType: "*" });
    expect(parsed("system/*.rs?_security=R")).toMatchObject({ resourceType: "*" });
  });

  it("allows .* only as the v1 permission", () => {
    expect(parsed("patient/Observation.*")).toMatchObject({ permissions: ["c", "r", "u", "d", "s"] });
  });

  it("refuses every other wildcard", () => {
    for (const token of [
      "*",
      "*.read",
      "*/Observation.rs",
      "*/*.*",
      "patient*/Observation.rs",
      "patient/Obs*.rs",
      "patient/*Observation.rs",
      "patient/**.rs",
      "patient/Obs*",
      "patient/Observation.r*",
      "patient/Observation.*s",
      "launch/*",
    ]) {
      expect([token, errorOf(token)]).toEqual([token, "invalid_wildcard"]);
    }
  });
});

describe("parseSmartScopes", () => {
  it("splits on spaces, ignores empty tokens and reports the malformed ones", () => {
    const r = parseSmartScopes("openid  fhirUser patient/Observation.read bogus patient/Obs*.rs");
    expect(r.scopes.map(formatSmartScope)).toEqual(["openid", "fhirUser", "patient/Observation.rs"]);
    expect(r.invalid).toEqual([
      { scope: "bogus", error: "unknown_scope" },
      { scope: "patient/Obs*.rs", error: "invalid_wildcard" },
    ]);
  });

  it("takes a list token by token (a list element with a space is malformed)", () => {
    const r = parseSmartScopes(["openid", "launch/patient", "openid fhirUser"]);
    expect(r.scopes.map(formatSmartScope)).toEqual(["openid", "launch/patient"]);
    expect(r.invalid).toEqual([{ scope: "openid fhirUser", error: "invalid_characters" }]);
  });
});

describe("intersectScopes", () => {
  it("grants a scope only when request, client and user all allow it", () => {
    const r = intersectScopes(
      "openid fhirUser launch/patient patient/Patient.rs patient/Observation.rs",
      "openid fhirUser launch/patient patient/Patient.rs patient/Observation.rs",
      "openid fhirUser launch/patient patient/Patient.rs",
    );
    expect(r.granted).toEqual(["fhirUser", "launch/patient", "openid", "patient/Patient.rs"]);
    expect(r.refused).toEqual([{ scope: "patient/Observation.rs", reason: "not_allowed", by: "user" }]);
  });

  it("says which limit refused a scope, the client first", () => {
    const r = intersectScopes("offline_access patient/Observation.rs", "patient/Patient.rs", "offline_access patient/*.rs");
    expect(r.granted).toEqual([]);
    expect(r.refused).toEqual([
      { scope: "offline_access", reason: "not_allowed", by: "client" },
      { scope: "patient/Observation.rs", reason: "not_allowed", by: "client" },
    ]);
  });

  it("narrows permissions to the common ones", () => {
    expect(intersectScopes("patient/Observation.cruds", "patient/Observation.rs", "patient/Observation.r").granted).toEqual([
      "patient/Observation.r",
    ]);
    expect(intersectScopes("patient/Observation.rs", "patient/Observation.cud", "patient/*.cruds").refused).toEqual([
      { scope: "patient/Observation.rs", reason: "not_allowed", by: "client" },
    ]);
  });

  it("expands a requested * only to the types the limits name", () => {
    const r = intersectScopes("patient/*.rs", "patient/Observation.rs patient/Patient.r", "patient/*.rs");
    expect(r.granted).toEqual(["patient/Observation.rs", "patient/Patient.r"]);
  });

  it("narrows a limit's * to the requested type", () => {
    expect(intersectScopes("patient/Observation.rs", "patient/*.r", "patient/*.rs").granted).toEqual(["patient/Observation.r"]);
  });

  it("grants * only when all three are *", () => {
    expect(intersectScopes("patient/*.rs", "patient/*.rs", "patient/*.r").granted).toEqual(["patient/*.r"]);
  });

  it("lets user/ satisfy a patient/ request, never the reverse widening", () => {
    // patient/ is the narrower context: the result stays patient/.
    expect(intersectScopes("patient/Observation.rs", "user/Observation.rs", "user/*.rs").granted).toEqual([
      "patient/Observation.rs",
    ]);
    // A user/ request against a patient/ limit is narrowed to patient/.
    expect(intersectScopes("user/Observation.rs", "patient/Observation.rs", "user/*.rs").granted).toEqual([
      "patient/Observation.rs",
    ]);
  });

  it("never mixes system/ with user/ or patient/", () => {
    expect(intersectScopes("system/Observation.rs", "user/*.rs", "user/*.rs").refused).toEqual([
      { scope: "system/Observation.rs", reason: "not_allowed", by: "client" },
    ]);
    expect(intersectScopes("patient/Observation.rs", "system/*.rs", "patient/*.rs").granted).toEqual([]);
    expect(intersectScopes("system/Observation.rs", "system/*.rs", "system/Observation.r").granted).toEqual([
      "system/Observation.r",
    ]);
  });

  it("keeps constraints and combines them with AND", () => {
    expect(
      intersectScopes("patient/Observation.rs?category=laboratory", "patient/Observation.rs", "patient/*.rs").granted,
    ).toEqual(["patient/Observation.rs?category=laboratory"]);
    expect(
      intersectScopes("patient/Observation.rs", "patient/Observation.rs?category=vital-signs", "patient/*.rs").granted,
    ).toEqual(["patient/Observation.rs?category=vital-signs"]);
    expect(
      intersectScopes(
        "patient/Observation.rs?category=laboratory",
        "patient/Observation.rs?category=vital-signs",
        "patient/*.rs",
      ).granted,
    ).toEqual(["patient/Observation.rs?category=laboratory&category=vital-signs"]);
    expect(intersectScopes("patient/*.rs?_security=R", "patient/Observation.rs", "patient/*.rs").granted).toEqual([
      "patient/Observation.rs?_security=R",
    ]);
  });

  it("requires exact matches for non-resource scopes", () => {
    const r = intersectScopes("openid fhirUser profile launch offline_access", "openid profile launch/patient online_access", "openid fhirUser profile launch offline_access online_access");
    expect(r.granted).toEqual(["openid", "profile"]);
    expect(r.refused.map((x) => x.scope)).toEqual(["fhirUser", "launch", "offline_access"]);
  });

  it("refuses malformed requested scopes and ignores malformed limit entries", () => {
    const r = intersectScopes("patient/Obs*.rs patient/Observation.rs", "patient/* patient/Observation.rs", "patient/*.rs");
    expect(r.granted).toEqual(["patient/Observation.rs"]);
    expect(r.refused).toEqual([{ scope: "patient/Obs*.rs", reason: "malformed", error: "invalid_wildcard" }]);
    // A malformed client entry allows nothing.
    expect(intersectScopes("patient/Observation.rs", "patient/*", "patient/*.rs").granted).toEqual([]);
    expect(intersectScopes("patient/Observation.rs", "PATIENT/*.rs", "patient/*.rs").granted).toEqual([]);
  });

  it("returns nothing for empty inputs", () => {
    expect(intersectScopes("", "patient/*.rs", "patient/*.rs")).toEqual({ granted: [], refused: [] });
    expect(intersectScopes("patient/Observation.rs", "", "patient/*.rs").granted).toEqual([]);
    expect(intersectScopes("patient/Observation.rs", "patient/*.rs", []).granted).toEqual([]);
  });

  it("drops grants another grant already covers, and duplicates", () => {
    const r = intersectScopes(
      "patient/Observation.r patient/Observation.rs patient/Observation.rs patient/Observation.rs?category=laboratory",
      "patient/*.rs",
      "patient/*.rs",
    );
    expect(r.granted).toEqual(["patient/Observation.rs"]);
    expect(r.refused).toEqual([]);
  });

  it("does not modify its inputs", () => {
    const requested = ["patient/Observation.rs", "openid"];
    const client = ["patient/*.rs", "openid"];
    const user = ["patient/*.rs", "openid"];
    const copies = [requested, client, user].map((a) => [...a]);
    intersectScopes(requested, client, user);
    expect([requested, client, user]).toEqual(copies);
  });
});

describe("intersectScopeSets", () => {
  it("applies consent as one more limit, and an absent permit grants nothing", () => {
    const limits = [
      { name: "client", scopes: "patient/*.rs launch/patient" },
      { name: "user", scopes: "patient/*.rs launch/patient" },
    ];
    const withConsent = intersectScopeSets("launch/patient patient/Observation.rs patient/DocumentReference.rs", [
      ...limits,
      { name: "consent", scopes: "launch/patient patient/Observation.rs" },
    ]);
    expect(withConsent.granted).toEqual(["launch/patient", "patient/Observation.rs"]);
    expect(withConsent.refused).toEqual([{ scope: "patient/DocumentReference.rs", reason: "not_allowed", by: "consent" }]);

    const noPermit = intersectScopeSets("patient/Observation.rs", [...limits, { name: "consent", scopes: [] }]);
    expect(noPermit.granted).toEqual([]);
    expect(noPermit.refused).toEqual([{ scope: "patient/Observation.rs", reason: "not_allowed", by: "consent" }]);
  });

  it("refuses to run with no limits instead of granting the request as is", () => {
    expect(() => intersectScopeSets("patient/*.rs", [])).toThrow();
  });
});

describe("smartScopeCovers", () => {
  it("compares context, type, permissions and constraints", () => {
    expect(smartScopeCovers(parsed("user/*.rs"), parsed("patient/Observation.r"))).toBe(true);
    expect(smartScopeCovers(parsed("patient/*.rs"), parsed("user/Observation.r"))).toBe(false);
    expect(smartScopeCovers(parsed("patient/Observation.r"), parsed("patient/Observation.rs"))).toBe(false);
    expect(smartScopeCovers(parsed("patient/Observation.rs"), parsed("patient/Observation.rs?code=x"))).toBe(true);
    expect(smartScopeCovers(parsed("patient/Observation.rs?code=x"), parsed("patient/Observation.rs"))).toBe(false);
    expect(smartScopeCovers(parsed("system/*.rs"), parsed("patient/Observation.r"))).toBe(false);
    expect(smartScopeCovers(parsed("openid"), parsed("openid"))).toBe(true);
    expect(smartScopeCovers(parsed("launch"), parsed("launch/patient"))).toBe(false);
    expect(smartScopeCovers(parsed("user/*.cruds"), parsed("openid"))).toBe(false);
  });
});

describe("intersection never widens (generated cases)", () => {
  // Deterministic pseudo-random generator so failures are reproducible.
  let seed = 0x5eed;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const pick = <T,>(list: readonly T[]): T => list[next() % list.length];

  const contexts = ["patient", "user", "system"];
  const types = ["*", "Patient", "Observation", "Encounter", "DocumentReference"];
  const perms = ["r", "s", "rs", "cruds", "cud", "read", "write", "*", "rd"];
  const queries = ["", "", "", "?category=laboratory", "?code=a", "?category=vital-signs&code=b"];
  const simple = ["openid", "fhirUser", "profile", "launch", "launch/patient", "launch/encounter", "offline_access", "online_access"];
  const malformed = ["patient/Obs*.rs", "patient/*", "bogus", "patient/Observation.sr", "*/*.*"];

  const scope = (): string => {
    const roll = next() % 10;
    if (roll === 0) return pick(simple);
    if (roll === 1) return pick(malformed);
    const p = pick(perms);
    const v1 = p === "read" || p === "write" || p === "*";
    return `${pick(contexts)}/${pick(types)}.${p}${v1 ? "" : pick(queries)}`;
  };
  const list = (): string[] => Array.from({ length: 1 + (next() % 6) }, scope);

  const covered = (granted: SmartScope, sources: string[]): boolean =>
    parseSmartScopes(sources).scopes.some((s) => smartScopeCovers(s, granted));

  it("every granted scope is covered by the request, the client and the user", () => {
    let grants = 0;
    for (let i = 0; i < 400; i++) {
      const requested = list();
      const client = list();
      const user = list();
      const r = intersectScopes(requested, client, user);
      for (const text of r.granted) {
        grants++;
        const g = parsed(text);
        expect([text, covered(g, requested), covered(g, client), covered(g, user)]).toEqual([text, true, true, true]);
      }
      // Output is canonical, sorted, and has no redundant entries.
      expect(r.granted).toEqual([...r.granted].sort());
      for (const text of r.granted) expect(canonicalSmartScope(text)).toBe(text);
      const gs = r.granted.map(parsed);
      gs.forEach((a, i) => gs.forEach((b, j) => {
        if (i !== j) expect([r.granted[i], r.granted[j], smartScopeCovers(a, b)]).toEqual([r.granted[i], r.granted[j], false]);
      }));
      // Adding a limit can only remove grants, never add one.
      const narrower = intersectScopeSets(requested, [
        { name: "client", scopes: client },
        { name: "user", scopes: user },
        { name: "consent", scopes: list() },
      ]);
      for (const text of narrower.granted) {
        const g = parsed(text);
        expect([text, r.granted.map(parsed).some((w) => smartScopeCovers(w, g))]).toEqual([text, true]);
      }
    }
    // The generator must actually exercise grants, not only refusals.
    expect(grants).toBeGreaterThan(50);
  });

  it("is order-independent in the limits", () => {
    for (let i = 0; i < 200; i++) {
      const requested = list();
      const a = list();
      const b = list();
      expect(intersectScopes(requested, a, b).granted).toEqual(intersectScopes(requested, b, a).granted);
    }
  });
});

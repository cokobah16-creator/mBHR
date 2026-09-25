// SMART scope parsing and intersection: pure functions, no I/O.
//
// Prepared for a future SMART App Launch 2.x authorization server
// (docs/interoperability/smart-auth-design.md). Nothing calls this from a
// route, and the gateway refuses SMART_ENABLED in this release.
//
// Grammar accepted (anything else is refused, never guessed at):
//
//   <context>/<type>.<permissions>[?<name>=<value>[&...]]
//     context      patient | user | system
//     type         a FHIR resource type name, or "*" (the only wildcard)
//     permissions  v2: one or more of c r u d s, in that order, no repeats
//                  v1: read (= rs), write (= cud), * (= cruds); no query
//   launch, launch/patient, launch/encounter
//   openid, fhirUser, profile, offline_access, online_access
//
// A granted scope must be allowed by the request AND by every limit (the
// client registration, the user's permissions, and later consent). The
// intersection can only narrow: fewer permissions, a specific type in place
// of "*", added constraints, or patient/ in place of user/. It never adds.

import type {
  SmartPermission,
  SmartResourceScope,
  SmartScope,
  SmartScopeConstraint,
  SmartScopeContext,
  SmartScopeInput,
  SmartScopeIntersection,
  SmartScopeLimit,
  SmartScopeParseError,
  SmartScopeParseResult,
  SmartScopeRefusal,
} from "./types";

/** Longest single scope token accepted. */
export const MAX_SCOPE_LENGTH = 512;
/** Most name=value pairs in one granular scope. */
export const MAX_SCOPE_CONSTRAINTS = 10;

const PERMISSION_ORDER: readonly SmartPermission[] = ["c", "r", "u", "d", "s"];
const CONTEXTS: readonly SmartScopeContext[] = ["patient", "user", "system"];
const RESOURCE_TYPE = /^[A-Z][A-Za-z]{1,63}$/;
/** Printable ASCII without space: a scope token (RFC 6749 scope-token is
 *  %x21 / %x23-5B / %x5D-7E, i.e. no space, double quote or backslash). */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const V2_PERMISSIONS = /^c?r?u?d?s?$/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}(?::[A-Za-z][A-Za-z-]{0,31})?$/;
const PARAM_VALUE = /^[^&#?=]{1,256}$/;

const V1_PERMISSIONS: Readonly<Record<string, readonly SmartPermission[]>> = {
  read: ["r", "s"],
  write: ["c", "u", "d"],
  "*": ["c", "r", "u", "d", "s"],
};

const SIMPLE_SCOPES: Readonly<Record<string, SmartScope>> = {
  openid: { kind: "identity", name: "openid" },
  fhirUser: { kind: "identity", name: "fhirUser" },
  profile: { kind: "identity", name: "profile" },
  offline_access: { kind: "access", name: "offline_access" },
  online_access: { kind: "access", name: "online_access" },
  launch: { kind: "launch", context: "ehr" },
  "launch/patient": { kind: "launch", context: "patient" },
  "launch/encounter": { kind: "launch", context: "encounter" },
};

function fail(error: SmartScopeParseError): SmartScopeParseResult {
  return { ok: false, error };
}

function parseConstraints(query: string): SmartScopeConstraint[] | null {
  if (query === "") return null;
  const parts = query.split("&");
  if (parts.length > MAX_SCOPE_CONSTRAINTS) return null;
  const out: SmartScopeConstraint[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!PARAM_NAME.test(name) || !PARAM_VALUE.test(value)) return null;
    out.push({ name, value });
  }
  return normaliseConstraints(out);
}

function compareConstraints(a: SmartScopeConstraint, b: SmartScopeConstraint): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.value !== b.value) return a.value < b.value ? -1 : 1;
  return 0;
}

function normaliseConstraints(list: readonly SmartScopeConstraint[]): SmartScopeConstraint[] {
  const sorted = [...list].sort(compareConstraints);
  return sorted.filter((c, i) => i === 0 || compareConstraints(sorted[i - 1], c) !== 0);
}

function parsePermissions(
  text: string,
  hasQuery: boolean,
): { ok: true; permissions: readonly SmartPermission[]; syntax: "v1" | "v2" } | { ok: false; error: SmartScopeParseError } {
  if (text === "") return { ok: false, error: "missing_permissions" };
  const v1 = V1_PERMISSIONS[text];
  if (v1 !== undefined) {
    if (hasQuery) return { ok: false, error: "query_not_allowed_in_v1" };
    return { ok: true, permissions: v1, syntax: "v1" };
  }
  if (text.includes("*")) return { ok: false, error: "invalid_wildcard" };
  if (!/^[cruds]+$/.test(text)) return { ok: false, error: "invalid_permissions" };
  if (new Set(text).size !== text.length) return { ok: false, error: "invalid_permissions" };
  if (!V2_PERMISSIONS.test(text)) return { ok: false, error: "permissions_out_of_order" };
  return { ok: true, permissions: text.split("") as SmartPermission[], syntax: "v2" };
}

/**
 * Parse one scope token. Malformed input is refused with a reason; nothing
 * is repaired, lower-cased or guessed.
 */
export function parseSmartScope(token: string): SmartScopeParseResult {
  if (typeof token !== "string" || token === "") return fail("empty");
  if (token.length > MAX_SCOPE_LENGTH) return fail("too_long");
  if (!SCOPE_TOKEN.test(token)) return fail("invalid_characters");

  const simple = Object.prototype.hasOwnProperty.call(SIMPLE_SCOPES, token) ? SIMPLE_SCOPES[token] : undefined;
  if (simple !== undefined) return { ok: true, scope: { ...simple } };

  const slash = token.indexOf("/");
  if (slash < 0) return fail(token.includes("*") ? "invalid_wildcard" : "unknown_scope");
  const contextText = token.slice(0, slash);
  const rest = token.slice(slash + 1);

  if (contextText === "launch") {
    return fail(rest.includes("*") ? "invalid_wildcard" : "unsupported_launch_context");
  }
  if (!(CONTEXTS as readonly string[]).includes(contextText)) {
    return fail(contextText.includes("*") ? "invalid_wildcard" : "invalid_context");
  }
  const context = contextText as SmartScopeContext;

  const q = rest.indexOf("?");
  const body = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? null : rest.slice(q + 1);

  const dot = body.indexOf(".");
  if (dot < 0) return fail(body.includes("*") && body !== "*" ? "invalid_wildcard" : "missing_permissions");
  const resourceType = body.slice(0, dot);
  const permissionText = body.slice(dot + 1);

  if (resourceType !== "*") {
    if (resourceType.includes("*")) return fail("invalid_wildcard");
    if (!RESOURCE_TYPE.test(resourceType)) return fail("invalid_resource_type");
  }

  const perms = parsePermissions(permissionText, query !== null);
  if (perms.ok === false) return fail(perms.error);

  let constraints: SmartScopeConstraint[] = [];
  if (query !== null) {
    const parsed = parseConstraints(query);
    if (parsed === null) return fail("invalid_query");
    constraints = parsed;
  }

  const scope: SmartResourceScope = {
    kind: "resource",
    context,
    resourceType,
    permissions: perms.permissions,
    constraints,
    syntax: perms.syntax,
  };
  return { ok: true, scope };
}

/** Split an OAuth `scope` string on spaces; a list is taken token by token. */
function tokens(input: SmartScopeInput): string[] {
  const list = typeof input === "string" ? input.split(" ") : [...input];
  return list.filter((t) => t !== "");
}

/** Parse a space-separated scope string or a list of scope tokens. */
export function parseSmartScopes(input: SmartScopeInput): {
  scopes: SmartScope[];
  invalid: { scope: string; error: SmartScopeParseError }[];
} {
  const scopes: SmartScope[] = [];
  const invalid: { scope: string; error: SmartScopeParseError }[] = [];
  for (const t of tokens(input)) {
    const r = parseSmartScope(t);
    if (r.ok === false) invalid.push({ scope: t, error: r.error });
    else scopes.push(r.scope);
  }
  return { scopes, invalid };
}

/** The canonical (SMART v2) text of a scope. */
export function formatSmartScope(scope: SmartScope): string {
  switch (scope.kind) {
    case "resource": {
      const base = `${scope.context}/${scope.resourceType}.${scope.permissions.join("")}`;
      if (scope.constraints.length === 0) return base;
      return `${base}?${scope.constraints.map((c) => `${c.name}=${c.value}`).join("&")}`;
    }
    case "launch":
      return scope.context === "ehr" ? "launch" : `launch/${scope.context}`;
    case "identity":
    case "access":
      return scope.name;
  }
}

/** Canonical v2 text of a scope token, or null when it is malformed. */
export function canonicalSmartScope(token: string): string | null {
  const r = parseSmartScope(token);
  return r.ok === false ? null : formatSmartScope(r.scope);
}

/** patient/ is narrower than user/ (the in-context patient only, among what
 *  the user may see). system/ stands alone: it has no user. */
function contextCovers(outer: SmartScopeContext, inner: SmartScopeContext): boolean {
  return outer === inner || (outer === "user" && inner === "patient");
}

function meetContext(a: SmartScopeContext, b: SmartScopeContext): SmartScopeContext | null {
  if (contextCovers(a, b)) return b;
  if (contextCovers(b, a)) return a;
  return null;
}

/**
 * True when everything `inner` allows is also allowed by `outer`.
 * Used to drop redundant grants and, in tests, to prove nothing widened.
 */
export function smartScopeCovers(outer: SmartScope, inner: SmartScope): boolean {
  if (outer.kind === "resource" && inner.kind === "resource") {
    if (!contextCovers(outer.context, inner.context)) return false;
    if (outer.resourceType !== "*" && outer.resourceType !== inner.resourceType) return false;
    if (!inner.permissions.every((p) => outer.permissions.includes(p))) return false;
    // Every restriction of the outer scope must also restrict the inner one.
    return outer.constraints.every((oc) => inner.constraints.some((ic) => compareConstraints(oc, ic) === 0));
  }
  if (outer.kind === "resource" || inner.kind === "resource") return false;
  return formatSmartScope(outer) === formatSmartScope(inner);
}

/** The largest scope allowed by both `a` and `b`, or null if none. */
function meet(a: SmartScope, b: SmartScope): SmartScope | null {
  if (a.kind === "resource" && b.kind === "resource") {
    const context = meetContext(a.context, b.context);
    if (context === null) return null;
    let resourceType: string;
    if (a.resourceType === "*") resourceType = b.resourceType;
    else if (b.resourceType === "*" || b.resourceType === a.resourceType) resourceType = a.resourceType;
    else return null;
    const permissions = PERMISSION_ORDER.filter((p) => a.permissions.includes(p) && b.permissions.includes(p));
    if (permissions.length === 0) return null;
    // Constraints combine with AND: the result is at least as narrow as both.
    const constraints = normaliseConstraints([...a.constraints, ...b.constraints]);
    return { kind: "resource", context, resourceType, permissions, constraints, syntax: "v2" };
  }
  if (a.kind === "resource" || b.kind === "resource") return null;
  return formatSmartScope(a) === formatSmartScope(b) ? a : null;
}

/** Deduplicate, then drop any scope another one already covers. */
function reduce(scopes: readonly SmartScope[]): SmartScope[] {
  const byText = new Map<string, SmartScope>();
  for (const s of scopes) {
    const text = formatSmartScope(s);
    if (!byText.has(text)) byText.set(text, s);
  }
  const unique = [...byText.values()];
  return unique.filter((s, i) => !unique.some((o, j) => j !== i && smartScopeCovers(o, s)));
}

/**
 * Intersect the requested scopes with every limit. A scope is granted only
 * where the request and all limits allow it. Malformed limit entries allow
 * nothing; malformed requested scopes are refused. With no limits at all
 * nothing is checked, so this throws rather than grant the request as is.
 */
export function intersectScopeSets<N extends string>(
  requested: SmartScopeInput,
  limits: readonly SmartScopeLimit<N>[],
): SmartScopeIntersection<N> {
  if (limits.length === 0) throw new Error("intersectScopeSets needs at least one limit");
  const limitScopes = limits.map((l) => parseSmartScopes(l.scopes).scopes);
  const refused: SmartScopeRefusal<N>[] = [];
  const pool: SmartScope[] = [];
  const seenRaw = new Set<string>();
  const seenCanonical = new Set<string>();

  for (const raw of tokens(requested)) {
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const parsed = parseSmartScope(raw);
    if (parsed.ok === false) {
      refused.push({ scope: raw, reason: "malformed", error: parsed.error });
      continue;
    }
    const canonical = formatSmartScope(parsed.scope);
    if (seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);

    let current: SmartScope[] = [parsed.scope];
    let refusedBy: N | null = null;
    for (let i = 0; i < limits.length; i++) {
      const next: SmartScope[] = [];
      for (const c of current) {
        for (const l of limitScopes[i]) {
          const m = meet(c, l);
          if (m !== null) next.push(m);
        }
      }
      current = reduce(next);
      if (current.length === 0) {
        refusedBy = limits[i].name;
        break;
      }
    }
    if (refusedBy !== null) refused.push({ scope: raw, reason: "not_allowed", by: refusedBy });
    else pool.push(...current);
  }

  const granted = reduce(pool).map(formatSmartScope).sort();
  return { granted, refused };
}

/**
 * requested x client-allowed x user-permitted. Consent, when it applies, is
 * one more limit: use intersectScopeSets with a "consent" limit (an absent
 * permit is an empty list, which grants nothing).
 */
export function intersectScopes(
  requested: SmartScopeInput,
  clientAllowed: SmartScopeInput,
  userPermitted: SmartScopeInput,
): SmartScopeIntersection<"client" | "user"> {
  return intersectScopeSets<"client" | "user">(requested, [
    { name: "client", scopes: clientAllowed },
    { name: "user", scopes: userPermitted },
  ]);
}

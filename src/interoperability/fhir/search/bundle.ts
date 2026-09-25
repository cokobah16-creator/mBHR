// Searchset Bundles. Links are absolute URLs under the configured base URL,
// built from the parameters the server actually applied (unknown ones were
// already refused), so a client can follow them without re-deriving state.
//
// Bundle.total is never sent: a count could only be computed by reading
// rows the caller may not see, and a count of what they may see would need
// a second full query per page. Clients page with the next link.
//
// Informational notes (a merged-away patient, what a resource type does not
// cover, records withheld because they failed validation) travel as one
// OperationOutcome entry with search.mode "outcome".

import type { Bundle, BundleEntry, OperationOutcomeIssue, Resource } from "../types/fhir";
import { encodeCursor, type Cursor } from "./params";

export interface SearchPage<T extends Resource> {
  resources: T[];
  next: Cursor | null;
}

export function searchsetBundle<T extends Resource>(opts: {
  baseUrl: string;
  resourceType: string;
  query: URLSearchParams;
  count: number;
  page: SearchPage<T>;
  now?: Date;
  /** Binds the next cursor to this search (see cursorBinding in params.ts). */
  cursorBinding?: string;
  outcomes?: OperationOutcomeIssue[];
  /** A fresh uuid for the outcome entry's fullUrl. */
  newId?: () => string;
}): Bundle {
  const { baseUrl, resourceType, query, count, page } = opts;
  const link: Bundle["link"] = [
    { relation: "self", url: pageUrl(baseUrl, resourceType, query, count, undefined) },
  ];
  if (page.next) {
    link.push({
      relation: "next",
      url: pageUrl(baseUrl, resourceType, query, count, encodeCursor(page.next, opts.cursorBinding)),
    });
  }
  const entry: BundleEntry[] = page.resources.map((resource) => ({
    fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`,
    resource,
    search: { mode: "match" as const },
  }));
  if (opts.outcomes?.length) {
    const seen = new Set<string>();
    const issue = opts.outcomes.filter((i) => {
      const key = `${i.severity}|${i.code}|${i.diagnostics ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const id = (opts.newId ?? (() => crypto.randomUUID()))();
    entry.push({
      fullUrl: `urn:uuid:${id}`,
      resource: { resourceType: "OperationOutcome", issue } as Resource,
      search: { mode: "outcome" },
    });
  }
  return {
    resourceType: "Bundle",
    type: "searchset",
    timestamp: (opts.now ?? new Date()).toISOString(),
    link,
    entry,
  };
}

function pageUrl(
  baseUrl: string,
  resourceType: string,
  query: URLSearchParams,
  count: number,
  cursor: string | undefined,
): string {
  const params = new URLSearchParams();
  const keys = [...new Set([...query.keys()])]
    .filter((k) => k !== "_count" && k !== "_cursor" && k !== "_format")
    .sort();
  for (const k of keys) for (const v of query.getAll(k)) params.append(k, v);
  params.set("_count", String(count));
  const self = cursor ?? query.get("_cursor");
  if (self) params.set("_cursor", self);
  return `${baseUrl}/${resourceType}?${params.toString()}`;
}

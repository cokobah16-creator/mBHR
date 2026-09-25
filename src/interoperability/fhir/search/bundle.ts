// Searchset Bundles. Links are absolute URLs under the configured base URL,
// built from the parameters the server actually applied (unknown ones were
// already refused), so a client can follow them without re-deriving state.

import type { Bundle, Resource } from "../types/fhir";
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
}): Bundle {
  const { baseUrl, resourceType, query, count, page } = opts;
  const link: Bundle["link"] = [
    { relation: "self", url: pageUrl(baseUrl, resourceType, query, count, undefined) },
  ];
  if (page.next) {
    link.push({
      relation: "next",
      url: pageUrl(baseUrl, resourceType, query, count, encodeCursor(page.next)),
    });
  }
  return {
    resourceType: "Bundle",
    type: "searchset",
    timestamp: (opts.now ?? new Date()).toISOString(),
    link,
    entry: page.resources.map((resource) => ({
      fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`,
      resource,
      search: { mode: "match" as const },
    })),
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

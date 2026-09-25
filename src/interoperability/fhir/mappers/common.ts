// Shared pieces of the domain -> FHIR mappers.
//
// Mappers are pure: they receive rows the repository already fetched (and
// the gateway already authorised) plus pre-resolved references, and return
// FHIR JSON. They never query, never authorise and never read the clock, so
// the same row always maps to the same resource.

import type { Meta, Reference } from "../types/fhir";

/** Source rows as PostgREST returns them (snake_case, JSON scalars). */
export type Row = Record<string, unknown>;

export interface MapContext {
  /** Internal patients.id -> the patient's published FHIR id (patients.fhir_id). */
  patientFhirIds: ReadonlyMap<string, string>;
}

export const MBHR_SOURCE = "https://mbhr.app";

export function str(row: Row, key: string): string | undefined {
  const v = row[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * A finite number, or undefined. Numeric columns arrive as numbers or as
 * numeric strings; null, blanks and non-numbers stay absent. A missing value
 * never becomes zero.
 */
export function num(row: Row, key: string): number | undefined {
  const v = row[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return undefined;
}

/** An instant as ISO-8601 with a zone, or undefined when absent/unparseable. */
export function instant(row: Row, key: string): string | undefined {
  const v = str(row, key);
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** A calendar date (YYYY-MM-DD) from a date or timestamp column. */
export function calendarDate(row: Row, key: string): string | undefined {
  const v = str(row, key);
  if (!v) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : undefined;
}

/**
 * meta.versionId and meta.lastUpdated from the source row.
 *
 * Version strategy (read-only release): the version is the source row's
 * last change time in epoch milliseconds (updated_at, else created_at). It
 * is deterministic (the same row state always gives the same version) and
 * grows whenever mBHR changes the row. When writes arrive, a stored,
 * incrementing version replaces it; see docs/interoperability/fhir-r4.md.
 * A row with no timestamp gets version "0" and no lastUpdated: the time is
 * never invented.
 */
export function versionMeta(row: Row, profile?: string[]): Meta {
  const last = instant(row, "updated_at") ?? instant(row, "created_at");
  const meta: Meta = {
    versionId: last ? String(Date.parse(last)) : "0",
    source: MBHR_SOURCE,
  };
  if (last) meta.lastUpdated = last;
  if (profile && profile.length) meta.profile = profile;
  return meta;
}

export function patientReference(ctx: MapContext, internalPatientId: unknown): Reference | null {
  if (typeof internalPatientId !== "string") return null;
  const fhirId = ctx.patientFhirIds.get(internalPatientId);
  return fhirId ? { reference: `Patient/${fhirId}` } : null;
}

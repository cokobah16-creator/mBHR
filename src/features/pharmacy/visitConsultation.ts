// Which consultation /pharmacy shows beside the dispense form. Only the
// consultation of the visit being dispensed, recorded today, is shown as
// the current plan. Otherwise the most recent earlier one is shown with its
// date, so an old plan is never read as today's.

import type { Consultation } from "@/db";

export interface PharmacyConsultation<C> {
  /** current: this visit's, recorded today. earlier: an older one, shown dated. */
  kind: "current" | "earlier" | "none";
  consultation?: C;
}

function time(value: Date | string | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function sameLocalDay(value: Date | string | undefined, now: Date): boolean {
  return !!value && new Date(value).toDateString() === now.toDateString();
}

export function pharmacyConsultation<C extends Pick<Consultation, "visitId" | "createdAt">>(
  consultations: C[],
  visitId: string,
  now: Date = new Date(),
): PharmacyConsultation<C> {
  const newestFirst = [...consultations].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const current = newestFirst.find((c) => c.visitId === visitId && sameLocalDay(c.createdAt, now));
  if (current) return { kind: "current", consultation: current };
  if (newestFirst.length > 0) return { kind: "earlier", consultation: newestFirst[0] };
  return { kind: "none" };
}

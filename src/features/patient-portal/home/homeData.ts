/**
 * The extra blocks of the portal home ("What's new" and the next outreach),
 * loaded side by side. Each block loads on its own: one that fails comes
 * back undefined and the home screen leaves it out or says it could not
 * load, never "nothing new".
 *
 * Row-level security decides what the signed-in patient may read; the
 * patient id here only narrows to the active profile.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMyReleasedLabResults } from "@/services/portalLabResults";
import * as logger from "@/lib/logger";
import { localIsoDate } from "../account/outreachCache";
import {
  nextOutreach,
  openRequests,
  recentResults,
  type HomeLabResult,
  type HomeOutreach,
  type HomeRequest,
} from "./homeUpdates";

export interface HomeExtras {
  /** undefined: could not load. */
  labs?: HomeLabResult[];
  unreadMessages?: number;
  requests?: HomeRequest[];
  /** null: no upcoming outreach; undefined: could not load. */
  outreach?: HomeOutreach | null;
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code);
  }
  return "unknown";
}

async function loadUnread(client: SupabaseClient, patientId: string) {
  const { count, error } = await client
    .from("patient_secure_messages")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("read", false)
    .eq("from_patient", false);
  if (error) throw error;
  return count ?? 0;
}

async function loadRequests(client: SupabaseClient, patientId: string) {
  const { data, error } = await client
    .from("patient_appointment_requests")
    .select("id, status, created_at, visit_mode")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return openRequests(data ?? []);
}

async function loadOutreach(client: SupabaseClient) {
  const today = localIsoDate();
  const { data, error } = await client
    .from("outreach_events")
    .select("id, event_name, event_date, status, sites(name, lga, state)")
    .gte("event_date", today)
    .in("status", ["planned", "active"])
    .order("event_date", { ascending: true })
    .limit(5);
  if (error) throw error;
  return nextOutreach((data ?? []) as unknown as Parameters<typeof nextOutreach>[0], today);
}

async function loadLabs(patientId: string, accountId: string | undefined) {
  const load = await fetchMyReleasedLabResults({ limit: 10, patientId, accountId });
  if (load.status !== "ok") throw new Error(`labs_${load.status}`);
  return recentResults(load.results);
}

function settled<T>(result: PromiseSettledResult<T>, what: string): T | undefined {
  if (result.status === "fulfilled") return result.value;
  logger.warn(`[portal home] ${what} did not load:`, errorName(result.reason));
  return undefined;
}

export async function loadHomeExtras(
  client: SupabaseClient,
  patientId: string,
  accountId?: string,
): Promise<HomeExtras> {
  const [labs, unread, requests, outreach] = await Promise.allSettled([
    loadLabs(patientId, accountId),
    loadUnread(client, patientId),
    loadRequests(client, patientId),
    loadOutreach(client),
  ]);
  return {
    labs: settled(labs, "lab results"),
    unreadMessages: settled(unread, "unread messages"),
    requests: settled(requests, "requests"),
    outreach: settled(outreach, "outreach"),
  };
}

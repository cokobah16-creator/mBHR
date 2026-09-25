import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { supabase } from "@/lib/supabaseClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useCloudSession } from "@/lib/cloudSession";
import { useAuthStore } from "@/stores/auth";
import { can, type Role } from "@/auth/roles";
import type { InteropRpcClient } from "@/services/interopRpc";
import {
  externalSharingChip,
  loadConsentSummary,
  type ConsentSummary,
} from "@/services/interopConsent";

interface Props {
  patientId: string;
  /** For tests: the client to call (defaults to the app's Supabase client). */
  client?: InteropRpcClient | null;
}

/** Roles the server lets read the summary (consult, portal_manage, audit_access). */
function canSeeExternalSharing(role: Role | null | undefined): boolean {
  if (!role) return false;
  return can(role, "consult") || can(role, "portal_manage") || can(role, "audit_access");
}

/**
 * Read-only chip: "External sharing: Allowed", "Restricted" or "Withdrawn"
 * (interop_consent_summary sharing_state). Allowed only for a verified
 * permit in force with no limit and no refusal; everything else, including
 * no record at all, is Restricted. The hover text gives the reason in plain
 * words, says external access is off in this release, and that care is not
 * affected. It never blocks or changes care.
 *
 * Renders nothing unless the device is online and the staff member is
 * signed in online, and nothing when the summary cannot be read (not
 * deployed yet, refused, or failed).
 */
export function ExternalSharingChip({ patientId, client }: Props) {
  const rpcClient: InteropRpcClient | null =
    client !== undefined ? client : (supabase as unknown as InteropRpcClient | null);
  const isOnline = useOnlineStatus();
  const cloudSession = useCloudSession();
  const role = useAuthStore((s) => s.currentUser?.role ?? null) as Role | null;
  const allowed = canSeeExternalSharing(role);
  const ready = isOnline && cloudSession === "signed_in" && allowed && !!rpcClient && !!patientId;
  const [summary, setSummary] = useState<ConsentSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    if (!ready) return;
    void loadConsentSummary(rpcClient, patientId, true).then((result) => {
      if (cancelled) return;
      setSummary(result.status === "ok" ? result.summary : null);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, rpcClient, patientId]);

  const chip = ready ? externalSharingChip(summary) : null;
  if (!chip) return null;
  return (
    <span title={chip.hint} data-testid="external-sharing-chip">
      <StatusBadge tone={chip.tone}>
        {chip.label}
        <span className="sr-only"> ({chip.hint})</span>
      </StatusBadge>
    </span>
  );
}

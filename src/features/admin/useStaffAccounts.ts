import { useCallback, useEffect, useRef, useState } from "react";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import {
  getStaffOverview,
  pingStaffAdmin,
  probeAuthHealth,
  type OverviewResponse,
  type StaffAdminError,
  type StaffAdminFailure,
} from "@/services/staffAccounts";
import { STAFF_COPY } from "./staffAccountView";

/** What the Users screen can do with staff accounts right now. */
export type StaffScreenState =
  /** No server on this device: staff are managed on this device only. */
  | "device_mode"
  | "checking"
  | "offline"
  | "not_signed_in"
  | "not_permitted"
  | "not_deployed"
  | "not_configured"
  | "unreachable"
  | "error"
  | "ready";

export interface StaffAccountsState {
  state: StaffScreenState;
  /** The last overview the server sent; kept while offline or after a failed reload. */
  overview: OverviewResponse | null;
  /** The failure's own message when the state is "error" (for example a rate limit). */
  failureMessage: string | null;
  /**
   * A refresh failed (for example the server's limit on list refreshes)
   * while the list already shown is still usable: the state stays "ready"
   * with the previous overview, and this says the list may be out of date.
   */
  notice: string | null;
  /** Asks the server again (ping, then overview). */
  reload: () => Promise<void>;
}

function stateFor(failure: StaffAdminFailure): StaffScreenState {
  switch (failure) {
    case "no_server":
      return "device_mode";
    case "offline":
    case "not_signed_in":
    case "not_permitted":
    case "not_deployed":
    case "not_configured":
    case "unreachable":
      return failure;
    default:
      return "error";
  }
}

/**
 * The message for a failed load of the list. The server's own rate-limit
 * message talks about changes, but loading the list changes nothing.
 */
function listFailureMessage(error: StaffAdminError): string {
  if (error.failure === "rate_limited") {
    return STAFF_COPY.failure.list_rate_limited(error.retryAfterSeconds);
  }
  return error.message;
}

/**
 * Loads the staff accounts from the server for the Users screen: `ping`
 * first (is the function there at all), then `overview`. When nothing
 * answers, one check of the server's sign-in service tells "not available
 * on this server" from "couldn't reach the server". Follows the browser
 * going on- and offline.
 *
 * `enabled` defaults to whether this device syncs with a server; when it
 * does not, the state is "device_mode" and nothing is requested.
 */
export function useStaffAccounts(
  enabled: boolean = isOnlineSyncEnabled(),
): StaffAccountsState {
  const [state, setState] = useState<StaffScreenState>(enabled ? "checking" : "device_mode");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The overview held right now, read inside reload without re-creating it.
  const overviewRef = useRef<OverviewResponse | null>(null);
  // Only the latest request may change the state.
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    if (!enabled) {
      setState("device_mode");
      overviewRef.current = null;
      setOverview(null);
      setFailureMessage(null);
      setNotice(null);
      return;
    }
    setState("checking");
    setFailureMessage(null);

    /**
     * A failure that is not about the connection or the caller (a rate
     * limit, a refusal, a server error) leaves an overview already held
     * usable: keep it and say it may be out of date. Returns true when kept.
     */
    const keepHeldOverview = (next: StaffScreenState): boolean => {
      if (next !== "error" || !overviewRef.current) return false;
      setState("ready");
      setFailureMessage(null);
      setNotice(STAFF_COPY.staleList);
      return true;
    };

    const ping = await pingStaffAdmin();
    if (seq !== requestSeq.current) return;
    if (ping.ok === false) {
      let next = stateFor(ping.failure);
      if (ping.failure === "unreachable" && (await probeAuthHealth())) {
        // The server answers, but the staff function does not.
        next = "not_deployed";
      }
      if (seq !== requestSeq.current) return;
      if (keepHeldOverview(next)) return;
      setNotice(null);
      setState(next);
      setFailureMessage(next === "error" ? listFailureMessage(ping) : null);
      return;
    }

    const result = await getStaffOverview();
    if (seq !== requestSeq.current) return;
    if (result.ok === false) {
      const next = stateFor(result.failure);
      if (keepHeldOverview(next)) return;
      if (next === "not_signed_in" || next === "not_permitted" || next === "device_mode") {
        overviewRef.current = null;
        setOverview(null);
      }
      setNotice(null);
      setState(next);
      setFailureMessage(next === "error" ? listFailureMessage(result) : null);
      return;
    }
    overviewRef.current = result.data;
    setOverview(result.data);
    setNotice(null);
    setState("ready");
  }, [enabled]);

  useEffect(() => {
    void reload();
    return () => {
      // Ignore any reply that arrives after the screen closed.
      requestSeq.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    const goOffline = () => {
      requestSeq.current += 1;
      setState("offline");
      setFailureMessage(null);
    };
    const goOnline = () => {
      void reload();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [enabled, reload]);

  return { state, overview, failureMessage, notice, reload };
}
